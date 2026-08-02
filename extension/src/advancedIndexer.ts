import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import { SymbolIndex, IndexedSymbol } from './shared/indexes/symbolIndex';
import { RangeTree } from './shared/dataStructures/intervalTree';
import { saveBloomFilter, loadBloomFilter } from './indexing/indexSerializer';
import { ParserService, RubySymbolExtractionStatus } from './parsing';
import { RubyRuntime } from './runtime/rubyRuntime';
import { SchemaParser } from './database/schemaParser';
import {
    Association,
    AssociationType,
    ClassInfo,
    MethodInfo,
    ReferenceType,
    SemanticGraphBuilder
} from './indexing/semanticGraph';
import { TypeInferenceEngine } from './indexing/typeInference';
import { ReferenceTracker, DeadCodeAnalysis, ReferenceInfo } from './indexing/referenceTracker';
import { RailsComponent, RailsIntelligence, RouteInfo } from './indexing/railsIntelligence';
import { SearchContext, SearchResult, SmartSearchEngine } from './indexing/smartSearch';
import { ASTNode, ClassNode, MethodNode, NodeType } from './indexing/rubyParser';
import { DefinitionConfidence, definitionConfidenceRank } from './shared/definitionConfidence';
import { camelize, singularize, underscore } from './shared/inflections';
import { escapeRegExp } from './shared/rubyToken';

export type { DefinitionConfidence } from './shared/definitionConfidence';
export type IndexFileStatus = 'ok' | 'fallback' | 'parse_error' | 'stale' | 'deleted';
export type IndexLifecycleState = 'ready' | 'indexing' | 'degraded' | 'failed';

export interface RubySymbol {
    name: string;
    kind: vscode.SymbolKind;
    location: vscode.Location;
    containerName?: string;
    detail?: string;
    scope?: 'class' | 'module' | 'instance' | 'singleton';
    parameters?: string[];
    returnType?: string;
    documentation?: string;
    usageCount?: number;
    definitionConfidence?: DefinitionConfidence;
}

export interface TypeInfo {
    name: string;
    methods: Map<string, MethodSignature>;
    superclass?: string;
    mixins: string[];
}

export interface MethodSignature {
    name: string;
    parameters: Parameter[];
    returnType?: string;
    visibility: 'public' | 'private' | 'protected';
}

export interface Parameter {
    name: string;
    type?: string;
    defaultValue?: string;
    keyword?: boolean;
    splat?: boolean;
}

interface FileMetadata {
    uri: string;
    checksum: string;
    lastIndexed: number;
    symbolCount: number;
    status: IndexFileStatus;
    parserEngine?: 'tree-sitter' | 'legacy';
    error?: string;
}

interface IndexStats {
    totalFiles: number;
    indexedFiles: number;
    totalSymbols: number;
    gemFiles: number;
    lastIndexTime: number;
    lastIndexDuration: number;
}

export interface IndexLifecycleSnapshot {
    state: IndexLifecycleState;
    totalFiles: number;
    degradedFiles: number;
    failedFiles: number;
    message?: string;
}

export interface DefinitionResult {
    location: vscode.Location;
    confidence: DefinitionConfidence;
    exact: boolean;
    source: 'ast' | 'metaprogramming' | 'rails' | 'fuzzy' | 'fallback';
}

export interface ReferenceResult {
    location: vscode.Location;
    confidence: DefinitionConfidence;
    kind?: string;
}

export interface CoreRubyIndexStatus {
    parserEngine: string;
    indexedFiles: number;
    degradedFiles: number;
    failedFiles: number;
    cacheVersion: string;
    lastIndexDuration: number;
    lifecycle: IndexLifecycleSnapshot;
}

/** Schema version for cache invalidation on breaking changes */
const INDEX_SCHEMA_VERSION = 3;
const RUBY_PROJECT_FILE_PATTERNS = [
    '**/*.rb',
    '**/*.rake',
    '**/*.gemspec',
    '**/Rakefile',
    '**/Gemfile'
];
const RUBY_PROJECT_EXCLUDE = '{**/node_modules/**,**/vendor/bundle/**,**/tmp/**,.git/**}';

interface IndexMeta {
    version: number;
    createdAt: number;
    workspaceRoot: string;
    parserCacheVersion?: string;
}

export class CoreRubyIndex {
    private symbols: Map<string, RubySymbol[]> = new Map();
    private typeInfo: Map<string, TypeInfo> = new Map();
    private usages: Map<string, vscode.Location[]> = new Map();
    private fileMetadata: Map<string, FileMetadata> = new Map();
    private gemPaths: Set<string> = new Set();

    // Performance: Use optimized SymbolIndex for fast lookups (O(1) by name, O(k) prefix search)
    private symbolIndex: SymbolIndex;

    // Performance: Use RangeTree for fast position-based symbol lookup
    private fileRangeTrees: Map<string, RangeTree<RubySymbol>> = new Map();

    private indexing: boolean = false;
    private indexQueue: vscode.Uri[] = [];
    // Coalesces concurrent indexing of the same document version so an
    // on-demand navigation re-index and the background workspace index never
    // interleave their destructive symbol-store updates.
    private readonly inFlightIndex: Map<string, Promise<void>> = new Map();
    private outputChannel: vscode.OutputChannel;
    private context: vscode.ExtensionContext;
    private parserService: ParserService;
    private rubyRuntime: RubyRuntime;
    private fileStatuses: Map<string, IndexFileStatus> = new Map();
    // Files whose current symbol store came from a clean (non-degraded) parse.
    // Tracked separately from fileStatuses so a transient parse error can be
    // surfaced in the status bar while the last-good symbols are retained.
    private readonly cleanParseFiles: Set<string> = new Set();
    private readonly statusEmitter = new vscode.EventEmitter<IndexLifecycleSnapshot>();
    readonly onDidChangeStatus = this.statusEmitter.event;
    private lifecycleState: IndexLifecycleState = 'ready';
    private lifecycleMessage: string | undefined;
    private lastIndexError: string | undefined;
    private lastIndexDuration = 0;
    private readonly diagnostics: vscode.DiagnosticCollection;
    private readonly semanticGraph: SemanticGraphBuilder;
    private readonly smartSearch: SmartSearchEngine;
    private readonly referenceTracker: ReferenceTracker;
    private readonly railsIntelligence: RailsIntelligence;
    private readonly schemaParser: SchemaParser;
    private readonly typeInference: TypeInferenceEngine;

    // Cache paths - workspace-scoped for isolation between projects
    private get workspaceRoot(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    private get cacheDir(): string {
        const root = this.workspaceRoot;
        if (root) {
            // Workspace-scoped: .rubymate/ in project root
            return path.join(root, '.rubymate');
        }
        // Fallback to global storage for non-workspace scenarios
        return path.join(this.context.globalStorageUri.fsPath, 'index-cache');
    }

    private get symbolsCachePath(): string {
        return path.join(this.cacheDir, 'symbols.json');
    }

    private get metadataCachePath(): string {
        return path.join(this.cacheDir, 'metadata.json');
    }

    private get indexMetaPath(): string {
        return path.join(this.cacheDir, 'index.meta.json');
    }

    private get bloomFilterPath(): string {
        return path.join(this.cacheDir, 'bloom.bin');
    }

    constructor(
        context: vscode.ExtensionContext,
        outputChannel: vscode.OutputChannel,
        parserService?: ParserService,
        rubyRuntime?: RubyRuntime,
        schemaParser?: SchemaParser
    ) {
        this.context = context;
        this.outputChannel = outputChannel;
        this.parserService = parserService ?? new ParserService(context, outputChannel);
        this.rubyRuntime = rubyRuntime ?? new RubyRuntime(outputChannel);
        // Performance: Initialize SymbolIndex with expected ~50k symbols for optimal bloom filter sizing
        this.symbolIndex = new SymbolIndex(50000);
        this.diagnostics = vscode.languages.createDiagnosticCollection('rubymate-core');
        this.semanticGraph = new SemanticGraphBuilder(outputChannel);
        this.smartSearch = new SmartSearchEngine(this.semanticGraph);
        this.referenceTracker = new ReferenceTracker(this.semanticGraph, outputChannel, this.parserService);
        this.schemaParser = schemaParser ?? new SchemaParser(outputChannel);
        this.railsIntelligence = new RailsIntelligence(this.semanticGraph, this.workspaceRoot ?? '');
        this.typeInference = new TypeInferenceEngine(this.semanticGraph, this.schemaParser, outputChannel);
    }

    async initialize(): Promise<void> {
        // Create cache directory
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
        } catch (error) {
            this.outputChannel.appendLine(`Failed to create cache directory: ${error}`);
        }

        // Load cached index
        await this.loadCache();

        // Discover gem paths
        await this.discoverGems();

        // Rails routes are optional; failures should not block the core index.
        await this.railsIntelligence.parseRoutes(false);

        this.recordVirtualWorkspaceDiagnostics();
    }

    /**
     * Load index from disk cache for instant startup
     */
    private async loadCache(): Promise<void> {
        try {
            // Check schema version first
            const metaData = await fs.readFile(this.indexMetaPath, 'utf-8');
            const meta: IndexMeta = JSON.parse(metaData);

            if (meta.version !== INDEX_SCHEMA_VERSION) {
                this.outputChannel.appendLine(
                    `Cache version mismatch (${meta.version} vs ${INDEX_SCHEMA_VERSION}), will reindex`
                );
                return;
            }

            // Validate workspace root matches
            if (this.workspaceRoot && meta.workspaceRoot !== this.workspaceRoot) {
                this.outputChannel.appendLine('Cache workspace mismatch, will reindex');
                return;
            }

            if (meta.parserCacheVersion !== this.parserService.getCacheVersion()) {
                this.outputChannel.appendLine('Cache parser version changed, will reindex');
                return;
            }

            // Load BloomFilter from binary (Phase 2: avoid rebuilding)
            const cachedBloomFilter = await loadBloomFilter(this.bloomFilterPath);

            const symbolsData = await fs.readFile(this.symbolsCachePath, 'utf-8');
            const metadataData = await fs.readFile(this.metadataCachePath, 'utf-8');

            const cachedSymbols = JSON.parse(symbolsData);
            const cachedMetadata = JSON.parse(metadataData);

            // Reconstruct metadata
            for (const [uri, metadata] of Object.entries(cachedMetadata)) {
                if (!this.isFileUriString(uri)) {
                    continue;
                }

                const fileMetadata = metadata as FileMetadata;
                this.fileMetadata.set(uri, fileMetadata);
                const cachedStatus = fileMetadata.status ?? 'ok';
                this.fileStatuses.set(uri, cachedStatus);
                if (cachedStatus === 'ok') {
                    this.cleanParseFiles.add(uri);
                }
            }

            // Reconstruct symbols map
            for (const [uri, symbols] of Object.entries(cachedSymbols)) {
                if (!this.fileMetadata.has(uri)) {
                    continue;
                }

                this.symbols.set(uri, this.deserializeSymbols(symbols as any[]));
            }

            // CRITICAL: Rebuild symbolIndex and fileRangeTrees from loaded symbols
            // Pass cached BloomFilter to avoid expensive rebuild
            this.rebuildIndexesFromCache(cachedBloomFilter);

            const totalSymbols = Array.from(this.symbols.values())
                .reduce((sum, arr) => sum + arr.length, 0);

            const bloomStatus = cachedBloomFilter ? 'restored' : 'rebuilt';
            this.outputChannel.appendLine(`Loaded ${totalSymbols} symbols from cache (BloomFilter: ${bloomStatus})`);
            this.refreshLifecycleState();
        } catch (error) {
            this.outputChannel.appendLine('No cache found, will perform full indexing');
        }
    }

    /**
     * Rebuild symbolIndex and fileRangeTrees after loading from cache
     * This ensures fast lookups work immediately after startup
     * @param cachedBloomFilter - Optional persisted BloomFilter to reuse
     */
    private rebuildIndexesFromCache(cachedBloomFilter?: import('./shared/dataStructures/bloomFilter').BloomFilter | null): void {
        // Create SymbolIndex with cached BloomFilter if available
        // This avoids expensive O(n) BloomFilter population
        this.symbolIndex = cachedBloomFilter
            ? new SymbolIndex(50000, cachedBloomFilter)
            : new SymbolIndex(50000);
        this.fileRangeTrees.clear();

        for (const [uriStr, symbols] of this.symbols) {
            // Rebuild symbolIndex (BloomFilter already populated if cached)
            const indexedSymbols: IndexedSymbol[] = symbols.map(s => ({
                name: s.name,
                kind: s.kind,
                location: s.location,
                containerName: s.containerName,
                detail: s.detail,
                definitionConfidence: s.definitionConfidence,
                fullyQualifiedName: s.containerName ? `${s.containerName}::${s.name}` : s.name
            }));
            this.symbolIndex.addSymbols(indexedSymbols);

            // Rebuild RangeTree for position-based lookups
            const rangeTree = new RangeTree<RubySymbol>();
            for (const symbol of symbols) {
                const range = symbol.location.range;
                rangeTree.insertRange({
                    start: { line: range.start.line, column: range.start.character },
                    end: { line: range.end.line, column: range.end.character }
                }, symbol);
            }
            this.fileRangeTrees.set(uriStr, rangeTree);
        }
    }

    /**
     * Save index to disk cache for next startup
     */
    private async saveCache(): Promise<void> {
        try {
            // Write index meta first (for version validation on load)
            const meta: IndexMeta = {
                version: INDEX_SCHEMA_VERSION,
                createdAt: Date.now(),
                workspaceRoot: this.workspaceRoot || '',
                parserCacheVersion: this.parserService.getCacheVersion()
            };
            await fs.writeFile(this.indexMetaPath, JSON.stringify(meta), 'utf-8');

            const symbolsData = Object.fromEntries(
                Array.from(this.symbols.entries())
                    .filter(([uri]) => this.isPersistedFileUriString(uri))
                    .map(([uri, symbols]) => [
                    uri,
                    this.serializeSymbols(symbols)
                ])
            );

            const metadataData = Object.fromEntries(
                Array.from(this.fileMetadata.entries())
                    .filter(([uri]) => this.isPersistedFileUriString(uri))
            );

            // Save in parallel for better performance
            await Promise.all([
                fs.writeFile(this.symbolsCachePath, JSON.stringify(symbolsData), 'utf-8'),
                fs.writeFile(this.metadataCachePath, JSON.stringify(metadataData), 'utf-8'),
                // Phase 2: Save BloomFilter to binary for fast restore
                saveBloomFilter(this.symbolIndex.getBloomFilter(), this.bloomFilterPath)
            ]);

            this.outputChannel.appendLine('Index cache saved');
        } catch (error) {
            this.outputChannel.appendLine(`Failed to save cache: ${error}`);
        }
    }

    /**
     * Discover installed gems from Bundler
     */
    private async discoverGems(): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return;
            }

            // Check for Gemfile
            const gemfilePath = path.join(workspaceFolder.uri.fsPath, 'Gemfile');
            try {
                await fs.access(gemfilePath);
            } catch {
                return; // No Gemfile
            }

            this.outputChannel.appendLine('Discovering installed gems...');

            const { stdout } = await this.rubyRuntime.exec('bundle', ['show', '--paths'], {
                cwd: workspaceFolder.uri.fsPath,
                timeout: 30000,
                logPrefix: 'bundle show'
            });

            const gemPaths = stdout.trim().split('\n');
            gemPaths.forEach((gemPath: string) => this.gemPaths.add(gemPath));

            this.outputChannel.appendLine(`Found ${gemPaths.length} installed gems`);
        } catch (error) {
            this.outputChannel.appendLine(`Failed to discover gems: ${error}`);
        }
    }

    /**
     * Index workspace with smart prioritization
     */
    async indexWorkspace(): Promise<void> {
        if (this.indexing) {
            this.outputChannel.appendLine('Indexing already in progress, skipping duplicate request');
            return;
        }

        this.indexing = true;
        this.lastIndexError = undefined;
        this.setLifecycleState('indexing', 'Indexing workspace...');
        const startTime = Date.now();

        try {
            this.outputChannel.appendLine('Starting intelligent workspace indexing...');

            // Phase 1: Index open files first (instant)
            try {
                await this.indexOpenFiles();
            } catch (err) {
                this.outputChannel.appendLine(`Error indexing open files: ${err}`);
            }

            // Phase 2: Index visible files in background
            try {
                await this.indexVisibleFiles();
            } catch (err) {
                this.outputChannel.appendLine(`Error indexing visible files: ${err}`);
            }

            // Phase 3: Index project files incrementally
            try {
                await this.indexProjectFiles();
            } catch (err) {
                this.outputChannel.appendLine(`Error indexing project files: ${err}`);
            }

            // Phase 4: Index gems in background (low priority)
            this.indexGems().catch(err => {
                this.outputChannel.appendLine(`Gem indexing failed: ${err}`);
            });

            // Save cache
            try {
                await this.saveCache();
            } catch (err) {
                this.outputChannel.appendLine(`Error saving cache: ${err}`);
            }

            const duration = Date.now() - startTime;
            this.lastIndexDuration = duration;
            const stats = this.getStats();
            this.outputChannel.appendLine(
                `Indexed ${stats.totalSymbols} symbols in ${stats.indexedFiles} files (${duration}ms)`
            );
        } catch (error) {
            this.lastIndexError = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Critical error during indexing: ${error}`);
            this.setLifecycleState('failed', this.lastIndexError);
            throw error; // Re-throw to trigger timeout/error handling
        } finally {
            this.indexing = false;
            this.refreshLifecycleState();
        }
    }

    /**
     * Phase 1: Index currently open files (highest priority)
     */
    private async indexOpenFiles(): Promise<void> {
        await this.indexOpenDocuments(true);
    }

    async indexOpenDocuments(priority: boolean = true): Promise<void> {
        const openDocs = vscode.workspace.textDocuments.filter(
            doc => doc.languageId === 'ruby' && doc.uri.scheme === 'file'
        );

        this.outputChannel.appendLine(`Indexing ${openDocs.length} open files...`);

        for (const doc of openDocs) {
            await this.indexDocument(doc, priority);
        }
    }

    /**
     * Phase 2: Index files visible in editor (high priority)
     */
    private async indexVisibleFiles(): Promise<void> {
        await this.indexVisibleDocuments(true);
    }

    async indexVisibleDocuments(priority: boolean = true): Promise<void> {
        const visibleUris = vscode.window.visibleTextEditors
            .filter(editor => editor.document.languageId === 'ruby' && editor.document.uri.scheme === 'file')
            .map(editor => editor.document);

        for (const document of visibleUris) {
            await this.indexDocument(document, priority);
        }
    }

    /**
     * Phase 3: Index project files incrementally
     */
    private async indexProjectFiles(): Promise<void> {
        const files = await this.findProjectRubyFiles();

        this.outputChannel.appendLine(`Found ${files.length} project files`);
        await this.purgeMissingWorkspaceFiles(new Set(files.map(uri => uri.toString())));

        // Filter files that need re-indexing
        const filesToIndex: vscode.Uri[] = [];
        for (const uri of files) {
            if (await this.needsReindex(uri)) {
                filesToIndex.push(uri);
            }
        }

        this.outputChannel.appendLine(`${filesToIndex.length} files need indexing`);

        // Index in batches to avoid blocking
        const batchSize = 20;
        for (let i = 0; i < filesToIndex.length; i += batchSize) {
            const batch = filesToIndex.slice(i, i + batchSize);
            await Promise.all(batch.map(uri => this.indexFile(uri, false)));

            // Yield to event loop every batch
            await new Promise(resolve => setImmediate(resolve));
        }
    }

    private async findProjectRubyFiles(): Promise<vscode.Uri[]> {
        const seen = new Set<string>();
        const files: vscode.Uri[] = [];

        for (const pattern of RUBY_PROJECT_FILE_PATTERNS) {
            const matches = await vscode.workspace.findFiles(pattern, RUBY_PROJECT_EXCLUDE);
            for (const uri of matches) {
                const uriStr = uri.toString();
                if (!seen.has(uriStr)) {
                    seen.add(uriStr);
                    files.push(uri);
                }
            }
        }

        return files;
    }

    /**
     * Phase 4: Index gems (lowest priority, background)
     */
    private async indexGems(): Promise<void> {
        this.outputChannel.appendLine('Indexing gems in background...');

        for (const gemPath of this.gemPaths) {
            try {
                const libPath = path.join(gemPath, 'lib');
                const gemFiles = await this.findRubyFiles(libPath);

                for (const file of gemFiles) {
                    const uri = vscode.Uri.file(file);
                    await this.indexFile(uri, false);
                }
            } catch (error) {
                // Silently skip gem if it can't be indexed
            }
        }

        this.outputChannel.appendLine('Gem indexing complete');
    }

    /**
     * Find Ruby files in a directory recursively
     */
    private async findRubyFiles(dir: string): Promise<string[]> {
        const files: string[] = [];

        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    // Recurse into subdirectories
                    const subFiles = await this.findRubyFiles(fullPath);
                    files.push(...subFiles);
                } else if (entry.isFile() && entry.name.endsWith('.rb')) {
                    files.push(fullPath);
                }
            }
        } catch (error) {
            // Ignore errors
        }

        return files;
    }

    /**
     * Check if file needs re-indexing (incremental indexing)
     */
    private async needsReindex(uri: vscode.Uri): Promise<boolean> {
        const uriStr = uri.toString();
        const metadata = this.fileMetadata.get(uriStr);

        if (!metadata) {
            return true; // Never indexed
        }

        if (metadata.status !== 'ok') {
            return true;
        }

        try {
            // Calculate current checksum
            const content = await vscode.workspace.fs.readFile(uri);
            const checksum = this.calculateChecksum(content);

            return checksum !== metadata.checksum; // Changed since last index
        } catch {
            return true; // File error, re-index
        }
    }

    /**
     * Calculate file checksum for change detection
     */
    private calculateChecksum(content: Uint8Array): string {
        return crypto.createHash('md5').update(content).digest('hex');
    }

    /**
     * Index a single file with advanced symbol extraction
     */
    async indexFile(uri: vscode.Uri, priority: boolean = false): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            await this.indexDocument(document, priority);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Failed to index ${uri.fsPath}: ${message}`);
            await this.removeFile(uri, 'stale', message);
        }
    }

    /**
     * Index the current in-memory document.
     *
     * This keeps providers correct before background workspace indexing has
     * completed and also covers unsaved edits in the active editor.
     */
    async indexDocument(document: vscode.TextDocument, priority: boolean = false): Promise<void> {
        if (document.languageId !== 'ruby') {
            return;
        }

        // Serialize concurrent indexing of the same document version. Navigation
        // providers re-index on every request, so this prevents a click's
        // on-demand index from racing the background workspace index.
        const key = `${document.uri.toString()}@${document.version}`;
        const existing = this.inFlightIndex.get(key);
        if (existing) {
            return existing;
        }

        const pending = this.indexDocumentInternal(document, priority).finally(() => {
            if (this.inFlightIndex.get(key) === pending) {
                this.inFlightIndex.delete(key);
            }
        });
        this.inFlightIndex.set(key, pending);
        return pending;
    }

    private async indexDocumentInternal(document: vscode.TextDocument, priority: boolean = false): Promise<void> {
        try {
            const uriStr = document.uri.toString();
            const shouldPersist = document.uri.scheme === 'file';
            const checksum = this.calculateChecksum(Buffer.from(document.getText(), 'utf-8'));

            // Skip redundant re-parsing when the buffer is unchanged and already
            // indexed. Navigation providers call this on every request, so this
            // avoids re-parsing and rewriting the index on every click.
            const existingMeta = this.fileMetadata.get(uriStr);
            if (existingMeta?.checksum === checksum && this.symbols.has(uriStr)) {
                return;
            }

            // Extract symbols with the configured parser service.
            const extraction = await this.parserService.extractRubySymbolResult(document);
            const symbols = extraction.symbols;
            const fileStatus = this.toIndexFileStatus(extraction.status);

            // Do not downgrade a file that previously parsed cleanly to heuristic
            // (legacy) symbols because of a transient in-memory parse error (e.g.
            // mid-edit syntax). Keep the last-good AST symbols so a click while
            // editing never turns navigation heuristic or trips the whole index
            // into a degraded state. Files with no prior clean parse fall through
            // and keep their legacy symbols as a best-effort fallback.
            if (
                (extraction.status === 'fallback' || extraction.status === 'parse_error') &&
                this.cleanParseFiles.has(uriStr) &&
                (this.symbols.get(uriStr)?.length ?? 0) > 0
            ) {
                // Retain the last-good symbols so navigation keeps working, but
                // still surface the degraded parse so the status bar reflects the
                // syntax error instead of continuing to report a healthy file.
                // cleanParseFiles is left intact so repeated bad edits keep the
                // retained symbols until a clean parse restores 'ok'.
                this.fileStatuses.set(uriStr, fileStatus);
                this.refreshLifecycleState();
                return;
            }

            if (symbols.length > 0) {
                // Performance: Remove old symbols from SymbolIndex before adding new ones
                this.symbolIndex.removeFileSymbols(uriStr);

                this.symbols.set(uriStr, symbols);

                // Performance: Add symbols to optimized SymbolIndex for fast lookups
                const indexedSymbols: IndexedSymbol[] = symbols.map(s => ({
                    name: s.name,
                    kind: s.kind,
                    location: s.location,
                    containerName: s.containerName,
                    detail: s.detail,
                    definitionConfidence: s.definitionConfidence,
                    fullyQualifiedName: s.containerName ? `${s.containerName}::${s.name}` : s.name
                }));
                this.symbolIndex.addSymbols(indexedSymbols);

                // Performance: Build RangeTree for fast position-based lookups
                const rangeTree = new RangeTree<RubySymbol>();
                for (const symbol of symbols) {
                    const range = symbol.location.range;
                    rangeTree.insertRange({
                        start: { line: range.start.line, column: range.start.character },
                        end: { line: range.end.line, column: range.end.character }
                    }, symbol);
                }
                this.fileRangeTrees.set(uriStr, rangeTree);

                if (shouldPersist) {
                    // Update metadata
                    this.fileMetadata.set(uriStr, {
                        uri: uriStr,
                        checksum,
                        lastIndexed: Date.now(),
                        symbolCount: symbols.length,
                        status: fileStatus,
                        parserEngine: extraction.engine,
                        error: extraction.error
                    });
                    this.fileStatuses.set(uriStr, fileStatus);
                    if (fileStatus === 'ok') {
                        this.cleanParseFiles.add(uriStr);
                    } else {
                        this.cleanParseFiles.delete(uriStr);
                    }

                    // Extract type information
                    await this.extractTypeInfo(document, symbols);
                }
            } else {
                if (shouldPersist) {
                    this.removeIndexedFile(document.uri, fileStatus, checksum, extraction.error);
                    this.fileMetadata.set(uriStr, {
                        uri: uriStr,
                        checksum,
                        lastIndexed: Date.now(),
                        symbolCount: 0,
                        status: fileStatus,
                        parserEngine: extraction.engine,
                        error: extraction.error
                    });
                    this.fileStatuses.set(uriStr, fileStatus);
                } else {
                    this.removeSymbolStores(document.uri);
                }
            }

            await this.updateSemanticIndex(document, symbols, fileStatus, extraction.error);
            this.updateDiagnosticsForFile(document.uri, fileStatus, extraction.engine, extraction.error);
            this.refreshLifecycleState();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Failed to index document ${document.uri.toString()}: ${message}`);
            if (document.uri.scheme === 'file') {
                this.removeIndexedFile(document.uri, 'stale', undefined, message);
                this.updateDiagnosticsForFile(document.uri, 'stale', undefined, message);
            } else {
                this.removeSymbolStores(document.uri);
            }
            this.refreshLifecycleState();
        }
    }

    async removeFile(
        uri: vscode.Uri,
        status: IndexFileStatus = 'deleted',
        error?: string
    ): Promise<void> {
        this.removeIndexedFile(uri, status, undefined, error);
        this.removeSemanticFile(uri);
        this.updateDiagnosticsForFile(uri, status, undefined, error);
        this.outputChannel.appendLine(`Removed ${uri.toString()} from RubyMate index (${status})`);
        this.refreshLifecycleState();
    }

    getFileStatus(uri: vscode.Uri): IndexFileStatus | undefined {
        return this.fileStatuses.get(uri.toString());
    }

    getIndexLifecycleSnapshot(): IndexLifecycleSnapshot {
        const statuses = Array.from(this.fileStatuses.values());
        const degradedFiles = statuses.filter(status => status === 'fallback' || status === 'parse_error' || status === 'stale').length;
        const failedFiles = statuses.filter(status => status === 'parse_error' || status === 'stale').length;

        return {
            state: this.lifecycleState,
            totalFiles: this.fileMetadata.size,
            degradedFiles,
            failedFiles,
            message: this.lifecycleMessage
        };
    }

    private removeIndexedFile(
        uri: vscode.Uri,
        status: IndexFileStatus,
        checksum: string = '',
        error?: string
    ): void {
        const uriStr = uri.toString();
        this.removeSymbolStores(uri);

        this.fileMetadata.set(uriStr, {
            uri: uriStr,
            checksum,
            lastIndexed: Date.now(),
            symbolCount: 0,
            status,
            error
        });
        this.fileStatuses.set(uriStr, status);
    }

    private removeSymbolStores(uri: vscode.Uri): void {
        const uriStr = uri.toString();
        const oldSymbols = this.symbols.get(uriStr) ?? [];

        this.symbolIndex.removeFileSymbols(uriStr);
        this.symbols.delete(uriStr);
        this.fileRangeTrees.delete(uriStr);
        this.fileMetadata.delete(uriStr);
        this.fileStatuses.delete(uriStr);
        this.cleanParseFiles.delete(uriStr);

        for (const symbol of oldSymbols) {
            if (symbol.kind === vscode.SymbolKind.Class || symbol.kind === vscode.SymbolKind.Module) {
                this.typeInfo.delete(symbol.name);
            }
        }
    }

    private async purgeMissingWorkspaceFiles(currentFiles: Set<string>): Promise<void> {
        const workspaceRoot = this.workspaceRoot;
        if (!workspaceRoot) {
            return;
        }

        for (const uriStr of Array.from(this.fileMetadata.keys())) {
            const uri = vscode.Uri.parse(uriStr);
            if (uri.scheme !== 'file') {
                continue;
            }

            if (!uri.fsPath.startsWith(workspaceRoot) || currentFiles.has(uriStr)) {
                continue;
            }

            try {
                await vscode.workspace.fs.stat(uri);
                continue;
            } catch {
                // The file no longer exists, remove stale symbols below.
            }

            this.removeIndexedFile(uri, 'deleted');
            this.removeSemanticFile(uri);
            this.updateDiagnosticsForFile(uri, 'deleted');
        }
    }

    private isPersistedFileUriString(uriStr: string): boolean {
        return this.isFileUriString(uriStr) && this.fileMetadata.has(uriStr);
    }

    private isFileUriString(uriStr: string): boolean {
        try {
            return vscode.Uri.parse(uriStr).scheme === 'file';
        } catch {
            return false;
        }
    }

    private toIndexFileStatus(status: RubySymbolExtractionStatus): IndexFileStatus {
        switch (status) {
            case 'fallback':
                return 'fallback';
            case 'parse_error':
                return 'parse_error';
            default:
                return 'ok';
        }
    }

    private async updateSemanticIndex(
        document: vscode.TextDocument,
        symbols: RubySymbol[],
        status: IndexFileStatus,
        error?: string
    ): Promise<void> {
        const uriStr = document.uri.toString();
        this.removeSemanticFile(document.uri);
        this.smartSearch.indexSymbols(uriStr, symbols);

        if (status === 'parse_error') {
            this.outputChannel.appendLine(`Skipping semantic index for ${uriStr}: ${error ?? 'parse error'}`);
            return;
        }

        try {
            const parsed = await this.parserService.parseRuby(document);
            this.extractSemanticGraph(document, parsed.value);
            await this.referenceTracker.trackReferencesInDocument(document, parsed.value);
        } catch (semanticError) {
            this.outputChannel.appendLine(`Semantic index skipped for ${uriStr}: ${semanticError}`);
        }
    }

    private removeSemanticFile(uri: vscode.Uri): void {
        this.semanticGraph.removeFile(uri);
        this.smartSearch.indexSymbols(uri.toString(), []);
    }

    private extractSemanticGraph(document: vscode.TextDocument, ast: ASTNode[]): void {
        const filePath = document.uri.fsPath.replace(/\\/g, '/');
        const isModel = filePath.includes('/app/models/');
        const isController = filePath.includes('/app/controllers/');

        const visit = (node: ASTNode): void => {
            if (node.type === NodeType.Class) {
                const classNode = node as ClassNode;
                const classInfo: ClassInfo = {
                    name: classNode.name,
                    fullyQualifiedName: classNode.name,
                    location: new vscode.Location(document.uri, classNode.range),
                    superclass: classNode.superclass,
                    mixins: classNode.mixins,
                    subclasses: [],
                    methods: [],
                    constants: new Map(),
                    instanceVariables: [],
                    classVariables: [],
                    isRailsModel: isModel,
                    isRailsController: isController,
                    namespace: classNode.metadata.get('containerName')
                };

                this.semanticGraph.addClass(classInfo);

                for (const method of classNode.methods) {
                    this.addSemanticMethod(document.uri, classNode.name, method);
                }

                for (const child of classNode.children) {
                    if (child.type === NodeType.Association) {
                        this.addSemanticAssociation(document.uri, classNode.name, child);
                    }
                    visit(child);
                }
                return;
            }

            if (node.type === NodeType.Module) {
                this.semanticGraph.addModule({
                    name: node.name,
                    fullyQualifiedName: node.name,
                    location: new vscode.Location(document.uri, node.range),
                    methods: [],
                    includedIn: [],
                    extendedIn: []
                });
            }

            if (node.type === NodeType.Method) {
                const containerName = node.metadata.get('containerName') as string | undefined;
                this.addSemanticMethod(document.uri, containerName, node as MethodNode);
            }

            for (const child of node.children) {
                visit(child);
            }
        };

        for (const node of ast) {
            visit(node);
        }
    }

    private addSemanticMethod(
        uri: vscode.Uri,
        containerName: string | undefined,
        methodNode: MethodNode
    ): void {
        const className = containerName ?? methodNode.metadata.get('containerName') as string | undefined;
        const methodId = className
            ? methodNode.isClassMethod ? `${className}.${methodNode.name}` : `${className}#${methodNode.name}`
            : methodNode.name;

        const methodInfo: MethodInfo = {
            id: methodId,
            name: methodNode.name,
            className,
            location: new vscode.Location(uri, methodNode.range),
            parameters: methodNode.parameters,
            visibility: methodNode.visibility,
            isClassMethod: methodNode.isClassMethod,
            returnType: methodNode.returns.length > 0 ? methodNode.returns[0].type : undefined,
            calls: [],
            calledBy: [],
            usageCount: 0
        };

        this.semanticGraph.addMethod(methodInfo);

        for (const call of methodNode.calls) {
            const calleeId = call.receiver
                ? `${call.receiver}#${call.method}`
                : className ? `${className}#${call.method}` : call.method;

            this.semanticGraph.addMethodCall({
                caller: methodId,
                callee: calleeId,
                location: new vscode.Location(
                    uri,
                    new vscode.Range(call.location, call.location.translate(0, call.method.length))
                ),
                confidence: call.receiver ? 0.65 : 0.8,
                receiverType: call.receiver
            });
        }
    }

    private addSemanticAssociation(uri: vscode.Uri, className: string, node: ASTNode): void {
        const associationType = node.metadata.get('associationType') as string | undefined;
        if (!associationType) {
            return;
        }

        let targetModel = node.name;
        if (associationType === 'has_many' || associationType === 'has_and_belongs_to_many') {
            targetModel = singularize(targetModel);
        }
        targetModel = camelize(targetModel);

        this.semanticGraph.addAssociation({
            sourceModel: className,
            targetModel,
            type: associationType as AssociationType,
            name: node.name,
            location: new vscode.Location(uri, node.range),
            options: new Map()
        } as Association);
    }

    getDocumentSymbols(uri: vscode.Uri): RubySymbol[] {
        return this.getFileSymbols(uri);
    }

    findWorkspaceSymbols(query: string): RubySymbol[] {
        return this.findSymbols(query);
    }

    async findDefinitions(
        name: string,
        context?: {
            document?: vscode.TextDocument;
            position?: vscode.Position;
            receiver?: string;
            containingClass?: string;
        }
    ): Promise<DefinitionResult[]> {
        // Receiver-aware fast path: resolve the method against the receiver's
        // type chain (superclass + mixins) so gem-defined methods win over an
        // unrelated project method that merely shares the name.
        if (context?.document && context?.position) {
            const receiverType = this.resolveReceiverType({
                receiver: context.receiver,
                containingClass: context.containingClass,
                document: context.document,
                position: context.position
            });
            if (receiverType) {
                const scoped = this.findMethodInTypeChain(name, receiverType);
                if (scoped.length > 0) {
                    return scoped;
                }
            }
        }

        const qualifiedSymbols = name.includes('::')
            ? [
                this.findSymbolByFullyQualifiedName(name, vscode.SymbolKind.Class),
                this.findSymbolByFullyQualifiedName(name, vscode.SymbolKind.Module),
                this.findSymbolByFullyQualifiedName(name, vscode.SymbolKind.Method),
                this.findSymbolByFullyQualifiedName(name, vscode.SymbolKind.Function),
                this.findSymbolByFullyQualifiedName(name, vscode.SymbolKind.Property),
                this.findSymbolByFullyQualifiedName(name, vscode.SymbolKind.Constant)
            ].filter((symbol): symbol is RubySymbol => symbol !== undefined)
            : [];

        const directSymbols = [
            ...qualifiedSymbols,
            ...this.findSymbols(name, vscode.SymbolKind.Class),
            ...this.findSymbols(name, vscode.SymbolKind.Module),
            ...this.findSymbols(name, vscode.SymbolKind.Method),
            ...this.findSymbols(name, vscode.SymbolKind.Function),
            ...this.findSymbols(name, vscode.SymbolKind.Property),
            ...this.findSymbols(name, vscode.SymbolKind.Constant)
        ];
        const symbolResults = directSymbols.map(symbol => this.definitionResultFromSymbol(symbol, name));
        // Prefer exact-name matches; only fall back to fuzzy/prefix matches when
        // no exact match exists, so a gem call never resolves to an unrelated
        // project method that merely shares a prefix.
        const exactSymbolResults = symbolResults.filter(result => result.exact);
        const results = exactSymbolResults.length > 0 ? exactSymbolResults : symbolResults;

        if (context?.document && context.position) {
            const railsResult = await this.findRailsConventionDefinition(name, context.document, context.position);
            if (railsResult) {
                results.push({
                    location: railsResult,
                    confidence: 'rails_convention',
                    exact: true,
                    source: 'rails'
                });
            }
        }

        return this.dedupeDefinitionResults(results).sort((a, b) => this.compareDefinitionResults(a, b, context?.document?.uri));
    }

    /**
     * Resolve the class name of a method-call receiver.
     * - No receiver / `self` -> the enclosing class (implicit self).
     * - Constant receiver (`User`, `Foo::Bar`) -> the class itself.
     * - Variable / expression -> inferred via the type inference engine.
     */
    private resolveReceiverType(context: {
        receiver?: string;
        containingClass?: string;
        document: vscode.TextDocument;
        position: vscode.Position;
    }): string | undefined {
        const receiver = context.receiver?.trim();

        if (!receiver || receiver === 'self') {
            return context.containingClass;
        }

        if (/^[A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*$/.test(receiver)) {
            // Return the fully qualified name. The semantic graph keys classes
            // by FQN, so stripping the namespace (`ActiveRecord::Base` -> `Base`)
            // both misses namespaced classes entirely and risks resolving to an
            // unrelated top-level class that merely shares the last segment.
            return receiver;
        }

        const inferred = this.typeInference.inferType(receiver, {
            document: context.document,
            position: context.position,
            containingClass: context.containingClass
        });

        return inferred ? inferred.type : undefined;
    }

    /**
     * Find a method by name within a class's method resolution order
     * (the class plus its superclasses and included modules, which is where
     * gem-defined methods live).
     */
    private findMethodInTypeChain(methodName: string, className: string): DefinitionResult[] {
        const matches = this.semanticGraph
            .getAllAvailableMethods(className)
            .filter(method => method.name === methodName);

        return this.dedupeDefinitionResults(
            matches.map(method => ({
                location: method.location,
                confidence: 'exact_ast' as DefinitionConfidence,
                exact: true,
                source: 'ast' as DefinitionResult['source']
            }))
        );
    }

    private definitionResultFromSymbol(symbol: RubySymbol, query: string): DefinitionResult {
        const fullyQualifiedName = symbol.containerName ? `${symbol.containerName}::${symbol.name}` : symbol.name;
        const exact = symbol.name === query || fullyQualifiedName === query;
        const confidence = symbol.definitionConfidence ?? (symbol.name === query ? 'exact_ast' : 'fuzzy');
        const effectiveConfidence = exact ? confidence : 'fuzzy';
        return {
            location: symbol.location,
            confidence: effectiveConfidence,
            exact,
            source: this.definitionSource(effectiveConfidence)
        };
    }

    private definitionSource(confidence: DefinitionConfidence): DefinitionResult['source'] {
        switch (confidence) {
            case 'exact_ast':
                return 'ast';
            case 'rails_convention':
                return 'rails';
            case 'metaprogramming':
                return 'metaprogramming';
            case 'fallback':
                return 'fallback';
            default:
                return 'fuzzy';
        }
    }

    private compareDefinitionResults(
        a: DefinitionResult,
        b: DefinitionResult,
        currentUri?: vscode.Uri
    ): number {
        const confidenceDelta = definitionConfidenceRank(a.confidence) - definitionConfidenceRank(b.confidence);
        if (confidenceDelta !== 0) {
            return confidenceDelta;
        }

        const exactDelta = Number(!a.exact) - Number(!b.exact);
        if (exactDelta !== 0) {
            return exactDelta;
        }

        const localityDelta = this.workspaceLocalityRank(a.location.uri, currentUri) - this.workspaceLocalityRank(b.location.uri, currentUri);
        if (localityDelta !== 0) {
            return localityDelta;
        }

        const aMetadata = this.fileMetadata.get(a.location.uri.toString());
        const bMetadata = this.fileMetadata.get(b.location.uri.toString());
        return (bMetadata?.lastIndexed ?? 0) - (aMetadata?.lastIndexed ?? 0);
    }

    private workspaceLocalityRank(uri: vscode.Uri, currentUri?: vscode.Uri): number {
        if (currentUri && uri.toString() === currentUri.toString()) {
            return 0;
        }

        const workspace = currentUri
            ? vscode.workspace.getWorkspaceFolder(currentUri)
            : vscode.workspace.workspaceFolders?.[0];
        if (workspace && uri.scheme === 'file' && uri.fsPath.startsWith(workspace.uri.fsPath)) {
            return 1;
        }

        return 2;
    }

    private dedupeDefinitionResults(results: DefinitionResult[]): DefinitionResult[] {
        const seen = new Set<string>();
        return results.filter(result => {
            const key = [
                result.location.uri.toString(),
                result.location.range.start.line,
                result.location.range.start.character,
                result.location.range.end.line,
                result.location.range.end.character
            ].join(':');

            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
    }

    async findReferenceResults(
        document: vscode.TextDocument,
        word: string,
        includeDeclaration: boolean
    ): Promise<ReferenceResult[]> {
        const parserReferences = await this.parserService.findReferenceLocations(document, word, includeDeclaration);
        const indexedReferences = this.referenceTracker.findReferences(word, includeDeclaration).references
            .map(reference => reference.location);

        return this.dedupeLocations([...parserReferences, ...indexedReferences])
            .map(location => ({
                location,
                confidence: this.referenceConfidence(location)
            }));
    }

    findReferences(symbolName: string, includeDefinition: boolean = true): ReferenceInfo {
        return this.referenceTracker.findReferences(symbolName, includeDefinition);
    }

    getCallHierarchy(className: string, methodName: string): Array<{
        caller: string;
        callee: string;
        location: vscode.Location;
        confidence: number;
    }> {
        const methodId = `${className}#${methodName}`;
        return this.semanticGraph.getCallHierarchy(methodId).map(edge => ({
            caller: edge.caller,
            callee: edge.callee,
            location: edge.location,
            confidence: edge.confidence
        }));
    }

    getTypeHierarchy(className: string): string[] {
        return this.semanticGraph.getInheritanceChain(className);
    }

    getAllSubclasses(className: string): string[] {
        return this.semanticGraph.getAllSubclasses(className);
    }

    detectDeadCode(): DeadCodeAnalysis {
        return this.referenceTracker.detectDeadCode();
    }

    async getRailsComponents(modelName: string): Promise<RailsComponent> {
        return this.railsIntelligence.getRelatedComponents(modelName);
    }

    async findViewForAction(controllerName: string, action: string): Promise<vscode.Location | undefined> {
        return this.railsIntelligence.findViewForAction(controllerName, action);
    }

    getRouteInfo(controllerName: string, action: string): RouteInfo | undefined {
        return this.railsIntelligence.getRouteInfo(controllerName, action);
    }

    search(query: string, context?: Partial<SearchContext>): SearchResult[] {
        return this.smartSearch.search(query, {
            query,
            currentFile: context?.currentFile,
            currentClass: context?.currentClass,
            currentMethod: context?.currentMethod,
            fileType: context?.fileType,
            searchType: context?.searchType
        });
    }

    getIndexStatus(): CoreRubyIndexStatus {
        const lifecycle = this.getIndexLifecycleSnapshot();
        return {
            parserEngine: this.parserService.getEnginePreference(),
            indexedFiles: this.symbols.size,
            degradedFiles: lifecycle.degradedFiles,
            failedFiles: lifecycle.failedFiles,
            cacheVersion: `${INDEX_SCHEMA_VERSION};${this.parserService.getCacheVersion()}`,
            lastIndexDuration: this.lastIndexDuration,
            lifecycle
        };
    }

    private referenceConfidence(location: vscode.Location): DefinitionConfidence {
        const symbols = this.getFileSymbols(location.uri);
        const containing = symbols.find(symbol => symbol.location.range.contains(location.range.start));
        return containing?.definitionConfidence ?? 'exact_ast';
    }

    private dedupeLocations(locations: vscode.Location[]): vscode.Location[] {
        const seen = new Set<string>();
        return locations.filter(location => {
            const key = [
                location.uri.toString(),
                location.range.start.line,
                location.range.start.character,
                location.range.end.line,
                location.range.end.character
            ].join(':');

            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
    }

    private updateDiagnosticsForFile(
        uri: vscode.Uri,
        status: IndexFileStatus,
        parserEngine?: 'tree-sitter' | 'legacy',
        error?: string
    ): void {
        if (status === 'ok') {
            this.diagnostics.delete(uri);
            return;
        }

        const range = new vscode.Range(0, 0, 0, 1);
        const severity = status === 'parse_error'
            ? vscode.DiagnosticSeverity.Error
            : status === 'deleted'
                ? vscode.DiagnosticSeverity.Information
                : vscode.DiagnosticSeverity.Warning;
        const message = this.diagnosticMessage(status, parserEngine, error);
        const diagnostic = new vscode.Diagnostic(range, message, severity);
        diagnostic.source = 'rubymate-core';
        diagnostic.code = status;
        this.diagnostics.set(uri, [diagnostic]);
    }

    private diagnosticMessage(
        status: IndexFileStatus,
        parserEngine?: 'tree-sitter' | 'legacy',
        error?: string
    ): string {
        switch (status) {
            case 'fallback':
                return `RubyMate parser fallback used${parserEngine ? ` (${parserEngine})` : ''}. Navigation may be lower confidence.`;
            case 'parse_error':
                return `RubyMate could not parse this file${error ? `: ${error}` : ''}.`;
            case 'stale':
                return `RubyMate index entry is stale${error ? `: ${error}` : ''}.`;
            case 'deleted':
                return 'File removed from the RubyMate index.';
            default:
                return 'RubyMate index is degraded for this file.';
        }
    }

    private recordVirtualWorkspaceDiagnostics(): void {
        const virtualFolder = vscode.workspace.workspaceFolders?.find(folder => folder.uri.scheme !== 'file');
        if (!virtualFolder) {
            return;
        }

        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 1),
            'RubyMate requires a real workspace file system for indexing and Ruby tool execution.',
            vscode.DiagnosticSeverity.Warning
        );
        diagnostic.source = 'rubymate-core';
        diagnostic.code = 'unsupported_virtual_workspace';
        this.diagnostics.set(virtualFolder.uri, [diagnostic]);
    }

    private async findRailsConventionDefinition(
        word: string,
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Location | undefined> {
        const lineText = document.lineAt(position.line).text;
        const escapedWord = escapeRegExp(word);

        const associationMatch = lineText.match(new RegExp(`\\b(has_many|has_one|belongs_to|has_and_belongs_to_many)\\s+:${escapedWord}\\b`));
        if (associationMatch) {
            const targetModelName = camelize(
                associationMatch[1] === 'has_many' || associationMatch[1] === 'has_and_belongs_to_many'
                    ? singularize(word)
                    : word
            );
            const target = this.findSymbols(targetModelName, vscode.SymbolKind.Class).find(symbol => symbol.name === targetModelName);
            if (target) {
                return target.location;
            }

            return this.findRailsFile(document.uri, ['app', 'models', `${underscore(targetModelName)}.rb`]);
        }

        const renderMatch = lineText.match(new RegExp(`\\brender\\s+(?::${escapedWord}|["']${escapedWord}["'])`));
        if (renderMatch) {
            return this.findViewForControllerAction(document.uri, word);
        }

        const methodDefinitionMatch = lineText.match(new RegExp(`^\\s*def\\s+${escapedWord}\\b`));
        if (methodDefinitionMatch && this.isRailsControllerFile(document.uri)) {
            return this.findViewForControllerAction(document.uri, word);
        }

        if (/^[A-Z]/.test(word)) {
            const concern = await this.findRailsFile(document.uri, ['app', 'models', 'concerns', `${underscore(word)}.rb`])
                ?? await this.findRailsFile(document.uri, ['app', 'controllers', 'concerns', `${underscore(word)}.rb`]);
            if (concern) {
                return concern;
            }
        }

        const railsClassFile = this.railsClassFilePath(word);
        return railsClassFile ? this.findRailsFile(document.uri, railsClassFile) : undefined;
    }

    private async findRailsFile(currentFileUri: vscode.Uri, relativePath: string[]): Promise<vscode.Location | undefined> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(currentFileUri) ?? vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return undefined;
        }

        const targetUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, ...relativePath));
        try {
            await vscode.workspace.fs.stat(targetUri);
            return new vscode.Location(targetUri, new vscode.Position(0, 0));
        } catch {
            return undefined;
        }
    }

    private async findViewForControllerAction(
        controllerUri: vscode.Uri,
        actionName: string
    ): Promise<vscode.Location | undefined> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(controllerUri) ?? vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return undefined;
        }

        const relativeController = this.relativeControllerPath(workspaceFolder, controllerUri);
        if (!relativeController) {
            return undefined;
        }

        const viewFolder = relativeController
            .replace(/\\/g, '/')
            .replace(/_controller\.rb$/, '')
            .replace(/\.rb$/, '');
        const viewPattern = new vscode.RelativePattern(
            workspaceFolder,
            `app/views/${viewFolder}/${actionName}.{html.erb,html.haml,html.slim,erb,haml,slim}`
        );
        const matches = await vscode.workspace.findFiles(viewPattern, '**/node_modules/**', 1);
        return matches.length > 0 ? new vscode.Location(matches[0], new vscode.Position(0, 0)) : undefined;
    }

    private railsClassFilePath(className: string): string[] | undefined {
        const fileName = `${underscore(className)}.rb`;
        if (className.endsWith('Controller')) {
            return ['app', 'controllers', fileName];
        }
        if (className.endsWith('Helper')) {
            return ['app', 'helpers', fileName];
        }
        if (className.endsWith('Job')) {
            return ['app', 'jobs', fileName];
        }
        if (className.endsWith('Mailer')) {
            return ['app', 'mailers', fileName];
        }

        return undefined;
    }

    private isRailsControllerFile(uri: vscode.Uri): boolean {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
        return workspaceFolder ? this.relativeControllerPath(workspaceFolder, uri) !== undefined : false;
    }

    private relativeControllerPath(
        workspaceFolder: vscode.WorkspaceFolder,
        uri: vscode.Uri
    ): string | undefined {
        const relativeController = path.relative(
            path.join(workspaceFolder.uri.fsPath, 'app', 'controllers'),
            uri.fsPath
        );

        if (!relativeController || relativeController.startsWith('..') || path.isAbsolute(relativeController)) {
            return undefined;
        }

        return relativeController;
    }

    private setLifecycleState(state: IndexLifecycleState, message?: string): void {
        this.lifecycleState = state;
        this.lifecycleMessage = message;
        this.statusEmitter.fire(this.getIndexLifecycleSnapshot());
    }

    private refreshLifecycleState(): void {
        if (this.indexing) {
            this.setLifecycleState('indexing', this.lifecycleMessage ?? 'Indexing workspace...');
            return;
        }

        if (this.lastIndexError) {
            this.setLifecycleState('failed', this.lastIndexError);
            return;
        }

        const statuses = Array.from(this.fileStatuses.values());
        const degraded = statuses.some(status => status === 'fallback' || status === 'parse_error' || status === 'stale');
        this.setLifecycleState(degraded ? 'degraded' : 'ready', degraded ? 'Parser/index degraded' : undefined);
    }

    /**
     * Extract type information for better IntelliSense
     */
    private async extractTypeInfo(document: vscode.TextDocument, symbols: RubySymbol[]): Promise<void> {
        const classes = symbols.filter(s => s.kind === vscode.SymbolKind.Class);

        for (const classSymbol of classes) {
            const typeInfo: TypeInfo = {
                name: classSymbol.name,
                methods: new Map(),
                mixins: []
            };

            // Find superclass from detail
            const superclassMatch = classSymbol.detail?.match(/extends\s+([A-Z][A-Za-z0-9_:]*)/);
            if (superclassMatch) {
                typeInfo.superclass = superclassMatch[1];
            }

            // Find methods belonging to this class
            const methods = symbols.filter(
                s => s.kind === vscode.SymbolKind.Method && s.containerName === classSymbol.name
            );

            for (const method of methods) {
                typeInfo.methods.set(method.name, {
                    name: method.name,
                    parameters: (method.parameters || []).map(name => ({ name })),
                    visibility: 'public' // Default, could be enhanced
                });
            }

            this.typeInfo.set(classSymbol.name, typeInfo);
        }
    }

    /**
     * Find symbols with fuzzy matching and scoring
     * Performance: Uses SymbolIndex for O(1) exact match and O(k) prefix search
     */
    findSymbols(query: string, kind?: vscode.SymbolKind): RubySymbol[] {
        // Performance: Quick negative check using bloom filter
        if (!this.symbolIndex.mightHaveName(query) && !this.symbolIndex.mightHaveName(query.toLowerCase())) {
            // Try prefix search instead
            const prefixResults = this.symbolIndex.findByPrefix(query, 100);
            if (prefixResults.length === 0) {
                return [];
            }
            // Convert IndexedSymbol to RubySymbol and filter by kind
            return this.convertAndFilter(prefixResults, kind, query);
        }

        // Performance: Use optimized index for fast lookups
        let indexedResults = this.symbolIndex.findByNameIgnoreCase(query);

        // If exact match found, use it; otherwise try prefix
        if (indexedResults.length === 0) {
            indexedResults = this.symbolIndex.findByPrefix(query, 100);
        }

        return this.convertAndFilter(indexedResults, kind, query);
    }

    /**
     * Convert IndexedSymbols to RubySymbols and filter by kind
     */
    private convertAndFilter(indexedResults: IndexedSymbol[], kind: vscode.SymbolKind | undefined, query: string): RubySymbol[] {
        const results: RubySymbol[] = [];

        for (const indexed of indexedResults) {
            if (kind && indexed.kind !== kind) {
                continue;
            }

            // Try to find the original RubySymbol with full details
            const fileSymbols = this.symbols.get(indexed.location.uri.toString());
            if (fileSymbols) {
                const original = fileSymbols.find(s =>
                    s.name === indexed.name &&
                    s.location.range.start.line === indexed.location.range.start.line
                );
                if (original) {
                    results.push(original);
                    continue;
                }
            }

            // Fallback: create RubySymbol from IndexedSymbol
            results.push({
                name: indexed.name,
                kind: indexed.kind,
                location: indexed.location,
                containerName: indexed.containerName,
                detail: indexed.detail,
                definitionConfidence: indexed.definitionConfidence
            });
        }

        // Sort by match score
        return results.sort((a, b) => {
            const confidenceDelta = definitionConfidenceRank(a.definitionConfidence) - definitionConfidenceRank(b.definitionConfidence);
            if (confidenceDelta !== 0) {
                return confidenceDelta;
            }

            const aScore = this.matchScore(a.name, query);
            const bScore = this.matchScore(b.name, query);
            return bScore - aScore;
        });
    }

    /**
     * Find classes with fuzzy matching (Ctrl+N)
     */
    findClasses(query: string): RubySymbol[] {
        return this.findSymbols(query, vscode.SymbolKind.Class);
    }

    findSymbolByFullyQualifiedName(fqn: string, kind?: vscode.SymbolKind): RubySymbol | undefined {
        const indexed = this.symbolIndex.findByFQN(fqn);
        if (!indexed || (kind !== undefined && indexed.kind !== kind)) {
            return undefined;
        }

        return this.convertAndFilter([indexed], kind, fqn)[0];
    }

    /**
     * Find methods in a class
     */
    findMethodsInClass(className: string): RubySymbol[] {
        const results: RubySymbol[] = [];

        for (const symbols of this.symbols.values()) {
            for (const symbol of symbols) {
                if (symbol.kind === vscode.SymbolKind.Method &&
                    symbol.containerName === className) {
                    results.push(symbol);
                }
            }
        }

        return results;
    }

    /**
     * Get type information for IntelliSense
     */
    getTypeInfo(className: string): TypeInfo | undefined {
        return this.typeInfo.get(className);
    }

    /**
     * Get file symbols
     */
    getFileSymbols(uri: vscode.Uri): RubySymbol[] {
        return this.symbols.get(uri.toString()) || [];
    }

    /**
     * Find symbol at a specific position using RangeTree
     * Performance: O(log n) lookup instead of O(n) iteration
     */
    findSymbolAtPosition(uri: vscode.Uri, position: vscode.Position): RubySymbol | undefined {
        const rangeTree = this.fileRangeTrees.get(uri.toString());
        if (!rangeTree) {
            // Fallback to linear search
            const symbols = this.getFileSymbols(uri);
            return symbols.find(s => s.location.range.contains(position));
        }

        // Performance: Use RangeTree for O(log n) lookup
        const result = rangeTree.searchSmallestAtPosition({
            line: position.line,
            column: position.character
        });

        return result;
    }

    /**
     * Find all symbols containing a position (e.g., method inside a class)
     * Performance: Uses RangeTree for efficient range queries
     */
    findSymbolsContainingPosition(uri: vscode.Uri, position: vscode.Position): RubySymbol[] {
        const rangeTree = this.fileRangeTrees.get(uri.toString());
        if (!rangeTree) {
            // Fallback to linear search
            const symbols = this.getFileSymbols(uri);
            return symbols.filter(s => s.location.range.contains(position));
        }

        // Performance: Use RangeTree for efficient lookup
        return rangeTree.searchAtPosition({
            line: position.line,
            column: position.character
        });
    }

    // ------------------------------------------------------------------
    // Completion support
    //
    // Thin public surface over the receiver-aware type resolution and
    // method-resolution machinery that already backs go-to-definition, so
    // the completion provider can reuse it without duplicating logic.
    // ------------------------------------------------------------------

    /**
     * Resolve the class name of a receiver expression at a position.
     *
     * - No receiver / `self` -> the enclosing class (implicit self).
     * - Constant receiver (`User`, `Foo::Bar`) -> the class itself.
     * - Variable / expression -> inferred via the type inference engine.
     *
     * Public wrapper over {@link resolveReceiverType}; backs member (`.`/`&.`)
     * completion.
     */
    resolveReceiverTypeAt(
        document: vscode.TextDocument,
        position: vscode.Position,
        receiver: string | undefined,
        containingClass: string | undefined
    ): string | undefined {
        return this.resolveReceiverType({ receiver, containingClass, document, position });
    }

    /**
     * Every method reachable on a type through its full method resolution
     * order (the class plus its superclasses and included modules, which is
     * where inherited and mixin-provided methods live). Backs member
     * completion and carries visibility, parameters, and usage counts for
     * later ranking.
     */
    getAvailableMethodsForType(typeName: string): MethodInfo[] {
        return this.semanticGraph.getAllAvailableMethods(typeName);
    }

    /**
     * Prefix search over the workspace symbol index (Trie-backed).
     * Backs bareword, method, and constant completion.
     */
    findSymbolsByPrefix(prefix: string, limit?: number): IndexedSymbol[] {
        return this.symbolIndex.findByPrefix(prefix, limit);
    }

    /**
     * Name of the innermost class or module enclosing a position, used as the
     * implicit-`self` receiver type for bareword and no-receiver completion.
     */
    getEnclosingTypeName(uri: vscode.Uri, position: vscode.Position): string | undefined {
        const containers = this.findSymbolsContainingPosition(uri, position)
            .filter(symbol =>
                symbol.kind === vscode.SymbolKind.Class ||
                symbol.kind === vscode.SymbolKind.Module);

        if (containers.length === 0) {
            return undefined;
        }

        // The innermost container is the one whose definition starts latest.
        return containers.reduce((best, symbol) =>
            !best || symbol.location.range.start.isAfter(best.location.range.start)
                ? symbol
                : best
        ).name;
    }

    /**
     * The semantic graph that backs method resolution. Exposed so the completion
     * candidate sources can walk a type's MRO and read call-graph usage counts
     * directly, and so the bundled knowledge base can be loaded into it.
     */
    getSemanticGraph(): SemanticGraphBuilder {
        return this.semanticGraph;
    }

    /**
     * The type-inference engine, for resolving a completion receiver expression
     * (`user.`, `order.line_items.`) to the type whose members should be offered.
     */
    getTypeInferenceEngine(): TypeInferenceEngine {
        return this.typeInference;
    }

    /**
     * Get indexing statistics
     */
    getStats(): IndexStats {
        const totalSymbols = Array.from(this.symbols.values())
            .reduce((sum, arr) => sum + arr.length, 0);

        return {
            totalFiles: this.fileMetadata.size,
            indexedFiles: this.symbols.size,
            totalSymbols,
            gemFiles: Array.from(this.symbols.keys()).filter(uri =>
                Array.from(this.gemPaths).some(gemPath => uri.includes(gemPath))
            ).length,
            lastIndexTime: Date.now(),
            lastIndexDuration: this.lastIndexDuration
        };
    }

    /**
     * Fuzzy matching algorithm
     */
    private fuzzyMatch(text: string, query: string): boolean {
        const textLower = text.toLowerCase();
        const queryLower = query.toLowerCase();

        if (textLower.includes(queryLower)) {
            return true;
        }

        let textIndex = 0;
        for (let i = 0; i < queryLower.length; i++) {
            const char = queryLower[i];
            textIndex = textLower.indexOf(char, textIndex);
            if (textIndex === -1) {
                return false;
            }
            textIndex++;
        }

        return true;
    }

    /**
     * Match scoring algorithm with fuzzy matching
     */
    private matchScore(text: string, query: string): number {
        const textLower = text.toLowerCase();
        const queryLower = query.toLowerCase();
        let score = 0;

        // Exact match
        if (text === query) return 10000;
        if (textLower === queryLower) return 9000;

        // Starts with
        if (textLower.startsWith(queryLower)) return 8000;

        // Contains as word
        if (textLower.includes(queryLower)) return 7000;

        // CamelCase matching (e.g., "UC" matches "UserController")
        if (this.camelCaseMatch(text, query)) {
            score += 5000;
        }

        // Fuzzy score
        let lastIndex = -1;
        let consecutiveMatches = 0;
        for (let i = 0; i < queryLower.length; i++) {
            const char = queryLower[i];
            const index = textLower.indexOf(char, lastIndex + 1);
            if (index === -1) return 0;

            if (index === lastIndex + 1) {
                consecutiveMatches++;
                score += 10 * consecutiveMatches;
            } else {
                consecutiveMatches = 0;
            }

            if (index === 0 || text[index - 1] === '_' || /[A-Z]/.test(text[index])) {
                score += 20;
            }

            score += 1;
            lastIndex = index;
        }

        return score;
    }

    /**
     * CamelCase matching (UC -> UserController)
     */
    private camelCaseMatch(text: string, query: string): boolean {
        const capitals = text.replace(/[^A-Z]/g, '');
        return capitals.toLowerCase().includes(query.toLowerCase());
    }

    /**
     * Serialize symbols for caching
     */
    private serializeSymbols(symbols: RubySymbol[]): any[] {
        return symbols.map(s => ({
            ...s,
            location: {
                uri: s.location.uri.toString(),
                range: {
                    start: { line: s.location.range.start.line, character: s.location.range.start.character },
                    end: { line: s.location.range.end.line, character: s.location.range.end.character }
                }
            }
        }));
    }

    /**
     * Deserialize symbols from cache
     */
    private deserializeSymbols(data: any[]): RubySymbol[] {
        return data.map(s => ({
            ...s,
            location: new vscode.Location(
                vscode.Uri.parse(s.location.uri),
                new vscode.Range(
                    new vscode.Position(s.location.range.start.line, s.location.range.start.character),
                    new vscode.Position(s.location.range.end.line, s.location.range.end.character)
                )
            )
        }));
    }

    dispose(): void {
        this.saveCache().catch(() => {});
        this.symbols.clear();
        this.typeInfo.clear();
        this.usages.clear();
        this.fileMetadata.clear();
        this.fileStatuses.clear();
        this.cleanParseFiles.clear();
        // Performance: Clear optimized indexes
        this.symbolIndex.clear();
        this.fileRangeTrees.clear();
        this.statusEmitter.dispose();
        this.diagnostics.dispose();
    }
}

export { CoreRubyIndex as AdvancedRubyIndexer };

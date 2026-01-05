import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';

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
}

interface IndexStats {
    totalFiles: number;
    indexedFiles: number;
    totalSymbols: number;
    gemFiles: number;
    lastIndexTime: number;
}

export class AdvancedRubyIndexer {
    private symbols: Map<string, RubySymbol[]> = new Map();
    private typeInfo: Map<string, TypeInfo> = new Map();
    private usages: Map<string, vscode.Location[]> = new Map();
    private fileMetadata: Map<string, FileMetadata> = new Map();
    private gemPaths: Set<string> = new Set();

    private indexing: boolean = false;
    private indexQueue: vscode.Uri[] = [];
    private outputChannel: vscode.OutputChannel;
    private context: vscode.ExtensionContext;

    // Cache paths
    private get cacheDir(): string {
        return path.join(this.context.globalStorageUri.fsPath, 'index-cache');
    }

    private get symbolsCachePath(): string {
        return path.join(this.cacheDir, 'symbols.json');
    }

    private get metadataCachePath(): string {
        return path.join(this.cacheDir, 'metadata.json');
    }

    constructor(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
        this.context = context;
        this.outputChannel = outputChannel;
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
    }

    /**
     * Load index from disk cache for instant startup
     */
    private async loadCache(): Promise<void> {
        try {
            const symbolsData = await fs.readFile(this.symbolsCachePath, 'utf-8');
            const metadataData = await fs.readFile(this.metadataCachePath, 'utf-8');

            const cachedSymbols = JSON.parse(symbolsData);
            const cachedMetadata = JSON.parse(metadataData);

            // Reconstruct symbols map
            for (const [uri, symbols] of Object.entries(cachedSymbols)) {
                this.symbols.set(uri, this.deserializeSymbols(symbols as any[]));
            }

            // Reconstruct metadata
            for (const [uri, metadata] of Object.entries(cachedMetadata)) {
                this.fileMetadata.set(uri, metadata as FileMetadata);
            }

            const totalSymbols = Array.from(this.symbols.values())
                .reduce((sum, arr) => sum + arr.length, 0);

            this.outputChannel.appendLine(`Loaded ${totalSymbols} symbols from cache`);
        } catch (error) {
            this.outputChannel.appendLine('No cache found, will perform full indexing');
        }
    }

    /**
     * Save index to disk cache for next startup
     */
    private async saveCache(): Promise<void> {
        try {
            const symbolsData = Object.fromEntries(
                Array.from(this.symbols.entries()).map(([uri, symbols]) => [
                    uri,
                    this.serializeSymbols(symbols)
                ])
            );

            const metadataData = Object.fromEntries(this.fileMetadata);

            await fs.writeFile(this.symbolsCachePath, JSON.stringify(symbolsData), 'utf-8');
            await fs.writeFile(this.metadataCachePath, JSON.stringify(metadataData), 'utf-8');

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

            // Run bundle show --paths to get gem paths
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);

            const { stdout } = await execAsync('bundle show --paths', {
                cwd: workspaceFolder.uri.fsPath
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
            const stats = this.getStats();
            this.outputChannel.appendLine(
                `Indexed ${stats.totalSymbols} symbols in ${stats.indexedFiles} files (${duration}ms)`
            );
        } catch (error) {
            this.outputChannel.appendLine(`Critical error during indexing: ${error}`);
            throw error; // Re-throw to trigger timeout/error handling
        } finally {
            this.indexing = false;
        }
    }

    /**
     * Phase 1: Index currently open files (highest priority)
     */
    private async indexOpenFiles(): Promise<void> {
        const openDocs = vscode.workspace.textDocuments.filter(
            doc => doc.languageId === 'ruby' && doc.uri.scheme === 'file'
        );

        this.outputChannel.appendLine(`Indexing ${openDocs.length} open files...`);

        for (const doc of openDocs) {
            await this.indexFile(doc.uri, true);
        }
    }

    /**
     * Phase 2: Index files visible in editor (high priority)
     */
    private async indexVisibleFiles(): Promise<void> {
        const visibleUris = vscode.window.visibleTextEditors
            .filter(editor => editor.document.languageId === 'ruby')
            .map(editor => editor.document.uri);

        for (const uri of visibleUris) {
            await this.indexFile(uri, true);
        }
    }

    /**
     * Phase 3: Index project files incrementally
     */
    private async indexProjectFiles(): Promise<void> {
        const files = await vscode.workspace.findFiles(
            '**/*.rb',
            '{**/node_modules/**,**/vendor/bundle/**,**/tmp/**,.git/**}'
        );

        this.outputChannel.appendLine(`Found ${files.length} project files`);

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
            const content = await vscode.workspace.fs.readFile(uri);
            const checksum = this.calculateChecksum(content);

            // Extract symbols with advanced parsing
            const symbols = await this.extractSymbolsAdvanced(document);

            if (symbols.length > 0) {
                this.symbols.set(uri.toString(), symbols);

                // Update metadata
                this.fileMetadata.set(uri.toString(), {
                    uri: uri.toString(),
                    checksum,
                    lastIndexed: Date.now(),
                    symbolCount: symbols.length
                });

                // Extract type information
                await this.extractTypeInfo(document, symbols);
            }
        } catch (error) {
            // Silently skip files that can't be indexed
        }
    }

    /**
     * Advanced symbol extraction with better parsing
     */
    private async extractSymbolsAdvanced(document: vscode.TextDocument): Promise<RubySymbol[]> {
        const symbols: RubySymbol[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        let currentClass: string | undefined;
        let currentModule: string | undefined;
        let indentStack: Array<{name: string, type: 'class' | 'module', indent: number}> = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const indent = line.search(/\S/);

            // Skip comments and empty lines
            if (trimmed.startsWith('#') || trimmed.length === 0) {
                continue;
            }

            // Update scope based on indentation
            while (indentStack.length > 0 && indent <= indentStack[indentStack.length - 1].indent) {
                indentStack.pop();
            }

            if (indentStack.length > 0) {
                const current = indentStack[indentStack.length - 1];
                if (current.type === 'class') {
                    currentClass = current.name;
                } else {
                    currentModule = current.name;
                }
            } else {
                currentClass = undefined;
                currentModule = undefined;
            }

            // Match class definitions (including nested)
            const classMatch = trimmed.match(/^class\s+([A-Z][A-Za-z0-9_:]*)\s*(?:<\s*([A-Z][A-Za-z0-9_:]*))?/);
            if (classMatch) {
                const className = classMatch[1];
                const superclass = classMatch[2];
                currentClass = className;
                indentStack.push({ name: className, type: 'class', indent });

                symbols.push({
                    name: className,
                    kind: vscode.SymbolKind.Class,
                    location: new vscode.Location(
                        document.uri,
                        new vscode.Position(i, line.indexOf('class'))
                    ),
                    containerName: currentModule,
                    detail: superclass ? `class (extends ${superclass})` : 'class'
                });
            }

            // Match module definitions
            const moduleMatch = trimmed.match(/^module\s+([A-Z][A-Za-z0-9_:]*)/);
            if (moduleMatch) {
                const moduleName = moduleMatch[1];
                currentModule = moduleName;
                indentStack.push({ name: moduleName, type: 'module', indent });

                symbols.push({
                    name: moduleName,
                    kind: vscode.SymbolKind.Module,
                    location: new vscode.Location(
                        document.uri,
                        new vscode.Position(i, line.indexOf('module'))
                    ),
                    detail: 'module'
                });
            }

            // Match method definitions with parameters
            const methodMatch = trimmed.match(/^def\s+(self\.)?([a-z_][a-z0-9_?!=]*)\s*(?:\((.*?)\))?/);
            if (methodMatch) {
                const isSelfMethod = !!methodMatch[1];
                const methodName = methodMatch[2];
                const params = methodMatch[3];
                const containerName = currentClass || currentModule;

                const parameters = params ? this.parseParameters(params) : [];

                symbols.push({
                    name: methodName,
                    kind: vscode.SymbolKind.Method,
                    location: new vscode.Location(
                        document.uri,
                        new vscode.Position(i, line.indexOf('def'))
                    ),
                    containerName,
                    scope: isSelfMethod ? 'singleton' : 'instance',
                    detail: isSelfMethod ? 'class method' : 'instance method',
                    parameters: parameters.map(p => p.name)
                });
            }

            // Match constant definitions
            const constantMatch = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*=/);
            if (constantMatch) {
                const constantName = constantMatch[1];
                symbols.push({
                    name: constantName,
                    kind: vscode.SymbolKind.Constant,
                    location: new vscode.Location(
                        document.uri,
                        new vscode.Position(i, line.indexOf(constantName))
                    ),
                    containerName: currentClass || currentModule,
                    detail: 'constant'
                });
            }

            // Match attr_* with multiple attributes
            const attrMatch = trimmed.match(/^attr_(accessor|reader|writer)\s+(.+)/);
            if (attrMatch) {
                const attrType = attrMatch[1];
                const attrsStr = attrMatch[2];
                const attrs = attrsStr.split(',').map(a => a.trim().replace(/^:/, ''));

                for (const attrName of attrs) {
                    if (attrName) {
                        symbols.push({
                            name: attrName,
                            kind: vscode.SymbolKind.Property,
                            location: new vscode.Location(
                                document.uri,
                                new vscode.Position(i, line.indexOf(attrName))
                            ),
                            containerName: currentClass,
                            detail: attrType
                        });
                    }
                }
            }

            // Match lambda/proc definitions
            const lambdaMatch = trimmed.match(/^([a-z_][a-z0-9_]*)\s*=\s*(?:lambda|proc|\-\>)/);
            if (lambdaMatch) {
                const lambdaName = lambdaMatch[1];
                symbols.push({
                    name: lambdaName,
                    kind: vscode.SymbolKind.Function,
                    location: new vscode.Location(
                        document.uri,
                        new vscode.Position(i, line.indexOf(lambdaName))
                    ),
                    containerName: currentClass || currentModule,
                    detail: 'lambda'
                });
            }
        }

        return symbols;
    }

    /**
     * Parse method parameters
     */
    private parseParameters(paramsStr: string): Parameter[] {
        const params: Parameter[] = [];
        const parts = paramsStr.split(',').map(p => p.trim());

        for (const part of parts) {
            // Keyword argument: name:, name: default
            const kwMatch = part.match(/^([a-z_][a-z0-9_]*):(?:\s*(.+))?/);
            if (kwMatch) {
                params.push({
                    name: kwMatch[1],
                    keyword: true,
                    defaultValue: kwMatch[2]
                });
                continue;
            }

            // Splat argument: *args, **kwargs
            const splatMatch = part.match(/^(\*+)([a-z_][a-z0-9_]*)/);
            if (splatMatch) {
                params.push({
                    name: splatMatch[2],
                    splat: true
                });
                continue;
            }

            // Regular with default: name = value
            const defaultMatch = part.match(/^([a-z_][a-z0-9_]*)\s*=\s*(.+)/);
            if (defaultMatch) {
                params.push({
                    name: defaultMatch[1],
                    defaultValue: defaultMatch[2]
                });
                continue;
            }

            // Regular argument
            const nameMatch = part.match(/^([a-z_][a-z0-9_]*)/);
            if (nameMatch) {
                params.push({
                    name: nameMatch[1]
                });
            }
        }

        return params;
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
     */
    findSymbols(query: string, kind?: vscode.SymbolKind): RubySymbol[] {
        const results: RubySymbol[] = [];

        for (const symbols of this.symbols.values()) {
            for (const symbol of symbols) {
                if (kind && symbol.kind !== kind) {
                    continue;
                }

                if (this.fuzzyMatch(symbol.name, query)) {
                    results.push(symbol);
                }
            }
        }

        return results.sort((a, b) => {
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
            lastIndexTime: Date.now()
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
    }
}

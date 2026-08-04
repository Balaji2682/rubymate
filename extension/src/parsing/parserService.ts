import * as vscode from 'vscode';
import type { RubySymbol } from '../advancedIndexer';
import { StimulusController } from '../hotwire/types';
import {
    ASTNode,
    ClassNode,
    MethodCall as RubyMethodCall,
    MethodNode,
    NodeType
} from '../indexing/rubyParser';
import { LegacyRubyParserAdapter } from './legacyRubyParserAdapter';
import { RubyTreeSitterParser } from './rubyTreeSitterParser';
import { EmbeddedRubyRegion, TemplateParser } from './templateParser';
import { StimulusTreeSitterParser } from './stimulusTreeSitterParser';
import { TreeSitterRuntime } from './treeSitterRuntime';
import { LRUCache } from '../shared/dataStructures/lruCache';

export type ParserEngine = 'auto' | 'tree-sitter' | 'legacy';

export interface ParseResult<T> {
    engine: 'tree-sitter' | 'legacy';
    value: T;
    hasErrors?: boolean;
    errorRanges?: vscode.Range[];
}

export type ParserRuntimeStatus = 'ready' | 'degraded' | 'failed';
export type RubySymbolExtractionStatus = 'ok' | 'fallback' | 'parse_error';

export interface RubySymbolExtractionResult {
    engine: 'tree-sitter' | 'legacy';
    symbols: RubySymbol[];
    status: RubySymbolExtractionStatus;
    hasErrors?: boolean;
    error?: string;
}

export interface ParsedMethodCall {
    method: MethodNode;
    call: RubyMethodCall;
}

const RUBY_PARSE_CACHE_SIZE = 200;
const PARSER_SERVICE_CACHE_VERSION = 'parser-service:v2';

export class ParserService {
    private readonly runtime: TreeSitterRuntime;
    private readonly rubyTreeSitterParser = new RubyTreeSitterParser();
    private readonly legacyAdapter = new LegacyRubyParserAdapter();
    private readonly templateParser: TemplateParser;
    private readonly stimulusParser: StimulusTreeSitterParser;
    private readonly rubyParseCache = new LRUCache<string, Promise<ParseResult<ASTNode[]>>>({
        maxSize: RUBY_PARSE_CACHE_SIZE
    });
    private runtimeStatus: ParserRuntimeStatus = 'ready';
    private warnedAboutRuntimeFailure = false;

    constructor(
        context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this.runtime = new TreeSitterRuntime(context, outputChannel);
        this.templateParser = new TemplateParser(this.runtime);
        this.stimulusParser = new StimulusTreeSitterParser(this.runtime);
    }

    getCacheVersion(): string {
        return `${PARSER_SERVICE_CACHE_VERSION};engine=${this.getConfiguredEngine()};${this.runtime.getCacheVersion()}`;
    }

    getRuntimeStatus(): ParserRuntimeStatus {
        return this.runtimeStatus;
    }

    getEnginePreference(): ParserEngine {
        return this.getConfiguredEngine();
    }

    async initialize(): Promise<void> {
        if (this.getConfiguredEngine() === 'legacy') {
            this.runtimeStatus = 'ready';
            return;
        }

        try {
            await this.runtime.assertAssetsPresent();
            await this.runtime.ensureReady();
            this.runtimeStatus = 'ready';
            this.outputChannel.appendLine('[Parser] Tree-sitter runtime initialized');
        } catch (error) {
            this.runtimeStatus = this.getConfiguredEngine() === 'auto' ? 'degraded' : 'failed';
            this.handleTreeSitterError('initialize Tree-sitter runtime', error);
            this.showRuntimeWarning(error);
        }
    }

    async parseRuby(document: vscode.TextDocument): Promise<ParseResult<ASTNode[]>> {
        const cacheKey = this.rubyParseCacheKey(document);
        const cached = this.rubyParseCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const parsePromise = this.parseRubyUncached(document).catch(error => {
            this.rubyParseCache.delete(cacheKey);
            throw error;
        });

        this.rubyParseCache.set(cacheKey, parsePromise);
        return parsePromise;
    }

    private async parseRubyUncached(document: vscode.TextDocument): Promise<ParseResult<ASTNode[]>> {
        const engine = this.getConfiguredEngine();
        if (engine === 'legacy') {
            return { engine: 'legacy', value: this.legacyAdapter.parse(document) };
        }

        try {
            const tree = await this.runtime.parse('ruby', document.getText());
            try {
                const hasErrors = tree.rootNode.hasError;
                if (hasErrors) {
                    this.outputChannel.appendLine(`[Parser] Tree-sitter syntax errors in ${document.uri.fsPath}; using partial tree-sitter result`);
                }

                return {
                    engine: 'tree-sitter',
                    value: this.rubyTreeSitterParser.parse(tree),
                    hasErrors,
                    errorRanges: hasErrors ? this.rubyTreeSitterParser.collectErrorRanges(tree) : undefined
                };
            } finally {
                tree.delete();
            }
        } catch (error) {
            this.handleTreeSitterError(`parse ${document.uri.fsPath}`, error);
            if (engine === 'auto') {
                this.runtimeStatus = 'degraded';
                return { engine: 'legacy', value: this.legacyAdapter.parse(document), hasErrors: true };
            }

            this.runtimeStatus = 'failed';
            return { engine: 'tree-sitter', value: [], hasErrors: true };
        }
    }

    private rubyParseCacheKey(document: vscode.TextDocument): string {
        return [
            document.uri.toString(),
            document.version,
            this.getCacheVersion()
        ].join('|');
    }

    async extractRubySymbols(document: vscode.TextDocument): Promise<RubySymbol[]> {
        return (await this.extractRubySymbolResult(document)).symbols;
    }

    async extractRubySymbolResult(document: vscode.TextDocument): Promise<RubySymbolExtractionResult> {
        const engine = this.getConfiguredEngine();
        if (engine === 'legacy') {
            return {
                engine: 'legacy',
                symbols: this.legacyAdapter.extractSymbols(document),
                status: 'ok'
            };
        }

        try {
            const parsed = await this.parseRuby(document);
            if (parsed.engine === 'legacy') {
                const status = engine === 'auto' && parsed.hasErrors ? 'fallback' : 'ok';
                const symbols = this.legacyAdapter.extractSymbols(document).map(symbol => ({
                    ...symbol,
                    definitionConfidence: status === 'fallback' ? 'fallback' as const : symbol.definitionConfidence
                }));

                return {
                    engine: 'legacy',
                    symbols,
                    status,
                    hasErrors: parsed.hasErrors
                };
            }

            const symbols = this.symbolsFromAst(document.uri, parsed.value);
            if (parsed.hasErrors && parsed.errorRanges?.length) {
                symbols.push(...this.recoverSymbolsInErrorRanges(document, symbols, parsed.errorRanges));
            }

            // Tree-sitter-ruby reports syntax errors on valid Ruby it cannot parse
            // (e.g. endless methods with unparenthesized command bodies). When we
            // still recovered symbols from the partial tree, treat the file as a
            // healthy parse so a single unparseable line does not degrade the file.
            // Only a syntax error that yielded nothing usable is a real parse error.
            return {
                engine: 'tree-sitter',
                symbols,
                status: parsed.hasErrors && symbols.length === 0 ? 'parse_error' : 'ok',
                hasErrors: parsed.hasErrors
            };
        } catch (error) {
            this.handleTreeSitterError(`extract symbols from ${document.uri.fsPath}`, error);
            return {
                engine: 'tree-sitter',
                symbols: [],
                status: 'parse_error',
                hasErrors: true,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    async parseTemplate(document: vscode.TextDocument): Promise<EmbeddedRubyRegion[]> {
        const engine = this.getConfiguredEngine();
        if (engine === 'legacy') {
            return [];
        }

        try {
            return await this.templateParser.parse(document);
        } catch (error) {
            this.handleTreeSitterError(`parse template ${document.uri.fsPath}`, error);
            return [];
        }
    }

    async parseStimulusController(
        content: string,
        filePath: string,
        mtime: number
    ): Promise<StimulusController | null> {
        const engine = this.getConfiguredEngine();
        if (engine === 'legacy') {
            return null;
        }

        try {
            return await this.stimulusParser.parseController(content, filePath, mtime);
        } catch (error) {
            this.handleTreeSitterError(`parse Stimulus controller ${filePath}`, error);
            return null;
        }
    }

    async isStimulusController(content: string, filePath: string): Promise<boolean | undefined> {
        const engine = this.getConfiguredEngine();
        if (engine === 'legacy') {
            return undefined;
        }

        try {
            return await this.stimulusParser.isValidController(content, filePath);
        } catch (error) {
            this.handleTreeSitterError(`validate Stimulus controller ${filePath}`, error);
            return undefined;
        }
    }

    extractStimulusControllerName(filePath: string): string | null {
        return this.stimulusParser.extractControllerName(filePath);
    }

    async findReferenceLocations(
        document: vscode.TextDocument,
        word: string,
        includeDeclaration: boolean
    ): Promise<vscode.Location[]> {
        const engine = this.getConfiguredEngine();
        if (engine === 'legacy') {
            return this.legacyAdapter.findReferenceLocations(document, word, includeDeclaration);
        }

        try {
            const tree = await this.runtime.parse('ruby', document.getText());
            try {
                const references = this.rubyTreeSitterParser.collectReferenceLocations(tree, word)
                    .filter(ref => includeDeclaration || ref.kind !== 'definition')
                    .map(ref => new vscode.Location(document.uri, ref.range));

                return references.length > 0
                    ? references
                    : this.legacyAdapter.findReferenceLocations(document, word, includeDeclaration);
            } finally {
                tree.delete();
            }
        } catch (error) {
            this.handleTreeSitterError(`find references in ${document.uri.fsPath}`, error);
            return engine === 'auto'
                ? this.legacyAdapter.findReferenceLocations(document, word, includeDeclaration)
                : [];
        }
    }

    async findMethodCallRanges(
        document: vscode.TextDocument,
        methodName: string,
        withinRange?: vscode.Range
    ): Promise<vscode.Range[]> {
        const parsed = await this.parseRuby(document);
        if (parsed.engine === 'legacy') {
            return this.legacyAdapter.findMethodCalls(document, methodName, withinRange);
        }

        const ranges: vscode.Range[] = [];
        for (const { call } of this.collectMethodCalls(parsed.value)) {
            if (call.method !== methodName) {
                continue;
            }

            const start = call.location;
            const end = start.translate(0, methodName.length);
            const range = new vscode.Range(start, end);
            if (!withinRange || withinRange.contains(range)) {
                ranges.push(range);
            }
        }

        return this.dedupeRanges(ranges);
    }

    async findContainingMethod(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<MethodNode | undefined> {
        const parsed = await this.parseRuby(document);
        return this.findContainingMethodInAst(parsed.value, position);
    }

    collectMethodCalls(ast: ASTNode[]): ParsedMethodCall[] {
        const calls: ParsedMethodCall[] = [];
        const visit = (node: ASTNode): void => {
            if (node.type === NodeType.Method) {
                const method = node as MethodNode;
                method.calls.forEach(call => calls.push({ method, call }));
            }

            const classNode = node as ClassNode;
            if (classNode.methods) {
                for (const method of classNode.methods) {
                    method.calls.forEach(call => calls.push({ method, call }));
                }
            }

            node.children.forEach(visit);
        };

        ast.forEach(visit);
        return calls;
    }

    findContainingMethodInAst(ast: ASTNode[], position: vscode.Position): MethodNode | undefined {
        const methods: MethodNode[] = [];
        const visit = (node: ASTNode): void => {
            if (node.type === NodeType.Method) {
                methods.push(node as MethodNode);
            }

            const classNode = node as ClassNode;
            if (classNode.methods) {
                methods.push(...classNode.methods);
            }

            node.children.forEach(visit);
        };

        ast.forEach(visit);
        return methods.find(method => method.range.contains(position));
    }

    private recoverSymbolsInErrorRanges(
        document: vscode.TextDocument,
        astSymbols: RubySymbol[],
        errorRanges: vscode.Range[]
    ): RubySymbol[] {
        const lineInErrorRange = (line: number): boolean =>
            errorRanges.some(range => line >= range.start.line && line <= range.end.line);

        return this.legacyAdapter.extractSymbols(document)
            .filter(symbol => lineInErrorRange(symbol.location.range.start.line))
            .filter(symbol => !astSymbols.some(existing =>
                existing.name === symbol.name
                && existing.location.range.start.line === symbol.location.range.start.line))
            .map(symbol => ({ ...symbol, definitionConfidence: 'fallback' as const }));
    }

    private symbolsFromAst(uri: vscode.Uri, ast: ASTNode[]): RubySymbol[] {
        const symbols: RubySymbol[] = [];
        const emittedMethods = new Set<string>();

        const emitMethodSymbol = (method: MethodNode, containerName?: string): void => {
            const effectiveContainer = method.metadata.get('containerName') as string | undefined || containerName;
            const key = [
                effectiveContainer ?? '',
                method.name,
                method.isClassMethod ? 'singleton' : 'instance',
                method.range.start.line,
                method.range.start.character,
                method.range.end.line,
                method.range.end.character
            ].join(':');

            if (emittedMethods.has(key)) {
                return;
            }

            emittedMethods.add(key);
            symbols.push({
                name: method.name,
                kind: vscode.SymbolKind.Method,
                location: new vscode.Location(uri, method.range),
                containerName: effectiveContainer,
                scope: method.isClassMethod ? 'singleton' : 'instance',
                detail: method.isClassMethod ? 'class method' : 'instance method',
                parameters: method.parameters.map(param => param.name),
                definitionConfidence: 'exact_ast'
            });
        };

        const visit = (node: ASTNode, containerName?: string): void => {
            if (node.type === NodeType.Class || node.type === NodeType.Module) {
                const rawName = node.metadata.get('rawName') || node.name.split('::').pop() || node.name;
                const symbol: RubySymbol = {
                    name: rawName,
                    kind: node.type === NodeType.Class ? vscode.SymbolKind.Class : vscode.SymbolKind.Module,
                    location: new vscode.Location(uri, node.range),
                    containerName,
                    detail: node.type,
                    definitionConfidence: 'exact_ast'
                };

                const classNode = node as ClassNode;
                if (classNode.superclass) {
                    symbol.detail = `class (extends ${classNode.superclass})`;
                }

                symbols.push(symbol);

                if (classNode.methods) {
                    for (const method of classNode.methods) {
                        emitMethodSymbol(method, node.name);
                    }
                }

                for (const child of node.children) {
                    visit(child, node.name);
                }
                return;
            }

            if (node.type === NodeType.Method) {
                emitMethodSymbol(node as MethodNode, containerName);
            }

            if (node.type === NodeType.Constant) {
                symbols.push({
                    name: node.name,
                    kind: vscode.SymbolKind.Constant,
                    location: new vscode.Location(uri, node.range),
                    containerName,
                    detail: 'constant',
                    definitionConfidence: 'exact_ast'
                });
            }

            if (node.type === NodeType.Variable && node.metadata.has('attrType')) {
                symbols.push({
                    name: node.name,
                    kind: vscode.SymbolKind.Property,
                    location: new vscode.Location(uri, node.range),
                    containerName,
                    detail: node.metadata.get('attrType'),
                    definitionConfidence: node.metadata.get('definitionConfidence') ?? 'exact_ast'
                });
            }

            if (node.type === NodeType.Scope) {
                symbols.push({
                    name: node.name,
                    kind: vscode.SymbolKind.Function,
                    location: new vscode.Location(uri, node.range),
                    containerName,
                    detail: 'scope',
                    definitionConfidence: node.metadata.get('definitionConfidence') ?? 'metaprogramming'
                });
            }

            if (node.type === NodeType.Association) {
                symbols.push({
                    name: node.name,
                    kind: vscode.SymbolKind.Property,
                    location: new vscode.Location(uri, node.range),
                    containerName,
                    detail: node.metadata.get('associationType') ?? 'association',
                    definitionConfidence: node.metadata.get('definitionConfidence') ?? 'metaprogramming'
                });
            }

            if (node.type === NodeType.GeneratedMethod) {
                symbols.push({
                    name: node.name,
                    kind: vscode.SymbolKind.Method,
                    location: new vscode.Location(uri, node.range),
                    containerName,
                    detail: node.metadata.get('generatedBy') ?? 'generated method',
                    definitionConfidence: node.metadata.get('definitionConfidence') ?? 'metaprogramming'
                });
            }

            node.children.forEach(child => visit(child, containerName));
        };

        ast.forEach(node => visit(node));
        return symbols;
    }

    private getConfiguredEngine(): ParserEngine {
        return vscode.workspace
            .getConfiguration('rubymate')
            .get<ParserEngine>('parser.engine', 'auto');
    }

    private handleTreeSitterError(action: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`[Parser] Failed to ${action}: ${message}`);

        if (this.getConfiguredEngine() === 'tree-sitter') {
            this.outputChannel.appendLine('[Parser] rubymate.parser.engine is tree-sitter; legacy fallback is disabled for this parse');
        }
    }

    private showRuntimeWarning(error: unknown): void {
        if (this.warnedAboutRuntimeFailure) {
            return;
        }

        this.warnedAboutRuntimeFailure = true;
        const message = error instanceof Error ? error.message : String(error);
        const fallback = this.getConfiguredEngine() === 'auto'
            ? 'RubyMate will use the legacy Ruby parser fallback. Some navigation results may be lower confidence.'
            : 'Legacy fallback is disabled because rubymate.parser.engine is set to tree-sitter.';

        vscode.window.showWarningMessage(`RubyMate parser assets failed to load. ${fallback}`);
        this.outputChannel.appendLine(`[Parser] User warning shown for runtime failure: ${message}`);
    }

    private dedupeRanges(ranges: vscode.Range[]): vscode.Range[] {
        const seen = new Set<string>();
        return ranges.filter(range => {
            const key = `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
    }
}

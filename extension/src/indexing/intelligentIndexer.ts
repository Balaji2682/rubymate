import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import { RubyParser, ClassNode, MethodNode, NodeType } from './rubyParser';
import { SemanticGraphBuilder, ClassInfo, MethodInfo, Association, AssociationType } from './semanticGraph';
import { TypeInferenceEngine, InferenceContext } from './typeInference';
import { SmartSearchEngine, SearchContext, SearchResult } from './smartSearch';
import { ReferenceTracker, DeadCodeAnalysis } from './referenceTracker';
import { RailsIntelligence, RailsComponent } from './railsIntelligence';
import { SchemaParser } from '../database/schemaParser';
import { RubySymbol } from '../advancedIndexer';

/**
 * Intelligent Indexer - Orchestrates all semantic analysis components
 */

export class IntelligentIndexer {
    private context: vscode.ExtensionContext;
    private outputChannel: vscode.OutputChannel;

    // Core components
    private graphBuilder: SemanticGraphBuilder;
    private typeInference: TypeInferenceEngine;
    private smartSearch: SmartSearchEngine;
    private referenceTracker: ReferenceTracker;
    private railsIntelligence: RailsIntelligence;
    private schemaParser: SchemaParser;

    // Indexing state
    private isIndexing: boolean = false;
    private fileHashes: Map<string, string> = new Map();
    private workspaceRoot: string;

    // Cache paths
    private get cacheDir(): string {
        return path.join(this.context.globalStorageUri.fsPath, 'intelligent-index');
    }

    constructor(
        context: vscode.ExtensionContext,
        schemaParser: SchemaParser,
        outputChannel: vscode.OutputChannel
    ) {
        this.context = context;
        this.outputChannel = outputChannel;
        this.schemaParser = schemaParser;

        // Initialize components
        this.graphBuilder = new SemanticGraphBuilder(outputChannel);
        this.typeInference = new TypeInferenceEngine(this.graphBuilder, schemaParser, outputChannel);
        this.smartSearch = new SmartSearchEngine(this.graphBuilder);
        this.referenceTracker = new ReferenceTracker(this.graphBuilder, outputChannel);

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        this.workspaceRoot = workspaceFolder?.uri.fsPath || '';
        this.railsIntelligence = new RailsIntelligence(this.graphBuilder, this.workspaceRoot);
    }

    /**
     * Initialize the indexer
     */
    async initialize(): Promise<void> {
        this.outputChannel.appendLine('Initializing intelligent indexer...');

        // Create cache directory
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
        } catch (error) {
            this.outputChannel.appendLine(`Failed to create cache directory: ${error}`);
        }

        // Load cached data
        await this.loadCache();

        // Parse Rails routes
        await this.railsIntelligence.parseRoutes();

        this.outputChannel.appendLine('Intelligent indexer initialized');
    }

    /**
     * Index entire workspace
     */
    async indexWorkspace(): Promise<void> {
        if (this.isIndexing) {
            this.outputChannel.appendLine('Indexing already in progress');
            return;
        }

        this.isIndexing = true;

        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Indexing Ruby workspace",
            cancellable: true
        }, async (progress, token) => {
            const startTime = Date.now();

            // Add timeout: 5 minutes max
            const timeoutPromise = new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error('Indexing timeout after 5 minutes')), 300000)
            );

            try {
                await Promise.race([
                    this.indexWorkspaceInternal(progress, token),
                    timeoutPromise
                ]);
            } catch (error) {
                // Graceful degradation
                this.outputChannel.appendLine(`Indexing failed: ${error}`);
                if (error instanceof Error && error.message.includes('timeout')) {
                    vscode.window.showWarningMessage(
                        'Workspace indexing timed out after 5 minutes. Some features may be limited. Try indexing again or reduce workspace size.',
                        'Retry'
                    ).then(selection => {
                        if (selection === 'Retry') {
                            this.isIndexing = false;
                            this.indexWorkspace();
                        }
                    });
                } else {
                    vscode.window.showWarningMessage(
                        `Workspace indexing incomplete: ${error instanceof Error ? error.message : String(error)}. Some features may be limited.`
                    );
                }
            } finally {
                this.isIndexing = false;
                const duration = Date.now() - startTime;
                this.outputChannel.appendLine(`Indexing completed in ${duration}ms`);
            }
        });
    }

    /**
     * Internal indexing implementation with progress reporting
     */
    private async indexWorkspaceInternal(
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken
    ): Promise<void> {
        const startTime = Date.now();

        // Find all Ruby files
        progress.report({ message: 'Finding Ruby files...' });
        const files = await vscode.workspace.findFiles('**/*.rb', '**/node_modules/**');
        this.outputChannel.appendLine(`Found ${files.length} Ruby files to index`);

        if (token.isCancellationRequested) {
            this.outputChannel.appendLine('Indexing cancelled by user');
            return;
        }

        // Index in batches to avoid blocking
        const batchSize = 20;
        const totalBatches = Math.ceil(files.length / batchSize);
        const incrementPerBatch = 100 / totalBatches;

        for (let i = 0; i < files.length; i += batchSize) {
            if (token.isCancellationRequested) {
                this.outputChannel.appendLine('Indexing cancelled by user');
                return;
            }

            const batch = files.slice(i, i + batchSize);
            const batchNumber = Math.floor(i / batchSize) + 1;

            progress.report({
                message: `Indexing batch ${batchNumber}/${totalBatches} (${i + batch.length}/${files.length} files)`,
                increment: incrementPerBatch
            });

            await Promise.all(batch.map(uri => this.indexFile(uri)));

            // Yield to allow UI updates
            await this.sleep(10);
        }

        // Save cache
        progress.report({ message: 'Saving cache...' });
        await this.saveCache();

        const duration = Date.now() - startTime;
        this.outputChannel.appendLine(`Indexed workspace in ${duration}ms`);

        // Print statistics
        const stats = this.getStats();
        this.outputChannel.appendLine(`Statistics: ${JSON.stringify(stats, null, 2)}`);
    }

    /**
     * Index a single file
     */
    async indexFile(uri: vscode.Uri): Promise<void> {
        try {
            // Check if file changed
            const document = await vscode.workspace.openTextDocument(uri);
            const content = document.getText();
            const hash = this.calculateHash(content);

            if (this.fileHashes.get(uri.toString()) === hash) {
                // File unchanged, skip
                return;
            }

            this.fileHashes.set(uri.toString(), hash);

            // Parse the file
            const parser = new RubyParser(document);
            const ast = parser.parse();

            // Extract semantic information
            await this.extractSemanticInfo(uri, document, ast);

            // Track references
            await this.referenceTracker.trackReferencesInDocument(document);

            // Index symbols for search
            const symbols = await this.extractSymbols(uri, ast);
            this.smartSearch.indexSymbols(uri.toString(), symbols);

        } catch (error) {
            this.outputChannel.appendLine(`Error indexing ${uri.fsPath}: ${error}`);
        }
    }

    /**
     * Extract semantic information from AST
     */
    private async extractSemanticInfo(uri: vscode.Uri, document: vscode.TextDocument, ast: any[]): Promise<void> {
        const filePath = uri.fsPath;
        const isModel = filePath.includes('/app/models/');
        const isController = filePath.includes('/app/controllers/');

        for (const node of ast) {
            // Extract class information
            if (node.type === NodeType.Class) {
                const classNode = node as ClassNode;
                const classInfo: ClassInfo = {
                    name: classNode.name,
                    fullyQualifiedName: classNode.name,
                    location: new vscode.Location(uri, classNode.range),
                    superclass: classNode.superclass,
                    mixins: classNode.mixins,
                    subclasses: [],
                    methods: [],
                    constants: new Map(),
                    instanceVariables: [],
                    classVariables: [],
                    isRailsModel: isModel,
                    isRailsController: isController
                };

                this.graphBuilder.addClass(classInfo);

                // Extract methods
                for (const method of classNode.methods) {
                    await this.extractMethodInfo(uri, classInfo, method);
                }

                // Extract associations
                for (const child of classNode.children) {
                    if (child.type === NodeType.Association) {
                        this.extractAssociation(classInfo.name, child);
                    }
                }

                // Infer types for model attributes
                if (isModel) {
                    const attributeTypes = this.typeInference.inferModelTypes(classNode.name);
                    const associationTypes = this.typeInference.inferAssociationTypes(classNode.name);

                    // Store type information in graph
                    for (const [attr, type] of attributeTypes) {
                        this.graphBuilder.addTypeInfo({
                            symbol: attr,
                            inferredType: type.type,
                            confidence: type.confidence,
                            source: type.source,
                            location: new vscode.Location(uri, classNode.range)
                        });
                    }
                }
            }

            // Extract module information
            if (node.type === NodeType.Module) {
                const moduleInfo = {
                    name: node.name,
                    fullyQualifiedName: node.name,
                    location: new vscode.Location(uri, node.range),
                    methods: [],
                    includedIn: [],
                    extendedIn: []
                };
                this.graphBuilder.addModule(moduleInfo);
            }
        }
    }

    /**
     * Extract method information
     */
    private async extractMethodInfo(uri: vscode.Uri, classInfo: ClassInfo, methodNode: MethodNode): Promise<void> {
        const methodId = methodNode.isClassMethod
            ? `${classInfo.name}.${methodNode.name}`
            : `${classInfo.name}#${methodNode.name}`;

        const methodInfo: MethodInfo = {
            id: methodId,
            name: methodNode.name,
            className: classInfo.name,
            location: new vscode.Location(uri, methodNode.range),
            parameters: methodNode.parameters,
            visibility: methodNode.visibility,
            isClassMethod: methodNode.isClassMethod,
            returnType: methodNode.returns.length > 0 ? methodNode.returns[0].type : undefined,
            calls: [],
            calledBy: [],
            usageCount: 0
        };

        this.graphBuilder.addMethod(methodInfo);

        // Extract method calls
        for (const call of methodNode.calls) {
            const calleeId = call.receiver
                ? `${call.receiver}#${call.method}`
                : `${classInfo.name}#${call.method}`;

            this.graphBuilder.addMethodCall({
                caller: methodId,
                callee: calleeId,
                location: new vscode.Location(uri, new vscode.Position(call.location.line, call.location.character)),
                confidence: 0.7,
                receiverType: call.receiver
            });
        }
    }

    /**
     * Extract association information
     */
    private extractAssociation(className: string, node: any): void {
        const associationType = node.metadata.get('associationType');
        const name = node.name;

        // Infer target model from association name
        let targetModel = name;
        if (associationType === 'has_many' || associationType === 'has_and_belongs_to_many') {
            // Singularize the name
            targetModel = name.replace(/s$/, '');
        }

        // Convert to PascalCase
        targetModel = targetModel.charAt(0).toUpperCase() + targetModel.slice(1);

        const association: Association = {
            sourceModel: className,
            targetModel,
            type: associationType as AssociationType,
            name,
            location: new vscode.Location(vscode.Uri.file(''), node.range),
            options: new Map()
        };

        this.graphBuilder.addAssociation(association);
    }

    /**
     * Extract symbols for search
     */
    private async extractSymbols(uri: vscode.Uri, ast: any[]): Promise<RubySymbol[]> {
        const symbols: RubySymbol[] = [];

        const traverse = (node: any, containerName?: string) => {
            if (node.type === NodeType.Class || node.type === NodeType.Module) {
                symbols.push({
                    name: node.name,
                    kind: node.type === NodeType.Class ? vscode.SymbolKind.Class : vscode.SymbolKind.Module,
                    location: new vscode.Location(uri, node.range),
                    containerName
                });

                // Traverse methods
                if (node.methods) {
                    for (const method of node.methods) {
                        symbols.push({
                            name: method.name,
                            kind: vscode.SymbolKind.Method,
                            location: new vscode.Location(uri, method.range),
                            containerName: node.name
                        });
                    }
                }
            }

            if (node.children) {
                for (const child of node.children) {
                    traverse(child, node.name);
                }
            }
        };

        for (const node of ast) {
            traverse(node);
        }

        return symbols;
    }

    /**
     * Smart search for symbols
     */
    search(query: string, context?: Partial<SearchContext>): SearchResult[] {
        const searchContext: SearchContext = {
            query,
            currentFile: context?.currentFile,
            currentClass: context?.currentClass,
            currentMethod: context?.currentMethod,
            fileType: context?.fileType,
            searchType: context?.searchType
        };

        return this.smartSearch.search(query, searchContext);
    }

    /**
     * Get call hierarchy for a method
     */
    getCallHierarchy(className: string, methodName: string): any[] {
        const methodId = `${className}#${methodName}`;
        const edges = this.graphBuilder.getCallHierarchy(methodId);

        return edges.map(edge => ({
            caller: edge.caller,
            callee: edge.callee,
            location: edge.location,
            confidence: edge.confidence
        }));
    }

    /**
     * Get type hierarchy for a class
     */
    getTypeHierarchy(className: string): string[] {
        return this.graphBuilder.getInheritanceChain(className);
    }

    /**
     * Get all subclasses of a class
     */
    getAllSubclasses(className: string): string[] {
        return this.graphBuilder.getAllSubclasses(className);
    }

    /**
     * Find all references to a symbol
     */
    findReferences(symbolName: string): any {
        return this.referenceTracker.findReferences(symbolName);
    }

    /**
     * Detect dead code
     */
    detectDeadCode(): DeadCodeAnalysis {
        return this.referenceTracker.detectDeadCode();
    }

    /**
     * Get Rails components for a model
     */
    async getRailsComponents(modelName: string): Promise<RailsComponent> {
        return this.railsIntelligence.getRelatedComponents(modelName);
    }

    /**
     * Find view for controller action
     */
    async findViewForAction(controllerName: string, action: string): Promise<vscode.Location | undefined> {
        return this.railsIntelligence.findViewForAction(controllerName, action);
    }

    /**
     * Get route information for controller action
     */
    getRouteInfo(controllerName: string, action: string): any {
        return this.railsIntelligence.getRouteInfo(controllerName, action);
    }

    /**
     * Get available methods for a type
     */
    getAvailableMethods(typeName: string): string[] {
        return this.typeInference.getAvailableMethods(typeName);
    }

    /**
     * Calculate file hash
     */
    private calculateHash(content: string): string {
        return crypto.createHash('md5').update(content).digest('hex');
    }

    /**
     * Save cache to disk
     */
    private async saveCache(): Promise<void> {
        try {
            const cachePath = path.join(this.cacheDir, 'index.json');
            const data = {
                fileHashes: Array.from(this.fileHashes.entries()),
                timestamp: Date.now()
            };
            await fs.writeFile(cachePath, JSON.stringify(data, null, 2));
        } catch (error) {
            this.outputChannel.appendLine(`Failed to save cache: ${error}`);
        }
    }

    /**
     * Load cache from disk
     */
    private async loadCache(): Promise<void> {
        try {
            const cachePath = path.join(this.cacheDir, 'index.json');
            const content = await fs.readFile(cachePath, 'utf-8');
            const data = JSON.parse(content);

            this.fileHashes = new Map(data.fileHashes);
            this.outputChannel.appendLine(`Loaded cache with ${this.fileHashes.size} files`);
        } catch (error) {
            // Cache doesn't exist, start fresh
            this.outputChannel.appendLine('No cache found, starting fresh index');
        }
    }

    /**
     * Get statistics
     */
    getStats(): any {
        const graphStats = this.graphBuilder.getStats();
        const searchStats = this.smartSearch.getStats();

        return {
            graph: graphStats,
            search: searchStats,
            files: this.fileHashes.size
        };
    }

    /**
     * Dispose
     */
    dispose(): void {
        this.saveCache();
    }

    /**
     * Sleep helper
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

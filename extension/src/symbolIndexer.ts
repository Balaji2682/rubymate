import * as vscode from 'vscode';
import * as path from 'path';

export interface RubySymbol {
    name: string;
    kind: vscode.SymbolKind;
    location: vscode.Location;
    containerName?: string;
    detail?: string;
    scope?: 'class' | 'module' | 'instance' | 'singleton';
}

export class SymbolIndexer {
    private symbols: Map<string, RubySymbol[]> = new Map();
    private indexing: boolean = false;
    private outputChannel: vscode.OutputChannel;
    private failedFiles: Map<string, string> = new Map(); // Track failed files and their errors
    private fileModTimes: Map<string, number> = new Map(); // Track file modification times for incremental indexing
    private cancellationTokenSource?: vscode.CancellationTokenSource;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    async indexWorkspace(incremental: boolean = false): Promise<void> {
        if (this.indexing) {
            return;
        }

        this.indexing = true;
        this.cancellationTokenSource = new vscode.CancellationTokenSource();
        const token = this.cancellationTokenSource.token;

        if (!incremental) {
            this.symbols.clear();
        }

        // Show progress notification for potentially long operation
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `${incremental ? 'Incrementally indexing' : 'Indexing'} Ruby symbols...`,
            cancellable: true
        }, async (progress, progressToken) => {
            // Link progress cancellation to our token
            progressToken.onCancellationRequested(() => {
                this.cancelIndexing();
            });

            try {
                this.outputChannel.appendLine(`${incremental ? 'Incremental indexing' : 'Indexing'} Ruby symbols...`);
                const startTime = Date.now();

                // Find all Ruby files
                progress.report({ increment: 0, message: 'Finding Ruby files...' });
                const files = await vscode.workspace.findFiles(
                    '**/*.rb',
                    '{**/node_modules/**,**/vendor/**,**/tmp/**,.git/**}'
                );

                this.outputChannel.appendLine(`Found ${files.length} Ruby files`);

                // Reduce batch size to 10 to prevent UI blocking
                const batchSize = 10;
                const totalBatches = Math.ceil(files.length / batchSize);
                let skippedCount = 0;

                for (let i = 0; i < files.length; i += batchSize) {
                    // Check for cancellation
                    if (token.isCancellationRequested || progressToken.isCancellationRequested) {
                        this.outputChannel.appendLine('Indexing cancelled by user');
                        return;
                    }

                    const batch = files.slice(i, i + batchSize);
                    const batchNumber = Math.floor(i / batchSize) + 1;
                    const processed = Math.min(i + batchSize, files.length);

                    // Report progress
                    const percentComplete = (processed / files.length) * 100;
                    progress.report({
                        increment: (100 / totalBatches),
                        message: `${processed}/${files.length} files (batch ${batchNumber}/${totalBatches})`
                    });

                    // Use incremental indexing if requested
                    if (incremental) {
                        const results = await Promise.all(
                            batch.map(async uri => {
                                const wasSkipped = await this.indexFileIncremental(uri);
                                return wasSkipped;
                            })
                        );
                        skippedCount += results.filter(skipped => skipped).length;
                    } else {
                        await Promise.all(batch.map(uri => this.indexFile(uri)));
                    }

                    // Yield to event loop and force garbage collection hint
                    await this.yieldAndCleanup();
                }

                if (incremental && skippedCount > 0) {
                    this.outputChannel.appendLine(`Skipped ${skippedCount} unchanged files`);
                }

                const duration = Date.now() - startTime;
                const totalSymbols = Array.from(this.symbols.values()).reduce((sum, arr) => sum + arr.length, 0);
                const successCount = files.length - this.failedFiles.size;

                this.outputChannel.appendLine(`Indexed ${totalSymbols} symbols in ${duration}ms`);
                this.outputChannel.appendLine(`Successfully indexed ${successCount}/${files.length} files`);

                // Report completion
                progress.report({ increment: 100, message: `Done! ${totalSymbols} symbols indexed` });

                if (this.failedFiles.size > 0) {
                    this.outputChannel.appendLine(`Failed to index ${this.failedFiles.size} files (see errors above)`);

                    // Show warning if many files failed
                    if (this.failedFiles.size > files.length * 0.1) { // More than 10% failed
                        vscode.window.showWarningMessage(
                            `Failed to index ${this.failedFiles.size} Ruby files. Some features may be limited. Check output for details.`,
                            'Show Output'
                        ).then(selection => {
                            if (selection === 'Show Output') {
                                this.outputChannel.show();
                            }
                        });
                    }
                }
            } catch (error) {
                this.outputChannel.appendLine(`Error indexing workspace: ${error}`);
                vscode.window.showErrorMessage(`Failed to index Ruby workspace: ${error instanceof Error ? error.message : String(error)}`);
            } finally {
                this.indexing = false;

                // Dispose cancellation token
                if (this.cancellationTokenSource) {
                    this.cancellationTokenSource.dispose();
                    this.cancellationTokenSource = undefined;
                }
            }
        });
    }

    async indexFile(uri: vscode.Uri): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const symbols = await this.extractSymbols(document);

            if (symbols.length > 0) {
                this.symbols.set(uri.toString(), symbols);
            }

            // Update modification time
            const stat = await vscode.workspace.fs.stat(uri);
            this.fileModTimes.set(uri.toString(), stat.mtime);

            // Remove from failed files if it was previously failing
            if (this.failedFiles.has(uri.toString())) {
                this.failedFiles.delete(uri.toString());
            }
        } catch (error) {
            // Log error and track failed file
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Failed to index ${uri.fsPath}: ${errorMessage}`);
            this.failedFiles.set(uri.toString(), errorMessage);

            // Continue processing - don't throw, just log
        }
    }

    /**
     * Index file only if it has been modified since last indexing
     * @returns true if file was skipped (unchanged), false if it was indexed
     */
    private async indexFileIncremental(uri: vscode.Uri): Promise<boolean> {
        try {
            // Check if file has been modified
            const stat = await vscode.workspace.fs.stat(uri);
            const lastModified = this.fileModTimes.get(uri.toString());

            // Skip if file hasn't changed
            if (lastModified && lastModified >= stat.mtime) {
                return true; // Skipped
            }

            // File is new or modified, index it
            await this.indexFile(uri);
            return false; // Indexed
        } catch (error) {
            // If we can't stat the file, try to index it anyway
            await this.indexFile(uri);
            return false; // Attempted to index
        }
    }

    /**
     * Yield to event loop and provide garbage collection hint
     */
    private async yieldAndCleanup(): Promise<void> {
        // Yield to event loop to prevent blocking UI
        await new Promise(resolve => setImmediate(resolve));

        // Hint to V8 to consider garbage collection
        // This helps release memory between batches
        if (global.gc) {
            global.gc();
        }
    }

    /**
     * Cancel ongoing indexing operation
     */
    cancelIndexing(): void {
        if (this.cancellationTokenSource) {
            this.cancellationTokenSource.cancel();
            this.outputChannel.appendLine('Cancellation requested');
        }
    }

    private async extractSymbols(document: vscode.TextDocument): Promise<RubySymbol[]> {
        const symbols: RubySymbol[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        let currentClass: string | undefined;
        let currentModule: string | undefined;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Skip comments and empty lines
            if (trimmed.startsWith('#') || trimmed.length === 0) {
                continue;
            }

            // Match class definitions
            const classMatch = trimmed.match(/^class\s+([A-Z][A-Za-z0-9_:]*)/);
            if (classMatch) {
                const className = classMatch[1];
                currentClass = className;
                symbols.push({
                    name: className,
                    kind: vscode.SymbolKind.Class,
                    location: new vscode.Location(
                        document.uri,
                        new vscode.Position(i, line.indexOf('class'))
                    ),
                    containerName: currentModule,
                    detail: 'class'
                });
            }

            // Match module definitions
            const moduleMatch = trimmed.match(/^module\s+([A-Z][A-Za-z0-9_:]*)/);
            if (moduleMatch) {
                const moduleName = moduleMatch[1];
                currentModule = moduleName;
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

            // Match method definitions
            const methodMatch = trimmed.match(/^def\s+(self\.)?([a-z_][a-z0-9_?!=]*)/);
            if (methodMatch) {
                const isSelfMethod = !!methodMatch[1];
                const methodName = methodMatch[2];
                const containerName = currentClass || currentModule;

                symbols.push({
                    name: methodName,
                    kind: vscode.SymbolKind.Method,
                    location: new vscode.Location(
                        document.uri,
                        new vscode.Position(i, line.indexOf('def'))
                    ),
                    containerName,
                    scope: isSelfMethod ? 'singleton' : 'instance',
                    detail: isSelfMethod ? 'class method' : 'instance method'
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

            // Match attr_accessor, attr_reader, attr_writer
            const attrMatch = trimmed.match(/^attr_(accessor|reader|writer)\s+:([a-z_][a-z0-9_]*)/);
            if (attrMatch) {
                const attrName = attrMatch[2];
                symbols.push({
                    name: attrName,
                    kind: vscode.SymbolKind.Property,
                    location: new vscode.Location(
                        document.uri,
                        new vscode.Position(i, line.indexOf(attrName))
                    ),
                    containerName: currentClass,
                    detail: attrMatch[1]
                });
            }

            // Reset scope on 'end'
            if (trimmed === 'end') {
                // Simple heuristic: assume we're closing the current class/module
                currentClass = undefined;
            }
        }

        return symbols;
    }

    findClasses(query: string): RubySymbol[] {
        const results: RubySymbol[] = [];
        const lowerQuery = query.toLowerCase();

        for (const symbols of this.symbols.values()) {
            for (const symbol of symbols) {
                if (symbol.kind === vscode.SymbolKind.Class || symbol.kind === vscode.SymbolKind.Module) {
                    if (this.fuzzyMatch(symbol.name, query)) {
                        results.push(symbol);
                    }
                }
            }
        }

        // Sort by relevance
        return results.sort((a, b) => {
            const aScore = this.matchScore(a.name, query);
            const bScore = this.matchScore(b.name, query);
            return bScore - aScore;
        });
    }

    findSymbols(query: string): RubySymbol[] {
        const results: RubySymbol[] = [];

        for (const symbols of this.symbols.values()) {
            for (const symbol of symbols) {
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

    getFileSymbols(uri: vscode.Uri): RubySymbol[] {
        return this.symbols.get(uri.toString()) || [];
    }

    private fuzzyMatch(text: string, query: string): boolean {
        const textLower = text.toLowerCase();
        const queryLower = query.toLowerCase();

        // Exact match
        if (textLower.includes(queryLower)) {
            return true;
        }

        // Fuzzy match - all query characters must appear in order
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

    private matchScore(text: string, query: string): number {
        const textLower = text.toLowerCase();
        const queryLower = query.toLowerCase();
        let score = 0;

        // Exact match gets highest score
        if (text === query) {
            return 1000;
        }

        // Case-insensitive exact match
        if (textLower === queryLower) {
            return 900;
        }

        // Starts with query (case-insensitive)
        if (textLower.startsWith(queryLower)) {
            return 800;
        }

        // Contains query as whole word
        if (textLower.includes(queryLower)) {
            return 700;
        }

        // Fuzzy match score based on character positions
        let lastIndex = -1;
        let consecutiveMatches = 0;
        for (let i = 0; i < queryLower.length; i++) {
            const char = queryLower[i];
            const index = textLower.indexOf(char, lastIndex + 1);
            if (index === -1) {
                return 0;
            }

            // Bonus for consecutive characters
            if (index === lastIndex + 1) {
                consecutiveMatches++;
                score += 10 * consecutiveMatches;
            } else {
                consecutiveMatches = 0;
            }

            // Bonus for matching at word boundaries (after underscore or capital)
            if (index === 0 || text[index - 1] === '_' || /[A-Z]/.test(text[index])) {
                score += 20;
            }

            score += 1;
            lastIndex = index;
        }

        return score;
    }

    getFailedFiles(): Map<string, string> {
        return new Map(this.failedFiles);
    }

    clearFailedFiles(): void {
        this.failedFiles.clear();
    }

    dispose(): void {
        // Cancel any ongoing indexing
        this.cancelIndexing();

        // Clean up all maps
        this.symbols.clear();
        this.failedFiles.clear();
        this.fileModTimes.clear();

        // Dispose cancellation token
        if (this.cancellationTokenSource) {
            this.cancellationTokenSource.dispose();
            this.cancellationTokenSource = undefined;
        }
    }
}

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

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    async indexWorkspace(): Promise<void> {
        if (this.indexing) {
            return;
        }

        this.indexing = true;
        this.symbols.clear();

        try {
            this.outputChannel.appendLine('Indexing Ruby symbols...');
            const startTime = Date.now();

            // Find all Ruby files
            const files = await vscode.workspace.findFiles(
                '**/*.rb',
                '{**/node_modules/**,**/vendor/**,**/tmp/**,.git/**}'
            );

            this.outputChannel.appendLine(`Found ${files.length} Ruby files`);

            // Index files in batches to avoid blocking
            const batchSize = 50;
            for (let i = 0; i < files.length; i += batchSize) {
                const batch = files.slice(i, i + batchSize);
                await Promise.all(batch.map(uri => this.indexFile(uri)));
            }

            const duration = Date.now() - startTime;
            const totalSymbols = Array.from(this.symbols.values()).reduce((sum, arr) => sum + arr.length, 0);
            this.outputChannel.appendLine(`Indexed ${totalSymbols} symbols in ${duration}ms`);
        } catch (error) {
            this.outputChannel.appendLine(`Error indexing workspace: ${error}`);
        } finally {
            this.indexing = false;
        }
    }

    async indexFile(uri: vscode.Uri): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const symbols = await this.extractSymbols(document);

            if (symbols.length > 0) {
                this.symbols.set(uri.toString(), symbols);
            }
        } catch (error) {
            // Silently skip files that can't be indexed
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

    dispose(): void {
        this.symbols.clear();
    }
}

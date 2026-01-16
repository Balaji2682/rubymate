import * as vscode from 'vscode';
import { AdvancedRubyIndexer } from '../advancedIndexer';
import { CallGraphIndex, MethodCall } from '../shared/indexes/callGraphIndex';
import { LRUCache } from '../shared/dataStructures/lruCache';

/**
 * Provides call hierarchy like IDE Ctrl+Alt+H
 * Shows incoming calls (who calls this method) and outgoing calls (what this method calls)
 *
 * Performance: Uses CallGraphIndex for O(1) caller/callee lookups
 * and LRUCache to cache file parsing results
 */
export class RubyCallHierarchyProvider implements vscode.CallHierarchyProvider {
    // Performance: Use CallGraphIndex for fast call tracking
    private callGraph: CallGraphIndex = new CallGraphIndex();

    // Performance: Cache parsed file calls to avoid re-parsing
    private fileCallCache: LRUCache<string, MethodCall[]>;

    constructor(private indexer: AdvancedRubyIndexer) {
        // Performance: 100 files cached, 60 second TTL
        this.fileCallCache = new LRUCache<string, MethodCall[]>({ maxSize: 100, maxAge: 60000 });
    }

    async prepareCallHierarchy(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.CallHierarchyItem | vscode.CallHierarchyItem[] | undefined> {
        if (token.isCancellationRequested) {
            return undefined;
        }

        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);

        // Find methods with this name
        const symbols = this.indexer.findSymbols(word, vscode.SymbolKind.Method);
        if (symbols.length === 0) {
            // Also try functions
            const functionSymbols = this.indexer.findSymbols(word, vscode.SymbolKind.Function);
            if (functionSymbols.length === 0) {
                return undefined;
            }
            symbols.push(...functionSymbols);
        }

        // Create CallHierarchyItems
        return symbols.map(symbol => {
            const containerName = symbol.containerName || 'Global';
            return new vscode.CallHierarchyItem(
                vscode.SymbolKind.Method,
                symbol.name,
                `in ${containerName}`,
                symbol.location.uri,
                symbol.location.range,
                symbol.location.range
            );
        });
    }

    /**
     * Build call graph index for a file
     * Performance: Parses file once and stores all method calls for fast lookups
     */
    private async buildFileCallGraph(fileUri: vscode.Uri, document: vscode.TextDocument): Promise<MethodCall[]> {
        const uriStr = fileUri.toString();

        // Performance: Check cache first
        const cached = this.fileCallCache.get(uriStr);
        if (cached) {
            return cached;
        }

        const calls: MethodCall[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        let currentMethod: { name: string; containerName?: string; startLine: number } | undefined;
        let currentClass: string | undefined;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Skip comments
            if (trimmed.startsWith('#')) continue;

            // Track class context
            const classMatch = trimmed.match(/^class\s+([A-Z][A-Za-z0-9_:]*)/);
            if (classMatch) {
                currentClass = classMatch[1];
                continue;
            }

            // Track method definitions
            const methodMatch = trimmed.match(/^def\s+(self\.)?([a-z_][a-z0-9_?!=]*)/);
            if (methodMatch) {
                currentMethod = {
                    name: methodMatch[2],
                    containerName: currentClass,
                    startLine: i
                };

                // Add method to call graph index
                this.callGraph.addMethod(methodMatch[2], currentClass, {
                    uri: uriStr,
                    startLine: i,
                    startColumn: line.indexOf('def'),
                    endLine: i,
                    endColumn: line.length
                }, {
                    isClassMethod: !!methodMatch[1]
                });
                continue;
            }

            // Find method calls within current method
            if (currentMethod) {
                // Match: .method_name, method_name(), self.method_name
                const callPatterns = [
                    /\.([a-z_][a-z0-9_?!]*)\s*(?:\(|$|[^a-z0-9_])/g,
                    /\b([a-z_][a-z0-9_?!]*)\s*\(/g,
                ];

                for (const pattern of callPatterns) {
                    let match;
                    while ((match = pattern.exec(trimmed)) !== null) {
                        const methodName = match[1];
                        // Skip Ruby keywords
                        if (['if', 'unless', 'while', 'until', 'for', 'case', 'when', 'begin', 'rescue', 'end', 'return', 'yield', 'raise', 'puts', 'print', 'require', 'include'].includes(methodName)) {
                            continue;
                        }

                        const call: MethodCall = {
                            caller: {
                                name: currentMethod.name,
                                containerName: currentMethod.containerName,
                                location: {
                                    uri: uriStr,
                                    startLine: currentMethod.startLine,
                                    startColumn: 0,
                                    endLine: currentMethod.startLine,
                                    endColumn: 0
                                }
                            },
                            callee: {
                                name: methodName
                            },
                            callLocation: {
                                uri: uriStr,
                                startLine: i,
                                startColumn: line.indexOf(methodName),
                                endLine: i,
                                endColumn: line.indexOf(methodName) + methodName.length
                            }
                        };

                        calls.push(call);
                        this.callGraph.addCall(call);
                    }
                }
            }

            // End of method
            if (trimmed === 'end' && currentMethod) {
                currentMethod = undefined;
            }
        }

        // Performance: Cache the parsed calls
        this.fileCallCache.set(uriStr, calls);
        return calls;
    }

    async provideCallHierarchyIncomingCalls(
        item: vscode.CallHierarchyItem,
        token: vscode.CancellationToken
    ): Promise<vscode.CallHierarchyIncomingCall[] | undefined> {
        if (token.isCancellationRequested) {
            return undefined;
        }

        const incomingCalls: vscode.CallHierarchyIncomingCall[] = [];

        // Performance: First check CallGraphIndex for cached callers
        const containerName = item.detail?.replace('in ', '') || undefined;
        const indexedCallers = this.callGraph.getCallers(item.name, containerName);

        if (indexedCallers.length > 0) {
            // Use cached results from CallGraphIndex
            for (const call of indexedCallers) {
                const fromItem = new vscode.CallHierarchyItem(
                    vscode.SymbolKind.Method,
                    call.caller.name,
                    call.caller.containerName || '',
                    vscode.Uri.parse(call.caller.location.uri),
                    new vscode.Range(
                        call.caller.location.startLine, call.caller.location.startColumn,
                        call.caller.location.endLine, call.caller.location.endColumn
                    ),
                    new vscode.Range(
                        call.caller.location.startLine, call.caller.location.startColumn,
                        call.caller.location.endLine, call.caller.location.endColumn
                    )
                );

                incomingCalls.push(
                    new vscode.CallHierarchyIncomingCall(fromItem, [
                        new vscode.Range(
                            call.callLocation.startLine, call.callLocation.startColumn,
                            call.callLocation.endLine, call.callLocation.endColumn
                        )
                    ])
                );
            }
        }

        // If no cached results, scan workspace and build index
        if (incomingCalls.length === 0) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                return undefined;
            }

            for (const folder of workspaceFolders) {
                const files = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(folder, '**/*.rb'),
                    '**/node_modules/**'
                );

                for (const fileUri of files) {
                    if (token.isCancellationRequested) {
                        break;
                    }

                    try {
                        const document = await vscode.workspace.openTextDocument(fileUri);

                        // Performance: Build call graph index for this file
                        await this.buildFileCallGraph(fileUri, document);

                        const calls = await this.findMethodCalls(document, item.name);

                        for (const call of calls) {
                            // Find the method that contains this call
                            const containingMethod = this.findContainingMethod(document, call.range.start);

                            if (containingMethod) {
                                const fromItem = new vscode.CallHierarchyItem(
                                    vscode.SymbolKind.Method,
                                    containingMethod.name,
                                    containingMethod.containerName || '',
                                    document.uri,
                                    containingMethod.range,
                                    containingMethod.range
                                );

                                incomingCalls.push(
                                    new vscode.CallHierarchyIncomingCall(fromItem, [call.range])
                                );
                            }
                        }
                    } catch (error) {
                        // Skip files that can't be read
                        continue;
                    }
                }
            }
        }

        return incomingCalls.length > 0 ? incomingCalls : undefined;
    }

    async provideCallHierarchyOutgoingCalls(
        item: vscode.CallHierarchyItem,
        token: vscode.CancellationToken
    ): Promise<vscode.CallHierarchyOutgoingCall[] | undefined> {
        if (token.isCancellationRequested) {
            return undefined;
        }

        const outgoingCalls: vscode.CallHierarchyOutgoingCall[] = [];

        try {
            const document = await vscode.workspace.openTextDocument(item.uri);
            const methodBody = document.getText(item.range);

            // Find all method calls within this method
            // Matches: .method_name, method_name(), self.method_name
            const callPatterns = [
                /\.(\w+)/g,                    // .method_name
                /(\w+)\s*\(/g,                 // method_name(
                /self\.(\w+)/g,                // self.method_name
                /super/g,                      // super calls
            ];

            const calledMethods = new Set<string>();

            for (const pattern of callPatterns) {
                let match;
                while ((match = pattern.exec(methodBody)) !== null) {
                    if (match[1]) {
                        calledMethods.add(match[1]);
                    } else if (match[0] === 'super') {
                        calledMethods.add(item.name); // super calls the same method name in parent
                    }
                }
            }

            // For each called method, try to find its definition
            for (const methodName of calledMethods) {
                if (token.isCancellationRequested) {
                    break;
                }

                const symbols = this.indexer.findSymbols(methodName, vscode.SymbolKind.Method);

                for (const symbol of symbols) {
                    const toItem = new vscode.CallHierarchyItem(
                        vscode.SymbolKind.Method,
                        symbol.name,
                        symbol.containerName || '',
                        symbol.location.uri,
                        symbol.location.range,
                        symbol.location.range
                    );

                    // Find where in the current method this call occurs
                    const callRanges = await this.findMethodCalls(document, methodName, item.range);

                    outgoingCalls.push(
                        new vscode.CallHierarchyOutgoingCall(toItem, callRanges.map(c => c.range))
                    );
                }
            }
        } catch (error) {
            return undefined;
        }

        return outgoingCalls.length > 0 ? outgoingCalls : undefined;
    }

    private async findMethodCalls(
        document: vscode.TextDocument,
        methodName: string,
        withinRange?: vscode.Range
    ): Promise<{ range: vscode.Range }[]> {
        const calls: { range: vscode.Range }[] = [];
        const text = withinRange ? document.getText(withinRange) : document.getText();
        const startOffset = withinRange ? document.offsetAt(withinRange.start) : 0;

        // Pattern to match method calls
        const patterns = [
            new RegExp(`\\.${methodName}\\b`, 'g'),        // .method_name
            new RegExp(`\\b${methodName}\\s*\\(`, 'g'),    // method_name(
            new RegExp(`\\b${methodName}\\s+\\w`, 'g'),    // method_name arg
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const position = document.positionAt(startOffset + match.index);
                const line = document.lineAt(position.line);

                // Skip comments and strings
                if (line.text.trim().startsWith('#')) {
                    continue;
                }

                const range = new vscode.Range(
                    position,
                    document.positionAt(startOffset + match.index + match[0].length)
                );

                calls.push({ range });
            }
        }

        return calls;
    }

    private findContainingMethod(
        document: vscode.TextDocument,
        position: vscode.Position
    ): { name: string; containerName?: string; range: vscode.Range } | undefined {
        // Get all methods in this file
        const fileSymbols = this.indexer.getFileSymbols(document.uri);
        const methods = fileSymbols.filter(
            s => s.kind === vscode.SymbolKind.Method || s.kind === vscode.SymbolKind.Function
        );

        // Find method that contains this position
        for (const method of methods) {
            if (method.location.range.contains(position)) {
                return {
                    name: method.name,
                    containerName: method.containerName,
                    range: method.location.range
                };
            }
        }

        return undefined;
    }
}

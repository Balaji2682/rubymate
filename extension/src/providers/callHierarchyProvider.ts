import * as vscode from 'vscode';
import { CoreRubyIndex } from '../indexing/coreRubyIndex';
import { CallGraphIndex, MethodCall } from '../shared/indexes/callGraphIndex';
import { LRUCache } from '../shared/dataStructures/lruCache';
import { ParserService } from '../parsing';
import { getRubyLookupCandidates, getRubyTokenAtPosition } from '../shared/rubyToken';

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

    constructor(
        private indexer: CoreRubyIndex,
        private readonly parserService?: ParserService
    ) {
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

        await this.indexer.indexDocument(document, true);

        const rubyToken = getRubyTokenAtPosition(document, position);
        if (!rubyToken) {
            return undefined;
        }

        const candidates = getRubyLookupCandidates(rubyToken.text);

        // Find methods with this name
        const symbols = candidates.flatMap(candidate => this.indexer.findSymbols(candidate, vscode.SymbolKind.Method));
        if (symbols.length === 0) {
            // Also try functions
            const functionSymbols = candidates.flatMap(candidate => this.indexer.findSymbols(candidate, vscode.SymbolKind.Function));
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

        if (!this.parserService) {
            this.fileCallCache.set(uriStr, calls);
            return calls;
        }

        const parsed = await this.parserService.parseRuby(document);
        for (const { method, call } of this.parserService.collectMethodCalls(parsed.value)) {
            const containerName = method.metadata.get('containerName') as string | undefined;
            const mappedCall: MethodCall = {
                caller: {
                    name: method.name,
                    containerName,
                    location: {
                        uri: uriStr,
                        startLine: method.range.start.line,
                        startColumn: method.range.start.character,
                        endLine: method.range.end.line,
                        endColumn: method.range.end.character
                    }
                },
                callee: {
                    name: call.method
                },
                callLocation: {
                    uri: uriStr,
                    startLine: call.location.line,
                    startColumn: call.location.character,
                    endLine: call.location.line,
                    endColumn: call.location.character + call.method.length
                }
            };

            calls.push(mappedCall);
            this.callGraph.addMethod(method.name, containerName, mappedCall.caller.location, {
                isClassMethod: method.isClassMethod
            });
            this.callGraph.addCall(mappedCall);
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
                            const containingMethod = await this.findContainingMethod(document, call.range.start);

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
            const calls = await this.buildFileCallGraph(item.uri, document);
            const selectedCalls = calls.filter(call => this.isCallFromHierarchyItem(call, item));
            const callRangesByMethod = new Map<string, vscode.Range[]>();

            for (const call of selectedCalls) {
                const ranges = callRangesByMethod.get(call.callee.name) ?? [];
                ranges.push(this.rangeFromCallLocation(call.callLocation));
                callRangesByMethod.set(call.callee.name, ranges);
            }

            // For each called method, try to find its definition
            for (const [methodName, callRanges] of callRangesByMethod) {
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

                    outgoingCalls.push(
                        new vscode.CallHierarchyOutgoingCall(toItem, callRanges)
                    );
                }
            }
        } catch (error) {
            return undefined;
        }

        return outgoingCalls.length > 0 ? outgoingCalls : undefined;
    }

    private isCallFromHierarchyItem(call: MethodCall, item: vscode.CallHierarchyItem): boolean {
        if (call.caller.name !== item.name || call.caller.location.uri !== item.uri.toString()) {
            return false;
        }

        const itemContainer = this.containerNameFromHierarchyItem(item);
        if (itemContainer && call.caller.containerName && itemContainer !== call.caller.containerName) {
            return false;
        }

        return this.rangeFromCallLocation(call.caller.location).intersection(item.range) !== undefined;
    }

    private containerNameFromHierarchyItem(item: vscode.CallHierarchyItem): string | undefined {
        const detail = item.detail?.trim();
        if (!detail || detail === 'Global') {
            return undefined;
        }

        const containerName = detail.startsWith('in ') ? detail.slice(3).trim() : detail;
        return containerName === 'Global' ? undefined : containerName;
    }

    private rangeFromCallLocation(location: MethodCall['callLocation']): vscode.Range {
        return new vscode.Range(
            location.startLine,
            location.startColumn,
            location.endLine,
            location.endColumn
        );
    }

    private async findMethodCalls(
        document: vscode.TextDocument,
        methodName: string,
        withinRange?: vscode.Range
    ): Promise<{ range: vscode.Range }[]> {
        if (!this.parserService) {
            return [];
        }

        return (await this.parserService.findMethodCallRanges(document, methodName, withinRange))
            .map(range => ({ range }));
    }

    private async findContainingMethod(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<{ name: string; containerName?: string; range: vscode.Range } | undefined> {
        if (this.parserService) {
            const method = await this.parserService.findContainingMethod(document, position);
            if (method) {
                return {
                    name: method.name,
                    containerName: method.metadata.get('containerName') as string | undefined,
                    range: method.range
                };
            }
        }

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

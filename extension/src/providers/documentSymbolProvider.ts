import * as vscode from 'vscode';
import { AdvancedRubyIndexer } from '../advancedIndexer';

export class RubyDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    private symbolIndexer: AdvancedRubyIndexer;

    constructor(symbolIndexer: AdvancedRubyIndexer) {
        this.symbolIndexer = symbolIndexer;
    }

    provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentSymbol[] | vscode.SymbolInformation[]> {
        if (token.isCancellationRequested || document.languageId !== 'ruby') {
            return [];
        }

        const symbols = this.symbolIndexer.getFileSymbols(document.uri);

        // Group symbols by container for hierarchical view
        const documentSymbols = new Map<string, vscode.DocumentSymbol>();
        const rootSymbols: vscode.DocumentSymbol[] = [];

        for (const symbol of symbols) {
            const range = symbol.location.range;
            const selectionRange = new vscode.Range(
                range.start.line,
                range.start.character,
                range.start.line,
                range.start.character + symbol.name.length
            );

            const docSymbol = new vscode.DocumentSymbol(
                symbol.name,
                symbol.detail || '',
                symbol.kind,
                range,
                selectionRange
            );

            if (symbol.containerName) {
                // Add as child of container
                const container = documentSymbols.get(symbol.containerName);
                if (container) {
                    container.children.push(docSymbol);
                } else {
                    // Container not found yet, add to root for now
                    rootSymbols.push(docSymbol);
                }
            } else {
                // Top-level symbol
                rootSymbols.push(docSymbol);
                documentSymbols.set(symbol.name, docSymbol);
            }
        }

        return rootSymbols;
    }
}

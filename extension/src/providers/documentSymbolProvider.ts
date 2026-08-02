import * as vscode from 'vscode';
import { CoreRubyIndex } from '../indexing/coreRubyIndex';

export class RubyDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    private symbolIndexer: CoreRubyIndex;

    constructor(symbolIndexer: CoreRubyIndex) {
        this.symbolIndexer = symbolIndexer;
    }

    async provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.DocumentSymbol[] | vscode.SymbolInformation[]> {
        if (token.isCancellationRequested || document.languageId !== 'ruby') {
            return [];
        }

        await this.symbolIndexer.indexDocument(document, true);

        const symbols = this.symbolIndexer.getDocumentSymbols(document.uri);

        // Group symbols by container for hierarchical view
        const documentSymbols = new Map<string, vscode.DocumentSymbol>();
        const rootSymbols: vscode.DocumentSymbol[] = [];

        for (const symbol of symbols) {
            const range = symbol.location.range;

            // Calculate selectionRange ensuring it's contained within range
            const selectionEnd = new vscode.Position(
                range.start.line,
                Math.min(range.start.character + symbol.name.length, range.end.character)
            );

            // Ensure selectionRange is valid and contained in range
            const selectionRange = new vscode.Range(
                range.start,
                selectionEnd.isAfter(range.end) ? range.end : selectionEnd
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
            }

            documentSymbols.set(symbol.name, docSymbol);
            if (symbol.containerName) {
                documentSymbols.set(`${symbol.containerName}::${symbol.name}`, docSymbol);
            }
        }

        return rootSymbols;
    }
}

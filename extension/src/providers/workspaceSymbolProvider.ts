import * as vscode from 'vscode';
import { AdvancedRubyIndexer } from '../advancedIndexer';

export class RubyWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
    private symbolIndexer: AdvancedRubyIndexer;

    constructor(symbolIndexer: AdvancedRubyIndexer) {
        this.symbolIndexer = symbolIndexer;
    }

    provideWorkspaceSymbols(
        query: string,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.SymbolInformation[]> {
        if (token.isCancellationRequested) {
            return [];
        }

        const symbols = this.symbolIndexer.findSymbols(query);

        return symbols.map(symbol => {
            return new vscode.SymbolInformation(
                symbol.name,
                symbol.kind,
                symbol.containerName || '',
                symbol.location
            );
        });
    }
}

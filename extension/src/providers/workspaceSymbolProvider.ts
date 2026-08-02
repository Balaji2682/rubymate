import * as vscode from 'vscode';
import { CoreRubyIndex } from '../indexing/coreRubyIndex';

export class RubyWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
    private symbolIndexer: CoreRubyIndex;

    constructor(symbolIndexer: CoreRubyIndex) {
        this.symbolIndexer = symbolIndexer;
    }

    async provideWorkspaceSymbols(
        query: string,
        token: vscode.CancellationToken
    ): Promise<vscode.SymbolInformation[]> {
        if (token.isCancellationRequested) {
            return [];
        }

        await this.symbolIndexer.indexOpenDocuments(true);

        const symbols = this.symbolIndexer.findWorkspaceSymbols(query);

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

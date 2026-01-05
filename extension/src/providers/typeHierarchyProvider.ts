import * as vscode from 'vscode';
import { AdvancedRubyIndexer } from '../advancedIndexer';

/**
 * Provides type hierarchy like IDE's Ctrl+H
 * Shows class inheritance tree (superclasses and subclasses)
 */
export class RubyTypeHierarchyProvider implements vscode.TypeHierarchyProvider {
    constructor(private indexer: AdvancedRubyIndexer) {}

    async prepareTypeHierarchy(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.TypeHierarchyItem | vscode.TypeHierarchyItem[] | undefined> {
        if (token.isCancellationRequested) {
            return undefined;
        }

        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);

        // Find the class or module
        const symbols = this.indexer.findClasses(word);
        if (symbols.length === 0) {
            return undefined;
        }

        const symbol = symbols[0];

        // Create TypeHierarchyItem
        return new vscode.TypeHierarchyItem(
            symbol.kind === vscode.SymbolKind.Class ? vscode.SymbolKind.Class : vscode.SymbolKind.Module,
            symbol.name,
            symbol.detail || '',
            symbol.location.uri,
            symbol.location.range,
            symbol.location.range
        );
    }

    async provideTypeHierarchySupertypes(
        item: vscode.TypeHierarchyItem,
        token: vscode.CancellationToken
    ): Promise<vscode.TypeHierarchyItem[] | undefined> {
        if (token.isCancellationRequested) {
            return undefined;
        }

        const supertypes: vscode.TypeHierarchyItem[] = [];

        try {
            // Read the file to find superclass
            const document = await vscode.workspace.openTextDocument(item.uri);
            const text = document.getText();

            // Find class definition with superclass
            // Matches: class ClassName < SuperClass
            const classRegex = new RegExp(`class\\s+${item.name}\\s+<\\s+(\\w+(?:::\\w+)*)`, 'm');
            const match = classRegex.exec(text);

            if (match && match[1]) {
                const superclassName = match[1];

                // Find the superclass symbol
                const superclassSymbols = this.indexer.findClasses(superclassName);
                if (superclassSymbols.length > 0) {
                    const superSymbol = superclassSymbols[0];
                    supertypes.push(
                        new vscode.TypeHierarchyItem(
                            vscode.SymbolKind.Class,
                            superSymbol.name,
                            superSymbol.detail || '',
                            superSymbol.location.uri,
                            superSymbol.location.range,
                            superSymbol.location.range
                        )
                    );
                }
            }

            // Find included modules
            // Matches: include ModuleName
            const includeRegex = /include\s+(\w+(?:::\w+)*)/gm;
            let includeMatch;
            while ((includeMatch = includeRegex.exec(text)) !== null) {
                const moduleName = includeMatch[1];
                const moduleSymbols = this.indexer.findSymbols(moduleName, vscode.SymbolKind.Module);

                if (moduleSymbols.length > 0) {
                    const moduleSymbol = moduleSymbols[0];
                    supertypes.push(
                        new vscode.TypeHierarchyItem(
                            vscode.SymbolKind.Module,
                            moduleSymbol.name,
                            'included',
                            moduleSymbol.location.uri,
                            moduleSymbol.location.range,
                            moduleSymbol.location.range
                        )
                    );
                }
            }

            // Find extended modules
            // Matches: extend ModuleName
            const extendRegex = /extend\s+(\w+(?:::\w+)*)/gm;
            let extendMatch;
            while ((extendMatch = extendRegex.exec(text)) !== null) {
                const moduleName = extendMatch[1];
                const moduleSymbols = this.indexer.findSymbols(moduleName, vscode.SymbolKind.Module);

                if (moduleSymbols.length > 0) {
                    const moduleSymbol = moduleSymbols[0];
                    supertypes.push(
                        new vscode.TypeHierarchyItem(
                            vscode.SymbolKind.Module,
                            moduleSymbol.name,
                            'extended',
                            moduleSymbol.location.uri,
                            moduleSymbol.location.range,
                            moduleSymbol.location.range
                        )
                    );
                }
            }
        } catch (error) {
            // File might not be accessible
            return undefined;
        }

        return supertypes.length > 0 ? supertypes : undefined;
    }

    async provideTypeHierarchySubtypes(
        item: vscode.TypeHierarchyItem,
        token: vscode.CancellationToken
    ): Promise<vscode.TypeHierarchyItem[] | undefined> {
        if (token.isCancellationRequested) {
            return undefined;
        }

        const subtypes: vscode.TypeHierarchyItem[] = [];

        // Find all classes in the workspace
        const allClasses = this.indexer.findSymbols('', vscode.SymbolKind.Class);

        for (const classSymbol of allClasses) {
            if (token.isCancellationRequested) {
                break;
            }

            try {
                const document = await vscode.workspace.openTextDocument(classSymbol.location.uri);
                const text = document.getText();

                // Check if this class inherits from our target class
                const inheritRegex = new RegExp(`class\\s+${classSymbol.name}\\s+<\\s+${item.name}\\b`, 'm');
                if (inheritRegex.test(text)) {
                    subtypes.push(
                        new vscode.TypeHierarchyItem(
                            vscode.SymbolKind.Class,
                            classSymbol.name,
                            classSymbol.detail || '',
                            classSymbol.location.uri,
                            classSymbol.location.range,
                            classSymbol.location.range
                        )
                    );
                }
            } catch (error) {
                // Skip files that can't be read
                continue;
            }
        }

        return subtypes.length > 0 ? subtypes : undefined;
    }
}

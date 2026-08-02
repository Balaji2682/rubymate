import * as vscode from 'vscode';
import { CoreRubyIndex } from '../indexing/coreRubyIndex';
import { ClassNode, NodeType } from '../indexing/rubyParser';
import { ParserService } from '../parsing';
import { getRubyLookupCandidates, getRubyTokenAtPosition } from '../shared/rubyToken';

/**
 * Provides type hierarchy like IDE's Ctrl+H
 * Shows class inheritance tree (superclasses and subclasses)
 */
export class RubyTypeHierarchyProvider implements vscode.TypeHierarchyProvider {
    constructor(
        private indexer: CoreRubyIndex,
        private readonly parserService?: ParserService
    ) {}

    async prepareTypeHierarchy(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.TypeHierarchyItem | vscode.TypeHierarchyItem[] | undefined> {
        if (token.isCancellationRequested) {
            return undefined;
        }

        await this.indexer.indexDocument(document, true);

        const rubyToken = getRubyTokenAtPosition(document, position);
        if (!rubyToken) {
            return undefined;
        }

        const candidates = getRubyLookupCandidates(rubyToken.text);

        // Find the class or module
        const symbols = candidates.flatMap(candidate => this.indexer.findClasses(candidate));
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
            const document = await vscode.workspace.openTextDocument(item.uri);
            const classNode = await this.findClassNode(document, item.name);

            if (classNode?.superclass) {
                const superclassName = classNode.superclass;

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

            for (const moduleName of classNode?.mixins || []) {
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
                const classNode = await this.findClassNode(document, classSymbol.name);
                if (classNode?.superclass === item.name) {
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

    private async findClassNode(document: vscode.TextDocument, name: string): Promise<ClassNode | undefined> {
        if (!this.parserService) {
            return undefined;
        }

        const parsed = await this.parserService.parseRuby(document);
        const stack = [...parsed.value];

        while (stack.length > 0) {
            const node = stack.shift()!;
            if (node.type === NodeType.Class) {
                const classNode = node as ClassNode;
                const rawName = classNode.metadata.get('rawName') || classNode.name.split('::').pop();
                if (classNode.name === name || rawName === name) {
                    return classNode;
                }
            }

            stack.push(...node.children);
        }

        return undefined;
    }
}

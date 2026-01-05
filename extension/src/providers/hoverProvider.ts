import * as vscode from 'vscode';
import { AdvancedRubyIndexer, RubySymbol } from '../advancedIndexer';
import { SorbetIntegration } from '../sorbetIntegration';

/**
 * Provides hover information like IDE Ctrl+Q (Quick Documentation)
 * Shows method signatures, parameter info, and documentation
 * Integrates with Sorbet for enhanced type information when available
 */
export class RubyHoverProvider implements vscode.HoverProvider {
    constructor(
        private indexer: AdvancedRubyIndexer,
        private sorbetIntegration?: SorbetIntegration
    ) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        if (token.isCancellationRequested) {
            return undefined;
        }

        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const line = document.lineAt(position.line).text;

        // Build base hover from RubyMate index
        let baseHover: vscode.Hover | null = null;
        const symbols = this.indexer.findSymbols(word);

        if (symbols.length > 0) {
            // Prioritize by context
            const symbol = this.findBestMatch(symbols, word, line, document, position);
            if (symbol) {
                // Build hover content from RubyMate
                const hoverContent = this.buildHoverContent(symbol);
                baseHover = new vscode.Hover(hoverContent, wordRange);
            }
        }

        // Enhance with Sorbet type information if available
        if (this.sorbetIntegration && this.sorbetIntegration.isSorbetAvailable()) {
            try {
                const enhancedHover = await this.sorbetIntegration.enhanceHover(
                    document,
                    position,
                    baseHover
                );

                if (enhancedHover) {
                    return enhancedHover;
                }
            } catch (error) {
                // Fall back to base hover if Sorbet enhancement fails
                console.error('[HOVER] Sorbet enhancement failed:', error);
            }
        }

        // Return base hover (or undefined if no symbols found)
        return baseHover || undefined;
    }

    private findBestMatch(
        symbols: RubySymbol[],
        word: string,
        line: string,
        document: vscode.TextDocument,
        position: vscode.Position
    ): RubySymbol | undefined {
        // Exact name match first
        const exactMatches = symbols.filter(s => s.name === word);
        if (exactMatches.length === 1) {
            return exactMatches[0];
        }

        // If multiple matches, try to determine from context
        if (exactMatches.length > 1) {
            // Check if it's a method call (has a dot before it)
            if (line.substring(0, position.character).match(/\.\s*\w+$/)) {
                const methodSymbols = exactMatches.filter(
                    s => s.kind === vscode.SymbolKind.Method || s.kind === vscode.SymbolKind.Function
                );
                if (methodSymbols.length > 0) {
                    return methodSymbols[0];
                }
            }

            // Check if it's a class (capitalized)
            if (/^[A-Z]/.test(word)) {
                const classSymbols = exactMatches.filter(
                    s => s.kind === vscode.SymbolKind.Class || s.kind === vscode.SymbolKind.Module
                );
                if (classSymbols.length > 0) {
                    return classSymbols[0];
                }
            }

            // Return first match as fallback
            return exactMatches[0];
        }

        return symbols[0];
    }

    private buildHoverContent(symbol: RubySymbol): vscode.MarkdownString {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        // Symbol kind icon
        const kindIcon = this.getKindIcon(symbol.kind);

        // Build signature
        let signature = '';
        switch (symbol.kind) {
            case vscode.SymbolKind.Class:
                signature = `class ${symbol.name}`;
                break;
            case vscode.SymbolKind.Module:
                signature = `module ${symbol.name}`;
                break;
            case vscode.SymbolKind.Method:
            case vscode.SymbolKind.Function:
                signature = this.buildMethodSignature(symbol);
                break;
            case vscode.SymbolKind.Constant:
                signature = `${symbol.name}`;
                break;
            default:
                signature = symbol.name;
        }

        // Add signature with syntax highlighting
        markdown.appendCodeblock(signature, 'ruby');

        // Add container info
        if (symbol.containerName) {
            markdown.appendMarkdown(`\n📦 Defined in: \`${symbol.containerName}\`\n`);
        }

        // Add file location
        const fileName = symbol.location.uri.fsPath.split('/').pop();
        const line = symbol.location.range.start.line + 1;
        markdown.appendMarkdown(`\n📄 ${fileName}:${line}\n`);

        // Add documentation if available
        if (symbol.documentation) {
            markdown.appendMarkdown(`\n---\n\n${symbol.documentation}\n`);
        }

        // Add parameter info for methods
        if (symbol.parameters && symbol.parameters.length > 0) {
            markdown.appendMarkdown('\n**Parameters:**\n');
            for (const param of symbol.parameters) {
                markdown.appendMarkdown(`- \`${param}\`\n`);
            }
        }

        // Add return type if available
        if (symbol.returnType) {
            markdown.appendMarkdown(`\n**Returns:** \`${symbol.returnType}\`\n`);
        }

        // Add usage count if tracked
        if (symbol.usageCount && symbol.usageCount > 0) {
            markdown.appendMarkdown(`\n💡 Used ${symbol.usageCount} time(s) in workspace\n`);
        }

        return markdown;
    }

    private buildMethodSignature(symbol: RubySymbol): string {
        let signature = 'def ';

        // Add scope prefix if available
        if (symbol.scope === 'singleton' || symbol.scope === 'class') {
            signature += 'self.';
        }

        signature += symbol.name;

        // Add parameters
        if (symbol.parameters && symbol.parameters.length > 0) {
            signature += `(${symbol.parameters.join(', ')})`;
        }

        return signature;
    }

    private getKindIcon(kind: vscode.SymbolKind): string {
        const icons: { [key: number]: string } = {
            [vscode.SymbolKind.Class]: '🏛️',
            [vscode.SymbolKind.Module]: '📦',
            [vscode.SymbolKind.Method]: '⚡',
            [vscode.SymbolKind.Function]: '⚙️',
            [vscode.SymbolKind.Constant]: '🔒',
            [vscode.SymbolKind.Variable]: '📝',
        };
        return icons[kind] || '📌';
    }
}

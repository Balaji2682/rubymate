/**
 * HTML Context Detector
 *
 * Shared utility for detecting HTML vs Ruby context in template files.
 * Also extracts controller scope from parent elements.
 */

import * as vscode from 'vscode';

// Pre-compiled regex patterns for performance
const ERB_OPEN_PATTERN = /<%/g;
const ERB_CLOSE_PATTERN = /%>/g;
const HAML_SLIM_HTML_CONTEXT = /[({]|^\s*%?\w+\s/;
const DATA_CONTROLLER_PATTERN = /data-controller\s*=\s*["']([^"']+)["']/g;

export interface HtmlContext {
    /** Whether cursor is in HTML context (not inside Ruby code) */
    isHtml: boolean;
    /** Controllers declared in scope (from data-controller on current/parent elements) */
    controllersInScope: string[];
}

export class HtmlContextDetector {
    /**
     * Check if position is in HTML context and extract controllers in scope
     */
    detectContext(document: vscode.TextDocument, position: vscode.Position): HtmlContext {
        const isHtml = this.isHtmlContext(document, position);
        const controllersInScope = isHtml
            ? this.extractControllersInScope(document, position)
            : [];

        return { isHtml, controllersInScope };
    }

    /**
     * Check if position is in HTML context (not inside Ruby code blocks)
     */
    isHtmlContext(document: vscode.TextDocument, position: vscode.Position): boolean {
        const languageId = document.languageId;

        switch (languageId) {
            case 'html':
                return true;

            case 'erb':
                return this.isHtmlContextInErb(document, position);

            case 'haml':
            case 'slim':
                return this.isHtmlContextInHamlSlim(document, position);

            default:
                return false;
        }
    }

    /**
     * ERB-specific HTML context detection
     */
    private isHtmlContextInErb(document: vscode.TextDocument, position: vscode.Position): boolean {
        const lineText = document.lineAt(position.line).text;
        const linePrefix = lineText.substring(0, position.character);

        // Count <% and %> to determine context
        // Reset patterns before use (they're global)
        ERB_OPEN_PATTERN.lastIndex = 0;
        ERB_CLOSE_PATTERN.lastIndex = 0;

        const openTags = (linePrefix.match(ERB_OPEN_PATTERN) || []).length;
        const closeTags = (linePrefix.match(ERB_CLOSE_PATTERN) || []).length;

        return openTags <= closeTags;
    }

    /**
     * Haml/Slim HTML context detection
     */
    private isHtmlContextInHamlSlim(document: vscode.TextDocument, position: vscode.Position): boolean {
        const lineText = document.lineAt(position.line).text;
        // In Haml/Slim, HTML attributes are in parentheses or after element
        return HAML_SLIM_HTML_CONTEXT.test(lineText);
    }

    /**
     * Extract controllers declared in scope by scanning current and parent elements
     *
     * This is a simplified approach that scans backwards in the document
     * looking for data-controller attributes. A full DOM parser would be
     * more accurate but significantly more complex.
     */
    private extractControllersInScope(
        document: vscode.TextDocument,
        position: vscode.Position
    ): string[] {
        const controllers = new Set<string>();
        const currentLine = position.line;

        // Scan current line first
        const lineText = document.lineAt(currentLine).text;
        this.extractControllersFromLine(lineText, controllers);

        // Scan backwards up to 50 lines to find parent elements
        // This is a heuristic - proper DOM parsing would be more accurate
        const maxScanLines = Math.min(50, currentLine);
        let indentLevel = this.getIndentLevel(lineText);

        for (let i = currentLine - 1; i >= currentLine - maxScanLines && i >= 0; i--) {
            const line = document.lineAt(i).text;
            const lineIndent = this.getIndentLevel(line);

            // Skip empty lines
            if (line.trim().length === 0) {
                continue;
            }

            // If we find a line with less indentation, it's likely a parent
            if (lineIndent < indentLevel) {
                this.extractControllersFromLine(line, controllers);
                indentLevel = lineIndent;
            }

            // Also check lines at same level for sibling elements that might be containers
            if (lineIndent === indentLevel && line.includes('data-controller')) {
                this.extractControllersFromLine(line, controllers);
            }

            // Stop if we hit the root level
            if (lineIndent === 0 && line.trim().startsWith('<')) {
                break;
            }
        }

        return Array.from(controllers);
    }

    /**
     * Extract controller names from a line containing data-controller
     */
    private extractControllersFromLine(line: string, controllers: Set<string>): void {
        DATA_CONTROLLER_PATTERN.lastIndex = 0;
        let match;

        while ((match = DATA_CONTROLLER_PATTERN.exec(line)) !== null) {
            const names = match[1].split(/\s+/);
            for (const name of names) {
                if (name.trim()) {
                    controllers.add(name.trim());
                }
            }
        }
    }

    /**
     * Get indentation level of a line
     */
    private getIndentLevel(line: string): number {
        const match = line.match(/^(\s*)/);
        return match ? match[1].length : 0;
    }
}

// Singleton instance for reuse
export const htmlContextDetector = new HtmlContextDetector();

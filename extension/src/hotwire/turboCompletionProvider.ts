/**
 * Turbo Completion Provider
 *
 * Provides IntelliSense for Turbo HTML attributes:
 * - data-turbo-* attributes
 * - <turbo-frame> tag attributes
 * - <turbo-stream> tag attributes
 */

import * as vscode from 'vscode';
import { TURBO_DATA_ATTRIBUTES, TURBO_FRAME_ATTRIBUTES } from './types';

export class TurboCompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.CompletionItem[] | null {
        // Only work in HTML context
        if (!this.isHtmlContext(document, position)) {
            return null;
        }

        const lineText = document.lineAt(position.line).text;
        const linePrefix = lineText.substring(0, position.character);

        // Check for different completion scenarios
        const dataAttrCompletions = this.getDataAttributeNameCompletions(linePrefix);
        if (dataAttrCompletions) {
            return dataAttrCompletions;
        }

        const dataAttrValueCompletions = this.getDataAttributeValueCompletions(linePrefix);
        if (dataAttrValueCompletions) {
            return dataAttrValueCompletions;
        }

        const turboFrameCompletions = this.getTurboFrameCompletions(linePrefix, lineText);
        if (turboFrameCompletions) {
            return turboFrameCompletions;
        }

        const turboStreamCompletions = this.getTurboStreamCompletions(linePrefix, lineText);
        if (turboStreamCompletions) {
            return turboStreamCompletions;
        }

        return null;
    }

    /**
     * Check if position is in HTML context
     */
    private isHtmlContext(document: vscode.TextDocument, position: vscode.Position): boolean {
        const languageId = document.languageId;

        if (languageId === 'html') {
            return true;
        }

        if (languageId === 'erb') {
            const lineText = document.lineAt(position.line).text;
            const linePrefix = lineText.substring(0, position.character);
            const openTags = (linePrefix.match(/<%/g) || []).length;
            const closeTags = (linePrefix.match(/%>/g) || []).length;
            return openTags <= closeTags;
        }

        return languageId === 'haml' || languageId === 'slim';
    }

    /**
     * Get completions for data-turbo-* attribute names
     */
    private getDataAttributeNameCompletions(linePrefix: string): vscode.CompletionItem[] | null {
        // Check if we're typing a data-turbo attribute name
        // e.g., "data-turbo" or "data-turbo-"
        const match = linePrefix.match(/data-turbo(-\w*)?$/);
        if (!match) {
            return null;
        }

        const typed = match[0];

        return TURBO_DATA_ATTRIBUTES
            .filter(attr => attr.name.startsWith(typed))
            .map(attr => {
                const item = new vscode.CompletionItem(
                    attr.name,
                    vscode.CompletionItemKind.Property
                );
                item.detail = 'Turbo Drive';
                item.documentation = new vscode.MarkdownString(attr.documentation);

                // If attribute has specific values, include snippet
                if (attr.values && attr.values.length > 0) {
                    const valueChoices = attr.values.join(',');
                    item.insertText = new vscode.SnippetString(
                        `${attr.name}="\${1|${valueChoices}|}"`
                    );
                } else {
                    item.insertText = new vscode.SnippetString(`${attr.name}="$1"`);
                }

                // Replace from start of data-turbo
                item.range = new vscode.Range(
                    new vscode.Position(0, linePrefix.length - typed.length),
                    new vscode.Position(0, linePrefix.length)
                );

                return item;
            });
    }

    /**
     * Get completions for data-turbo-* attribute values
     */
    private getDataAttributeValueCompletions(linePrefix: string): vscode.CompletionItem[] | null {
        // Check if we're inside a data-turbo-* attribute value
        const match = linePrefix.match(/(data-turbo(?:-\w+)*)\s*=\s*["']([^"']*)$/);
        if (!match) {
            return null;
        }

        const attrName = match[1];
        const currentValue = match[2];

        // Find the attribute definition
        const attr = TURBO_DATA_ATTRIBUTES.find(a => a.name === attrName);
        if (!attr || !attr.values) {
            return null;
        }

        return attr.values
            .filter(value => value.startsWith(currentValue))
            .map(value => {
                const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember);
                item.detail = `${attrName} value`;
                return item;
            });
    }

    /**
     * Get completions for <turbo-frame> tag attributes
     */
    private getTurboFrameCompletions(linePrefix: string, lineText: string): vscode.CompletionItem[] | null {
        // Check if we're inside a <turbo-frame tag
        const inTurboFrame = this.isInsideTag(linePrefix, 'turbo-frame');
        if (!inTurboFrame) {
            return null;
        }

        // Check if we're typing an attribute name
        const attrNameMatch = linePrefix.match(/\s(\w*)$/);
        if (!attrNameMatch) {
            return null;
        }

        const typed = attrNameMatch[1];

        // Get existing attributes on this tag to avoid duplicates
        const existingAttrs = this.getExistingAttributes(lineText);

        return TURBO_FRAME_ATTRIBUTES
            .filter(attr => attr.name.startsWith(typed))
            .filter(attr => !existingAttrs.has(attr.name))
            .map(attr => {
                const item = new vscode.CompletionItem(
                    attr.name,
                    vscode.CompletionItemKind.Property
                );
                item.detail = 'Turbo Frame';
                item.documentation = new vscode.MarkdownString(attr.documentation);

                if (attr.values && attr.values.length > 0) {
                    const valueChoices = attr.values.join(',');
                    item.insertText = new vscode.SnippetString(
                        `${attr.name}="\${1|${valueChoices}|}"`
                    );
                } else {
                    item.insertText = new vscode.SnippetString(`${attr.name}="$1"`);
                }

                return item;
            });
    }

    /**
     * Get completions for <turbo-stream> tag attributes
     */
    private getTurboStreamCompletions(linePrefix: string, lineText: string): vscode.CompletionItem[] | null {
        // Check if we're inside a <turbo-stream tag
        const inTurboStream = this.isInsideTag(linePrefix, 'turbo-stream');
        if (!inTurboStream) {
            return null;
        }

        // Turbo stream attributes
        const streamAttrs = [
            { name: 'action', values: ['append', 'prepend', 'replace', 'update', 'remove', 'before', 'after', 'morph', 'refresh'], documentation: 'Stream action to perform' },
            { name: 'target', documentation: 'DOM ID of target element' },
            { name: 'targets', documentation: 'CSS selector for multiple targets' },
        ];

        // Check if we're typing an attribute name
        const attrNameMatch = linePrefix.match(/\s(\w*)$/);
        if (!attrNameMatch) {
            return null;
        }

        const typed = attrNameMatch[1];
        const existingAttrs = this.getExistingAttributes(lineText);

        return streamAttrs
            .filter(attr => attr.name.startsWith(typed))
            .filter(attr => !existingAttrs.has(attr.name))
            .map(attr => {
                const item = new vscode.CompletionItem(
                    attr.name,
                    vscode.CompletionItemKind.Property
                );
                item.detail = 'Turbo Stream';
                item.documentation = new vscode.MarkdownString(attr.documentation);

                if (attr.values && attr.values.length > 0) {
                    const valueChoices = attr.values.join(',');
                    item.insertText = new vscode.SnippetString(
                        `${attr.name}="\${1|${valueChoices}|}"`
                    );
                } else {
                    item.insertText = new vscode.SnippetString(`${attr.name}="$1"`);
                }

                return item;
            });
    }

    /**
     * Check if cursor is inside a specific HTML tag
     */
    private isInsideTag(linePrefix: string, tagName: string): boolean {
        // Simple check: look for opening tag without closing >
        const tagPattern = new RegExp(`<${tagName}[^>]*$`);
        return tagPattern.test(linePrefix);
    }

    /**
     * Get existing attributes on the current tag
     */
    private getExistingAttributes(lineText: string): Set<string> {
        const attrs = new Set<string>();
        const attrPattern = /(\w+)\s*=/g;
        let match;
        while ((match = attrPattern.exec(lineText)) !== null) {
            attrs.add(match[1]);
        }
        return attrs;
    }
}

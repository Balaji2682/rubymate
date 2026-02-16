/**
 * Stimulus Completion Provider
 *
 * Provides IntelliSense for Stimulus data-* attributes in ERB/HTML files:
 * - data-controller="..." - suggest all indexed controllers
 * - data-action="event->controller#..." - suggest actions
 * - data-{controller}-target="..." - suggest targets
 * - data-{controller}-{name}-value="..." - suggest values
 * - data-{controller}-outlet="..." - suggest outlets
 * - data-{controller}-{name}-class="..." - suggest classes
 *
 * Optimizations:
 * - Uses shared HtmlContextDetector to avoid duplicate logic
 * - Controller-in-scope detection for smarter suggestions
 * - Prefix search with Trie for large controller sets
 */

import * as vscode from 'vscode';
import { StimulusIndexer } from './stimulusIndexer';
import { DataAttributeContext, StimulusValue } from './types';
import { htmlContextDetector, HtmlContext } from './htmlContextDetector';

export class StimulusCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private indexer: StimulusIndexer) {}

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.CompletionItem[] | null {
        // Use shared HTML context detector
        const htmlContext = htmlContextDetector.detectContext(document, position);
        if (!htmlContext.isHtml) {
            return null;
        }

        const lineText = document.lineAt(position.line).text;
        const linePrefix = lineText.substring(0, position.character);

        // Detect what kind of completion we need
        const attrContext = this.parseDataAttributeContext(linePrefix, lineText, position.character);
        if (!attrContext) {
            return null;
        }

        switch (attrContext.type) {
            case 'controller':
                return this.getControllerCompletions(attrContext);
            case 'action':
                return this.getActionCompletions(attrContext, htmlContext);
            case 'target':
                return this.getTargetCompletions(attrContext);
            case 'value':
                return this.getValueCompletions(attrContext);
            case 'outlet':
                return this.getOutletCompletions(attrContext);
            case 'class':
                return this.getClassCompletions(attrContext);
            case 'param':
                return this.getParamCompletions(attrContext);
            default:
                return null;
        }
    }

    /**
     * Parse the current line to understand what data attribute we're completing
     */
    private parseDataAttributeContext(
        linePrefix: string,
        lineText: string,
        position: number
    ): DataAttributeContext | null {
        // Find the attribute we're currently in
        // Look for data-* attribute pattern

        // Match data-controller="value"
        const controllerMatch = linePrefix.match(/data-controller\s*=\s*["']([^"']*)$/);
        if (controllerMatch) {
            return {
                type: 'controller',
                currentValue: controllerMatch[1],
                position: position - controllerMatch[1].length,
                attributeName: 'data-controller'
            };
        }

        // Match data-action="value"
        const actionMatch = linePrefix.match(/data-action\s*=\s*["']([^"']*)$/);
        if (actionMatch) {
            return {
                type: 'action',
                currentValue: actionMatch[1],
                position: position - actionMatch[1].length,
                attributeName: 'data-action'
            };
        }

        // Match data-{controller}-target="value"
        const targetMatch = linePrefix.match(/data-(\w+(?:-\w+)*)-target\s*=\s*["']([^"']*)$/);
        if (targetMatch) {
            return {
                type: 'target',
                controllerName: targetMatch[1],
                currentValue: targetMatch[2],
                position: position - targetMatch[2].length,
                attributeName: `data-${targetMatch[1]}-target`
            };
        }

        // Match data-{controller}-{name}-value="value"
        const valueMatch = linePrefix.match(/data-(\w+(?:-\w+)*)-(\w+)-value\s*=\s*["']([^"']*)$/);
        if (valueMatch) {
            return {
                type: 'value',
                controllerName: valueMatch[1],
                currentValue: valueMatch[3],
                position: position - valueMatch[3].length,
                attributeName: `data-${valueMatch[1]}-${valueMatch[2]}-value`
            };
        }

        // Match data-{controller}-outlet="value"
        const outletMatch = linePrefix.match(/data-(\w+(?:-\w+)*)-outlet\s*=\s*["']([^"']*)$/);
        if (outletMatch) {
            return {
                type: 'outlet',
                controllerName: outletMatch[1],
                currentValue: outletMatch[2],
                position: position - outletMatch[2].length,
                attributeName: `data-${outletMatch[1]}-outlet`
            };
        }

        // Match data-{controller}-{name}-class="value"
        const classMatch = linePrefix.match(/data-(\w+(?:-\w+)*)-(\w+)-class\s*=\s*["']([^"']*)$/);
        if (classMatch) {
            return {
                type: 'class',
                controllerName: classMatch[1],
                currentValue: classMatch[3],
                position: position - classMatch[3].length,
                attributeName: `data-${classMatch[1]}-${classMatch[2]}-class`
            };
        }

        // Match data-{controller}-{name}-param="value" (for action params)
        const paramMatch = linePrefix.match(/data-(\w+(?:-\w+)*)-(\w+)-param\s*=\s*["']([^"']*)$/);
        if (paramMatch) {
            return {
                type: 'param',
                controllerName: paramMatch[1],
                currentValue: paramMatch[3],
                position: position - paramMatch[3].length,
                attributeName: `data-${paramMatch[1]}-${paramMatch[2]}-param`
            };
        }

        // Check if we're starting a new data attribute after "data-"
        // This helps with attribute name completion
        const dataAttrStart = linePrefix.match(/data-(\w*)$/);
        if (dataAttrStart && !linePrefix.includes('=')) {
            // We're typing an attribute name, not a value
            return null;
        }

        return null;
    }

    /**
     * Get completions for data-controller attribute
     * Uses Trie for O(k) prefix search when filtering by typed prefix
     */
    private getControllerCompletions(context: DataAttributeContext): vscode.CompletionItem[] {
        const currentValue = context.currentValue;

        // Parse existing controllers in the attribute (space-separated)
        const existingControllers = currentValue.trim().split(/\s+/).filter(c => c);
        const lastWord = existingControllers[existingControllers.length - 1] || '';

        // Filter out already used controllers
        const usedSet = new Set(existingControllers.slice(0, -1));

        // Use optimized prefix search if user is typing
        const controllers = lastWord
            ? this.indexer.getControllerNamesWithPrefix(lastWord)
            : this.indexer.getControllerNames();

        return controllers
            .filter(name => !usedSet.has(name))
            .map(name => {
                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
                const controller = this.indexer.getController(name);

                item.detail = 'Stimulus Controller';
                if (controller) {
                    const details: string[] = [];
                    if (controller.targets.length > 0) {
                        details.push(`Targets: ${controller.targets.join(', ')}`);
                    }
                    if (controller.values.length > 0) {
                        details.push(`Values: ${controller.values.map(v => v.name).join(', ')}`);
                    }
                    if (controller.actions.length > 0) {
                        details.push(`Actions: ${controller.actions.map(a => a.name).join(', ')}`);
                    }
                    item.documentation = new vscode.MarkdownString(details.join('\n\n'));
                }

                // Calculate replace range for the last word only
                item.insertText = name;

                return item;
            });
    }

    /**
     * Get completions for data-action attribute
     * Format: event->controller#action or controller#action
     *
     * Prioritizes controllers that are in scope (declared on parent elements)
     */
    private getActionCompletions(context: DataAttributeContext, htmlContext: HtmlContext): vscode.CompletionItem[] {
        const completions: vscode.CompletionItem[] = [];
        const currentValue = context.currentValue;
        const controllersInScope = new Set(htmlContext.controllersInScope);

        // Parse current action string
        // Possible formats:
        // - "click->"
        // - "click->hello#"
        // - "hello#"
        // - ""

        // Check if we're after -> and need controller completions
        const afterArrowMatch = currentValue.match(/(\w+)->(\w*)$/);
        if (afterArrowMatch) {
            const partialController = afterArrowMatch[2];

            // Use optimized prefix search
            const controllers = partialController
                ? this.indexer.getControllerNamesWithPrefix(partialController)
                : this.indexer.getControllerNames();

            for (const name of controllers) {
                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
                // Prioritize controllers in scope
                if (controllersInScope.has(name)) {
                    item.detail = 'Stimulus Controller (in scope)';
                    item.sortText = '0' + name; // Sort first
                } else {
                    item.detail = 'Stimulus Controller';
                    item.sortText = '1' + name;
                }
                item.insertText = name + '#';
                item.command = { command: 'editor.action.triggerSuggest', title: 'Trigger Suggest' };
                completions.push(item);
            }

            return completions;
        }

        // Check if we're after controller# and need action completions
        const afterHashMatch = currentValue.match(/(?:(\w+)->)?(\w+)#(\w*)$/);
        if (afterHashMatch) {
            const controllerName = afterHashMatch[2];
            const partialAction = afterHashMatch[3];

            const actions = this.indexer.getActions(controllerName)
                .filter(action => action.name.startsWith(partialAction));

            for (const action of actions) {
                const item = new vscode.CompletionItem(action.name, vscode.CompletionItemKind.Method);
                item.detail = `Action in ${controllerName}`;
                if (action.parameters && action.parameters.length > 0) {
                    item.documentation = new vscode.MarkdownString(
                        `Parameters: ${action.parameters.join(', ')}`
                    );
                }
                completions.push(item);
            }

            return completions;
        }

        // Starting fresh or after a space - suggest events or controllers
        // Common DOM events
        const events = [
            'click', 'submit', 'change', 'input', 'keydown', 'keyup', 'keypress',
            'focus', 'blur', 'mouseenter', 'mouseleave', 'mouseover', 'mouseout',
            'touchstart', 'touchend', 'touchmove', 'scroll', 'resize',
            'load', 'error', 'abort', 'dragstart', 'dragend', 'drop',
            // Turbo events
            'turbo:load', 'turbo:click', 'turbo:before-visit', 'turbo:visit',
            'turbo:submit-start', 'turbo:submit-end', 'turbo:before-fetch-request',
            'turbo:before-fetch-response', 'turbo:before-cache', 'turbo:before-render',
            'turbo:render', 'turbo:frame-load', 'turbo:frame-render'
        ];

        // Suggest event->controller#action patterns
        for (const event of events) {
            const item = new vscode.CompletionItem(event + '->', vscode.CompletionItemKind.Event);
            item.detail = 'DOM Event';
            item.insertText = event + '->';
            item.command = { command: 'editor.action.triggerSuggest', title: 'Trigger Suggest' };
            completions.push(item);
        }

        // Prioritize controllers in scope, then show all others
        const allControllers = this.indexer.getControllerNames();
        const inScope = allControllers.filter(c => controllersInScope.has(c));
        const outOfScope = allControllers.filter(c => !controllersInScope.has(c));

        for (const controller of inScope) {
            const item = new vscode.CompletionItem(controller + '#', vscode.CompletionItemKind.Class);
            item.detail = 'Stimulus Controller (in scope)';
            item.insertText = controller + '#';
            item.sortText = '0' + controller;
            item.command = { command: 'editor.action.triggerSuggest', title: 'Trigger Suggest' };
            completions.push(item);
        }

        for (const controller of outOfScope) {
            const item = new vscode.CompletionItem(controller + '#', vscode.CompletionItemKind.Class);
            item.detail = 'Stimulus Controller';
            item.insertText = controller + '#';
            item.sortText = '1' + controller;
            item.command = { command: 'editor.action.triggerSuggest', title: 'Trigger Suggest' };
            completions.push(item);
        }

        return completions;
    }

    /**
     * Get completions for data-{controller}-target attribute
     */
    private getTargetCompletions(context: DataAttributeContext): vscode.CompletionItem[] {
        if (!context.controllerName) {
            return [];
        }

        const targets = this.indexer.getTargets(context.controllerName);
        const currentValue = context.currentValue;

        // Targets can be space-separated
        const existingTargets = currentValue.trim().split(/\s+/).filter(t => t);
        const lastWord = existingTargets[existingTargets.length - 1] || '';
        const usedSet = new Set(existingTargets.slice(0, -1));

        return targets
            .filter(name => !usedSet.has(name))
            .filter(name => name.startsWith(lastWord))
            .map(name => {
                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Field);
                item.detail = `Target in ${context.controllerName}`;
                item.documentation = new vscode.MarkdownString(
                    `Access via \`this.${name}Target\` or \`this.${name}Targets\``
                );
                return item;
            });
    }

    /**
     * Get completions for data-{controller}-{name}-value attribute values
     */
    private getValueCompletions(context: DataAttributeContext): vscode.CompletionItem[] {
        if (!context.controllerName) {
            return [];
        }

        // Extract value name from attribute name
        const attrMatch = context.attributeName.match(/data-\w+(?:-\w+)*-(\w+)-value/);
        if (!attrMatch) {
            return [];
        }

        const valueName = attrMatch[1];
        const values = this.indexer.getValues(context.controllerName);
        const value = values.find(v => v.name === valueName);

        if (!value) {
            return [];
        }

        // Provide type-specific completions
        return this.getValueTypeCompletions(value);
    }

    /**
     * Get type-specific value completions
     */
    private getValueTypeCompletions(value: StimulusValue): vscode.CompletionItem[] {
        const completions: vscode.CompletionItem[] = [];

        switch (value.type) {
            case 'Boolean':
                completions.push(
                    this.createValueItem('true', 'Boolean value'),
                    this.createValueItem('false', 'Boolean value')
                );
                break;
            case 'Number':
                completions.push(
                    this.createValueItem('0', 'Number value'),
                    this.createValueItem('1', 'Number value')
                );
                break;
            case 'Array':
                completions.push(
                    this.createValueItem('[]', 'Empty array')
                );
                break;
            case 'Object':
                completions.push(
                    this.createValueItem('{}', 'Empty object')
                );
                break;
            // String doesn't need specific completions
        }

        if (value.defaultValue) {
            const item = this.createValueItem(value.defaultValue, 'Default value');
            item.preselect = true;
            completions.unshift(item);
        }

        return completions;
    }

    /**
     * Get completions for data-{controller}-outlet attribute
     */
    private getOutletCompletions(context: DataAttributeContext): vscode.CompletionItem[] {
        if (!context.controllerName) {
            return [];
        }

        const outlets = this.indexer.getOutlets(context.controllerName);

        return outlets.map(name => {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Interface);
            item.detail = `Outlet in ${context.controllerName}`;
            item.documentation = new vscode.MarkdownString(
                `Connects to \`${name}\` controller.\n\nAccess via \`this.${this.toCamelCase(name)}Outlet\` or \`this.${this.toCamelCase(name)}Outlets\``
            );
            return item;
        });
    }

    /**
     * Get completions for data-{controller}-{name}-class attribute
     */
    private getClassCompletions(context: DataAttributeContext): vscode.CompletionItem[] {
        if (!context.controllerName) {
            return [];
        }

        const classes = this.indexer.getClasses(context.controllerName);

        // Extract class name from attribute
        const attrMatch = context.attributeName.match(/data-\w+(?:-\w+)*-(\w+)-class/);
        if (!attrMatch) {
            return [];
        }

        const className = attrMatch[1];

        // Check if this class name is defined in the controller
        if (!classes.includes(className)) {
            return [];
        }

        // Suggest common CSS class patterns
        const suggestions = [
            'hidden', 'visible', 'active', 'inactive', 'loading',
            'disabled', 'enabled', 'selected', 'highlighted'
        ];

        return suggestions.map(name => {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
            item.detail = 'CSS Class suggestion';
            return item;
        });
    }

    /**
     * Get completions for data-{controller}-{name}-param attribute
     */
    private getParamCompletions(_context: DataAttributeContext): vscode.CompletionItem[] {
        // Params are arbitrary values, so we can't provide specific completions
        // Just provide type hints
        return [
            this.createValueItem('true', 'Boolean param'),
            this.createValueItem('false', 'Boolean param'),
        ];
    }

    /**
     * Helper to create a value completion item
     */
    private createValueItem(value: string, detail: string): vscode.CompletionItem {
        const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Value);
        item.detail = detail;
        return item;
    }

    /**
     * Convert kebab-case to camelCase
     */
    private toCamelCase(str: string): string {
        return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    }
}

/**
 * Hotwire Hover Provider
 *
 * Provides hover information for Stimulus and Turbo attributes:
 * - Stimulus controllers: shows targets, values, actions
 * - Stimulus actions: shows method signature
 * - Turbo attributes: shows documentation
 */

import * as vscode from 'vscode';
import { StimulusIndexer } from './stimulusIndexer';
import { TURBO_DATA_ATTRIBUTES, TURBO_FRAME_ATTRIBUTES } from './types';

export class HotwireHoverProvider implements vscode.HoverProvider {
    constructor(private indexer: StimulusIndexer) {}

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Hover | null {
        // Only work in HTML context
        if (!this.isHtmlContext(document, position)) {
            return null;
        }

        const lineText = document.lineAt(position.line).text;

        // Try different hover types
        const controllerHover = this.getControllerHover(lineText, position);
        if (controllerHover) {
            return controllerHover;
        }

        const actionHover = this.getActionHover(lineText, position);
        if (actionHover) {
            return actionHover;
        }

        const targetHover = this.getTargetHover(lineText, position);
        if (targetHover) {
            return targetHover;
        }

        const turboHover = this.getTurboAttributeHover(lineText, position);
        if (turboHover) {
            return turboHover;
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
     * Get hover for data-controller attribute
     */
    private getControllerHover(lineText: string, position: vscode.Position): vscode.Hover | null {
        // Find data-controller="..." on this line
        const controllerAttrRegex = /data-controller\s*=\s*["']([^"']+)["']/g;
        let match;

        while ((match = controllerAttrRegex.exec(lineText)) !== null) {
            const attrStart = match.index;
            const valueStart = attrStart + match[0].indexOf(match[1]);
            const valueEnd = valueStart + match[1].length;

            // Check if cursor is within the value
            if (position.character >= valueStart && position.character <= valueEnd) {
                // Parse controller names (space-separated)
                const controllerNames = match[1].split(/\s+/);
                let currentPos = valueStart;

                for (const name of controllerNames) {
                    const nameStart = currentPos;
                    const nameEnd = nameStart + name.length;

                    if (position.character >= nameStart && position.character <= nameEnd) {
                        return this.createControllerHover(name, position, nameStart, nameEnd);
                    }

                    currentPos = nameEnd + 1; // +1 for space
                }
            }
        }

        return null;
    }

    /**
     * Create hover content for a Stimulus controller
     */
    private createControllerHover(
        name: string,
        position: vscode.Position,
        start: number,
        end: number
    ): vscode.Hover | null {
        const controller = this.indexer.getController(name);
        if (!controller) {
            return new vscode.Hover(
                new vscode.MarkdownString(`**Stimulus Controller: ${name}**\n\n*Controller not found*`),
                new vscode.Range(position.line, start, position.line, end)
            );
        }

        const md = new vscode.MarkdownString();
        md.isTrusted = true;

        md.appendMarkdown(`**Stimulus Controller: ${name}**\n\n`);

        // Show file path
        const relativePath = vscode.workspace.asRelativePath(controller.filePath);
        md.appendMarkdown(`📁 \`${relativePath}\`\n\n`);

        // Show targets
        if (controller.targets.length > 0) {
            md.appendMarkdown(`**Targets:**\n`);
            for (const target of controller.targets) {
                md.appendMarkdown(`- \`${target}\` → \`this.${target}Target\`\n`);
            }
            md.appendMarkdown(`\n`);
        }

        // Show values
        if (controller.values.length > 0) {
            md.appendMarkdown(`**Values:**\n`);
            for (const value of controller.values) {
                md.appendMarkdown(`- \`${value.name}\`: ${value.type}`);
                if (value.defaultValue) {
                    md.appendMarkdown(` (default: \`${value.defaultValue}\`)`);
                }
                md.appendMarkdown(`\n`);
            }
            md.appendMarkdown(`\n`);
        }

        // Show actions
        if (controller.actions.length > 0) {
            md.appendMarkdown(`**Actions:**\n`);
            for (const action of controller.actions) {
                md.appendMarkdown(`- \`${action.name}()\``);
                if (action.parameters && action.parameters.length > 0) {
                    md.appendMarkdown(` (${action.parameters.join(', ')})`);
                }
                md.appendMarkdown(`\n`);
            }
            md.appendMarkdown(`\n`);
        }

        // Show outlets
        if (controller.outlets.length > 0) {
            md.appendMarkdown(`**Outlets:**\n`);
            for (const outlet of controller.outlets) {
                md.appendMarkdown(`- \`${outlet}\`\n`);
            }
            md.appendMarkdown(`\n`);
        }

        // Show classes
        if (controller.classes.length > 0) {
            md.appendMarkdown(`**Classes:**\n`);
            for (const cls of controller.classes) {
                md.appendMarkdown(`- \`${cls}\`\n`);
            }
        }

        return new vscode.Hover(md, new vscode.Range(position.line, start, position.line, end));
    }

    /**
     * Get hover for data-action attribute
     */
    private getActionHover(lineText: string, position: vscode.Position): vscode.Hover | null {
        // Find data-action="..." on this line
        const actionAttrRegex = /data-action\s*=\s*["']([^"']+)["']/g;
        let match;

        while ((match = actionAttrRegex.exec(lineText)) !== null) {
            const attrStart = match.index;
            const valueStart = attrStart + match[0].indexOf(match[1]);
            const valueEnd = valueStart + match[1].length;

            // Check if cursor is within the value
            if (position.character >= valueStart && position.character <= valueEnd) {
                const value = match[1];
                const relativePos = position.character - valueStart;

                // Parse action string(s) - can be space-separated
                const actions = value.split(/\s+/);
                let currentOffset = 0;

                for (const action of actions) {
                    const actionStart = currentOffset;
                    const actionEnd = actionStart + action.length;

                    if (relativePos >= actionStart && relativePos <= actionEnd) {
                        return this.createActionHover(
                            action,
                            position,
                            valueStart + actionStart,
                            valueStart + actionEnd
                        );
                    }

                    currentOffset = actionEnd + 1;
                }
            }
        }

        return null;
    }

    /**
     * Create hover content for a Stimulus action
     */
    private createActionHover(
        action: string,
        position: vscode.Position,
        start: number,
        end: number
    ): vscode.Hover | null {
        // Parse action format: event->controller#action or controller#action
        const fullMatch = action.match(/^(?:(\w+)->)?(\w+(?:-\w+)*)#(\w+)$/);
        if (!fullMatch) {
            return null;
        }

        const [, event, controllerName, actionName] = fullMatch;

        const controller = this.indexer.getController(controllerName);
        if (!controller) {
            return new vscode.Hover(
                new vscode.MarkdownString(`**Action:** \`${action}\`\n\n*Controller "${controllerName}" not found*`),
                new vscode.Range(position.line, start, position.line, end)
            );
        }

        const actionDef = controller.actions.find(a => a.name === actionName);

        const md = new vscode.MarkdownString();
        md.isTrusted = true;

        md.appendMarkdown(`**Stimulus Action**\n\n`);

        if (event) {
            md.appendMarkdown(`- **Event:** \`${event}\`\n`);
        }
        md.appendMarkdown(`- **Controller:** \`${controllerName}\`\n`);
        md.appendMarkdown(`- **Action:** \`${actionName}\`\n\n`);

        if (actionDef) {
            const relativePath = vscode.workspace.asRelativePath(controller.filePath);
            md.appendMarkdown(`📁 \`${relativePath}:${actionDef.line}\`\n\n`);

            if (actionDef.parameters && actionDef.parameters.length > 0) {
                md.appendMarkdown(`**Parameters:** ${actionDef.parameters.join(', ')}\n`);
            }
        } else {
            md.appendMarkdown(`*Action "${actionName}" not found in controller*`);
        }

        return new vscode.Hover(md, new vscode.Range(position.line, start, position.line, end));
    }

    /**
     * Get hover for data-{controller}-target attribute
     */
    private getTargetHover(lineText: string, position: vscode.Position): vscode.Hover | null {
        // Find data-{controller}-target="..." on this line
        const targetAttrRegex = /data-(\w+(?:-\w+)*)-target\s*=\s*["']([^"']+)["']/g;
        let match;

        while ((match = targetAttrRegex.exec(lineText)) !== null) {
            const controllerName = match[1];
            const targetValue = match[2];
            const attrStart = match.index;
            const valueStart = attrStart + match[0].indexOf(match[2]);
            const valueEnd = valueStart + match[2].length;

            // Check if cursor is within the value
            if (position.character >= valueStart && position.character <= valueEnd) {
                const controller = this.indexer.getController(controllerName);

                const md = new vscode.MarkdownString();
                md.isTrusted = true;

                md.appendMarkdown(`**Stimulus Target**\n\n`);
                md.appendMarkdown(`- **Controller:** \`${controllerName}\`\n`);
                md.appendMarkdown(`- **Target:** \`${targetValue}\`\n\n`);

                if (controller) {
                    const targets = targetValue.split(/\s+/);
                    for (const target of targets) {
                        if (controller.targets.includes(target)) {
                            md.appendMarkdown(`✅ Access via \`this.${target}Target\` or \`this.${target}Targets\`\n`);
                        } else {
                            md.appendMarkdown(`⚠️ Target "${target}" not defined in controller\n`);
                        }
                    }
                } else {
                    md.appendMarkdown(`*Controller "${controllerName}" not found*`);
                }

                return new vscode.Hover(md, new vscode.Range(position.line, valueStart, position.line, valueEnd));
            }
        }

        return null;
    }

    /**
     * Get hover for Turbo data-turbo-* attributes
     */
    private getTurboAttributeHover(lineText: string, position: vscode.Position): vscode.Hover | null {
        // Find data-turbo-* attributes
        const turboAttrRegex = /(data-turbo(?:-\w+)*)\s*(?:=\s*["']([^"']*)["'])?/g;
        let match;

        while ((match = turboAttrRegex.exec(lineText)) !== null) {
            const attrName = match[1];
            const attrStart = match.index;
            const attrEnd = attrStart + match[0].length;

            // Check if cursor is on this attribute
            if (position.character >= attrStart && position.character <= attrEnd) {
                // Find documentation for this attribute
                const turboAttr = TURBO_DATA_ATTRIBUTES.find(a => a.name === attrName);
                if (turboAttr) {
                    const md = new vscode.MarkdownString();
                    md.isTrusted = true;

                    md.appendMarkdown(`**Turbo Drive Attribute**\n\n`);
                    md.appendMarkdown(`\`${attrName}\`\n\n`);
                    md.appendMarkdown(turboAttr.documentation);

                    if (turboAttr.values) {
                        md.appendMarkdown(`\n\n**Values:** ${turboAttr.values.map(v => `\`${v}\``).join(', ')}`);
                    }

                    return new vscode.Hover(md, new vscode.Range(position.line, attrStart, position.line, attrEnd));
                }
            }
        }

        // Check for turbo-frame attributes
        const frameAttrRegex = /<turbo-frame[^>]*(\w+)\s*=\s*["']([^"']*)["']/g;
        while ((match = frameAttrRegex.exec(lineText)) !== null) {
            const attrName = match[1];
            const attrStart = lineText.indexOf(attrName, match.index);
            const attrEnd = attrStart + match[0].length - (match[0].length - attrName.length - match[2].length - 3);

            if (position.character >= attrStart && position.character <= attrStart + attrName.length) {
                const frameAttr = TURBO_FRAME_ATTRIBUTES.find(a => a.name === attrName);
                if (frameAttr) {
                    const md = new vscode.MarkdownString();
                    md.isTrusted = true;

                    md.appendMarkdown(`**Turbo Frame Attribute**\n\n`);
                    md.appendMarkdown(`\`${attrName}\`\n\n`);
                    md.appendMarkdown(frameAttr.documentation);

                    if (frameAttr.values) {
                        md.appendMarkdown(`\n\n**Values:** ${frameAttr.values.map(v => `\`${v}\``).join(', ')}`);
                    }

                    return new vscode.Hover(md);
                }
            }
        }

        return null;
    }
}

/**
 * Stimulus Definition Provider
 *
 * Provides go-to-definition for Stimulus data-* attributes:
 * - data-controller="hello" -> hello_controller.js:1
 * - data-action="click->hello#greet" -> hello_controller.js:greet method line
 * - data-hello-target="output" -> hello_controller.js:static targets line
 */

import * as vscode from 'vscode';
import { StimulusIndexer } from './stimulusIndexer';

export class StimulusDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private indexer: StimulusIndexer) {}

    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Definition | null {
        // Only work in HTML context
        if (!this.isHtmlContext(document, position)) {
            return null;
        }

        const lineText = document.lineAt(position.line).text;

        // Try different definition types
        const controllerDef = this.getControllerDefinition(lineText, position);
        if (controllerDef) {
            return controllerDef;
        }

        const actionDef = this.getActionDefinition(lineText, position);
        if (actionDef) {
            return actionDef;
        }

        const targetDef = this.getTargetDefinition(lineText, position);
        if (targetDef) {
            return targetDef;
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
     * Get definition for data-controller attribute value
     */
    private getControllerDefinition(
        lineText: string,
        position: vscode.Position
    ): vscode.Location | null {
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
                        const controller = this.indexer.getController(name);
                        if (controller) {
                            return new vscode.Location(
                                controller.uri,
                                new vscode.Position(0, 0)
                            );
                        }
                    }

                    currentPos = nameEnd + 1; // +1 for space
                }
            }
        }

        return null;
    }

    /**
     * Get definition for data-action attribute value
     */
    private getActionDefinition(
        lineText: string,
        position: vscode.Position
    ): vscode.Location | null {
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
                        return this.resolveActionLocation(action, relativePos - actionStart);
                    }

                    currentOffset = actionEnd + 1; // +1 for space
                }
            }
        }

        return null;
    }

    /**
     * Resolve action string to a location
     * Formats:
     * - event->controller#action
     * - controller#action
     */
    private resolveActionLocation(action: string, relativePos: number): vscode.Location | null {
        // Parse action format: event->controller#action or controller#action
        const fullMatch = action.match(/^(?:(\w+)->)?(\w+(?:-\w+)*)#(\w+)$/);
        if (!fullMatch) {
            return null;
        }

        const [, _event, controllerName, actionName] = fullMatch;

        // Find positions of controller and action in the string
        const arrowIndex = action.indexOf('->');
        const hashIndex = action.indexOf('#');

        // Determine what was clicked
        let clickedController = false;
        let clickedAction = false;

        if (arrowIndex !== -1) {
            // Format: event->controller#action
            const controllerStart = arrowIndex + 2;
            const controllerEnd = hashIndex;
            const actionStart = hashIndex + 1;
            const actionEnd = action.length;

            if (relativePos >= controllerStart && relativePos <= controllerEnd) {
                clickedController = true;
            } else if (relativePos >= actionStart && relativePos <= actionEnd) {
                clickedAction = true;
            }
        } else {
            // Format: controller#action
            const controllerStart = 0;
            const controllerEnd = hashIndex;
            const actionStart = hashIndex + 1;
            const actionEnd = action.length;

            if (relativePos >= controllerStart && relativePos <= controllerEnd) {
                clickedController = true;
            } else if (relativePos >= actionStart && relativePos <= actionEnd) {
                clickedAction = true;
            }
        }

        const controller = this.indexer.getController(controllerName);
        if (!controller) {
            return null;
        }

        if (clickedAction) {
            // Jump to action method
            const methodAction = controller.actions.find(a => a.name === actionName);
            if (methodAction) {
                return new vscode.Location(
                    controller.uri,
                    new vscode.Position(methodAction.line - 1, 0) // Convert to 0-indexed
                );
            }
        }

        // Default: jump to controller file
        return new vscode.Location(
            controller.uri,
            new vscode.Position(0, 0)
        );
    }

    /**
     * Get definition for data-{controller}-target attribute
     */
    private getTargetDefinition(
        lineText: string,
        position: vscode.Position
    ): vscode.Location | null {
        // Find data-{controller}-target="..." on this line
        const targetAttrRegex = /data-(\w+(?:-\w+)*)-target\s*=\s*["']([^"']+)["']/g;
        let match;

        while ((match = targetAttrRegex.exec(lineText)) !== null) {
            const controllerName = match[1];
            const attrStart = match.index;
            const valueStart = attrStart + match[0].indexOf(match[2]);
            const valueEnd = valueStart + match[2].length;

            // Check if cursor is within the value
            if (position.character >= valueStart && position.character <= valueEnd) {
                const controller = this.indexer.getController(controllerName);
                if (controller) {
                    // Jump to controller file (targets are defined at class level)
                    return new vscode.Location(
                        controller.uri,
                        new vscode.Position(0, 0)
                    );
                }
            }
        }

        return null;
    }
}

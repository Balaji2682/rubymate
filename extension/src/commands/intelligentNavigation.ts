import * as vscode from 'vscode';
import { IntelligentIndexer } from '../indexing/intelligentIndexer';

/**
 * Intelligent Navigation Commands
 */

export class IntelligentNavigationCommands {
    private indexer: IntelligentIndexer;
    private outputChannel: vscode.OutputChannel;

    constructor(indexer: IntelligentIndexer, outputChannel: vscode.OutputChannel) {
        this.indexer = indexer;
        this.outputChannel = outputChannel;
    }

    /**
     * Register all navigation commands
     */
    registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.showCallHierarchy', () => this.showCallHierarchy()),
            vscode.commands.registerCommand('rubymate.showTypeHierarchy', () => this.showTypeHierarchy()),
            vscode.commands.registerCommand('rubymate.findAllSubclasses', () => this.findAllSubclasses()),
            vscode.commands.registerCommand('rubymate.findAllReferences', () => this.findAllReferences()),
            vscode.commands.registerCommand('rubymate.goToRelatedFiles', () => this.goToRelatedFiles()),
            vscode.commands.registerCommand('rubymate.findViewForAction', () => this.findViewForAction()),
            vscode.commands.registerCommand('rubymate.showRouteInfo', () => this.showRouteInfo()),
            vscode.commands.registerCommand('rubymate.detectDeadCode', () => this.detectDeadCode()),
            vscode.commands.registerCommand('rubymate.smartSearch', () => this.smartSearch())
        );
    }

    /**
     * Show call hierarchy for method under cursor
     */
    private async showCallHierarchy(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const position = editor.selection.active;
        const document = editor.document;

        // Get method name under cursor
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return;

        const methodName = document.getText(wordRange);

        // Find containing class
        const className = await this.findContainingClass(document, position);
        if (!className) {
            vscode.window.showErrorMessage('Could not determine containing class');
            return;
        }

        // Get call hierarchy
        const hierarchy = this.indexer.getCallHierarchy(className, methodName);

        if (hierarchy.length === 0) {
            vscode.window.showInformationMessage(`No callers found for ${className}#${methodName}`);
            return;
        }

        // Show in quick pick
        const items = hierarchy.map(edge => ({
            label: edge.caller,
            description: `Confidence: ${(edge.confidence * 100).toFixed(0)}%`,
            location: edge.location
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Callers of ${className}#${methodName}`
        });

        if (selected) {
            await vscode.window.showTextDocument(selected.location.uri, {
                selection: selected.location.range
            });
        }
    }

    /**
     * Show type hierarchy for class under cursor
     */
    private async showTypeHierarchy(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const position = editor.selection.active;
        const document = editor.document;

        // Get class name under cursor
        const wordRange = document.getWordRangeAtPosition(position, /[A-Z]\w*(::[A-Z]\w*)*/);
        if (!wordRange) return;

        const className = document.getText(wordRange);

        // Get inheritance chain
        const hierarchy = this.indexer.getTypeHierarchy(className);

        if (hierarchy.length <= 1) {
            vscode.window.showInformationMessage(`${className} has no superclasses`);
            return;
        }

        // Show inheritance tree
        const tree = hierarchy.map((name, index) => {
            const indent = '  '.repeat(index);
            const arrow = index > 0 ? '└─ ' : '';
            return `${indent}${arrow}${name}`;
        }).join('\n');

        vscode.window.showInformationMessage(
            `Inheritance chain for ${className}:\n${tree}`,
            { modal: true }
        );
    }

    /**
     * Find all subclasses of current class
     */
    private async findAllSubclasses(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const position = editor.selection.active;
        const document = editor.document;

        // Get class name
        const className = await this.findContainingClass(document, position);
        if (!className) return;

        // Get all subclasses
        const subclasses = this.indexer.getAllSubclasses(className);

        if (subclasses.length === 0) {
            vscode.window.showInformationMessage(`No subclasses found for ${className}`);
            return;
        }

        // Show in quick pick
        const selected = await vscode.window.showQuickPick(subclasses, {
            placeHolder: `Subclasses of ${className}`
        });

        if (selected) {
            // Navigate to selected class
            await vscode.commands.executeCommand('workbench.action.quickOpen', selected);
        }
    }

    /**
     * Find all references to symbol under cursor
     */
    private async findAllReferences(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const position = editor.selection.active;
        const document = editor.document;

        // Get symbol name
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return;

        const symbolName = document.getText(wordRange);

        // Find references
        const refInfo = this.indexer.findReferences(symbolName);

        const totalRefs = refInfo.references.length;
        if (totalRefs === 0) {
            vscode.window.showInformationMessage(`No references found for '${symbolName}'`);
            return;
        }

        // Group by type
        const summary = [
            `Found ${totalRefs} reference(s) to '${symbolName}':`,
            `  Definitions: ${refInfo.definitions.length}`,
            `  Reads: ${refInfo.reads.length}`,
            `  Writes: ${refInfo.writes.length}`,
            `  Calls: ${refInfo.calls.length}`
        ].join('\n');

        vscode.window.showInformationMessage(summary, { modal: true });

        // Use built-in references view
        await vscode.commands.executeCommand('editor.action.findReferences', document.uri, position);
    }

    /**
     * Go to related Rails files
     */
    private async goToRelatedFiles(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const document = editor.document;
        const position = editor.selection.active;

        // Get model name
        let modelName = await this.findContainingClass(document, position);
        if (!modelName) return;

        // Remove "Controller" suffix if present
        modelName = modelName.replace(/Controller$/, '').replace(/s$/, '');

        // Get Rails components
        const components = await this.indexer.getRailsComponents(modelName);

        // Build quick pick items
        const items: vscode.QuickPickItem[] = [];

        if (components.model) {
            items.push({
                label: '$(symbol-class) Model',
                description: modelName,
                detail: components.model.uri.fsPath
            });
        }

        if (components.controller) {
            items.push({
                label: '$(symbol-method) Controller',
                description: `${modelName}sController`,
                detail: components.controller.uri.fsPath
            });
        }

        if (components.views.length > 0) {
            for (const view of components.views) {
                const fileName = view.uri.fsPath.split('/').pop();
                items.push({
                    label: '$(file-code) View',
                    description: fileName,
                    detail: view.uri.fsPath
                });
            }
        }

        if (components.specs.model) {
            items.push({
                label: '$(beaker) Model Spec',
                description: `${modelName} spec`,
                detail: components.specs.model.uri.fsPath
            });
        }

        if (components.specs.controller) {
            items.push({
                label: '$(beaker) Controller Spec',
                description: `${modelName}sController spec`,
                detail: components.specs.controller.uri.fsPath
            });
        }

        if (components.migration) {
            items.push({
                label: '$(database) Migration',
                description: `Create ${modelName}s`,
                detail: components.migration.uri.fsPath
            });
        }

        if (components.factory) {
            items.push({
                label: '$(tools) Factory',
                description: `${modelName}s factory`,
                detail: components.factory.uri.fsPath
            });
        }

        if (items.length === 0) {
            vscode.window.showInformationMessage(`No related files found for ${modelName}`);
            return;
        }

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Related files for ${modelName}`
        });

        if (selected && selected.detail) {
            await vscode.window.showTextDocument(vscode.Uri.file(selected.detail));
        }
    }

    /**
     * Find view template for controller action
     */
    private async findViewForAction(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const document = editor.document;
        const position = editor.selection.active;

        // Get controller name
        const controllerName = await this.findContainingClass(document, position);
        if (!controllerName || !controllerName.includes('Controller')) {
            vscode.window.showErrorMessage('Not in a controller file');
            return;
        }

        // Get current action (method name)
        const action = await this.findContainingMethod(document, position);
        if (!action) {
            vscode.window.showErrorMessage('Not in a controller action');
            return;
        }

        // Find view
        const viewLocation = await this.indexer.findViewForAction(controllerName, action);

        if (!viewLocation) {
            vscode.window.showInformationMessage(`No view found for ${controllerName}#${action}`);
            return;
        }

        await vscode.window.showTextDocument(viewLocation.uri);
    }

    /**
     * Show route information for controller action
     */
    private async showRouteInfo(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const document = editor.document;
        const position = editor.selection.active;

        // Get controller name
        const controllerName = await this.findContainingClass(document, position);
        if (!controllerName) return;

        // Get action name
        const action = await this.findContainingMethod(document, position);
        if (!action) return;

        // Get route info
        const route = this.indexer.getRouteInfo(controllerName, action);

        if (!route) {
            vscode.window.showInformationMessage(`No route found for ${controllerName}#${action}`);
            return;
        }

        const info = [
            `Route for ${controllerName}#${action}:`,
            `  Path: ${route.path}`,
            `  Method: ${route.httpMethod}`,
            `  Controller: ${route.controller}`,
            `  Action: ${route.action}`
        ].join('\n');

        vscode.window.showInformationMessage(info, { modal: true });
    }

    /**
     * Detect and show dead code
     */
    private async detectDeadCode(): Promise<void> {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Detecting dead code...',
            cancellable: false
        }, async () => {
            const analysis = this.indexer.detectDeadCode();

            if (analysis.totalItems === 0) {
                vscode.window.showInformationMessage('✅ No dead code detected!');
                return;
            }

            const message = [
                `Found ${analysis.totalItems} potentially unused items:`,
                `  Unused classes: ${analysis.unusedClasses.length}`,
                `  Unused methods: ${analysis.unusedMethods.length}`,
                `  Unused constants: ${analysis.unusedConstants.length}`,
                ``,
                `Confidence: ${analysis.confidence.toUpperCase()}`
            ].join('\n');

            const action = await vscode.window.showWarningMessage(
                message,
                { modal: true },
                'Show Details',
                'Dismiss'
            );

            if (action === 'Show Details') {
                // Create a new document with dead code report
                const report = this.generateDeadCodeReport(analysis);
                const doc = await vscode.workspace.openTextDocument({
                    content: report,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(doc);
            }
        });
    }

    /**
     * Smart search with ranking
     */
    private async smartSearch(): Promise<void> {
        const query = await vscode.window.showInputBox({
            placeHolder: 'Search for classes, methods, constants...',
            prompt: 'Smart search with context-aware ranking'
        });

        if (!query) return;

        const editor = vscode.window.activeTextEditor;
        const currentFile = editor?.document.uri;
        const currentClass = editor ? await this.findContainingClass(editor.document, editor.selection.active) : undefined;

        // Determine file type
        let fileType: 'model' | 'controller' | 'view' | 'spec' | 'other' | undefined;
        if (currentFile) {
            const path = currentFile.fsPath;
            if (path.includes('/app/models/')) fileType = 'model';
            else if (path.includes('/app/controllers/')) fileType = 'controller';
            else if (path.includes('/app/views/')) fileType = 'view';
            else if (path.includes('/spec/')) fileType = 'spec';
            else fileType = 'other';
        }

        const results = this.indexer.search(query, {
            currentFile,
            currentClass,
            fileType
        });

        if (results.length === 0) {
            vscode.window.showInformationMessage(`No results found for '${query}'`);
            return;
        }

        // Show results in quick pick
        const items = results.slice(0, 50).map(result => {
            const reasonsText = result.reasons
                .slice(0, 2)
                .map(r => r.explanation)
                .join(', ');

            return {
                label: result.symbol.name,
                description: `Score: ${result.score.toFixed(0)} - ${reasonsText}`,
                detail: result.symbol.location.uri.fsPath,
                location: result.symbol.location
            };
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Found ${results.length} results for '${query}'`
        });

        if (selected) {
            await vscode.window.showTextDocument(selected.location.uri, {
                selection: selected.location.range
            });
        }
    }

    /**
     * Find containing class for position
     */
    private async findContainingClass(document: vscode.TextDocument, position: vscode.Position): Promise<string | undefined> {
        const text = document.getText();
        const lines = text.split('\n');

        for (let i = position.line; i >= 0; i--) {
            const match = lines[i].match(/^class\s+([A-Z]\w*(::[A-Z]\w*)*)/);
            if (match) {
                return match[1];
            }
        }

        return undefined;
    }

    /**
     * Find containing method for position
     */
    private async findContainingMethod(document: vscode.TextDocument, position: vscode.Position): Promise<string | undefined> {
        const text = document.getText();
        const lines = text.split('\n');

        for (let i = position.line; i >= 0; i--) {
            const match = lines[i].match(/^\s*def\s+(self\.)?([a-z_]\w*[?!]?)/);
            if (match) {
                return match[2];
            }
        }

        return undefined;
    }

    /**
     * Generate dead code report
     */
    private generateDeadCodeReport(analysis: any): string {
        const lines: string[] = [];

        lines.push('# Dead Code Analysis Report');
        lines.push('');
        lines.push(`**Total unused items**: ${analysis.totalItems}`);
        lines.push(`**Confidence**: ${analysis.confidence.toUpperCase()}`);
        lines.push('');

        if (analysis.unusedClasses.length > 0) {
            lines.push('## Unused Classes');
            lines.push('');
            for (const item of analysis.unusedClasses) {
                lines.push(`### ${item.name}`);
                lines.push(`**Location**: ${item.location.uri.fsPath}:${item.location.range.start.line + 1}`);
                lines.push(`**Reason**: ${item.reason}`);
                lines.push('');
            }
        }

        if (analysis.unusedMethods.length > 0) {
            lines.push('## Unused Methods');
            lines.push('');
            for (const item of analysis.unusedMethods) {
                lines.push(`### ${item.name}`);
                lines.push(`**Location**: ${item.location.uri.fsPath}:${item.location.range.start.line + 1}`);
                lines.push(`**Reason**: ${item.reason}`);
                lines.push('');
            }
        }

        return lines.join('\n');
    }
}

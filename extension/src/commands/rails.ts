import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface RailsRoute {
    name?: string;
    verb: string;
    path: string;
    controller: string;
    action: string;
}

export class RailsCommands {
    private outputChannel: vscode.OutputChannel;
    private routesCache: RailsRoute[] | null = null;
    private schemaCache: Map<string, any> | null = null;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    registerCommands(context: vscode.ExtensionContext): void {
        // Navigate to related Rails files
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.rails.navigateToModel', () => this.navigateToModel())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.rails.navigateToController', () => this.navigateToController())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.rails.navigateToView', () => this.navigateToView())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.rails.navigateToMigration', () => this.navigateToMigration())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.rails.navigateToSpec', () => this.navigateToSpec())
        );

        // Route navigation
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.rails.showRoutes', () => this.showRoutes())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.rails.goToRoute', () => this.goToRoute())
        );

        // Generator commands
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.rails.generateModel', () => this.generateModel())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.rails.generateController', () => this.generateController())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.rails.generateMigration', () => this.generateMigration())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.rails.generateScaffold', () => this.generateScaffold())
        );

        // Rails console
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.rails.openConsole', () => this.openConsole())
        );

        // Schema navigation
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.rails.showSchema', () => this.showSchema())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.rails.goToTableDefinition', () => this.goToTableDefinition())
        );

        // Migration helpers
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.rails.runMigrations', () => this.runMigrations())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.rails.rollbackMigration', () => this.rollbackMigration())
        );

        // Concerns navigation
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.rails.goToConcern', () => this.goToConcern())
        );
    }

    private async navigateToModel(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const currentFile = editor.document.uri.fsPath;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        let modelName: string | undefined;

        // Extract model name based on current file type
        if (currentFile.includes('/controllers/')) {
            const match = currentFile.match(/(\w+)_controller\.rb$/);
            if (match) {
                modelName = this.singularize(match[1]);
            }
        } else if (currentFile.includes('/views/')) {
            const parts = currentFile.split('/views/');
            if (parts[1]) {
                modelName = this.singularize(parts[1].split('/')[0]);
            }
        }

        if (!modelName) {
            modelName = await vscode.window.showInputBox({
                prompt: 'Enter model name',
                placeHolder: 'User'
            });
        }

        if (!modelName) return;

        const modelPath = path.join(
            workspaceFolder.uri.fsPath,
            'app',
            'models',
            `${modelName.toLowerCase()}.rb`
        );

        try {
            const document = await vscode.workspace.openTextDocument(modelPath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showErrorMessage(`Model not found: ${modelName}`);
        }
    }

    private async navigateToController(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const currentFile = editor.document.uri.fsPath;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        let controllerName: string | undefined;

        // Extract controller name based on current file type
        if (currentFile.includes('/models/')) {
            const match = currentFile.match(/(\w+)\.rb$/);
            if (match) {
                controllerName = this.pluralize(match[1]);
            }
        } else if (currentFile.includes('/views/')) {
            const parts = currentFile.split('/views/');
            if (parts[1]) {
                controllerName = parts[1].split('/')[0];
            }
        }

        if (!controllerName) {
            controllerName = await vscode.window.showInputBox({
                prompt: 'Enter controller name (plural)',
                placeHolder: 'users'
            });
        }

        if (!controllerName) return;

        const controllerPath = path.join(
            workspaceFolder.uri.fsPath,
            'app',
            'controllers',
            `${controllerName.toLowerCase()}_controller.rb`
        );

        try {
            const document = await vscode.workspace.openTextDocument(controllerPath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showErrorMessage(`Controller not found: ${controllerName}`);
        }
    }

    private async navigateToView(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const currentFile = editor.document.uri.fsPath;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        let resourceName: string | undefined;
        let actionName: string | undefined;

        // Try to extract from controller
        if (currentFile.includes('/controllers/')) {
            const match = currentFile.match(/(\w+)_controller\.rb$/);
            if (match) {
                resourceName = match[1];
                // Try to find current method name
                const text = editor.document.getText();
                const cursorOffset = editor.document.offsetAt(editor.selection.active);
                const beforeCursor = text.substring(0, cursorOffset);
                const methodMatch = beforeCursor.match(/def\s+(\w+)\s*$/m);
                if (methodMatch) {
                    actionName = methodMatch[1];
                }
            }
        }

        if (!resourceName) {
            resourceName = await vscode.window.showInputBox({
                prompt: 'Enter resource name (plural)',
                placeHolder: 'users'
            });
        }

        if (!resourceName) return;

        const viewsDir = path.join(workspaceFolder.uri.fsPath, 'app', 'views', resourceName.toLowerCase());

        try {
            const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(viewsDir));
            const viewFiles = files
                .filter(([name]) => name.endsWith('.html.erb') || name.endsWith('.html.haml'))
                .map(([name]) => ({
                    label: name,
                    description: `app/views/${resourceName}/${name}`
                }));

            if (viewFiles.length === 0) {
                vscode.window.showInformationMessage(`No views found for ${resourceName}`);
                return;
            }

            // If we know the action, try to find that view
            if (actionName) {
                const actionView = viewFiles.find(f => f.label.startsWith(actionName));
                if (actionView) {
                    const viewPath = path.join(viewsDir, actionView.label);
                    const document = await vscode.workspace.openTextDocument(viewPath);
                    await vscode.window.showTextDocument(document);
                    return;
                }
            }

            // Otherwise, show picker
            const selected = await vscode.window.showQuickPick(viewFiles, {
                placeHolder: 'Select view to open'
            });

            if (selected) {
                const viewPath = path.join(viewsDir, selected.label);
                const document = await vscode.workspace.openTextDocument(viewPath);
                await vscode.window.showTextDocument(document);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Views not found for: ${resourceName}`);
        }
    }

    private async navigateToMigration(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const currentFile = editor.document.uri.fsPath;
        let tableName: string | undefined;

        // Try to extract table name from model
        if (currentFile.includes('/models/')) {
            const match = currentFile.match(/(\w+)\.rb$/);
            if (match) {
                tableName = this.pluralize(match[1]);
            }
        }

        const migrationsDir = path.join(workspaceFolder.uri.fsPath, 'db', 'migrate');

        try {
            const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(migrationsDir));
            let migrationFiles = files
                .filter(([name]) => name.endsWith('.rb'))
                .map(([name]) => ({
                    label: name,
                    description: `db/migrate/${name}`
                }));

            // Filter by table name if we have it
            if (tableName) {
                const filtered = migrationFiles.filter(f =>
                    f.label.includes(`create_${tableName}`) ||
                    f.label.includes(`add_`) && f.label.includes(`_to_${tableName}`)
                );
                if (filtered.length > 0) {
                    migrationFiles = filtered;
                }
            }

            if (migrationFiles.length === 0) {
                vscode.window.showInformationMessage('No migrations found');
                return;
            }

            if (migrationFiles.length === 1) {
                const migrationPath = path.join(migrationsDir, migrationFiles[0].label);
                const document = await vscode.workspace.openTextDocument(migrationPath);
                await vscode.window.showTextDocument(document);
                return;
            }

            const selected = await vscode.window.showQuickPick(migrationFiles, {
                placeHolder: 'Select migration to open'
            });

            if (selected) {
                const migrationPath = path.join(migrationsDir, selected.label);
                const document = await vscode.workspace.openTextDocument(migrationPath);
                await vscode.window.showTextDocument(document);
            }
        } catch (error) {
            vscode.window.showErrorMessage('Migrations directory not found');
        }
    }

    private async navigateToSpec(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const currentFile = editor.document.uri.fsPath;
        let specPath: string;

        if (currentFile.includes('/spec/')) {
            // Go from spec to implementation
            specPath = currentFile
                .replace('/spec/', '/app/')
                .replace('_spec.rb', '.rb');
        } else {
            // Go from implementation to spec
            specPath = currentFile
                .replace('/app/', '/spec/')
                .replace('.rb', '_spec.rb');
        }

        try {
            const document = await vscode.workspace.openTextDocument(specPath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showWarningMessage(`File not found: ${path.basename(specPath)}`);
        }
    }

    private async showRoutes(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const routes = await this.parseRoutes(workspaceFolder.uri.fsPath);

        if (routes.length === 0) {
            vscode.window.showInformationMessage('No routes found. Run "rails routes" to see routes.');
            return;
        }

        const items = routes.map(route => ({
            label: `$(symbol-method) ${route.verb} ${route.path}`,
            description: `${route.controller}#${route.action}`,
            detail: route.name,
            route
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select route to navigate to controller action',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            await this.navigateToControllerAction(
                workspaceFolder.uri.fsPath,
                selected.route.controller,
                selected.route.action
            );
        }
    }

    private async goToRoute(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const routeName = await vscode.window.showInputBox({
            prompt: 'Enter route name or path',
            placeHolder: 'users_path or /users'
        });

        if (!routeName) return;

        const routes = await this.parseRoutes(workspaceFolder.uri.fsPath);
        const route = routes.find(r =>
            r.name === routeName ||
            r.path === routeName ||
            r.name === routeName.replace('_path', '') ||
            r.name === routeName.replace('_url', '')
        );

        if (route) {
            await this.navigateToControllerAction(
                workspaceFolder.uri.fsPath,
                route.controller,
                route.action
            );
        } else {
            vscode.window.showWarningMessage(`Route not found: ${routeName}`);
        }
    }

    private async generateModel(): Promise<void> {
        const modelName = await vscode.window.showInputBox({
            prompt: 'Enter model name',
            placeHolder: 'User'
        });

        if (!modelName) return;

        const attributes = await vscode.window.showInputBox({
            prompt: 'Enter attributes (e.g., name:string email:string)',
            placeHolder: 'name:string email:string age:integer'
        });

        const terminal = vscode.window.createTerminal('Rails Generate');
        terminal.show();
        terminal.sendText(`rails generate model ${modelName} ${attributes || ''}`);
    }

    private async generateController(): Promise<void> {
        const controllerName = await vscode.window.showInputBox({
            prompt: 'Enter controller name',
            placeHolder: 'Users'
        });

        if (!controllerName) return;

        const actions = await vscode.window.showInputBox({
            prompt: 'Enter actions (optional)',
            placeHolder: 'index show new create'
        });

        const terminal = vscode.window.createTerminal('Rails Generate');
        terminal.show();
        terminal.sendText(`rails generate controller ${controllerName} ${actions || ''}`);
    }

    private async generateMigration(): Promise<void> {
        const migrationName = await vscode.window.showInputBox({
            prompt: 'Enter migration name',
            placeHolder: 'AddEmailToUsers'
        });

        if (!migrationName) return;

        const terminal = vscode.window.createTerminal('Rails Generate');
        terminal.show();
        terminal.sendText(`rails generate migration ${migrationName}`);
    }

    private async generateScaffold(): Promise<void> {
        const resourceName = await vscode.window.showInputBox({
            prompt: 'Enter resource name',
            placeHolder: 'Post'
        });

        if (!resourceName) return;

        const attributes = await vscode.window.showInputBox({
            prompt: 'Enter attributes',
            placeHolder: 'title:string content:text'
        });

        const terminal = vscode.window.createTerminal('Rails Generate');
        terminal.show();
        terminal.sendText(`rails generate scaffold ${resourceName} ${attributes || ''}`);
    }

    private async openConsole(): Promise<void> {
        const terminal = vscode.window.createTerminal('Rails Console');
        terminal.show();
        terminal.sendText('rails console');
    }

    private async showSchema(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const schemaPath = path.join(workspaceFolder.uri.fsPath, 'db', 'schema.rb');

        try {
            const document = await vscode.workspace.openTextDocument(schemaPath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showErrorMessage('schema.rb not found');
        }
    }

    private async goToTableDefinition(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const currentFile = editor.document.uri.fsPath;
        let tableName: string | undefined;

        // Extract table name from model
        if (currentFile.includes('/models/')) {
            const match = currentFile.match(/(\w+)\.rb$/);
            if (match) {
                tableName = this.pluralize(match[1]);
            }
        }

        if (!tableName) {
            tableName = await vscode.window.showInputBox({
                prompt: 'Enter table name',
                placeHolder: 'users'
            });
        }

        if (!tableName) return;

        const schemaPath = path.join(workspaceFolder.uri.fsPath, 'db', 'schema.rb');

        try {
            const document = await vscode.workspace.openTextDocument(schemaPath);
            const text = document.getText();
            const regex = new RegExp(`create_table\\s+"${tableName}"`, 'i');
            const match = regex.exec(text);

            if (match) {
                const position = document.positionAt(match.index);
                await vscode.window.showTextDocument(document, {
                    selection: new vscode.Range(position, position)
                });
            } else {
                await vscode.window.showTextDocument(document);
                vscode.window.showWarningMessage(`Table "${tableName}" not found in schema`);
            }
        } catch (error) {
            vscode.window.showErrorMessage('schema.rb not found');
        }
    }

    private async runMigrations(): Promise<void> {
        const terminal = vscode.window.createTerminal('Rails Migrate');
        terminal.show();
        terminal.sendText('rails db:migrate');
    }

    private async rollbackMigration(): Promise<void> {
        const steps = await vscode.window.showInputBox({
            prompt: 'How many migrations to rollback? (default: 1)',
            placeHolder: '1',
            value: '1'
        });

        const terminal = vscode.window.createTerminal('Rails Rollback');
        terminal.show();
        terminal.sendText(`rails db:rollback STEP=${steps || '1'}`);
    }

    private async goToConcern(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const concernsDir = [
            path.join(workspaceFolder.uri.fsPath, 'app', 'models', 'concerns'),
            path.join(workspaceFolder.uri.fsPath, 'app', 'controllers', 'concerns')
        ];

        const concerns: Array<{ label: string; path: string }> = [];

        for (const dir of concernsDir) {
            try {
                const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
                files.forEach(([name]) => {
                    if (name.endsWith('.rb')) {
                        concerns.push({
                            label: name.replace('.rb', ''),
                            path: path.join(dir, name)
                        });
                    }
                });
            } catch {
                // Directory doesn't exist, skip
            }
        }

        if (concerns.length === 0) {
            vscode.window.showInformationMessage('No concerns found');
            return;
        }

        const selected = await vscode.window.showQuickPick(concerns, {
            placeHolder: 'Select concern to open'
        });

        if (selected) {
            const document = await vscode.workspace.openTextDocument(selected.path);
            await vscode.window.showTextDocument(document);
        }
    }

    // Helper methods

    private async parseRoutes(workspacePath: string): Promise<RailsRoute[]> {
        if (this.routesCache) {
            return this.routesCache;
        }

        // Try to read routes.rb and parse basic routes
        // This is a simplified parser - in production, run `rails routes` command
        const routesPath = path.join(workspacePath, 'config', 'routes.rb');

        try {
            const content = fs.readFileSync(routesPath, 'utf8');
            const routes: RailsRoute[] = [];

            // Parse resources
            const resourceMatches = content.matchAll(/resources\s+:(\w+)/g);
            for (const match of resourceMatches) {
                const resource = match[1];
                const controller = resource;

                ['index', 'show', 'new', 'create', 'edit', 'update', 'destroy'].forEach(action => {
                    routes.push({
                        name: `${resource}_${action}`,
                        verb: this.verbForAction(action),
                        path: `/${resource}`,
                        controller,
                        action
                    });
                });
            }

            // Parse individual routes
            const routeMatches = content.matchAll(/(?:get|post|put|patch|delete)\s+['"]([^'"]+)['"]\s*,\s*to:\s*['"](\w+)#(\w+)['"]/g);
            for (const match of routeMatches) {
                routes.push({
                    verb: match[0].split(' ')[0].toUpperCase(),
                    path: match[1],
                    controller: match[2],
                    action: match[3]
                });
            }

            this.routesCache = routes;
            return routes;
        } catch (error) {
            this.outputChannel.appendLine(`Failed to parse routes: ${error}`);
            return [];
        }
    }

    private async navigateToControllerAction(workspacePath: string, controller: string, action: string): Promise<void> {
        const controllerPath = path.join(
            workspacePath,
            'app',
            'controllers',
            `${controller}_controller.rb`
        );

        try {
            const document = await vscode.workspace.openTextDocument(controllerPath);
            const text = document.getText();
            const regex = new RegExp(`def\\s+${action}\\b`);
            const match = regex.exec(text);

            if (match) {
                const position = document.positionAt(match.index);
                await vscode.window.showTextDocument(document, {
                    selection: new vscode.Range(position, position)
                });
            } else {
                await vscode.window.showTextDocument(document);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Controller not found: ${controller}_controller.rb`);
        }
    }

    private verbForAction(action: string): string {
        const verbMap: { [key: string]: string } = {
            index: 'GET',
            show: 'GET',
            new: 'GET',
            create: 'POST',
            edit: 'GET',
            update: 'PATCH',
            destroy: 'DELETE'
        };
        return verbMap[action] || 'GET';
    }

    private singularize(word: string): string {
        // Simple singularization
        if (word.endsWith('ies')) {
            return word.slice(0, -3) + 'y';
        }
        if (word.endsWith('es')) {
            return word.slice(0, -2);
        }
        if (word.endsWith('s')) {
            return word.slice(0, -1);
        }
        return word;
    }

    private pluralize(word: string): string {
        // Simple pluralization
        if (word.endsWith('y')) {
            return word.slice(0, -1) + 'ies';
        }
        if (word.endsWith('s') || word.endsWith('x') || word.endsWith('ch') || word.endsWith('sh')) {
            return word + 'es';
        }
        return word + 's';
    }
}

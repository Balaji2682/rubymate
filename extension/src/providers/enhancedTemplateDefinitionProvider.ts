import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Enhanced Template Definition Provider
 *
 * Professional IDE-level support for all Rails render patterns:
 * - render 'users/form'
 * - render partial: 'shared/header', locals: { ... }
 * - render @user (model instance)
 * - render @users (collection)
 * - render [user1, user2] (array)
 * - render User.new (class instance)
 * - render template: 'layouts/admin'
 * - render layout: 'application'
 * - render file: '/path/to/file'
 * - render controller_action (from controller)
 * - Custom helper method navigation
 */
export class EnhancedTemplateDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        const line = document.lineAt(position.line);
        const lineText = line.text;
        const wordRange = document.getWordRangeAtPosition(position, /[@a-zA-Z_][\w]*/);

        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return undefined;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        // Pattern 1: render 'string' or render partial: 'string'
        const renderResult = await this.handleRenderStatement(lineText, position.character, workspaceRoot, document.uri.fsPath);
        if (renderResult) {
            return renderResult;
        }

        // Pattern 2: render @variable or render @collection
        const instanceVarResult = await this.handleInstanceVariable(lineText, word, position.character, workspaceRoot);
        if (instanceVarResult) {
            return instanceVarResult;
        }

        // Pattern 3: Custom helpers (current_user, admin?, etc.)
        const helperResult = await this.handleCustomHelper(word, workspaceRoot);
        if (helperResult) {
            return helperResult;
        }

        // Pattern 4: Path helpers (user_path, edit_user_path, etc.)
        const pathHelperResult = await this.handlePathHelper(lineText, word, workspaceRoot);
        if (pathHelperResult) {
            return pathHelperResult;
        }

        return undefined;
    }

    /**
     * Handle render 'string' patterns
     */
    private async handleRenderStatement(
        lineText: string,
        characterPos: number,
        workspaceRoot: string,
        currentFilePath: string
    ): Promise<vscode.Location[] | undefined> {
        // Pattern 1: render 'partial_name' or render "partial_name"
        const simpleRenderMatch = lineText.match(/render\s+['"]([^'"]+)['"]/);
        if (simpleRenderMatch) {
            const partialName = simpleRenderMatch[1];
            const matchStart = lineText.indexOf(partialName);
            const matchEnd = matchStart + partialName.length;
            if (characterPos >= matchStart && characterPos <= matchEnd) {
                return await this.findPartialFile(workspaceRoot, partialName, currentFilePath);
            }
        }

        // Pattern 2: render partial: 'partial_name'
        const partialKeywordMatch = lineText.match(/render\s+partial:\s*['"]([^'"]+)['"]/);
        if (partialKeywordMatch) {
            const partialName = partialKeywordMatch[1];
            const matchStart = lineText.indexOf(partialName, lineText.indexOf('partial:'));
            const matchEnd = matchStart + partialName.length;
            if (characterPos >= matchStart && characterPos <= matchEnd) {
                return await this.findPartialFile(workspaceRoot, partialName, currentFilePath);
            }
        }

        // Pattern 3: render template: 'template_name'
        const templateMatch = lineText.match(/render\s+template:\s*['"]([^'"]+)['"]/);
        if (templateMatch) {
            const templateName = templateMatch[1];
            const matchStart = lineText.indexOf(templateName, lineText.indexOf('template:'));
            const matchEnd = matchStart + templateName.length;
            if (characterPos >= matchStart && characterPos <= matchEnd) {
                return await this.findTemplateFile(workspaceRoot, templateName);
            }
        }

        // Pattern 4: render layout: 'layout_name'
        const layoutMatch = lineText.match(/render\s+layout:\s*['"]([^'"]+)['"]/);
        if (layoutMatch) {
            const layoutName = layoutMatch[1];
            const matchStart = lineText.indexOf(layoutName, lineText.indexOf('layout:'));
            const matchEnd = matchStart + layoutName.length;
            if (characterPos >= matchStart && characterPos <= matchEnd) {
                return await this.findLayoutFile(workspaceRoot, layoutName);
            }
        }

        // Pattern 5: render file: '/path/to/file'
        const fileMatch = lineText.match(/render\s+file:\s*['"]([^'"]+)['"]/);
        if (fileMatch) {
            const filePath = fileMatch[1];
            const matchStart = lineText.indexOf(filePath, lineText.indexOf('file:'));
            const matchEnd = matchStart + filePath.length;
            if (characterPos >= matchStart && characterPos <= matchEnd) {
                return await this.findAbsoluteFile(workspaceRoot, filePath);
            }
        }

        // Pattern 6: render action: 'action_name' (controller action)
        const actionMatch = lineText.match(/render\s+action:\s*['"]([^'"]+)['"]/);
        if (actionMatch) {
            const actionName = actionMatch[1];
            const matchStart = lineText.indexOf(actionName, lineText.indexOf('action:'));
            const matchEnd = matchStart + actionName.length;
            if (characterPos >= matchStart && characterPos <= matchEnd) {
                return await this.findViewForAction(workspaceRoot, actionName, currentFilePath);
            }
        }

        return undefined;
    }

    /**
     * Handle render @variable patterns (model-based partials)
     */
    private async handleInstanceVariable(
        lineText: string,
        word: string,
        characterPos: number,
        workspaceRoot: string
    ): Promise<vscode.Location[] | undefined> {
        // Check if this is a render statement with instance variable
        // render @user, render @users, render @posts
        const instanceVarRenderMatch = lineText.match(/render\s+(@\w+)/);
        if (!instanceVarRenderMatch) {
            return undefined;
        }

        const instanceVar = instanceVarRenderMatch[1];
        if (word !== instanceVar.substring(1) && word !== instanceVar) {
            return undefined;
        }

        // Infer model name from instance variable
        // @user → User → _user.html.erb
        // @users → User → _user.html.erb (collection, singularize)
        // @admin_user → AdminUser → _admin_user.html.erb
        let modelName = instanceVar.substring(1); // Remove @

        // Singularize if it looks like a collection (plural)
        if (modelName.endsWith('s') && modelName.length > 1) {
            modelName = this.singularize(modelName);
        }

        // Convert to underscore case for file name
        const fileName = this.toUnderscore(modelName);

        // Try to find the model file first to confirm it exists
        const modelPath = await this.findModelFile(workspaceRoot, this.toPascalCase(modelName));
        if (!modelPath) {
            // Model doesn't exist, try generic search anyway
        }

        // Look for the partial
        return await this.findPartialForModel(workspaceRoot, fileName);
    }

    /**
     * Handle custom helper methods (current_user, admin?, etc.)
     */
    private async handleCustomHelper(
        word: string,
        workspaceRoot: string
    ): Promise<vscode.Location | undefined> {
        // Search for helper methods in app/helpers
        const helperDirs = [
            path.join(workspaceRoot, 'app', 'helpers'),
            path.join(workspaceRoot, 'app', 'controllers', 'concerns')
        ];

        for (const dir of helperDirs) {
            try {
                const files = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(dir, '**/*.rb'),
                    null,
                    100
                );

                for (const file of files) {
                    const content = await fs.promises.readFile(file.fsPath, 'utf8');

                    // Look for method definition
                    const methodRegex = new RegExp(`\\bdef\\s+${this.escapeRegex(word)}[\\s\\(]`, 'm');
                    const match = content.match(methodRegex);

                    if (match) {
                        const lines = content.substring(0, match.index).split('\n');
                        const lineNumber = lines.length - 1;
                        return new vscode.Location(file, new vscode.Position(lineNumber, 0));
                    }
                }
            } catch (error) {
                // Directory doesn't exist or error reading
            }
        }

        return undefined;
    }

    /**
     * Handle path helpers (user_path, edit_user_path, etc.)
     */
    private async handlePathHelper(
        lineText: string,
        word: string,
        workspaceRoot: string
    ): Promise<vscode.Location | undefined> {
        // Check if word ends with _path or _url
        if (!word.endsWith('_path') && !word.endsWith('_url')) {
            return undefined;
        }

        // Try to find routes.rb
        const routesPath = path.join(workspaceRoot, 'config', 'routes.rb');
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(routesPath));

            // Read routes file and search for the route definition
            const content = await fs.promises.readFile(routesPath, 'utf8');

            // Extract resource name from path helper
            // users_path → users
            // edit_user_path → user
            // admin_users_path → users (with namespace)
            let searchPattern = word.replace(/_path$/, '').replace(/_url$/, '');

            // Look for resources :users, resource :user, or specific route
            const resourceRegex = new RegExp(`resources?\\s+:${searchPattern}`, 'i');
            const match = content.match(resourceRegex);

            if (match) {
                const lines = content.substring(0, match.index).split('\n');
                const lineNumber = lines.length - 1;
                return new vscode.Location(
                    vscode.Uri.file(routesPath),
                    new vscode.Position(lineNumber, 0)
                );
            }
        } catch (error) {
            // Routes file doesn't exist
        }

        return undefined;
    }

    /**
     * Find partial file with all strategies
     */
    private async findPartialFile(
        workspaceRoot: string,
        partialPath: string,
        currentFilePath: string
    ): Promise<vscode.Location[]> {
        const locations: vscode.Location[] = [];
        const extensions = ['.html.erb', '.html.haml', '.html.slim', '.erb', '.haml', '.slim', '.builder', '.jbuilder'];

        const isFullPath = partialPath.includes('/');

        if (isFullPath) {
            // Full path: 'users/form' or 'shared/header'
            const parts = partialPath.split('/');
            const fileName = parts.pop()!;
            const dirPath = parts.join('/');

            // Try finding in app/views/<dirPath>/_<fileName>.<ext>
            for (const ext of extensions) {
                const partialFileName = `_${fileName}${ext}`;
                const fullPath = path.join(workspaceRoot, 'app', 'views', dirPath, partialFileName);

                try {
                    await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
                    locations.push(new vscode.Location(vscode.Uri.file(fullPath), new vscode.Position(0, 0)));
                } catch {
                    // File doesn't exist, continue
                }
            }
        } else {
            // Relative path: 'form' or 'header'
            const currentDir = path.dirname(currentFilePath);

            // Try current directory first
            for (const ext of extensions) {
                const partialFileName = `_${partialPath}${ext}`;
                const fullPath = path.join(currentDir, partialFileName);

                try {
                    await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
                    locations.push(new vscode.Location(vscode.Uri.file(fullPath), new vscode.Position(0, 0)));
                } catch {
                    // File doesn't exist, continue
                }
            }

            // Try app/views/shared
            if (locations.length === 0) {
                for (const ext of extensions) {
                    const partialFileName = `_${partialPath}${ext}`;
                    const fullPath = path.join(workspaceRoot, 'app', 'views', 'shared', partialFileName);

                    try {
                        await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
                        locations.push(new vscode.Location(vscode.Uri.file(fullPath), new vscode.Position(0, 0)));
                    } catch {
                        // File doesn't exist, continue
                    }
                }
            }

            // Try app/views/application
            if (locations.length === 0) {
                for (const ext of extensions) {
                    const partialFileName = `_${partialPath}${ext}`;
                    const fullPath = path.join(workspaceRoot, 'app', 'views', 'application', partialFileName);

                    try {
                        await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
                        locations.push(new vscode.Location(vscode.Uri.file(fullPath), new vscode.Position(0, 0)));
                    } catch {
                        // File doesn't exist, continue
                    }
                }
            }
        }

        // Fuzzy search as last resort
        if (locations.length === 0) {
            const fuzzyLocations = await this.fuzzyFindPartial(workspaceRoot, partialPath);
            locations.push(...fuzzyLocations);
        }

        return locations;
    }

    /**
     * Find template file (non-partial)
     */
    private async findTemplateFile(workspaceRoot: string, templatePath: string): Promise<vscode.Location[]> {
        const locations: vscode.Location[] = [];
        const extensions = ['.html.erb', '.html.haml', '.html.slim', '.erb', '.haml', '.slim'];

        for (const ext of extensions) {
            const fullPath = path.join(workspaceRoot, 'app', 'views', `${templatePath}${ext}`);

            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
                locations.push(new vscode.Location(vscode.Uri.file(fullPath), new vscode.Position(0, 0)));
            } catch {
                // File doesn't exist, continue
            }
        }

        return locations;
    }

    /**
     * Find layout file
     */
    private async findLayoutFile(workspaceRoot: string, layoutName: string): Promise<vscode.Location[]> {
        const locations: vscode.Location[] = [];
        const extensions = ['.html.erb', '.html.haml', '.html.slim', '.erb', '.haml', '.slim'];

        for (const ext of extensions) {
            const fullPath = path.join(workspaceRoot, 'app', 'views', 'layouts', `${layoutName}${ext}`);

            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
                locations.push(new vscode.Location(vscode.Uri.file(fullPath), new vscode.Position(0, 0)));
            } catch {
                // File doesn't exist, continue
            }
        }

        return locations;
    }

    /**
     * Find absolute file path
     */
    private async findAbsoluteFile(workspaceRoot: string, filePath: string): Promise<vscode.Location[]> {
        const locations: vscode.Location[] = [];

        // If path is absolute, use as-is
        // If relative, make it relative to workspace root
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);

        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
            locations.push(new vscode.Location(vscode.Uri.file(fullPath), new vscode.Position(0, 0)));
        } catch {
            // File doesn't exist
        }

        return locations;
    }

    /**
     * Find view for controller action
     */
    private async findViewForAction(
        workspaceRoot: string,
        actionName: string,
        currentFilePath: string
    ): Promise<vscode.Location[]> {
        // Infer controller name from current file path
        // app/views/users/index.html.erb → users controller
        const viewPathMatch = currentFilePath.match(/app\/views\/([^\/]+)\//);
        if (!viewPathMatch) {
            return [];
        }

        const controllerName = viewPathMatch[1];
        const extensions = ['.html.erb', '.html.haml', '.html.slim'];

        const locations: vscode.Location[] = [];
        for (const ext of extensions) {
            const fullPath = path.join(workspaceRoot, 'app', 'views', controllerName, `${actionName}${ext}`);

            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
                locations.push(new vscode.Location(vscode.Uri.file(fullPath), new vscode.Position(0, 0)));
            } catch {
                // File doesn't exist, continue
            }
        }

        return locations;
    }

    /**
     * Find model file
     */
    private async findModelFile(workspaceRoot: string, modelName: string): Promise<string | null> {
        const modelPath = path.join(workspaceRoot, 'app', 'models', `${this.toUnderscore(modelName)}.rb`);

        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(modelPath));
            return modelPath;
        } catch {
            return null;
        }
    }

    /**
     * Find partial for model (render @user style)
     */
    private async findPartialForModel(workspaceRoot: string, modelName: string): Promise<vscode.Location[]> {
        const locations: vscode.Location[] = [];
        const viewsDir = path.join(workspaceRoot, 'app', 'views');

        // Try app/views/<model_name>/_<model_name>.html.erb first
        const pluralName = this.pluralize(modelName);
        const extensions = ['.html.erb', '.html.haml', '.html.slim'];

        for (const ext of extensions) {
            const partialFileName = `_${modelName}${ext}`;
            const fullPath = path.join(viewsDir, pluralName, partialFileName);

            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
                locations.push(new vscode.Location(vscode.Uri.file(fullPath), new vscode.Position(0, 0)));
            } catch {
                // File doesn't exist, continue
            }
        }

        // Try fuzzy search if not found
        if (locations.length === 0) {
            const pattern = new vscode.RelativePattern(viewsDir, `**/_${modelName}.*`);
            const files = await vscode.workspace.findFiles(pattern, null, 10);

            for (const file of files) {
                locations.push(new vscode.Location(file, new vscode.Position(0, 0)));
            }
        }

        return locations;
    }

    /**
     * Fuzzy search for partial
     */
    private async fuzzyFindPartial(workspaceRoot: string, partialPath: string): Promise<vscode.Location[]> {
        const locations: vscode.Location[] = [];
        const viewsDir = path.join(workspaceRoot, 'app', 'views');

        try {
            const fileName = partialPath.split('/').pop() || partialPath;
            const pattern = new vscode.RelativePattern(viewsDir, `**/_${fileName}.*`);
            const files = await vscode.workspace.findFiles(pattern, null, 10);

            for (const file of files) {
                locations.push(new vscode.Location(file, new vscode.Position(0, 0)));
            }
        } catch (error) {
            // Directory doesn't exist or other error
        }

        return locations;
    }

    // Helper methods for string transformation

    private singularize(word: string): string {
        const irregularMap: { [key: string]: string } = {
            'people': 'person',
            'men': 'man',
            'women': 'woman',
            'children': 'child',
            'teeth': 'tooth',
            'feet': 'foot',
            'mice': 'mouse',
            'geese': 'goose'
        };

        if (irregularMap[word.toLowerCase()]) {
            return irregularMap[word.toLowerCase()];
        }

        if (word.endsWith('ies')) {
            return word.slice(0, -3) + 'y';
        }
        if (word.endsWith('ses')) {
            return word.slice(0, -2);
        }
        if (word.endsWith('s') && !word.endsWith('ss')) {
            return word.slice(0, -1);
        }

        return word;
    }

    private pluralize(word: string): string {
        const irregularMap: { [key: string]: string } = {
            'person': 'people',
            'man': 'men',
            'woman': 'women',
            'child': 'children',
            'tooth': 'teeth',
            'foot': 'feet',
            'mouse': 'mice',
            'goose': 'geese'
        };

        if (irregularMap[word.toLowerCase()]) {
            return irregularMap[word.toLowerCase()];
        }

        if (word.endsWith('y') && !/[aeiou]y$/.test(word)) {
            return word.slice(0, -1) + 'ies';
        }
        if (word.endsWith('s') || word.endsWith('x') || word.endsWith('z') ||
            word.endsWith('ch') || word.endsWith('sh')) {
            return word + 'es';
        }

        return word + 's';
    }

    private toUnderscore(str: string): string {
        return str
            .replace(/([A-Z])/g, '_$1')
            .toLowerCase()
            .replace(/^_/, '');
    }

    private toPascalCase(str: string): string {
        return str
            .split('_')
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join('');
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

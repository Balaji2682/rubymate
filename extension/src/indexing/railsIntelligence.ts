import * as vscode from 'vscode';
import * as path from 'path';
import { SemanticGraphBuilder } from './semanticGraph';

/**
 * Rails Convention Intelligence - Navigate between Rails components
 */

export interface RailsComponent {
    model?: vscode.Location;
    controller?: vscode.Location;
    views: vscode.Location[];
    specs: RailsSpecs;
    migration?: vscode.Location;
    factory?: vscode.Location;
    serializer?: vscode.Location;
    concern?: vscode.Location;
}

export interface RailsSpecs {
    model?: vscode.Location;
    controller?: vscode.Location;
    request?: vscode.Location;
    feature?: vscode.Location;
}

export interface RouteInfo {
    path: string;
    httpMethod: string;
    controller: string;
    action: string;
    location?: vscode.Location;
}

export class RailsIntelligence {
    private graphBuilder: SemanticGraphBuilder;
    private workspaceRoot: string;
    private routes: Map<string, RouteInfo> = new Map();

    constructor(graphBuilder: SemanticGraphBuilder, workspaceRoot: string) {
        this.graphBuilder = graphBuilder;
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * Get all related Rails components for a model
     */
    async getRelatedComponents(modelName: string): Promise<RailsComponent> {
        const component: RailsComponent = {
            views: [],
            specs: {}
        };

        // Find model file
        component.model = await this.findModel(modelName);

        // Find controller
        component.controller = await this.findController(modelName);

        // Find views
        component.views = await this.findViews(modelName);

        // Find specs
        component.specs = await this.findSpecs(modelName);

        // Find migration
        component.migration = await this.findMigration(modelName);

        // Find factory
        component.factory = await this.findFactory(modelName);

        // Find serializer
        component.serializer = await this.findSerializer(modelName);

        return component;
    }

    /**
     * Find model file
     */
    private async findModel(modelName: string): Promise<vscode.Location | undefined> {
        const fileName = this.camelToSnake(modelName) + '.rb';
        const modelPath = path.join(this.workspaceRoot, 'app', 'models', fileName);

        return this.fileToLocation(modelPath);
    }

    /**
     * Find controller file
     */
    private async findController(modelName: string): Promise<vscode.Location | undefined> {
        const pluralName = this.pluralize(modelName);
        const fileName = this.camelToSnake(pluralName) + '_controller.rb';
        const controllerPath = path.join(this.workspaceRoot, 'app', 'controllers', fileName);

        return this.fileToLocation(controllerPath);
    }

    /**
     * Find view files for a model
     */
    private async findViews(modelName: string): Promise<vscode.Location[]> {
        const pluralName = this.pluralize(modelName);
        const viewDir = path.join(this.workspaceRoot, 'app', 'views', this.camelToSnake(pluralName));

        const locations: vscode.Location[] = [];

        try {
            const uri = vscode.Uri.file(viewDir);
            const files = await vscode.workspace.fs.readDirectory(uri);

            for (const [fileName, fileType] of files) {
                if (fileType === vscode.FileType.File) {
                    const filePath = path.join(viewDir, fileName);
                    const location = await this.fileToLocation(filePath);
                    if (location) {
                        locations.push(location);
                    }
                }
            }
        } catch (error) {
            // Directory doesn't exist
        }

        return locations;
    }

    /**
     * Find spec files for a model
     */
    private async findSpecs(modelName: string): Promise<RailsSpecs> {
        const specs: RailsSpecs = {};

        // Model spec
        const modelSpecPath = path.join(
            this.workspaceRoot,
            'spec',
            'models',
            this.camelToSnake(modelName) + '_spec.rb'
        );
        specs.model = await this.fileToLocation(modelSpecPath);

        // Controller spec
        const pluralName = this.pluralize(modelName);
        const controllerSpecPath = path.join(
            this.workspaceRoot,
            'spec',
            'controllers',
            this.camelToSnake(pluralName) + '_controller_spec.rb'
        );
        specs.controller = await this.fileToLocation(controllerSpecPath);

        // Request spec
        const requestSpecPath = path.join(
            this.workspaceRoot,
            'spec',
            'requests',
            this.camelToSnake(pluralName) + '_spec.rb'
        );
        specs.request = await this.fileToLocation(requestSpecPath);

        return specs;
    }

    /**
     * Find migration file for a model
     */
    private async findMigration(modelName: string): Promise<vscode.Location | undefined> {
        const tableName = this.camelToSnake(this.pluralize(modelName));
        const migrationPattern = `*_create_${tableName}.rb`;

        const migrationDir = path.join(this.workspaceRoot, 'db', 'migrate');

        try {
            const uri = vscode.Uri.file(migrationDir);
            const files = await vscode.workspace.fs.readDirectory(uri);

            for (const [fileName, fileType] of files) {
                if (fileType === vscode.FileType.File && fileName.includes(`create_${tableName}`)) {
                    const filePath = path.join(migrationDir, fileName);
                    return this.fileToLocation(filePath);
                }
            }
        } catch (error) {
            // Directory doesn't exist
        }

        return undefined;
    }

    /**
     * Find factory file
     */
    private async findFactory(modelName: string): Promise<vscode.Location | undefined> {
        const pluralName = this.pluralize(modelName);
        const fileName = this.camelToSnake(pluralName) + '.rb';
        const factoryPath = path.join(this.workspaceRoot, 'spec', 'factories', fileName);

        return this.fileToLocation(factoryPath);
    }

    /**
     * Find serializer file
     */
    private async findSerializer(modelName: string): Promise<vscode.Location | undefined> {
        const fileName = this.camelToSnake(modelName) + '_serializer.rb';
        const serializerPath = path.join(this.workspaceRoot, 'app', 'serializers', fileName);

        return this.fileToLocation(serializerPath);
    }

    /**
     * Get controller action from current position
     */
    getCurrentAction(document: vscode.TextDocument, position: vscode.Position): string | undefined {
        // Find the method containing the cursor
        const text = document.getText();
        const lines = text.split('\n');

        let methodName: string | undefined;
        for (let i = position.line; i >= 0; i--) {
            const line = lines[i];
            const match = line.match(/^\s*def\s+([a-z_]\w*)/);
            if (match) {
                methodName = match[1];
                break;
            }
        }

        return methodName;
    }

    /**
     * Find view template for controller action
     */
    async findViewForAction(controllerName: string, action: string): Promise<vscode.Location | undefined> {
        // Remove "Controller" suffix and convert to snake_case
        const resourceName = controllerName.replace(/Controller$/, '');
        const snakeName = this.camelToSnake(resourceName);

        // Look for view template
        const viewDir = path.join(this.workspaceRoot, 'app', 'views', snakeName);
        const templates = [
            `${action}.html.erb`,
            `${action}.html.haml`,
            `${action}.html.slim`,
            `${action}.json.jbuilder`
        ];

        for (const template of templates) {
            const viewPath = path.join(viewDir, template);
            const location = await this.fileToLocation(viewPath);
            if (location) {
                return location;
            }
        }

        return undefined;
    }

    /**
     * Parse routes.rb and extract route information with progress indicator
     */
    async parseRoutes(showProgress: boolean = true): Promise<void> {
        if (!showProgress) {
            // Fast path without progress indicator
            return this.parseRoutesInternal();
        }

        // Show progress indicator for potentially long operation
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Analyzing Rails routes...",
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: 'Reading routes.rb...' });
            await this.parseRoutesInternal();
            progress.report({ increment: 100, message: `Found ${this.routes.size} routes` });
        });
    }

    /**
     * Internal route parsing implementation
     */
    private async parseRoutesInternal(): Promise<void> {
        const routesPath = path.join(this.workspaceRoot, 'config', 'routes.rb');

        try {
            const uri = vscode.Uri.file(routesPath);
            const document = await vscode.workspace.openTextDocument(uri);
            const text = document.getText();
            const lines = text.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                // Match resourceful routes: resources :users
                const resourceMatch = line.match(/resources\s+:(\w+)/);
                if (resourceMatch) {
                    const resource = resourceMatch[1];
                    const controllerName = this.pluralize(this.snakeToCamel(resource)) + 'Controller';

                    // Add standard REST actions
                    const actions = ['index', 'show', 'new', 'create', 'edit', 'update', 'destroy'];
                    for (const action of actions) {
                        const route: RouteInfo = {
                            path: `/${resource}`,
                            httpMethod: this.getHttpMethod(action),
                            controller: controllerName,
                            action,
                            location: new vscode.Location(uri, new vscode.Position(i, 0))
                        };
                        this.routes.set(`${controllerName}#${action}`, route);
                    }
                }

                // Match individual routes: get '/about', to: 'pages#about'
                const routeMatch = line.match(/(get|post|put|patch|delete)\s+['"](.+?)['"],\s+to:\s+['"](\w+)#(\w+)['"]/);
                if (routeMatch) {
                    const [, httpMethod, path, controller, action] = routeMatch;
                    const controllerName = this.snakeToCamel(controller) + 'Controller';

                    const route: RouteInfo = {
                        path,
                        httpMethod: httpMethod.toUpperCase(),
                        controller: controllerName,
                        action,
                        location: new vscode.Location(uri, new vscode.Position(i, 0))
                    };
                    this.routes.set(`${controllerName}#${action}`, route);
                }
            }
        } catch (error) {
            // Routes file doesn't exist or can't be read
        }
    }

    /**
     * Get route info for a controller action
     */
    getRouteInfo(controllerName: string, action: string): RouteInfo | undefined {
        return this.routes.get(`${controllerName}#${action}`);
    }

    /**
     * Get all routes for a controller
     */
    getControllerRoutes(controllerName: string): RouteInfo[] {
        const routes: RouteInfo[] = [];

        for (const [key, route] of this.routes) {
            if (route.controller === controllerName) {
                routes.push(route);
            }
        }

        return routes;
    }

    /**
     * Convert file path to location
     */
    private async fileToLocation(filePath: string): Promise<vscode.Location | undefined> {
        try {
            const uri = vscode.Uri.file(filePath);
            await vscode.workspace.fs.stat(uri);
            return new vscode.Location(uri, new vscode.Position(0, 0));
        } catch {
            return undefined;
        }
    }

    /**
     * Convert CamelCase to snake_case
     */
    private camelToSnake(str: string): string {
        return str
            .replace(/([A-Z])/g, '_$1')
            .toLowerCase()
            .replace(/^_/, '');
    }

    /**
     * Convert snake_case to CamelCase
     */
    private snakeToCamel(str: string): string {
        return str
            .split('_')
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join('');
    }

    /**
     * Simple pluralization
     */
    private pluralize(word: string): string {
        if (word.endsWith('y')) {
            return word.slice(0, -1) + 'ies';
        } else if (word.endsWith('s') || word.endsWith('x') || word.endsWith('ch')) {
            return word + 'es';
        } else {
            return word + 's';
        }
    }

    /**
     * Get HTTP method for REST action
     */
    private getHttpMethod(action: string): string {
        const methods: { [key: string]: string } = {
            'index': 'GET',
            'show': 'GET',
            'new': 'GET',
            'create': 'POST',
            'edit': 'GET',
            'update': 'PATCH',
            'destroy': 'DELETE'
        };
        return methods[action] || 'GET';
    }
}

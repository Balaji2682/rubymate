import * as vscode from 'vscode';
import * as path from 'path';
import { CoreRubyIndex } from '../indexing/coreRubyIndex';
import { ClassNode, NodeType } from '../indexing/rubyParser';
import { ParserService } from '../parsing';
import { Result, ok, err, tryAsync } from '../shared/utilities/result';
import { LRUCache } from '../shared/dataStructures/lruCache';
import { escapeRegExp, getRubyLookupCandidates, getRubyReceiverAtPosition, getRubyTokenAtPosition } from '../shared/rubyToken';
import { definitionConfidenceRank } from '../shared/definitionConfidence';
import { camelize, singularize, underscore } from '../shared/inflections';

/**
 * Error types for definition resolution
 */
type DefinitionError =
    | { type: 'no_word_at_position' }
    | { type: 'file_not_found'; path: string }
    | { type: 'symbol_not_found'; name: string }
    | { type: 'no_workspace' };

/**
 * Comprehensive definition provider that handles:
 * 1. Class and module navigation
 * 2. Method navigation
 * 3. Require statement navigation
 * 4. Constant navigation
 *
 * Performance: Uses Result type for safer error handling
 * and LRUCache for path resolution caching
 */
export class RubyDefinitionProvider implements vscode.DefinitionProvider {
    // Performance: Cache resolved require paths (200 entries, 30s TTL)
    private pathCache: LRUCache<string, vscode.Uri | null>;

    constructor(
        private indexer: CoreRubyIndex,
        private readonly parserService?: ParserService
    ) {
        this.pathCache = new LRUCache<string, vscode.Uri | null>({ maxSize: 200, maxAge: 30000 });
    }

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        if (token.isCancellationRequested) {
            return undefined;
        }

        const line = document.lineAt(position.line);
        const lineText = line.text;

        // 1. Try require statement first (handles paths in quotes)
        const requireDef = await this.handleRequireStatement(document, position, lineText);
        if (requireDef) {
            return requireDef;
        }

        // Keep the active document in sync with the AST-backed symbol index.
        await this.indexer.indexDocument(document, true);

        const rubyToken = getRubyTokenAtPosition(document, position);
        if (!rubyToken || token.isCancellationRequested) {
            return undefined;
        }

        const receiver = getRubyReceiverAtPosition(document, position, rubyToken.range);
        const containingClass = await this.findClassContext(document, position);

        const candidates = getRubyLookupCandidates(rubyToken.text);
        for (const candidate of candidates) {
            const definitions = await this.indexer.findDefinitions(candidate, { document, position, receiver, containingClass });
            if (definitions.length === 1) {
                return definitions[0].location;
            }
            if (definitions.length > 1) {
                return definitions.map(definition => definition.location);
            }
        }

        return undefined;
    }

    /**
     * Handle require/require_relative/autoload statements
     */
    private async handleRequireStatement(
        document: vscode.TextDocument,
        position: vscode.Position,
        lineText: string
    ): Promise<vscode.Location | undefined> {
        // require "test_helper"
        const requireMatch = lineText.match(/require\s+["']([^"']+)["']/);
        if (requireMatch) {
            const requiredPath = requireMatch[1];
            const requireStart = lineText.indexOf(requiredPath);
            const requireEnd = requireStart + requiredPath.length;

            if (position.character >= requireStart && position.character <= requireEnd) {
                return await this.resolveRequirePath(requiredPath, document.uri);
            }
        }

        // require_relative "../models/user"
        const requireRelativeMatch = lineText.match(/require_relative\s+["']([^"']+)["']/);
        if (requireRelativeMatch) {
            const relativePath = requireRelativeMatch[1];
            const requireStart = lineText.indexOf(relativePath);
            const requireEnd = requireStart + relativePath.length;

            if (position.character >= requireStart && position.character <= requireEnd) {
                const currentDir = path.dirname(document.uri.fsPath);
                let targetPath = path.join(currentDir, relativePath);
                if (!targetPath.endsWith('.rb')) {
                    targetPath += '.rb';
                }

                try {
                    await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
                    return new vscode.Location(vscode.Uri.file(targetPath), new vscode.Position(0, 0));
                } catch {
                    return undefined;
                }
            }
        }

        // autoload :MyClass, 'lib/my_class'
        const autoloadMatch = lineText.match(/autoload\s+:\w+,\s+["']([^"']+)["']/);
        if (autoloadMatch) {
            const filePath = autoloadMatch[1];
            const pathStart = lineText.indexOf(filePath);
            const pathEnd = pathStart + filePath.length;

            if (position.character >= pathStart && position.character <= pathEnd) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                if (workspaceFolder) {
                    let targetPath = path.join(workspaceFolder.uri.fsPath, filePath);
                    if (!targetPath.endsWith('.rb')) {
                        targetPath += '.rb';
                    }

                    try {
                        await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
                        return new vscode.Location(vscode.Uri.file(targetPath), new vscode.Position(0, 0));
                    } catch {
                        return undefined;
                    }
                }
            }
        }

        return undefined;
    }

    /**
     * Find class or module definition
     * Shows popup if multiple results found (like IDE)
     */
    private async findClassDefinition(word: string): Promise<vscode.Location | vscode.Location[] | undefined> {
        if (word.includes('::')) {
            const exactQualifiedClass = this.indexer.findSymbolByFullyQualifiedName(word, vscode.SymbolKind.Class)
                ?? this.indexer.findSymbolByFullyQualifiedName(word, vscode.SymbolKind.Module);
            if (exactQualifiedClass) {
                return exactQualifiedClass.location;
            }
        }

        // Search for exact class match
        const symbols = this.indexer.findClasses(word);
        const exactMatches = symbols.filter(s => s.name === word);

        // Also search in modules
        const moduleSymbols = this.indexer.findSymbols(word, vscode.SymbolKind.Module);
        const exactModules = moduleSymbols.filter(s => s.name === word);

        // Combine all exact matches
        const allMatches = [...exactMatches, ...exactModules];

        if (allMatches.length === 0) {
            // No exact matches, try fuzzy
            if (symbols.length > 0) {
                return this.sortSymbolsForDefinition(symbols, word)[0].location;
            }
            if (moduleSymbols.length > 0) {
                return this.sortSymbolsForDefinition(moduleSymbols, word)[0].location;
            }
            return undefined;
        }

        const sortedMatches = this.sortSymbolsForDefinition(allMatches, word);
        if (allMatches.length === 1) {
            // Single match - navigate directly
            return sortedMatches[0].location;
        }

        // Multiple matches - return all (VS Code will show QuickPick automatically)
        return sortedMatches.map(s => s.location);
    }

    /**
     * Find method definition
     * Shows popup if multiple results found (like IDE)
     */
    private async findMethodDefinition(
        methodName: string,
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Location | vscode.Location[] | undefined> {
        // Get context - try to find the class this method belongs to
        const className = await this.findClassContext(document, position);

        // Search for method in the class
        if (className) {
            const methods = this.indexer.findMethodsInClass(className);
            const method = methods.find(m => m.name === methodName);
            if (method) {
                return method.location;
            }
        }

        // Fallback: search for method globally
        const symbols = [
            ...this.indexer.findSymbols(methodName, vscode.SymbolKind.Method),
            ...this.indexer.findSymbols(methodName, vscode.SymbolKind.Function),
            ...this.indexer.findSymbols(methodName, vscode.SymbolKind.Property)
        ];
        const exactMatches = symbols.filter(s => s.name === methodName);

        if (exactMatches.length === 0) {
            // No exact matches, try first fuzzy
            return symbols.length > 0 ? this.sortSymbolsForDefinition(symbols, methodName)[0].location : undefined;
        }

        const sortedMatches = this.sortSymbolsForDefinition(exactMatches, methodName);
        if (exactMatches.length === 1) {
            // Single match - navigate directly
            return sortedMatches[0].location;
        }

        // Multiple matches - return all (VS Code will show QuickPick automatically)
        return sortedMatches.map(s => s.location);
    }

    /**
     * Find constant definition
     */
    private async findConstantDefinition(word: string): Promise<vscode.Location | undefined> {
        const symbols = this.indexer.findSymbols(word, vscode.SymbolKind.Constant);

        if (symbols.length > 0) {
            const exactMatch = symbols.find(s => s.name === word);
            if (exactMatch) {
                return exactMatch.location;
            }
            return this.sortSymbolsForDefinition(symbols, word)[0].location;
        }

        return undefined;
    }

    private async findRailsConventionDefinition(
        word: string,
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Location | undefined> {
        const lineText = document.lineAt(position.line).text;
        const escapedWord = escapeRegExp(word);

        const associationMatch = lineText.match(new RegExp(`\\b(has_many|has_one|belongs_to|has_and_belongs_to_many)\\s+:${escapedWord}\\b`));
        if (associationMatch) {
            const targetModelName = camelize(
                associationMatch[1] === 'has_many' || associationMatch[1] === 'has_and_belongs_to_many'
                    ? singularize(word)
                    : word
            );
            const target = await this.findClassDefinition(targetModelName);
            if (Array.isArray(target)) {
                return target[0];
            }
            if (target) {
                return target;
            }

            return this.findRailsFile(document.uri, ['app', 'models', `${underscore(targetModelName)}.rb`]);
        }

        const renderMatch = lineText.match(new RegExp(`\\brender\\s+(?::${escapedWord}|["']${escapedWord}["'])`));
        if (renderMatch) {
            return this.findViewForControllerAction(document.uri, word);
        }

        const methodDefinitionMatch = lineText.match(new RegExp(`^\\s*def\\s+${escapedWord}\\b`));
        if (methodDefinitionMatch && this.isRailsControllerFile(document.uri)) {
            return this.findViewForControllerAction(document.uri, word);
        }

        if (/^[A-Z]/.test(word)) {
            const concern = await this.findRailsFile(document.uri, ['app', 'models', 'concerns', `${underscore(word)}.rb`])
                ?? await this.findRailsFile(document.uri, ['app', 'controllers', 'concerns', `${underscore(word)}.rb`]);
            if (concern) {
                return concern;
            }
        }

        const railsClassFile = this.railsClassFilePath(word);
        if (railsClassFile) {
            return this.findRailsFile(document.uri, railsClassFile);
        }

        return undefined;
    }

    /**
     * Find the class context from the current position
     */
    private async findClassContext(document: vscode.TextDocument, position: vscode.Position): Promise<string | undefined> {
        if (this.parserService) {
            const parsed = await this.parserService.parseRuby(document);
            const stack = [...parsed.value];
            let best: ClassNode | undefined;

            while (stack.length > 0) {
                const node = stack.shift()!;
                if (node.type === NodeType.Class || node.type === NodeType.Module) {
                    if (node.range.contains(position) && (!best || node.range.start.isAfter(best.range.start))) {
                        best = node as ClassNode;
                    }
                }
                stack.push(...node.children);
            }

            if (best) {
                return best.name;
            }
        }

        // Search upwards for class definition
        for (let i = position.line; i >= 0; i--) {
            const line = document.lineAt(i).text;
            const classMatch = line.match(/^\s*class\s+(\w+)/);
            if (classMatch) {
                return classMatch[1];
            }

            const moduleMatch = line.match(/^\s*module\s+(\w+)/);
            if (moduleMatch) {
                return moduleMatch[1];
            }
        }

        return undefined;
    }

    private sortSymbolsForDefinition<T extends { name: string; definitionConfidence?: string; location: vscode.Location }>(
        symbols: T[],
        query: string
    ): T[] {
        return [...symbols].sort((a, b) => {
            const confidenceDelta = definitionConfidenceRank(a.definitionConfidence) - definitionConfidenceRank(b.definitionConfidence);
            if (confidenceDelta !== 0) {
                return confidenceDelta;
            }

            const aExact = a.name === query ? 0 : 1;
            const bExact = b.name === query ? 0 : 1;
            if (aExact !== bExact) {
                return aExact - bExact;
            }

            return a.location.uri.toString().localeCompare(b.location.uri.toString());
        });
    }

    private async findRailsFile(currentFileUri: vscode.Uri, relativePath: string[]): Promise<vscode.Location | undefined> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(currentFileUri) ?? vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return undefined;
        }

        const targetUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, ...relativePath));
        try {
            await vscode.workspace.fs.stat(targetUri);
            return new vscode.Location(targetUri, new vscode.Position(0, 0));
        } catch {
            return undefined;
        }
    }

    private async findViewForControllerAction(
        controllerUri: vscode.Uri,
        actionName: string
    ): Promise<vscode.Location | undefined> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(controllerUri) ?? vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return undefined;
        }

        const relativeController = this.relativeControllerPath(workspaceFolder, controllerUri);
        if (!relativeController) {
            return undefined;
        }

        const viewFolder = relativeController
            .replace(/\\/g, '/')
            .replace(/_controller\.rb$/, '')
            .replace(/\.rb$/, '');
        const viewPattern = new vscode.RelativePattern(
            workspaceFolder,
            `app/views/${viewFolder}/${actionName}.{html.erb,html.haml,html.slim,erb,haml,slim}`
        );
        const matches = await vscode.workspace.findFiles(viewPattern, '**/node_modules/**', 1);
        if (matches.length === 0) {
            return undefined;
        }

        return new vscode.Location(matches[0], new vscode.Position(0, 0));
    }

    private railsClassFilePath(className: string): string[] | undefined {
        const fileName = `${underscore(className)}.rb`;
        if (className.endsWith('Controller')) {
            return ['app', 'controllers', fileName];
        }
        if (className.endsWith('Helper')) {
            return ['app', 'helpers', fileName];
        }
        if (className.endsWith('Job')) {
            return ['app', 'jobs', fileName];
        }
        if (className.endsWith('Mailer')) {
            return ['app', 'mailers', fileName];
        }

        return undefined;
    }

    private isRailsControllerFile(uri: vscode.Uri): boolean {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
        return workspaceFolder ? this.relativeControllerPath(workspaceFolder, uri) !== undefined : false;
    }

    private relativeControllerPath(
        workspaceFolder: vscode.WorkspaceFolder,
        uri: vscode.Uri
    ): string | undefined {
        const relativeController = path.relative(
            path.join(workspaceFolder.uri.fsPath, 'app', 'controllers'),
            uri.fsPath
        );

        if (!relativeController || relativeController.startsWith('..') || path.isAbsolute(relativeController)) {
            return undefined;
        }

        return relativeController;
    }

    /**
     * Resolve require path using Result type for safer error handling
     * Performance: Uses LRUCache to avoid repeated file system lookups
     */
    private async resolveRequirePath(
        requiredPath: string,
        currentFileUri: vscode.Uri
    ): Promise<vscode.Location | undefined> {
        const result = await this.resolveRequirePathResult(requiredPath, currentFileUri);
        return result.isOk() ? new vscode.Location(result.value, new vscode.Position(0, 0)) : undefined;
    }

    /**
     * Internal method that returns Result type for explicit error handling
     */
    private async resolveRequirePathResult(
        requiredPath: string,
        currentFileUri: vscode.Uri
    ): Promise<Result<vscode.Uri, DefinitionError>> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(currentFileUri);
        if (!workspaceFolder) {
            return err({ type: 'no_workspace' });
        }

        // Performance: Check cache first
        const cacheKey = `${workspaceFolder.uri.toString()}:${requiredPath}`;
        const cached = this.pathCache.get(cacheKey);
        if (cached !== undefined) {
            return cached ? ok(cached) : err({ type: 'file_not_found', path: requiredPath });
        }

        const workspaceRoot = workspaceFolder.uri.fsPath;
        const currentFilePath = currentFileUri.fsPath;
        const pathsToTry: string[] = [];

        // Rails-specific patterns
        if (requiredPath === 'test_helper') {
            pathsToTry.push(path.join(workspaceRoot, 'test', 'test_helper.rb'));
        }

        if (requiredPath === 'spec_helper' || requiredPath === 'rails_helper') {
            pathsToTry.push(path.join(workspaceRoot, 'spec', `${requiredPath}.rb`));
        }

        if (requiredPath === 'application_helper') {
            pathsToTry.push(path.join(workspaceRoot, 'app', 'helpers', 'application_helper.rb'));
        }

        // App directories
        const appDirs = ['models', 'controllers', 'helpers', 'services', 'jobs', 'mailers', 'channels'];
        for (const dir of appDirs) {
            pathsToTry.push(path.join(workspaceRoot, 'app', dir, `${requiredPath}.rb`));
        }

        // Relative to current file
        const currentDir = path.dirname(currentFilePath);
        pathsToTry.push(path.join(currentDir, `${requiredPath}.rb`));
        pathsToTry.push(path.join(currentDir, requiredPath));

        // Workspace root
        pathsToTry.push(path.join(workspaceRoot, `${requiredPath}.rb`));
        pathsToTry.push(path.join(workspaceRoot, requiredPath));

        // Lib directory
        pathsToTry.push(path.join(workspaceRoot, 'lib', `${requiredPath}.rb`));

        // Test/spec support
        pathsToTry.push(path.join(workspaceRoot, 'test', 'support', `${requiredPath}.rb`));
        pathsToTry.push(path.join(workspaceRoot, 'spec', 'support', `${requiredPath}.rb`));

        // Handle paths with slashes
        if (requiredPath.includes('/')) {
            pathsToTry.push(path.join(workspaceRoot, 'test', `${requiredPath}.rb`));
            pathsToTry.push(path.join(workspaceRoot, 'spec', `${requiredPath}.rb`));
            pathsToTry.push(path.join(workspaceRoot, 'app', `${requiredPath}.rb`));
        }

        // Try each path using Result type
        for (const tryPath of pathsToTry) {
            const fileCheckResult = await tryAsync(async () => {
                await vscode.workspace.fs.stat(vscode.Uri.file(tryPath));
                return vscode.Uri.file(tryPath);
            });

            if (fileCheckResult.isOk()) {
                // Performance: Cache successful resolution
                this.pathCache.set(cacheKey, fileCheckResult.value);
                return ok(fileCheckResult.value);
            }
        }

        // Fallback: glob search
        const fileName = path.basename(requiredPath);
        const pattern = `**/${fileName}.rb`;

        const searchResult = await tryAsync(async () => {
            const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 1);
            if (files.length > 0) {
                return files[0];
            }
            throw new Error('No files found');
        });

        if (searchResult.isOk()) {
            // Performance: Cache successful resolution
            this.pathCache.set(cacheKey, searchResult.value);
            return ok(searchResult.value);
        }

        // Performance: Cache negative result to avoid repeated lookups
        this.pathCache.set(cacheKey, null);
        return err({ type: 'file_not_found', path: requiredPath });
    }
}

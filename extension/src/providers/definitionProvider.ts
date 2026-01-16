import * as vscode from 'vscode';
import * as path from 'path';
import { LRUCache } from '../shared/dataStructures/lruCache';

/**
 * Performance: Shared cache for require path resolution
 * This reduces filesystem lookups for frequently accessed paths (500 entries, 30s TTL)
 */
const requirePathCache = new LRUCache<string, vscode.Uri | null>({ maxSize: 500, maxAge: 30000 });

export class RubyDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        const line = document.lineAt(position.line);
        const lineText = line.text;

        // Check if this is a require statement
        const requireMatch = lineText.match(/require\s+["']([^"']+)["']/);
        if (!requireMatch) {
            return undefined;
        }

        const requiredPath = requireMatch[1];
        const cursorOffset = position.character;
        const requireStart = lineText.indexOf(requiredPath);
        const requireEnd = requireStart + requiredPath.length;

        // Check if cursor is on the required path
        if (cursorOffset < requireStart || cursorOffset > requireEnd) {
            return undefined;
        }

        // Try to resolve the require path
        const targetPath = await this.resolveRequirePath(requiredPath, document.uri);

        if (targetPath) {
            return new vscode.Location(
                targetPath,
                new vscode.Position(0, 0)
            );
        }

        return undefined;
    }

    private async resolveRequirePath(
        requiredPath: string,
        currentFileUri: vscode.Uri
    ): Promise<vscode.Uri | undefined> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(currentFileUri);
        if (!workspaceFolder) {
            return undefined;
        }

        // Performance: Check cache first
        const cacheKey = `${workspaceFolder.uri.toString()}:${requiredPath}`;
        const cached = requirePathCache.get(cacheKey);
        if (cached !== undefined) {
            return cached || undefined;
        }

        const workspaceRoot = workspaceFolder.uri.fsPath;
        const currentFilePath = currentFileUri.fsPath;

        // List of paths to try, in order of priority
        const pathsToTry: string[] = [];

        // 1. Rails-specific patterns
        if (this.isRailsProject(workspaceRoot)) {
            // Test helper in test directory
            if (requiredPath === 'test_helper') {
                pathsToTry.push(path.join(workspaceRoot, 'test', 'test_helper.rb'));
            }

            // Spec helper in spec directory
            if (requiredPath === 'spec_helper' || requiredPath === 'rails_helper') {
                pathsToTry.push(path.join(workspaceRoot, 'spec', `${requiredPath}.rb`));
            }

            // Application helper
            if (requiredPath === 'application_helper') {
                pathsToTry.push(path.join(workspaceRoot, 'app', 'helpers', 'application_helper.rb'));
            }

            // Models, controllers, helpers
            const railsPaths = [
                ['models', 'app/models'],
                ['controllers', 'app/controllers'],
                ['helpers', 'app/helpers'],
                ['services', 'app/services'],
                ['jobs', 'app/jobs'],
                ['mailers', 'app/mailers'],
                ['channels', 'app/channels']
            ];

            for (const [, dirPath] of railsPaths) {
                pathsToTry.push(path.join(workspaceRoot, dirPath, `${requiredPath}.rb`));
            }
        }

        // 2. Relative path from current file
        const currentDir = path.dirname(currentFilePath);
        pathsToTry.push(path.join(currentDir, `${requiredPath}.rb`));
        pathsToTry.push(path.join(currentDir, requiredPath)); // Already has .rb

        // 3. Relative to workspace root
        pathsToTry.push(path.join(workspaceRoot, `${requiredPath}.rb`));
        pathsToTry.push(path.join(workspaceRoot, requiredPath));

        // 4. In lib directory
        pathsToTry.push(path.join(workspaceRoot, 'lib', `${requiredPath}.rb`));
        pathsToTry.push(path.join(workspaceRoot, 'lib', requiredPath));

        // 5. In test/support directory
        pathsToTry.push(path.join(workspaceRoot, 'test', 'support', `${requiredPath}.rb`));
        pathsToTry.push(path.join(workspaceRoot, 'spec', 'support', `${requiredPath}.rb`));

        // 6. Handle paths with slashes (e.g., "support/some_helper")
        if (requiredPath.includes('/')) {
            pathsToTry.push(path.join(workspaceRoot, 'test', `${requiredPath}.rb`));
            pathsToTry.push(path.join(workspaceRoot, 'spec', `${requiredPath}.rb`));
            pathsToTry.push(path.join(workspaceRoot, 'app', `${requiredPath}.rb`));
        }

        // Try each path
        for (const tryPath of pathsToTry) {
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(tryPath));
                const resolvedUri = vscode.Uri.file(tryPath);
                // Performance: Cache successful resolution
                requirePathCache.set(cacheKey, resolvedUri);
                return resolvedUri;
            } catch {
                // File doesn't exist, try next
            }
        }

        // If still not found, try glob search as last resort
        const fileName = path.basename(requiredPath);
        const pattern = `**/${fileName}.rb`;

        try {
            const files = await vscode.workspace.findFiles(
                pattern,
                '**/node_modules/**',
                1
            );

            if (files.length > 0) {
                // Performance: Cache successful resolution
                requirePathCache.set(cacheKey, files[0]);
                return files[0];
            }
        } catch {
            // Search failed
        }

        // Performance: Cache negative result to avoid repeated lookups
        requirePathCache.set(cacheKey, null);
        return undefined;
    }

    private isRailsProject(workspaceRoot: string): boolean {
        // Check for Rails indicators
        try {
            const indicators = [
                path.join(workspaceRoot, 'config', 'application.rb'),
                path.join(workspaceRoot, 'Gemfile')
            ];

            // We can't use sync fs operations, so we'll assume it's a Rails project
            // if the workspace contains typical Rails directories
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * Extended definition provider that handles require_relative as well
 */
export class RubyRequireRelativeProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        const line = document.lineAt(position.line);
        const lineText = line.text;

        // Check if this is a require_relative statement
        const requireMatch = lineText.match(/require_relative\s+["']([^"']+)["']/);
        if (!requireMatch) {
            return undefined;
        }

        const relativePath = requireMatch[1];
        const cursorOffset = position.character;
        const requireStart = lineText.indexOf(relativePath);
        const requireEnd = requireStart + relativePath.length;

        // Check if cursor is on the required path
        if (cursorOffset < requireStart || cursorOffset > requireEnd) {
            return undefined;
        }

        // Resolve relative path from current file
        const currentDir = path.dirname(document.uri.fsPath);
        let targetPath = path.join(currentDir, relativePath);

        // Add .rb extension if not present
        if (!targetPath.endsWith('.rb')) {
            targetPath += '.rb';
        }

        // Check if file exists
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
            return new vscode.Location(
                vscode.Uri.file(targetPath),
                new vscode.Position(0, 0)
            );
        } catch {
            return undefined;
        }
    }
}

/**
 * Provider for autoload statements
 */
export class RubyAutoloadProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        const line = document.lineAt(position.line);
        const lineText = line.text;

        // Check if this is an autoload statement
        // autoload :SomeClass, 'path/to/file'
        const autoloadMatch = lineText.match(/autoload\s+:(\w+),\s+["']([^"']+)["']/);
        if (!autoloadMatch) {
            return undefined;
        }

        const filePath = autoloadMatch[2];
        const cursorOffset = position.character;
        const pathStart = lineText.indexOf(filePath);
        const pathEnd = pathStart + filePath.length;

        // Check if cursor is on the file path
        if (cursorOffset < pathStart || cursorOffset > pathEnd) {
            return undefined;
        }

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
            return undefined;
        }

        // Try to resolve path
        let targetPath = path.join(workspaceFolder.uri.fsPath, filePath);
        if (!targetPath.endsWith('.rb')) {
            targetPath += '.rb';
        }

        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
            return new vscode.Location(
                vscode.Uri.file(targetPath),
                new vscode.Position(0, 0)
            );
        } catch {
            return undefined;
        }
    }
}

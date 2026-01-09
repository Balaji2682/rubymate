import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Template Definition Provider
 * Provides "Go to Definition" for partials in Rails templates
 *
 * Examples:
 * - render 'users/form' → app/views/users/_form.html.erb
 * - render partial: 'shared/header' → app/views/shared/_header.html.erb
 * - <%= render @user %> → app/views/users/_user.html.erb
 */
export class TemplateDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        const line = document.lineAt(position.line);
        const lineText = line.text;

        // Check if we're on a render statement
        const partialPath = this.extractPartialPath(lineText, position.character);
        if (!partialPath) {
            return undefined;
        }

        // Find the partial file
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return undefined;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const partialLocations = await this.findPartialFile(workspaceRoot, partialPath, document.uri.fsPath);

        if (partialLocations.length > 0) {
            return partialLocations;
        }

        return undefined;
    }

    /**
     * Extract partial path from render statement
     */
    private extractPartialPath(lineText: string, characterPos: number): string | null {
        // Pattern 1: render 'partial_name'
        const simpleRenderMatch = lineText.match(/render\s+['"]([^'"]+)['"]/);
        if (simpleRenderMatch) {
            const partialName = simpleRenderMatch[1];
            const matchStart = lineText.indexOf(partialName);
            const matchEnd = matchStart + partialName.length;
            if (characterPos >= matchStart && characterPos <= matchEnd) {
                return partialName;
            }
        }

        // Pattern 2: render partial: 'partial_name'
        const partialKeywordMatch = lineText.match(/render\s+partial:\s*['"]([^'"]+)['"]/);
        if (partialKeywordMatch) {
            const partialName = partialKeywordMatch[1];
            const matchStart = lineText.indexOf(partialName, lineText.indexOf('partial:'));
            const matchEnd = matchStart + partialName.length;
            if (characterPos >= matchStart && characterPos <= matchEnd) {
                return partialName;
            }
        }

        // Pattern 3: render template: 'template_name'
        const templateMatch = lineText.match(/render\s+template:\s*['"]([^'"]+)['"]/);
        if (templateMatch) {
            const templateName = templateMatch[1];
            const matchStart = lineText.indexOf(templateName, lineText.indexOf('template:'));
            const matchEnd = matchStart + templateName.length;
            if (characterPos >= matchStart && characterPos <= matchEnd) {
                return templateName;
            }
        }

        // Pattern 4: render layout: 'layout_name'
        const layoutMatch = lineText.match(/render\s+layout:\s*['"]([^'"]+)['"]/);
        if (layoutMatch) {
            const layoutName = layoutMatch[1];
            const matchStart = lineText.indexOf(layoutName, lineText.indexOf('layout:'));
            const matchEnd = matchStart + layoutName.length;
            if (characterPos >= matchStart && characterPos <= matchEnd) {
                return layoutName;
            }
        }

        return null;
    }

    /**
     * Find partial file in workspace
     */
    private async findPartialFile(
        workspaceRoot: string,
        partialPath: string,
        currentFilePath: string
    ): Promise<vscode.Location[]> {
        const locations: vscode.Location[] = [];

        // Determine if this is a full path or relative to current directory
        const isFullPath = partialPath.includes('/');

        // Get extensions to try
        const extensions = ['.html.erb', '.html.haml', '.html.slim', '.erb', '.haml', '.slim'];

        if (isFullPath) {
            // Full path: 'users/form' or 'shared/header'
            const parts = partialPath.split('/');
            const fileName = parts.pop();
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
            // Try to find in the same directory as current file
            const currentDir = path.dirname(currentFilePath);

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

            // If not found in current directory, try app/views/shared
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
        }

        // If still not found, try fuzzy search across all views
        if (locations.length === 0) {
            const fuzzyLocations = await this.fuzzyFindPartial(workspaceRoot, partialPath);
            locations.push(...fuzzyLocations);
        }

        return locations;
    }

    /**
     * Fuzzy search for partial across all views
     */
    private async fuzzyFindPartial(workspaceRoot: string, partialPath: string): Promise<vscode.Location[]> {
        const locations: vscode.Location[] = [];
        const viewsDir = path.join(workspaceRoot, 'app', 'views');

        try {
            // Use glob pattern to find all partials matching the name
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
}

/**
 * Template Hover Provider
 * Provides hover information for Rails helpers and partials
 */
export class TemplateHoverProvider implements vscode.HoverProvider {
    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const line = document.lineAt(position.line);
        const lineText = line.text;

        // Check for render statements
        const renderMatch = lineText.match(/render\s+(?:partial:\s*)?['"]([^'"]+)['"]/);
        if (renderMatch) {
            const partialName = renderMatch[1];
            const matchStart = lineText.indexOf(partialName);
            const matchEnd = matchStart + partialName.length;

            if (position.character >= matchStart && position.character <= matchEnd) {
                const markdown = new vscode.MarkdownString();
                markdown.appendMarkdown(`**Rails Partial**\n\n`);
                markdown.appendCodeblock(`render '${partialName}'`, 'ruby');
                markdown.appendMarkdown(`\nLooking for: \`_${partialName}.html.erb\``);
                return new vscode.Hover(markdown);
            }
        }

        return undefined;
    }
}

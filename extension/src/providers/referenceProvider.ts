import * as vscode from 'vscode';
import { CoreRubyIndex } from '../indexing/coreRubyIndex';
import { ParserService } from '../parsing';
import { escapeRegExp, getRubyTokenAtPosition, rubyReferencePattern } from '../shared/rubyToken';

/**
 * Provides "Find All References" functionality like IDE Alt+F7
 * Shows all places where a class, method, constant, or variable is used
 */
export class RubyReferenceProvider implements vscode.ReferenceProvider {
    constructor(
        private indexer: CoreRubyIndex,
        private readonly parserService?: ParserService
    ) {}

    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken
    ): Promise<vscode.Location[]> {
        if (token.isCancellationRequested) {
            return [];
        }

        await this.indexer.indexDocument(document, true);

        const rubyToken = getRubyTokenAtPosition(document, position);
        if (!rubyToken) {
            return [];
        }

        const word = rubyToken.text;

        // Show progress for better UX
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Finding references to '${word}'...`,
                cancellable: true
            },
            async (progress, progressToken) => {
                const references: vscode.Location[] = [];

                // Perform RubyMate's comprehensive search
                let timedOut = false;

                // Add timeout: 2 minutes max for reference search
                const timeoutPromise = new Promise<vscode.Location[]>((resolve) => {
                    setTimeout(() => {
                        timedOut = true;
                        resolve(references); // Return partial results
                    }, 120000); // 2 minutes
                });

                // Race between actual search and timeout
                return Promise.race([
                    timeoutPromise,
                    (async () => {
                        try {
                            // If context.includeDeclaration is true, include the definition
                            if (context.includeDeclaration) {
                                const definition = await this.findDefinition(word, document, position);
                                if (definition) {
                                    references.push(definition);
                                }
                            }

                            const searchedUris = new Set<string>();
                            const openDocs = vscode.workspace.textDocuments.filter(doc => doc.languageId === 'ruby');
                            for (const openDocument of openDocs) {
                                if (timedOut || token.isCancellationRequested || progressToken.isCancellationRequested) {
                                    break;
                                }

                                await this.indexer.indexDocument(openDocument, true);
                                const locations = await this.findWordOccurrences(openDocument, word, context);
                                references.push(...locations);
                                searchedUris.add(openDocument.uri.toString());
                            }

                            // Search through all workspace files.
                            const workspaceFolders = vscode.workspace.workspaceFolders;
                            if (!workspaceFolders) {
                                return this.dedupeLocations(references);
                            }

                            for (const folder of workspaceFolders) {
                                if (timedOut || token.isCancellationRequested || progressToken.isCancellationRequested) {
                                    break;
                                }

                                const files = await vscode.workspace.findFiles(
                                    new vscode.RelativePattern(folder, '**/*.rb'),
                                    '**/node_modules/**'
                                );

                                progress.report({
                                    message: `Searching ${files.length} files...`,
                                    increment: 0
                                });

                                const increment = files.length > 0 ? 100 / files.length : 100;
                                let processed = 0;

                                for (const fileUri of files) {
                                    if (timedOut || token.isCancellationRequested || progressToken.isCancellationRequested) {
                                        break;
                                    }

                                    try {
                                        if (searchedUris.has(fileUri.toString())) {
                                            processed++;
                                            continue;
                                        }

                                        const fileDocument = await vscode.workspace.openTextDocument(fileUri);
                                        await this.indexer.indexDocument(fileDocument, false);
                                        const locations = await this.findWordOccurrences(fileDocument, word, context);
                                        references.push(...locations);

                                        processed++;
                                        if (processed % 10 === 0) {
                                            progress.report({
                                                increment: increment * 10,
                                                message: `Found ${references.length} references in ${processed}/${files.length} files`
                                            });
                                        }
                                    } catch (error) {
                                        // Skip files that can't be read
                                        continue;
                                    }
                                }

                                if (timedOut) {
                                    vscode.window.showWarningMessage(
                                        `Reference search timed out after 2 minutes. Showing ${references.length} partial results.`
                                    );
                                } else {
                                    progress.report({
                                        increment: 100,
                                        message: `Found ${references.length} references`
                                    });
                                }
                            }

                            return this.dedupeLocations(references);
                        } catch (error) {
                            // Log error but return partial results
                            console.error(`Error during reference search: ${error}`);
                            return this.dedupeLocations(references);
                        }
                    })()
                ]);
            }
        );
    }

    /**
     * Find the definition of the symbol (to include in references if requested)
     */
    private async findDefinition(
        word: string,
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Location | undefined> {
        // Check if current line is the definition
        const line = document.lineAt(position.line).text;

        // Method definition
        if (line.match(new RegExp(`def\\s+(self\\.)?${this.escapeRegex(word)}\\b`))) {
            return new vscode.Location(document.uri, position);
        }

        // Class definition
        if (line.match(new RegExp(`class\\s+${this.escapeRegex(word)}\\b`))) {
            return new vscode.Location(document.uri, position);
        }

        // Module definition
        if (line.match(new RegExp(`module\\s+${this.escapeRegex(word)}\\b`))) {
            return new vscode.Location(document.uri, position);
        }

        // Constant definition
        if (line.match(new RegExp(`${this.escapeRegex(word)}\\s*=`))) {
            return new vscode.Location(document.uri, position);
        }

        // Try to find from index
        const symbols = this.indexer.findSymbols(word);
        if (symbols.length > 0) {
            const exactMatch = symbols.find(s => s.name === word);
            return exactMatch ? exactMatch.location : symbols[0].location;
        }

        return undefined;
    }

    private async findWordOccurrences(
        document: vscode.TextDocument,
        word: string,
        context: vscode.ReferenceContext
    ): Promise<vscode.Location[]> {
        const indexedReferences = await this.indexer.findReferenceResults(document, word, context.includeDeclaration);
        if (indexedReferences.length > 0) {
            return indexedReferences.map(reference => reference.location);
        }

        const locations: vscode.Location[] = [];
        const text = document.getText();
        const escapedWord = escapeRegExp(word);

        // Create regex patterns for different Ruby constructs
        const patterns = [
            // 1. Class/Module/Constant references (capitalized)
            rubyReferencePattern(word),

            // 2. Method calls with dot notation: obj.method_name
            new RegExp(`\\.${escapedWord}(?![A-Za-z0-9_?!=$])`, 'g'),

            // 3. Method calls with double colon: Module::method
            new RegExp(`::${escapedWord}(?![A-Za-z0-9_?!=$])`, 'g'),

            // 4. Instance variables: @variable
            new RegExp(`@${escapedWord}(?![A-Za-z0-9_?!=$])`, 'g'),

            // 5. Class variables: @@variable
            new RegExp(`@@${escapedWord}(?![A-Za-z0-9_?!=$])`, 'g'),

            // 6. Symbols: :symbol
            new RegExp(`:${escapedWord}(?![A-Za-z0-9_?!=$])`, 'g'),

            // 7. Dynamic sends: send(:method_name) or __send__(:method_name)
            new RegExp(`(?:send|__send__|public_send)\\s*\\(\\s*:${escapedWord}(?![A-Za-z0-9_?!=$])`, 'g'),

            // 8. String sends: send("method_name")
            new RegExp(`(?:send|__send__|public_send)\\s*\\(\\s*["']${escapedWord}(?![A-Za-z0-9_?!=$])`, 'g'),

            // 9. Delegate/alias: delegate :method, alias :new_name, :method
            new RegExp(`(?:delegate|alias|alias_method)\\s*:?${escapedWord}(?![A-Za-z0-9_?!=$])`, 'g'),

            // 10. Block parameters: do |method_name|
            new RegExp(`\\|[^|]*\\b${escapedWord}\\b[^|]*\\|`, 'g'),

            // 11. Hash keys (symbol): { method_name: value }
            new RegExp(`${escapedWord}:`, 'g'),

            // 12. Respond_to?: respond_to?(:method_name)
            new RegExp(`respond_to\\?\\s*\\(\\s*:${escapedWord}(?![A-Za-z0-9_?!=$])`, 'g'),
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const position = document.positionAt(match.index);
                const line = document.lineAt(position.line);
                const lineText = line.text;

                // Skip comments (lines starting with # or inline comments)
                const commentIndex = lineText.indexOf('#');
                if (commentIndex !== -1 && position.character >= commentIndex) {
                    continue;
                }

                // Skip string literals (basic check - not perfect but helps)
                const beforeText = lineText.substring(0, position.character);
                const singleQuotes = (beforeText.match(/'/g) || []).length;
                const doubleQuotes = (beforeText.match(/"/g) || []).length;

                // If odd number of quotes before position, we're likely inside a string
                if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) {
                    // Unless it's a symbol or hash key, skip it
                    if (!match[0].startsWith(':') && !match[0].endsWith(':')) {
                        continue;
                    }
                }

                // Create location - highlight just the word, not the prefix
                let startOffset = match.index;
                let endOffset = match.index + match[0].length;

                // Adjust for prefixes like @, @@, :, .
                const matchText = match[0];
                if (matchText.startsWith('.') || matchText.startsWith(':') ||
                    matchText.startsWith('@') || matchText.startsWith('::')) {
                    startOffset += matchText.search(/\w/);
                }

                const range = new vscode.Range(
                    document.positionAt(startOffset),
                    document.positionAt(endOffset)
                );

                // Avoid duplicate locations
                if (!locations.some(loc =>
                    loc.uri.toString() === document.uri.toString() &&
                    loc.range.isEqual(range)
                )) {
                    locations.push(new vscode.Location(document.uri, range));
                }
            }
        }

        return locations;
    }

    private escapeRegex(str: string): string {
        return escapeRegExp(str);
    }

    private dedupeLocations(locations: vscode.Location[]): vscode.Location[] {
        const seen = new Set<string>();
        return locations.filter(location => {
            const key = [
                location.uri.toString(),
                location.range.start.line,
                location.range.start.character,
                location.range.end.line,
                location.range.end.character
            ].join(':');

            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
    }
}

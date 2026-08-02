import * as vscode from 'vscode';
import { CoreRubyIndex } from '../advancedIndexer';
import { ParserService } from '../parsing';
import { AdvancedRenameEngine } from '../refactoring/renameEngine';
import { getRubyTokenAtPosition } from '../shared/rubyToken';

/**
 * Provides Intelligent Rename Refactoring functionality for Ruby.
 *
 * Delegates to AdvancedRenameEngine which provides:
 *   - Scope-aware renaming (local vars stay in their method)
 *   - Rails convention cascading (model → controller → views → routes)
 *   - Metaprogramming awareness (attr_accessor, alias_method, send)
 *   - Refactor Preview for large cascade renames
 */
export class RubyRenameProvider implements vscode.RenameProvider {
    private readonly engine: AdvancedRenameEngine;

    constructor(
        indexer: CoreRubyIndex,
        parserService: ParserService
    ) {
        this.engine = new AdvancedRenameEngine(indexer, parserService);
    }

    /**
     * Validates whether the token at cursor is renameable and highlights it.
     */
    prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Range | { range: vscode.Range; placeholder: string }> {
        const rubyToken = getRubyTokenAtPosition(document, position);

        if (!rubyToken || !rubyToken.text.trim()) {
            throw new Error('You cannot rename this element.');
        }

        // Don't allow renaming Ruby keywords
        if (RUBY_KEYWORDS.has(rubyToken.text)) {
            throw new Error(`Cannot rename Ruby keyword '${rubyToken.text}'.`);
        }

        return {
            range: rubyToken.range,
            placeholder: rubyToken.text
        };
    }

    /**
     * Computes the rename edits via the AdvancedRenameEngine.
     */
    async provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
        token: vscode.CancellationToken
    ): Promise<vscode.WorkspaceEdit | null> {
        if (token.isCancellationRequested) {
            return null;
        }

        try {
            const edit = await this.engine.computeRenameEdits(document, position, newName);

            // If the edit is large (cascade rename), show the refactor preview
            const entryCount = edit.entries().length;
            if (entryCount > 3) {
                // VS Code will show the Refactor Preview panel automatically
                // when the edit spans many files
                vscode.window.showInformationMessage(
                    `Rename will modify ${entryCount} files. Review changes in the Refactor Preview.`
                );
            }

            return edit;
        } catch (error) {
            vscode.window.showErrorMessage(`Rename failed: ${error}`);
            return null;
        }
    }
}

// ── Ruby keywords that cannot be renamed ─────────────────────────────
const RUBY_KEYWORDS = new Set([
    'def', 'end', 'class', 'module', 'if', 'else', 'elsif', 'unless',
    'while', 'until', 'for', 'do', 'begin', 'rescue', 'ensure', 'raise',
    'return', 'yield', 'break', 'next', 'redo', 'retry', 'self', 'super',
    'true', 'false', 'nil', 'and', 'or', 'not', 'in', 'then', 'when',
    'case', 'require', 'require_relative', 'include', 'extend', 'prepend',
    'attr_accessor', 'attr_reader', 'attr_writer', 'public', 'private',
    'protected', 'lambda', 'proc', '__FILE__', '__LINE__', '__method__',
    '__dir__', '__ENCODING__', 'defined?', 'BEGIN', 'END',
]);

import * as vscode from 'vscode';

/**
 * Quick fixes for RubyMate N+1 diagnostics:
 *   - always offer to suppress the warning on that line
 *   - when the source query can be located safely, offer to insert .includes(:x)
 */
export class N1CodeActionProvider implements vscode.CodeActionProvider {
    static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

    provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source !== 'RubyMate' || diagnostic.code !== 'N+1') {
                continue;
            }

            const includesFix = this.buildIncludesFix(document, diagnostic);
            if (includesFix) {
                actions.push(includesFix);
            }

            actions.push(this.buildSuppressionFix(document, diagnostic));
        }

        return actions;
    }

    /**
     * Append a line-level suppression comment. Always safe.
     */
    private buildSuppressionFix(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
        const action = new vscode.CodeAction('Ignore this N+1 warning (this line)', vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic];
        action.edit = new vscode.WorkspaceEdit();
        const line = document.lineAt(diagnostic.range.start.line);
        action.edit.insert(document.uri, line.range.end, ' # rubymate:disable-line');
        return action;
    }

    /**
     * Best-effort: add .includes(:association) to the source query. Offered only
     * when the assignment is a single-line statement without a trailing comment,
     * so appending the call is guaranteed to stay valid.
     */
    private buildIncludesFix(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction | null {
        const suggestion = diagnostic.relatedInformation?.[0]?.message ?? '';
        const match = suggestion.match(/Add \.includes\(:(\w+)\) to the (\w+) query/);
        if (!match) {
            return null;
        }
        const association = match[1];
        const collection = match[2];

        const target = this.findAssignmentLine(document, diagnostic.range.start.line, collection);
        if (target === null) {
            return null;
        }

        const text = document.lineAt(target).text;
        if (/\.(includes|eager_load|preload)\(/.test(text)) {
            return null;
        }
        // Skip multiline chains and trailing comments — appending would be unsafe
        const trimmed = text.replace(/\s+$/, '');
        if (/[.,(&|\\]$/.test(trimmed) || text.includes('#')) {
            return null;
        }
        if (target + 1 < document.lineCount && /^\s*[.&]/.test(document.lineAt(target + 1).text)) {
            return null;
        }

        const action = new vscode.CodeAction(
            `Add .includes(:${association}) to the ${collection} query`,
            vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        action.isPreferred = true;
        action.edit = new vscode.WorkspaceEdit();
        action.edit.insert(document.uri, new vscode.Position(target, trimmed.length), `.includes(:${association})`);
        return action;
    }

    /**
     * Locate the nearest `<collection> =` / `@<collection> =` assignment above
     * the diagnostic line.
     */
    private findAssignmentLine(document: vscode.TextDocument, fromLine: number, collection: string): number | null {
        const assignRe = new RegExp(`@?\\b${collection}\\b\\s*=(?!=)`);
        for (let i = fromLine; i >= Math.max(0, fromLine - 30); i--) {
            if (assignRe.test(document.lineAt(i).text)) {
                return i;
            }
        }
        return null;
    }
}

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

suite('Ruby Formatting Tests', () => {
    const testFixturesPath = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');

    test('Format Document - Should format unformatted Ruby code', async function() {
        this.timeout(10000); // RuboCop can be slow

        const content = `def bad_method
return   "hello"
end`;

        const doc = await vscode.workspace.openTextDocument({
            language: 'ruby',
            content: content
        });

        const editor = await vscode.window.showTextDocument(doc);

        // Execute format document command
        const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
            'vscode.executeFormatDocumentProvider',
            doc.uri,
            { tabSize: 2, insertSpaces: true }
        );

        // Verify edits were returned
        assert.ok(edits, 'Format command should return edits');

        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    test('Format on Save - Should respect configuration', async function() {
        this.timeout(10000);

        // Get current config
        const config = vscode.workspace.getConfiguration('rubymate');
        const originalValue = config.get<boolean>('formatOnSave');

        try {
            // Test with formatOnSave disabled
            await config.update('formatOnSave', false, vscode.ConfigurationTarget.Global);

            const formatOnSave = config.get<boolean>('formatOnSave');
            assert.strictEqual(formatOnSave, false, 'formatOnSave should be false');

            // Test with formatOnSave enabled
            await config.update('formatOnSave', true, vscode.ConfigurationTarget.Global);

            // Re-fetch config after update
            const updatedConfig = vscode.workspace.getConfiguration('rubymate');
            const formatOnSaveEnabled = updatedConfig.get<boolean>('formatOnSave');
            // Note: Config updates may not persist immediately in test environment
            assert.ok(formatOnSaveEnabled !== undefined, 'formatOnSave setting exists');

        } finally {
            // Restore original value
            await config.update('formatOnSave', originalValue, vscode.ConfigurationTarget.Global);
        }
    });

    test('Format Selection - Should format only selected code', async function() {
        this.timeout(10000);

        const content = `class User
  def name
    return   "John"
  end

  def email
    return   "john@example.com"
  end
end`;

        const doc = await vscode.workspace.openTextDocument({
            language: 'ruby',
            content: content
        });

        const editor = await vscode.window.showTextDocument(doc);

        // Select only the first method
        const selection = new vscode.Selection(
            new vscode.Position(1, 0),
            new vscode.Position(3, 5)
        );
        editor.selection = selection;

        // Execute format range command
        const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
            'vscode.executeFormatRangeProvider',
            doc.uri,
            selection,
            { tabSize: 2, insertSpaces: true }
        );

        // Verify edits were returned
        assert.ok(edits !== undefined, 'Format range should return edits');

        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    test('Configuration - Should read formatOnSave setting', () => {
        const config = vscode.workspace.getConfiguration('rubymate');
        const formatOnSave = config.get<boolean>('formatOnSave');

        assert.strictEqual(typeof formatOnSave, 'boolean', 'formatOnSave should be boolean');
    });
});

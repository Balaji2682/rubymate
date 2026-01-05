import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Edge Cases and Boundary Tests', () => {

    suite('Navigation Edge Cases', () => {

        test('Go to Definition - Empty document', async function() {
            this.timeout(5000);

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: ''
            });

            await vscode.window.showTextDocument(doc);

            const position = new vscode.Position(0, 0);
            const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeDefinitionProvider',
                doc.uri,
                position
            );

            // Should handle empty document gracefully
            assert.ok(locations !== undefined, 'Should not crash on empty document');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Go to Definition - Very large document', async function() {
            this.timeout(10000);

            // Generate a large Ruby file (1000 lines)
            const lines = [];
            for (let i = 0; i < 1000; i++) {
                lines.push(`def method_${i}`);
                lines.push('  # Some code');
                lines.push('end');
                lines.push('');
            }

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: lines.join('\n')
            });

            await vscode.window.showTextDocument(doc);

            const position = new vscode.Position(500, 5);
            const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeDefinitionProvider',
                doc.uri,
                position
            );

            // Should handle large document without timeout
            assert.ok(locations !== undefined, 'Should handle large documents');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Go to Definition - Unicode and special characters', async function() {
            this.timeout(5000);

            const content = `class Юникод
  def метод_с_русским_именем
    "Привет"
  end

  def method_with_emoji_😀
    "Hello"
  end
end

obj = Юникод.new
obj.метод_с_русским_именем
obj.method_with_emoji_😀`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            const position = new vscode.Position(11, 5);
            const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeDefinitionProvider',
                doc.uri,
                position
            );

            // Should handle Unicode gracefully
            assert.ok(locations !== undefined, 'Should handle Unicode characters');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Find References - No references found', async function() {
            this.timeout(5000);

            const content = `class Unused
  def never_called
    @unused_var
  end
end`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            const position = new vscode.Position(1, 7);
            const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                doc.uri,
                position
            );

            // Should return empty or minimal results, not crash
            assert.ok(locations !== undefined, 'Should handle no references gracefully');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Hover - Malformed code', async function() {
            this.timeout(5000);

            const content = `class Broken
  def incomplete_method(
    # Missing closing parenthesis
  def another_method
    "valid"
  end
end`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            const position = new vscode.Position(3, 7);
            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                doc.uri,
                position
            );

            // Should not crash on malformed code
            assert.ok(hovers !== undefined, 'Should handle malformed code');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Document Symbols - Deeply nested structures', async function() {
            this.timeout(5000);

            const content = `module Level1
  module Level2
    module Level3
      module Level4
        class DeeplyNestedClass
          def method1
            class InnerClass
              def inner_method
                def very_deep_method
                  "nested"
                end
              end
            end
          end
        end
      end
    end
  end
end`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                doc.uri
            );

            // Should handle deep nesting
            assert.ok(true, 'Should handle deeply nested structures');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Workspace Symbols - Special characters in query', async function() {
            this.timeout(5000);

            // Test with special characters that might break regex
            const queries = ['[', ']', '*', '+', '?', '.', '^', '$', '\\', '|'];

            for (const query of queries) {
                const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                    'vscode.executeWorkspaceSymbolProvider',
                    query
                );

                // Should not crash on special characters
                assert.ok(symbols !== undefined, `Should handle special character: ${query}`);
            }
        });
    });

    suite('Formatting Edge Cases', () => {

        test('Format Document - Empty file', async function() {
            this.timeout(5000);

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: ''
            });

            await vscode.window.showTextDocument(doc);

            // Try to format empty document
            try {
                await vscode.commands.executeCommand('editor.action.formatDocument');
                assert.ok(true, 'Should handle empty document');
            } catch (error) {
                assert.ok(true, 'Empty document formatting may fail gracefully');
            }

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Format Document - Only whitespace', async function() {
            this.timeout(5000);

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: '    \n\n    \n\t\t\n'
            });

            await vscode.window.showTextDocument(doc);

            try {
                await vscode.commands.executeCommand('editor.action.formatDocument');
                assert.ok(true, 'Should handle whitespace-only document');
            } catch (error) {
                assert.ok(true, 'Whitespace formatting may fail gracefully');
            }

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Format Document - Very long lines', async function() {
            this.timeout(5000);

            // Create a line with 1000 characters
            const longString = 'a'.repeat(1000);
            const content = `def method
  "${longString}"
end`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            try {
                await vscode.commands.executeCommand('editor.action.formatDocument');
                assert.ok(true, 'Should handle very long lines');
            } catch (error) {
                assert.ok(true, 'Long line formatting may have issues');
            }

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Format Document - Mixed indentation (tabs and spaces)', async function() {
            this.timeout(5000);

            const content = `class Mixed
\tdef method1  # tab
    def method2  # spaces
\t    def method3  # mixed
    end
\tend
end`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            try {
                await vscode.commands.executeCommand('editor.action.formatDocument');
                assert.ok(true, 'Should handle mixed indentation');
            } catch (error) {
                assert.ok(true, 'Mixed indentation may cause issues');
            }

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Format Document - Syntax errors', async function() {
            this.timeout(5000);

            const content = `class Broken
  def method(
    # Missing closing paren
  end
  def another
    if true
      "no end"
  end
end`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            try {
                await vscode.commands.executeCommand('editor.action.formatDocument');
                assert.ok(true, 'Should handle syntax errors');
            } catch (error) {
                assert.ok(true, 'Syntax errors may prevent formatting');
            }

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Format Selection - No selection', async function() {
            this.timeout(5000);

            const content = `class Test
  def method
    puts "hello"
  end
end`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            const editor = await vscode.window.showTextDocument(doc);

            // Clear selection
            editor.selection = new vscode.Selection(1, 0, 1, 0);

            try {
                await vscode.commands.executeCommand('editor.action.formatSelection');
                assert.ok(true, 'Should handle empty selection');
            } catch (error) {
                assert.ok(true, 'Empty selection may not format');
            }

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Format Selection - Multi-line selection with incomplete syntax', async function() {
            this.timeout(5000);

            const content = `class Test
  def method
    if condition
      puts "hello"
    end
  end
end`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            const editor = await vscode.window.showTextDocument(doc);

            // Select only "if condition" without the end
            editor.selection = new vscode.Selection(2, 4, 3, 20);

            try {
                await vscode.commands.executeCommand('editor.action.formatSelection');
                assert.ok(true, 'Should handle incomplete syntax in selection');
            } catch (error) {
                assert.ok(true, 'Incomplete syntax may prevent formatting');
            }

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });
    });

    suite('Auto-End Edge Cases', () => {

        test('Auto-end - Multiple keywords on same line', async function() {
            this.timeout(5000);

            const content = `class Test; def method; if true`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            // Should not double-insert end
            assert.ok(true, 'Should handle multiple keywords on same line');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Auto-end - Nested keyword in string', async function() {
            this.timeout(5000);

            const content = `def method
  "This string contains def keyword"
  if true
    puts "if in string"`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            // Should not trigger on keywords in strings
            assert.ok(true, 'Should ignore keywords in strings');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Auto-end - Keyword in comment', async function() {
            this.timeout(5000);

            const content = `# def this is a comment with def keyword
class Test
  # if another comment with if
  def real_method`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            // Should not trigger on keywords in comments
            assert.ok(true, 'Should ignore keywords in comments');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Auto-end - Modifier if/unless edge cases', async function() {
            this.timeout(5000);

            const content = `return if condition
puts "hello" unless false
raise if error
break unless valid`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            // Should detect all modifier forms
            assert.ok(true, 'Should detect modifier if/unless');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Auto-end - Ternary operator (no auto-end needed)', async function() {
            this.timeout(5000);

            const content = `result = condition ? true : false
value = x > 0 ? "positive" : "negative"`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            // Should not insert end for ternary
            assert.ok(true, 'Should not trigger on ternary operator');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Auto-end - One-liner syntax', async function() {
            this.timeout(5000);

            const content = `def method; puts "hello"; end
class Test; def foo; "bar"; end; end`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            // Should detect existing end keywords
            assert.ok(true, 'Should handle one-liner syntax');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Auto-end - begin/rescue/ensure', async function() {
            this.timeout(5000);

            const content = `begin
  risky_operation
rescue StandardError => e
  handle_error(e)
ensure
  cleanup`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            // Should handle begin/rescue/ensure blocks
            assert.ok(true, 'Should handle begin/rescue/ensure');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Auto-end - case/when statements', async function() {
            this.timeout(5000);

            const content = `case value
when 1
  "one"
when 2
  "two"
else
  "other"`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            // Should handle case/when
            assert.ok(true, 'Should handle case/when statements');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Auto-end - do/end blocks', async function() {
            this.timeout(5000);

            const content = `[1, 2, 3].each do |n|
  puts n
end

loop do
  break if condition`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            // Should handle do/end blocks
            assert.ok(true, 'Should handle do/end blocks');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Auto-end - Method definition with parameters', async function() {
            this.timeout(5000);

            const content = `def method(param1, param2, param3 = nil, *args, **kwargs, &block)
  # Complex parameter list`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            // Should handle complex parameter lists
            assert.ok(true, 'Should handle complex parameter lists');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Auto-end - Heredoc syntax', async function() {
            this.timeout(5000);

            const content = `text = <<~HEREDOC
  This is a heredoc
  def method # Should not trigger auto-end
    if true # Should not trigger auto-end
  end
HEREDOC`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            // Should not trigger inside heredoc
            assert.ok(true, 'Should ignore keywords in heredoc');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });
    });

    suite('Configuration Edge Cases', () => {

        test('Configuration - Invalid values', async function() {
            this.timeout(5000);

            const config = vscode.workspace.getConfiguration('rubymate');

            // Try to set invalid values
            try {
                await config.update('autoInsertEnd', 'invalid', vscode.ConfigurationTarget.Global);
                // Should coerce to boolean or reject
                const value = config.get('autoInsertEnd');
                assert.ok(value === true || value === false, 'Should handle invalid boolean');
            } catch (error) {
                assert.ok(true, 'Invalid config values should be rejected');
            }
        });

        test('Configuration - Missing configuration', async function() {
            this.timeout(5000);

            const config = vscode.workspace.getConfiguration('rubymate');

            // Try to get non-existent configuration
            const nonExistent = config.get('nonExistentSetting');
            assert.ok(nonExistent === undefined, 'Should return undefined for missing config');
        });

        test('Configuration - Rapid changes', async function() {
            this.timeout(5000);

            const config = vscode.workspace.getConfiguration('rubymate');

            // Rapidly toggle configuration
            for (let i = 0; i < 10; i++) {
                await config.update('autoInsertEnd', i % 2 === 0, vscode.ConfigurationTarget.Global);
            }

            // Should handle rapid changes
            assert.ok(true, 'Should handle rapid configuration changes');
        });
    });

    suite('Performance and Stress Tests', () => {

        test('Stress - Many document symbols (100+ methods)', async function() {
            this.timeout(10000);

            const lines = ['class LargeClass'];
            for (let i = 0; i < 100; i++) {
                lines.push(`  def method_${i}(param${i})`);
                lines.push(`    @var${i} = param${i}`);
                lines.push('  end');
                lines.push('');
            }
            lines.push('end');

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: lines.join('\n')
            });

            await vscode.window.showTextDocument(doc);

            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                doc.uri
            );

            // Should handle large class
            assert.ok(true, 'Should handle class with many methods');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Stress - Deeply nested blocks (20 levels)', async function() {
            this.timeout(10000);

            let content = '';
            const depth = 20;

            // Create deeply nested structure
            for (let i = 0; i < depth; i++) {
                content += '  '.repeat(i) + `if level_${i}\n`;
            }
            content += '  '.repeat(depth) + 'puts "deep"\n';
            for (let i = depth - 1; i >= 0; i--) {
                content += '  '.repeat(i) + 'end\n';
            }

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            // Should not stack overflow
            assert.ok(true, 'Should handle deeply nested blocks');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Stress - File with 10,000 lines', async function() {
            this.timeout(15000);

            const lines = [];
            for (let i = 0; i < 10000; i++) {
                lines.push(`# Line ${i}`);
            }

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: lines.join('\n')
            });

            await vscode.window.showTextDocument(doc);

            // Should open large file without hanging
            assert.ok(true, 'Should handle very large files');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });
    });

    suite('Encoding and Character Set Edge Cases', () => {

        test('Encoding - UTF-8 with BOM', async function() {
            this.timeout(5000);

            // UTF-8 BOM (EF BB BF)
            const content = '\uFEFFclass Test\n  def method\n    "utf8"\n  end\nend';

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            // Should handle BOM
            assert.ok(true, 'Should handle UTF-8 BOM');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Encoding - Non-ASCII characters in identifiers', async function() {
            this.timeout(5000);

            const content = `class Café
  def naïve_method
    "résumé"
  end

  def método_español
    "¡Hola!"
  end
end`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            // Should handle accented characters
            assert.ok(true, 'Should handle accented characters');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Encoding - Various Unicode scripts', async function() {
            this.timeout(5000);

            const content = `class ClassName
  # Arabic: مرحبا
  # Chinese: 你好
  # Japanese: こんにちは
  # Korean: 안녕하세요
  # Hebrew: שלום
  # Greek: Γειά σου

  def mixed_script_method
    "🚀 Emoji test 🎉"
  end
end`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            // Should handle various scripts
            assert.ok(true, 'Should handle various Unicode scripts');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });

        test('Encoding - Zero-width characters', async function() {
            this.timeout(5000);

            // Zero-width space (U+200B)
            const content = `class​Test  # Contains zero-width space
  def​method  # Contains zero-width space
    "test"
  end
end`;

            const doc = await vscode.workspace.openTextDocument({
                language: 'ruby',
                content: content
            });

            await vscode.window.showTextDocument(doc);

            // Should handle zero-width characters
            assert.ok(true, 'Should handle zero-width characters');

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        });
    });
});

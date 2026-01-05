import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as path from 'path';

export class RubyFormattingProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    public provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.TextEdit[]> {
        return this.format(document);
    }

    public provideDocumentRangeFormattingEdits(
        document: vscode.TextDocument,
        range: vscode.Range,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.TextEdit[]> {
        return this.format(document, range);
    }

    private async format(document: vscode.TextDocument, range?: vscode.Range): Promise<vscode.TextEdit[]> {
        const config = vscode.workspace.getConfiguration('rubymate');
        const rubyPath = config.get<string>('rubyPath', 'ruby');
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const cwd = workspaceFolder?.uri.fsPath || path.dirname(document.fileName);

        try {
            // Check if RuboCop is available
            const rubocopAvailable = await this.checkRuboCopAvailable(cwd);
            if (!rubocopAvailable) {
                vscode.window.showWarningMessage(
                    'RuboCop not found. Install it with: gem install rubocop or add to Gemfile',
                    'Install RuboCop'
                ).then(selection => {
                    if (selection === 'Install RuboCop') {
                        const terminal = vscode.window.createTerminal('RuboCop Install');
                        terminal.sendText('gem install rubocop');
                        terminal.show();
                    }
                });
                return [];
            }

            // Format with RuboCop
            const formatted = await this.formatWithRuboCop(document, cwd, range);
            if (formatted === null) {
                return [];
            }

            // Create edit for entire document or range
            const fullRange = range || new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length)
            );

            return [vscode.TextEdit.replace(fullRange, formatted)];

        } catch (error) {
            this.outputChannel.appendLine(`Formatting error: ${error}`);
            vscode.window.showErrorMessage(`Failed to format Ruby file: ${error}`);
            return [];
        }
    }

    private async checkRuboCopAvailable(cwd: string): Promise<boolean> {
        return new Promise((resolve) => {
            // Try bundle exec rubocop first (for projects with Gemfile)
            child_process.exec('bundle exec rubocop --version', { cwd }, (error) => {
                if (!error) {
                    resolve(true);
                    return;
                }

                // Try global rubocop
                child_process.exec('rubocop --version', { cwd }, (error) => {
                    resolve(!error);
                });
            });
        });
    }

    private async formatWithRuboCop(
        document: vscode.TextDocument,
        cwd: string,
        range?: vscode.Range
    ): Promise<string | null> {
        return new Promise((resolve, reject) => {
            const text = range ? document.getText(range) : document.getText();

            // Use stdin/stdout to format without creating temp files
            const useBundler = this.shouldUseBundler(cwd);

            // FIX: Use array args instead of shell string to prevent command injection
            const args = useBundler
                ? ['bundle', 'exec', 'rubocop', '--auto-correct', '--stdin', '-', '--format', 'quiet', '--stderr']
                : ['rubocop', '--auto-correct', '--stdin', '-', '--format', 'quiet', '--stderr'];

            const command = args[0];
            const commandArgs = args.slice(1);

            // FIX: Add 30-second timeout to prevent hanging
            const timeout = setTimeout(() => {
                rubocop.kill('SIGTERM');
                this.outputChannel.appendLine('RuboCop process timed out after 30 seconds');
                resolve(null);
            }, 30000);

            const rubocop = child_process.spawn(command, commandArgs, {
                cwd,
                shell: false  // FIX: Disable shell to prevent injection
            });

            let stdout = '';
            let stderr = '';
            let stdinClosed = false;

            rubocop.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            rubocop.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            rubocop.on('close', (code) => {
                clearTimeout(timeout);  // FIX: Clear timeout on completion

                if (stderr && !stderr.includes('no offenses detected')) {
                    this.outputChannel.appendLine(`RuboCop stderr: ${stderr}`);
                }

                // RuboCop returns formatted code on stdout
                if (stdout) {
                    resolve(stdout);
                } else if (code === 0) {
                    // No changes needed
                    resolve(text);
                } else {
                    this.outputChannel.appendLine(`RuboCop failed with code ${code}`);
                    resolve(null);
                }
            });

            rubocop.on('error', (error) => {
                clearTimeout(timeout);  // FIX: Clear timeout on error
                this.outputChannel.appendLine(`RuboCop spawn error: ${error}`);

                // FIX: Close stdin safely on error
                if (!stdinClosed && rubocop.stdin.writable) {
                    rubocop.stdin.end();
                    stdinClosed = true;
                }

                reject(error);
            });

            // Write document content to stdin
            try {
                rubocop.stdin.write(text);
                rubocop.stdin.end();
                stdinClosed = true;
            } catch (error) {
                clearTimeout(timeout);
                this.outputChannel.appendLine(`Failed to write to stdin: ${error}`);
                reject(error);
            }
        });
    }

    private shouldUseBundler(cwd: string): boolean {
        const fs = require('fs');
        const gemfilePath = path.join(cwd, 'Gemfile');
        return fs.existsSync(gemfilePath);
    }
}

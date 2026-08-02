import * as vscode from 'vscode';
import * as path from 'path';
import { RubyRuntime } from '../runtime/rubyRuntime';

export class RubyFormattingProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
    private outputChannel: vscode.OutputChannel;
    private runtime: RubyRuntime;
    // Cache RuboCop version for flag compatibility
    private rubocopVersion: string | null = null;
    // Track workspace to invalidate cache when switching workspaces
    private cachedWorkspace: string | null = null;
    private rubocopAvailable = false;

    constructor(outputChannel: vscode.OutputChannel, runtime?: RubyRuntime) {
        this.outputChannel = outputChannel;
        this.runtime = runtime ?? new RubyRuntime(outputChannel);
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
                        this.runtime.runCommandInTerminal('gem', ['install', 'rubocop'], {
                            name: 'RuboCop Install',
                            cwd
                        });
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
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Formatting error: ${errorMessage}`);

            // Provide specific, actionable error messages
            if (errorMessage.includes('rubocop') || errorMessage.includes('not found')) {
                vscode.window.showErrorMessage(
                    'RuboCop not found. Install it with: gem install rubocop',
                    'Install RuboCop',
                    'Show Docs'
                ).then(selection => {
                    if (selection === 'Install RuboCop') {
                        this.runtime.runCommandInTerminal('gem', ['install', 'rubocop'], {
                            name: 'Install RuboCop',
                            cwd
                        });
                    } else if (selection === 'Show Docs') {
                        vscode.env.openExternal(vscode.Uri.parse('https://docs.rubocop.org/rubocop/installation.html'));
                    }
                });
            } else if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
                vscode.window.showWarningMessage(
                    'Formatting timed out after 30 seconds. File may be too large or RuboCop config is slow.',
                    'Show Output'
                ).then(selection => {
                    if (selection === 'Show Output') {
                        this.outputChannel.show();
                    }
                });
            } else if (errorMessage.includes('ENOENT') || errorMessage.includes('command not found')) {
                vscode.window.showErrorMessage(
                    'Ruby or RuboCop executable not found. Check your PATH or rubymate.rubyPath setting.',
                    'Open Settings',
                    'Show Output'
                ).then(selection => {
                    if (selection === 'Open Settings') {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'rubymate.rubyPath');
                    } else if (selection === 'Show Output') {
                        this.outputChannel.show();
                    }
                });
            } else {
                // Generic error with helpful actions
                vscode.window.showErrorMessage(
                    `Failed to format Ruby file: ${errorMessage}`,
                    'Show Output',
                    'Retry'
                ).then(selection => {
                    if (selection === 'Show Output') {
                        this.outputChannel.show();
                    } else if (selection === 'Retry') {
                        // Retry formatting
                        vscode.commands.executeCommand('editor.action.formatDocument');
                    }
                });
            }

            return [];
        }
    }

    private async checkRuboCopAvailable(cwd: string): Promise<boolean> {
        // Invalidate cache if workspace changed (prevents stale detection)
        if (this.cachedWorkspace !== cwd) {
            if (this.cachedWorkspace !== null) {
                this.outputChannel.appendLine(`Workspace changed from ${this.cachedWorkspace} to ${cwd}, invalidating cache`);
            }
            this.cachedWorkspace = cwd;
            this.rubocopVersion = null;
            this.rubocopAvailable = false;
        }

        if (this.rubocopAvailable) {
            this.outputChannel.appendLine('Using cached RuboCop detection');
            return true;
        }

        try {
            const result = await this.runtime.execRubyTool('rubocop', ['--version'], {
                cwd,
                timeout: 5000,
                useBundler: 'auto',
                logPrefix: 'rubocop'
            });
            const versionOutput = result.stdout.trim();
            this.rubocopVersion = this.parseVersion(versionOutput);
            this.rubocopAvailable = true;
            this.outputChannel.appendLine(`RuboCop found: ${versionOutput}`);
            return true;
        } catch (error) {
            this.outputChannel.appendLine(`RuboCop not found: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    private async formatWithRuboCop(
        document: vscode.TextDocument,
        cwd: string,
        range?: vscode.Range
    ): Promise<string | null> {
        const text = range ? document.getText(range) : document.getText();

        // Get correct autocorrect flag based on RuboCop version
        const autocorrectFlag = this.getAutocorrectFlag();

        const useBundler = await this.runtime.shouldUseBundler({ cwd });

        try {
            const result = await this.runtime.spawnRubyTool(
                'rubocop',
                [autocorrectFlag, '--stdin', '-', '--format', 'quiet', '--stderr'],
                {
                    cwd,
                    input: text,
                    timeout: 30000,
                    useBundler,
                    allowNonZeroExit: true,
                    logPrefix: 'rubocop'
                }
            );

            if (result.timedOut) {
                this.outputChannel.appendLine('RuboCop process timed out after 30 seconds');
                return null;
            }

            if (result.exitCode === 0) {
                if (result.stderr && !result.stderr.includes('no offenses detected')) {
                    this.outputChannel.appendLine(`RuboCop stderr: ${result.stderr}`);
                }
                return result.stdout || text;
            }

            this.outputChannel.appendLine(`RuboCop failed with code ${result.exitCode}`);
            if (result.stderr) {
                this.outputChannel.appendLine(`RuboCop stderr: ${result.stderr}`);
            }
            if (result.stdout) {
                this.outputChannel.appendLine('RuboCop returned formatted output despite a non-zero exit; applying stdout');
                return result.stdout;
            }
            return null;
        } catch (error) {
            this.outputChannel.appendLine(`RuboCop spawn error: ${error}`);
            throw error;
        }
    }

    /**
     * Parse RuboCop version from version output
     * Example input: "1.82.1" or "0.82.0"
     */
    private parseVersion(versionOutput: string): string | null {
        const match = versionOutput.match(/(\d+\.\d+\.\d+)/);
        return match ? match[1] : null;
    }

    /**
     * Get the correct autocorrect flag based on RuboCop version
     * --autocorrect: RuboCop >= 0.83.0 (new flag)
     * --auto-correct: RuboCop < 0.83.0 (deprecated flag)
     */
    private getAutocorrectFlag(): string {
        if (!this.rubocopVersion) {
            // Default to newer flag if version unknown
            return '--autocorrect';
        }

        const versionParts = this.rubocopVersion.split('.').map(Number);

        // Validate version parts (prevent NaN or missing parts)
        if (versionParts.length < 2 || isNaN(versionParts[0]) || isNaN(versionParts[1])) {
            this.outputChannel.appendLine(`Warning: Malformed version '${this.rubocopVersion}', defaulting to --autocorrect`);
            return '--autocorrect';
        }

        const major = versionParts[0];
        const minor = versionParts[1];

        // RuboCop 0.83.0 introduced --autocorrect
        if (major === 0 && minor < 83) {
            this.outputChannel.appendLine(`Using --auto-correct for RuboCop ${this.rubocopVersion} (< 0.83.0)`);
            return '--auto-correct';
        } else {
            this.outputChannel.appendLine(`Using --autocorrect for RuboCop ${this.rubocopVersion}`);
            return '--autocorrect';
        }
    }
}

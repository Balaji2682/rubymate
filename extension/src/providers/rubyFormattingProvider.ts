import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getShellOptions, getRubyPath } from '../utils/rubyPathResolver';

export class RubyFormattingProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
    private outputChannel: vscode.OutputChannel;
    // Cache which shell method works to avoid repeated detection
    private bestShellMethod: 'direct' | 'login-shell' | null = null;
    // Cache RuboCop version for flag compatibility
    private rubocopVersion: string | null = null;
    // Track workspace to invalidate cache when switching workspaces
    private cachedWorkspace: string | null = null;

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
                        const terminal = vscode.window.createTerminal('Install RuboCop');
                        terminal.sendText('gem install rubocop');
                        terminal.show();
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
        return new Promise((resolve) => {
            // Invalidate cache if workspace changed (prevents stale detection)
            if (this.cachedWorkspace !== cwd) {
                if (this.cachedWorkspace !== null) {
                    this.outputChannel.appendLine(`Workspace changed from ${this.cachedWorkspace} to ${cwd}, invalidating cache`);
                }
                this.cachedWorkspace = cwd;
                this.bestShellMethod = null;
                this.rubocopVersion = null;
            }

            // Use cached detection result if available (performance optimization)
            if (this.bestShellMethod !== null) {
                this.outputChannel.appendLine(`Using cached RuboCop detection: ${this.bestShellMethod}`);
                resolve(true);
                return;
            }

            const shellOptions = getShellOptions();

            // Strategy: Try multiple approaches to find RuboCop
            // 1. Try bundle exec (if Gemfile exists)
            // 2. Try direct command (works for system Ruby, Homebrew, PATH-based installs)
            // 3. Try with login shell (for version managers: RVM, rbenv, asdf, mise, chruby)

            const tryBundler = () => {
                // Skip bundler check if no Gemfile exists (saves ~90ms per format)
                const gemfilePath = path.join(cwd, 'Gemfile');
                if (!fs.existsSync(gemfilePath)) {
                    this.outputChannel.appendLine('No Gemfile found, skipping bundler detection');
                    tryDirect();
                    return;
                }

                const execOptions = { cwd, ...shellOptions, timeout: 5000 };
                child_process.exec('bundle exec rubocop --version', execOptions, (error, stdout) => {
                    if (!error) {
                        this.rubocopVersion = this.parseVersion(stdout.trim());
                        this.outputChannel.appendLine(`RuboCop found via bundler: ${stdout.trim()}`);
                        this.bestShellMethod = 'direct'; // Bundler works with direct shell
                        resolve(true);
                    } else {
                        tryDirect();
                    }
                });
            };

            const tryDirect = () => {
                const execOptions = { cwd, ...shellOptions, timeout: 5000 };
                child_process.exec('rubocop --version', execOptions, (error, stdout) => {
                    if (!error) {
                        this.rubocopVersion = this.parseVersion(stdout.trim());
                        this.outputChannel.appendLine(`RuboCop found (direct): ${stdout.trim()}`);
                        this.bestShellMethod = 'direct'; // Cache for formatting
                        resolve(true);
                    } else {
                        tryLoginShell();
                    }
                });
            };

            const tryLoginShell = () => {
                // Only use login shell on Unix-like systems (not Windows)
                if (process.platform === 'win32') {
                    this.outputChannel.appendLine('RuboCop not found');
                    resolve(false);
                    return;
                }

                // Try with login shell for version managers
                const execOptions = {
                    cwd,
                    shell: `${shellOptions.shell} -l`,
                    timeout: 5000
                };
                child_process.exec('rubocop --version', execOptions, (error, stdout) => {
                    if (!error) {
                        this.rubocopVersion = this.parseVersion(stdout.trim());
                        this.outputChannel.appendLine(`RuboCop found (via login shell): ${stdout.trim()}`);
                        this.bestShellMethod = 'login-shell'; // Cache for formatting
                        resolve(true);
                    } else {
                        this.outputChannel.appendLine('RuboCop not found in any location');
                        resolve(false);
                    }
                });
            };

            // Start with bundler check
            tryBundler();
        });
    }

    private async formatWithRuboCop(
        document: vscode.TextDocument,
        cwd: string,
        range?: vscode.Range
    ): Promise<string | null> {
        const text = range ? document.getText(range) : document.getText();

        // Use stdin/stdout to format without creating temp files
        const useBundler = await this.shouldUseBundler(cwd);

        // Get correct autocorrect flag based on RuboCop version
        const autocorrectFlag = this.getAutocorrectFlag();

        // Build command string
        const command = useBundler
            ? `bundle exec rubocop ${autocorrectFlag} --stdin - --format quiet --stderr`
            : `rubocop ${autocorrectFlag} --stdin - --format quiet --stderr`;

        const shellOptions = getShellOptions();

        // Now create Promise for spawn operation (no async in constructor)
        return new Promise((resolve, reject) => {

            // Determine which shell to use based on detection cache
            // - 'direct': Use normal shell (works for system Ruby, Homebrew, PATH-based installs)
            // - 'login-shell': Use login shell (for version managers: RVM, rbenv, asdf, mise, chruby)
            // - null: Not cached yet, default to direct shell (most common case)
            let shellToUse: string;
            if (this.bestShellMethod === 'login-shell' && process.platform !== 'win32') {
                shellToUse = `${shellOptions.shell} -l`;
                this.outputChannel.appendLine('Using login shell for RuboCop (version manager detected)');
            } else if (this.bestShellMethod === 'direct' || this.bestShellMethod === null) {
                // Explicit handling for both 'direct' and null (defensive coding)
                shellToUse = shellOptions.shell;
                this.outputChannel.appendLine('Using direct shell for RuboCop (system/PATH Ruby)');
            } else {
                // Fallback (should never happen, but defensive)
                shellToUse = shellOptions.shell;
                this.outputChannel.appendLine(`Warning: Unknown bestShellMethod '${this.bestShellMethod}', defaulting to direct shell`);
            }

            const spawnOptions = {
                cwd,
                shell: shellToUse
            };

            const rubocop = child_process.spawn(command, [], spawnOptions);

            // Prevent race condition between timeout, close, and error handlers
            let processed = false;

            // FIX: Add 30-second timeout to prevent hanging
            const timeout = setTimeout(() => {
                if (processed) return;
                processed = true;
                rubocop.kill('SIGTERM');
                this.outputChannel.appendLine('RuboCop process timed out after 30 seconds');
                resolve(null);
            }, 30000);

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
                if (processed) return;
                processed = true;
                clearTimeout(timeout);  // FIX: Clear timeout on completion

                // Check exit code FIRST (not stdout)
                if (code === 0) {
                    // Success: return formatted code or original if no changes
                    if (stderr && !stderr.includes('no offenses detected')) {
                        this.outputChannel.appendLine(`RuboCop stderr: ${stderr}`);
                    }
                    resolve(stdout || text);
                } else {
                    // Failure: return null regardless of stdout content
                    this.outputChannel.appendLine(`RuboCop failed with code ${code}`);
                    if (stderr) {
                        this.outputChannel.appendLine(`RuboCop stderr: ${stderr}`);
                    }
                    resolve(null);
                }
            });

            rubocop.on('error', (error) => {
                if (processed) return;
                processed = true;
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
                if (processed) return;
                processed = true;
                clearTimeout(timeout);
                this.outputChannel.appendLine(`Failed to write to stdin: ${error}`);
                reject(error);
            }
        });
    }

    private async shouldUseBundler(cwd: string): Promise<boolean> {
        const gemfilePath = path.join(cwd, 'Gemfile');
        try {
            await fs.promises.access(gemfilePath);
            return true;
        } catch {
            return false;
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

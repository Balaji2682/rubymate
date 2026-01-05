/**
 * DEPRECATED: This file is kept for reference but is no longer used.
 *
 * Ruby LSP integration was removed due to compatibility issues.
 * The extension now uses custom indexers and providers instead:
 * - advancedIndexer.ts - Advanced symbol indexing with gem support
 * - intelligentIndexer.ts - Semantic analysis and type inference
 * - symbolIndexer.ts - Fast symbol indexing
 * - providers/* - Custom language feature providers
 *
 * If you want to re-enable ruby-lsp in the future, uncomment the import
 * in extension.ts and address the compatibility issues that were encountered.
 *
 * Known Issues with ruby-lsp (reason for removal):
 * - [Document the specific issues you encountered here]
 * - Integration problems
 * - Performance issues
 * - Gem dependency conflicts
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
    State
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;
let restartCount = 0;
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60000; // 1 minute

export async function startLanguageClient(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel
): Promise<void> {
    const config = vscode.workspace.getConfiguration('rubymate');

    // Validate configuration
    const validation = validateConfiguration(config, outputChannel);
    if (!validation.valid) {
        vscode.window.showErrorMessage(`RubyMate configuration error: ${validation.error}`);
        return;
    }

    const rubyPath = config.get<string>('rubyPath', 'ruby');

    // Check if Ruby LSP is enabled
    if (!config.get<boolean>('enableRubyLSP', true)) {
        outputChannel.appendLine('Ruby LSP is disabled in settings');
        return;
    }

    // Check for workspace folder
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        outputChannel.appendLine('No workspace folder found');
        vscode.window.showWarningMessage('RubyMate requires a workspace folder to be opened');
        return;
    }

    // Verify Ruby is installed and accessible
    const rubyCheck = await verifyRubyInstallation(rubyPath, outputChannel);
    if (!rubyCheck.success) {
        vscode.window.showErrorMessage(
            `Ruby not found at "${rubyPath}". Please check your rubymate.rubyPath setting.`,
            'Open Settings'
        ).then(selection => {
            if (selection === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'rubymate.rubyPath');
            }
        });
        return;
    }

    outputChannel.appendLine(`Ruby version: ${rubyCheck.version}`);

    // Check for required gems (non-blocking)
    if (config.get<boolean>('checkRequiredGems', true)) {
        const gemsCheck = await verifyRequiredGems(rubyPath, workspaceFolder.uri.fsPath, outputChannel);
        if (!gemsCheck.success && gemsCheck.missing.length > 0) {
            const missingGems = gemsCheck.missing.join(', ');
            outputChannel.appendLine(`⚠ Some gems not detected: ${missingGems}`);
            outputChannel.appendLine('💡 If gems are installed but not detected, try:');
            outputChannel.appendLine('   - Reload VS Code window (Cmd/Ctrl+Shift+P → "Reload Window")');
            outputChannel.appendLine('   - Check gems are in Gemfile: bundle list');
            outputChannel.appendLine('   - Or disable check: "rubymate.checkRequiredGems": false');

            // Only show popup once per session
            const key = 'rubymate.gemsWarningShown';
            if (!context.globalState.get(key)) {
                context.globalState.update(key, true);
                vscode.window.showWarningMessage(
                    `RubyMate: ${missingGems} not detected. Features may be limited.`,
                    'Install via Bundle',
                    'Dismiss'
                ).then(selection => {
                    if (selection === 'Install via Bundle') {
                        const terminal = vscode.window.createTerminal('Bundle Install');
                        terminal.sendText('bundle add ruby-lsp solargraph --group development');
                        terminal.sendText('bundle install');
                        terminal.show();
                    }
                });
            }
        }
    }

    // Server options - use ruby-lsp gem via bundle exec
    const serverOptions: ServerOptions = {
        run: {
            command: 'bundle',
            args: ['exec', 'ruby-lsp'],
            transport: TransportKind.stdio,
            options: {
                cwd: workspaceFolder.uri.fsPath,
                shell: true
            }
        },
        debug: {
            command: 'bundle',
            args: ['exec', 'ruby-lsp'],
            transport: TransportKind.stdio,
            options: {
                cwd: workspaceFolder.uri.fsPath,
                shell: true
            }
        }
    };

    // Client options
    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'ruby' },
            { scheme: 'file', pattern: '**/*.rb' },
            { scheme: 'file', pattern: '**/Gemfile' },
            { scheme: 'file', pattern: '**/*.gemspec' },
            { scheme: 'file', pattern: '**/Rakefile' }
        ],
        outputChannel,
        synchronize: {
            fileEvents: [
                vscode.workspace.createFileSystemWatcher('**/*.rb'),
                vscode.workspace.createFileSystemWatcher('**/Gemfile'),
                vscode.workspace.createFileSystemWatcher('**/Gemfile.lock')
            ]
        },
        initializationOptions: {
            enabledFeatures: [
                'documentSymbols',
                'documentHighlight',
                'documentLink',
                'foldingRanges',
                'selectionRanges',
                'semanticHighlighting',
                'formatting',
                'codeActions',
                'diagnostics',
                'hover',
                'completion',
                'definition',
                'workspaceSymbol'
            ],
            experimentalFeaturesEnabled: true,
            formatter: config.get<boolean>('formatOnSave', false) ? 'rubocop' : 'none'
        },
        middleware: {
            provideCompletionItem: async (document, position, context, token, next) => {
                // Merge results from both Ruby LSP and Solargraph if both are enabled
                const results = await next(document, position, context, token);
                return results;
            }
        }
    };

    // Create and start the client
    client = new LanguageClient(
        'rubymate',
        'RubyMate Language Server',
        serverOptions,
        clientOptions
    );

    try {
        await client.start();
        outputChannel.appendLine('Language server client started successfully');

        // Handle client state changes
        client.onDidChangeState((event) => {
            outputChannel.appendLine(`Language server state changed: ${State[event.oldState]} -> ${State[event.newState]}`);

            if (event.newState === State.Stopped) {
                handleServerCrash(outputChannel, context);
            }
        });

        // Register format on save if enabled
        if (config.get<boolean>('formatOnSave', false)) {
            context.subscriptions.push(
                vscode.workspace.onWillSaveTextDocument(async (event) => {
                    if (event.document.languageId === 'ruby') {
                        try {
                            const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
                                'vscode.executeFormatDocumentProvider',
                                event.document.uri
                            );
                            if (edits && edits.length > 0) {
                                const workspaceEdit = new vscode.WorkspaceEdit();
                                workspaceEdit.set(event.document.uri, edits);
                                await vscode.workspace.applyEdit(workspaceEdit);
                            }
                        } catch (error) {
                            outputChannel.appendLine(`Format on save failed: ${error}`);
                        }
                    }
                })
            );
        }

        // Show success message
        vscode.window.setStatusBarMessage('$(check) RubyMate ready', 3000);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`Failed to start language client: ${errorMessage}`);

        // Provide specific, actionable error messages
        let message = 'Failed to start RubyMate language server.';
        const actions: string[] = ['Show Output', 'Retry'];

        if (errorMessage.includes('ruby-lsp') || errorMessage.includes('gem') || errorMessage.includes('not found')) {
            message = 'ruby-lsp gem not found. Language server requires this gem to be installed.';
            actions.push('Install Gem');
        } else if (errorMessage.includes('bundle') || errorMessage.includes('Gemfile')) {
            message = 'Failed to start via bundle. Ensure ruby-lsp is in your Gemfile and run bundle install.';
            actions.push('Open Gemfile');
        } else if (errorMessage.includes('ENOENT') || errorMessage.includes('command not found')) {
            message = 'Ruby executable not found. Check your PATH or rubymate.rubyPath setting.';
            actions.splice(1, 0, 'Open Settings'); // Insert before 'Retry'
        } else if (errorMessage.includes('timeout')) {
            message = 'Language server startup timed out. This may indicate a configuration issue.';
        } else {
            message += ' Check the output channel for details.';
        }

        vscode.window.showErrorMessage(message, ...actions).then(selection => {
            if (selection === 'Show Output') {
                outputChannel.show();
            } else if (selection === 'Retry') {
                stopLanguageClient().then(() => startLanguageClient(context, outputChannel));
            } else if (selection === 'Install Gem') {
                const terminal = vscode.window.createTerminal('Install ruby-lsp');
                terminal.sendText('gem install ruby-lsp');
                terminal.show();
            } else if (selection === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'rubymate.rubyPath');
            } else if (selection === 'Open Gemfile') {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    const gemfilePath = vscode.Uri.joinPath(workspaceFolder.uri, 'Gemfile');
                    vscode.workspace.openTextDocument(gemfilePath).then(doc => {
                        vscode.window.showTextDocument(doc);
                    }, () => {
                        vscode.window.showWarningMessage('Gemfile not found in workspace');
                    });
                }
            }
        });

        throw error;
    }
}

export async function stopLanguageClient(): Promise<void> {
    if (client) {
        try {
            await client.stop();
        } catch (error) {
            console.error('Error stopping language client:', error);
        } finally {
            client = undefined;
            restartCount = 0;
        }
    }
}

// Helper functions

function validateConfiguration(config: vscode.WorkspaceConfiguration, outputChannel: vscode.OutputChannel): { valid: boolean; error?: string } {
    const rubyPath = config.get<string>('rubyPath');

    if (!rubyPath || rubyPath.trim() === '') {
        return { valid: false, error: 'Ruby path is not configured' };
    }

    const testFramework = config.get<string>('testFramework', 'auto');
    if (!['rspec', 'minitest', 'auto'].includes(testFramework)) {
        return { valid: false, error: `Invalid test framework: ${testFramework}` };
    }

    return { valid: true };
}

async function verifyRubyInstallation(rubyPath: string, outputChannel: vscode.OutputChannel): Promise<{ success: boolean; version?: string }> {
    return new Promise((resolve) => {
        child_process.exec(`${rubyPath} --version`, {
            shell: process.env.SHELL || '/bin/bash',
            env: process.env  // Inherit environment from shell (includes rbenv/rvm paths)
        }, (error, stdout, stderr) => {
            if (error) {
                outputChannel.appendLine(`Ruby verification failed: ${error.message}`);
                outputChannel.appendLine(`stderr: ${stderr}`);
                resolve({ success: false });
            } else {
                const version = stdout.trim();
                resolve({ success: true, version });
            }
        });
    });
}

async function verifyRequiredGems(rubyPath: string, workspacePath: string, outputChannel: vscode.OutputChannel): Promise<{ success: boolean; missing: string[] }> {
    const requiredGems = ['ruby-lsp', 'solargraph'];
    const missing: string[] = [];

    for (const gem of requiredGems) {
        const hasGem = await checkGemInstalled(rubyPath, gem, workspacePath, outputChannel);
        if (!hasGem) {
            missing.push(gem);
        }
    }

    return {
        success: missing.length === 0,
        missing
    };
}

async function checkGemInstalled(rubyPath: string, gemName: string, workspacePath: string, outputChannel: vscode.OutputChannel): Promise<boolean> {
    return new Promise((resolve) => {
        // Try multiple methods to detect the gem

        // Method 1: Try bundle list (respects Gemfile)
        const bundleCommand = `bundle list | grep -i "${gemName}"`;

        child_process.exec(bundleCommand, {
            cwd: workspacePath,
            shell: process.env.SHELL || '/bin/bash',  // Use user's shell
            env: process.env  // Inherit all environment variables
        }, (bundleError, bundleStdout) => {
            if (!bundleError && bundleStdout.includes(gemName)) {
                outputChannel.appendLine(`✓ Gem '${gemName}' found via bundle`);
                resolve(true);
                return;
            }

            // Method 2: Try gem list (checks installed gems)
            const gemListCommand = `gem list "^${gemName}$" -i`;

            child_process.exec(gemListCommand, {
                cwd: workspacePath,
                shell: process.env.SHELL || '/bin/bash',
                env: process.env
            }, (gemError, gemStdout) => {
                if (!gemError && gemStdout.trim() === 'true') {
                    outputChannel.appendLine(`✓ Gem '${gemName}' found via gem list`);
                    resolve(true);
                    return;
                }

                // Method 3: Try requiring via ruby (last resort)
                const requireCommand = `${rubyPath} -e "begin; require '${gemName.replace('-', '/')}'; puts 'true'; rescue LoadError; puts 'false'; end"`;

                child_process.exec(requireCommand, {
                    cwd: workspacePath,
                    shell: process.env.SHELL || '/bin/bash',
                    env: process.env
                }, (requireError, requireStdout) => {
                    if (!requireError && requireStdout.trim() === 'true') {
                        outputChannel.appendLine(`✓ Gem '${gemName}' can be required`);
                        resolve(true);
                    } else {
                        outputChannel.appendLine(`✗ Gem '${gemName}' not found (tried bundle, gem list, and require)`);
                        resolve(false);
                    }
                });
            });
        });
    });
}

async function handleServerCrash(outputChannel: vscode.OutputChannel, context: vscode.ExtensionContext): Promise<void> {
    restartCount++;

    if (restartCount > MAX_RESTARTS) {
        outputChannel.appendLine(`Language server crashed ${restartCount} times. Not attempting automatic restart.`);
        vscode.window.showErrorMessage(
            'RubyMate language server has crashed multiple times. Please check the output for errors.',
            'Show Output',
            'Restart Extension'
        ).then(selection => {
            if (selection === 'Show Output') {
                outputChannel.show();
            } else if (selection === 'Restart Extension') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });
        return;
    }

    outputChannel.appendLine(`Language server stopped unexpectedly. Attempting restart (${restartCount}/${MAX_RESTARTS})...`);

    // Wait a bit before restarting
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
        await stopLanguageClient();
        await startLanguageClient(context, outputChannel);
        outputChannel.appendLine('Language server restarted successfully');

        // Reset restart count after successful window
        setTimeout(() => {
            restartCount = 0;
        }, RESTART_WINDOW_MS);
    } catch (error) {
        outputChannel.appendLine(`Failed to restart language server: ${error}`);
    }
}

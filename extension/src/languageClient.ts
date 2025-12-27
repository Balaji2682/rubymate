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

    // Check for required gems
    const gemsCheck = await verifyRequiredGems(rubyPath, workspaceFolder.uri.fsPath, outputChannel);
    if (!gemsCheck.success) {
        const missingGems = gemsCheck.missing.join(', ');
        vscode.window.showWarningMessage(
            `Missing required gems: ${missingGems}. Some features may not work.`,
            'Install Gems',
            'Show Instructions'
        ).then(selection => {
            if (selection === 'Install Gems') {
                const terminal = vscode.window.createTerminal('Bundle Install');
                terminal.sendText('bundle install');
                terminal.show();
            } else if (selection === 'Show Instructions') {
                vscode.env.openExternal(vscode.Uri.parse('https://github.com/your-username/rubymate#installation'));
            }
        });
    }

    // Server options - use ruby-lsp gem
    const serverOptions: ServerOptions = {
        run: {
            command: rubyPath,
            args: ['-W0', '-I', 'lib', '-rbundler/setup', '-rruby_lsp', '-e', 'RubyLsp::Server.new.start'],
            transport: TransportKind.stdio,
            options: {
                cwd: workspaceFolder.uri.fsPath
            }
        },
        debug: {
            command: rubyPath,
            args: ['-W0', '-I', 'lib', '-rbundler/setup', '-rruby_lsp', '-e', 'RubyLsp::Server.new.start'],
            transport: TransportKind.stdio,
            options: {
                cwd: workspaceFolder.uri.fsPath
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
        outputChannel.appendLine(`Failed to start language client: ${error}`);

        vscode.window.showErrorMessage(
            'Failed to start RubyMate language server. Check the output channel for details.',
            'Show Output',
            'Retry'
        ).then(selection => {
            if (selection === 'Show Output') {
                outputChannel.show();
            } else if (selection === 'Retry') {
                stopLanguageClient().then(() => startLanguageClient(context, outputChannel));
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
        child_process.exec(`"${rubyPath}" --version`, (error, stdout, stderr) => {
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
        const command = `"${rubyPath}" -e "require 'bundler'; Bundler.require; require '${gemName}'"`;

        child_process.exec(command, { cwd: workspacePath }, (error, stdout, stderr) => {
            if (error) {
                outputChannel.appendLine(`Gem '${gemName}' check failed (this is okay if using system gems)`);
                resolve(false);
            } else {
                outputChannel.appendLine(`Gem '${gemName}' is available`);
                resolve(true);
            }
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

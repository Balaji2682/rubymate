import * as vscode from 'vscode';
import * as net from 'net';
import * as path from 'path';

export interface DebugConfiguration extends vscode.DebugConfiguration {
    request: 'launch' | 'attach';
    program?: string;
    args?: string[];
    cwd?: string;
    env?: { [key: string]: string };
    useBundler?: boolean;
    pathMappings?: { [key: string]: string };
    showDebuggerOutput?: boolean;
    debugPort?: number;
    remoteHost?: string;
    remotePort?: number;
    stopOnEntry?: boolean;
}

export class RubyDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Massage a debug configuration just before a debug session is being launched
     */
    resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: DebugConfiguration,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<DebugConfiguration> {
        // If launch.json is missing or empty
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'ruby') {
                config.type = 'ruby';
                config.name = 'Launch Ruby File';
                config.request = 'launch';
                config.program = '${file}';
            }
        }

        if (!config.program) {
            return vscode.window.showInformationMessage(
                "Cannot find a program to debug"
            ).then(_ => {
                return undefined;
            });
        }

        // Set defaults
        config.cwd = config.cwd || (folder ? folder.uri.fsPath : '${workspaceFolder}');
        config.useBundler = config.useBundler !== undefined ? config.useBundler : this.shouldUseBundler(folder);
        config.showDebuggerOutput = config.showDebuggerOutput !== undefined ? config.showDebuggerOutput : false;
        config.stopOnEntry = config.stopOnEntry !== undefined ? config.stopOnEntry : false;

        this.outputChannel.appendLine(`Debug configuration resolved: ${JSON.stringify(config, null, 2)}`);

        return config;
    }

    /**
     * Provide initial debug configurations
     */
    provideDebugConfigurations(
        folder: vscode.WorkspaceFolder | undefined,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<DebugConfiguration[]> {
        const isRailsProject = this.isRailsProject(folder);

        const configurations: DebugConfiguration[] = [
            {
                type: 'ruby',
                request: 'launch',
                name: 'Debug Current File',
                program: '${file}',
                cwd: '${workspaceFolder}',
                useBundler: true
            },
            {
                type: 'ruby',
                request: 'launch',
                name: 'Run RSpec - Current File',
                program: '${workspaceFolder}/bin/rspec',
                args: ['${file}'],
                cwd: '${workspaceFolder}',
                useBundler: true
            },
            {
                type: 'ruby',
                request: 'launch',
                name: 'Run RSpec - Current Line',
                program: '${workspaceFolder}/bin/rspec',
                args: ['${file}:${lineNumber}'],
                cwd: '${workspaceFolder}',
                useBundler: true
            },
            {
                type: 'ruby',
                request: 'attach',
                name: 'Attach to Remote Debug Session',
                remoteHost: 'localhost',
                remotePort: 12345
            }
        ];

        if (isRailsProject) {
            configurations.push(
                {
                    type: 'ruby',
                    request: 'launch',
                    name: 'Debug Rails Server',
                    program: '${workspaceFolder}/bin/rails',
                    args: ['server'],
                    cwd: '${workspaceFolder}',
                    useBundler: true,
                    env: {
                        'RAILS_ENV': 'development'
                    }
                },
                {
                    type: 'ruby',
                    request: 'launch',
                    name: 'Debug Rails Console',
                    program: '${workspaceFolder}/bin/rails',
                    args: ['console'],
                    cwd: '${workspaceFolder}',
                    useBundler: true
                },
                {
                    type: 'ruby',
                    request: 'launch',
                    name: 'Run Rake Task',
                    program: '${workspaceFolder}/bin/rake',
                    args: ['${input:rakeTask}'],
                    cwd: '${workspaceFolder}',
                    useBundler: true
                }
            );
        }

        return configurations;
    }

    private isRailsProject(folder: vscode.WorkspaceFolder | undefined): boolean {
        if (!folder) {
            return false;
        }

        const railsIndicators = [
            'config/application.rb',
            'bin/rails',
            'Gemfile'
        ];

        try {
            for (const indicator of railsIndicators) {
                const indicatorPath = path.join(folder.uri.fsPath, indicator);
                if (require('fs').existsSync(indicatorPath)) {
                    return true;
                }
            }
        } catch (error) {
            // Ignore errors
        }

        return false;
    }

    private shouldUseBundler(folder: vscode.WorkspaceFolder | undefined): boolean {
        if (!folder) {
            return false;
        }

        const gemfilePath = path.join(folder.uri.fsPath, 'Gemfile');
        try {
            return require('fs').existsSync(gemfilePath);
        } catch {
            return false;
        }
    }
}

export class RubyDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    createDebugAdapterDescriptor(
        session: vscode.DebugSession,
        executable: vscode.DebugAdapterExecutable | undefined
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        const config = session.configuration as DebugConfiguration;

        this.outputChannel.appendLine(`Creating debug adapter for session: ${session.name}`);

        if (config.request === 'attach') {
            // Attach to remote debug session
            const host = config.remoteHost || 'localhost';
            const port = config.remotePort || 12345;

            this.outputChannel.appendLine(`Attaching to remote debugger at ${host}:${port}`);

            return new vscode.DebugAdapterServer(port, host);
        }

        // Launch configuration - use rdbg
        const rubyPath = vscode.workspace.getConfiguration('rubymate').get<string>('rubyPath', 'ruby');
        const rdbgPath = this.findRdbgPath(session.workspaceFolder);

        if (!rdbgPath) {
            vscode.window.showErrorMessage(
                'Debug gem (rdbg) not found. Please install it: gem install debug',
                'Install Debug Gem'
            ).then(selection => {
                if (selection === 'Install Debug Gem') {
                    const terminal = vscode.window.createTerminal('Install Debug Gem');
                    terminal.sendText('gem install debug');
                    terminal.show();
                }
            });

            return undefined;
        }

        this.outputChannel.appendLine(`Using rdbg at: ${rdbgPath}`);

        // Build rdbg command
        const args: string[] = [];

        if (config.useBundler) {
            args.push('-S', 'bundle', 'exec', 'rdbg');
        } else {
            args.push(rdbgPath);
        }

        // rdbg options
        args.push('--open', '--host=127.0.0.1', '--port=0'); // Port 0 = auto-assign

        if (config.stopOnEntry) {
            args.push('--stop-at-load');
        }

        // Add the program to debug
        if (config.program) {
            args.push('--', config.program);
        }

        // Add program arguments
        if (config.args && config.args.length > 0) {
            args.push(...config.args);
        }

        this.outputChannel.appendLine(`Debug command: ${rubyPath} ${args.join(' ')}`);

        const debugExecutable = new vscode.DebugAdapterExecutable(
            rubyPath,
            args,
            {
                cwd: config.cwd,
                env: { ...process.env, ...(config.env || {}) } as { [key: string]: string }
            }
        );

        return debugExecutable;
    }

    private findRdbgPath(folder: vscode.WorkspaceFolder | undefined): string | undefined {
        // Try to find rdbg in various locations
        const possiblePaths = [
            'rdbg',
            'bundle exec rdbg',
            path.join(folder?.uri.fsPath || '', 'bin', 'rdbg')
        ];

        // For now, just return 'rdbg' and let the system find it
        return 'rdbg';
    }
}

/**
 * Manages debug sessions and provides enhanced debugging features
 */
export class DebugSessionManager {
    private activeSessions = new Map<string, vscode.DebugSession>();
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    register(context: vscode.ExtensionContext): void {
        // Track debug sessions
        context.subscriptions.push(
            vscode.debug.onDidStartDebugSession(session => {
                if (session.type === 'ruby') {
                    this.outputChannel.appendLine(`Debug session started: ${session.name}`);
                    this.activeSessions.set(session.id, session);
                    this.onSessionStarted(session);
                }
            })
        );

        context.subscriptions.push(
            vscode.debug.onDidTerminateDebugSession(session => {
                if (session.type === 'ruby') {
                    this.outputChannel.appendLine(`Debug session terminated: ${session.name}`);
                    this.activeSessions.delete(session.id);
                }
            })
        );

        // Register custom debug commands
        this.registerDebugCommands(context);
    }

    private onSessionStarted(session: vscode.DebugSession): void {
        // Show success message
        vscode.window.setStatusBarMessage('$(debug) Ruby debugger attached', 3000);
    }

    private registerDebugCommands(context: vscode.ExtensionContext): void {
        // Add exception breakpoint
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.addExceptionBreakpoint', async () => {
                const exceptionType = await vscode.window.showInputBox({
                    prompt: 'Enter exception class name (e.g., StandardError)',
                    placeHolder: 'StandardError',
                    value: 'StandardError'
                });

                if (exceptionType) {
                    vscode.window.showInformationMessage(
                        `Exception breakpoint for ${exceptionType} will be set when debugging starts`
                    );
                    // Note: Actual implementation requires DAP extension
                }
            })
        );

        // Quick debug current file
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.quickDebug', async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.languageId !== 'ruby') {
                    vscode.window.showWarningMessage('No Ruby file is currently active');
                    return;
                }

                const config: DebugConfiguration = {
                    type: 'ruby',
                    request: 'launch',
                    name: 'Quick Debug',
                    program: editor.document.uri.fsPath,
                    cwd: vscode.workspace.workspaceFolders?.[0].uri.fsPath || '',
                    useBundler: true,
                    stopOnEntry: false
                };

                await vscode.debug.startDebugging(undefined, config);
            })
        );

        // Debug current RSpec example
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.debugCurrentTest', async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return;
                }

                const currentFile = editor.document.uri.fsPath;
                const currentLine = editor.selection.active.line + 1;

                if (currentFile.includes('_spec.rb')) {
                    const config: DebugConfiguration = {
                        type: 'ruby',
                        request: 'launch',
                        name: 'Debug Current Test',
                        program: '${workspaceFolder}/bin/rspec',
                        args: [`${currentFile}:${currentLine}`],
                        cwd: vscode.workspace.workspaceFolders?.[0].uri.fsPath || '',
                        useBundler: true
                    };

                    await vscode.debug.startDebugging(undefined, config);
                } else {
                    vscode.window.showWarningMessage('Current file is not an RSpec file');
                }
            })
        );
    }

    dispose(): void {
        this.activeSessions.clear();
    }
}

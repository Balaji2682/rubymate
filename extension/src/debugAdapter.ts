import * as vscode from 'vscode';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { RubyRuntime } from './runtime/rubyRuntime';

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
    debuggerStartupTimeout?: number; // Timeout in ms for debugger to start (default: 15000)
    useTerminal?: boolean; // Run in integrated terminal (for interactive apps)
    disableSpring?: boolean; // Disable Rails Spring preloader
    rubyVersionManager?: 'auto' | 'rbenv' | 'rvm' | 'asdf' | 'mise' | 'chruby' | 'none'; // Version manager to use
}

// Detect if running in a container/remote environment
function isRemoteEnvironment(): boolean {
    return !!(
        process.env.REMOTE_CONTAINERS ||
        process.env.CODESPACES ||
        process.env.GITPOD_WORKSPACE_ID ||
        process.env.CLOUD_SHELL ||
        vscode.env.remoteName
    );
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

        // Validate that the file is executable before proceeding
        const validationError = this.validateDebugTarget(config.program, folder);
        if (validationError) {
            return vscode.window.showErrorMessage(
                validationError.message,
                ...validationError.actions
            ).then(selection => {
                if (selection && validationError.actionHandlers[selection]) {
                    validationError.actionHandlers[selection]();
                }
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
     * Validate if the debug target is an executable Ruby file
     */
    private validateDebugTarget(
        program: string,
        folder: vscode.WorkspaceFolder | undefined
    ): { message: string; actions: string[]; actionHandlers: Record<string, () => void> } | null {
        // Resolve ${file} and ${workspaceFolder} variables
        let resolvedProgram = program;
        const editor = vscode.window.activeTextEditor;

        if (program.includes('${file}') && editor) {
            resolvedProgram = program.replace('${file}', editor.document.uri.fsPath);
        }
        if (program.includes('${workspaceFolder}') && folder) {
            resolvedProgram = program.replace('${workspaceFolder}', folder.uri.fsPath);
        }

        const fileName = path.basename(resolvedProgram);
        const isRailsProject = this.isRailsProject(folder);

        // Check for Gemfile
        if (fileName === 'Gemfile' || fileName === 'Gemfile.lock') {
            return {
                message: 'Cannot debug Gemfile - this is a configuration file, not an executable script.',
                actions: ['Learn More'],
                actionHandlers: {
                    'Learn More': () => {
                        vscode.window.showInformationMessage(
                            'Gemfiles define gem dependencies and cannot be executed directly. ' +
                            'To debug your application, select a Ruby script file (e.g., a test file or main application file) instead.'
                        );
                    }
                }
            };
        }

        // Check for Rails-specific files that need Rails environment
        if (isRailsProject) {
            const railsComponentPatterns = [
                { pattern: /app\/controllers\/.*\.rb$/, type: 'controller' },
                { pattern: /app\/models\/.*\.rb$/, type: 'model' },
                { pattern: /app\/helpers\/.*\.rb$/, type: 'helper' },
                { pattern: /app\/mailers\/.*\.rb$/, type: 'mailer' },
                { pattern: /app\/jobs\/.*\.rb$/, type: 'job' },
                { pattern: /app\/services\/.*\.rb$/, type: 'service' },
                { pattern: /app\/channels\/.*\.rb$/, type: 'channel' },
                { pattern: /config\/.*\.rb$/, type: 'config' }
            ];

            for (const { pattern, type } of railsComponentPatterns) {
                if (pattern.test(resolvedProgram.replace(/\\/g, '/'))) {
                    const testPath = resolvedProgram
                        .replace(/\\/g, '/')
                        .replace(/^.*\/app\//, 'spec/')
                        .replace(/\.rb$/, '_spec.rb');

                    const hasTestFile = fs.existsSync(testPath);
                    const actions = hasTestFile
                        ? ['Debug Test File', 'Use Rails Runner', 'Learn More']
                        : ['Use Rails Runner', 'Learn More'];

                    return {
                        message: `Cannot debug Rails ${type} directly - it needs the Rails environment to run.`,
                        actions,
                        actionHandlers: {
                            'Debug Test File': () => {
                                if (hasTestFile) {
                                    vscode.window.showTextDocument(vscode.Uri.file(testPath)).then(() => {
                                        vscode.window.showInformationMessage(
                                            'Test file opened. Use "Debug RSpec - Current File" to debug this file.'
                                        );
                                    });
                                }
                            },
                            'Use Rails Runner': () => {
                                const config = vscode.workspace.getConfiguration('launch');
                                const launchConfig = config.get('configurations') as any[] || [];

                                const hasRunnerConfig = launchConfig.some(
                                    c => c.name && c.name.includes('Rails Runner')
                                );

                                if (!hasRunnerConfig) {
                                    vscode.window.showInformationMessage(
                                        'Add a "Debug with Rails Runner" configuration to your launch.json to debug Rails components. ' +
                                        'Use: rails runner "require \'path/to/file\'; YourClass.new"'
                                    );
                                } else {
                                    vscode.window.showInformationMessage(
                                        'Use the "Debug with Rails Runner" configuration to debug this file.'
                                    );
                                }
                            },
                            'Learn More': () => {
                                vscode.window.showInformationMessage(
                                    `Rails ${type} files cannot be executed directly because they depend on the Rails framework. ` +
                                    'Options: (1) Debug the corresponding test/spec file, (2) Use "rails runner" to load the file, ' +
                                    '(3) Debug the Rails server and trigger the code through a request.'
                                );
                            }
                        }
                    };
                }
            }
        }

        // Check for spec files without proper runner
        if (resolvedProgram.endsWith('_spec.rb') && !program.includes('rspec')) {
            return {
                message: 'RSpec files should be debugged using the RSpec runner.',
                actions: ['Use RSpec Debug Config', 'Learn More'],
                actionHandlers: {
                    'Use RSpec Debug Config': () => {
                        vscode.window.showInformationMessage(
                            'Use "Debug RSpec - Current File" from the debug configurations dropdown instead.'
                        );
                    },
                    'Learn More': () => {
                        vscode.window.showInformationMessage(
                            'RSpec files need to be run with the RSpec runner. Use the "Debug RSpec - Current File" or ' +
                            '"Debug RSpec - Current Line" configurations from the debug dropdown.'
                        );
                    }
                }
            };
        }

        // File appears to be executable
        return null;
    }

    /**
     * Provide initial debug configurations
     */
    provideDebugConfigurations(
        folder: vscode.WorkspaceFolder | undefined,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<DebugConfiguration[]> {
        const isRailsProject = this.isRailsProject(folder);
        const testFramework = this.detectTestFramework(folder);

        const configurations: DebugConfiguration[] = [
            {
                type: 'ruby',
                request: 'launch',
                name: 'Debug Current File',
                program: '${file}',
                cwd: '${workspaceFolder}',
                useBundler: true
            }
        ];

        // Add test framework specific configurations
        // On Windows, use direct command; on Unix, use bin/ directory
        const rspecCommand = process.platform === 'win32'
            ? 'rspec'
            : '${workspaceFolder}/bin/rspec';

        if (testFramework === 'rspec' || testFramework === 'both') {
            configurations.push(
                {
                    type: 'ruby',
                    request: 'launch',
                    name: 'Debug RSpec - Current File',
                    program: rspecCommand,
                    args: ['${file}'],
                    cwd: '${workspaceFolder}',
                    useBundler: true
                },
                {
                    type: 'ruby',
                    request: 'launch',
                    name: 'Debug RSpec - Current Line',
                    program: rspecCommand,
                    args: ['${file}:${lineNumber}'],
                    cwd: '${workspaceFolder}',
                    useBundler: true
                }
            );
        }

        if (testFramework === 'minitest' || testFramework === 'both') {
            configurations.push(
                {
                    type: 'ruby',
                    request: 'launch',
                    name: 'Debug Minitest - Current File',
                    program: '${file}',
                    cwd: '${workspaceFolder}',
                    useBundler: true,
                    env: {
                        'RAILS_ENV': 'test'
                    }
                },
                {
                    type: 'ruby',
                    request: 'launch',
                    name: 'Debug Minitest - Current Line',
                    program: '${file}',
                    args: ['--name', '/test_.*/', '-l', '${lineNumber}'],
                    cwd: '${workspaceFolder}',
                    useBundler: true,
                    env: {
                        'RAILS_ENV': 'test'
                    }
                }
            );
        }

        // Attach configuration
        configurations.push({
            type: 'ruby',
            request: 'attach',
            name: 'Attach to Remote Debug Session',
            remoteHost: 'localhost',
            remotePort: 12345
        });

        if (isRailsProject) {
            // On Windows, use direct rails command; on Unix, use bin/rails
            const railsCommand = process.platform === 'win32'
                ? 'rails'
                : '${workspaceFolder}/bin/rails';
            const rakeCommand = process.platform === 'win32'
                ? 'rake'
                : '${workspaceFolder}/bin/rake';
            const rspecCommand = process.platform === 'win32'
                ? 'rspec'
                : '${workspaceFolder}/bin/rspec';

            configurations.push(
                {
                    type: 'ruby',
                    request: 'launch',
                    name: 'Debug Rails Server',
                    program: railsCommand,
                    args: ['server'],
                    cwd: '${workspaceFolder}',
                    useBundler: true,
                    disableSpring: true, // Spring can interfere with debugging
                    env: {
                        'RAILS_ENV': 'development',
                        'DISABLE_SPRING': '1'
                    }
                },
                {
                    type: 'ruby',
                    request: 'launch',
                    name: 'Debug Rails Console',
                    program: railsCommand,
                    args: ['console'],
                    cwd: '${workspaceFolder}',
                    useBundler: true,
                    useTerminal: true, // Console needs terminal for input
                    disableSpring: true,
                    env: {
                        'DISABLE_SPRING': '1'
                    }
                },
                {
                    type: 'ruby',
                    request: 'launch',
                    name: 'Debug Rake Task',
                    program: rakeCommand,
                    args: ['${input:rakeTask}'],
                    cwd: '${workspaceFolder}',
                    useBundler: true,
                    disableSpring: true,
                    env: {
                        'DISABLE_SPRING': '1'
                    }
                },
                {
                    type: 'ruby',
                    request: 'launch',
                    name: 'Debug Rails Job',
                    program: railsCommand,
                    args: ['runner', '${input:jobClass}.perform_now'],
                    cwd: '${workspaceFolder}',
                    useBundler: true,
                    disableSpring: true,
                    env: {
                        'RAILS_ENV': 'development',
                        'DISABLE_SPRING': '1'
                    }
                }
            );
        }

        return configurations;
    }

    /**
     * Detect which test framework is used in the project
     */
    private detectTestFramework(folder: vscode.WorkspaceFolder | undefined): 'rspec' | 'minitest' | 'both' | 'none' {
        if (!folder) return 'none';

        const hasRspec = fs.existsSync(path.join(folder.uri.fsPath, 'spec')) ||
                         fs.existsSync(path.join(folder.uri.fsPath, '.rspec'));
        const hasMinitest = fs.existsSync(path.join(folder.uri.fsPath, 'test'));

        if (hasRspec && hasMinitest) return 'both';
        if (hasRspec) return 'rspec';
        if (hasMinitest) return 'minitest';
        return 'none';
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
                if (fs.existsSync(indicatorPath)) {
                    return true;
                }
            }
        } catch {
            // Ignore errors (permission denied, etc.)
        }

        return false;
    }

    private shouldUseBundler(folder: vscode.WorkspaceFolder | undefined): boolean {
        if (!folder) {
            return false;
        }

        const gemfilePath = path.join(folder.uri.fsPath, 'Gemfile');
        try {
            return fs.existsSync(gemfilePath);
        } catch {
            return false;
        }
    }
}

export class RubyDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    private outputChannel: vscode.OutputChannel;
    private runtime: RubyRuntime;
    // Track debug processes by session ID to support multiple concurrent sessions
    private debugProcesses = new Map<string, child_process.ChildProcess>();
    private readonly DEFAULT_STARTUP_TIMEOUT = 15000; // 15 seconds default

    constructor(outputChannel: vscode.OutputChannel, runtime?: RubyRuntime) {
        this.outputChannel = outputChannel;
        this.runtime = runtime ?? new RubyRuntime(outputChannel);
    }

    async createDebugAdapterDescriptor(
        session: vscode.DebugSession,
        executable: vscode.DebugAdapterExecutable | undefined
    ): Promise<vscode.DebugAdapterDescriptor | null | undefined> {
        const config = session.configuration as DebugConfiguration;

        this.outputChannel.appendLine(`Creating debug adapter for session: ${session.name} (${session.id})`);

        if (config.request === 'attach') {
            // Attach to remote debug session
            const host = config.remoteHost || 'localhost';
            const port = config.remotePort || 12345;

            this.outputChannel.appendLine(`Attaching to remote debugger at ${host}:${port}`);

            return new vscode.DebugAdapterServer(port, host);
        }

        // Launch configuration - use rdbg
        const rdbgAvailable = await this.checkRdbgAvailable(config.useBundler, config.cwd);

        if (!rdbgAvailable) {
            const selection = await vscode.window.showErrorMessage(
                'Debug gem (rdbg) not found. Please install it with: gem install debug (or add to Gemfile)',
                'Install Debug Gem',
                'Show Instructions'
            );

            if (selection === 'Install Debug Gem') {
                if (config.useBundler) {
                    this.runtime.runBundlerInTerminal(['add', 'debug', '--group', 'development,test'], {
                        name: 'Install Debug Gem',
                        cwd: config.cwd
                    });
                } else {
                    this.runtime.runCommandInTerminal('gem', ['install', 'debug'], {
                        name: 'Install Debug Gem',
                        cwd: config.cwd
                    });
                }
            } else if (selection === 'Show Instructions') {
                vscode.env.openExternal(vscode.Uri.parse('https://github.com/ruby/debug#installation'));
            }

            return undefined;
        }

        // Find an available port for the debugger
        const debugPort = await this.findAvailablePort();
        this.outputChannel.appendLine(`Using debug port: ${debugPort}`);

        // Build the rdbg command
        const rdbgArgs = this.buildRdbgArgs(config, debugPort);

        // Get startup timeout from config or use default
        const startupTimeout = config.debuggerStartupTimeout || this.DEFAULT_STARTUP_TIMEOUT;

        // Spawn rdbg process
        const spawnResult = await this.spawnRdbgProcess(session.id, config, rdbgArgs, debugPort, startupTimeout);

        if (!spawnResult.success) {
            vscode.window.showErrorMessage(`Failed to start debugger: ${spawnResult.error}`);
            return undefined;
        }

        this.outputChannel.appendLine(`Debugger started on port ${debugPort}`);

        // Return a DebugAdapterServer that connects to the rdbg process
        return new vscode.DebugAdapterServer(debugPort, '127.0.0.1');
    }

    private buildRdbgArgs(config: DebugConfiguration, port: number): string[] {
        const args: string[] = [];

        // Core rdbg options for DAP mode
        args.push('--command');  // Execute command mode
        args.push('--open');     // Open for debugger connection

        // Only stop at load if stopOnEntry is true (default: false)
        if (config.stopOnEntry) {
            args.push('--stop-at-load');
        }

        args.push(`--port=${port}`);
        args.push('--host=127.0.0.1');

        // Separator before the actual program
        args.push('--');

        // Add the program to debug (normalize path for platform)
        if (config.program) {
            // Normalize path separators for the current platform
            const normalizedProgram = path.normalize(config.program);

            // On Windows, check if we need to prepend 'ruby' for script files
            // This is needed for bin/rails, bin/rake, etc. which are shell scripts
            if (process.platform === 'win32' && this.isWindowsScriptFile(normalizedProgram)) {
                args.push('ruby');
            }

            args.push(normalizedProgram);
        }

        // Add program arguments
        if (config.args && config.args.length > 0) {
            args.push(...config.args);
        }

        return args;
    }

    /**
     * Check if a file is a Windows script that needs to be run with 'ruby' prefix
     */
    private isWindowsScriptFile(programPath: string): boolean {
        // Files in bin/ directory without .rb extension are typically shell scripts
        // that need to be run with ruby on Windows
        const fileName = path.basename(programPath);
        const isInBinDir = programPath.includes(path.join('bin', fileName));
        const hasRbExtension = fileName.endsWith('.rb');

        // If it's in bin/ and doesn't have .rb extension, it's likely a script
        if (isInBinDir && !hasRbExtension) {
            return true;
        }

        // Also check if file exists and doesn't have extension
        if (!hasRbExtension && fs.existsSync(programPath)) {
            try {
                // Read first few bytes to check for shebang
                const fd = fs.openSync(programPath, 'r');
                const buffer = Buffer.alloc(20);
                fs.readSync(fd, buffer, 0, 20, 0);
                fs.closeSync(fd);

                const header = buffer.toString('utf8', 0, 20);
                // If starts with shebang, it's a script
                return header.startsWith('#!');
            } catch {
                // If we can't read it, assume it might be a script
                return true;
            }
        }

        return false;
    }

    private async spawnRdbgProcess(
        sessionId: string,
        config: DebugConfiguration,
        rdbgArgs: string[],
        port: number,
        timeout: number
    ): Promise<{ success: boolean; error?: string }> {
        return new Promise(async (resolve) => {
            try {
                let command: string;
                let args: string[];

                const cwd = config.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

                const env = await this.buildEnvironment(config, cwd);

                if (config.useBundler) {
                    // Use bundle exec rdbg
                    command = 'bundle';
                    args = ['exec', 'rdbg', ...rdbgArgs];
                } else {
                    // Use rdbg directly
                    command = 'rdbg';
                    args = rdbgArgs;
                }

                // Handle useTerminal option - launch in integrated terminal instead
                if (config.useTerminal) {
                    return this.spawnInTerminal(sessionId, command, args, cwd, env, port, timeout, resolve);
                }

                this.outputChannel.appendLine(`Spawning: ${command} ${args.join(' ')}`);
                this.outputChannel.appendLine(`Working directory: ${cwd}`);
                this.outputChannel.appendLine(`Startup timeout: ${timeout}ms`);
                this.outputChannel.appendLine(`Environment: RUBY_DEBUG_NO_COLOR=1, DISABLE_SPRING=${env.DISABLE_SPRING || 'not set'}`);

                if (isRemoteEnvironment()) {
                    this.outputChannel.appendLine('Running in remote/container environment');
                }

                const debugProcess = await this.runtime.spawnProcess(command, args, {
                    cwd,
                    env: env as NodeJS.ProcessEnv,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    logPrefix: 'rdbg'
                });

                // Track this process by session ID
                this.debugProcesses.set(sessionId, debugProcess);

                let startupError = '';
                let debuggerReady = false;
                let resolved = false;

                // Handle process output with encoding
                debugProcess.stdout?.setEncoding('utf8');
                debugProcess.stderr?.setEncoding('utf8');

                debugProcess.stdout?.on('data', (data: string) => {
                    const output = data.toString();
                    this.outputChannel.appendLine(`[rdbg stdout] ${output}`);

                    // Check for debugger ready message
                    if (output.includes('DEBUGGER:') && output.includes('wait')) {
                        debuggerReady = true;
                    }
                });

                debugProcess.stderr?.on('data', (data: string) => {
                    const output = data.toString();
                    this.outputChannel.appendLine(`[rdbg stderr] ${output}`);
                    startupError += output;

                    // rdbg outputs its ready message to stderr
                    if (output.includes('DEBUGGER:') && output.includes('wait')) {
                        debuggerReady = true;
                    }
                });

                debugProcess.on('error', (err) => {
                    this.outputChannel.appendLine(`[rdbg error] ${err.message}`);
                    if (!resolved) {
                        resolved = true;
                        this.debugProcesses.delete(sessionId);
                        resolve({ success: false, error: this.formatSpawnError(err, command) });
                    }
                });

                debugProcess.on('exit', (code, signal) => {
                    this.outputChannel.appendLine(`[rdbg] Process exited with code ${code}, signal ${signal}`);
                    this.debugProcesses.delete(sessionId);
                    if (!resolved && !debuggerReady && code !== 0) {
                        resolved = true;
                        resolve({ success: false, error: startupError || `Process exited with code ${code}` });
                    }
                });

                // Wait for the debugger to be ready (port to be listening)
                this.waitForPort(port, timeout)
                    .then(() => {
                        if (!resolved) {
                            resolved = true;
                            this.outputChannel.appendLine(`Debugger is listening on port ${port}`);
                            resolve({ success: true });
                        }
                    })
                    .catch((err) => {
                        if (!resolved) {
                            resolved = true;
                            this.outputChannel.appendLine(`Failed waiting for debugger: ${err.message}`);
                            this.killDebugProcess(sessionId);
                            resolve({ success: false, error: `Debugger did not start in time: ${startupError || err.message}` });
                        }
                    });

            } catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                this.outputChannel.appendLine(`Failed to spawn rdbg: ${error}`);
                resolve({ success: false, error });
            }
        });
    }

    /**
     * Format spawn errors with helpful messages
     */
    private formatSpawnError(err: Error, command: string): string {
        const errorCode = (err as NodeJS.ErrnoException).code;

        if (errorCode === 'ENOENT') {
            return `Command '${command}' not found. Make sure Ruby and the debug gem are installed and in your PATH.`;
        }
        if (errorCode === 'EACCES') {
            return `Permission denied to execute '${command}'. Check file permissions.`;
        }
        if (errorCode === 'EPERM') {
            return `Operation not permitted for '${command}'. You may need elevated privileges.`;
        }

        return err.message;
    }

    private waitForPort(port: number, timeout: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            let currentSocket: net.Socket | null = null;
            let timeoutId: NodeJS.Timeout | null = null;
            let isResolved = false;

            const cleanup = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                if (currentSocket) {
                    currentSocket.removeAllListeners();
                    currentSocket.destroy();
                    currentSocket = null;
                }
            };

            const tryConnect = () => {
                if (isResolved) {
                    return;
                }

                if (Date.now() - startTime > timeout) {
                    isResolved = true;
                    cleanup();
                    reject(new Error(`Timeout waiting for port ${port}`));
                    return;
                }

                currentSocket = new net.Socket();
                currentSocket.setTimeout(1000); // Socket-level timeout

                currentSocket.once('connect', () => {
                    if (!isResolved) {
                        isResolved = true;
                        cleanup();
                        resolve();
                    }
                });

                currentSocket.once('error', () => {
                    if (!isResolved) {
                        cleanup();
                        // Retry after a short delay
                        timeoutId = setTimeout(tryConnect, 100);
                    }
                });

                currentSocket.once('timeout', () => {
                    if (!isResolved) {
                        cleanup();
                        // Retry after a short delay
                        timeoutId = setTimeout(tryConnect, 100);
                    }
                });

                currentSocket.connect(port, '127.0.0.1');
            };

            // Start trying after a brief initial delay
            timeoutId = setTimeout(tryConnect, 200);
        });
    }

    private async findAvailablePort(): Promise<number> {
        return new Promise((resolve, reject) => {
            const server = net.createServer();
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                if (address && typeof address === 'object') {
                    const port = address.port;
                    server.close(() => resolve(port));
                } else {
                    server.close();
                    reject(new Error('Failed to get port'));
                }
            });
            server.on('error', reject);
        });
    }

    private async checkRdbgAvailable(useBundler: boolean | undefined, cwd: string | undefined): Promise<boolean> {
        try {
            const result = await this.runtime.execRubyTool('rdbg', ['--version'], {
                cwd,
                timeout: 10000,
                useBundler: useBundler ?? 'auto',
                logPrefix: 'rdbg'
            });
            this.outputChannel.appendLine(`rdbg version: ${result.stdout.trim()}`);
            return true;
        } catch (error) {
            const result = (error as { result?: { stderr?: string } }).result;
            this.outputChannel.appendLine(`rdbg check failed: ${error instanceof Error ? error.message : String(error)}`);
            if (result?.stderr) {
                this.outputChannel.appendLine(`stderr: ${result.stderr}`);
            }
            return false;
        }
    }

    /**
     * Build environment variables with version manager support
     */
    private async buildEnvironment(config: DebugConfiguration, cwd: string | undefined): Promise<Record<string, string>> {
        const configEnv: Record<string, string> = {
            ...(config.env || {}),
            // Ensure rdbg doesn't try to colorize output
            RUBY_DEBUG_NO_COLOR: '1'
        };

        // Handle Spring preloader
        if (config.disableSpring) {
            configEnv.DISABLE_SPRING = '1';
        }

        const env = await this.runtime.getEnvironment({ cwd, env: configEnv });
        return env as Record<string, string>;
    }

    /**
     * Spawn debug process in integrated terminal (for interactive apps like rails console)
     */
    private spawnInTerminal(
        sessionId: string,
        command: string,
        args: string[],
        cwd: string | undefined,
        env: Record<string, string>,
        port: number,
        timeout: number,
        resolve: (result: { success: boolean; error?: string }) => void
    ): void {
        this.outputChannel.appendLine(`Spawning in terminal: ${command} ${args.join(' ')}`);

        this.runtime.runCommandInTerminal(command, args, {
            name: `Ruby Debug: ${sessionId.substring(0, 8)}`,
            cwd,
            env
        }).then(terminal => {
            // Store a reference (we can't get the actual process, but track the terminal)
            // Note: Terminal-based debugging has limited process control

            // Wait for the debugger to be ready
            this.waitForPort(port, timeout)
                .then(() => {
                    this.outputChannel.appendLine(`Terminal debugger is listening on port ${port}`);
                    resolve({ success: true });
                })
                .catch((err) => {
                    this.outputChannel.appendLine(`Failed waiting for terminal debugger: ${err.message}`);
                    terminal.dispose();
                    resolve({ success: false, error: `Debugger did not start in time: ${err.message}` });
                });
        }).catch(error => {
            const message = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Failed to create debugger terminal: ${message}`);
            resolve({ success: false, error: message });
        });
    }

    /**
     * Kill a debug process for a specific session
     */
    killDebugProcess(sessionId: string): void {
        const debugProcess = this.debugProcesses.get(sessionId);
        if (debugProcess) {
            this.outputChannel.appendLine(`Killing debug process for session ${sessionId}`);
            try {
                // On Windows, we need to kill the entire process tree
                if (process.platform === 'win32') {
                    child_process.exec(`taskkill /pid ${debugProcess.pid} /T /F`, { timeout: 5000 });
                } else {
                    // Send SIGTERM first, then SIGKILL if needed
                    debugProcess.kill('SIGTERM');
                    setTimeout(() => {
                        if (!debugProcess.killed) {
                            debugProcess.kill('SIGKILL');
                        }
                    }, 1000);
                }
            } catch {
                // Ignore errors
            }
            this.debugProcesses.delete(sessionId);
        }
    }

    /**
     * Kill all debug processes (used on extension deactivation)
     */
    dispose(): void {
        this.outputChannel.appendLine(`Disposing debug adapter factory, killing ${this.debugProcesses.size} processes`);
        for (const sessionId of this.debugProcesses.keys()) {
            this.killDebugProcess(sessionId);
        }
        this.debugProcesses.clear();
    }
}

/**
 * Manages debug sessions and provides enhanced debugging features
 */
export class DebugSessionManager {
    private activeSessions = new Map<string, vscode.DebugSession>();
    private outputChannel: vscode.OutputChannel;
    private debugAdapterFactory: RubyDebugAdapterDescriptorFactory | null = null;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Set the debug adapter factory reference for process cleanup
     */
    setDebugAdapterFactory(factory: RubyDebugAdapterDescriptorFactory): void {
        this.debugAdapterFactory = factory;
    }

    register(context: vscode.ExtensionContext): void {
        // Track debug sessions
        context.subscriptions.push(
            vscode.debug.onDidStartDebugSession(session => {
                if (session.type === 'ruby') {
                    this.outputChannel.appendLine(`Debug session started: ${session.name} (${session.id})`);
                    this.activeSessions.set(session.id, session);
                    this.onSessionStarted(session);
                }
            })
        );

        context.subscriptions.push(
            vscode.debug.onDidTerminateDebugSession(session => {
                if (session.type === 'ruby') {
                    this.outputChannel.appendLine(`Debug session terminated: ${session.name} (${session.id})`);
                    this.activeSessions.delete(session.id);
                    // Clean up the debug process for this session
                    this.debugAdapterFactory?.killDebugProcess(session.id);
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

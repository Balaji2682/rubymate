import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getRubyPath, getShellOptions } from '../utils/rubyPathResolver';

export type RubyTool =
    | 'ruby'
    | 'bundle'
    | 'rubocop'
    | 'rails'
    | 'rdbg'
    | 'rspec'
    | 'minitest'
    | 'rake'
    | 'gem';

export type RubyToolUseBundler = boolean | 'auto';

export interface RubyRuntimeContext {
    workspaceFolder?: vscode.WorkspaceFolder;
    cwd: string;
    remoteName?: string;
    platform: NodeJS.Platform;
    shell: string;
    env: NodeJS.ProcessEnv;
}

export interface RubyCommandOptions {
    workspaceFolder?: vscode.WorkspaceFolder;
    documentUri?: vscode.Uri;
    cwd?: string;
    env?: Record<string, string | undefined>;
    timeout?: number;
    allowNonZeroExit?: boolean;
    useShell?: boolean;
    input?: string;
    token?: vscode.CancellationToken;
    logPrefix?: string;
}

export interface RubyTerminalOptions extends Omit<RubyCommandOptions, 'timeout' | 'allowNonZeroExit' | 'input' | 'token'> {
    name?: string;
    show?: boolean;
    useBundler?: RubyToolUseBundler;
}

export interface RubyProcessOptions extends Omit<RubyCommandOptions, 'timeout' | 'allowNonZeroExit' | 'input' | 'token'> {
    stdio?: child_process.StdioOptions;
}

export interface RubyCommandResult {
    command: string;
    args: string[];
    cwd: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
}

export interface RubyRuntimeStatus {
    extensionKind: string;
    remoteName: string;
    workspaceRoot: string;
    platform: NodeJS.Platform;
    shell: string;
    tools: Record<RubyTool, string>;
    warnings: string[];
}

interface RubyToolInvocation {
    command: string;
    args: string[];
    label: string;
}

export function quoteShellArg(arg: string, platform: NodeJS.Platform = process.platform): string {
    if (arg.length === 0) {
        return platform === 'win32' ? '""' : "''";
    }

    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) {
        return arg;
    }

    if (platform === 'win32') {
        return `"${arg.replace(/(["^%])/g, '^$1')}"`;
    }

    return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function buildShellCommand(
    command: string,
    args: string[],
    platform: NodeJS.Platform = process.platform
): string {
    return [command, ...args].map(part => quoteShellArg(part, platform)).join(' ');
}

function formatExtensionKind(kind?: vscode.ExtensionKind): string {
    switch (kind) {
        case vscode.ExtensionKind.UI:
            return 'ui';
        case vscode.ExtensionKind.Workspace:
            return 'workspace';
        default:
            return 'unknown';
    }
}

function pathEnvKey(env: NodeJS.ProcessEnv): string {
    if (process.platform !== 'win32') {
        return 'PATH';
    }

    return Object.keys(env).find(key => key.toLowerCase() === 'path') || 'Path';
}

function prependPath(env: NodeJS.ProcessEnv, entries: string[]): void {
    const key = pathEnvKey(env);
    const current = env[key] || '';
    const existing = new Set(current.split(path.delimiter).filter(Boolean));
    const usable = entries.filter(entry => entry && fs.existsSync(entry) && !existing.has(entry));

    if (usable.length > 0) {
        env[key] = [...usable, current].filter(Boolean).join(path.delimiter);
    }
}

function detectVersionManager(cwd: string): string | null {
    const checks = [
        { file: '.ruby-version', manager: 'rbenv' },
        { file: '.rvmrc', manager: 'rvm' },
        { file: '.tool-versions', manager: 'asdf' },
        { file: '.mise.toml', manager: 'mise' },
        { file: '.rtx.toml', manager: 'mise' }
    ];

    for (const check of checks) {
        if (fs.existsSync(path.join(cwd, check.file))) {
            return check.manager;
        }
    }

    if (process.env.RBENV_ROOT || process.env.RBENV_VERSION) {
        return 'rbenv';
    }
    if (process.env.rvm_path || process.env.MY_RUBY_HOME) {
        return 'rvm';
    }
    if (process.env.ASDF_DIR) {
        return 'asdf';
    }
    if (process.env.MISE_DATA_DIR) {
        return 'mise';
    }
    if (process.env.RUBY_ROOT) {
        return 'chruby';
    }

    return null;
}

function addVersionManagerPaths(env: NodeJS.ProcessEnv, cwd: string): void {
    const homeDir = os.homedir();
    const versionManager = detectVersionManager(cwd);

    switch (versionManager) {
        case 'rbenv': {
            const rbenvRoot = process.env.RBENV_ROOT || path.join(homeDir, '.rbenv');
            prependPath(env, [path.join(rbenvRoot, 'shims'), path.join(rbenvRoot, 'bin')]);
            break;
        }
        case 'rvm': {
            const rvmPath = process.env.rvm_path || path.join(homeDir, '.rvm');
            prependPath(env, [path.join(rvmPath, 'bin')]);
            break;
        }
        case 'asdf': {
            const asdfDir = process.env.ASDF_DIR || path.join(homeDir, '.asdf');
            prependPath(env, [path.join(asdfDir, 'shims'), path.join(asdfDir, 'bin')]);
            break;
        }
        case 'mise': {
            const miseDataDir = process.env.MISE_DATA_DIR || path.join(homeDir, '.local', 'share', 'mise');
            prependPath(env, [path.join(miseDataDir, 'shims'), path.join(homeDir, '.mise', 'shims')]);
            break;
        }
        case 'chruby':
            if (process.env.RUBY_ROOT) {
                prependPath(env, [path.join(process.env.RUBY_ROOT, 'bin')]);
            }
            break;
    }
}

function isTimeoutError(error: child_process.ExecFileException | null): boolean {
    return !!error && !!error.killed && (
        error.signal === 'SIGTERM' ||
        error.message.toLowerCase().includes('timeout')
    );
}

function resultFromError(
    command: string,
    args: string[],
    cwd: string,
    error: child_process.ExecFileException | null,
    stdout: string,
    stderr: string
): RubyCommandResult {
    const errorCode = error?.code;
    return {
        command,
        args,
        cwd,
        stdout,
        stderr,
        exitCode: typeof errorCode === 'number' ? errorCode : error ? null : 0,
        signal: error?.signal ?? null,
        timedOut: isTimeoutError(error)
    };
}

export function formatRuntimeStatus(status: RubyRuntimeStatus): string {
    const toolLines = (Object.keys(status.tools) as RubyTool[])
        .map(tool => `${tool}: ${status.tools[tool]}`);

    const lines = [
        'RubyMate Runtime Status',
        '',
        `Extension host: ${status.extensionKind}`,
        `Remote: ${status.remoteName}`,
        `Workspace root: ${status.workspaceRoot}`,
        `Platform: ${status.platform}`,
        `Shell: ${status.shell}`,
        '',
        ...toolLines
    ];

    if (status.warnings.length > 0) {
        lines.push('', 'Warnings:', ...status.warnings.map(warning => `- ${warning}`));
    }

    return lines.join('\n');
}

export class RubyRuntime {
    constructor(private readonly outputChannel?: vscode.OutputChannel) {}

    async resolveContext(options: RubyCommandOptions = {}): Promise<RubyRuntimeContext> {
        const workspaceFolder = options.workspaceFolder ||
            (options.documentUri ? vscode.workspace.getWorkspaceFolder(options.documentUri) : undefined) ||
            vscode.workspace.workspaceFolders?.[0];

        const cwd = options.cwd ||
            workspaceFolder?.uri.fsPath ||
            (options.documentUri?.scheme === 'file' ? path.dirname(options.documentUri.fsPath) : undefined) ||
            process.cwd();

        const env: NodeJS.ProcessEnv = { ...process.env };
        addVersionManagerPaths(env, cwd);

        if (options.env) {
            for (const [key, value] of Object.entries(options.env)) {
                if (value === undefined) {
                    delete env[key];
                } else {
                    env[key] = value;
                }
            }
        }

        return {
            workspaceFolder,
            cwd,
            remoteName: vscode.env.remoteName,
            platform: process.platform,
            shell: getShellOptions().shell,
            env
        };
    }

    async getEnvironment(options: RubyCommandOptions = {}): Promise<NodeJS.ProcessEnv> {
        return (await this.resolveContext(options)).env;
    }

    async hasGemfile(options: RubyCommandOptions = {}): Promise<boolean> {
        const context = await this.resolveContext(options);
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(path.join(context.cwd, 'Gemfile')));
            return true;
        } catch {
            return false;
        }
    }

    async isToolAvailable(command: string, options: RubyCommandOptions = {}): Promise<boolean> {
        try {
            await this.exec(command, ['--version'], {
                ...options,
                timeout: options.timeout ?? 5000
            });
            return true;
        } catch {
            return false;
        }
    }

    async shouldUseBundler(options: RubyCommandOptions = {}): Promise<boolean> {
        if (!await this.hasGemfile(options)) {
            return false;
        }

        return this.isToolAvailable('bundle', options);
    }

    async exec(command: string, args: string[], options: RubyCommandOptions = {}): Promise<RubyCommandResult> {
        const context = await this.resolveContext(options);
        const executable = await this.resolveExecutable(command);
        const logPrefix = options.logPrefix || 'runtime';

        this.log(`[${logPrefix}] exec: ${executable} ${args.join(' ')}`);
        this.log(`[${logPrefix}] cwd: ${context.cwd}`);

        return new Promise((resolve, reject) => {
            const child = child_process.execFile(
                executable,
                args,
                {
                    cwd: context.cwd,
                    env: context.env,
                    timeout: options.timeout ?? 30000,
                    encoding: 'utf8',
                    windowsHide: true,
                    shell: options.useShell ?? process.platform === 'win32',
                    maxBuffer: 10 * 1024 * 1024
                },
                (error, stdout, stderr) => {
                    const result = resultFromError(
                        executable,
                        args,
                        context.cwd,
                        error,
                        String(stdout ?? ''),
                        String(stderr ?? '')
                    );

                    if (error && !(options.allowNonZeroExit && result.exitCode !== null)) {
                        reject(Object.assign(error, { result }));
                        return;
                    }

                    resolve(result);
                }
            );

            options.token?.onCancellationRequested(() => {
                child.kill();
            });
        });
    }

    async spawn(command: string, args: string[], options: RubyCommandOptions = {}): Promise<RubyCommandResult> {
        const context = await this.resolveContext(options);
        const executable = await this.resolveExecutable(command);
        const logPrefix = options.logPrefix || 'runtime';

        this.log(`[${logPrefix}] spawn: ${executable} ${args.join(' ')}`);
        this.log(`[${logPrefix}] cwd: ${context.cwd}`);

        return new Promise((resolve, reject) => {
            const child = child_process.spawn(executable, args, {
                cwd: context.cwd,
                env: context.env,
                shell: options.useShell ?? process.platform === 'win32',
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';
            let settled = false;
            let timedOut = false;

            const timeout = setTimeout(() => {
                if (settled) {
                    return;
                }
                timedOut = true;
                child.kill('SIGTERM');
            }, options.timeout ?? 30000);

            child.stdout?.setEncoding('utf8');
            child.stderr?.setEncoding('utf8');

            child.stdout?.on('data', data => {
                stdout += data.toString();
            });

            child.stderr?.on('data', data => {
                stderr += data.toString();
            });

            child.on('error', error => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                const result: RubyCommandResult = {
                    command: executable,
                    args,
                    cwd: context.cwd,
                    stdout,
                    stderr,
                    exitCode: null,
                    signal: null,
                    timedOut
                };
                reject(Object.assign(error, { result }));
            });

            child.on('close', (exitCode, signal) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                const result: RubyCommandResult = {
                    command: executable,
                    args,
                    cwd: context.cwd,
                    stdout,
                    stderr,
                    exitCode,
                    signal,
                    timedOut
                };

                if (exitCode !== 0 && !options.allowNonZeroExit) {
                    reject(Object.assign(
                        new Error(`${executable} exited with code ${exitCode}`),
                        { result }
                    ));
                    return;
                }

                resolve(result);
            });

            options.token?.onCancellationRequested(() => {
                child.kill();
            });

            if (options.input !== undefined) {
                child.stdin?.write(options.input);
            }
            child.stdin?.end();
        });
    }

    async spawnProcess(
        command: string,
        args: string[],
        options: RubyProcessOptions = {}
    ): Promise<child_process.ChildProcess> {
        const context = await this.resolveContext(options);
        const executable = await this.resolveExecutable(command);
        const logPrefix = options.logPrefix || 'runtime';

        this.log(`[${logPrefix}] process: ${executable} ${args.join(' ')}`);
        this.log(`[${logPrefix}] cwd: ${context.cwd}`);

        return child_process.spawn(executable, args, {
            cwd: context.cwd,
            env: context.env,
            shell: options.useShell ?? process.platform === 'win32',
            windowsHide: true,
            stdio: options.stdio ?? ['pipe', 'pipe', 'pipe']
        });
    }

    async execRubyTool(
        tool: RubyTool,
        args: string[],
        options: RubyCommandOptions & { useBundler?: RubyToolUseBundler } = {}
    ): Promise<RubyCommandResult> {
        const invocations = await this.getRubyToolInvocations(tool, args, options);
        let lastError: unknown;

        for (const invocation of invocations) {
            try {
                return await this.exec(invocation.command, invocation.args, {
                    ...options,
                    logPrefix: options.logPrefix || invocation.label
                });
            } catch (error) {
                lastError = error;
                this.log(`[runtime] ${invocation.label} failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        throw lastError;
    }

    async spawnRubyTool(
        tool: RubyTool,
        args: string[],
        options: RubyCommandOptions & { useBundler?: RubyToolUseBundler } = {}
    ): Promise<RubyCommandResult> {
        const [invocation] = await this.getRubyToolInvocations(tool, args, {
            ...options,
            useBundler: options.useBundler ?? false
        });

        return this.spawn(invocation.command, invocation.args, {
            ...options,
            logPrefix: options.logPrefix || invocation.label
        });
    }

    async runCommandInTerminal(
        command: string,
        args: string[],
        options: RubyTerminalOptions = {}
    ): Promise<vscode.Terminal> {
        const context = await this.resolveContext(options);
        const executable = await this.resolveExecutable(command);
        const terminal = vscode.window.createTerminal({
            name: options.name || 'RubyMate',
            cwd: context.cwd,
            env: context.env
        });

        terminal.sendText(buildShellCommand(executable, args, context.platform));

        if (options.show !== false) {
            terminal.show();
        }

        return terminal;
    }

    async runRubyToolInTerminal(
        tool: RubyTool,
        args: string[],
        options: RubyTerminalOptions = {}
    ): Promise<vscode.Terminal> {
        const [invocation] = await this.getRubyToolInvocations(tool, args, {
            ...options,
            useBundler: options.useBundler ?? 'auto'
        });

        return this.runCommandInTerminal(invocation.command, invocation.args, {
            ...options,
            logPrefix: options.logPrefix || invocation.label
        });
    }

    async runBundlerInTerminal(
        args: string[],
        options: RubyTerminalOptions = {}
    ): Promise<vscode.Terminal> {
        return this.runCommandInTerminal('bundle', args, options);
    }

    async runRailsInTerminal(
        args: string[],
        options: RubyTerminalOptions = {}
    ): Promise<vscode.Terminal> {
        return this.runRubyToolInTerminal('rails', args, {
            ...options,
            useBundler: options.useBundler ?? 'auto'
        });
    }

    async getStatus(extensionKind?: vscode.ExtensionKind): Promise<RubyRuntimeStatus> {
        const context = await this.resolveContext();
        const toolNames: RubyTool[] = ['ruby', 'bundle', 'rubocop', 'rails', 'rdbg', 'rspec', 'minitest', 'gem'];
        const toolEntries = await Promise.all(toolNames.map(async tool => {
            const status = await this.describeTool(tool, context.cwd);
            return [tool, status] as const;
        }));
        const warnings: string[] = [];

        if (context.remoteName && extensionKind === vscode.ExtensionKind.UI) {
            warnings.push(
                `RubyMate is running in the UI extension host while the workspace is remote (${context.remoteName}). Reinstall or enable RubyMate on the remote workspace host.`
            );
        }

        return {
            extensionKind: formatExtensionKind(extensionKind),
            remoteName: context.remoteName || 'local',
            workspaceRoot: context.cwd,
            platform: context.platform,
            shell: context.shell,
            tools: Object.fromEntries(toolEntries) as Record<RubyTool, string>,
            warnings
        };
    }

    async showRuntimeStatus(extensionKind?: vscode.ExtensionKind): Promise<void> {
        const status = await this.getStatus(extensionKind);
        const formatted = formatRuntimeStatus(status);

        this.outputChannel?.appendLine('');
        this.outputChannel?.appendLine(formatted);
        this.outputChannel?.show();

        await vscode.window.showInformationMessage(formatted, { modal: true });
    }

    private async describeTool(tool: RubyTool, cwd: string): Promise<string> {
        try {
            const result = tool === 'ruby'
                ? await this.exec('ruby', ['--version'], { cwd, timeout: 5000 })
                : await this.execRubyTool(tool, ['--version'], { cwd, timeout: 5000, useBundler: 'auto' });
            return (result.stdout || result.stderr).trim() || 'available';
        } catch (error) {
            const result = (error as { result?: RubyCommandResult }).result;
            const detail = (result?.stderr || result?.stdout || '').trim();
            return detail ? `missing (${detail})` : 'missing';
        }
    }

    private async getRubyToolInvocations(
        tool: RubyTool,
        args: string[],
        options: RubyCommandOptions & { useBundler?: RubyToolUseBundler }
    ): Promise<RubyToolInvocation[]> {
        const useBundler = options.useBundler ?? 'auto';
        const direct = async (): Promise<RubyToolInvocation> => ({
            command: await this.resolveExecutable(tool),
            args,
            label: tool
        });

        if (tool === 'bundle') {
            return [await direct()];
        }

        if (useBundler === true) {
            return [{
                command: 'bundle',
                args: ['exec', tool, ...args],
                label: `bundle exec ${tool}`
            }];
        }

        if (useBundler === 'auto' && await this.shouldUseBundler(options)) {
            return [
                {
                    command: 'bundle',
                    args: ['exec', tool, ...args],
                    label: `bundle exec ${tool}`
                },
                await direct()
            ];
        }

        return [await direct()];
    }

    private async resolveExecutable(command: string): Promise<string> {
        if (command === 'ruby') {
            return getRubyPath();
        }
        return command;
    }

    private log(message: string): void {
        this.outputChannel?.appendLine(message);
    }
}

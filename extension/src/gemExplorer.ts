import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { RubyRuntime } from './runtime/rubyRuntime';

const readFileAsync = promisify(fs.readFile);
const existsAsync = (p: string) => fs.promises.access(p).then(() => true).catch(() => false);

// ─── Data Types ────────────────────────────────────────────────

export interface GemInfo {
    name: string;
    version: string;
    group: GemGroup;
    description?: string;
    homepage?: string;
    latestVersion?: string;
    isOutdated?: boolean;
    isDirect: boolean; // true if listed in Gemfile (not just transitive)
}

type GemGroup = 'default' | 'development' | 'test' | 'production' | 'transitive';

// ─── Tree Items ────────────────────────────────────────────────

type TreeElement = GemGroupItem | GemTreeItem;

class GemGroupItem extends vscode.TreeItem {
    constructor(
        public readonly group: string,
        public readonly gems: GemInfo[]
    ) {
        super(group, vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${gems.length} gems`;
        this.iconPath = new vscode.ThemeIcon('package');
        this.contextValue = 'gemGroup';
    }
}

class GemTreeItem extends vscode.TreeItem {
    constructor(public readonly gem: GemInfo) {
        super(gem.name, vscode.TreeItemCollapsibleState.None);
        this.description = gem.version;
        this.tooltip = this.buildTooltip();
        this.contextValue = gem.isOutdated ? 'gem.outdated' : 'gem';

        if (gem.isOutdated) {
            this.iconPath = new vscode.ThemeIcon('arrow-up', new vscode.ThemeColor('editorWarning.foreground'));
            this.description = `${gem.version} → ${gem.latestVersion}`;
        } else {
            this.iconPath = new vscode.ThemeIcon('ruby');
        }

        this.command = {
            command: 'rubymate.gems.openSource',
            title: 'Open Gem Source',
            arguments: [gem]
        };
    }

    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${this.gem.name}** v${this.gem.version}\n\n`);
        if (this.gem.description) {
            md.appendMarkdown(`${this.gem.description}\n\n`);
        }
        if (this.gem.isOutdated) {
            md.appendMarkdown(`Update available: **${this.gem.latestVersion}**\n\n`);
        }
        if (this.gem.isDirect) {
            md.appendMarkdown(`_Direct dependency (in Gemfile)_`);
        } else {
            md.appendMarkdown(`_Transitive dependency_`);
        }
        return md;
    }
}

// ─── Gemfile Parser ────────────────────────────────────────────

interface GemfileEntry {
    name: string;
    group: GemGroup;
}

function parseGemfile(content: string): GemfileEntry[] {
    const entries: GemfileEntry[] = [];
    const lines = content.split('\n');
    let currentGroups: GemGroup[] = ['default'];

    for (const rawLine of lines) {
        const line = rawLine.trim();

        // Skip comments and blank lines
        if (!line || line.startsWith('#')) {
            continue;
        }

        // group :development do / group :development, :test do
        const groupMatch = line.match(/^group\s+(.+?)\s+do/);
        if (groupMatch) {
            const groupStr = groupMatch[1];
            const groups = groupStr.match(/:\w+/g);
            if (groups) {
                currentGroups = groups.map(g => g.slice(1) as GemGroup);
            }
            continue;
        }

        // end - close group block
        if (line === 'end') {
            currentGroups = ['default'];
            continue;
        }

        // gem 'name' or gem "name"
        const gemMatch = line.match(/^gem\s+['"]([^'"]+)['"]/);
        if (gemMatch) {
            entries.push({
                name: gemMatch[1],
                group: currentGroups[0]
            });
        }
    }

    return entries;
}

// ─── Gemfile.lock Parser ───────────────────────────────────────

interface LockEntry {
    name: string;
    version: string;
}

function parseGemfileLock(content: string): LockEntry[] {
    const entries: LockEntry[] = [];
    const lines = content.split('\n');
    let inSpecs = false;
    let specsIndent = -1;

    for (const rawLine of lines) {
        const line = rawLine;

        // Section header (GEM, PATH, GIT, PLATFORMS, etc.) — ends any specs block
        if (/^[A-Z]/.test(line)) {
            inSpecs = false;
            specsIndent = -1;
            continue;
        }

        // Look for "specs:" section
        const specsMatch = line.match(/^(\s*)specs:\s*$/);
        if (specsMatch) {
            inSpecs = true;
            specsIndent = specsMatch[1].length;
            continue;
        }

        if (!inSpecs) {
            continue;
        }

        // Gem entry: direct child of the specs block. Bundler lockfiles normally use
        // "  specs:" followed by "    gem (...)", but generated lockfiles can vary.
        const gemMatch = line.match(/^(\s+)(\S+)\s+\(([^)]+)\)/);
        if (gemMatch && gemMatch[1].length === specsIndent + 2) {
            entries.push({
                name: gemMatch[2],
                version: gemMatch[3]
            });
        }
    }

    return entries;
}

// ─── Tree Data Provider ────────────────────────────────────────

export class GemExplorerProvider implements vscode.TreeDataProvider<TreeElement>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private gems: GemInfo[] = [];
    private disposables: vscode.Disposable[] = [];
    private watcher: vscode.FileSystemWatcher | undefined;
    private workspaceRoot: string | undefined;
    private runtime: RubyRuntime;

    constructor(private outputChannel: vscode.OutputChannel, runtime?: RubyRuntime) {
        this.runtime = runtime ?? new RubyRuntime(outputChannel);
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        if (this.workspaceRoot) {
            // Watch for Gemfile / Gemfile.lock changes
            this.watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(this.workspaceRoot, '{Gemfile,Gemfile.lock}')
            );
            this.watcher.onDidChange(() => this.refresh());
            this.watcher.onDidCreate(() => this.refresh());
            this.watcher.onDidDelete(() => this.refresh());
            this.disposables.push(this.watcher);
        }
    }

    async initialize(): Promise<void> {
        await this.loadGems();
    }

    async refresh(): Promise<void> {
        await this.loadGems();
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: TreeElement): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeElement): TreeElement[] {
        if (!element) {
            return this.getGroupItems();
        }
        if (element instanceof GemGroupItem) {
            return element.gems
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(g => new GemTreeItem(g));
        }
        return [];
    }

    private getGroupItems(): GemGroupItem[] {
        const groups = new Map<string, GemInfo[]>();

        for (const gem of this.gems) {
            const groupLabel = gem.isDirect
                ? this.formatGroupLabel(gem.group)
                : 'Transitive Dependencies';
            if (!groups.has(groupLabel)) {
                groups.set(groupLabel, []);
            }
            groups.get(groupLabel)!.push(gem);
        }

        // Sort: direct groups first, transitive last
        const order = ['Default', 'Development', 'Test', 'Production', 'Transitive Dependencies'];
        return Array.from(groups.entries())
            .sort((a, b) => {
                const ai = order.indexOf(a[0]);
                const bi = order.indexOf(b[0]);
                return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
            })
            .map(([group, gems]) => new GemGroupItem(group, gems));
    }

    private formatGroupLabel(group: GemGroup): string {
        return group.charAt(0).toUpperCase() + group.slice(1);
    }

    // ─── Loading ───────────────────────────────────────────────

    private async loadGems(): Promise<void> {
        if (!this.workspaceRoot) {
            this.gems = [];
            return;
        }

        const gemfilePath = path.join(this.workspaceRoot, 'Gemfile');
        const lockfilePath = path.join(this.workspaceRoot, 'Gemfile.lock');

        const [hasGemfile, hasLockfile] = await Promise.all([
            existsAsync(gemfilePath),
            existsAsync(lockfilePath)
        ]);

        if (!hasLockfile) {
            this.gems = [];
            return;
        }

        try {
            const lockContent = await readFileAsync(lockfilePath, 'utf-8');
            const lockEntries = parseGemfileLock(lockContent);

            // Build direct dependency set from Gemfile
            let directDeps = new Map<string, GemfileEntry>();
            if (hasGemfile) {
                const gemfileContent = await readFileAsync(gemfilePath, 'utf-8');
                const gemfileEntries = parseGemfile(gemfileContent);
                directDeps = new Map(gemfileEntries.map(e => [e.name, e]));
            }

            this.gems = lockEntries.map(lock => {
                const direct = directDeps.get(lock.name);
                return {
                    name: lock.name,
                    version: lock.version,
                    group: direct?.group ?? 'transitive',
                    isDirect: !!direct
                };
            });

            this.outputChannel.appendLine(`[GEM EXPLORER] Loaded ${this.gems.length} gems (${directDeps.size} direct)`);
        } catch (error) {
            this.outputChannel.appendLine(`[GEM EXPLORER] Error loading gems: ${error}`);
            this.gems = [];
        }
    }

    // ─── Commands ──────────────────────────────────────────────

    async checkOutdated(): Promise<void> {
        if (!this.workspaceRoot) {
            return;
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'RubyMate: Checking for outdated gems...',
                cancellable: false
            },
            async () => {
                try {
                    // bundle outdated exits non-zero when outdated gems exist,
                    // so we need to handle both success and "expected failure" cases
                    const result = await this.runtime.exec(
                        'bundle',
                        ['outdated', '--parseable'],
                        {
                            cwd: this.workspaceRoot,
                            timeout: 60000,
                            allowNonZeroExit: true,
                            logPrefix: 'bundle outdated'
                        }
                    );

                    if (result.stderr.includes('Could not locate Gemfile')) {
                        vscode.window.showWarningMessage('No Gemfile found in workspace.');
                        return;
                    }

                    const output = result.stdout;

                    // Parse output: "gem-name (newest X.Y.Z, installed A.B.C)"
                    const outdatedMap = new Map<string, string>();
                    for (const line of output.split('\n')) {
                        const match = line.match(/^(\S+)\s+\(newest\s+([^,]+),\s+installed\s+([^)]+)\)/);
                        if (match) {
                            outdatedMap.set(match[1], match[2]);
                        }
                    }

                    // Update gem info
                    for (const gem of this.gems) {
                        const latest = outdatedMap.get(gem.name);
                        if (latest) {
                            gem.latestVersion = latest;
                            gem.isOutdated = true;
                        } else {
                            gem.latestVersion = undefined;
                            gem.isOutdated = false;
                        }
                    }

                    this._onDidChangeTreeData.fire(undefined);

                    const count = outdatedMap.size;
                    if (count > 0) {
                        vscode.window.showInformationMessage(`${count} outdated gem${count > 1 ? 's' : ''} found.`);
                    } else {
                        vscode.window.showInformationMessage('All gems are up to date.');
                    }
                } catch (error: any) {
                    this.outputChannel.appendLine(`[GEM EXPLORER] bundle outdated error: ${error}`);
                    vscode.window.showErrorMessage('Failed to check outdated gems. Is Bundler installed?');
                }
            }
        );
    }

    async runBundleAudit(): Promise<void> {
        if (!this.workspaceRoot) {
            return;
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'RubyMate: Running security audit...',
                cancellable: false
            },
            async () => {
                try {
                    const result = await this.runtime.exec(
                        'bundle',
                        ['audit', 'check', '--update'],
                        {
                            cwd: this.workspaceRoot,
                            timeout: 60000,
                            allowNonZeroExit: true,
                            logPrefix: 'bundle audit'
                        }
                    );
                    const stdout = result.stdout;
                    const stderr = result.stderr;

                    if (result.exitCode === 0 && stdout.includes('No vulnerabilities found')) {
                        vscode.window.showInformationMessage('No known vulnerabilities found.');
                    } else if (stdout && (stdout.includes('Vulnerabilities found') || stdout.includes('Advisory:'))) {
                        // Show results in output channel
                        this.outputChannel.appendLine('\n=== Bundle Audit Results ===');
                        this.outputChannel.appendLine(stdout);
                        this.outputChannel.show();
                        vscode.window.showWarningMessage(
                            'Vulnerabilities found! Check RubyMate output for details.',
                            'Show Output'
                        ).then(choice => {
                            if (choice === 'Show Output') {
                                this.outputChannel.show();
                            }
                        });
                    } else if (stderr.includes('command not found') || stderr.includes('Could not find command')) {
                        vscode.window.showErrorMessage(
                            'bundle-audit not installed. Run: gem install bundler-audit',
                            'Install Now'
                        ).then(choice => {
                            if (choice === 'Install Now') {
                                this.runtime.runCommandInTerminal('gem', ['install', 'bundler-audit'], {
                                    name: 'RubyMate',
                                    cwd: this.workspaceRoot
                                });
                            }
                        });
                    } else if (result.exitCode !== 0) {
                        this.outputChannel.appendLine(`[GEM EXPLORER] bundle audit error: ${stderr || stdout}`);
                        vscode.window.showErrorMessage('Failed to run security audit.');
                    } else {
                        vscode.window.showInformationMessage('No known vulnerabilities found.');
                    }
                } catch (error: any) {
                    const stderr = error.stderr || '';
                    const stdout = error.stdout || '';

                    // bundle audit exits non-zero when vulnerabilities are found
                    if (stdout && (stdout.includes('Vulnerabilities found') || stdout.includes('Advisory:'))) {
                        this.outputChannel.appendLine('\n=== Bundle Audit Results ===');
                        this.outputChannel.appendLine(stdout);
                        this.outputChannel.show();
                        vscode.window.showWarningMessage(
                            'Vulnerabilities found! Check RubyMate output for details.',
                            'Show Output'
                        ).then(choice => {
                            if (choice === 'Show Output') {
                                this.outputChannel.show();
                            }
                        });
                    } else if (stderr.includes('command not found') || stderr.includes('Could not find command')) {
                        vscode.window.showErrorMessage(
                            'bundle-audit not installed. Run: gem install bundler-audit',
                            'Install Now'
                        ).then(choice => {
                            if (choice === 'Install Now') {
                                this.runtime.runCommandInTerminal('gem', ['install', 'bundler-audit'], {
                                    name: 'RubyMate',
                                    cwd: this.workspaceRoot
                                });
                            }
                        });
                    } else {
                        this.outputChannel.appendLine(`[GEM EXPLORER] bundle audit error: ${error}`);
                        vscode.window.showErrorMessage('Failed to run security audit.');
                    }
                }
            }
        );
    }

    openGemOnRubyGems(gem: GemInfo): void {
        vscode.env.openExternal(vscode.Uri.parse(`https://rubygems.org/gems/${gem.name}`));
    }

    async openGemSource(gem: GemInfo): Promise<void> {
        if (!this.workspaceRoot) {
            return;
        }

        try {
            const { stdout } = await this.runtime.exec('bundle', ['info', gem.name, '--path'], {
                cwd: this.workspaceRoot,
                timeout: 10000,
                logPrefix: 'bundle info'
            });

            const gemPath = stdout.trim();
            if (!gemPath || !await existsAsync(gemPath)) {
                vscode.window.showWarningMessage(`Could not find local source for ${gem.name}`);
                return;
            }

            // Try to open the main lib file, fall back to gemspec or README
            const candidates = [
                path.join(gemPath, 'lib', `${gem.name.replace(/-/g, '/')}.rb`),
                path.join(gemPath, 'lib', `${gem.name}.rb`),
                path.join(gemPath, `${gem.name}.gemspec`),
                path.join(gemPath, 'README.md')
            ];

            for (const candidate of candidates) {
                if (await existsAsync(candidate)) {
                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(candidate));
                    await vscode.window.showTextDocument(doc);
                    return;
                }
            }

            // Last resort: open the gem directory listing via quick pick
            const files = await fs.promises.readdir(gemPath);
            const picked = await vscode.window.showQuickPick(files, {
                placeHolder: `Browse ${gem.name} source files`
            });
            if (picked) {
                const doc = await vscode.workspace.openTextDocument(
                    vscode.Uri.file(path.join(gemPath, picked))
                );
                await vscode.window.showTextDocument(doc);
            }
        } catch {
            vscode.window.showWarningMessage(`Could not locate source for ${gem.name}. Is it installed?`);
        }
    }

    async bundleUpdate(gem?: GemInfo): Promise<void> {
        if (gem) {
            await this.runtime.runBundlerInTerminal(['update', gem.name], {
                name: 'RubyMate',
                cwd: this.workspaceRoot
            });
        } else {
            await this.runtime.runBundlerInTerminal(['update'], {
                name: 'RubyMate',
                cwd: this.workspaceRoot
            });
        }
    }

    async bundleInstall(): Promise<void> {
        await this.runtime.runBundlerInTerminal(['install'], {
            name: 'RubyMate',
            cwd: this.workspaceRoot
        });
    }

    // ─── Registration ──────────────────────────────────────────

    registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.gems.refresh', () => this.refresh()),
            vscode.commands.registerCommand('rubymate.gems.checkOutdated', () => this.checkOutdated()),
            vscode.commands.registerCommand('rubymate.gems.bundleAudit', () => this.runBundleAudit()),
            vscode.commands.registerCommand('rubymate.gems.openRubyGems', (item: GemTreeItem) => {
                if (item?.gem) {
                    this.openGemOnRubyGems(item.gem);
                }
            }),
            vscode.commands.registerCommand('rubymate.gems.openSource', (gem: GemInfo) => {
                this.openGemSource(gem);
            }),
            vscode.commands.registerCommand('rubymate.gems.openSourceFromTree', (item: GemTreeItem) => {
                if (item?.gem) {
                    this.openGemSource(item.gem);
                }
            }),
            vscode.commands.registerCommand('rubymate.gems.bundleUpdate', (item?: GemTreeItem) => {
                this.bundleUpdate(item?.gem);
            }),
            vscode.commands.registerCommand('rubymate.gems.bundleInstall', () => this.bundleInstall()),
            vscode.commands.registerCommand('rubymate.gems.copyName', (item: GemTreeItem) => {
                if (item?.gem) {
                    vscode.env.clipboard.writeText(item.gem.name);
                    vscode.window.showInformationMessage(`Copied "${item.gem.name}" to clipboard`);
                }
            }),
            vscode.commands.registerCommand('rubymate.gems.copyVersion', (item: GemTreeItem) => {
                if (item?.gem) {
                    const text = `gem '${item.gem.name}', '~> ${item.gem.version}'`;
                    vscode.env.clipboard.writeText(text);
                    vscode.window.showInformationMessage(`Copied "${text}" to clipboard`);
                }
            })
        );
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this._onDidChangeTreeData.dispose();
    }
}

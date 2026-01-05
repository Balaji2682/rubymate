import * as vscode from 'vscode';

/**
 * Status bar states for the RubyMate extension
 */
export enum ExtensionState {
    Initializing = 'initializing',
    Ready = 'ready',
    Indexing = 'indexing',
    Error = 'error',
    Disabled = 'disabled'
}

/**
 * Manages the RubyMate status bar item with state indicator and quick actions
 */
export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private currentState: ExtensionState = ExtensionState.Initializing;
    private outputChannel: vscode.OutputChannel;

    // Icons for different states
    private readonly stateIcons = {
        [ExtensionState.Initializing]: '$(loading~spin)',
        [ExtensionState.Ready]: '$(ruby)',
        [ExtensionState.Indexing]: '$(sync~spin)',
        [ExtensionState.Error]: '$(warning)',
        [ExtensionState.Disabled]: '$(circle-slash)'
    };

    // Colors for different states
    private readonly stateColors = {
        [ExtensionState.Initializing]: undefined,
        [ExtensionState.Ready]: undefined,
        [ExtensionState.Indexing]: new vscode.ThemeColor('statusBarItem.warningBackground'),
        [ExtensionState.Error]: new vscode.ThemeColor('statusBarItem.errorBackground'),
        [ExtensionState.Disabled]: undefined
    };

    // Tooltips for different states
    private readonly stateTooltips = {
        [ExtensionState.Initializing]: 'RubyMate is initializing...',
        [ExtensionState.Ready]: 'RubyMate is ready - Click for commands',
        [ExtensionState.Indexing]: 'RubyMate is indexing workspace...',
        [ExtensionState.Error]: 'RubyMate encountered an error - Click for details',
        [ExtensionState.Disabled]: 'RubyMate is disabled'
    };

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;

        // Create status bar item (right side, priority 100)
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );

        // Set up click command to show quick menu
        this.statusBarItem.command = 'rubymate.showStatusBarMenu';

        // Show the status bar item
        this.statusBarItem.show();

        // Initialize with starting state
        this.updateStatusBar(ExtensionState.Initializing);
    }

    /**
     * Update the status bar with a new state
     */
    updateStatusBar(state: ExtensionState, customMessage?: string): void {
        this.currentState = state;

        const icon = this.stateIcons[state];
        const message = customMessage || 'RubyMate';

        this.statusBarItem.text = `${icon} ${message}`;
        this.statusBarItem.tooltip = this.stateTooltips[state];
        this.statusBarItem.backgroundColor = this.stateColors[state];

        this.outputChannel.appendLine(`Status bar updated: ${state}${customMessage ? ` - ${customMessage}` : ''}`);
    }

    /**
     * Set status to Ready
     */
    setReady(): void {
        this.updateStatusBar(ExtensionState.Ready);
    }

    /**
     * Set status to Indexing with optional progress message
     */
    setIndexing(message?: string): void {
        this.updateStatusBar(ExtensionState.Indexing, message || 'Indexing...');
    }

    /**
     * Set status to Error with optional error message
     */
    setError(message?: string): void {
        this.updateStatusBar(ExtensionState.Error, message || 'Error');
    }

    /**
     * Set status to Disabled
     */
    setDisabled(): void {
        this.updateStatusBar(ExtensionState.Disabled);
    }

    /**
     * Show the quick actions menu
     */
    async showQuickMenu(): Promise<void> {
        const items: vscode.QuickPickItem[] = [
            {
                label: '$(search) Search Everywhere',
                description: 'Search for classes, methods, and symbols',
                detail: 'Keyboard: Alt+Shift+S'
            },
            {
                label: '$(symbol-class) Go to Class',
                description: 'Navigate to a Ruby class'
            },
            {
                label: '$(file-code) File Structure',
                description: 'View current file structure',
                detail: 'Keyboard: Alt+Shift+F'
            },
            {
                label: '$(link) Navigate to Related',
                description: 'Switch between model/controller/view/spec',
                detail: 'Keyboard: Alt+Shift+R'
            },
            {
                label: '',
                kind: vscode.QuickPickItemKind.Separator,
                description: 'Rails Commands'
            },
            {
                label: '$(ruby) Rails Commands',
                description: 'Show all Rails commands'
            },
            {
                label: '$(database) Database Commands',
                description: 'Schema, migrations, and queries'
            },
            {
                label: '',
                kind: vscode.QuickPickItemKind.Separator,
                description: 'Maintenance'
            },
            {
                label: '$(refresh) Re-index Workspace',
                description: 'Rebuild the symbol index'
            },
            {
                label: '$(graph) Show Index Statistics',
                description: 'View indexing stats and performance'
            },
            {
                label: '$(check) Validate Configuration',
                description: 'Check Ruby path and settings'
            },
            {
                label: '',
                kind: vscode.QuickPickItemKind.Separator,
                description: 'Help & Resources'
            },
            {
                label: '$(book) Documentation',
                description: 'Open GitHub documentation'
            },
            {
                label: '$(github) View on GitHub',
                description: 'Open GitHub repository'
            },
            {
                label: '$(comment) Report Issue',
                description: 'Report a bug or request a feature'
            },
            {
                label: '$(output) Show Output',
                description: 'View extension logs'
            }
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'RubyMate - Select a command',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (!selected) {
            return;
        }

        // Execute the selected command
        await this.executeQuickMenuItem(selected.label);
    }

    /**
     * Execute the command for a quick menu item
     */
    private async executeQuickMenuItem(label: string): Promise<void> {
        switch (label) {
            case '$(search) Search Everywhere':
                await vscode.commands.executeCommand('rubymate.searchEverywhere');
                break;
            case '$(symbol-class) Go to Class':
                await vscode.commands.executeCommand('rubymate.goToClass');
                break;
            case '$(file-code) File Structure':
                await vscode.commands.executeCommand('rubymate.fileStructure');
                break;
            case '$(link) Navigate to Related':
                await vscode.commands.executeCommand('rubymate.navigateToRelated');
                break;
            case '$(ruby) Rails Commands':
                await vscode.commands.executeCommand('rubymate.rails.showCommands');
                break;
            case '$(database) Database Commands':
                await this.showDatabaseCommands();
                break;
            case '$(refresh) Re-index Workspace':
                await vscode.commands.executeCommand('rubymate.reindexWorkspace');
                break;
            case '$(graph) Show Index Statistics':
                await vscode.commands.executeCommand('rubymate.showIndexStats');
                break;
            case '$(check) Validate Configuration':
                await vscode.commands.executeCommand('rubymate.validateConfiguration');
                break;
            case '$(book) Documentation':
                await vscode.env.openExternal(
                    vscode.Uri.parse('https://github.com/yourusername/rubymate#readme')
                );
                break;
            case '$(github) View on GitHub':
                await vscode.env.openExternal(
                    vscode.Uri.parse('https://github.com/yourusername/rubymate')
                );
                break;
            case '$(comment) Report Issue':
                await vscode.env.openExternal(
                    vscode.Uri.parse('https://github.com/yourusername/rubymate/issues/new')
                );
                break;
            case '$(output) Show Output':
                this.outputChannel.show();
                break;
        }
    }

    /**
     * Show database commands submenu
     */
    private async showDatabaseCommands(): Promise<void> {
        const items: vscode.QuickPickItem[] = [
            {
                label: '$(database) Show Schema',
                description: 'View database schema visualization'
            },
            {
                label: '$(go-to-file) Go to Table Definition',
                description: 'Jump to table in schema.rb'
            },
            {
                label: '$(play) Run Selected Query',
                description: 'Execute SQL query in terminal'
            },
            {
                label: '$(list-tree) Show Table Columns',
                description: 'View columns for a table'
            }
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Database Commands - Select an action'
        });

        if (!selected) {
            return;
        }

        switch (selected.label) {
            case '$(database) Show Schema':
                await vscode.commands.executeCommand('rubymate.database.showSchema');
                break;
            case '$(go-to-file) Go to Table Definition':
                await vscode.commands.executeCommand('rubymate.database.goToTable');
                break;
            case '$(play) Run Selected Query':
                await vscode.commands.executeCommand('rubymate.database.runQuery');
                break;
            case '$(list-tree) Show Table Columns':
                await vscode.commands.executeCommand('rubymate.database.showTableColumns');
                break;
        }
    }

    /**
     * Update status bar with custom text temporarily
     */
    showTemporaryMessage(message: string, durationMs: number = 3000): void {
        const originalState = this.currentState;
        this.updateStatusBar(this.currentState, message);

        setTimeout(() => {
            this.updateStatusBar(originalState);
        }, durationMs);
    }

    /**
     * Get current state
     */
    getState(): ExtensionState {
        return this.currentState;
    }

    /**
     * Dispose of the status bar item
     */
    dispose(): void {
        this.statusBarItem.dispose();
    }
}

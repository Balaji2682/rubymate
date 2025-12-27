import * as vscode from 'vscode';
import * as path from 'path';
import { startLanguageClient, stopLanguageClient } from './languageClient';
import { SymbolIndexer } from './symbolIndexer';
import { NavigationCommands } from './commands/navigation';
import { RailsCommands } from './commands/rails';
import { RubyWorkspaceSymbolProvider } from './providers/workspaceSymbolProvider';
import { RubyDocumentSymbolProvider } from './providers/documentSymbolProvider';
import { RubyDebugConfigurationProvider, RubyDebugAdapterDescriptorFactory, DebugSessionManager } from './debugAdapter';
import { RubyTestExplorer } from './testExplorer';

let outputChannel: vscode.OutputChannel;
let symbolIndexer: SymbolIndexer;
let navigationCommands: NavigationCommands;
let railsCommands: RailsCommands;
let debugSessionManager: DebugSessionManager;
let railsStatusBar: vscode.StatusBarItem;
let testExplorer: RubyTestExplorer;

export async function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('RubyMate');
    outputChannel.appendLine('RubyMate extension is now active');

    // Initialize symbol indexer
    symbolIndexer = new SymbolIndexer(outputChannel);

    // Initialize navigation commands
    navigationCommands = new NavigationCommands(symbolIndexer, outputChannel);

    // Initialize Rails commands
    railsCommands = new RailsCommands(outputChannel);

    // Check if this is a Rails project and show status bar
    const isRailsProject = await checkRailsProject();
    if (isRailsProject) {
        railsStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        railsStatusBar.text = '$(ruby) Rails';
        railsStatusBar.tooltip = 'Ruby on Rails project detected';
        railsStatusBar.command = 'rubymate.rails.showCommands';
        railsStatusBar.show();
        context.subscriptions.push(railsStatusBar);
    }

    // Start language server client
    try {
        await startLanguageClient(context, outputChannel);
        outputChannel.appendLine('Language server started successfully');
    } catch (error) {
        outputChannel.appendLine(`Failed to start language server: ${error}`);
        vscode.window.showErrorMessage('Failed to start RubyMate language server. Please ensure Ruby and required gems are installed.');
    }

    // Register providers
    registerProviders(context);

    // Register debug providers
    registerDebugProviders(context);

    // Register commands
    registerCommands(context);
    navigationCommands.registerCommands(context);

    // Register Rails commands if Rails project
    if (isRailsProject) {
        railsCommands.registerCommands(context);
        outputChannel.appendLine('Rails commands registered');
    }

    // Initialize test explorer
    testExplorer = new RubyTestExplorer(outputChannel);
    context.subscriptions.push(testExplorer);
    outputChannel.appendLine('Test explorer initialized');

    // Index workspace symbols
    indexWorkspace(context);

    // Watch for file changes to re-index
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.rb');
    watcher.onDidChange(uri => symbolIndexer.indexFile(uri));
    watcher.onDidCreate(uri => symbolIndexer.indexFile(uri));
    watcher.onDidDelete(uri => {
        // File deleted - could remove from index
    });
    context.subscriptions.push(watcher);

    outputChannel.appendLine('All RubyMate features initialized');
}

export async function deactivate() {
    if (outputChannel) {
        outputChannel.appendLine('RubyMate extension is deactivating');
    }

    if (symbolIndexer) {
        symbolIndexer.dispose();
    }

    if (debugSessionManager) {
        debugSessionManager.dispose();
    }

    if (railsStatusBar) {
        railsStatusBar.dispose();
    }

    if (testExplorer) {
        testExplorer.dispose();
    }

    await stopLanguageClient();
}

async function checkRailsProject(): Promise<boolean> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return false;
    }

    const railsIndicators = [
        'config/application.rb',
        'bin/rails',
        'Rakefile'
    ];

    for (const indicator of railsIndicators) {
        const indicatorPath = path.join(workspaceFolder.uri.fsPath, indicator);
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(indicatorPath));
            return true;
        } catch {
            // File doesn't exist, continue checking
        }
    }

    return false;
}

function registerProviders(context: vscode.ExtensionContext) {
    // Workspace symbol provider for Ctrl+T / Cmd+T
    const workspaceSymbolProvider = new RubyWorkspaceSymbolProvider(symbolIndexer);
    context.subscriptions.push(
        vscode.languages.registerWorkspaceSymbolProvider(workspaceSymbolProvider)
    );

    // Document symbol provider for outline and breadcrumbs
    const documentSymbolProvider = new RubyDocumentSymbolProvider(symbolIndexer);
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            { language: 'ruby' },
            documentSymbolProvider
        )
    );

    outputChannel.appendLine('Symbol providers registered');
}

function registerDebugProviders(context: vscode.ExtensionContext) {
    // Debug configuration provider
    const debugConfigProvider = new RubyDebugConfigurationProvider(outputChannel);
    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('ruby', debugConfigProvider)
    );

    // Debug adapter descriptor factory
    const debugAdapterFactory = new RubyDebugAdapterDescriptorFactory(outputChannel);
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory('ruby', debugAdapterFactory)
    );

    // Debug session manager
    debugSessionManager = new DebugSessionManager(outputChannel);
    debugSessionManager.register(context);

    outputChannel.appendLine('Debug providers registered');
}

async function indexWorkspace(context: vscode.ExtensionContext) {
    // Show progress during initial indexing
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'RubyMate: Indexing workspace',
            cancellable: false
        },
        async (progress) => {
            progress.report({ message: 'Finding Ruby files...' });
            await symbolIndexer.indexWorkspace();
            progress.report({ message: 'Done!' });
        }
    );
}

function registerCommands(context: vscode.ExtensionContext) {
    // Run single test command
    const runTestCommand = vscode.commands.registerCommand('rubymate.runTest', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const config = vscode.workspace.getConfiguration('rubymate');
        const testFramework = config.get<string>('testFramework', 'auto');
        const currentFile = editor.document.uri.fsPath;
        const currentLine = editor.selection.active.line + 1;

        const terminal = vscode.window.createTerminal('RubyMate Test');

        if (testFramework === 'rspec' || currentFile.includes('_spec.rb')) {
            terminal.sendText(`rspec ${currentFile}:${currentLine}`);
        } else if (testFramework === 'minitest') {
            terminal.sendText(`ruby ${currentFile} --name /test_/`);
        }

        terminal.show();
    });

    // Run test file command
    const runTestFileCommand = vscode.commands.registerCommand('rubymate.runTestFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const currentFile = editor.document.uri.fsPath;
        const terminal = vscode.window.createTerminal('RubyMate Test');

        if (currentFile.includes('_spec.rb')) {
            terminal.sendText(`rspec ${currentFile}`);
        } else if (currentFile.includes('_test.rb')) {
            terminal.sendText(`ruby ${currentFile}`);
        }

        terminal.show();
    });

    // Start debugger command
    const startDebuggerCommand = vscode.commands.registerCommand('rubymate.startDebugger', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const currentFile = editor.document.uri.fsPath;

        await vscode.debug.startDebugging(undefined, {
            type: 'ruby',
            request: 'launch',
            name: 'Debug Current File',
            program: currentFile,
            cwd: vscode.workspace.workspaceFolders?.[0].uri.fsPath
        });
    });

    // Re-index workspace command
    const reindexCommand = vscode.commands.registerCommand('rubymate.reindexWorkspace', async () => {
        await indexWorkspace(context);
        vscode.window.showInformationMessage('RubyMate: Workspace re-indexed');
    });

    // Show Rails commands palette
    const showRailsCommandsCommand = vscode.commands.registerCommand('rubymate.rails.showCommands', async () => {
        const commands = [
            { label: '$(symbol-class) Navigate to Model', command: 'rubymate.rails.navigateToModel' },
            { label: '$(symbol-method) Navigate to Controller', command: 'rubymate.rails.navigateToController' },
            { label: '$(file-code) Navigate to View', command: 'rubymate.rails.navigateToView' },
            { label: '$(database) Navigate to Migration', command: 'rubymate.rails.navigateToMigration' },
            { label: '$(beaker) Navigate to Spec', command: 'rubymate.rails.navigateToSpec' },
            { label: '$(list-tree) Show Routes', command: 'rubymate.rails.showRoutes' },
            { label: '$(search) Go to Route', command: 'rubymate.rails.goToRoute' },
            { label: '$(add) Generate Model', command: 'rubymate.rails.generateModel' },
            { label: '$(add) Generate Controller', command: 'rubymate.rails.generateController' },
            { label: '$(add) Generate Migration', command: 'rubymate.rails.generateMigration' },
            { label: '$(add) Generate Scaffold', command: 'rubymate.rails.generateScaffold' },
            { label: '$(terminal) Open Rails Console', command: 'rubymate.rails.openConsole' },
            { label: '$(database) Show Schema', command: 'rubymate.rails.showSchema' },
            { label: '$(go-to-file) Go to Table Definition', command: 'rubymate.rails.goToTableDefinition' },
            { label: '$(play) Run Migrations', command: 'rubymate.rails.runMigrations' },
            { label: '$(debug-reverse-continue) Rollback Migration', command: 'rubymate.rails.rollbackMigration' },
            { label: '$(symbol-namespace) Go to Concern', command: 'rubymate.rails.goToConcern' }
        ];

        const selected = await vscode.window.showQuickPick(commands, {
            placeHolder: 'Select a Rails command'
        });

        if (selected) {
            vscode.commands.executeCommand(selected.command);
        }
    });

    context.subscriptions.push(
        runTestCommand,
        runTestFileCommand,
        startDebuggerCommand,
        reindexCommand,
        showRailsCommandsCommand
    );
}

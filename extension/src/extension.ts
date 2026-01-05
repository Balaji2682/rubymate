import * as vscode from 'vscode';
import * as path from 'path';
// NOTE: ruby-lsp integration removed due to compatibility issues
// Using custom indexers and providers instead (advancedIndexer, intelligentIndexer, etc.)
// import { startLanguageClient, stopLanguageClient } from './languageClient';
import { AdvancedRubyIndexer } from './advancedIndexer';
import { NavigationCommands } from './commands/navigation';
import { RubyWorkspaceSymbolProvider } from './providers/workspaceSymbolProvider';
import { RubyDocumentSymbolProvider } from './providers/documentSymbolProvider';
import { SchemaParser } from './database/schemaParser';
import { SQLCompletionProvider, ActiveRecordCompletionProvider } from './database/sqlCompletionProvider';
import { NPlusOneDetector } from './database/n+1Detector';
import { DatabaseCommands } from './database/databaseCommands';
import { IntelligentIndexer } from './indexing/intelligentIndexer';
import { IntelligentNavigationCommands } from './commands/intelligentNavigation';
import { RubyDefinitionProvider } from './providers/rubyDefinitionProvider';
import { RubyReferenceProvider } from './providers/referenceProvider';
import { RubyHoverProvider } from './providers/hoverProvider';
import { RubyTypeHierarchyProvider } from './providers/typeHierarchyProvider';
import { RubyCallHierarchyProvider } from './providers/callHierarchyProvider';
import { RubyFormattingProvider } from './providers/rubyFormattingProvider';
import { RubyAutoEndProvider, RubyAutoEndOnEnterProvider } from './providers/rubyAutoEndProvider';
import { ConfigValidator } from './configValidator';
import { StatusBarManager, ExtensionState } from './statusBarManager';
import { TelemetryManager } from './telemetryManager';

// Lazy-loaded imports (loaded on-demand)
// import { RailsCommands } from './commands/rails'; // Lazy loaded
// import { RubyTestExplorer } from './testExplorer'; // Lazy loaded
// import { RubyDebugConfigurationProvider, RubyDebugAdapterDescriptorFactory, DebugSessionManager } from './debugAdapter'; // Lazy loaded

let outputChannel: vscode.OutputChannel;
let symbolIndexer: AdvancedRubyIndexer;
let navigationCommands: NavigationCommands;
let railsCommands: any; // Lazy loaded
let debugSessionManager: any; // Lazy loaded
let railsStatusBar: vscode.StatusBarItem;
let testExplorer: any; // Lazy loaded
let railsCommandsLoaded = false;
let testExplorerLoaded = false;
let debugProvidersLoaded = false;
let extensionContext: vscode.ExtensionContext; // Store context for lazy loaders

// Configuration validation
let configValidator: ConfigValidator;

// Status bar
let statusBarManager: StatusBarManager;

// Telemetry (privacy-respecting)
let telemetryManager: TelemetryManager;

// Database features
let schemaParser: SchemaParser;
let nPlusOneDetector: NPlusOneDetector;
let databaseCommands: DatabaseCommands;

// Intelligent indexing
let intelligentIndexer: IntelligentIndexer;
let intelligentNavigationCommands: IntelligentNavigationCommands;

export async function activate(context: vscode.ExtensionContext) {
    const startTime = Date.now();
    extensionContext = context; // Store for lazy loaders
    outputChannel = vscode.window.createOutputChannel('RubyMate');
    outputChannel.appendLine('RubyMate extension is now active');

    // Initialize status bar (shows initializing state)
    statusBarManager = new StatusBarManager(outputChannel);
    context.subscriptions.push(statusBarManager);

    // Initialize telemetry (privacy-respecting, local storage)
    telemetryManager = new TelemetryManager(context, outputChannel);
    context.subscriptions.push({
        dispose: async () => {
            // FIX: Properly await async dispose
            await telemetryManager.dispose();
        }
    });

    // ========== PHASE 0: Configuration Validation (Critical) ==========
    // Validate configuration before initializing other features
    configValidator = new ConfigValidator(outputChannel);
    const validationResult = await configValidator.validateAll();

    // Show validation errors/warnings to user
    await configValidator.showValidationErrors(validationResult);

    // Don't block activation on validation errors, but log them
    if (!validationResult.valid) {
        outputChannel.appendLine('⚠ Extension activated with configuration errors. Some features may not work correctly.');
    }

    // Watch for configuration changes and re-validate
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (event.affectsConfiguration('rubymate')) {
                outputChannel.appendLine('Configuration changed, re-validating...');
                configValidator.clearCache(); // Clear cache to force re-validation
                const newValidationResult = await configValidator.validateAll();
                await configValidator.showValidationErrors(newValidationResult);

                // If rubyPath changed, suggest reloading window
                if (event.affectsConfiguration('rubymate.rubyPath') && newValidationResult.valid) {
                    const selection = await vscode.window.showInformationMessage(
                        'Ruby path changed. Reload the window for changes to take effect?',
                        'Reload Window',
                        'Later'
                    );
                    if (selection === 'Reload Window') {
                        vscode.commands.executeCommand('workbench.action.reloadWindow');
                    }
                }
            }
        })
    );

    // ========== PHASE 1: Core Features (Immediate) ==========
    // Initialize advanced symbol indexer with persistent caching
    symbolIndexer = new AdvancedRubyIndexer(context, outputChannel);
    await symbolIndexer.initialize(); // Load cache from disk

    // Initialize navigation commands (lightweight, core feature)
    navigationCommands = new NavigationCommands(symbolIndexer, outputChannel);

    // NOTE: ruby-lsp language server integration is disabled
    // Using custom providers instead due to ruby-lsp compatibility issues
    // See: advancedIndexer.ts, intelligentIndexer.ts for custom implementation

    // Register providers (lightweight)
    registerProviders(context);

    // Register core commands (lightweight)
    registerCommands(context);
    navigationCommands.registerCommands(context);

    // ========== DATABASE FEATURES ==========
    // Initialize database features (Rails projects)
    await initializeDatabaseFeatures(context);

    // ========== INTELLIGENT INDEXING ==========
    // Initialize intelligent semantic indexer
    await initializeIntelligentIndexing(context);

    // ========== PHASE 2: Rails Features (Lazy - if Rails project) ==========
    const isRailsProject = await checkRailsProject();
    if (isRailsProject) {
        // Show status bar immediately
        railsStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        railsStatusBar.text = '$(ruby) Rails';
        railsStatusBar.tooltip = 'Ruby on Rails project detected';
        railsStatusBar.command = 'rubymate.rails.showCommands';
        railsStatusBar.show();
        context.subscriptions.push(railsStatusBar);

        // Load Rails commands in background (don't await - loads asynchronously)
        loadRailsCommandsAsync(context).catch(err => {
            outputChannel.appendLine(`Failed to load Rails commands: ${err}`);
        });
    }

    // ========== PHASE 3: Debug Providers (Lazy - on first debug) ==========
    // Register debug providers lazily (will be loaded when debugging starts)
    registerDebugProvidersLazy(context);

    // ========== PHASE 4: Workspace Indexing (Background) ==========
    // Index workspace symbols in background (don't block activation)
    statusBarManager.setIndexing('Indexing workspace...');
    telemetryManager.startPerformance('workspace-indexing');

    // Wrap indexing with timeout to prevent infinite loading
    const indexingTimeout = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Indexing timeout after 60 seconds')), 60000);
    });

    Promise.race([indexWorkspace(context), indexingTimeout])
        .then(() => {
            telemetryManager.endPerformance('workspace-indexing');
            statusBarManager.setReady();
            outputChannel.appendLine('Workspace indexing completed successfully');
        })
        .catch(err => {
            outputChannel.appendLine(`Failed to index workspace: ${err}`);
            telemetryManager.trackError('workspace-indexing-failed', 'indexing', err);
            statusBarManager.setReady(); // Set to ready even on error to stop spinning
            vscode.window.showWarningMessage(
                `RubyMate: Workspace indexing ${err.message?.includes('timeout') ? 'timed out' : 'failed'}. Some features may be limited.`
            );
        });

    // Watch for file changes to re-index
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.rb');
    watcher.onDidChange(uri => symbolIndexer.indexFile(uri));
    watcher.onDidCreate(uri => symbolIndexer.indexFile(uri));
    watcher.onDidDelete(uri => {
        // File deleted - could remove from index
    });
    context.subscriptions.push(watcher);

    const activationTime = Date.now() - startTime;
    outputChannel.appendLine(`RubyMate activated in ${activationTime}ms (lazy loading enabled)`);

    // Show temporary success message in status bar
    statusBarManager.showTemporaryMessage(`Ready! (${activationTime}ms)`, 3000);
}

// ========== Database Features Initialization ==========

async function initializeDatabaseFeatures(context: vscode.ExtensionContext): Promise<void> {
    try {
        // Initialize schema parser
        schemaParser = new SchemaParser(outputChannel);
        await schemaParser.parseSchema();

        // Initialize N+1 detector
        nPlusOneDetector = new NPlusOneDetector(schemaParser);

        // Initialize database commands
        databaseCommands = new DatabaseCommands(schemaParser, outputChannel);
        databaseCommands.registerCommands(context);

        // Register SQL completion provider
        const sqlCompletionProvider = new SQLCompletionProvider(schemaParser);
        context.subscriptions.push(
            vscode.languages.registerCompletionItemProvider(
                { language: 'ruby' },
                sqlCompletionProvider,
                '"', "'", '.', ' '
            )
        );

        // Register ActiveRecord completion provider
        const activeRecordCompletionProvider = new ActiveRecordCompletionProvider(schemaParser);
        context.subscriptions.push(
            vscode.languages.registerCompletionItemProvider(
                { language: 'ruby' },
                activeRecordCompletionProvider,
                ':', ' ', '('
            )
        );

        // Enable N+1 query detection on open and save
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(doc => {
                if (doc.languageId === 'ruby') {
                    nPlusOneDetector.analyzeDocument(doc);
                }
            })
        );

        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(doc => {
                if (doc.languageId === 'ruby') {
                    nPlusOneDetector.analyzeDocument(doc);
                }
            })
        );

        // Analyze all open documents
        vscode.workspace.textDocuments.forEach(doc => {
            if (doc.languageId === 'ruby') {
                nPlusOneDetector.analyzeDocument(doc);
            }
        });

        outputChannel.appendLine('Database features initialized');
    } catch (error) {
        outputChannel.appendLine(`Database features not available: ${error}`);
    }
}

// ========== Intelligent Indexing Initialization ==========

async function initializeIntelligentIndexing(context: vscode.ExtensionContext): Promise<void> {
    try {
        // Initialize intelligent indexer
        intelligentIndexer = new IntelligentIndexer(context, schemaParser, outputChannel);
        await intelligentIndexer.initialize();

        // Initialize navigation commands
        intelligentNavigationCommands = new IntelligentNavigationCommands(intelligentIndexer, outputChannel);
        intelligentNavigationCommands.registerCommands(context);

        // Start indexing workspace in background
        intelligentIndexer.indexWorkspace().catch(err => {
            outputChannel.appendLine(`Failed to index workspace: ${err}`);
        });

        // Watch for file changes
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(async doc => {
                if (doc.languageId === 'ruby') {
                    await intelligentIndexer.indexFile(doc.uri);
                }
            })
        );

        outputChannel.appendLine('Intelligent indexing initialized');
    } catch (error) {
        outputChannel.appendLine(`Intelligent indexing not available: ${error}`);
    }
}

export async function deactivate() {
    // FIX: Add try-catch to prevent deactivation failures
    try {
        if (outputChannel) {
            outputChannel.appendLine('RubyMate extension is deactivating');
        }

        // FIX: Add null checks and safe disposal for all resources
        if (statusBarManager) {
            try {
                statusBarManager.dispose();
            } catch (error) {
                outputChannel?.appendLine(`Error disposing statusBarManager: ${error}`);
            }
        }

        if (configValidator) {
            try {
                configValidator.dispose();
            } catch (error) {
                outputChannel?.appendLine(`Error disposing configValidator: ${error}`);
            }
        }

        if (symbolIndexer) {
            try {
                symbolIndexer.dispose();
            } catch (error) {
                outputChannel?.appendLine(`Error disposing symbolIndexer: ${error}`);
            }
        }

        if (debugSessionManager) {
            try {
                debugSessionManager.dispose();
            } catch (error) {
                outputChannel?.appendLine(`Error disposing debugSessionManager: ${error}`);
            }
        }

        if (railsStatusBar) {
            try {
                railsStatusBar.dispose();
            } catch (error) {
                outputChannel?.appendLine(`Error disposing railsStatusBar: ${error}`);
            }
        }

        if (testExplorer) {
            try {
                testExplorer.dispose();
            } catch (error) {
                outputChannel?.appendLine(`Error disposing testExplorer: ${error}`);
            }
        }

        if (nPlusOneDetector) {
            try {
                nPlusOneDetector.dispose();
            } catch (error) {
                outputChannel?.appendLine(`Error disposing nPlusOneDetector: ${error}`);
            }
        }

        if (intelligentIndexer) {
            try {
                intelligentIndexer.dispose();
            } catch (error) {
                outputChannel?.appendLine(`Error disposing intelligentIndexer: ${error}`);
            }
        }

        // NOTE: Language client integration disabled (ruby-lsp compatibility issues)
        // No need to stop language client

        // Dispose output channel last
        if (outputChannel) {
            outputChannel.appendLine('RubyMate extension deactivated successfully');
            outputChannel.dispose();
        }
    } catch (error) {
        console.error('Critical error during deactivation:', error);
    }
}

// ========== Lazy Loading Functions ==========

async function loadRailsCommandsAsync(context: vscode.ExtensionContext): Promise<void> {
    if (railsCommandsLoaded) {
        return;
    }

    outputChannel.appendLine('Loading Rails commands...');
    const { RailsCommands } = await import('./commands/rails');
    railsCommands = new RailsCommands(outputChannel);
    railsCommands.registerCommands(context);
    railsCommandsLoaded = true;
    outputChannel.appendLine('Rails commands loaded');
}

async function ensureTestExplorerLoaded(context: vscode.ExtensionContext): Promise<void> {
    if (testExplorerLoaded) {
        return;
    }

    outputChannel.appendLine('Loading test explorer...');
    const { RubyTestExplorer } = await import('./testExplorer');
    testExplorer = new RubyTestExplorer(outputChannel);
    context.subscriptions.push(testExplorer);
    testExplorerLoaded = true;
    outputChannel.appendLine('Test explorer loaded');
}

async function ensureDebugProvidersLoaded(context: vscode.ExtensionContext): Promise<void> {
    if (debugProvidersLoaded) {
        return;
    }

    outputChannel.appendLine('Loading debug providers...');
    const {
        RubyDebugConfigurationProvider,
        RubyDebugAdapterDescriptorFactory,
        DebugSessionManager
    } = await import('./debugAdapter');

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

    debugProvidersLoaded = true;
    outputChannel.appendLine('Debug providers loaded');
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
    const rubySelector = { language: 'ruby' };

    // Workspace symbol provider for Ctrl+T / Cmd+T
    const workspaceSymbolProvider = new RubyWorkspaceSymbolProvider(symbolIndexer);
    context.subscriptions.push(
        vscode.languages.registerWorkspaceSymbolProvider(workspaceSymbolProvider)
    );

    // Document symbol provider for outline and breadcrumbs
    const documentSymbolProvider = new RubyDocumentSymbolProvider(symbolIndexer);
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(rubySelector, documentSymbolProvider)
    );

    // Comprehensive definition provider using our index
    // Handles: classes, methods, requires, constants
    // Shows popup when multiple results found (like IDE)
    const rubyDefinitionProvider = new RubyDefinitionProvider(symbolIndexer);
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(rubySelector, rubyDefinitionProvider)
    );

    // IDE-like features

    // Find All References (like IDE's Alt+F7)
    const referenceProvider = new RubyReferenceProvider(symbolIndexer);
    context.subscriptions.push(
        vscode.languages.registerReferenceProvider(rubySelector, referenceProvider)
    );

    // Hover provider for documentation (like IDE's Ctrl+Q)
    const hoverProvider = new RubyHoverProvider(symbolIndexer);
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(rubySelector, hoverProvider)
    );

    // Type Hierarchy (like IDE's Ctrl+H)
    const typeHierarchyProvider = new RubyTypeHierarchyProvider(symbolIndexer);
    context.subscriptions.push(
        vscode.languages.registerTypeHierarchyProvider(rubySelector, typeHierarchyProvider)
    );

    // Call Hierarchy (like IDE's Ctrl+Alt+H)
    const callHierarchyProvider = new RubyCallHierarchyProvider(symbolIndexer);
    context.subscriptions.push(
        vscode.languages.registerCallHierarchyProvider(rubySelector, callHierarchyProvider)
    );

    // Formatting provider (RuboCop)
    const formattingProvider = new RubyFormattingProvider(outputChannel);
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(rubySelector, formattingProvider)
    );
    context.subscriptions.push(
        vscode.languages.registerDocumentRangeFormattingEditProvider(rubySelector, formattingProvider)
    );

    // Auto-end completion provider
    const autoEndProvider = new RubyAutoEndProvider();
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            rubySelector,
            autoEndProvider,
            '\n', ' ' // Trigger on newline and space
        )
    );

    // Format on save (if enabled)
    context.subscriptions.push(
        vscode.workspace.onWillSaveTextDocument(async (event) => {
            const config = vscode.workspace.getConfiguration('rubymate');
            const formatOnSave = config.get<boolean>('formatOnSave', false);

            if (formatOnSave && event.document.languageId === 'ruby') {
                // FIX: Add error handling for format-on-save
                try {
                    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
                        'vscode.executeFormatDocumentProvider',
                        event.document.uri
                    );

                    if (edits && edits.length > 0) {
                        const workspaceEdit = new vscode.WorkspaceEdit();
                        workspaceEdit.set(event.document.uri, edits);
                        const applied = await vscode.workspace.applyEdit(workspaceEdit);

                        // FIX: Log if edit application failed
                        if (!applied) {
                            outputChannel.appendLine(`Failed to apply formatting edits for ${event.document.fileName}`);
                        }
                    }
                } catch (error) {
                    // FIX: Catch and log errors without blocking save
                    outputChannel.appendLine(`Format on save error: ${error}`);
                    // Don't show error message to user - file save should continue
                }
            }
        })
    );

    outputChannel.appendLine('✓ Navigation providers registered');
    outputChannel.appendLine('  - Go to Definition (F12) - with multi-result popup');
    outputChannel.appendLine('  - Find All References (Shift+F12)');
    outputChannel.appendLine('  - Type Hierarchy (shows class inheritance)');
    outputChannel.appendLine('  - Call Hierarchy (shows method calls)');
    outputChannel.appendLine('  - Hover for Documentation');
    outputChannel.appendLine('✓ Formatting provider registered (RuboCop)');
    outputChannel.appendLine('✓ Auto-end completion provider registered');
}

function registerDebugProvidersLazy(context: vscode.ExtensionContext) {
    // Create lightweight proxy providers that load the real ones on first use
    const lazyDebugConfigProvider: vscode.DebugConfigurationProvider = {
        async resolveDebugConfiguration(folder, config, token) {
            await ensureDebugProvidersLoaded(context);
            return config;
        }
    };

    const lazyDebugAdapterFactory: vscode.DebugAdapterDescriptorFactory = {
        async createDebugAdapterDescriptor(session, executable) {
            await ensureDebugProvidersLoaded(context);
            // The real factory is now loaded, return undefined to use it
            return undefined;
        }
    };

    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('ruby', lazyDebugConfigProvider)
    );
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory('ruby', lazyDebugAdapterFactory)
    );

    outputChannel.appendLine('Debug providers registered (lazy loading enabled)');
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
        const stats = symbolIndexer.getStats();
        vscode.window.showInformationMessage(
            `RubyMate: Indexed ${stats.totalSymbols} symbols in ${stats.indexedFiles} files`
        );
    });

    // Show index statistics command
    const showIndexStatsCommand = vscode.commands.registerCommand('rubymate.showIndexStats', () => {
        const stats = symbolIndexer.getStats();
        const message = [
            `**RubyMate Index Statistics**`,
            ``,
            `Total Files: ${stats.totalFiles}`,
            `Indexed Files: ${stats.indexedFiles}`,
            `Total Symbols: ${stats.totalSymbols}`,
            `Gem Files: ${stats.gemFiles}`,
            ``,
            `Average: ${(stats.totalSymbols / stats.indexedFiles).toFixed(1)} symbols/file`
        ].join('\n');

        vscode.window.showInformationMessage(message, { modal: true });
    });

    // Validate configuration command
    const validateConfigCommand = vscode.commands.registerCommand('rubymate.validateConfiguration', async () => {
        outputChannel.show();
        outputChannel.appendLine('');
        outputChannel.appendLine('=== Manual Configuration Validation ===');
        configValidator.clearCache(); // Force fresh validation
        const result = await configValidator.validateAll();
        await configValidator.showValidationErrors(result);

        if (result.valid && result.warnings.length === 0) {
            vscode.window.showInformationMessage('✓ RubyMate configuration is valid!');
        }
    });

    // Status bar menu command
    const statusBarMenuCommand = vscode.commands.registerCommand('rubymate.showStatusBarMenu', async () => {
        telemetryManager.trackCommand('showStatusBarMenu');
        await statusBarManager.showQuickMenu();
    });

    // Telemetry commands
    const showTelemetryCommand = vscode.commands.registerCommand('rubymate.showTelemetry', () => {
        telemetryManager.showStatistics();
    });

    const exportTelemetryCommand = vscode.commands.registerCommand('rubymate.exportTelemetry', async () => {
        await telemetryManager.exportToFile();
    });

    const clearTelemetryCommand = vscode.commands.registerCommand('rubymate.clearTelemetry', async () => {
        await telemetryManager.clearData();
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
        showIndexStatsCommand,
        validateConfigCommand,
        statusBarMenuCommand,
        showTelemetryCommand,
        exportTelemetryCommand,
        clearTelemetryCommand,
        showRailsCommandsCommand
    );
}

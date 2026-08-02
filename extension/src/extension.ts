import * as vscode from 'vscode';
import * as path from 'path';
// RubyMate uses custom indexers and providers instead of a bundled language client.
// import { startLanguageClient, stopLanguageClient } from './languageClient';
import { CoreRubyIndex, CoreRubyIndexStatus } from './indexing/coreRubyIndex';
import { NavigationCommands } from './commands/navigation';
import { RubyWorkspaceSymbolProvider } from './providers/workspaceSymbolProvider';
import { RubyDocumentSymbolProvider } from './providers/documentSymbolProvider';
import { SchemaParser } from './database/schemaParser';
import { SQLCompletionProvider, ActiveRecordCompletionProvider } from './database/sqlCompletionProvider';
import { NPlusOneDetector } from './database/n+1Detector';
import { DatabaseCommands } from './database/databaseCommands';
import { IntelligentNavigationCommands } from './commands/intelligentNavigation';
import { RubyDefinitionProvider } from './providers/rubyDefinitionProvider';
import { RubyReferenceProvider } from './providers/referenceProvider';
import { RubyHoverProvider } from './providers/hoverProvider';
import { RubyTypeHierarchyProvider } from './providers/typeHierarchyProvider';
import { RubyCallHierarchyProvider } from './providers/callHierarchyProvider';
import { RubyRenameProvider } from './providers/renameProvider';
import { RubyFormattingProvider } from './providers/rubyFormattingProvider';
import { RubyAutoEndProvider, RubyAutoEndOnEnterProvider } from './providers/rubyAutoEndProvider';
import { EnhancedTemplateCompletionProvider } from './providers/enhancedTemplateCompletionProvider';
import { EnhancedTemplateDefinitionProvider } from './providers/enhancedTemplateDefinitionProvider';
import { TemplateHoverProvider } from './providers/templateDefinitionProvider';
import { ConfigValidator } from './configValidator';
import { StatusBarManager, ExtensionState } from './statusBarManager';
import { TelemetryManager } from './telemetryManager';
import { RatingReminderManager } from './ratingReminder';
import { Debouncer } from './shared';
import { formatRuntimeStatus, RubyRuntime } from './runtime/rubyRuntime';

// Gem Explorer
import { GemExplorerProvider } from './gemExplorer';

// Hotwire support
import { StimulusIndexer } from './hotwire';
import { StimulusCompletionProvider } from './hotwire';
import { StimulusDefinitionProvider } from './hotwire';
import { HotwireHoverProvider } from './hotwire';
import { TurboCompletionProvider } from './hotwire';
import { ParserService } from './parsing';
import { RubyCompletionProvider } from './completion/rubyCompletionProvider';
import { loadBundledStubs, loadCompletionStubs } from './completion/stubLoader';

// Lazy-loaded imports (loaded on-demand)
// import { RailsCommands } from './commands/rails'; // Lazy loaded
// import { RubyTestExplorer } from './testExplorer'; // Lazy loaded
// import { RubyDebugConfigurationProvider, RubyDebugAdapterDescriptorFactory, DebugSessionManager } from './debugAdapter'; // Lazy loaded

let outputChannel: vscode.OutputChannel;
let symbolIndexer: CoreRubyIndex;
let navigationCommands: NavigationCommands;
let railsCommands: any; // Lazy loaded
let debugSessionManager: any;
let railsStatusBar: vscode.StatusBarItem;
let testExplorer: any; // Lazy loaded
let railsCommandsLoaded = false;
let testExplorerLoaded = false;
let extensionContext: vscode.ExtensionContext; // Store context for lazy loaders
let rubyRuntime: RubyRuntime;

// Configuration validation
let configValidator: ConfigValidator;

// Status bar
let statusBarManager: StatusBarManager;

// Telemetry (privacy-respecting)
let telemetryManager: TelemetryManager;

// Rating reminder
let ratingReminderManager: RatingReminderManager;

// Database features
let schemaParser: SchemaParser;
let nPlusOneDetector: NPlusOneDetector;
let databaseCommands: DatabaseCommands;

let intelligentNavigationCommands: IntelligentNavigationCommands;
let parserService: ParserService;

// Gem Explorer
let gemExplorer: GemExplorerProvider;

/**
 * Keep RubyMate's on-disk cache (.rubymate/) out of VSCode search results and
 * file watching. Merges the glob into the Workspace-level settings only when it
 * isn't already present, so we don't churn the user's settings.json.
 */
async function ensureRubymateExcluded(): Promise<void> {
    // Updating Workspace-scoped config requires an open workspace folder.
    if (!vscode.workspace.workspaceFolders?.length) {
        return;
    }

    const glob = '**/.rubymate';
    const targets: Array<{ section: string; key: string }> = [
        { section: 'search', key: 'exclude' },
        { section: 'files', key: 'watcherExclude' }
    ];

    for (const { section, key } of targets) {
        try {
            const config = vscode.workspace.getConfiguration(section);
            const current = config.get<Record<string, boolean>>(key) ?? {};
            if (current[glob] === true) {
                continue; // Already excluded, leave settings untouched.
            }
            await config.update(
                key,
                { ...current, [glob]: true },
                vscode.ConfigurationTarget.Workspace
            );
            outputChannel.appendLine(`Excluded ${glob} from ${section}.${key}`);
        } catch (error) {
            outputChannel.appendLine(
                `Failed to exclude ${glob} from ${section}.${key}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}

export async function activate(context: vscode.ExtensionContext) {
    const startTime = Date.now();
    extensionContext = context; // Store for lazy loaders
    outputChannel = vscode.window.createOutputChannel('RubyMate');
    outputChannel.appendLine('RubyMate extension is now active');
    rubyRuntime = new RubyRuntime(outputChannel);

    // Hide RubyMate's cache folder from search results and file watching.
    await ensureRubymateExcluded();

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

    // Initialize rating reminder (non-intrusive)
    ratingReminderManager = new RatingReminderManager(context);
    await ratingReminderManager.initialize();
    outputChannel.appendLine('[RATING] Rating reminder initialized');

    // ========== PHASE 0: Configuration Validation (Critical) ==========
    // Validate configuration before initializing other features
    configValidator = new ConfigValidator(outputChannel, rubyRuntime);
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
    parserService = new ParserService(context, outputChannel);
    await parserService.initialize();
    if (parserService.getRuntimeStatus() === 'degraded') {
        statusBarManager.setDegraded('Parser fallback');
    } else if (parserService.getRuntimeStatus() === 'failed') {
        statusBarManager.setFailed('Parser failed');
    }

    // Initialize the canonical Core Ruby index with persistent caching.
    symbolIndexer = new CoreRubyIndex(context, outputChannel, parserService, rubyRuntime);
    await symbolIndexer.initialize(); // Load cache from disk
    context.subscriptions.push(
        symbolIndexer.onDidChangeStatus(snapshot => {
            switch (snapshot.state) {
                case 'indexing':
                    statusBarManager.setIndexing(snapshot.message || 'Indexing workspace...');
                    break;
                case 'degraded':
                    statusBarManager.setDegraded(
                        snapshot.degradedFiles > 0
                            ? `Degraded (${snapshot.degradedFiles})`
                            : 'Degraded'
                    );
                    break;
                case 'failed':
                    statusBarManager.setFailed(snapshot.message || 'Index failed');
                    break;
                default:
                    statusBarManager.setReady();
                    break;
            }
        })
    );

    // Initialize navigation commands (lightweight, core feature)
    navigationCommands = new NavigationCommands(symbolIndexer, outputChannel);

    // See indexing/coreRubyIndex.ts for RubyMate's custom code intelligence.

    // Register providers (lightweight)
    registerProviders(context);

    // Register core commands (lightweight)
    registerCommands(context);
    navigationCommands.registerCommands(context);

    // ========== DATABASE FEATURES ==========
    // Initialize database features (Rails projects)
    await initializeDatabaseFeatures(context);

    // ========== SEMANTIC NAVIGATION COMMANDS ==========
    initializeIntelligentNavigationCommands(context);

    // ========== GEM EXPLORER ==========
    await initializeGemExplorer(context);

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

    // ========== PHASE 3: Debug Providers ==========
    // Register debug providers directly (no lazy loading needed since extension
    // already activates on onLanguage:ruby)
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

    // Debug adapter descriptor factory (register ONCE)
    const debugAdapterFactory = new RubyDebugAdapterDescriptorFactory(outputChannel, rubyRuntime);
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory('ruby', debugAdapterFactory)
    );
    context.subscriptions.push({ dispose: () => debugAdapterFactory.dispose() });

    // Debug session manager
    debugSessionManager = new DebugSessionManager(outputChannel);
    debugSessionManager.setDebugAdapterFactory(debugAdapterFactory);
    debugSessionManager.register(context);

    outputChannel.appendLine('Debug providers registered');

    // ========== PHASE 4: Workspace Indexing (Background) ==========
    // Index workspace symbols in background (don't block activation)
    outputChannel.appendLine('[INDEXING] Starting workspace indexing in background...');
    statusBarManager.setIndexing('Indexing workspace...');
    telemetryManager.startPerformance('workspace-indexing');

    // Wrap indexing with timeout to prevent infinite loading (60 seconds)
    let timeoutId: NodeJS.Timeout;
    const indexingTimeout = new Promise<void>((_, reject) => {
        timeoutId = setTimeout(() => {
            outputChannel.appendLine('[INDEXING] ⚠️ TIMEOUT: Indexing took longer than 60 seconds');
            reject(new Error('Indexing timeout after 60 seconds'));
        }, 60000);
    });

    outputChannel.appendLine('[INDEXING] Starting Promise.race with 60s timeout...');
    Promise.race([indexWorkspace(context), indexingTimeout])
        .then(() => {
            clearTimeout(timeoutId); // Clear the timeout on success
            outputChannel.appendLine('[INDEXING] ✅ SUCCESS: Indexing completed');
            telemetryManager.endPerformance('workspace-indexing');
            const indexStatus = symbolIndexer.getIndexLifecycleSnapshot();
            if (indexStatus.state === 'degraded') {
                statusBarManager.setDegraded(`Degraded (${indexStatus.degradedFiles})`);
            } else {
                statusBarManager.setReady();
            }
            outputChannel.appendLine('[INDEXING] Status bar set to READY');
        })
        .catch(err => {
            clearTimeout(timeoutId); // Clear the timeout on error too
            outputChannel.appendLine(`[INDEXING] ❌ ERROR: ${err.message}`);
            outputChannel.appendLine(`[INDEXING] Error stack: ${err.stack}`);
            telemetryManager.trackError('workspace-indexing-failed', 'indexing', err);
            statusBarManager.setFailed('Index failed');
            outputChannel.appendLine('[INDEXING] Status bar set to FAILED');
            vscode.window.showWarningMessage(
                `RubyMate: Workspace indexing ${err.message?.includes('timeout') ? 'timed out' : 'failed'}. Some features may be limited.`
            );
        });

    // Watch for file changes to re-index (with debouncing to avoid rapid re-indexing)
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.rb');

    // Use Debouncer to coalesce rapid file changes (e.g., during save or bulk operations)
    // Map of URI -> Debouncer to handle per-file debouncing
    const fileIndexDebouncers = new Map<string, Debouncer<void>>();
    const FILE_INDEX_DEBOUNCE_MS = 300;

    const getDebouncedIndexer = (uri: vscode.Uri) => {
        const key = uri.toString();
        let debouncer = fileIndexDebouncers.get(key);
        if (!debouncer) {
            debouncer = new Debouncer(
                () => { symbolIndexer.indexFile(uri); },
                FILE_INDEX_DEBOUNCE_MS,
                { trailing: true }
            );
            fileIndexDebouncers.set(key, debouncer);
        }
        return debouncer;
    };

    watcher.onDidChange(uri => getDebouncedIndexer(uri).trigger());
    watcher.onDidCreate(uri => getDebouncedIndexer(uri).trigger());
    watcher.onDidDelete(uri => {
        // File deleted - cancel any pending debounced indexing and remove from map
        const key = uri.toString();
        const debouncer = fileIndexDebouncers.get(key);
        if (debouncer) {
            debouncer.cancel();
            fileIndexDebouncers.delete(key);
        }
        symbolIndexer.removeFile(uri, 'deleted').catch(err => {
            outputChannel.appendLine(`Failed to remove deleted file from index: ${err}`);
        });
    });
    context.subscriptions.push(watcher);

    // Clean up debouncers on deactivation
    context.subscriptions.push({
        dispose: () => {
            for (const debouncer of fileIndexDebouncers.values()) {
                debouncer.cancel();
            }
            fileIndexDebouncers.clear();
        }
    });

    const activationTime = Date.now() - startTime;
    outputChannel.appendLine(`RubyMate activated in ${activationTime}ms (lazy loading enabled)`);
    outputChannel.appendLine('Workspace indexing running in background...');
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
        databaseCommands = new DatabaseCommands(schemaParser, outputChannel, rubyRuntime);
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

// ========== Semantic Navigation Commands ==========

function initializeIntelligentNavigationCommands(context: vscode.ExtensionContext): void {
    intelligentNavigationCommands = new IntelligentNavigationCommands(symbolIndexer, outputChannel);
    intelligentNavigationCommands.registerCommands(context);
    outputChannel.appendLine('Semantic navigation commands registered through CoreRubyIndex');
}

// ========== Gem Explorer Initialization ==========

async function initializeGemExplorer(context: vscode.ExtensionContext): Promise<void> {
    try {
        gemExplorer = new GemExplorerProvider(outputChannel, rubyRuntime);
        await gemExplorer.initialize();

        // Register tree view
        const treeView = vscode.window.createTreeView('rubymate.gemExplorer', {
            treeDataProvider: gemExplorer,
            showCollapseAll: true
        });
        context.subscriptions.push(treeView);

        // Register commands
        gemExplorer.registerCommands(context);

        // Set context key for when clause (show view only if Gemfile exists)
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceRoot) {
            const gemfilePath = path.join(workspaceRoot, 'Gemfile');
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(gemfilePath));
                vscode.commands.executeCommand('setContext', 'workspaceHasGemfile', true);
            } catch {
                vscode.commands.executeCommand('setContext', 'workspaceHasGemfile', false);
            }
        }

        context.subscriptions.push({ dispose: () => gemExplorer.dispose() });
        outputChannel.appendLine('Gem Explorer initialized');
    } catch (error) {
        outputChannel.appendLine(`Gem Explorer not available: ${error}`);
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

        // No bundled language client is running.

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
    railsCommands = new RailsCommands(outputChannel, rubyRuntime);
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
    testExplorer = new RubyTestExplorer(outputChannel, rubyRuntime);
    context.subscriptions.push(testExplorer);
    testExplorerLoaded = true;
    outputChannel.appendLine('Test explorer loaded');
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
    const rubyDefinitionProvider = new RubyDefinitionProvider(symbolIndexer, parserService);
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(rubySelector, rubyDefinitionProvider)
    );

    // IDE-like features

    // Find All References (like IDE's Alt+F7)
    const referenceProvider = new RubyReferenceProvider(symbolIndexer, parserService);
    context.subscriptions.push(
        vscode.languages.registerReferenceProvider(rubySelector, referenceProvider)
    );

    // Hover provider for documentation (like IDE's Ctrl+Q)
    const hoverProvider = new RubyHoverProvider(symbolIndexer);
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(rubySelector, hoverProvider)
    );

    // Type Hierarchy (like IDE's Ctrl+H)
    const typeHierarchyProvider = new RubyTypeHierarchyProvider(symbolIndexer, parserService);
    context.subscriptions.push(
        vscode.languages.registerTypeHierarchyProvider(rubySelector, typeHierarchyProvider)
    );

    // Call Hierarchy (like IDE's Ctrl+Alt+H)
    const callHierarchyProvider = new RubyCallHierarchyProvider(symbolIndexer, parserService);
    context.subscriptions.push(
        vscode.languages.registerCallHierarchyProvider(rubySelector, callHierarchyProvider)
    );

    // Rename Refactoring (like IDE's Shift+F6)
    const renameProvider = new RubyRenameProvider(symbolIndexer, parserService);
    context.subscriptions.push(
        vscode.languages.registerRenameProvider(rubySelector, renameProvider)
    );

    // Formatting provider (RuboCop)
    const formattingProvider = new RubyFormattingProvider(outputChannel, rubyRuntime);
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

    // ========== RUBY COMPLETION (semantic, call-graph ranked) ==========
    // General autocompletion: locals, self methods, receiver members, and
    // constants, ranked by how the codebase actually uses them. Members of core
    // and Rails types resolve through the bundled knowledge base, preferring the
    // signatures already on the user's machine.
    const completionConfig = vscode.workspace.getConfiguration('rubymate.completion');
    if (completionConfig.get<boolean>('enabled', true)) {
        let completionDocs = new Map<string, string>();
        try {
            const graph = symbolIndexer.getSemanticGraph();
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const stubResult = cwd
                ? loadCompletionStubs(graph, {
                    cwd,
                    cacheFile: path.join(extensionContext.globalStorageUri.fsPath, 'completion-stubs.json'),
                    log: message => outputChannel.appendLine(message)
                })
                : loadBundledStubs(graph);
            completionDocs = stubResult.docs;
        } catch (error) {
            outputChannel.appendLine(`Completion knowledge base failed to load: ${error}`);
        }

        const rubyCompletionProvider = new RubyCompletionProvider(symbolIndexer, completionDocs);
        context.subscriptions.push(
            vscode.languages.registerCompletionItemProvider(
                rubySelector,
                rubyCompletionProvider,
                '.', ':', '@', '&' // member, scoped, instance/class var, safe navigation
            )
        );
    }

    // ========== TEMPLATE INTELLIGENCE (Professional IDE-level) ==========
    // ERB, Haml, and Slim template support with comprehensive features
    const templateLanguages = [
        { scheme: 'file', language: 'erb' },
        { scheme: 'file', language: 'haml' },
        { scheme: 'file', language: 'slim' }
    ];

    // Enhanced template completion provider
    // Provides: Rails helpers, path helpers from routes, instance vars, I18n keys
    const templateCompletionProvider = new EnhancedTemplateCompletionProvider();
    for (const selector of templateLanguages) {
        context.subscriptions.push(
            vscode.languages.registerCompletionItemProvider(
                selector,
                templateCompletionProvider,
                '<', '%', '=', '-', ' ', '@', '_' // Trigger on ERB tags, Ruby code, and special chars
            )
        );
    }

    // Enhanced template definition provider
    // Handles: render 'partial', render @object, render @collection, custom helpers, path helpers
    const templateDefinitionProvider = new EnhancedTemplateDefinitionProvider();
    for (const selector of templateLanguages) {
        context.subscriptions.push(
            vscode.languages.registerDefinitionProvider(selector, templateDefinitionProvider)
        );
    }

    // Template hover provider
    const templateHoverProvider = new TemplateHoverProvider();
    for (const selector of templateLanguages) {
        context.subscriptions.push(
            vscode.languages.registerHoverProvider(selector, templateHoverProvider)
        );
    }

    outputChannel.appendLine('✓ Enhanced template intelligence registered (Professional IDE-level)');
    outputChannel.appendLine('  - Rails helpers completion (60+ helpers)');
    outputChannel.appendLine('  - Path helpers from routes (user_path, edit_user_path, etc.)');
    outputChannel.appendLine('  - Instance variable completion from controllers');
    outputChannel.appendLine('  - Go to definition: render @object, render "partial", custom helpers');
    outputChannel.appendLine('  - I18n translation key completion');
    outputChannel.appendLine('  - Smart partial resolution (layouts, files, model-based)');

    // ========== HOTWIRE FEATURES ==========
    const hotwireConfig = vscode.workspace.getConfiguration('rubymate');
    const hotwireEnabled = hotwireConfig.get<boolean>('hotwire.enabled', true);

    if (hotwireEnabled) {
        // Initialize asynchronously without blocking provider registration
        (async () => {
        try {
            // Initialize Stimulus indexer
            const stimulusIndexer = new StimulusIndexer(context, outputChannel, parserService);
            await stimulusIndexer.initialize();
            context.subscriptions.push({ dispose: () => stimulusIndexer.dispose() });

            // Languages for Hotwire support (ERB, Haml, Slim, HTML)
            const hotwireLanguages: vscode.DocumentSelector = [
                { language: 'erb', scheme: 'file' },
                { language: 'haml', scheme: 'file' },
                { language: 'slim', scheme: 'file' },
                { language: 'html', scheme: 'file' }
            ];

            // Register Stimulus completion provider
            const stimulusCompletionProvider = new StimulusCompletionProvider(stimulusIndexer);
            context.subscriptions.push(
                vscode.languages.registerCompletionItemProvider(
                    hotwireLanguages,
                    stimulusCompletionProvider,
                    '"', "'", '-', '#', ' '  // Trigger characters
                )
            );

            // Register Stimulus definition provider
            const stimulusDefinitionProvider = new StimulusDefinitionProvider(stimulusIndexer);
            context.subscriptions.push(
                vscode.languages.registerDefinitionProvider(
                    hotwireLanguages,
                    stimulusDefinitionProvider
                )
            );

            // Register Hotwire hover provider
            const hotwireHoverProvider = new HotwireHoverProvider(stimulusIndexer);
            context.subscriptions.push(
                vscode.languages.registerHoverProvider(
                    hotwireLanguages,
                    hotwireHoverProvider
                )
            );

            // Register Turbo completion provider
            const turboCompletionProvider = new TurboCompletionProvider();
            context.subscriptions.push(
                vscode.languages.registerCompletionItemProvider(
                    hotwireLanguages,
                    turboCompletionProvider,
                    '-', '"', "'"  // Trigger characters
                )
            );

            // Register reindex command
            context.subscriptions.push(
                vscode.commands.registerCommand('rubymate.reindexStimulus', async () => {
                    await stimulusIndexer.reindex();
                    vscode.window.showInformationMessage('Stimulus controllers reindexed');
                })
            );

            outputChannel.appendLine('✓ Hotwire support registered');
            outputChannel.appendLine('  - Stimulus controller discovery & IntelliSense');
            outputChannel.appendLine('  - data-controller, data-action, data-*-target completions');
            outputChannel.appendLine('  - Go-to-definition for Stimulus controllers and actions');
            outputChannel.appendLine('  - Turbo Stream/Frame/Drive attribute completions');
            outputChannel.appendLine('  - Hover documentation for Hotwire attributes');
        } catch (error) {
            outputChannel.appendLine(`Failed to initialize Hotwire support: ${error}`);
        }
        })();
    }

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

function formatCoreIndexStatus(status: CoreRubyIndexStatus): string {
    return [
        'RubyMate Core Index',
        '',
        `Parser engine: ${status.parserEngine}`,
        `Indexed files: ${status.indexedFiles}`,
        `Degraded files: ${status.degradedFiles}`,
        `Failed files: ${status.failedFiles}`,
        `Cache version: ${status.cacheVersion}`,
        `Last index duration: ${status.lastIndexDuration}ms`,
        `Lifecycle: ${status.lifecycle.state}${status.lifecycle.message ? ` (${status.lifecycle.message})` : ''}`
    ].join('\n');
}

function registerCommands(context: vscode.ExtensionContext) {
    // Run single test command
    const runTestCommand = vscode.commands.registerCommand('rubymate.runTest', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        // Track feature usage for rating reminder
        await ratingReminderManager.trackFeatureUse();

        const config = vscode.workspace.getConfiguration('rubymate');
        const testFramework = config.get<string>('testFramework', 'auto');
        const currentFile = editor.document.uri.fsPath;
        const currentLine = editor.selection.active.line + 1;

        if (testFramework === 'rspec' || currentFile.includes('_spec.rb')) {
            await rubyRuntime.runRubyToolInTerminal('rspec', [`${currentFile}:${currentLine}`], {
                name: 'RubyMate Test',
                useBundler: 'auto'
            });
        } else if (testFramework === 'minitest') {
            await rubyRuntime.runRubyToolInTerminal('ruby', [currentFile, '--name', '/test_/'], {
                name: 'RubyMate Test',
                useBundler: 'auto'
            });
        }
    });

    // Run test file command
    const runTestFileCommand = vscode.commands.registerCommand('rubymate.runTestFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const currentFile = editor.document.uri.fsPath;

        if (currentFile.includes('_spec.rb')) {
            await rubyRuntime.runRubyToolInTerminal('rspec', [currentFile], {
                name: 'RubyMate Test',
                useBundler: 'auto'
            });
        } else if (currentFile.includes('_test.rb')) {
            await rubyRuntime.runRubyToolInTerminal('ruby', [currentFile], {
                name: 'RubyMate Test',
                useBundler: 'auto'
            });
        }
    });

    // Start debugger command
    const startDebuggerCommand = vscode.commands.registerCommand('rubymate.startDebugger', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        // Track feature usage for rating reminder
        await ratingReminderManager.trackFeatureUse();

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

    // Show runtime status command
    const showRuntimeStatusCommand = vscode.commands.registerCommand('rubymate.showRuntimeStatus', async () => {
        const runtimeStatus = await rubyRuntime.getStatus(context.extension.extensionKind);
        const formatted = [
            formatRuntimeStatus(runtimeStatus),
            '',
            formatCoreIndexStatus(symbolIndexer.getIndexStatus())
        ].join('\n');

        outputChannel.appendLine('');
        outputChannel.appendLine(formatted);
        outputChannel.show();
        await vscode.window.showInformationMessage(formatted, { modal: true });
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

    // Rating reminder commands (for testing/debugging)
    const showRatingReminderCommand = vscode.commands.registerCommand('rubymate.showRatingReminder', async () => {
        await ratingReminderManager.showNow();
    });

    const ratingReminderStatusCommand = vscode.commands.registerCommand('rubymate.ratingReminderStatus', () => {
        const status = ratingReminderManager.getStatus();
        const message = [
            '**Rating Reminder Status**',
            '',
            `Install Date: ${status.installDate ? new Date(status.installDate).toLocaleDateString() : 'Not set'}`,
            `Days Since Install: ${Math.floor(status.daysSinceInstall)}`,
            `Feature Uses: ${status.featureCount}`,
            `Dismissed: ${status.dismissed ? 'Yes' : 'No'}`,
            `Last Shown Version: ${status.lastShownVersion || 'Never shown'}`
        ].join('\n');
        vscode.window.showInformationMessage(message, { modal: true });
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
        showRuntimeStatusCommand,
        statusBarMenuCommand,
        showTelemetryCommand,
        exportTelemetryCommand,
        clearTelemetryCommand,
        showRatingReminderCommand,
        ratingReminderStatusCommand,
        showRailsCommandsCommand
    );
}

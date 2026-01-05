import * as vscode from 'vscode';

/**
 * Integration with Sorbet extension for enhanced type information
 *
 * Benefits:
 * - Leverages Sorbet's static type checking
 * - Enhances hover with type signatures
 * - Improves go-to-definition accuracy
 * - Complements RubyMate's Rails-specific features
 *
 * Strategy:
 * - Detect if Sorbet extension is installed
 * - Use Sorbet LSP for type information
 * - Fall back gracefully if unavailable
 */

export interface SorbetTypeInfo {
    type: string;
    definition?: vscode.Location;
    signature?: string;
    documentation?: string;
}

/**
 * Sorbet extension exported API (v0.3.41+)
 * Ref: https://sorbet.org/docs/vscode
 */
export interface SorbetExportedAPI {
    /**
     * Current Sorbet Language Server status
     * - "disabled": LSP has been disabled
     * - "error": LSP encountered an error (not type errors, client errors)
     * - "running": LSP is running
     * - "start": LSP is starting
     */
    status?: 'disabled' | 'error' | 'running' | 'start';

    /**
     * Event triggered when status changes
     */
    onStatusChanged?: vscode.Event<string>;
}

export class SorbetIntegration {
    private outputChannel: vscode.OutputChannel;
    private sorbetAvailable: boolean = false;
    private sorbetExtension?: vscode.Extension<SorbetExportedAPI>;
    private sorbetAPI?: SorbetExportedAPI;

    // Circuit breaker for handling repeated failures
    private failureCount: number = 0;
    private disabledUntil: number = 0;
    private readonly MAX_FAILURES = 3;
    private readonly DISABLE_DURATION = 5 * 60 * 1000; // 5 minutes
    private readonly DEFAULT_TIMEOUT = 5000; // 5 seconds

    // Status polling
    private statusPollingInterval?: NodeJS.Timeout;
    private isDisposed: boolean = false; // FIX: Track disposal state

    // Known Sorbet extension IDs
    private static readonly SORBET_EXTENSION_IDS = [
        'sorbet.sorbet-vscode-extension',  // Official Sorbet extension
        'shopify.ruby-lsp'                  // Shopify Ruby LSP (includes Sorbet)
    ];

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        // Note: detectSorbetExtension is now async and called via initialize()
    }

    /**
     * Initialize Sorbet integration (async)
     * Call this from extension.ts activation
     */
    async initialize(): Promise<void> {
        await this.detectSorbetExtension();
        // FIX: Status polling disabled by default to prevent test interference
        // Can be enabled via configuration in future if needed
        // if (this.sorbetAvailable) {
        //     this.startStatusPolling();
        // }
    }

    /**
     * Dispose resources
     * FIX: Ensure all intervals are cleared to prevent memory leaks and test failures
     */
    dispose(): void {
        this.isDisposed = true; // FIX: Mark as disposed to prevent further operations

        if (this.statusPollingInterval) {
            clearInterval(this.statusPollingInterval);
            this.statusPollingInterval = undefined;
        }
    }

    /**
     * Detect if Sorbet extension is installed and active
     * FIX: Made async to properly await activation and prevent race conditions
     */
    private async detectSorbetExtension(): Promise<void> {
        this.outputChannel.appendLine('Checking for Sorbet extension...');

        for (const extensionId of SorbetIntegration.SORBET_EXTENSION_IDS) {
            const extension = vscode.extensions.getExtension(extensionId);

            if (extension) {
                this.sorbetExtension = extension;

                this.outputChannel.appendLine(`✓ Found Sorbet extension: ${extensionId}`);
                this.outputChannel.appendLine(`  Active: ${extension.isActive}`);
                this.outputChannel.appendLine(`  Version: ${extension.packageJSON.version}`);

                // Activate if not active - FIX: Now properly awaited
                if (!extension.isActive) {
                    try {
                        await extension.activate();
                        this.sorbetAvailable = true;
                        this.sorbetAPI = extension.exports;
                        this.monitorSorbetStatus();
                        this.outputChannel.appendLine('  ✓ Activated Sorbet extension');
                    } catch (err) {
                        this.sorbetAvailable = false; // FIX: Explicitly set to false on error
                        this.outputChannel.appendLine(`  ✗ Failed to activate: ${err}`);
                        this.handleError(err as Error, 'activation');
                    }
                } else {
                    // Already active, get API
                    this.sorbetAvailable = true;
                    this.sorbetAPI = extension.exports;
                    this.monitorSorbetStatus();
                }

                return;
            }
        }

        this.outputChannel.appendLine('✗ Sorbet extension not found');
        this.outputChannel.appendLine('  RubyMate will work without Sorbet, but type information will be limited');
        this.outputChannel.appendLine('  Install Sorbet for enhanced type checking: https://sorbet.org/');
    }

    /**
     * Monitor Sorbet Language Server status via exported API
     */
    private monitorSorbetStatus(): void {
        if (!this.sorbetAPI) {
            return;
        }

        // Log current status
        if (this.sorbetAPI.status) {
            this.outputChannel.appendLine(`[SORBET STATUS] ${this.sorbetAPI.status}`);
        }

        // Subscribe to status changes
        if (this.sorbetAPI.onStatusChanged) {
            this.sorbetAPI.onStatusChanged((newStatus: string) => {
                this.outputChannel.appendLine(`[SORBET STATUS] Changed to: ${newStatus}`);

                if (newStatus === 'error') {
                    vscode.window.showWarningMessage(
                        'Sorbet Language Server encountered an error. Check output for details.',
                        'Show Output'
                    ).then(selection => {
                        if (selection === 'Show Output') {
                            this.outputChannel.show();
                        }
                    });
                }
            });
        }
    }

    /**
     * Get current Sorbet LSP status
     */
    getSorbetStatus(): string | undefined {
        return this.sorbetAPI?.status;
    }

    /**
     * Check if Sorbet is available
     * FIX: Now checks circuit breaker state
     */
    isSorbetAvailable(): boolean {
        // Check circuit breaker first
        if (Date.now() < this.disabledUntil) {
            return false; // Circuit breaker is tripped
        }
        return this.sorbetAvailable;
    }

    /**
     * Check if Sorbet LSP is running (not just installed)
     */
    isSorbetRunning(): boolean {
        return this.isSorbetAvailable() && this.sorbetAPI?.status === 'running';
    }

    /**
     * FIX: Validate that URI is accessible (not a synthetic Sorbet URI)
     * Filters out sorbet:// scheme URIs that don't exist on disk
     * Prevents crashes when navigating to stdlib definitions
     */
    private isAccessibleUri(uri: vscode.Uri): boolean {
        // Only allow file:// scheme
        if (uri.scheme !== 'file') {
            this.outputChannel.appendLine(`[SORBET] Filtered non-file URI: ${uri.toString()}`);
            return false;
        }

        // Reject URIs containing 'sorbet:' scheme (synthetic files)
        const uriString = uri.toString();
        if (uriString.includes('sorbet:')) {
            this.outputChannel.appendLine(`[SORBET] Filtered synthetic Sorbet URI: ${uriString}`);
            return false;
        }

        return true;
    }

    /**
     * FIX: Timeout wrapper for all Sorbet API calls
     * Prevents hanging when Sorbet LSP becomes unresponsive
     */
    private async withTimeout<T>(
        promise: Promise<T>,
        timeoutMs: number = this.DEFAULT_TIMEOUT,
        operationName: string = 'operation'
    ): Promise<T | null> {
        const timeout = new Promise<null>((resolve) => {
            setTimeout(() => {
                this.outputChannel.appendLine(`[SORBET] ${operationName} timed out after ${timeoutMs}ms`);
                resolve(null);
            }, timeoutMs);
        });

        const result = await Promise.race([promise, timeout]);

        if (result === null) {
            this.recordFailure('timeout', operationName);
        } else {
            this.recordSuccess(); // Reset failure count on success
        }

        return result;
    }

    /**
     * FIX: Record failure for circuit breaker
     */
    private recordFailure(errorType: string, operation: string): void {
        this.failureCount++;

        // FIX: Guard against closed channel
        try {
            this.outputChannel.appendLine(
                `[SORBET] Failure ${this.failureCount}/${this.MAX_FAILURES} (${errorType} in ${operation})`
            );
        } catch {
            // Silently ignore if channel is closed (e.g., during test teardown)
            return;
        }

        if (this.failureCount >= this.MAX_FAILURES) {
            this.disabledUntil = Date.now() + this.DISABLE_DURATION;
            this.outputChannel.appendLine(
                `[SORBET] Circuit breaker tripped! Sorbet disabled for ${this.DISABLE_DURATION / 1000}s`
            );

            vscode.window.showWarningMessage(
                `Sorbet integration disabled due to ${this.MAX_FAILURES} consecutive errors. ` +
                `Will retry in ${this.DISABLE_DURATION / 60000} minutes.`,
                'Retry Now',
                'Show Output'
            ).then(selection => {
                if (selection === 'Retry Now') {
                    this.resetCircuitBreaker();
                } else if (selection === 'Show Output') {
                    this.outputChannel.show();
                }
            });
        }
    }

    /**
     * FIX: Record success to reset failure counter
     */
    private recordSuccess(): void {
        if (this.failureCount > 0) {
            // FIX: Guard against closed channel
            try {
                this.outputChannel.appendLine('[SORBET] Operation succeeded, resetting failure count');
            } catch {
                // Silently ignore if channel is closed
            }
            this.failureCount = 0;
        }
    }

    /**
     * FIX: Reset circuit breaker manually or after timeout
     */
    private resetCircuitBreaker(): void {
        this.outputChannel.appendLine('[SORBET] Circuit breaker reset');
        this.failureCount = 0;
        this.disabledUntil = 0;

        vscode.window.showInformationMessage('Sorbet integration re-enabled');
    }

    /**
     * FIX: Classify errors to provide helpful messages
     */
    private classifyError(error: Error): 'watchman' | 'config' | 'crash' | 'unknown' {
        const errorStr = error.toString().toLowerCase();

        if (errorStr.includes('watchman')) {
            return 'watchman';
        }
        if (errorStr.includes('sorbet/config') || errorStr.includes('not configured')) {
            return 'config';
        }
        if (errorStr.includes('crash') || errorStr.includes('segfault') || errorStr.includes('sigsegv')) {
            return 'crash';
        }
        return 'unknown';
    }

    /**
     * FIX: Handle errors with actionable user messages
     */
    private handleError(error: Error, operation: string): void {
        const errorType = this.classifyError(error);
        this.outputChannel.appendLine(`[SORBET] ${operation} error (${errorType}): ${error.message}`);

        switch (errorType) {
            case 'watchman':
                vscode.window.showErrorMessage(
                    'Sorbet requires Watchman for file watching. Install it to use Sorbet.',
                    'Install Guide'
                ).then(action => {
                    if (action === 'Install Guide') {
                        vscode.env.openExternal(vscode.Uri.parse(
                            'https://facebook.github.io/watchman/docs/install.html'
                        ));
                    }
                });
                break;

            case 'config':
                vscode.window.showErrorMessage(
                    'Sorbet not configured in this project. Run "bundle exec srb init"',
                    'Setup Sorbet'
                ).then(action => {
                    if (action === 'Setup Sorbet') {
                        this.runSorbetInit();
                    }
                });
                break;

            case 'crash':
                vscode.window.showErrorMessage(
                    'Sorbet LSP crashed. This may be a Sorbet bug. Falling back to RubyMate.',
                    'Report Bug',
                    'Show Output'
                ).then(action => {
                    if (action === 'Report Bug') {
                        vscode.env.openExternal(vscode.Uri.parse(
                            'https://github.com/sorbet/sorbet/issues/new'
                        ));
                    } else if (action === 'Show Output') {
                        this.outputChannel.show();
                    }
                });
                break;

            default:
                // Unknown error - just log it
                this.outputChannel.appendLine(`[SORBET] Unknown error: ${error.stack || error.message}`);
                break;
        }

        this.recordFailure(errorType, operation);
    }

    /**
     * FIX: Start continuous status monitoring
     * Polls Sorbet status every 10 seconds to detect crashes
     */
    private startStatusPolling(): void {
        // FIX: Don't start polling if already disposed
        if (this.isDisposed) {
            return;
        }

        // FIX: Clear any existing interval first to prevent duplicates
        if (this.statusPollingInterval) {
            clearInterval(this.statusPollingInterval);
        }

        // Poll every 10 seconds
        this.statusPollingInterval = setInterval(() => {
            // FIX: Stop immediately if disposed
            if (this.isDisposed) {
                if (this.statusPollingInterval) {
                    clearInterval(this.statusPollingInterval);
                    this.statusPollingInterval = undefined;
                }
                return;
            }

            // FIX: Guard against closed output channel (e.g., during test teardown)
            try {
                if (!this.sorbetAPI?.status) {
                    return;
                }

                const status = this.sorbetAPI.status;

                if (status === 'error' || status === 'disabled') {
                    this.outputChannel.appendLine(`[SORBET] Status check: ${status} - marking unavailable`);
                    this.sorbetAvailable = false;
                    this.recordFailure('status_error', 'status_poll');
                } else if (status === 'running') {
                    // Reset on successful connection
                    if (this.failureCount > 0) {
                        this.outputChannel.appendLine('[SORBET] Status check: running - resetting circuit breaker');
                        this.resetCircuitBreaker();
                    }
                    if (!this.sorbetAvailable) {
                        this.outputChannel.appendLine('[SORBET] Status check: running - marking available');
                        this.sorbetAvailable = true;
                    }
                }
            } catch (error) {
                // FIX: Silently handle errors during polling (e.g., channel closed during teardown)
                // Stop polling if we get errors
                if (this.statusPollingInterval) {
                    clearInterval(this.statusPollingInterval);
                    this.statusPollingInterval = undefined;
                }
            }
        }, 10000); // 10 seconds

        this.outputChannel.appendLine('[SORBET] Started status polling (10s interval)');
    }

    /**
     * Get type information for a symbol using Sorbet
     * FIX: Added timeout wrapper to prevent hangs
     */
    async getTypeInfo(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<SorbetTypeInfo | null> {
        if (!this.isSorbetAvailable()) {
            return null;
        }

        try {
            // Use VSCode's built-in hover provider which Sorbet registers
            // FIX: Wrapped with timeout
            const hovers = await this.withTimeout(
                Promise.resolve(vscode.commands.executeCommand<vscode.Hover[]>(
                    'vscode.executeHoverProvider',
                    document.uri,
                    position
                )),
                this.DEFAULT_TIMEOUT,
                'getTypeInfo'
            );

            if (!hovers || hovers.length === 0) {
                return null;
            }

            // Extract type information from Sorbet's hover
            const typeInfo = this.parseSorbetHover(hovers);

            if (typeInfo) {
                this.outputChannel.appendLine(`[SORBET] Type info: ${typeInfo.type}`);
            }

            return typeInfo;
        } catch (error) {
            this.outputChannel.appendLine(`[SORBET] Error getting type info: ${error}`);
            this.handleError(error as Error, 'getTypeInfo');
            return null;
        }
    }

    /**
     * Parse Sorbet hover to extract type information
     */
    private parseSorbetHover(hovers: vscode.Hover[]): SorbetTypeInfo | null {
        for (const hover of hovers) {
            const contents = hover.contents;

            for (const content of contents) {
                if (typeof content === 'string') {
                    return this.extractTypeFromMarkdown(content);
                } else if ('value' in content) {
                    return this.extractTypeFromMarkdown(content.value);
                }
            }
        }

        return null;
    }

    /**
     * Extract type information from Sorbet's markdown hover
     */
    private extractTypeFromMarkdown(markdown: string): SorbetTypeInfo | null {
        // Sorbet format: ```ruby\nsig { returns(Type) }\n```
        const sigMatch = markdown.match(/sig\s*\{\s*returns\(([^)]+)\)\s*\}/);
        if (sigMatch) {
            return {
                type: sigMatch[1],
                signature: sigMatch[0]
            };
        }

        // Sorbet format: Type: ClassName
        const typeMatch = markdown.match(/Type:\s*([^\n]+)/);
        if (typeMatch) {
            return {
                type: typeMatch[1].trim()
            };
        }

        // Sorbet format: ```ruby\nClassName\n```
        const codeMatch = markdown.match(/```ruby\n([^\n]+)\n```/);
        if (codeMatch) {
            return {
                type: codeMatch[1].trim()
            };
        }

        return null;
    }

    /**
     * Get enhanced definition using Sorbet
     * FIX: Added timeout wrapper and URI filtering
     */
    async getDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Location[]> {
        if (!this.isSorbetAvailable()) {
            return [];
        }

        try {
            // FIX: Wrapped with timeout
            const locations = await this.withTimeout(
                Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeDefinitionProvider',
                    document.uri,
                    position
                )),
                this.DEFAULT_TIMEOUT,
                'getDefinition'
            );

            if (!locations || locations.length === 0) {
                return [];
            }

            // FIX: Filter out synthetic Sorbet URIs
            const accessibleLocations = locations.filter(loc => this.isAccessibleUri(loc.uri));

            if (accessibleLocations.length > 0) {
                this.outputChannel.appendLine(
                    `[SORBET] Found ${accessibleLocations.length}/${locations.length} accessible definition(s)`
                );
            }

            return accessibleLocations;
        } catch (error) {
            this.outputChannel.appendLine(`[SORBET] Error getting definition: ${error}`);
            this.handleError(error as Error, 'getDefinition');
            return [];
        }
    }

    /**
     * Get enhanced references using Sorbet
     * FIX: Added timeout wrapper and URI filtering
     */
    async getReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        includeDeclaration: boolean = false
    ): Promise<vscode.Location[]> {
        if (!this.isSorbetAvailable()) {
            return [];
        }

        try {
            // FIX: Wrapped with timeout
            const locations = await this.withTimeout(
                Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeReferenceProvider',
                    document.uri,
                    position
                )),
                this.DEFAULT_TIMEOUT,
                'getReferences'
            );

            if (!locations || locations.length === 0) {
                return [];
            }

            // FIX: Filter out synthetic Sorbet URIs
            const accessibleLocations = locations.filter(loc => this.isAccessibleUri(loc.uri));

            if (accessibleLocations.length > 0) {
                this.outputChannel.appendLine(
                    `[SORBET] Found ${accessibleLocations.length}/${locations.length} accessible reference(s)`
                );
            }

            return accessibleLocations;
        } catch (error) {
            this.outputChannel.appendLine(`[SORBET] Error getting references: ${error}`);
            this.handleError(error as Error, 'getReferences');
            return [];
        }
    }

    /**
     * Check if document has Sorbet signatures
     */
    async hasSorbetSignatures(document: vscode.TextDocument): Promise<boolean> {
        const text = document.getText();

        // Check for common Sorbet patterns
        const hasSig = text.includes('sig {') || text.includes('sig do');
        const hasTypedComment = text.includes('# typed:');
        const hasExtendSig = text.includes('extend T::Sig');

        const hasSorbet = hasSig || hasTypedComment || hasExtendSig;

        if (hasSorbet) {
            this.outputChannel.appendLine(`[SORBET] Document has Sorbet signatures`);
        }

        return hasSorbet;
    }

    /**
     * Get Sorbet type level for file
     * FIX: Check first 50 lines instead of 10 (handles long file headers)
     */
    getSorbetTypeLevel(document: vscode.TextDocument): string | null {
        const text = document.getText();

        // FIX: Check first 50 lines for # typed: comment (handles copyright headers, etc.)
        const lines = text.split('\n').slice(0, 50);

        for (const line of lines) {
            // FIX: Allow optional whitespace around colon and value
            const match = line.match(/#\s*typed:\s*(\w+)/);
            if (match) {
                return match[1]; // strict, strong, true, false, ignore
            }
        }

        return null;
    }

    /**
     * Enhance hover with Sorbet type information
     */
    async enhanceHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        baseHover: vscode.Hover | null
    ): Promise<vscode.Hover | null> {
        const typeInfo = await this.getTypeInfo(document, position);

        if (!typeInfo) {
            return baseHover;
        }

        const typeMarkdown = new vscode.MarkdownString();
        typeMarkdown.appendCodeblock(`Type: ${typeInfo.type}`, 'ruby');

        if (typeInfo.signature) {
            typeMarkdown.appendMarkdown('\n\n');
            typeMarkdown.appendCodeblock(typeInfo.signature, 'ruby');
        }

        if (typeInfo.documentation) {
            typeMarkdown.appendMarkdown('\n\n');
            typeMarkdown.appendMarkdown(typeInfo.documentation);
        }

        // Combine with base hover if it exists
        if (baseHover) {
            const combined = new vscode.Hover([
                ...baseHover.contents,
                new vscode.MarkdownString('---'),
                typeMarkdown
            ]);
            return combined;
        }

        return new vscode.Hover(typeMarkdown);
    }

    /**
     * Show Sorbet status in output
     */
    showStatus(): void {
        this.outputChannel.appendLine('');
        this.outputChannel.appendLine('=== Sorbet Integration Status ===');
        this.outputChannel.appendLine(`Available: ${this.sorbetAvailable ? '✓ Yes' : '✗ No'}`);

        if (this.sorbetExtension) {
            this.outputChannel.appendLine(`Extension: ${this.sorbetExtension.id}`);
            this.outputChannel.appendLine(`Version: ${this.sorbetExtension.packageJSON.version}`);
            this.outputChannel.appendLine(`Active: ${this.sorbetExtension.isActive}`);
        } else {
            this.outputChannel.appendLine('Extension: Not installed');
            this.outputChannel.appendLine('');
            this.outputChannel.appendLine('To install Sorbet:');
            this.outputChannel.appendLine('1. Install extension: https://marketplace.visualstudio.com/items?itemName=sorbet.sorbet-vscode-extension');
            this.outputChannel.appendLine('2. Add to Gemfile: gem "sorbet", group: :development');
            this.outputChannel.appendLine('3. Run: bundle exec srb init');
        }
        this.outputChannel.appendLine('');
    }

    /**
     * Check if Sorbet is configured in workspace
     */
    async isSorbetConfigured(): Promise<boolean> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return false;
        }

        try {
            // Check for sorbet/ directory
            const sorbetDir = vscode.Uri.joinPath(workspaceFolder.uri, 'sorbet');
            const stat = await vscode.workspace.fs.stat(sorbetDir);

            if (stat.type === vscode.FileType.Directory) {
                this.outputChannel.appendLine('[SORBET] Found sorbet/ directory - project is configured');
                return true;
            }
        } catch {
            // Directory doesn't exist
        }

        return false;
    }

    /**
     * Prompt user to setup Sorbet if extension installed but not configured
     */
    async promptSorbetSetup(): Promise<void> {
        if (!this.sorbetAvailable) {
            return;
        }

        const isConfigured = await this.isSorbetConfigured();
        if (isConfigured) {
            return;
        }

        // Sorbet extension installed but project not configured
        const selection = await vscode.window.showInformationMessage(
            'Sorbet extension detected but project not configured. Setup Sorbet?',
            'Setup Now',
            'Learn More',
            'Not Now'
        );

        if (selection === 'Setup Now') {
            await this.runSorbetInit();
        } else if (selection === 'Learn More') {
            await vscode.env.openExternal(
                vscode.Uri.parse('https://sorbet.org/docs/adopting')
            );
        }
    }

    /**
     * Run sorbet init command to setup project
     */
    private async runSorbetInit(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const terminal = vscode.window.createTerminal({
            name: 'Sorbet Setup',
            cwd: workspaceFolder.uri.fsPath
        });

        terminal.show();
        terminal.sendText('# Setting up Sorbet...');
        terminal.sendText('# Step 1: Install Sorbet gem');
        terminal.sendText('bundle add sorbet --group development');
        terminal.sendText('# Step 2: Initialize Sorbet');
        terminal.sendText('bundle exec srb init');
        terminal.sendText('# Step 3: Generate RBI files');
        terminal.sendText('bundle exec srb rbi update');
        terminal.sendText('echo "✓ Sorbet setup complete! Reload window to activate."');

        vscode.window.showInformationMessage(
            'Sorbet setup commands sent to terminal. Reload window after completion.',
            'Reload Window'
        ).then(selection => {
            if (selection === 'Reload Window') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });
    }
}

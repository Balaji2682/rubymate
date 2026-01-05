import * as vscode from 'vscode';
import * as crypto from 'crypto';

/**
 * Privacy-respecting telemetry manager
 *
 * Data Storage Strategy:
 * 1. PRIMARY: Local storage (VS Code globalState) - Always saved locally
 * 2. OPTIONAL: VS Code telemetry API - Only if user has telemetry enabled
 * 3. EXPORT: Can export to JSON for debugging
 *
 * Privacy Guarantees:
 * - Respects VS Code's telemetry.telemetryLevel setting
 * - No personally identifiable information (PII)
 * - All file paths are hashed
 * - Session IDs are anonymized
 * - Data stored locally by default
 */

export interface TelemetryData {
    // Feature usage counts
    featureUsage: Map<string, number>;

    // Command usage counts
    commandUsage: Map<string, number>;

    // Provider usage counts (hover, completion, etc.)
    providerUsage: Map<string, number>;

    // Error tracking
    errors: ErrorMetric[];

    // Performance metrics
    performance: PerformanceMetric[];

    // Session info
    sessionInfo: {
        installDate: number;
        lastUsed: number;
        sessionCount: number;
        totalActivationTime: number;
    };

    // Extension version
    version: string;
}

export interface ErrorMetric {
    timestamp: number;
    errorType: string;
    feature: string;
    stackHash?: string;  // Hashed stack trace (not full trace)
    count: number;
}

export interface PerformanceMetric {
    timestamp: number;
    operation: string;
    duration: number;
    itemCount?: number;
}

/**
 * Manages privacy-respecting telemetry for the extension
 */
export class TelemetryManager {
    private context: vscode.ExtensionContext;
    private outputChannel: vscode.OutputChannel;
    private telemetryReporter?: vscode.TelemetryLogger;
    private sessionId: string;

    // In-memory cache
    private featureUsage: Map<string, number> = new Map();
    private commandUsage: Map<string, number> = new Map();
    private providerUsage: Map<string, number> = new Map();
    private errors: ErrorMetric[] = [];
    private performance: PerformanceMetric[] = [];

    // Performance tracking
    private operationTimers: Map<string, number> = new Map();

    // Session tracking
    private sessionStartTime: number = Date.now();
    private saveInterval?: NodeJS.Timeout;

    constructor(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
        this.context = context;
        this.outputChannel = outputChannel;
        this.sessionId = this.generateSessionId();

        // Initialize telemetry reporter (respects user settings)
        this.initializeTelemetryReporter();

        // Load existing data from storage
        this.loadFromStorage();

        // Update session info
        this.updateSessionInfo();

        // Save periodically (every 5 minutes)
        this.saveInterval = setInterval(() => this.saveToStorage(), 5 * 60 * 1000);

        // Show privacy notice on first run
        this.showPrivacyNoticeIfNeeded();

        this.outputChannel.appendLine('Telemetry manager initialized (privacy-respecting mode)');
        this.outputChannel.appendLine(`Session ID: ${this.sessionId}`);
        this.outputChannel.appendLine(`Telemetry storage: VS Code GlobalState (local)`);
    }

    /**
     * Initialize VS Code's telemetry reporter
     * Only sends data if user has telemetry enabled
     */
    private initializeTelemetryReporter(): void {
        try {
            // Create telemetry logger that respects user settings
            this.telemetryReporter = vscode.env.createTelemetryLogger({
                sendEventData: (eventName, data) => {
                    // This is only called if user has telemetry enabled
                    // You can optionally send to your own endpoint here
                    this.outputChannel.appendLine(`Telemetry event: ${eventName}`);
                },
                sendErrorData: (error, data) => {
                    // Error telemetry (only if enabled)
                    this.outputChannel.appendLine(`Telemetry error: ${error.name}`);
                }
            });
        } catch (error) {
            // Telemetry not available, continue without it
            this.outputChannel.appendLine('Telemetry reporter not available (continuing in local-only mode)');
        }
    }

    /**
     * Generate anonymized session ID
     */
    private generateSessionId(): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36);
        return crypto.createHash('sha256').update(`${timestamp}-${random}`).digest('hex').substring(0, 16);
    }

    /**
     * Hash sensitive data (file paths, stack traces)
     */
    private hashSensitiveData(data: string): string {
        return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
    }

    /**
     * Load telemetry data from VS Code storage
     */
    private loadFromStorage(): void {
        try {
            const stored = this.context.globalState.get<any>('rubymate.telemetry');
            if (stored) {
                this.featureUsage = new Map(Object.entries(stored.featureUsage || {}));
                this.commandUsage = new Map(Object.entries(stored.commandUsage || {}));
                this.providerUsage = new Map(Object.entries(stored.providerUsage || {}));
                this.errors = stored.errors || [];
                this.performance = stored.performance || [];

                this.outputChannel.appendLine(`Loaded telemetry data: ${this.featureUsage.size} features tracked`);
            }
        } catch (error) {
            this.outputChannel.appendLine(`Failed to load telemetry: ${error}`);
        }
    }

    /**
     * Save telemetry data to VS Code storage (local)
     */
    private async saveToStorage(): Promise<void> {
        try {
            const data = {
                featureUsage: Object.fromEntries(this.featureUsage),
                commandUsage: Object.fromEntries(this.commandUsage),
                providerUsage: Object.fromEntries(this.providerUsage),
                errors: this.errors.slice(-100), // Keep last 100 errors
                performance: this.performance.slice(-1000), // Keep last 1000 metrics
                sessionInfo: this.context.globalState.get('rubymate.sessionInfo'),
                version: this.context.extension.packageJSON.version
            };

            await this.context.globalState.update('rubymate.telemetry', data);
            this.outputChannel.appendLine('Telemetry data saved to local storage');
        } catch (error) {
            this.outputChannel.appendLine(`Failed to save telemetry: ${error}`);
        }
    }

    /**
     * Update session information
     */
    private updateSessionInfo(): void {
        const sessionInfo = this.context.globalState.get<any>('rubymate.sessionInfo') || {
            installDate: Date.now(),
            sessionCount: 0,
            totalActivationTime: 0
        };

        sessionInfo.lastUsed = Date.now();
        sessionInfo.sessionCount += 1;

        // Track session start time for duration calculation
        this.sessionStartTime = Date.now();

        this.context.globalState.update('rubymate.sessionInfo', sessionInfo);
    }

    /**
     * Update total activation time (call on dispose)
     */
    private updateActivationTime(): void {
        const sessionInfo = this.context.globalState.get<any>('rubymate.sessionInfo');
        if (sessionInfo) {
            const sessionDuration = Date.now() - this.sessionStartTime;
            sessionInfo.totalActivationTime = (sessionInfo.totalActivationTime || 0) + sessionDuration;
            this.context.globalState.update('rubymate.sessionInfo', sessionInfo);
            this.outputChannel.appendLine(`Session duration: ${Math.round(sessionDuration / 1000)}s`);
        }
    }

    /**
     * Show privacy notice on first run
     */
    private async showPrivacyNoticeIfNeeded(): Promise<void> {
        const hasSeenNotice = this.context.globalState.get<boolean>('rubymate.telemetry.privacyNoticeSeen');

        if (!hasSeenNotice) {
            const choice = await vscode.window.showInformationMessage(
                'RubyMate collects anonymous usage statistics to improve the extension. ' +
                'All data is stored locally and respects VS Code\'s telemetry settings. ' +
                'No personally identifiable information is collected.',
                'Learn More',
                'View Statistics',
                'OK'
            );

            if (choice === 'Learn More') {
                vscode.env.openExternal(vscode.Uri.parse('https://github.com/yourusername/rubymate#telemetry'));
            } else if (choice === 'View Statistics') {
                this.showStatistics();
            }

            await this.context.globalState.update('rubymate.telemetry.privacyNoticeSeen', true);
            this.outputChannel.appendLine('Privacy notice shown to user');
        }
    }

    /**
     * Track feature usage
     */
    trackFeature(featureName: string): void {
        const current = this.featureUsage.get(featureName) || 0;
        this.featureUsage.set(featureName, current + 1);

        // Send to telemetry if enabled
        this.telemetryReporter?.logUsage('feature', {
            name: featureName,
            sessionId: this.sessionId
        });

        // Comprehensive logging
        this.outputChannel.appendLine(`[TELEMETRY] Feature used: ${featureName} (total: ${current + 1})`);
    }

    /**
     * Track command usage
     */
    trackCommand(commandName: string): void {
        const current = this.commandUsage.get(commandName) || 0;
        this.commandUsage.set(commandName, current + 1);

        this.telemetryReporter?.logUsage('command', {
            name: commandName,
            sessionId: this.sessionId
        });

        // Comprehensive logging
        this.outputChannel.appendLine(`[TELEMETRY] Command executed: ${commandName} (total: ${current + 1})`);
    }

    /**
     * Track provider usage (hover, completion, etc.)
     */
    trackProvider(providerName: string): void {
        const current = this.providerUsage.get(providerName) || 0;
        this.providerUsage.set(providerName, current + 1);

        this.telemetryReporter?.logUsage('provider', {
            name: providerName,
            sessionId: this.sessionId
        });

        // Log every 10th use to avoid spam
        if ((current + 1) % 10 === 0) {
            this.outputChannel.appendLine(`[TELEMETRY] Provider: ${providerName} (total: ${current + 1})`);
        }
    }

    /**
     * Track error (anonymized)
     */
    trackError(errorType: string, feature: string, error?: Error): void {
        // Find existing error or create new
        const existingIndex = this.errors.findIndex(
            e => e.errorType === errorType && e.feature === feature
        );

        if (existingIndex >= 0) {
            // Increment existing error count
            this.errors[existingIndex].count += 1;
            this.errors[existingIndex].timestamp = Date.now();
        } else {
            // Add new error
            const stackHash = error?.stack ? this.hashSensitiveData(error.stack) : undefined;

            this.errors.push({
                timestamp: Date.now(),
                errorType,
                feature,
                stackHash,
                count: 1
            });
        }

        // Send to telemetry if enabled
        this.telemetryReporter?.logError(new Error(errorType), {
            feature,
            sessionId: this.sessionId
        });

        // Comprehensive error logging
        this.outputChannel.appendLine('');
        this.outputChannel.appendLine(`[TELEMETRY] ❌ ERROR TRACKED:`);
        this.outputChannel.appendLine(`  Type: ${errorType}`);
        this.outputChannel.appendLine(`  Feature: ${feature}`);
        this.outputChannel.appendLine(`  Count: ${existingIndex >= 0 ? this.errors[existingIndex].count : 1}`);
        if (error) {
            this.outputChannel.appendLine(`  Message: ${error.message}`);
            this.outputChannel.appendLine(`  Stack Hash: ${this.hashSensitiveData(error.stack || '')}`);
        }
        this.outputChannel.appendLine('');
    }

    /**
     * Start tracking performance for an operation
     */
    startPerformance(operation: string): void {
        this.operationTimers.set(operation, Date.now());
    }

    /**
     * End tracking performance and record metric
     */
    endPerformance(operation: string, itemCount?: number): void {
        const startTime = this.operationTimers.get(operation);
        if (!startTime) {
            return;
        }

        const duration = Date.now() - startTime;
        this.operationTimers.delete(operation);

        this.performance.push({
            timestamp: Date.now(),
            operation,
            duration,
            itemCount
        });

        this.telemetryReporter?.logUsage('performance', {
            operation,
            duration: duration.toString(),
            itemCount: itemCount?.toString(),
            sessionId: this.sessionId
        });

        this.outputChannel.appendLine(`Performance: ${operation} took ${duration}ms${itemCount ? ` (${itemCount} items)` : ''}`);
    }

    /**
     * Get usage statistics for display
     */
    getStatistics(): any {
        // Sort features by usage
        const topFeatures = Array.from(this.featureUsage.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        const topCommands = Array.from(this.commandUsage.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        const topProviders = Array.from(this.providerUsage.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        // Calculate average performance
        const avgPerformance = new Map<string, { avg: number; count: number }>();
        for (const metric of this.performance) {
            const current = avgPerformance.get(metric.operation) || { avg: 0, count: 0 };
            current.avg = ((current.avg * current.count) + metric.duration) / (current.count + 1);
            current.count += 1;
            avgPerformance.set(metric.operation, current);
        }

        // Recent errors
        const recentErrors = this.errors.slice(-10).reverse();

        return {
            topFeatures,
            topCommands,
            topProviders,
            averagePerformance: Array.from(avgPerformance.entries()).map(([op, data]) => ({
                operation: op,
                averageDuration: Math.round(data.avg),
                count: data.count
            })),
            recentErrors,
            sessionInfo: this.context.globalState.get('rubymate.sessionInfo'),
            totalFeatureUsage: Array.from(this.featureUsage.values()).reduce((a, b) => a + b, 0),
            totalCommands: Array.from(this.commandUsage.values()).reduce((a, b) => a + b, 0)
        };
    }

    /**
     * Export telemetry data to JSON file (for debugging)
     */
    async exportToFile(): Promise<void> {
        this.outputChannel.appendLine('[TELEMETRY] Starting telemetry export...');

        const stats = this.getStatistics();

        // Add metadata to export
        const exportData = {
            exportedAt: new Date().toISOString(),
            sessionId: this.sessionId,
            extensionVersion: this.context.extension.packageJSON.version,
            vsCodeVersion: vscode.version,
            statistics: stats
        };

        const json = JSON.stringify(exportData, null, 2);

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('rubymate-telemetry.json'),
            filters: {
                'JSON': ['json']
            }
        });

        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf-8'));
            vscode.window.showInformationMessage(`Telemetry exported to ${uri.fsPath}`);
            this.outputChannel.appendLine(`[TELEMETRY] Exported to: ${uri.fsPath}`);
            this.outputChannel.appendLine(`[TELEMETRY] Export size: ${json.length} bytes`);
        } else {
            this.outputChannel.appendLine('[TELEMETRY] Export cancelled by user');
        }
    }

    /**
     * Show telemetry statistics
     */
    showStatistics(): void {
        const stats = this.getStatistics();

        const output = [
            '=== RubyMate Usage Statistics ===',
            '',
            '📊 Top Features:',
            ...stats.topFeatures.map(([name, count]: [string, number]) => `  ${name}: ${count} uses`),
            '',
            '⌨️  Top Commands:',
            ...stats.topCommands.map(([name, count]: [string, number]) => `  ${name}: ${count} uses`),
            '',
            '🔌 Top Providers:',
            ...stats.topProviders.map(([name, count]: [string, number]) => `  ${name}: ${count} uses`),
            '',
            '⚡ Performance (Average):',
            ...stats.averagePerformance.map((p: any) => `  ${p.operation}: ${p.averageDuration}ms (${p.count} samples)`),
            '',
            '❌ Recent Errors:',
            ...stats.recentErrors.map((e: ErrorMetric) => `  ${e.errorType} in ${e.feature} (count: ${e.count})`),
            '',
            '📈 Session Info:',
            `  Install Date: ${new Date(stats.sessionInfo.installDate).toLocaleDateString()}`,
            `  Last Used: ${new Date(stats.sessionInfo.lastUsed).toLocaleDateString()}`,
            `  Sessions: ${stats.sessionInfo.sessionCount}`,
            `  Total Feature Usage: ${stats.totalFeatureUsage}`,
            `  Total Commands: ${stats.totalCommands}`,
            '',
            '🔒 Privacy: All data stored locally. No PII collected.',
            '   Telemetry respects VS Code telemetry settings.'
        ].join('\n');

        this.outputChannel.show();
        this.outputChannel.appendLine(output);
    }

    /**
     * Clear all telemetry data
     */
    async clearData(): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            'Clear all telemetry data? This cannot be undone.',
            'Clear',
            'Cancel'
        );

        if (confirm === 'Clear') {
            this.featureUsage.clear();
            this.commandUsage.clear();
            this.providerUsage.clear();
            this.errors = [];
            this.performance = [];

            await this.context.globalState.update('rubymate.telemetry', undefined);
            await this.context.globalState.update('rubymate.sessionInfo', undefined);

            vscode.window.showInformationMessage('Telemetry data cleared');
            this.outputChannel.appendLine('All telemetry data cleared');
        }
    }

    /**
     * Save and cleanup
     */
    async dispose(): Promise<void> {
        this.outputChannel.appendLine('Telemetry manager disposing...');

        // Clear interval timer
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
            this.saveInterval = undefined;
        }

        // Update activation time before saving
        this.updateActivationTime();

        // Final save
        await this.saveToStorage();

        this.telemetryReporter?.dispose();

        this.outputChannel.appendLine('Telemetry manager disposed successfully');
    }
}

import * as vscode from 'vscode';
import { SorbetIntegration } from './sorbetIntegration';

/**
 * Manages Sorbet diagnostics (type errors) display
 *
 * Features:
 * - Collects type errors from Sorbet LSP
 * - Displays inline with red squiggles
 * - Provides detailed error messages
 * - Updates on file save or change
 *
 * Note: This complements (not replaces) Sorbet extension's diagnostics
 * We collect them for telemetry and custom error handling
 */
export class SorbetDiagnostics {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private outputChannel: vscode.OutputChannel;

    constructor(
        private sorbetIntegration: SorbetIntegration,
        outputChannel: vscode.OutputChannel
    ) {
        this.outputChannel = outputChannel;
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('sorbet-rubymate');
    }

    /**
     * Start listening for document changes and collecting diagnostics
     */
    startListening(context: vscode.ExtensionContext): void {
        if (!this.sorbetIntegration.isSorbetAvailable()) {
            this.outputChannel.appendLine('[SORBET DIAGNOSTICS] Sorbet unavailable, skipping diagnostics');
            return;
        }

        // Listen for diagnostics from Sorbet extension
        context.subscriptions.push(
            vscode.languages.onDidChangeDiagnostics(event => {
                this.handleDiagnosticChanges(event);
            })
        );

        // Update diagnostics on document open
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(document => {
                if (document.languageId === 'ruby') {
                    this.updateDiagnostics(document);
                }
            })
        );

        // Update diagnostics on document save
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(document => {
                if (document.languageId === 'ruby') {
                    this.updateDiagnostics(document);
                }
            })
        );

        this.outputChannel.appendLine('[SORBET DIAGNOSTICS] Started listening for diagnostics');
    }

    /**
     * Handle diagnostic changes from Sorbet
     */
    private handleDiagnosticChanges(event: vscode.DiagnosticChangeEvent): void {
        for (const uri of event.uris) {
            // Only process Ruby files
            if (!uri.fsPath.endsWith('.rb')) {
                continue;
            }

            // Get diagnostics from all sources
            const allDiagnostics = vscode.languages.getDiagnostics(uri);

            // Filter to Sorbet diagnostics (source usually contains 'sorbet')
            const sorbetDiagnostics = allDiagnostics.filter(diag =>
                diag.source?.toLowerCase().includes('sorbet') ||
                diag.code?.toString().includes('sorbet')
            );

            if (sorbetDiagnostics.length > 0) {
                this.outputChannel.appendLine(
                    `[SORBET DIAGNOSTICS] Found ${sorbetDiagnostics.length} error(s) in ${uri.fsPath}`
                );

                // Log errors for telemetry
                for (const diag of sorbetDiagnostics) {
                    this.outputChannel.appendLine(
                        `  Line ${diag.range.start.line + 1}: ${diag.message}`
                    );
                }
            }
        }
    }

    /**
     * Update diagnostics for a specific document
     */
    private async updateDiagnostics(document: vscode.TextDocument): Promise<void> {
        // Only update for files with Sorbet signatures
        const hasSorbet = await this.sorbetIntegration.hasSorbetSignatures(document);
        if (!hasSorbet) {
            return;
        }

        try {
            // Get current diagnostics from Sorbet
            const allDiagnostics = vscode.languages.getDiagnostics(document.uri);

            // Filter Sorbet diagnostics
            const sorbetDiagnostics = allDiagnostics.filter(diag =>
                diag.source?.toLowerCase().includes('sorbet')
            );

            if (sorbetDiagnostics.length > 0) {
                this.outputChannel.appendLine(
                    `[SORBET DIAGNOSTICS] Updated ${sorbetDiagnostics.length} diagnostic(s) for ${document.uri.fsPath}`
                );
            }
        } catch (error) {
            this.outputChannel.appendLine(`[SORBET DIAGNOSTICS] Error updating: ${error}`);
        }
    }

    /**
     * Get count of Sorbet errors across workspace
     */
    getSorbetErrorCount(): number {
        let count = 0;

        for (const uri of vscode.workspace.textDocuments.map(d => d.uri)) {
            const diagnostics = vscode.languages.getDiagnostics(uri);
            const sorbetErrors = diagnostics.filter(diag =>
                diag.source?.toLowerCase().includes('sorbet') &&
                diag.severity === vscode.DiagnosticSeverity.Error
            );
            count += sorbetErrors.length;
        }

        return count;
    }

    /**
     * Get count of Sorbet warnings across workspace
     */
    getSorbetWarningCount(): number {
        let count = 0;

        for (const uri of vscode.workspace.textDocuments.map(d => d.uri)) {
            const diagnostics = vscode.languages.getDiagnostics(uri);
            const sorbetWarnings = diagnostics.filter(diag =>
                diag.source?.toLowerCase().includes('sorbet') &&
                diag.severity === vscode.DiagnosticSeverity.Warning
            );
            count += sorbetWarnings.length;
        }

        return count;
    }

    /**
     * Show summary of Sorbet diagnostics
     */
    showDiagnosticsSummary(): void {
        const errors = this.getSorbetErrorCount();
        const warnings = this.getSorbetWarningCount();

        this.outputChannel.show();
        this.outputChannel.appendLine('');
        this.outputChannel.appendLine('=== Sorbet Diagnostics Summary ===');
        this.outputChannel.appendLine(`Errors: ${errors}`);
        this.outputChannel.appendLine(`Warnings: ${warnings}`);
        this.outputChannel.appendLine('');

        if (errors + warnings === 0) {
            this.outputChannel.appendLine('✓ No Sorbet type errors found!');
        } else {
            this.outputChannel.appendLine('View detailed errors in the Problems panel (Ctrl+Shift+M)');
        }
    }

    /**
     * Dispose of diagnostic collection
     */
    dispose(): void {
        this.diagnosticCollection.dispose();
    }
}

import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as path from 'path';
import { promisify } from 'util';

const execAsync = promisify(child_process.exec);

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
}

export interface ValidationError {
    setting: string;
    message: string;
    action?: string;
}

export interface ValidationWarning {
    setting: string;
    message: string;
    suggestion?: string;
}

/**
 * Validates all RubyMate configuration settings
 */
export class ConfigValidator {
    private outputChannel: vscode.OutputChannel;
    private validationCache: Map<string, { timestamp: number; result: boolean }> = new Map();
    private static readonly CACHE_DURATION_MS = 60000; // 1 minute cache

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Validate all configuration settings
     */
    async validateAll(): Promise<ValidationResult> {
        const config = vscode.workspace.getConfiguration('rubymate');
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];

        this.outputChannel.appendLine('Validating RubyMate configuration...');

        // Validate rubyPath (critical)
        const rubyPathResult = await this.validateRubyPath(config);
        if (!rubyPathResult.valid) {
            errors.push({
                setting: 'rubymate.rubyPath',
                message: rubyPathResult.message,
                action: 'Open Settings'
            });
        } else if (rubyPathResult.warning) {
            warnings.push({
                setting: 'rubymate.rubyPath',
                message: rubyPathResult.warning,
                suggestion: rubyPathResult.suggestion
            });
        }

        // Validate gemPath (optional, but validate if set)
        const gemPathResult = await this.validateGemPath(config);
        if (!gemPathResult.valid) {
            warnings.push({
                setting: 'rubymate.gemPath',
                message: gemPathResult.message,
                suggestion: 'Leave empty to use default gem path or provide a valid directory'
            });
        }

        // Validate testFramework
        const testFrameworkResult = this.validateTestFramework(config);
        if (!testFrameworkResult.valid) {
            errors.push({
                setting: 'rubymate.testFramework',
                message: testFrameworkResult.message,
                action: 'Open Settings'
            });
        }

        // Validate n1DetectionExcludePaths
        const excludePathsResult = this.validateExcludePaths(config);
        if (!excludePathsResult.valid) {
            warnings.push({
                setting: 'rubymate.n1DetectionExcludePaths',
                message: excludePathsResult.message,
                suggestion: 'Use valid glob patterns like "**/*.rb" or "**/lib/**"'
            });
        }

        // Log results
        if (errors.length === 0 && warnings.length === 0) {
            this.outputChannel.appendLine('✓ Configuration validation passed');
        } else {
            if (errors.length > 0) {
                this.outputChannel.appendLine(`✗ Found ${errors.length} configuration error(s)`);
                errors.forEach(err => {
                    this.outputChannel.appendLine(`  - ${err.setting}: ${err.message}`);
                });
            }
            if (warnings.length > 0) {
                this.outputChannel.appendLine(`⚠ Found ${warnings.length} configuration warning(s)`);
                warnings.forEach(warn => {
                    this.outputChannel.appendLine(`  - ${warn.setting}: ${warn.message}`);
                });
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate Ruby executable path
     */
    private async validateRubyPath(config: vscode.WorkspaceConfiguration): Promise<{
        valid: boolean;
        message: string;
        warning?: string;
        suggestion?: string;
    }> {
        const rubyPath = config.get<string>('rubyPath', 'ruby');

        if (!rubyPath || rubyPath.trim() === '') {
            return {
                valid: false,
                message: 'Ruby path is empty. Please provide a valid path to the Ruby executable.'
            };
        }

        // Check cache first
        const cacheKey = `rubyPath:${rubyPath}`;
        const cached = this.validationCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < ConfigValidator.CACHE_DURATION_MS) {
            return {
                valid: cached.result,
                message: cached.result ? 'Ruby path is valid' : 'Ruby executable not found or not working'
            };
        }

        try {
            // Try to execute ruby --version
            const { stdout, stderr } = await execAsync(`${rubyPath} --version`, {
                shell: process.env.SHELL || '/bin/bash',
                env: process.env,
                timeout: 5000 // 5 second timeout
            });

            const version = stdout.trim();
            this.outputChannel.appendLine(`✓ Ruby found: ${version}`);

            // Cache successful result
            this.validationCache.set(cacheKey, { timestamp: Date.now(), result: true });

            // Check version and provide warnings
            const versionMatch = version.match(/ruby (\d+)\.(\d+)\.(\d+)/);
            if (versionMatch) {
                const major = parseInt(versionMatch[1]);
                const minor = parseInt(versionMatch[2]);

                // Warn if Ruby version is very old
                if (major < 2 || (major === 2 && minor < 7)) {
                    return {
                        valid: true,
                        message: 'Ruby path is valid',
                        warning: `Ruby ${major}.${minor} is outdated. Some features may not work correctly.`,
                        suggestion: 'Consider upgrading to Ruby 3.0 or later for best compatibility'
                    };
                }
            }

            return {
                valid: true,
                message: 'Ruby path is valid'
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`✗ Ruby validation failed: ${errorMessage}`);

            // Cache failed result
            this.validationCache.set(cacheKey, { timestamp: Date.now(), result: false });

            // Provide helpful error message
            let message = `Ruby executable not found at "${rubyPath}".`;

            if (errorMessage.includes('ENOENT')) {
                message += ' The path does not exist or is not executable.';
            } else if (errorMessage.includes('timeout')) {
                message += ' The command timed out (took longer than 5 seconds).';
            }

            return {
                valid: false,
                message
            };
        }
    }

    /**
     * Validate gem path
     */
    private async validateGemPath(config: vscode.WorkspaceConfiguration): Promise<{
        valid: boolean;
        message: string;
    }> {
        const gemPath = config.get<string>('gemPath', '');

        // Empty gem path is valid (means use default)
        if (!gemPath || gemPath.trim() === '') {
            return {
                valid: true,
                message: 'Using default gem path'
            };
        }

        try {
            // Check if the path exists
            const stat = await vscode.workspace.fs.stat(vscode.Uri.file(gemPath));

            // Check if it's a directory
            if (stat.type !== vscode.FileType.Directory) {
                return {
                    valid: false,
                    message: `Gem path "${gemPath}" exists but is not a directory`
                };
            }

            this.outputChannel.appendLine(`✓ Gem path is valid: ${gemPath}`);
            return {
                valid: true,
                message: 'Gem path is valid'
            };
        } catch (error) {
            return {
                valid: false,
                message: `Gem path "${gemPath}" does not exist or is not accessible`
            };
        }
    }

    /**
     * Validate test framework setting
     */
    private validateTestFramework(config: vscode.WorkspaceConfiguration): {
        valid: boolean;
        message: string;
    } {
        const testFramework = config.get<string>('testFramework', 'auto');
        const validFrameworks = ['rspec', 'minitest', 'auto'];

        if (!validFrameworks.includes(testFramework)) {
            return {
                valid: false,
                message: `Invalid test framework "${testFramework}". Must be one of: ${validFrameworks.join(', ')}`
            };
        }

        return {
            valid: true,
            message: 'Test framework is valid'
        };
    }

    /**
     * Validate exclude paths for N+1 detection
     */
    private validateExcludePaths(config: vscode.WorkspaceConfiguration): {
        valid: boolean;
        message: string;
    } {
        const excludePaths = config.get<string[]>('n1DetectionExcludePaths', []);

        if (!Array.isArray(excludePaths)) {
            return {
                valid: false,
                message: 'n1DetectionExcludePaths must be an array of glob patterns'
            };
        }

        // Validate each pattern
        const invalidPatterns: string[] = [];
        for (const pattern of excludePaths) {
            if (typeof pattern !== 'string' || pattern.trim() === '') {
                invalidPatterns.push(pattern);
            }
        }

        if (invalidPatterns.length > 0) {
            return {
                valid: false,
                message: `Invalid exclude patterns found: ${invalidPatterns.join(', ')}`
            };
        }

        return {
            valid: true,
            message: 'Exclude paths are valid'
        };
    }

    /**
     * Show validation errors to user with actionable buttons
     */
    async showValidationErrors(result: ValidationResult): Promise<void> {
        if (result.valid && result.warnings.length === 0) {
            return; // Nothing to show
        }

        // Show critical errors first
        if (result.errors.length > 0) {
            const firstError = result.errors[0];
            const message = `RubyMate Configuration Error: ${firstError.message}`;

            const actions = ['Open Settings', 'Show Output', 'Dismiss'];
            const selection = await vscode.window.showErrorMessage(message, ...actions);

            if (selection === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', firstError.setting);
            } else if (selection === 'Show Output') {
                this.outputChannel.show();
            }
        }
        // Show warnings
        else if (result.warnings.length > 0) {
            const firstWarning = result.warnings[0];
            const message = `RubyMate Configuration Warning: ${firstWarning.message}`;

            const actions = ['Open Settings', 'Dismiss'];
            const selection = await vscode.window.showWarningMessage(message, ...actions);

            if (selection === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', firstWarning.setting);
            }
        }
    }

    /**
     * Clear validation cache
     */
    clearCache(): void {
        this.validationCache.clear();
        this.outputChannel.appendLine('Validation cache cleared');
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.validationCache.clear();
    }
}

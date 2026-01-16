import * as vscode from 'vscode';
import { SimpleMetricsCollector, MetricsData, withMetrics } from '../shared/patterns/decorator';

/**
 * Performance Monitor for RubyMate
 *
 * Tracks performance metrics for providers and features using the Decorator pattern.
 * Provides insights for optimization and debugging.
 */

// Global metrics collector for all providers
const globalMetrics = new SimpleMetricsCollector();

/**
 * Get the global metrics collector
 */
export function getGlobalMetrics(): SimpleMetricsCollector {
    return globalMetrics;
}

/**
 * Provider categories for organizing metrics
 */
export type ProviderCategory =
    | 'definition'
    | 'completion'
    | 'hover'
    | 'reference'
    | 'symbol'
    | 'callHierarchy'
    | 'indexing'
    | 'navigation';

/**
 * Performance report for a provider
 */
export interface ProviderPerformanceReport {
    category: ProviderCategory;
    methodName: string;
    metrics: MetricsData;
    status: 'healthy' | 'slow' | 'critical';
    recommendation?: string;
}

/**
 * Thresholds for performance status
 */
const PERFORMANCE_THRESHOLDS = {
    healthy: 100,    // < 100ms is healthy
    slow: 500,       // 100-500ms is slow
    critical: 1000   // > 1000ms is critical
};

/**
 * Wrap a provider method with metrics tracking
 */
export function withProviderMetrics<T extends (...args: unknown[]) => unknown>(
    fn: T,
    category: ProviderCategory,
    methodName: string
): T {
    const fullName = `${category}:${methodName}`;
    return withMetrics(fn, fullName, globalMetrics);
}

/**
 * Get performance status based on average duration
 */
function getPerformanceStatus(avgDuration: number): 'healthy' | 'slow' | 'critical' {
    if (avgDuration < PERFORMANCE_THRESHOLDS.healthy) {
        return 'healthy';
    } else if (avgDuration < PERFORMANCE_THRESHOLDS.critical) {
        return 'slow';
    }
    return 'critical';
}

/**
 * Get recommendation based on metrics
 */
function getRecommendation(metrics: MetricsData, category: ProviderCategory): string | undefined {
    if (metrics.errorCount > metrics.callCount * 0.1) {
        return 'High error rate detected. Check for parsing issues or file access problems.';
    }

    if (metrics.avgDuration >= PERFORMANCE_THRESHOLDS.critical) {
        switch (category) {
            case 'indexing':
                return 'Consider increasing indexing batch size or using file caching.';
            case 'reference':
                return 'Consider caching reference results or limiting search scope.';
            case 'completion':
                return 'Consider reducing completion candidate count or improving filtering.';
            default:
                return 'Performance is critical. Consider adding caching or optimizing lookup.';
        }
    }

    if (metrics.maxDuration > metrics.avgDuration * 5) {
        return 'High variance in response times. Some operations are significantly slower.';
    }

    return undefined;
}

/**
 * Generate a performance report for all tracked providers
 */
export function generatePerformanceReport(): ProviderPerformanceReport[] {
    const allMetrics = globalMetrics.getMetrics() as Map<string, MetricsData>;
    const reports: ProviderPerformanceReport[] = [];

    for (const [fullName, metrics] of allMetrics) {
        const [category, methodName] = fullName.split(':') as [ProviderCategory, string];

        if (metrics.callCount === 0) continue;

        const status = getPerformanceStatus(metrics.avgDuration);
        const recommendation = getRecommendation(metrics, category);

        reports.push({
            category,
            methodName,
            metrics,
            status,
            recommendation
        });
    }

    // Sort by average duration (slowest first)
    reports.sort((a, b) => b.metrics.avgDuration - a.metrics.avgDuration);

    return reports;
}

/**
 * Format performance report as string for display
 */
export function formatPerformanceReport(reports: ProviderPerformanceReport[]): string {
    if (reports.length === 0) {
        return 'No performance data collected yet.';
    }

    const lines: string[] = ['=== RubyMate Performance Report ===', ''];

    // Summary
    const totalCalls = reports.reduce((sum, r) => sum + r.metrics.callCount, 0);
    const avgDuration = reports.reduce((sum, r) => sum + r.metrics.avgDuration * r.metrics.callCount, 0) / totalCalls;
    const healthyCount = reports.filter(r => r.status === 'healthy').length;
    const slowCount = reports.filter(r => r.status === 'slow').length;
    const criticalCount = reports.filter(r => r.status === 'critical').length;

    lines.push('Summary:');
    lines.push(`  Total calls: ${totalCalls}`);
    lines.push(`  Overall avg duration: ${avgDuration.toFixed(2)}ms`);
    lines.push(`  Status: ${healthyCount} healthy, ${slowCount} slow, ${criticalCount} critical`);
    lines.push('');

    // Details by category
    const categories = [...new Set(reports.map(r => r.category))];

    for (const category of categories) {
        const categoryReports = reports.filter(r => r.category === category);
        lines.push(`${category.toUpperCase()}:`);

        for (const report of categoryReports) {
            const statusIcon = report.status === 'healthy' ? '✓' : report.status === 'slow' ? '⚠' : '✗';
            lines.push(`  ${statusIcon} ${report.methodName}:`);
            lines.push(`      Calls: ${report.metrics.callCount}, Avg: ${report.metrics.avgDuration.toFixed(2)}ms`);
            lines.push(`      Min: ${report.metrics.minDuration.toFixed(2)}ms, Max: ${report.metrics.maxDuration.toFixed(2)}ms`);
            lines.push(`      Success: ${report.metrics.successCount}, Errors: ${report.metrics.errorCount}`);

            if (report.recommendation) {
                lines.push(`      Recommendation: ${report.recommendation}`);
            }
        }
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Show performance report in output channel
 */
export function showPerformanceReport(outputChannel: vscode.OutputChannel): void {
    const reports = generatePerformanceReport();
    const formatted = formatPerformanceReport(reports);
    outputChannel.appendLine(formatted);
    outputChannel.show();
}

/**
 * Reset all metrics
 */
export function resetMetrics(): void {
    globalMetrics.reset();
}

/**
 * Create a VS Code command to show performance report
 */
export function createPerformanceCommands(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('rubymate.showPerformanceReport', () => {
            showPerformanceReport(outputChannel);
        }),

        vscode.commands.registerCommand('rubymate.resetPerformanceMetrics', () => {
            resetMetrics();
            vscode.window.showInformationMessage('RubyMate performance metrics have been reset.');
        })
    );
}

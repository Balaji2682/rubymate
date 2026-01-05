import * as vscode from 'vscode';
import { SchemaParser } from './schemaParser';

export interface N1Issue {
    line: number;
    message: string;
    severity: vscode.DiagnosticSeverity;
    suggestion: string;
    code: string;
}

export class NPlusOneDetector {
    private schemaParser: SchemaParser;
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor(schemaParser: SchemaParser) {
        this.schemaParser = schemaParser;
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('rubymate-n+1');
    }

    /**
     * Analyze document for N+1 queries
     */
    async analyzeDocument(document: vscode.TextDocument): Promise<void> {
        if (document.languageId !== 'ruby') {
            return;
        }

        // Skip gem files (installed gems, vendor/bundle, etc.)
        if (this.isGemFile(document.uri.fsPath)) {
            return;
        }

        // Check if N+1 detection is enabled
        const config = vscode.workspace.getConfiguration('rubymate');
        if (config.get('enableN1Detection') === false) {
            return;
        }

        // Check if file matches exclusion patterns
        if (this.isExcludedByConfig(document.uri.fsPath)) {
            return;
        }

        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        // Check if this is an ActiveRecord context (model/controller)
        const isActiveRecordContext = this.isActiveRecordContext(lines);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Skip lines with suppression comments
            if (this.hasSuppressionComment(line)) {
                continue;
            }

            // Detect N+1 patterns
            const issues = this.detectN1Patterns(line, i, lines, isActiveRecordContext);
            for (const issue of issues) {
                const diagnostic = this.createDiagnostic(document, issue);
                diagnostics.push(diagnostic);
            }
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /**
     * Detect N+1 query patterns
     */
    private detectN1Patterns(line: string, lineNumber: number, allLines: string[], isActiveRecordContext: boolean): N1Issue[] {
        const issues: N1Issue[] = [];

        // Only check for N+1 in ActiveRecord contexts (models, controllers, views)
        // Skip for non-Rails code (services, lib, etc.) unless explicitly ActiveRecord
        if (!isActiveRecordContext && !this.hasActiveRecordIndicators(line)) {
            return issues;
        }

        // Pattern 1: Iterating over collection and accessing associations
        // users.each do |user|
        //   user.posts.count  ← N+1!
        // end
        if (this.isIterationStart(line)) {
            const iterationIssues = this.checkIterationBlock(lineNumber, allLines);
            issues.push(...iterationIssues);
        }

        // Pattern 2: Calling associations in views
        // @users.each do |user|
        //   user.profile  ← N+1!
        if (/(@\w+|[a-z_]+)\.each\s+do\s+\|(\w+)\|/.test(line)) {
            const match = line.match(/(@\w+|[a-z_]+)\.each\s+do\s+\|(\w+)\|/);
            if (match) {
                const collection = match[1];
                const item = match[2];

                // Check if assignment has includes/eager_load
                const assignmentLine = this.findAssignment(collection, lineNumber, allLines);
                if (assignmentLine && !this.hasEagerLoading(assignmentLine)) {
                    // This might be N+1
                    // Need to check if associations are accessed in the block
                    const hasAssociationAccess = this.checkBlockForAssociationAccess(
                        item,
                        lineNumber,
                        allLines
                    );

                    if (hasAssociationAccess.found) {
                        issues.push({
                            line: lineNumber,
                            message: `Potential N+1 query: Accessing '${hasAssociationAccess.association}' in iteration`,
                            severity: vscode.DiagnosticSeverity.Warning,
                            suggestion: `Add .includes(:${hasAssociationAccess.association}) to the query`,
                            code: collection
                        });
                    }
                }
            }
        }

        // Pattern 3: Direct association access without includes
        const associationMatch = line.match(/\.(\w+)\s*\.\s*(\w+)/);
        if (associationMatch && this.looksLikeN1(line)) {
            const method = associationMatch[1];
            if (this.isActiveRecordQuery(method)) {
                const hasIncludes = this.hasEagerLoading(line);
                if (!hasIncludes) {
                    issues.push({
                        line: lineNumber,
                        message: `Possible N+1: Query without eager loading`,
                        severity: vscode.DiagnosticSeverity.Information,
                        suggestion: `Consider adding .includes(...) if accessing associations`,
                        code: line.trim()
                    });
                }
            }
        }

        return issues;
    }

    /**
     * Check if line starts an iteration block
     */
    private isIterationStart(line: string): boolean {
        return /\.(each|map|select|find_each|in_batches)\s+do\s+\|/.test(line);
    }

    /**
     * Check iteration block for N+1 issues
     */
    private checkIterationBlock(startLine: number, allLines: string[]): N1Issue[] {
        const issues: N1Issue[] = [];
        const iterationMatch = allLines[startLine].match(/(\w+)\.(each|map)\s+do\s+\|(\w+)\|/);

        if (!iterationMatch) {
            return issues;
        }

        const collection = iterationMatch[1];
        const itemVar = iterationMatch[3];

        // Find the end of the block
        let depth = 1;
        let endLine = startLine + 1;

        for (let i = startLine + 1; i < allLines.length && depth > 0; i++) {
            const line = allLines[i].trim();
            if (line.match(/\bdo\b|\{/)) {
                depth++;
            }
            if (line.match(/\bend\b|\}/)) {
                depth--;
            }
            if (depth === 0) {
                endLine = i;
                break;
            }
        }

        // Check block content for association access
        for (let i = startLine + 1; i < endLine; i++) {
            const line = allLines[i];

            // Look for: item_var.association
            const associationMatch = line.match(new RegExp(`${itemVar}\\.(\\w+)`));
            if (associationMatch) {
                const accessed = associationMatch[1];

                // Check if this looks like an association (not a simple attribute)
                if (this.looksLikeAssociation(accessed)) {
                    // Check if parent query has includes
                    const assignmentLine = this.findAssignment(collection, startLine, allLines);
                    if (assignmentLine && !this.hasEagerLoading(assignmentLine)) {
                        issues.push({
                            line: i,
                            message: `N+1 Query: Accessing '${accessed}' for each ${itemVar}`,
                            severity: vscode.DiagnosticSeverity.Warning,
                            suggestion: `Add .includes(:${accessed}) to ${collection} query`,
                            code: line.trim()
                        });
                    }
                }
            }
        }

        return issues;
    }

    /**
     * Find assignment line for a variable
     */
    private findAssignment(varName: string, currentLine: number, allLines: string[]): string | null {
        // Look backwards for assignment
        for (let i = currentLine - 1; i >= Math.max(0, currentLine - 20); i--) {
            const line = allLines[i];
            if (line.includes(`${varName} =`) || line.includes(`@${varName} =`)) {
                return line;
            }
        }
        return null;
    }

    /**
     * Check if query has eager loading
     */
    private hasEagerLoading(line: string): boolean {
        return /\.(includes|eager_load|preload|joins)\(/.test(line);
    }

    /**
     * Check if method name looks like ActiveRecord query
     */
    private isActiveRecordQuery(method: string): boolean {
        const queryMethods = [
            'where', 'find', 'find_by', 'all', 'first', 'last',
            'take', 'pluck', 'select', 'order', 'limit', 'offset'
        ];
        return queryMethods.includes(method);
    }

    /**
     * Check if line looks like N+1 scenario
     */
    private looksLikeN1(line: string): boolean {
        // Check if line has ActiveRecord query without includes
        return /\.(where|all|find)\(/.test(line) &&
            !/\.(includes|eager_load|preload|joins)\(/.test(line);
    }

    /**
     * Check if name looks like an association
     */
    private looksLikeAssociation(name: string): boolean {
        // Skip common attribute/method names and system/library methods
        const skipList = [
            // Database columns
            'id', 'name', 'email', 'created_at', 'updated_at', 'title', 'description',
            'password', 'username', 'first_name', 'last_name', 'deleted_at',

            // Ruby methods
            'to_s', 'to_i', 'to_a', 'to_h', 'to_json', 'to_xml',
            'nil?', 'present?', 'blank?', 'empty?', 'any?', 'none?',
            'class', 'methods', 'instance_methods', 'respond_to?',

            // ActiveRecord/ActiveModel methods
            'save', 'update', 'destroy', 'delete', 'valid?', 'invalid?',
            'errors', 'attributes', 'persisted?', 'new_record?', 'changed?',
            'reload', 'touch', 'increment', 'decrement',

            // System/IO methods (for NIO, File, Socket, etc.)
            'io', 'read', 'write', 'close', 'open', 'flush', 'sync',
            'select', 'wakeup', 'poll', 'wait', 'notify', 'signal',
            'value', 'values', 'keys', 'size', 'length', 'count',
            'first', 'last', 'next', 'prev', 'index', 'each',

            // Common getters/setters
            'get', 'set', 'fetch', 'store', 'put', 'delete',
            'add', 'remove', 'clear', 'reset', 'initialize'
        ];

        if (skipList.includes(name)) {
            return false;
        }

        // Skip methods ending with common suffixes that aren't associations
        if (name.match(/_(id|at|on|by|count|sum|avg)$/)) {
            return false;
        }

        // Associations are usually plural or specific patterns
        // But be more conservative - only flag if it really looks like an association
        return name.endsWith('s') && !name.endsWith('ss') && name.length > 3; // plural, excluding 'class', 'pass', etc.
    }

    /**
     * Check block for association access
     */
    private checkBlockForAssociationAccess(
        itemVar: string,
        startLine: number,
        allLines: string[]
    ): { found: boolean; association?: string } {
        let depth = 1;

        for (let i = startLine + 1; i < allLines.length && depth > 0; i++) {
            const line = allLines[i].trim();

            if (line.match(/\bdo\b|\{/)) {
                depth++;
            }
            if (line.match(/\bend\b|\}/)) {
                depth--;
                if (depth === 0) {
                    break;
                }
            }

            // Look for association access
            const match = line.match(new RegExp(`${itemVar}\\.(\\w+)`));
            if (match) {
                const accessed = match[1];
                if (this.looksLikeAssociation(accessed)) {
                    return { found: true, association: accessed };
                }
            }
        }

        return { found: false };
    }

    /**
     * Create diagnostic from issue
     */
    private createDiagnostic(document: vscode.TextDocument, issue: N1Issue): vscode.Diagnostic {
        const line = document.lineAt(issue.line);
        const range = new vscode.Range(
            issue.line,
            line.firstNonWhitespaceCharacterIndex,
            issue.line,
            line.text.length
        );

        const diagnostic = new vscode.Diagnostic(
            range,
            issue.message,
            issue.severity
        );

        diagnostic.code = 'N+1';
        diagnostic.source = 'RubyMate';

        // Add code action hint
        diagnostic.relatedInformation = [
            new vscode.DiagnosticRelatedInformation(
                new vscode.Location(document.uri, range),
                issue.suggestion
            )
        ];

        return diagnostic;
    }

    /**
     * Check if file is a gem file (should be excluded from analysis)
     */
    private isGemFile(filePath: string): boolean {
        // Normalize path separators
        const normalizedPath = filePath.replace(/\\/g, '/');

        // Common gem paths across different Ruby version managers
        const gemPathPatterns = [
            '/gems/',           // General gem path
            '/.rvm/',          // RVM
            '/.rbenv/',        // rbenv
            '/vendor/bundle/', // Bundler vendor
            '/.gem/',          // System gems
            '/lib/ruby/gems/', // System Ruby gems
            '/.bundle/'        // Bundle path
        ];

        return gemPathPatterns.some(pattern => normalizedPath.includes(pattern));
    }

    /**
     * Check if file is excluded by configuration
     */
    private isExcludedByConfig(filePath: string): boolean {
        const config = vscode.workspace.getConfiguration('rubymate');
        const excludePatterns: string[] = config.get('n1DetectionExcludePaths', []);

        if (excludePatterns.length === 0) {
            return false;
        }

        const normalizedPath = filePath.replace(/\\/g, '/');

        return excludePatterns.some(pattern => {
            // Simple glob pattern matching
            const regexPattern = pattern
                .replace(/\*\*/g, '.*')
                .replace(/\*/g, '[^/]*')
                .replace(/\?/g, '.');

            return new RegExp(regexPattern).test(normalizedPath);
        });
    }

    /**
     * Check if line has a suppression comment
     */
    private hasSuppressionComment(line: string): boolean {
        return /#+\s*(rubymate-disable-line|rubymate:disable|rubocop:disable.*N\+1)/.test(line);
    }

    /**
     * Check if file is in an ActiveRecord context (model, controller, etc.)
     */
    private isActiveRecordContext(lines: string[]): boolean {
        const fileContent = lines.join('\n');

        // Check for ActiveRecord model
        if (/class\s+\w+\s*<\s*(ApplicationRecord|ActiveRecord::Base)/.test(fileContent)) {
            return true;
        }

        // Check for ApplicationController or ActionController
        if (/class\s+\w+\s*<\s*(ApplicationController|ActionController::Base)/.test(fileContent)) {
            return true;
        }

        // Check for Rails helpers or concerns
        if (/module\s+\w+\s*(Helper|Concern)/.test(fileContent)) {
            return true;
        }

        // Check if file is in typical Rails paths
        return false; // File path checking would happen in isExcludedByConfig
    }

    /**
     * Check if line has ActiveRecord indicators
     */
    private hasActiveRecordIndicators(line: string): boolean {
        // Check for explicit ActiveRecord query methods
        return /\.(where|find|find_by|all|includes|eager_load|preload|joins)\(/.test(line);
    }

    /**
     * Clear diagnostics
     */
    clear(uri?: vscode.Uri): void {
        if (uri) {
            this.diagnosticCollection.delete(uri);
        } else {
            this.diagnosticCollection.clear();
        }
    }

    /**
     * Dispose
     */
    dispose(): void {
        this.diagnosticCollection.dispose();
    }
}

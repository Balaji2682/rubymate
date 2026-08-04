import * as vscode from 'vscode';
import { SchemaParser } from './schemaParser';
import { Debouncer } from '../shared/utilities/debounce';

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
    // Performance: Use shared Debouncer for efficient debouncing per document
    private debouncers: Map<string, Debouncer<void>> = new Map();
    private readonly DEBOUNCE_DELAY = 500; // ms
    // Schema-derived association knowledge, built lazily once the schema loads
    private schemaColumns: Set<string> | null = null;
    private belongsToNames: Set<string> | null = null;

    constructor(schemaParser: SchemaParser) {
        this.schemaParser = schemaParser;
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('rubymate-n+1');
    }

    /**
     * Get or create debouncer for a document
     */
    private getDebouncer(document: vscode.TextDocument): Debouncer<void> {
        const uri = document.uri.toString();
        let debouncer = this.debouncers.get(uri);

        if (!debouncer) {
            debouncer = new Debouncer<void>(
                async () => { await this.analyzeDocumentInternal(document); },
                this.DEBOUNCE_DELAY,
                { trailing: true }
            );
            this.debouncers.set(uri, debouncer);
        }

        return debouncer;
    }

    /**
     * Analyze document for N+1 queries (with debouncing)
     */
    async analyzeDocument(document: vscode.TextDocument): Promise<void> {
        // Performance: Use shared Debouncer for efficient per-document debouncing
        const debouncer = this.getDebouncer(document);
        debouncer.trigger();
    }

    /**
     * FIX: Internal analysis method (debounced)
     */
    private async analyzeDocumentInternal(document: vscode.TextDocument): Promise<void> {
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

        const issues = this.analyzeSource(document.getText(), document.uri.fsPath);
        const diagnostics = issues.map(issue => this.createDiagnostic(document, issue));
        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /**
     * Pure analysis entry point: takes raw Ruby source and returns the N+1
     * issues, independent of the VS Code document API so it can be unit tested.
     */
    analyzeSource(text: string, filePath: string): N1Issue[] {
        const lines = text.split('\n');
        // Strip comments so commented-out code is never analyzed and block
        // delimiters (do/end/{}) living inside comments don't skew depth tracking
        const strippedLines = lines.map(line => this.stripComment(line));

        const suppression = this.computeSuppressions(lines);
        if (suppression.fileDisabled) {
            return [];
        }

        const isActiveRecordContext = this.isActiveRecordContext(strippedLines, filePath);

        const raw: N1Issue[] = [];
        for (let i = 0; i < strippedLines.length; i++) {
            raw.push(...this.detectN1Patterns(strippedLines[i], i, strippedLines, isActiveRecordContext));
        }
        // Whole-document check: calling .count on an already-loaded relation
        // fires an extra COUNT query instead of using the loaded records
        raw.push(...this.checkLoadThenCount(strippedLines));

        const seen = new Set<string>();
        const issues: N1Issue[] = [];
        for (const issue of raw) {
            if (suppression.disabledLines.has(issue.line)) {
                continue;
            }
            // Respect suppression comments on the line the issue is reported on
            if (this.hasSuppressionComment(lines[issue.line])) {
                continue;
            }
            const key = `${issue.line}:${issue.message}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            issues.push(issue);
        }
        return issues;
    }

    /**
     * Resolve file- and block-level suppression directives:
     *   # rubymate:disable-file           → skip the whole file
     *   # rubymate:disable / :enable       → skip the enclosed range
     * Line-level directives are handled separately by hasSuppressionComment.
     */
    private computeSuppressions(lines: string[]): { fileDisabled: boolean; disabledLines: Set<number> } {
        const disabledLines = new Set<number>();
        let fileDisabled = false;
        let blockDisabled = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (/#\s*rubymate:disable-file\b/.test(line)) {
                fileDisabled = true;
                continue;
            }
            if (/#\s*rubymate:enable\b/.test(line)) {
                blockDisabled = false;
                continue;
            }
            // A bare `rubymate:disable` (not -line / -file) opens a suppressed block
            if (/#\s*rubymate:disable\b(?!-)/.test(line)) {
                blockDisabled = true;
                continue;
            }
            if (blockDisabled) {
                disabledLines.add(i);
            }
        }

        return { fileDisabled, disabledLines };
    }

    /**
     * Detect N+1 query patterns
     */
    private detectN1Patterns(line: string, lineNumber: number, allLines: string[], isActiveRecordContext: boolean): N1Issue[] {
        // Only check for N+1 in ActiveRecord contexts (models, controllers, views)
        // Skip for non-Rails code (services, lib, etc.) unless explicitly ActiveRecord
        if (!isActiveRecordContext && !this.hasActiveRecordIndicators(line)) {
            return [];
        }

        // Only ever warn about work happening inside an iteration: a query or
        // association access is only an N+1 when it runs once per row. Bare
        // queries that are never iterated (or terminal bulk statements such as
        // .delete_all / .destroy_all) are intentionally left alone.
        if (this.isIterationStart(line)) {
            return this.checkIterationBlock(lineNumber, allLines);
        }

        return [];
    }

    /**
     * Check if line starts an iteration block
     */
    private isIterationStart(line: string): boolean {
        return /\.(each|each_with_index|map|collect|flat_map|select|reject|filter|find_each|in_batches|each_slice|each_with_object)\b\s*(?:\([^)]*\))?\s*(?:do\b|\{)\s*\|/.test(line);
    }

    /**
     * Check iteration block for N+1 issues
     */
    private checkIterationBlock(startLine: number, allLines: string[]): N1Issue[] {
        const issues: N1Issue[] = [];
        const iterationMatch = allLines[startLine].match(
            /(@?\w+(?:\.\w+)*)\.(?:each|each_with_index|map|collect|flat_map|select|reject|filter|find_each|in_batches|each_slice|each_with_object)\b\s*(?:\([^)]*\))?\s*(?:do\b|\{)\s*\|\s*(\w+)/
        );

        if (!iterationMatch) {
            return issues;
        }

        const collection = iterationMatch[1].replace(/^@/, '');
        const itemVar = iterationMatch[2];

        // Whether the source collection already eager-loads its associations.
        // findAssignment stitches multiline method chains back together so a
        // .includes(...) placed on its own line still counts.
        const assignmentLine = this.findAssignment(collection, startLine, allLines);
        const parentEagerLoaded = assignmentLine !== null && this.hasEagerLoading(assignmentLine);

        const itemRef = new RegExp(`\\b${itemVar}\\b`);
        const assocRe = new RegExp(`\\b${itemVar}\\.(\\w+)`);
        const flagged = new Set<number>();

        // Walk the block body tracking real Ruby nesting. Both do/end and {}
        // blocks are handled, plus keyword openers (if/unless/case/def/begin...)
        // so an inner `if ... end` no longer terminates the loop scan early.
        let depth = 1;
        for (let i = startLine; i < allLines.length; i++) {
            // On the opening line, only the text after the `|item|` params is body
            const text = i === startLine ? this.bodyAfterBlockParams(allLines[i]) : allLines[i];

            if (text.trim()) {
                this.scanBlockLine(text, i, itemVar, collection, itemRef, assocRe, parentEagerLoaded, flagged, issues);
            }

            depth += this.structuralDelta(text);
            if (depth <= 0) {
                break;
            }
        }

        return issues;
    }

    /**
     * Inspect a single loop-body line for a per-row query or an unpreloaded
     * association access, appending any issue found.
     */
    private scanBlockLine(
        text: string,
        lineNumber: number,
        itemVar: string,
        collection: string,
        itemRef: RegExp,
        assocRe: RegExp,
        parentEagerLoaded: boolean,
        flagged: Set<number>,
        issues: N1Issue[]
    ): void {
        // A fresh query executed inside the loop body runs once per row
        // regardless of eager loading (e.g. Post.find_by(...), User.create!).
        const perRow = this.detectPerRowQuery(text, itemRef);
        if (perRow) {
            issues.push({
                line: lineNumber,
                message: `N+1 query: '${perRow}' runs once per ${itemVar}`,
                severity: vscode.DiagnosticSeverity.Warning,
                suggestion: `Move '${perRow}' out of the loop or preload the data before iterating`,
                code: text.trim()
            });
            flagged.add(lineNumber);
            return;
        }

        // Accessing an association off the loop variable without eager loading
        // on the source query is the classic N+1.
        const associationMatch = text.match(assocRe);
        if (associationMatch && !flagged.has(lineNumber)) {
            const accessed = associationMatch[1];
            if (this.looksLikeAssociation(accessed) && !parentEagerLoaded) {
                issues.push({
                    line: lineNumber,
                    message: `N+1 query: accessing '${accessed}' for each ${itemVar}`,
                    severity: vscode.DiagnosticSeverity.Warning,
                    suggestion: `Add .includes(:${accessed}) to the ${collection} query`,
                    code: text.trim()
                });
                flagged.add(lineNumber);
            }
        }
    }

    /**
     * Return the portion of a block-opening line after its `|params|` list,
     * i.e. the inline body of a one-line block (empty for multiline blocks).
     */
    private bodyAfterBlockParams(line: string): string {
        const params = line.match(/\|\s*[^|]*\|/);
        return params ? line.slice((params.index ?? 0) + params[0].length) : '';
    }

    /**
     * Net change in block-nesting depth contributed by a line. Counts do/end,
     * brace blocks, and keyword openers (def/class/module/begin/case, plus a
     * leading if/unless/while/until/for) while ignoring modifier-form keywords
     * and method calls such as `.end` or `.class`.
     */
    private structuralDelta(line: string): number {
        let delta = 0;

        const keywordOpeners = line.match(/(?<![.:@])\b(?:do|def|class|module|begin|case)\b/g);
        if (keywordOpeners) {
            delta += keywordOpeners.length;
        }
        // Only a leading conditional/loop keyword opens a block; postfix
        // modifiers (`x if y`) do not and have no matching `end`.
        if (/^\s*(?:if|unless|while|until|for)\b/.test(line)) {
            delta += 1;
        }

        const ends = line.match(/(?<![.:@])\bend\b/g);
        if (ends) {
            delta -= ends.length;
        }

        delta += (line.match(/\{/g) || []).length;
        delta -= (line.match(/\}/g) || []).length;

        return delta;
    }

    /**
     * Detect an ActiveRecord query executed inside a loop body. Returns the
     * matched call (e.g. "Post.find_by") when the line issues a per-row query,
     * otherwise null. Terminal bulk operations are handled by their own
     * receiver rules and are not treated as per-row work here.
     */
    private detectPerRowQuery(line: string, itemRef: RegExp): string | null {
        // Model-level finders/writers: Post.find_by(...), User.create!(...)
        const classQuery = line.match(
            /\b([A-Z]\w*(?:::[A-Z]\w*)*)\.(find|find_by!?|find_or_create_by!?|find_or_initialize_by|create!?|where|first_or_create!?|first_or_initialize|exists\?|count|sum|average|minimum|maximum|pluck)\b/
        );
        if (classQuery) {
            const receiver = classQuery[1];
            // SCREAMING_CASE receivers are constants/arrays (STATUSES.find), not
            // AR models — only CamelCase model constants issue queries.
            const isModelConst = /[a-z]/.test(receiver);
            // A trailing block (`.find { ... }` / `.count do`) is the Enumerable
            // form, not a database query.
            const after = line.slice((classQuery.index ?? 0) + classQuery[0].length);
            const isEnumerableBlock = /^\s*(?:\{|do\b)/.test(after);
            if (isModelConst && !isEnumerableBlock) {
                return `${receiver}.${classQuery[2]}`;
            }
        }

        // A query built from the loop variable on any receiver:
        // scope.find_by(user_id: user.id), account.posts.where(...)
        const queryMethod = line.match(/\.(where|find|find_by!?|find_or_create_by!?|create!?|first_or_create!?|exists\?)\s*\(/);
        if (queryMethod && itemRef.test(line)) {
            return `.${queryMethod[1]}`;
        }

        return null;
    }

    /**
     * Find assignment line for a variable
     */
    private findAssignment(varName: string, currentLine: number, allLines: string[]): string | null {
        // Match a real assignment (`x =` / `@x =`) but never a comparison (`x ==`)
        const assignRe = new RegExp(`@?\\b${varName}\\b\\s*=(?!=)`);
        // Look backwards for assignment
        for (let i = currentLine - 1; i >= Math.max(0, currentLine - 20); i--) {
            const line = allLines[i];
            if (assignRe.test(line)) {
                // Stitch multiline method chains so eager loading split across
                // lines (e.g. a trailing ".includes(:posts)") is not lost.
                let statement = line;
                for (let j = i + 1; j < allLines.length; j++) {
                    const previous = allLines[j - 1].trimEnd();
                    const next = allLines[j].trim();
                    const continues = /[.,(&|+\\-]$/.test(previous) || /^(?:\.|&\.)/.test(next);
                    if (!continues) {
                        break;
                    }
                    statement += ' ' + next;
                }
                return statement;
            }
        }
        return null;
    }

    /**
     * Remove trailing line comments so commented-out code is never analysed.
     * Quote state is tracked so a '#' inside a string literal is preserved.
     */
    private stripComment(line: string): string {
        let inSingle = false;
        let inDouble = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === "'" && !inDouble) {
                inSingle = !inSingle;
            } else if (ch === '"' && !inSingle) {
                inDouble = !inDouble;
            } else if (ch === '#' && !inSingle && !inDouble) {
                return line.slice(0, i);
            }
        }
        return line;
    }

    /**
     * Detect calling .count on a relation that was already loaded into memory.
     * .count re-queries the database; .size reuses the loaded records.
     */
    private checkLoadThenCount(allLines: string[]): N1Issue[] {
        const issues: N1Issue[] = [];
        const loadedAt = new Map<string, number>();

        for (let i = 0; i < allLines.length; i++) {
            const line = allLines[i];

            const loadMatch = line.match(/\b(@?\w+)\s*=\s*.*\.load\b/) || line.match(/\b(@?\w+)\.load\b/);
            if (loadMatch) {
                loadedAt.set(loadMatch[1], i);
                continue;
            }

            const countMatch = line.match(/\b(@?\w+)\.count\b/);
            if (countMatch && loadedAt.has(countMatch[1])) {
                issues.push({
                    line: i,
                    message: `Extra query: '.count' on already-loaded '${countMatch[1]}' hits the database again`,
                    severity: vscode.DiagnosticSeverity.Information,
                    suggestion: `Use '.size' to count the records already loaded into memory`,
                    code: line.trim()
                });
            }
        }

        return issues;
    }

    /**
     * Check if query has eager loading
     */
    private hasEagerLoading(line: string): boolean {
        return /\.(includes|eager_load|preload|joins)\(/.test(line);
    }

    /**
     * Build column / belongs_to lookup sets from the parsed schema. Cached once
     * the schema is available; a null schema leaves them unset so we fall back
     * to the plural-name heuristic.
     */
    private ensureSchemaSets(): void {
        if (this.schemaColumns && this.belongsToNames) {
            return;
        }
        const schema = this.schemaParser.getSchema();
        if (!schema) {
            return;
        }
        const columns = new Set<string>();
        const belongsTo = new Set<string>();
        for (const table of schema.tables.values()) {
            for (const column of table.columns) {
                columns.add(column.name);
                // A `<name>_id` foreign key implies a `<name>` belongs_to association
                const fk = column.name.match(/^(.+)_id$/);
                if (fk) {
                    belongsTo.add(fk[1]);
                }
            }
        }
        this.schemaColumns = columns;
        this.belongsToNames = belongsTo;
    }

    /**
     * Check if name looks like an association
     */
    private looksLikeAssociation(name: string): boolean {
        // Predicate / bang methods are never associations
        if (/[?!]$/.test(name)) {
            return false;
        }

        this.ensureSchemaSets();
        // Precise (schema-backed): a `<name>_id` column means `<name>` is a
        // belongs_to association, so singular associations are caught too.
        if (this.belongsToNames?.has(name)) {
            return true;
        }
        // A real database column is an attribute access, not an association.
        if (this.schemaColumns?.has(name)) {
            return false;
        }

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
    private isActiveRecordContext(lines: string[], filePath?: string): boolean {
        // Path-based: anything under the app directories that routinely handle
        // ActiveRecord relations (services, jobs, serializers, decorators, ...).
        if (filePath) {
            const normalized = filePath.replace(/\\/g, '/');
            if (/\/app\/(models|controllers|jobs|services|serializers|decorators|mailers|channels|helpers|policies|queries|presenters)\//.test(normalized)) {
                return true;
            }
        }

        const fileContent = lines.join('\n');

        // Any class inheriting from a *Record or *Controller base, including
        // namespaced/custom bases (e.g. `< Api::BaseController`).
        if (/class\s+[\w:]+\s*<\s*[\w:]*(?:Record|Controller)\b/.test(fileContent)) {
            return true;
        }

        // Background jobs and framework base classes.
        if (/class\s+[\w:]+\s*<\s*(?:ActiveRecord::Base|ActionController::Base|ApplicationJob|ActiveJob::Base)\b/.test(fileContent)) {
            return true;
        }

        // Rails helpers or concerns.
        if (/module\s+\w+\s*(Helper|Concern)/.test(fileContent)) {
            return true;
        }

        return false;
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
        // Cancel all pending debouncers
        for (const debouncer of this.debouncers.values()) {
            debouncer.cancel();
        }
        this.debouncers.clear();

        this.diagnosticCollection.dispose();
    }
}

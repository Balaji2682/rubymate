import * as vscode from 'vscode';
import { SchemaParser } from './schemaParser';

export class SQLCompletionProvider implements vscode.CompletionItemProvider {
    private schemaParser: SchemaParser;

    constructor(schemaParser: SchemaParser) {
        this.schemaParser = schemaParser;
    }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem[]> {
        const lineText = document.lineAt(position.line).text;
        const textBeforeCursor = lineText.substring(0, position.character);

        // Check if we're in a SQL context
        if (!this.isInSQLContext(textBeforeCursor)) {
            return [];
        }

        const completions: vscode.CompletionItem[] = [];

        // Get the word being typed
        const wordRange = document.getWordRangeAtPosition(position);
        const word = wordRange ? document.getText(wordRange) : '';

        // Detect what kind of completion is needed
        const context = this.detectCompletionContext(textBeforeCursor);

        switch (context.type) {
            case 'table':
                return this.getTableCompletions();

            case 'column':
                if (context.tableName) {
                    return this.getColumnCompletions(context.tableName);
                }
                // If no table detected, provide columns from all tables
                return this.getAllColumnCompletions();

            case 'keyword':
                return this.getSQLKeywordCompletions();

            default:
                // Provide both tables and keywords
                return [
                    ...this.getTableCompletions(),
                    ...this.getSQLKeywordCompletions()
                ];
        }
    }

    /**
     * Check if cursor is in SQL context
     */
    private isInSQLContext(text: string): boolean {
        // Check for SQL-like method calls
        const sqlPatterns = [
            /\.where\s*\(\s*["']/,
            /\.execute\s*\(\s*["']/,
            /find_by_sql\s*\(\s*["']/,
            /\.select\s*\(\s*["']/,
            /\.joins\s*\(\s*["']/,
            /\.from\s*\(\s*["']/,
            /ActiveRecord::Base\.connection/,
            // Also support heredoc SQL
            /<<-?SQL/,
            /<<~SQL/
        ];

        return sqlPatterns.some(pattern => pattern.test(text));
    }

    /**
     * Detect what type of completion is needed
     */
    private detectCompletionContext(text: string): {
        type: 'table' | 'column' | 'keyword' | 'unknown';
        tableName?: string;
    } {
        const upperText = text.toUpperCase();

        // After FROM, JOIN - suggest tables
        if (/\b(FROM|JOIN|INTO|UPDATE)\s+\w*$/i.test(text)) {
            return { type: 'table' };
        }

        // After SELECT, WHERE - suggest columns
        if (/\b(SELECT|WHERE|ORDER BY|GROUP BY)\s+\w*$/i.test(text)) {
            // Try to extract table name from the query
            const tableName = this.extractTableName(text);
            return { type: 'column', tableName };
        }

        // After table name followed by dot - suggest columns
        const tableColumnMatch = text.match(/\b(\w+)\.\w*$/);
        if (tableColumnMatch) {
            return { type: 'column', tableName: tableColumnMatch[1] };
        }

        // After SQL keywords - suggest next keyword
        if (/\b(SELECT|FROM|WHERE|AND|OR|ORDER|GROUP)\s*$/i.test(text)) {
            return { type: 'keyword' };
        }

        return { type: 'unknown' };
    }

    /**
     * Extract table name from partial SQL query
     */
    private extractTableName(text: string): string | undefined {
        // Look for FROM table_name
        const fromMatch = text.match(/FROM\s+(\w+)/i);
        if (fromMatch) {
            return fromMatch[1];
        }

        // Look for JOIN table_name
        const joinMatch = text.match(/JOIN\s+(\w+)/i);
        if (joinMatch) {
            return joinMatch[1];
        }

        return undefined;
    }

    /**
     * Get table name completions
     */
    private getTableCompletions(): vscode.CompletionItem[] {
        const tableNames = this.schemaParser.getTableNames();

        return tableNames.map(tableName => {
            const table = this.schemaParser.getTable(tableName);
            const completion = new vscode.CompletionItem(
                tableName,
                vscode.CompletionItemKind.Class
            );

            if (table) {
                const columnCount = table.columns.length;
                completion.detail = `Table (${columnCount} columns)`;
                completion.documentation = new vscode.MarkdownString(
                    `**Table:** \`${tableName}\`\n\n` +
                    `**Columns:** ${columnCount}\n\n` +
                    `\`\`\`sql\n` +
                    table.columns.slice(0, 5).map(c =>
                        `${c.name}: ${c.type}`
                    ).join('\n') +
                    (table.columns.length > 5 ? '\n...' : '') +
                    `\n\`\`\``
                );
            }

            return completion;
        });
    }

    /**
     * Get column completions for a specific table
     */
    private getColumnCompletions(tableName: string): vscode.CompletionItem[] {
        const table = this.schemaParser.getTable(tableName);
        if (!table) {
            return [];
        }

        return table.columns.map(column => {
            const completion = new vscode.CompletionItem(
                column.name,
                vscode.CompletionItemKind.Field
            );

            completion.detail = `${column.type}${column.nullable === false ? ' NOT NULL' : ''}`;

            const docs: string[] = [
                `**Column:** \`${column.name}\``,
                `**Type:** ${column.type}`,
                `**Nullable:** ${column.nullable !== false ? 'Yes' : 'No'}`
            ];

            if (column.default !== undefined) {
                docs.push(`**Default:** ${column.default}`);
            }

            if (column.primaryKey) {
                docs.push(`**Primary Key**`);
            }

            if (column.foreignKey) {
                docs.push(
                    `**Foreign Key:** → \`${column.foreignKey.table}.${column.foreignKey.column}\``
                );
            }

            completion.documentation = new vscode.MarkdownString(docs.join('\n\n'));

            // Add insert text with table prefix if needed
            if (this.shouldPrefixWithTable(tableName)) {
                completion.insertText = `${tableName}.${column.name}`;
            }

            return completion;
        });
    }

    /**
     * Get all column completions (from all tables)
     */
    private getAllColumnCompletions(): vscode.CompletionItem[] {
        const tableNames = this.schemaParser.getTableNames();
        const completions: vscode.CompletionItem[] = [];

        for (const tableName of tableNames) {
            const table = this.schemaParser.getTable(tableName);
            if (!table) {
                continue;
            }

            for (const column of table.columns) {
                const completion = new vscode.CompletionItem(
                    `${tableName}.${column.name}`,
                    vscode.CompletionItemKind.Field
                );

                completion.detail = `${tableName}.${column.name}: ${column.type}`;
                completion.documentation = new vscode.MarkdownString(
                    `**Table:** \`${tableName}\`\n\n` +
                    `**Column:** \`${column.name}\`\n\n` +
                    `**Type:** ${column.type}`
                );

                completion.filterText = `${tableName} ${column.name}`;
                completion.sortText = `${tableName}_${column.name}`;

                completions.push(completion);
            }
        }

        return completions;
    }

    /**
     * Get SQL keyword completions
     */
    private getSQLKeywordCompletions(): vscode.CompletionItem[] {
        const keywords = [
            'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT',
            'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN',
            'ON', 'USING',
            'GROUP BY', 'HAVING', 'ORDER BY',
            'ASC', 'DESC',
            'LIMIT', 'OFFSET',
            'INSERT INTO', 'VALUES',
            'UPDATE', 'SET',
            'DELETE FROM',
            'CREATE TABLE', 'DROP TABLE', 'ALTER TABLE',
            'ADD COLUMN', 'DROP COLUMN',
            'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES',
            'INDEX', 'UNIQUE',
            'AS', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
            'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
            'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS NULL', 'IS NOT NULL'
        ];

        return keywords.map(keyword => {
            const completion = new vscode.CompletionItem(
                keyword,
                vscode.CompletionItemKind.Keyword
            );
            completion.insertText = keyword;
            completion.detail = 'SQL Keyword';
            return completion;
        });
    }

    /**
     * Check if column should be prefixed with table name
     */
    private shouldPrefixWithTable(tableName: string): boolean {
        // If there are multiple tables in context, prefix
        // For now, return false (can be enhanced)
        return false;
    }
}

/**
 * Inline SQL completion provider for ActiveRecord queries
 */
export class ActiveRecordCompletionProvider implements vscode.CompletionItemProvider {
    private schemaParser: SchemaParser;

    constructor(schemaParser: SchemaParser) {
        this.schemaParser = schemaParser;
    }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem[]> {
        const lineText = document.lineAt(position.line).text;
        const textBeforeCursor = lineText.substring(0, position.character);

        // Detect model name from class or variable
        const modelName = this.detectModelName(document, position);
        if (!modelName) {
            return [];
        }

        const tableName = this.schemaParser.getTableNameFromModel(modelName);
        const table = this.schemaParser.getTable(tableName);

        if (!table) {
            return [];
        }

        // Provide column-based completions for ActiveRecord methods
        const context = this.detectActiveRecordContext(textBeforeCursor);

        switch (context) {
            case 'where':
            case 'find_by':
            case 'order':
            case 'pluck':
            case 'select':
                return this.getColumnSymbolCompletions(table);

            default:
                return [];
        }
    }

    /**
     * Detect model name from context
     */
    private detectModelName(document: vscode.TextDocument, position: vscode.Position): string | null {
        const lineText = document.lineAt(position.line).text;

        // Pattern 1: User.where(...
        const classMethodMatch = lineText.match(/(\w+)\.(where|find_by|order|pluck|select)/);
        if (classMethodMatch) {
            return classMethodMatch[1];
        }

        // Pattern 2: @user.update(...
        const instanceMatch = lineText.match(/@(\w+)\./);
        if (instanceMatch) {
            // Capitalize first letter
            return instanceMatch[1].charAt(0).toUpperCase() + instanceMatch[1].slice(1);
        }

        // Pattern 3: Inside class
        for (let i = position.line; i >= 0; i--) {
            const line = document.lineAt(i).text;
            const classMatch = line.match(/class\s+(\w+)\s*</);
            if (classMatch) {
                return classMatch[1];
            }
        }

        return null;
    }

    /**
     * Detect ActiveRecord method context
     */
    private detectActiveRecordContext(text: string): string | null {
        if (/\.where\s*\(\s*:?\w*$/.test(text)) {
            return 'where';
        }
        if (/\.find_by\s*\(\s*:?\w*$/.test(text)) {
            return 'find_by';
        }
        if (/\.order\s*\(\s*:?\w*$/.test(text)) {
            return 'order';
        }
        if (/\.pluck\s*\(\s*:?\w*$/.test(text)) {
            return 'pluck';
        }
        if (/\.select\s*\(\s*:?\w*$/.test(text)) {
            return 'select';
        }
        return null;
    }

    /**
     * Get column completions as Ruby symbols
     */
    private getColumnSymbolCompletions(table: any): vscode.CompletionItem[] {
        return table.columns.map((column: any) => {
            const completion = new vscode.CompletionItem(
                `:${column.name}`,
                vscode.CompletionItemKind.Property
            );

            completion.insertText = column.name;
            completion.detail = `${column.type}`;
            completion.documentation = new vscode.MarkdownString(
                `**Column:** \`${column.name}\`\n\n` +
                `**Type:** ${column.type}\n\n` +
                `**Example:**\n\`\`\`ruby\nUser.where(${column.name}: value)\n\`\`\``
            );

            return completion;
        });
    }
}

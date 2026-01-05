import * as vscode from 'vscode';
import * as path from 'path';

export interface Column {
    name: string;
    type: string;
    nullable?: boolean;
    default?: string;
    primaryKey?: boolean;
    foreignKey?: {
        table: string;
        column: string;
    };
}

export interface Index {
    name: string;
    columns: string[];
    unique: boolean;
}

export interface Table {
    name: string;
    columns: Column[];
    indexes: Index[];
    primaryKey?: string[];
}

export interface DatabaseSchema {
    tables: Map<string, Table>;
    version: string;
}

export class SchemaParser {
    private schema: DatabaseSchema | null = null;
    private workspaceFolder: vscode.WorkspaceFolder | undefined;
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    }

    /**
     * Parse db/schema.rb file with progress indicator
     */
    async parseSchema(showProgress: boolean = true): Promise<DatabaseSchema | null> {
        if (!this.workspaceFolder) {
            return null;
        }

        if (!showProgress) {
            // Fast path without progress indicator
            return this.parseSchemaInternal();
        }

        // Show progress indicator for potentially long operation
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Parsing database schema...",
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: 'Reading schema.rb...' });
            const result = await this.parseSchemaInternal();
            progress.report({ increment: 100, message: 'Done!' });
            return result;
        });
    }

    /**
     * Internal schema parsing implementation
     */
    private async parseSchemaInternal(): Promise<DatabaseSchema | null> {
        if (!this.workspaceFolder) {
            return null;
        }

        const schemaPath = path.join(this.workspaceFolder.uri.fsPath, 'db', 'schema.rb');

        try {
            const schemaUri = vscode.Uri.file(schemaPath);
            const schemaContent = await vscode.workspace.fs.readFile(schemaUri);
            const content = Buffer.from(schemaContent).toString('utf-8');

            this.schema = this.parseSchemaContent(content);
            this.outputChannel.appendLine(`Parsed database schema: ${this.schema.tables.size} tables`);

            return this.schema;
        } catch (error) {
            this.outputChannel.appendLine(`No schema.rb found or error parsing: ${error}`);
            return null;
        }
    }

    /**
     * Parse schema.rb content
     */
    private parseSchemaContent(content: string): DatabaseSchema {
        const tables = new Map<string, Table>();
        const lines = content.split('\n');

        let currentTable: Table | null = null;
        let version = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Parse version
            const versionMatch = line.match(/ActiveRecord::Schema(?:\[\d+\.\d+\])?\.define\(version:\s*(\d+)\)/);
            if (versionMatch) {
                version = versionMatch[1];
            }

            // Parse create_table
            const createTableMatch = line.match(/create_table\s+"(\w+)"(?:,\s*(.+))?\s+do\s*\|t\|/);
            if (createTableMatch) {
                const tableName = createTableMatch[1];
                currentTable = {
                    name: tableName,
                    columns: [],
                    indexes: []
                };

                // Check for id: false or primary_key option
                const options = createTableMatch[2];
                if (options && options.includes('id: false')) {
                    // No default id column
                } else {
                    // Default id column
                    currentTable.columns.push({
                        name: 'id',
                        type: 'bigint',
                        nullable: false,
                        primaryKey: true
                    });
                    currentTable.primaryKey = ['id'];
                }
                continue;
            }

            // Parse columns
            if (currentTable && line.startsWith('t.')) {
                const column = this.parseColumnLine(line);
                if (column) {
                    currentTable.columns.push(column);
                }
            }

            // Parse indexes
            if (currentTable && line.startsWith('t.index')) {
                const index = this.parseIndexLine(line);
                if (index) {
                    currentTable.indexes.push(index);
                }
            }

            // Parse add_index (outside create_table)
            if (line.startsWith('add_index')) {
                const indexInfo = this.parseAddIndexLine(line);
                if (indexInfo) {
                    const table = tables.get(indexInfo.tableName);
                    if (table) {
                        table.indexes.push(indexInfo.index);
                    }
                }
            }

            // Parse add_foreign_key
            if (currentTable && line.startsWith('add_foreign_key')) {
                this.parseForeignKeyLine(line, currentTable);
            }

            // End of create_table
            if (line === 'end' && currentTable) {
                // Add timestamps if present
                const timestamps = lines.slice(Math.max(0, i - 5), i)
                    .some(l => l.includes('t.timestamps'));

                if (timestamps) {
                    if (!currentTable.columns.find(c => c.name === 'created_at')) {
                        currentTable.columns.push({
                            name: 'created_at',
                            type: 'datetime',
                            nullable: false
                        });
                    }
                    if (!currentTable.columns.find(c => c.name === 'updated_at')) {
                        currentTable.columns.push({
                            name: 'updated_at',
                            type: 'datetime',
                            nullable: false
                        });
                    }
                }

                tables.set(currentTable.name, currentTable);
                currentTable = null;
            }
        }

        return {
            tables,
            version
        };
    }

    /**
     * Parse column line like: t.string "email", null: false
     */
    private parseColumnLine(line: string): Column | null {
        // Match: t.type "name", options
        const match = line.match(/t\.(\w+)\s+"(\w+)"(?:,\s*(.+))?/);
        if (!match) {
            return null;
        }

        const [, type, name, optionsStr] = match;

        const column: Column = {
            name,
            type,
            nullable: true
        };

        if (optionsStr) {
            // Parse null: false
            if (optionsStr.includes('null: false')) {
                column.nullable = false;
            }

            // Parse default: value
            const defaultMatch = optionsStr.match(/default:\s*(.+?)(?:,|$)/);
            if (defaultMatch) {
                column.default = defaultMatch[1].trim();
            }

            // Parse foreign_key reference
            if (type === 'references' || type === 'belongs_to') {
                column.foreignKey = {
                    table: `${name}s`, // Pluralize
                    column: 'id'
                };
            }
        }

        return column;
    }

    /**
     * Parse index line like: t.index ["email"], unique: true
     */
    private parseIndexLine(line: string): Index | null {
        // Match: t.index ["col1", "col2"], options
        const match = line.match(/t\.index\s+\[(.+?)\](?:,\s*(.+))?/);
        if (!match) {
            return null;
        }

        const [, columnsStr, optionsStr] = match;

        const columns = columnsStr
            .split(',')
            .map(c => c.trim().replace(/["']/g, ''));

        const index: Index = {
            name: '', // Will be auto-generated
            columns,
            unique: false
        };

        if (optionsStr) {
            // Parse unique: true
            if (optionsStr.includes('unique: true')) {
                index.unique = true;
            }

            // Parse name: "index_name"
            const nameMatch = optionsStr.match(/name:\s*"(.+?)"/);
            if (nameMatch) {
                index.name = nameMatch[1];
            }
        }

        return index;
    }

    /**
     * Parse add_index line
     */
    private parseAddIndexLine(line: string): { tableName: string; index: Index } | null {
        const match = line.match(/add_index\s+"(\w+)",\s+\[(.+?)\](?:,\s*(.+))?/);
        if (!match) {
            return null;
        }

        const [, tableName, columnsStr, optionsStr] = match;

        const columns = columnsStr
            .split(',')
            .map(c => c.trim().replace(/["']/g, ''));

        const index: Index = {
            name: '',
            columns,
            unique: false
        };

        if (optionsStr && optionsStr.includes('unique: true')) {
            index.unique = true;
        }

        return { tableName, index };
    }

    /**
     * Parse add_foreign_key line
     */
    private parseForeignKeyLine(line: string, table: Table): void {
        const match = line.match(/add_foreign_key\s+"(\w+)",\s+"(\w+)"/);
        if (!match) {
            return;
        }

        const [, fromTable, toTable] = match;

        // Find the foreign key column
        const fkColumn = table.columns.find(c =>
            c.name === `${toTable.slice(0, -1)}_id` || // singular_id
            c.name === `${toTable}_id` // plural_id
        );

        if (fkColumn) {
            fkColumn.foreignKey = {
                table: toTable,
                column: 'id'
            };
        }
    }

    /**
     * Get table by name
     */
    getTable(tableName: string): Table | undefined {
        return this.schema?.tables.get(tableName);
    }

    /**
     * Get all table names
     */
    getTableNames(): string[] {
        if (!this.schema) {
            return [];
        }
        return Array.from(this.schema.tables.keys());
    }

    /**
     * Get column names for a table
     */
    getColumnNames(tableName: string): string[] {
        const table = this.getTable(tableName);
        if (!table) {
            return [];
        }
        return table.columns.map(c => c.name);
    }

    /**
     * Get model name from table name
     */
    getModelNameFromTable(tableName: string): string {
        // Convert snake_case to CamelCase and singularize
        return tableName
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join('')
            .replace(/s$/, ''); // Simple singularization
    }

    /**
     * Get table name from model name
     */
    getTableNameFromModel(modelName: string): string {
        // Convert CamelCase to snake_case and pluralize
        return modelName
            .replace(/([A-Z])/g, '_$1')
            .toLowerCase()
            .slice(1) + 's'; // Simple pluralization
    }

    /**
     * Detect SQL queries in code
     */
    detectSQLQueries(text: string): Array<{ sql: string; range: { start: number; end: number } }> {
        const queries: Array<{ sql: string; range: { start: number; end: number } }> = [];

        // Match SQL in strings
        // Pattern 1: Model.where("SELECT ...")
        const whereRegex = /\.where\s*\(\s*["'](.+?)["']/g;
        let match;
        while ((match = whereRegex.exec(text)) !== null) {
            queries.push({
                sql: match[1],
                range: {
                    start: match.index,
                    end: match.index + match[0].length
                }
            });
        }

        // Pattern 2: ActiveRecord::Base.connection.execute("SELECT ...")
        const executeRegex = /\.execute\s*\(\s*["'](.+?)["']/g;
        while ((match = executeRegex.exec(text)) !== null) {
            queries.push({
                sql: match[1],
                range: {
                    start: match.index,
                    end: match.index + match[0].length
                }
            });
        }

        // Pattern 3: find_by_sql("SELECT ...")
        const findBySqlRegex = /find_by_sql\s*\(\s*["'](.+?)["']/g;
        while ((match = findBySqlRegex.exec(text)) !== null) {
            queries.push({
                sql: match[1],
                range: {
                    start: match.index,
                    end: match.index + match[0].length
                }
            });
        }

        return queries;
    }

    /**
     * Extract table name from SQL query
     */
    extractTableFromSQL(sql: string): string | null {
        const fromMatch = sql.match(/FROM\s+(\w+)/i);
        if (fromMatch) {
            return fromMatch[1];
        }

        const updateMatch = sql.match(/UPDATE\s+(\w+)/i);
        if (updateMatch) {
            return updateMatch[1];
        }

        const insertMatch = sql.match(/INSERT\s+INTO\s+(\w+)/i);
        if (insertMatch) {
            return insertMatch[1];
        }

        return null;
    }

    /**
     * Get schema
     */
    getSchema(): DatabaseSchema | null {
        return this.schema;
    }

    /**
     * Reload schema
     */
    async reload(): Promise<void> {
        await this.parseSchema();
    }
}

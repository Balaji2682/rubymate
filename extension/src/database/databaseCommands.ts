import * as vscode from 'vscode';
import { SchemaParser, Table } from './schemaParser';

export class DatabaseCommands {
    private schemaParser: SchemaParser;
    private outputChannel: vscode.OutputChannel;

    constructor(schemaParser: SchemaParser, outputChannel: vscode.OutputChannel) {
        this.schemaParser = schemaParser;
        this.outputChannel = outputChannel;
    }

    registerCommands(context: vscode.ExtensionContext): void {
        // Show database schema
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.database.showSchema', () =>
                this.showSchemaVisualization()
            )
        );

        // Go to table definition in schema.rb
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.database.goToTable', () =>
                this.goToTableDefinition()
            )
        );

        // Generate migration from model
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.database.generateMigration', () =>
                this.generateMigration()
            )
        );

        // Reload schema
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.database.reloadSchema', () =>
                this.reloadSchema()
            )
        );

        // Open database console
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.database.openConsole', () =>
                this.openDatabaseConsole()
            )
        );

        // Run SQL query
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.database.runQuery', () =>
                this.runSQLQuery()
            )
        );

        // Show table columns
        context.subscriptions.push(
            vscode.commands.registerCommand('rubymate.database.showColumns', () =>
                this.showTableColumns()
            )
        );
    }

    /**
     * Show database schema visualization
     */
    private async showSchemaVisualization(): Promise<void> {
        const schema = this.schemaParser.getSchema();

        if (!schema) {
            vscode.window.showWarningMessage('No schema.rb found. Run migrations first.');
            return;
        }

        // Create webview panel
        const panel = vscode.window.createWebviewPanel(
            'databaseSchema',
            'Database Schema',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        panel.webview.html = this.getSchemaHTML(schema);
    }

    /**
     * Generate HTML for schema visualization
     */
    private getSchemaHTML(schema: any): string {
        const tables = Array.from(schema.tables.values());

        let tablesHTML = '';
        for (const table of tables) {
            const columnsHTML = (table as Table).columns
                .map(col => {
                    const badges = [];
                    if (col.primaryKey) badges.push('<span class="badge pk">PK</span>');
                    if (col.foreignKey) badges.push('<span class="badge fk">FK</span>');
                    if (!col.nullable) badges.push('<span class="badge nn">NOT NULL</span>');

                    return `
                        <tr>
                            <td>${col.name}</td>
                            <td>${col.type}</td>
                            <td>${badges.join(' ')}</td>
                            <td>${col.foreignKey ? `→ ${col.foreignKey.table}` : ''}</td>
                        </tr>
                    `;
                })
                .join('');

            const indexesHTML = (table as Table).indexes.length > 0
                ? `
                    <h4>Indexes</h4>
                    <ul>
                        ${(table as Table).indexes.map(idx =>
                    `<li>${idx.columns.join(', ')} ${idx.unique ? '(UNIQUE)' : ''}</li>`
                ).join('')}
                    </ul>
                `
                : '';

            tablesHTML += `
                <div class="table-card">
                    <h3>${table.name}</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>Column</th>
                                <th>Type</th>
                                <th>Constraints</th>
                                <th>References</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${columnsHTML}
                        </tbody>
                    </table>
                    ${indexesHTML}
                </div>
            `;
        }

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                        padding: 20px;
                    }
                    .table-card {
                        background-color: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                        padding: 16px;
                        margin-bottom: 20px;
                    }
                    h3 {
                        margin-top: 0;
                        color: var(--vscode-symbolIcon-classForeground);
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 10px;
                    }
                    th, td {
                        text-align: left;
                        padding: 8px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    th {
                        font-weight: 600;
                        background-color: var(--vscode-editor-background);
                    }
                    .badge {
                        display: inline-block;
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-size: 11px;
                        font-weight: 600;
                        margin-right: 4px;
                    }
                    .badge.pk {
                        background-color: #ffc107;
                        color: #000;
                    }
                    .badge.fk {
                        background-color: #2196f3;
                        color: #fff;
                    }
                    .badge.nn {
                        background-color: #f44336;
                        color: #fff;
                    }
                    h4 {
                        margin-top: 16px;
                        margin-bottom: 8px;
                    }
                    ul {
                        margin: 0;
                        padding-left: 20px;
                    }
                </style>
            </head>
            <body>
                <h1>Database Schema</h1>
                <p>Schema version: ${schema.version || 'unknown'}</p>
                <p>Total tables: ${tables.length}</p>
                <hr>
                ${tablesHTML}
            </body>
            </html>
        `;
    }

    /**
     * Go to table definition in schema.rb
     */
    private async goToTableDefinition(): Promise<void> {
        const tables = this.schemaParser.getTableNames();

        if (tables.length === 0) {
            vscode.window.showWarningMessage('No tables found in schema.rb');
            return;
        }

        const selected = await vscode.window.showQuickPick(tables, {
            placeHolder: 'Select a table to navigate to'
        });

        if (!selected) {
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const schemaPath = vscode.Uri.joinPath(workspaceFolder.uri, 'db', 'schema.rb');

        try {
            const document = await vscode.workspace.openTextDocument(schemaPath);
            const text = document.getText();
            const lines = text.split('\n');

            // Find the create_table line
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(`create_table "${selected}"`)) {
                    const editor = await vscode.window.showTextDocument(document);
                    const position = new vscode.Position(i, 0);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(new vscode.Range(position, position));
                    break;
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Could not open schema.rb: ${error}`);
        }
    }

    /**
     * Generate migration from model
     */
    private async generateMigration(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('Open a model file first');
            return;
        }

        // Detect missing columns by comparing model validations with schema
        const document = editor.document;
        const text = document.getText();

        // Extract model name
        const classMatch = text.match(/class\s+(\w+)\s*</);
        if (!classMatch) {
            vscode.window.showWarningMessage('Not a valid model file');
            return;
        }

        const modelName = classMatch[1];
        const tableName = this.schemaParser.getTableNameFromModel(modelName);
        const table = this.schemaParser.getTable(tableName);

        // Extract validations
        const validations = this.extractValidations(text);
        const missingColumns: string[] = [];

        for (const attr of validations) {
            if (!table || !table.columns.find(c => c.name === attr)) {
                missingColumns.push(attr);
            }
        }

        if (missingColumns.length === 0) {
            vscode.window.showInformationMessage('All validated attributes exist in schema');
            return;
        }

        // Ask user to confirm
        const confirmed = await vscode.window.showWarningMessage(
            `Missing columns detected: ${missingColumns.join(', ')}. Generate migration?`,
            'Yes', 'No'
        );

        if (confirmed !== 'Yes') {
            return;
        }

        // Generate migration
        const migration = this.generateMigrationCode(tableName, missingColumns);

        // Show in new document
        const doc = await vscode.workspace.openTextDocument({
            content: migration,
            language: 'ruby'
        });

        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage('Migration generated. Save and run rails db:migrate');
    }

    /**
     * Extract validations from model
     */
    private extractValidations(text: string): string[] {
        const attributes: Set<string> = new Set();
        const validationRegex = /validates?\s+:(\w+)/g;

        let match;
        while ((match = validationRegex.exec(text)) !== null) {
            attributes.add(match[1]);
        }

        return Array.from(attributes);
    }

    /**
     * Generate migration code
     */
    private generateMigrationCode(tableName: string, columns: string[]): string {
        const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const className = `Add${columns.map(c =>
            c.charAt(0).toUpperCase() + c.slice(1)
        ).join('And')}To${tableName.charAt(0).toUpperCase() + tableName.slice(1)}`;

        return `# frozen_string_literal: true

class ${className} < ActiveRecord::Migration[7.0]
  def change
    ${columns.map(col => `add_column :${tableName}, :${col}, :string`).join('\n    ')}
  end
end
`;
    }

    /**
     * Reload schema
     */
    private async reloadSchema(): Promise<void> {
        await this.schemaParser.reload();
        vscode.window.showInformationMessage('Database schema reloaded');
    }

    /**
     * Open database console
     */
    private openDatabaseConsole(): void {
        const terminal = vscode.window.createTerminal('Database Console');
        terminal.sendText('rails dbconsole');
        terminal.show();
    }

    /**
     * Run SQL query
     */
    private async runSQLQuery(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const selection = editor.selection;
        const query = editor.document.getText(selection);

        if (!query.trim()) {
            vscode.window.showWarningMessage('Select a SQL query first');
            return;
        }

        const terminal = vscode.window.createTerminal('SQL Query');
        terminal.sendText(`rails runner "puts ActiveRecord::Base.connection.execute(<<~SQL).to_a
${query}
SQL
).inspect"`);
        terminal.show();
    }

    /**
     * Show table columns
     */
    private async showTableColumns(): Promise<void> {
        const tables = this.schemaParser.getTableNames();

        if (tables.length === 0) {
            vscode.window.showWarningMessage('No tables found');
            return;
        }

        const selected = await vscode.window.showQuickPick(tables, {
            placeHolder: 'Select a table'
        });

        if (!selected) {
            return;
        }

        const table = this.schemaParser.getTable(selected);
        if (!table) {
            return;
        }

        const columnInfo = table.columns
            .map(col => {
                const parts = [col.name, col.type];
                if (col.primaryKey) parts.push('PK');
                if (!col.nullable) parts.push('NOT NULL');
                if (col.foreignKey) parts.push(`FK → ${col.foreignKey.table}`);
                return parts.join(' | ');
            })
            .join('\n');

        const doc = await vscode.workspace.openTextDocument({
            content: `Table: ${selected}\n\n${columnInfo}`,
            language: 'plaintext'
        });

        await vscode.window.showTextDocument(doc);
    }
}

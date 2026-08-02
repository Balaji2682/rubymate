import * as vscode from 'vscode';
import * as path from 'path';
import { CoreRubyIndex, RubySymbol } from '../advancedIndexer';
import { pluralize, singularize, underscore, camelize, tableize, classify } from '../shared/inflections';

/**
 * RailsCascader — Cascades a rename across the entire Rails convention tree.
 *
 * When a user renames a Rails Model, Controller, or other conventional component,
 * this module computes all the ripple effects: file renames, class renames,
 * route updates, association updates, view directory renames, and optional
 * migration generation.
 */

// ── Public types ─────────────────────────────────────────────────────

export interface CascadeResult {
    /** WorkspaceEdit containing all text replacements and file renames */
    edit: vscode.WorkspaceEdit;
    /** Human-readable summary of all changes for the Refactor Preview */
    description: string;
    /** Generated migration file content (if applicable) */
    migrationContent?: string;
    /** Path where the migration should be written */
    migrationPath?: string;
}

export interface CascadeTarget {
    kind: 'file_rename' | 'text_replace' | 'dir_rename';
    oldValue: string;
    newValue: string;
    uri?: vscode.Uri;
    range?: vscode.Range;
}

// ── Association patterns ─────────────────────────────────────────────

const ASSOCIATION_PATTERN = /\b(has_many|has_one|belongs_to|has_and_belongs_to_many)\s+:(\w+)/g;
const RESOURCES_PATTERN = /\b(resources?)\s+:(\w+)/g;

// ── Class ────────────────────────────────────────────────────────────

export class RailsCascader {
    constructor(
        private readonly indexer: CoreRubyIndex,
        private readonly workspaceRoot: string
    ) {}

    /**
     * Cascade a Model rename across the entire Rails project.
     *
     * Renames: model file, controller class + file, view dir,
     * routes, associations in other models, schema references,
     * and generates a migration.
     */
    async cascadeModelRename(
        oldClassName: string,
        newClassName: string
    ): Promise<CascadeResult> {
        const edit = new vscode.WorkspaceEdit();
        const changes: string[] = [];

        const oldSnake = underscore(oldClassName);
        const newSnake = underscore(newClassName);
        const oldPlural = pluralize(oldSnake);
        const newPlural = pluralize(newSnake);
        const oldTable = tableize(oldClassName);
        const newTable = tableize(newClassName);

        // 1. Rename model file
        const oldModelPath = path.join(this.workspaceRoot, 'app', 'models', `${oldSnake}.rb`);
        const newModelPath = path.join(this.workspaceRoot, 'app', 'models', `${newSnake}.rb`);
        if (await this.fileExists(oldModelPath)) {
            edit.renameFile(vscode.Uri.file(oldModelPath), vscode.Uri.file(newModelPath));
            changes.push(`Rename model file: ${oldSnake}.rb → ${newSnake}.rb`);
        }

        // 2. Rename controller class + file
        const oldControllerClass = `${pluralize(oldClassName)}Controller`;
        const newControllerClass = `${pluralize(newClassName)}Controller`;
        const oldControllerPath = path.join(this.workspaceRoot, 'app', 'controllers', `${oldPlural}_controller.rb`);
        const newControllerPath = path.join(this.workspaceRoot, 'app', 'controllers', `${newPlural}_controller.rb`);
        if (await this.fileExists(oldControllerPath)) {
            edit.renameFile(vscode.Uri.file(oldControllerPath), vscode.Uri.file(newControllerPath));
            changes.push(`Rename controller file: ${oldPlural}_controller.rb → ${newPlural}_controller.rb`);

            // Replace class name inside controller file
            await this.replaceInFile(edit, oldControllerPath, oldControllerClass, newControllerClass);
            changes.push(`Rename controller class: ${oldControllerClass} → ${newControllerClass}`);
        }

        // 3. Rename views directory
        const oldViewsDir = path.join(this.workspaceRoot, 'app', 'views', oldPlural);
        const newViewsDir = path.join(this.workspaceRoot, 'app', 'views', newPlural);
        if (await this.dirExists(oldViewsDir)) {
            edit.renameFile(vscode.Uri.file(oldViewsDir), vscode.Uri.file(newViewsDir));
            changes.push(`Rename views directory: views/${oldPlural}/ → views/${newPlural}/`);
        }

        // 4. Update routes.rb
        const routesPath = path.join(this.workspaceRoot, 'config', 'routes.rb');
        if (await this.fileExists(routesPath)) {
            const routeChanges = await this.updateRoutes(edit, routesPath, oldPlural, newPlural);
            changes.push(...routeChanges);
        }

        // 5. Update associations in other models
        const assocChanges = await this.updateAssociations(edit, oldClassName, newClassName);
        changes.push(...assocChanges);

        // 6. Update schema.rb references
        const schemaPath = path.join(this.workspaceRoot, 'db', 'schema.rb');
        if (await this.fileExists(schemaPath)) {
            const schemaChanges = await this.updateSchema(edit, schemaPath, oldTable, newTable);
            changes.push(...schemaChanges);
        }

        // 7. Rename spec files
        const specChanges = await this.renameSpecs(edit, oldSnake, newSnake, oldPlural, newPlural);
        changes.push(...specChanges);

        // 8. Rename factory file
        const oldFactoryPath = path.join(this.workspaceRoot, 'spec', 'factories', `${oldPlural}.rb`);
        const newFactoryPath = path.join(this.workspaceRoot, 'spec', 'factories', `${newPlural}.rb`);
        if (await this.fileExists(oldFactoryPath)) {
            edit.renameFile(vscode.Uri.file(oldFactoryPath), vscode.Uri.file(newFactoryPath));
            await this.replaceInFile(edit, oldFactoryPath, `:${oldSnake}`, `:${newSnake}`);
            changes.push(`Rename factory: ${oldPlural}.rb → ${newPlural}.rb`);
        }

        // 9. Rename serializer
        const oldSerializerPath = path.join(this.workspaceRoot, 'app', 'serializers', `${oldSnake}_serializer.rb`);
        const newSerializerPath = path.join(this.workspaceRoot, 'app', 'serializers', `${newSnake}_serializer.rb`);
        if (await this.fileExists(oldSerializerPath)) {
            edit.renameFile(vscode.Uri.file(oldSerializerPath), vscode.Uri.file(newSerializerPath));
            const oldSerializerClass = `${oldClassName}Serializer`;
            const newSerializerClass = `${newClassName}Serializer`;
            await this.replaceInFile(edit, oldSerializerPath, oldSerializerClass, newSerializerClass);
            changes.push(`Rename serializer: ${oldSnake}_serializer.rb → ${newSnake}_serializer.rb`);
        }

        // 10. Generate migration
        const migrationContent = this.generateMigration(oldTable, newTable);
        const timestamp = this.migrationTimestamp();
        const migrationPath = path.join(
            this.workspaceRoot, 'db', 'migrate',
            `${timestamp}_rename_${oldTable}_to_${newTable}.rb`
        );

        return {
            edit,
            description: changes.length > 0
                ? `Rails Model Rename: ${oldClassName} → ${newClassName}\n\n${changes.map(c => `• ${c}`).join('\n')}`
                : `No Rails convention files found for ${oldClassName}`,
            migrationContent,
            migrationPath
        };
    }

    /**
     * Cascade a Controller rename (lighter than Model rename).
     * Renames: controller file, view dir, routes.
     */
    async cascadeControllerRename(
        oldControllerClass: string,
        newControllerClass: string
    ): Promise<CascadeResult> {
        const edit = new vscode.WorkspaceEdit();
        const changes: string[] = [];

        // Strip "Controller" suffix to get the resource name
        const oldBase = oldControllerClass.replace(/Controller$/, '');
        const newBase = newControllerClass.replace(/Controller$/, '');
        const oldPlural = underscore(oldBase);
        const newPlural = underscore(newBase);

        // 1. Rename controller file
        const oldPath = path.join(this.workspaceRoot, 'app', 'controllers', `${oldPlural}_controller.rb`);
        const newPath = path.join(this.workspaceRoot, 'app', 'controllers', `${newPlural}_controller.rb`);
        if (await this.fileExists(oldPath)) {
            edit.renameFile(vscode.Uri.file(oldPath), vscode.Uri.file(newPath));
            await this.replaceInFile(edit, oldPath, oldControllerClass, newControllerClass);
            changes.push(`Rename controller: ${oldPlural}_controller.rb → ${newPlural}_controller.rb`);
        }

        // 2. Rename views directory
        const oldViewsDir = path.join(this.workspaceRoot, 'app', 'views', oldPlural);
        const newViewsDir = path.join(this.workspaceRoot, 'app', 'views', newPlural);
        if (await this.dirExists(oldViewsDir)) {
            edit.renameFile(vscode.Uri.file(oldViewsDir), vscode.Uri.file(newViewsDir));
            changes.push(`Rename views: views/${oldPlural}/ → views/${newPlural}/`);
        }

        // 3. Update routes.rb
        const routesPath = path.join(this.workspaceRoot, 'config', 'routes.rb');
        if (await this.fileExists(routesPath)) {
            const routeChanges = await this.updateRoutes(edit, routesPath, oldPlural, newPlural);
            changes.push(...routeChanges);
        }

        // 4. Rename controller spec
        const oldSpecPath = path.join(this.workspaceRoot, 'spec', 'controllers', `${oldPlural}_controller_spec.rb`);
        const newSpecPath = path.join(this.workspaceRoot, 'spec', 'controllers', `${newPlural}_controller_spec.rb`);
        if (await this.fileExists(oldSpecPath)) {
            edit.renameFile(vscode.Uri.file(oldSpecPath), vscode.Uri.file(newSpecPath));
            changes.push(`Rename controller spec`);
        }

        return {
            edit,
            description: changes.length > 0
                ? `Rails Controller Rename: ${oldControllerClass} → ${newControllerClass}\n\n${changes.map(c => `• ${c}`).join('\n')}`
                : `No Rails convention files found for ${oldControllerClass}`
        };
    }

    // ── Private helpers ──────────────────────────────────────────────

    /**
     * Update `resources :old_plural` → `resources :new_plural` in routes.rb.
     */
    private async updateRoutes(
        edit: vscode.WorkspaceEdit,
        routesPath: string,
        oldPlural: string,
        newPlural: string
    ): Promise<string[]> {
        const changes: string[] = [];
        try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(routesPath));
            const text = doc.getText();

            RESOURCES_PATTERN.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = RESOURCES_PATTERN.exec(text)) !== null) {
                if (match[2] === oldPlural) {
                    const startPos = doc.positionAt(match.index + match[1].length + 2); // after "resources :"
                    const endPos = doc.positionAt(match.index + match[1].length + 2 + oldPlural.length);
                    edit.replace(doc.uri, new vscode.Range(startPos, endPos), newPlural);
                    changes.push(`Update route: resources :${oldPlural} → :${newPlural}`);
                }
            }
        } catch {
            // routes.rb doesn't exist or can't be opened
        }
        return changes;
    }

    /**
     * Update ActiveRecord associations across all model files.
     */
    private async updateAssociations(
        edit: vscode.WorkspaceEdit,
        oldClassName: string,
        newClassName: string
    ): Promise<string[]> {
        const changes: string[] = [];
        const oldSnake = underscore(oldClassName);
        const newSnake = underscore(newClassName);
        const oldPlural = pluralize(oldSnake);
        const newPlural = pluralize(newSnake);

        const modelsDir = path.join(this.workspaceRoot, 'app', 'models');
        try {
            const files = await vscode.workspace.findFiles(
                new vscode.RelativePattern(modelsDir, '**/*.rb')
            );

            for (const fileUri of files) {
                const doc = await vscode.workspace.openTextDocument(fileUri);
                const text = doc.getText();

                ASSOCIATION_PATTERN.lastIndex = 0;
                let match: RegExpExecArray | null;
                while ((match = ASSOCIATION_PATTERN.exec(text)) !== null) {
                    const assocType = match[1];
                    const assocName = match[2];

                    let shouldReplace = false;
                    let newAssocName = '';

                    // has_many :users → has_many :customers
                    if ((assocType === 'has_many' || assocType === 'has_and_belongs_to_many') && assocName === oldPlural) {
                        shouldReplace = true;
                        newAssocName = newPlural;
                    }
                    // has_one :user → has_one :customer
                    // belongs_to :user → belongs_to :customer
                    if ((assocType === 'has_one' || assocType === 'belongs_to') && assocName === oldSnake) {
                        shouldReplace = true;
                        newAssocName = newSnake;
                    }

                    if (shouldReplace) {
                        // Replace the association name (the symbol after the colon)
                        const nameStart = match.index + match[1].length + 2; // after "has_many :"
                        const startPos = doc.positionAt(nameStart);
                        const endPos = doc.positionAt(nameStart + assocName.length);
                        edit.replace(doc.uri, new vscode.Range(startPos, endPos), newAssocName);
                        changes.push(`Update association in ${path.basename(fileUri.fsPath)}: ${assocType} :${assocName} → :${newAssocName}`);
                    }
                }
            }
        } catch {
            // Models directory doesn't exist
        }
        return changes;
    }

    /**
     * Update `create_table "old_table"` references in schema.rb.
     */
    private async updateSchema(
        edit: vscode.WorkspaceEdit,
        schemaPath: string,
        oldTable: string,
        newTable: string
    ): Promise<string[]> {
        const changes: string[] = [];
        try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(schemaPath));
            const text = doc.getText();

            // Match create_table "table_name"
            const tablePattern = new RegExp(`create_table\\s+["']${this.escapeRegex(oldTable)}["']`, 'g');
            let match: RegExpExecArray | null;
            while ((match = tablePattern.exec(text)) !== null) {
                const nameStart = match.index + match[0].indexOf(oldTable);
                const startPos = doc.positionAt(nameStart);
                const endPos = doc.positionAt(nameStart + oldTable.length);
                edit.replace(doc.uri, new vscode.Range(startPos, endPos), newTable);
                changes.push(`Update schema: create_table "${oldTable}" → "${newTable}"`);
            }

            // Match foreign key references: t.references :old_name / t.belongs_to :old_name
            const oldSnake = underscore(classify(oldTable));
            const newSnake = underscore(classify(newTable));
            const refPattern = new RegExp(`(t\\.(?:references|belongs_to)\\s+:)${this.escapeRegex(oldSnake)}\\b`, 'g');
            while ((match = refPattern.exec(text)) !== null) {
                const nameStart = match.index + match[1].length;
                const startPos = doc.positionAt(nameStart);
                const endPos = doc.positionAt(nameStart + oldSnake.length);
                edit.replace(doc.uri, new vscode.Range(startPos, endPos), newSnake);
                changes.push(`Update schema reference: :${oldSnake} → :${newSnake}`);
            }
        } catch {
            // schema.rb doesn't exist
        }
        return changes;
    }

    /**
     * Rename spec files (model, controller, request).
     */
    private async renameSpecs(
        edit: vscode.WorkspaceEdit,
        oldSnake: string,
        newSnake: string,
        oldPlural: string,
        newPlural: string
    ): Promise<string[]> {
        const changes: string[] = [];
        const specPairs = [
            [`spec/models/${oldSnake}_spec.rb`, `spec/models/${newSnake}_spec.rb`],
            [`spec/controllers/${oldPlural}_controller_spec.rb`, `spec/controllers/${newPlural}_controller_spec.rb`],
            [`spec/requests/${oldPlural}_spec.rb`, `spec/requests/${newPlural}_spec.rb`],
        ];

        for (const [oldSpec, newSpec] of specPairs) {
            const oldPath = path.join(this.workspaceRoot, oldSpec);
            const newPath = path.join(this.workspaceRoot, newSpec);
            if (await this.fileExists(oldPath)) {
                edit.renameFile(vscode.Uri.file(oldPath), vscode.Uri.file(newPath));
                changes.push(`Rename spec: ${path.basename(oldSpec)} → ${path.basename(newSpec)}`);
            }
        }
        return changes;
    }

    /**
     * Replace all occurrences of `oldText` with `newText` in a file.
     */
    private async replaceInFile(
        edit: vscode.WorkspaceEdit,
        filePath: string,
        oldText: string,
        newText: string
    ): Promise<void> {
        try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            const text = doc.getText();
            const pattern = new RegExp(this.escapeRegex(oldText), 'g');

            let match: RegExpExecArray | null;
            while ((match = pattern.exec(text)) !== null) {
                const startPos = doc.positionAt(match.index);
                const endPos = doc.positionAt(match.index + oldText.length);
                edit.replace(doc.uri, new vscode.Range(startPos, endPos), newText);
            }
        } catch {
            // File can't be opened
        }
    }

    /**
     * Generate a database migration for renaming a table.
     */
    private generateMigration(oldTable: string, newTable: string): string {
        const className = `Rename${camelize(oldTable)}To${camelize(newTable)}`;
        return [
            `class ${className} < ActiveRecord::Migration[7.1]`,
            `  def change`,
            `    rename_table :${oldTable}, :${newTable}`,
            `  end`,
            `end`,
            ''
        ].join('\n');
    }

    /**
     * Generate a Rails-style migration timestamp.
     */
    private migrationTimestamp(): string {
        const now = new Date();
        const pad = (n: number, len = 2) => String(n).padStart(len, '0');
        return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
            return true;
        } catch {
            return false;
        }
    }

    private async dirExists(dirPath: string): Promise<boolean> {
        try {
            const stat = await vscode.workspace.fs.stat(vscode.Uri.file(dirPath));
            return (stat.type & vscode.FileType.Directory) !== 0;
        } catch {
            return false;
        }
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

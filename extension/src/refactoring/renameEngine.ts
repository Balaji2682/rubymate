import * as vscode from 'vscode';
import { CoreRubyIndex, RubySymbol } from '../advancedIndexer';
import { ParserService } from '../parsing';
import { SymbolLinker, LinkedSymbol } from './symbolLinker';
import { RailsCascader, CascadeResult } from './railsCascader';
import { underscore } from '../shared/inflections';
import { getRubyTokenAtPosition } from '../shared/rubyToken';

/**
 * AdvancedRenameEngine — Orchestrates intelligent, scope-aware,
 * Rails-aware rename refactoring.
 *
 * Uses the existing Tree-sitter AST (via ParserService) to:
 *   1. Determine the exact symbol category at the cursor.
 *   2. Confine the rename to the correct scope.
 *   3. Cascade renames through Rails conventions when applicable.
 *   4. Link metaprogramming-derived symbols.
 */

// ── Types ────────────────────────────────────────────────────────────

export type SymbolCategory =
    | 'local_variable'
    | 'instance_variable'
    | 'class_variable'
    | 'global_variable'
    | 'method'
    | 'class'
    | 'module'
    | 'constant'
    | 'symbol_literal'
    | 'unknown';

export interface RenameContext {
    /** The raw token text the user clicked on */
    tokenText: string;
    /** Classified category of the symbol */
    category: SymbolCategory;
    /** The scope range within which the rename should be confined (for locals) */
    scopeRange?: vscode.Range;
    /** The resolved RubySymbol from the index (if found) */
    indexedSymbol?: RubySymbol;
    /** Whether this symbol is inside a Rails model class */
    isRailsModel: boolean;
    /** Whether this symbol is inside a Rails controller class */
    isRailsController: boolean;
    /** The containing class name (if any) */
    containingClass?: string;
}

// ── Engine ───────────────────────────────────────────────────────────

export class AdvancedRenameEngine {
    private readonly symbolLinker: SymbolLinker;
    private readonly railsCascader: RailsCascader;

    constructor(
        private readonly indexer: CoreRubyIndex,
        private readonly parserService: ParserService
    ) {
        this.symbolLinker = new SymbolLinker(indexer, parserService);
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        this.railsCascader = new RailsCascader(indexer, workspaceRoot);
    }

    /**
     * Main entry point. Computes the full WorkspaceEdit for a rename,
     * including scope-confined changes, metaprogramming links, and
     * Rails convention cascades.
     */
    async computeRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string
    ): Promise<vscode.WorkspaceEdit> {
        // 1. Classify the symbol
        const ctx = await this.categorizeSymbol(document, position);

        // 2. Dispatch to the appropriate rename strategy
        switch (ctx.category) {
            case 'local_variable':
                return this.renameLocalVariable(ctx, newName, document);

            case 'instance_variable':
                return this.renameInstanceVariable(ctx, newName, document);

            case 'class_variable':
                return this.renameClassVariable(ctx, newName, document);

            case 'class':
                return this.renameClass(ctx, newName, document);

            case 'module':
                return this.renameModule(ctx, newName, document);

            case 'method':
                return this.renameMethod(ctx, newName, document);

            case 'constant':
                return this.renameConstant(ctx, newName, document);

            case 'global_variable':
            case 'symbol_literal':
            case 'unknown':
            default:
                return this.renameGeneric(ctx, newName, document, position);
        }
    }

    // ── Symbol classification ────────────────────────────────────────

    /**
     * Determines the exact category and scope of the symbol at the cursor
     * by inspecting the token text and the AST context.
     */
    private async categorizeSymbol(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<RenameContext> {
        const token = getRubyTokenAtPosition(document, position);
        const tokenText = token?.text ?? '';

        // Determine category from token shape
        let category: SymbolCategory = 'unknown';
        if (tokenText.startsWith('@@')) {
            category = 'class_variable';
        } else if (tokenText.startsWith('@')) {
            category = 'instance_variable';
        } else if (tokenText.startsWith('$')) {
            category = 'global_variable';
        } else if (/^[A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*$/.test(tokenText)) {
            // Starts with uppercase — could be class, module, or constant
            category = 'constant'; // We'll refine below
        } else if (/^[a-z_][a-z0-9_]*[?!=]?$/.test(tokenText)) {
            // Lowercase identifier — could be local variable or method
            category = 'unknown'; // Refine below
        }

        // Use the index to refine
        let indexedSymbol: RubySymbol | undefined;
        let isRailsModel = false;
        let isRailsController = false;
        let containingClass: string | undefined;
        let scopeRange: vscode.Range | undefined;

        // Find the symbol at cursor
        indexedSymbol = this.indexer.findSymbolAtPosition(document.uri, position);

        if (indexedSymbol) {
            // Refine category from indexed symbol kind
            switch (indexedSymbol.kind) {
                case vscode.SymbolKind.Class:
                    category = 'class';
                    break;
                case vscode.SymbolKind.Module:
                    category = 'module';
                    break;
                case vscode.SymbolKind.Method:
                case vscode.SymbolKind.Function:
                    category = 'method';
                    break;
                case vscode.SymbolKind.Constant:
                    category = 'constant';
                    break;
                case vscode.SymbolKind.Variable:
                    if (category === 'unknown') {
                        category = 'local_variable';
                    }
                    break;
                case vscode.SymbolKind.Property:
                    if (tokenText.startsWith('@')) {
                        category = 'instance_variable';
                    }
                    break;
            }
            containingClass = indexedSymbol.containerName;
        }

        // If still unknown, try to determine if it's a local variable or method
        if (category === 'unknown') {
            const line = document.lineAt(position.line).text;
            // Check if it looks like a method definition
            if (line.match(new RegExp(`\\bdef\\s+(self\\.)?${this.escapeRegex(tokenText)}\\b`))) {
                category = 'method';
            } else {
                // Check if any symbol in the index matches as a method
                const symbols = this.indexer.findSymbols(tokenText);
                const methodMatch = symbols.find(s =>
                    s.kind === vscode.SymbolKind.Method || s.kind === vscode.SymbolKind.Function
                );
                if (methodMatch) {
                    category = 'method';
                    indexedSymbol = methodMatch;
                } else {
                    // Default to local variable (scope-confined)
                    category = 'local_variable';
                }
            }
        }

        // If the symbol is uppercase and the index says it's a class, check Rails conventions
        if (category === 'class' || category === 'constant') {
            const classSymbols = this.indexer.findClasses(tokenText);
            if (classSymbols.length > 0) {
                category = 'class';
                indexedSymbol = classSymbols[0];

                // Check if it's a Rails model or controller
                const filePath = classSymbols[0].location.uri.fsPath;
                if (filePath.includes('/app/models/') || filePath.includes('\\app\\models\\')) {
                    isRailsModel = true;
                }
                if (filePath.includes('/app/controllers/') || filePath.includes('\\app\\controllers\\')) {
                    isRailsController = true;
                }
            }
        }

        // For local variables, determine scope (the enclosing method)
        if (category === 'local_variable') {
            const enclosingSymbols = this.indexer.findSymbolsContainingPosition(document.uri, position);
            const enclosingMethod = enclosingSymbols.find(s =>
                s.kind === vscode.SymbolKind.Method || s.kind === vscode.SymbolKind.Function
            );
            if (enclosingMethod) {
                scopeRange = enclosingMethod.location.range;
                containingClass = enclosingMethod.containerName;
            }
        }

        // For instance variables, scope is the containing class
        if (category === 'instance_variable') {
            const enclosingSymbols = this.indexer.findSymbolsContainingPosition(document.uri, position);
            const enclosingClass = enclosingSymbols.find(s =>
                s.kind === vscode.SymbolKind.Class || s.kind === vscode.SymbolKind.Module
            );
            if (enclosingClass) {
                containingClass = enclosingClass.name;
            }
        }

        return {
            tokenText,
            category,
            scopeRange,
            indexedSymbol,
            isRailsModel,
            isRailsController,
            containingClass
        };
    }

    // ── Rename strategies ────────────────────────────────────────────

    /**
     * Renames a local variable — confined to the enclosing method scope.
     * This is the fastest rename: single-file, single-method.
     */
    private async renameLocalVariable(
        ctx: RenameContext,
        newName: string,
        document: vscode.TextDocument
    ): Promise<vscode.WorkspaceEdit> {
        const edit = new vscode.WorkspaceEdit();
        const text = document.getText();
        const scope = ctx.scopeRange;
        const oldName = ctx.tokenText;

        // If we have a scope, only search within it
        const searchStart = scope ? document.offsetAt(scope.start) : 0;
        const searchEnd = scope ? document.offsetAt(scope.end) : text.length;
        const searchText = text.substring(searchStart, searchEnd);

        // Find all word-boundary matches within scope
        const pattern = new RegExp(`(?<![A-Za-z0-9_@$])${this.escapeRegex(oldName)}(?![A-Za-z0-9_?!=])`, 'g');
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(searchText)) !== null) {
            const absoluteOffset = searchStart + match.index;
            const startPos = document.positionAt(absoluteOffset);
            const endPos = document.positionAt(absoluteOffset + oldName.length);

            // Skip if inside a string or comment (basic heuristic)
            const line = document.lineAt(startPos.line).text;
            if (this.isInCommentOrString(line, startPos.character)) {
                continue;
            }

            edit.replace(document.uri, new vscode.Range(startPos, endPos), newName);
        }

        return edit;
    }

    /**
     * Renames an instance variable — scoped to the containing class,
     * but across all files that define or use that class.
     * Also handles linked attr_accessor symbols.
     */
    private async renameInstanceVariable(
        ctx: RenameContext,
        newName: string,
        document: vscode.TextDocument
    ): Promise<vscode.WorkspaceEdit> {
        const edit = new vscode.WorkspaceEdit();
        const oldName = ctx.tokenText;
        const bareOldName = oldName.replace(/^@/, '');
        const bareNewName = newName.replace(/^@/, '');

        // Ensure new name starts with @
        const newIvar = newName.startsWith('@') ? newName : `@${newName}`;

        // 1. Rename @old_name → @new_name in current file (within class scope)
        await this.replaceWordInDocument(edit, document, oldName, newIvar);

        // 2. Check for linked attr_accessor symbols
        const linkedSymbols = await this.symbolLinker.findLinkedSymbols(bareOldName, document);
        for (const linked of linkedSymbols) {
            if (linked.kind === 'attr_accessor' || linked.kind === 'attr_reader' || linked.kind === 'attr_writer') {
                // Also rename the attr declaration symbol
                await this.replaceWordInDocument(edit, document, `:${bareOldName}`, `:${bareNewName}`);
                // Rename the getter method calls
                await this.replaceWordInDocument(edit, document, bareOldName, bareNewName, { skipIvars: true });
                // Rename the setter method calls
                if (linked.kind === 'attr_accessor' || linked.kind === 'attr_writer') {
                    await this.replaceWordInDocument(edit, document, `${bareOldName}=`, `${bareNewName}=`);
                }
            }
        }

        // 3. If the class is indexed, search other files that reference this class
        if (ctx.containingClass) {
            const classFiles = this.findFilesForClass(ctx.containingClass);
            for (const fileUri of classFiles) {
                if (fileUri.toString() === document.uri.toString()) { continue; }
                try {
                    const otherDoc = await vscode.workspace.openTextDocument(fileUri);
                    await this.replaceWordInDocument(edit, otherDoc, oldName, newIvar);
                } catch {
                    // Skip files that can't be opened
                }
            }
        }

        return edit;
    }

    /**
     * Renames a class variable — scoped to the class hierarchy.
     */
    private async renameClassVariable(
        ctx: RenameContext,
        newName: string,
        document: vscode.TextDocument
    ): Promise<vscode.WorkspaceEdit> {
        const edit = new vscode.WorkspaceEdit();
        const newCvar = newName.startsWith('@@') ? newName : `@@${newName.replace(/^@+/, '')}`;
        await this.replaceWordInDocument(edit, document, ctx.tokenText, newCvar);
        return edit;
    }

    /**
     * Renames a class — the most complex operation.
     * If it's a Rails model, cascades through the entire convention tree.
     */
    private async renameClass(
        ctx: RenameContext,
        newName: string,
        document: vscode.TextDocument
    ): Promise<vscode.WorkspaceEdit> {
        const edit = new vscode.WorkspaceEdit();
        const oldName = ctx.tokenText;

        // 1. Rename all code references to the class (across workspace)
        await this.renameSymbolAcrossWorkspace(edit, oldName, newName);

        // 2. If it's a Rails model, cascade through conventions
        if (ctx.isRailsModel) {
            const cascadeResult = await this.railsCascader.cascadeModelRename(oldName, newName);
            this.mergeWorkspaceEdits(edit, cascadeResult.edit);

            // Generate migration file
            if (cascadeResult.migrationContent && cascadeResult.migrationPath) {
                edit.createFile(
                    vscode.Uri.file(cascadeResult.migrationPath),
                    { overwrite: false, ignoreIfExists: true, contents: Buffer.from(cascadeResult.migrationContent) }
                );
            }
        }

        // 3. If it's a Rails controller, cascade controller conventions
        if (ctx.isRailsController && oldName.endsWith('Controller')) {
            const cascadeResult = await this.railsCascader.cascadeControllerRename(oldName, newName);
            this.mergeWorkspaceEdits(edit, cascadeResult.edit);
        }

        return edit;
    }

    /**
     * Renames a module — similar to class but no Rails cascade.
     */
    private async renameModule(
        ctx: RenameContext,
        newName: string,
        document: vscode.TextDocument
    ): Promise<vscode.WorkspaceEdit> {
        const edit = new vscode.WorkspaceEdit();
        await this.renameSymbolAcrossWorkspace(edit, ctx.tokenText, newName);
        return edit;
    }

    /**
     * Renames a method — searches across the workspace and handles
     * metaprogramming links (aliases, delegate, send, respond_to?).
     */
    private async renameMethod(
        ctx: RenameContext,
        newName: string,
        document: vscode.TextDocument
    ): Promise<vscode.WorkspaceEdit> {
        const edit = new vscode.WorkspaceEdit();
        const oldName = ctx.tokenText;

        // 1. Find all references via the existing reference provider
        const locations = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            document.uri,
            document.positionAt(document.getText().indexOf(oldName))
        );

        if (locations) {
            for (const loc of locations) {
                edit.replace(loc.uri, loc.range, newName);
            }
        }

        // 2. Find metaprogramming-linked symbols
        const linkedSymbols = await this.symbolLinker.findLinkedSymbols(oldName, document);
        for (const linked of linkedSymbols) {
            if (linked.kind === 'alias') {
                // For aliases, rename the alias reference in the alias_method declaration
                if (linked.location) {
                    const aliasDoc = await vscode.workspace.openTextDocument(linked.location.uri);
                    await this.replaceWordInDocument(edit, aliasDoc, `:${oldName}`, `:${newName}`);
                }
            }
            if (linked.kind === 'send' || linked.kind === 'respond_to') {
                // Rename the symbol reference inside send(:old_name) or respond_to?(:old_name)
                if (linked.location) {
                    const dynamicDoc = await vscode.workspace.openTextDocument(linked.location.uri);
                    await this.replaceWordInDocument(edit, dynamicDoc, `:${oldName}`, `:${newName}`);
                }
            }
            if (linked.kind === 'attr_accessor' || linked.kind === 'attr_reader' || linked.kind === 'attr_writer') {
                // Rename the attr declaration
                if (linked.location) {
                    const attrDoc = await vscode.workspace.openTextDocument(linked.location.uri);
                    await this.replaceWordInDocument(edit, attrDoc, `:${oldName}`, `:${newName}`);
                }
            }
        }

        return edit;
    }

    /**
     * Renames a constant — workspace-wide search.
     */
    private async renameConstant(
        ctx: RenameContext,
        newName: string,
        document: vscode.TextDocument
    ): Promise<vscode.WorkspaceEdit> {
        const edit = new vscode.WorkspaceEdit();
        await this.renameSymbolAcrossWorkspace(edit, ctx.tokenText, newName);
        return edit;
    }

    /**
     * Generic rename — falls back to the reference provider.
     */
    private async renameGeneric(
        ctx: RenameContext,
        newName: string,
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.WorkspaceEdit> {
        const edit = new vscode.WorkspaceEdit();

        const locations = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            document.uri,
            position
        );

        if (locations && locations.length > 0) {
            for (const loc of locations) {
                edit.replace(loc.uri, loc.range, newName);
            }
        } else {
            // Fallback: just rename the current token
            const token = getRubyTokenAtPosition(document, position);
            if (token) {
                edit.replace(document.uri, token.range, newName);
            }
        }

        return edit;
    }

    // ── Shared helpers ───────────────────────────────────────────────

    /**
     * Renames a symbol across the entire workspace using workspace-wide
     * file search + text matching.
     */
    private async renameSymbolAcrossWorkspace(
        edit: vscode.WorkspaceEdit,
        oldName: string,
        newName: string
    ): Promise<void> {
        const files = await vscode.workspace.findFiles(
            '**/*.rb',
            '{**/node_modules/**,**/vendor/bundle/**,**/tmp/**,.git/**}'
        );

        for (const fileUri of files) {
            try {
                const doc = await vscode.workspace.openTextDocument(fileUri);
                await this.replaceWordInDocument(edit, doc, oldName, newName);
            } catch {
                // Skip files that can't be opened
            }
        }
    }

    /**
     * Replace all whole-word occurrences of `oldWord` with `newWord` in a document.
     */
    private async replaceWordInDocument(
        edit: vscode.WorkspaceEdit,
        document: vscode.TextDocument,
        oldWord: string,
        newWord: string,
        options?: { skipIvars?: boolean }
    ): Promise<void> {
        const text = document.getText();
        const escaped = this.escapeRegex(oldWord);

        // Build word-boundary-aware pattern
        let patternStr: string;
        if (oldWord.startsWith('@') || oldWord.startsWith('$')) {
            // For @var and $var, the prefix IS the boundary
            patternStr = `${escaped}(?![A-Za-z0-9_])`;
        } else if (oldWord.startsWith(':')) {
            // For :symbol, the colon is the boundary
            patternStr = `${escaped}(?![A-Za-z0-9_?!=])`;
        } else {
            // For regular identifiers, use word boundaries
            patternStr = `(?<![A-Za-z0-9_@$:])${escaped}(?![A-Za-z0-9_?!=])`;
        }

        const pattern = new RegExp(patternStr, 'g');
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + oldWord.length);

            // Skip instance variables if requested
            if (options?.skipIvars) {
                const charBefore = match.index > 0 ? text[match.index - 1] : '';
                if (charBefore === '@') { continue; }
            }

            edit.replace(document.uri, new vscode.Range(startPos, endPos), newWord);
        }
    }

    /**
     * Find all file URIs that contain symbols for a given class name.
     */
    private findFilesForClass(className: string): vscode.Uri[] {
        const symbols = this.indexer.findSymbols(className);
        const uris = new Set<string>();
        const result: vscode.Uri[] = [];

        for (const sym of symbols) {
            const uriStr = sym.location.uri.toString();
            if (!uris.has(uriStr)) {
                uris.add(uriStr);
                result.push(sym.location.uri);
            }
        }

        return result;
    }

    /**
     * Merges edits from a source WorkspaceEdit into a target WorkspaceEdit.
     */
    private mergeWorkspaceEdits(target: vscode.WorkspaceEdit, source: vscode.WorkspaceEdit): void {
        for (const [uri, edits] of source.entries()) {
            for (const textEdit of edits) {
                if (textEdit instanceof vscode.TextEdit) {
                    target.replace(uri, textEdit.range, textEdit.newText);
                }
            }
        }
    }

    /**
     * Basic heuristic to check if a position is inside a comment or string.
     */
    private isInCommentOrString(line: string, charIndex: number): boolean {
        // Check if there's a # before this position (comment)
        const beforeChar = line.substring(0, charIndex);
        // Simple heuristic: if # appears and isn't inside quotes
        const hashIndex = beforeChar.indexOf('#');
        if (hashIndex >= 0) {
            // Count quotes before the hash to see if it's inside a string
            const quotesBeforeHash = (beforeChar.substring(0, hashIndex).match(/"/g) || []).length;
            if (quotesBeforeHash % 2 === 0) {
                return true; // # is not inside a string, so this is a comment
            }
        }
        return false;
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

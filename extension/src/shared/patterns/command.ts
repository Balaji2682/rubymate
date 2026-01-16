/**
 * Command Pattern for Refactoring Operations
 *
 * Encapsulates refactoring operations as objects, enabling:
 * - Undo/redo functionality
 * - Command history
 * - Composable operations
 * - Logging and auditing
 */

import * as vscode from 'vscode';

/**
 * Result of a command execution
 */
export interface CommandResult {
    success: boolean;
    error?: Error;
    message?: string;
    data?: unknown;
}

/**
 * Command interface - base for all refactoring operations
 */
export interface Command {
    /** Unique identifier for this command instance */
    readonly id: string;

    /** Human-readable name */
    readonly name: string;

    /** Description of what the command does */
    readonly description: string;

    /**
     * Execute the command
     * @returns Promise resolving to the command result
     */
    execute(): Promise<CommandResult>;

    /**
     * Undo the command (reverse the operation)
     * @returns Promise resolving to the undo result
     */
    undo(): Promise<CommandResult>;

    /**
     * Check if the command can be executed
     */
    canExecute(): boolean | Promise<boolean>;

    /**
     * Check if the command can be undone
     */
    canUndo(): boolean;
}

/**
 * Base class for commands with common functionality
 */
export abstract class BaseCommand implements Command {
    abstract readonly id: string;
    abstract readonly name: string;
    abstract readonly description: string;

    protected executed: boolean = false;
    protected executionTimestamp?: number;

    abstract execute(): Promise<CommandResult>;
    abstract undo(): Promise<CommandResult>;

    canExecute(): boolean {
        return !this.executed;
    }

    canUndo(): boolean {
        return this.executed;
    }

    protected success(message?: string, data?: unknown): CommandResult {
        return { success: true, message, data };
    }

    protected failure(error: Error | string): CommandResult {
        return {
            success: false,
            error: typeof error === 'string' ? new Error(error) : error
        };
    }
}

/**
 * Rename Symbol Command
 *
 * Renames a symbol across all its references in the workspace.
 */
export class RenameSymbolCommand extends BaseCommand {
    readonly id: string;
    readonly name = 'Rename Symbol';
    readonly description: string;

    private oldName: string;
    private newName: string;
    private locations: vscode.Location[];
    private originalContents: Map<string, string> = new Map();
    /** Track the new locations after rename for accurate undo */
    private renamedLocations: vscode.Location[] = [];

    constructor(
        oldName: string,
        newName: string,
        locations: vscode.Location[]
    ) {
        super();
        this.id = `rename-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.oldName = oldName;
        this.newName = newName;
        this.locations = locations;
        this.description = `Rename '${oldName}' to '${newName}' in ${locations.length} location(s)`;
    }

    async execute(): Promise<CommandResult> {
        if (this.executed) {
            return this.failure('Command already executed');
        }

        try {
            // Store original contents for undo
            for (const loc of this.locations) {
                const uriStr = loc.uri.toString();
                if (!this.originalContents.has(uriStr)) {
                    const doc = await vscode.workspace.openTextDocument(loc.uri);
                    this.originalContents.set(uriStr, doc.getText());
                }
            }

            // Apply the rename
            const edit = new vscode.WorkspaceEdit();
            for (const loc of this.locations) {
                edit.replace(loc.uri, loc.range, this.newName);
            }

            const success = await vscode.workspace.applyEdit(edit);

            if (success) {
                // Calculate the new locations after rename
                // The range end position changes based on the length difference
                const lengthDiff = this.newName.length - this.oldName.length;
                this.renamedLocations = this.locations.map(loc => {
                    const newEnd = new vscode.Position(
                        loc.range.end.line,
                        loc.range.end.character + lengthDiff
                    );
                    return new vscode.Location(
                        loc.uri,
                        new vscode.Range(loc.range.start, newEnd)
                    );
                });

                this.executed = true;
                this.executionTimestamp = Date.now();
                return this.success(
                    `Renamed '${this.oldName}' to '${this.newName}' in ${this.locations.length} location(s)`
                );
            } else {
                return this.failure('Failed to apply edit');
            }
        } catch (error) {
            return this.failure(error as Error);
        }
    }

    async undo(): Promise<CommandResult> {
        if (!this.executed) {
            return this.failure('Command not yet executed');
        }

        if (this.renamedLocations.length === 0) {
            return this.failure('No renamed locations tracked - cannot undo safely');
        }

        try {
            // Verify all documents still exist before attempting undo
            for (const loc of this.renamedLocations) {
                try {
                    await vscode.workspace.openTextDocument(loc.uri);
                } catch {
                    return this.failure(`Document ${loc.uri.fsPath} is no longer available`);
                }
            }

            // Use the tracked renamed locations for accurate undo
            const edit = new vscode.WorkspaceEdit();
            for (const loc of this.renamedLocations) {
                edit.replace(loc.uri, loc.range, this.oldName);
            }

            const success = await vscode.workspace.applyEdit(edit);

            if (success) {
                this.executed = false;
                this.renamedLocations = []; // Clear for next execution
                return this.success(
                    `Reverted rename: '${this.newName}' back to '${this.oldName}'`
                );
            } else {
                return this.failure('Failed to undo edit');
            }
        } catch (error) {
            return this.failure(error as Error);
        }
    }
}

/**
 * Extract Method Command
 *
 * Extracts selected code into a new method.
 */
export class ExtractMethodCommand extends BaseCommand {
    readonly id: string;
    readonly name = 'Extract Method';
    readonly description: string;

    private document: vscode.TextDocument;
    private selection: vscode.Selection;
    private methodName: string;
    private insertPosition: vscode.Position;
    private originalContent: string = '';

    constructor(
        document: vscode.TextDocument,
        selection: vscode.Selection,
        methodName: string,
        insertPosition: vscode.Position
    ) {
        super();
        this.id = `extract-method-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.document = document;
        this.selection = selection;
        this.methodName = methodName;
        this.insertPosition = insertPosition;
        this.description = `Extract selected code into method '${methodName}'`;
    }

    async execute(): Promise<CommandResult> {
        if (this.executed) {
            return this.failure('Command already executed');
        }

        try {
            this.originalContent = this.document.getText();
            const selectedText = this.document.getText(this.selection);

            // Detect indentation
            const line = this.document.lineAt(this.insertPosition.line);
            const indent = line.text.match(/^\s*/)?.[0] || '';

            // Create the new method
            const methodDef = this.createMethodDefinition(selectedText, indent);

            // Create the method call
            const methodCall = `${this.methodName}`;

            const edit = new vscode.WorkspaceEdit();

            // Insert the new method
            edit.insert(this.document.uri, this.insertPosition, methodDef);

            // Replace the selection with the method call
            edit.replace(this.document.uri, this.selection, methodCall);

            const success = await vscode.workspace.applyEdit(edit);

            if (success) {
                this.executed = true;
                this.executionTimestamp = Date.now();
                return this.success(`Extracted method '${this.methodName}'`);
            } else {
                return this.failure('Failed to apply edit');
            }
        } catch (error) {
            return this.failure(error as Error);
        }
    }

    async undo(): Promise<CommandResult> {
        if (!this.executed) {
            return this.failure('Command not yet executed');
        }

        try {
            // Verify document is still available
            let doc: vscode.TextDocument;
            try {
                doc = await vscode.workspace.openTextDocument(this.document.uri);
            } catch {
                return this.failure(`Document ${this.document.uri.fsPath} is no longer available`);
            }

            // Verify document has content (sanity check)
            if (doc.getText().length === 0 && this.originalContent.length > 0) {
                return this.failure('Document is unexpectedly empty, cannot safely undo');
            }

            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                new vscode.Position(0, 0),
                doc.lineAt(doc.lineCount - 1).range.end
            );
            edit.replace(doc.uri, fullRange, this.originalContent);

            const success = await vscode.workspace.applyEdit(edit);

            if (success) {
                this.executed = false;
                return this.success('Undid extract method');
            } else {
                return this.failure('Failed to undo');
            }
        } catch (error) {
            return this.failure(error as Error);
        }
    }

    private createMethodDefinition(body: string, indent: string): string {
        const bodyLines = body.split('\n').map(line => `${indent}  ${line}`).join('\n');
        return `\n${indent}def ${this.methodName}\n${bodyLines}\n${indent}end\n`;
    }
}

/**
 * Composite Command
 *
 * Groups multiple commands into a single undoable operation.
 */
export class CompositeCommand extends BaseCommand {
    readonly id: string;
    readonly name: string;
    readonly description: string;

    private commands: Command[];
    private executedCommands: Command[] = [];

    constructor(name: string, commands: Command[]) {
        super();
        this.id = `composite-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.name = name;
        this.commands = commands;
        this.description = `${name} (${commands.length} operations)`;
    }

    async execute(): Promise<CommandResult> {
        if (this.executed) {
            return this.failure('Command already executed');
        }

        try {
            for (const command of this.commands) {
                const result = await command.execute();
                if (!result.success) {
                    // Undo any already executed commands
                    for (const executed of this.executedCommands.reverse()) {
                        await executed.undo();
                    }
                    return this.failure(
                        `Failed at '${command.name}': ${result.error?.message}`
                    );
                }
                this.executedCommands.push(command);
            }

            this.executed = true;
            this.executionTimestamp = Date.now();
            return this.success(`Executed ${this.commands.length} operations`);
        } catch (error) {
            // Undo any already executed commands
            for (const executed of this.executedCommands.reverse()) {
                await executed.undo();
            }
            return this.failure(error as Error);
        }
    }

    async undo(): Promise<CommandResult> {
        if (!this.executed) {
            return this.failure('Command not yet executed');
        }

        try {
            // Undo in reverse order
            for (const command of this.executedCommands.reverse()) {
                const result = await command.undo();
                if (!result.success) {
                    return this.failure(
                        `Failed to undo '${command.name}': ${result.error?.message}`
                    );
                }
            }

            this.executed = false;
            this.executedCommands = [];
            return this.success(`Undid ${this.commands.length} operations`);
        } catch (error) {
            return this.failure(error as Error);
        }
    }
}

/**
 * Command History
 *
 * Manages executed commands for undo/redo functionality.
 */
export class CommandHistory {
    private history: Command[] = [];
    private current: number = -1;
    private maxSize: number;

    constructor(maxSize: number = 100) {
        this.maxSize = maxSize;
    }

    /**
     * Execute a command and add it to history
     */
    async execute(command: Command): Promise<CommandResult> {
        const result = await command.execute();

        if (result.success) {
            // Remove any commands after current position (redo history)
            this.history = this.history.slice(0, this.current + 1);

            // Add new command
            this.history.push(command);
            this.current++;

            // Trim history if exceeds max size
            if (this.history.length > this.maxSize) {
                this.history.shift();
                this.current--;
            }
        }

        return result;
    }

    /**
     * Undo the last command
     */
    async undo(): Promise<CommandResult> {
        if (!this.canUndo()) {
            return { success: false, error: new Error('Nothing to undo') };
        }

        const command = this.history[this.current];
        const result = await command.undo();

        if (result.success) {
            this.current--;
        }

        return result;
    }

    /**
     * Redo the last undone command
     */
    async redo(): Promise<CommandResult> {
        if (!this.canRedo()) {
            return { success: false, error: new Error('Nothing to redo') };
        }

        // Get the command to redo (next one after current)
        const command = this.history[this.current + 1];
        const result = await command.execute();

        // Only advance position on successful execution
        if (result.success) {
            this.current++;
        }

        return result;
    }

    /**
     * Check if undo is available
     */
    canUndo(): boolean {
        return this.current >= 0 && this.history[this.current]?.canUndo();
    }

    /**
     * Check if redo is available
     */
    canRedo(): boolean {
        return this.current < this.history.length - 1;
    }

    /**
     * Get the current command (for display purposes)
     */
    getCurrentCommand(): Command | undefined {
        return this.history[this.current];
    }

    /**
     * Get the next command to redo (for display purposes)
     */
    getNextRedoCommand(): Command | undefined {
        if (this.canRedo()) {
            return this.history[this.current + 1];
        }
        return undefined;
    }

    /**
     * Get all commands in history
     */
    getHistory(): readonly Command[] {
        return this.history;
    }

    /**
     * Clear the history
     */
    clear(): void {
        this.history = [];
        this.current = -1;
    }

    /**
     * Get the number of commands in history
     */
    get size(): number {
        return this.history.length;
    }

    /**
     * Get the current position in history
     */
    get position(): number {
        return this.current;
    }
}

/**
 * Command Invoker
 *
 * Manages command execution with support for:
 * - Pre/post execution hooks
 * - Logging
 * - Rate limiting
 */
export class CommandInvoker {
    private history: CommandHistory;
    private preExecuteHooks: Array<(command: Command) => void | Promise<void>> = [];
    private postExecuteHooks: Array<(command: Command, result: CommandResult) => void | Promise<void>> = [];

    constructor(historySize: number = 100) {
        this.history = new CommandHistory(historySize);
    }

    /**
     * Add a pre-execution hook
     */
    onBeforeExecute(hook: (command: Command) => void | Promise<void>): void {
        this.preExecuteHooks.push(hook);
    }

    /**
     * Add a post-execution hook
     */
    onAfterExecute(hook: (command: Command, result: CommandResult) => void | Promise<void>): void {
        this.postExecuteHooks.push(hook);
    }

    /**
     * Execute a command
     */
    async execute(command: Command): Promise<CommandResult> {
        // Run pre-execute hooks
        for (const hook of this.preExecuteHooks) {
            await hook(command);
        }

        // Execute the command
        const result = await this.history.execute(command);

        // Run post-execute hooks
        for (const hook of this.postExecuteHooks) {
            await hook(command, result);
        }

        return result;
    }

    /**
     * Undo the last command
     */
    async undo(): Promise<CommandResult> {
        return this.history.undo();
    }

    /**
     * Redo the last undone command
     */
    async redo(): Promise<CommandResult> {
        return this.history.redo();
    }

    /**
     * Check if undo is available
     */
    canUndo(): boolean {
        return this.history.canUndo();
    }

    /**
     * Check if redo is available
     */
    canRedo(): boolean {
        return this.history.canRedo();
    }

    /**
     * Get the command history
     */
    getHistory(): CommandHistory {
        return this.history;
    }
}

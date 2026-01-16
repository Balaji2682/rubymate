/**
 * Observer Pattern for Incremental Indexing
 *
 * Enables efficient incremental updates by notifying observers
 * when files change, instead of full re-indexing.
 */

import * as vscode from 'vscode';

/**
 * Event types for file changes
 */
export enum FileChangeType {
    Created = 'created',
    Changed = 'changed',
    Deleted = 'deleted',
    Renamed = 'renamed'
}

/**
 * File change event data
 */
export interface FileChangeEvent {
    type: FileChangeType;
    uri: vscode.Uri;
    oldUri?: vscode.Uri; // For renamed files
    timestamp: number;
}

/**
 * Observer interface for receiving index update notifications
 */
export interface IndexObserver {
    /** Unique identifier for the observer */
    readonly id: string;

    /** Priority for notification order (higher = earlier) */
    readonly priority?: number;

    /**
     * Called when a file is changed
     */
    onFileChanged(uri: vscode.Uri): void | Promise<void>;

    /**
     * Called when a file is deleted
     */
    onFileDeleted(uri: vscode.Uri): void | Promise<void>;

    /**
     * Called when a file is created
     */
    onFileCreated(uri: vscode.Uri): void | Promise<void>;

    /**
     * Called when a file is renamed
     */
    onFileRenamed?(oldUri: vscode.Uri, newUri: vscode.Uri): void | Promise<void>;

    /**
     * Called when multiple files change (batch operation)
     */
    onBatchChange?(events: FileChangeEvent[]): void | Promise<void>;

    /**
     * Check if observer should handle this file
     */
    shouldHandle?(uri: vscode.Uri): boolean;
}

/**
 * Options for the index manager
 */
export interface IndexManagerOptions {
    /** File patterns to watch (glob patterns) */
    patterns?: string[];

    /** Debounce delay in milliseconds */
    debounceMs?: number;

    /** Maximum batch size before forcing flush */
    maxBatchSize?: number;

    /** Whether to process events in parallel */
    parallelProcessing?: boolean;
}

/**
 * Index Manager - Subject in the Observer pattern
 *
 * Manages file system watchers and notifies observers of changes.
 * Supports debouncing, batching, and prioritized notification.
 */
export class IndexManager implements vscode.Disposable {
    private observers: IndexObserver[] = [];
    private watchers: vscode.FileSystemWatcher[] = [];
    private pendingEvents: Map<string, FileChangeEvent> = new Map();
    private debounceTimer: NodeJS.Timeout | null = null;
    private disposables: vscode.Disposable[] = [];

    private readonly debounceMs: number;
    private readonly maxBatchSize: number;
    private readonly parallelProcessing: boolean;

    private isProcessing: boolean = false;
    private eventQueue: FileChangeEvent[] = [];

    constructor(options: IndexManagerOptions = {}) {
        this.debounceMs = options.debounceMs ?? 300;
        this.maxBatchSize = options.maxBatchSize ?? 50;
        this.parallelProcessing = options.parallelProcessing ?? true;
    }

    /**
     * Register an observer to receive notifications
     */
    registerObserver(observer: IndexObserver): vscode.Disposable {
        this.observers.push(observer);

        // Sort by priority (higher first)
        this.observers.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

        return new vscode.Disposable(() => {
            this.unregisterObserver(observer.id);
        });
    }

    /**
     * Unregister an observer by ID
     */
    unregisterObserver(observerId: string): void {
        const index = this.observers.findIndex(o => o.id === observerId);
        if (index !== -1) {
            this.observers.splice(index, 1);
        }
    }

    /**
     * Get all registered observers
     */
    getObservers(): readonly IndexObserver[] {
        return this.observers;
    }

    /**
     * Setup file system watchers for the given patterns
     */
    setupWatchers(patterns: string[]): void {
        // Dispose existing watchers
        this.disposeWatchers();

        for (const pattern of patterns) {
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);

            watcher.onDidCreate(uri => this.queueEvent({
                type: FileChangeType.Created,
                uri,
                timestamp: Date.now()
            }), null, this.disposables);

            watcher.onDidChange(uri => this.queueEvent({
                type: FileChangeType.Changed,
                uri,
                timestamp: Date.now()
            }), null, this.disposables);

            watcher.onDidDelete(uri => this.queueEvent({
                type: FileChangeType.Deleted,
                uri,
                timestamp: Date.now()
            }), null, this.disposables);

            this.watchers.push(watcher);
            this.disposables.push(watcher);
        }
    }

    /**
     * Manually trigger a file change notification
     */
    notifyFileChanged(uri: vscode.Uri): void {
        this.queueEvent({
            type: FileChangeType.Changed,
            uri,
            timestamp: Date.now()
        });
    }

    /**
     * Manually trigger a file creation notification
     */
    notifyFileCreated(uri: vscode.Uri): void {
        this.queueEvent({
            type: FileChangeType.Created,
            uri,
            timestamp: Date.now()
        });
    }

    /**
     * Manually trigger a file deletion notification
     */
    notifyFileDeleted(uri: vscode.Uri): void {
        this.queueEvent({
            type: FileChangeType.Deleted,
            uri,
            timestamp: Date.now()
        });
    }

    /**
     * Manually trigger a file rename notification
     */
    notifyFileRenamed(oldUri: vscode.Uri, newUri: vscode.Uri): void {
        this.queueEvent({
            type: FileChangeType.Renamed,
            uri: newUri,
            oldUri,
            timestamp: Date.now()
        });
    }

    /**
     * Force immediate processing of pending events
     */
    async flush(): Promise<void> {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        await this.processPendingEvents();
    }

    /**
     * Check if there are pending events
     */
    hasPendingEvents(): boolean {
        return this.pendingEvents.size > 0 || this.eventQueue.length > 0;
    }

    /**
     * Get the number of pending events
     */
    getPendingEventCount(): number {
        return this.pendingEvents.size + this.eventQueue.length;
    }

    private queueEvent(event: FileChangeEvent): void {
        const key = event.uri.toString();

        // Merge events for the same file (latest event wins, but preserve creation)
        const existing = this.pendingEvents.get(key);
        if (existing) {
            // If file was created and then changed, keep it as created
            if (existing.type === FileChangeType.Created && event.type === FileChangeType.Changed) {
                event.type = FileChangeType.Created;
            }
            // If file was created and then deleted, remove the event entirely
            if (existing.type === FileChangeType.Created && event.type === FileChangeType.Deleted) {
                this.pendingEvents.delete(key);
                this.scheduleProcessing();
                return;
            }
        }

        this.pendingEvents.set(key, event);

        // Force flush if batch size exceeded
        if (this.pendingEvents.size >= this.maxBatchSize) {
            this.flush();
        } else {
            this.scheduleProcessing();
        }
    }

    private scheduleProcessing(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            this.processPendingEvents();
        }, this.debounceMs);
    }

    private async processPendingEvents(): Promise<void> {
        if (this.isProcessing || this.pendingEvents.size === 0) {
            return;
        }

        this.isProcessing = true;

        try {
            const events = Array.from(this.pendingEvents.values());
            this.pendingEvents.clear();

            // Sort events by timestamp
            events.sort((a, b) => a.timestamp - b.timestamp);

            // Notify observers with batch support first
            for (const observer of this.observers) {
                if (observer.onBatchChange) {
                    const relevantEvents = observer.shouldHandle
                        ? events.filter(e => observer.shouldHandle!(e.uri))
                        : events;

                    if (relevantEvents.length > 0) {
                        await observer.onBatchChange(relevantEvents);
                    }
                }
            }

            // Then notify individual event handlers
            if (this.parallelProcessing) {
                await Promise.all(events.map(event => this.processEvent(event)));
            } else {
                for (const event of events) {
                    await this.processEvent(event);
                }
            }
        } finally {
            this.isProcessing = false;

            // Process any events that came in during processing
            if (this.pendingEvents.size > 0) {
                this.scheduleProcessing();
            }
        }
    }

    private async processEvent(event: FileChangeEvent): Promise<void> {
        const notifyPromises: Promise<void>[] = [];

        for (const observer of this.observers) {
            // Skip if observer already handled via batch
            if (observer.onBatchChange) {
                continue;
            }

            // Check if observer should handle this file
            if (observer.shouldHandle && !observer.shouldHandle(event.uri)) {
                continue;
            }

            try {
                let promise: void | Promise<void>;

                switch (event.type) {
                    case FileChangeType.Created:
                        promise = observer.onFileCreated(event.uri);
                        break;
                    case FileChangeType.Changed:
                        promise = observer.onFileChanged(event.uri);
                        break;
                    case FileChangeType.Deleted:
                        promise = observer.onFileDeleted(event.uri);
                        break;
                    case FileChangeType.Renamed:
                        if (observer.onFileRenamed && event.oldUri) {
                            promise = observer.onFileRenamed(event.oldUri, event.uri);
                        } else if (event.oldUri) {
                            // Fall back to delete + create when oldUri exists
                            await observer.onFileDeleted(event.oldUri);
                            promise = observer.onFileCreated(event.uri);
                        } else {
                            // No oldUri, treat as creation only
                            promise = observer.onFileCreated(event.uri);
                        }
                        break;
                }

                if (promise instanceof Promise) {
                    notifyPromises.push(
                        promise.catch(error => {
                            console.error(`Observer ${observer.id} failed processing ${event.type} for ${event.uri.fsPath}:`, error);
                        })
                    );
                }
            } catch (error) {
                // Catch synchronous errors
                console.error(`Observer ${observer.id} threw error processing ${event.type}:`, error);
            }
        }

        await Promise.all(notifyPromises);
    }

    private disposeWatchers(): void {
        for (const watcher of this.watchers) {
            watcher.dispose();
        }
        this.watchers = [];
    }

    dispose(): void {
        // Reset processing flag to prevent orphaned promises
        this.isProcessing = false;

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }

        for (const disposable of this.disposables) {
            disposable.dispose();
        }

        this.disposeWatchers();
        this.observers = [];
        this.pendingEvents.clear();
        this.eventQueue = [];
    }
}

/**
 * Base class for index observers with common functionality
 */
export abstract class BaseIndexObserver implements IndexObserver {
    abstract readonly id: string;
    readonly priority?: number;

    protected filePatterns: RegExp[] = [];

    constructor(filePatterns?: (string | RegExp)[]) {
        if (filePatterns) {
            this.filePatterns = filePatterns.map(p => {
                if (typeof p === 'string') {
                    // Proper glob to regex conversion:
                    // 1. Escape regex special characters (except * and ?)
                    // 2. Convert ** to match any path segment
                    // 3. Convert * to match within a single path segment
                    // 4. Convert ? to match single character
                    const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&');
                    const globbed = escaped
                        .replace(/\*\*/g, '<<GLOBSTAR>>')
                        .replace(/\*/g, '[^/\\\\]*')
                        .replace(/<<GLOBSTAR>>/g, '.*')
                        .replace(/\?/g, '.');
                    return new RegExp(globbed);
                }
                return p;
            });
        }
    }

    shouldHandle(uri: vscode.Uri): boolean {
        if (this.filePatterns.length === 0) {
            return true;
        }

        const path = uri.fsPath;
        return this.filePatterns.some(pattern => pattern.test(path));
    }

    abstract onFileChanged(uri: vscode.Uri): void | Promise<void>;
    abstract onFileDeleted(uri: vscode.Uri): void | Promise<void>;
    abstract onFileCreated(uri: vscode.Uri): void | Promise<void>;

    onFileRenamed?(oldUri: vscode.Uri, newUri: vscode.Uri): void | Promise<void>;
    onBatchChange?(events: FileChangeEvent[]): void | Promise<void>;
}

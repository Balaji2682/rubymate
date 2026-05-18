/**
 * Stimulus Controller Indexer
 *
 * Discovers and indexes Stimulus controllers in app/javascript/controllers.
 * Supports caching to .rubymate/stimulus-index.json for fast startup.
 *
 * Optimizations:
 * - Trie for O(k) prefix search on controller names
 * - BloomFilter for O(1) "definitely not a controller" checks
 * - Debounced file watcher to batch rapid changes
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { StimulusParser } from './stimulusParser';
import {
    StimulusController,
    StimulusIndex,
    StimulusControllerData,
    STIMULUS_INDEX_VERSION,
    STIMULUS_INDEX_FILE
} from './types';
import { Trie } from '../shared/dataStructures/trie';
import { BloomFilter } from '../shared/dataStructures/bloomFilter';
import { ParserService } from '../parsing';

export class StimulusIndexer {
    private controllers: Map<string, StimulusController> = new Map();
    private parser: StimulusParser;
    private outputChannel: vscode.OutputChannel;
    private fileWatcher: vscode.FileSystemWatcher | null = null;
    private indexing: boolean = false;
    private stimulusPath: string;

    // Performance: Trie for O(k) prefix search
    private controllerTrie: Trie<string> = new Trie();
    private trieValid: boolean = false;

    // Performance: BloomFilter for fast negative lookups
    private controllerBloom: BloomFilter = new BloomFilter({ expectedElements: 100 });

    // Performance: Debounced file watcher (simple implementation)
    private pendingChanges: Set<string> = new Set();
    private debounceTimer: NodeJS.Timeout | null = null;
    private readonly DEBOUNCE_DELAY = 300;

    constructor(
        private context: vscode.ExtensionContext,
        outputChannel: vscode.OutputChannel,
        parserService?: ParserService
    ) {
        this.parser = new StimulusParser(parserService);
        this.outputChannel = outputChannel;
        this.stimulusPath = this.getStimulusPath();
    }

    /**
     * Schedule processing of pending changes (debounced)
     */
    private scheduleProcessPendingChanges(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.processPendingChanges();
        }, this.DEBOUNCE_DELAY);
    }

    /**
     * Process all pending file changes in batch
     */
    private async processPendingChanges(): Promise<void> {
        const paths = Array.from(this.pendingChanges);
        this.pendingChanges.clear();
        this.debounceTimer = null;

        for (const filePath of paths) {
            await this.indexController(filePath);
        }

        if (paths.length > 0) {
            this.invalidateTrie();
            await this.saveToCache();
        }
    }

    /**
     * Invalidate the Trie (will be rebuilt on next prefix search)
     */
    private invalidateTrie(): void {
        this.trieValid = false;
    }

    /**
     * Ensure Trie is built (lazy initialization)
     */
    private ensureTrieBuilt(): void {
        if (this.trieValid) {
            return;
        }

        this.controllerTrie = new Trie();
        for (const name of this.controllers.keys()) {
            this.controllerTrie.insert(name, name);
        }
        this.trieValid = true;
    }

    /**
     * Get configured Stimulus controllers path
     */
    private getStimulusPath(): string {
        const config = vscode.workspace.getConfiguration('rubymate');
        return config.get<string>('hotwire.stimulusPath', 'app/javascript/controllers');
    }

    /**
     * Get workspace root directory
     */
    private get workspaceRoot(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    /**
     * Get cache directory path
     */
    private get cacheDir(): string {
        const root = this.workspaceRoot;
        if (root) {
            return path.join(root, '.rubymate');
        }
        return path.join(this.context.globalStorageUri.fsPath, 'hotwire-cache');
    }

    /**
     * Get cache file path
     */
    private get cacheFilePath(): string {
        return path.join(this.cacheDir, STIMULUS_INDEX_FILE);
    }

    /**
     * Initialize the indexer - load cache and set up file watcher
     */
    async initialize(): Promise<void> {
        const root = this.workspaceRoot;
        if (!root) {
            return;
        }

        // Try to load from cache first
        const loaded = await this.loadFromCache();
        if (!loaded) {
            // Full index if no cache
            await this.indexAllControllers();
        }

        // Set up file watcher for incremental updates
        this.setupFileWatcher();
    }

    /**
     * Set up file watcher for Stimulus controllers
     */
    private setupFileWatcher(): void {
        const root = this.workspaceRoot;
        if (!root) {
            return;
        }

        const pattern = new vscode.RelativePattern(
            root,
            `${this.stimulusPath}/**/*_controller.{js,ts}`
        );

        this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        this.fileWatcher.onDidCreate(uri => this.onControllerCreated(uri));
        this.fileWatcher.onDidChange(uri => this.onControllerChanged(uri));
        this.fileWatcher.onDidDelete(uri => this.onControllerDeleted(uri));

        this.context.subscriptions.push(this.fileWatcher);
    }

    /**
     * Handler for new controller file (debounced)
     */
    private onControllerCreated(uri: vscode.Uri): void {
        this.pendingChanges.add(uri.fsPath);
        this.scheduleProcessPendingChanges();
        this.outputChannel.appendLine(`[Stimulus] Queued indexing: ${path.basename(uri.fsPath)}`);
    }

    /**
     * Handler for changed controller file (debounced)
     */
    private onControllerChanged(uri: vscode.Uri): void {
        this.pendingChanges.add(uri.fsPath);
        this.scheduleProcessPendingChanges();
    }

    /**
     * Handler for deleted controller file
     */
    private async onControllerDeleted(uri: vscode.Uri): Promise<void> {
        const controllerName = this.parser.extractControllerName(uri.fsPath);
        if (controllerName) {
            this.controllers.delete(controllerName);
            this.invalidateTrie();
            // Rebuild bloom filter (can't remove from standard bloom filter)
            this.rebuildBloomFilter();
            await this.saveToCache();
            this.outputChannel.appendLine(`[Stimulus] Removed controller: ${controllerName}`);
        }
    }

    /**
     * Rebuild bloom filter after deletion
     */
    private rebuildBloomFilter(): void {
        this.controllerBloom = new BloomFilter({
            expectedElements: Math.max(100, this.controllers.size * 2)
        });
        for (const name of this.controllers.keys()) {
            this.controllerBloom.add(name);
        }
    }

    /**
     * Index all controllers in the workspace
     */
    async indexAllControllers(): Promise<void> {
        const root = this.workspaceRoot;
        if (!root || this.indexing) {
            return;
        }

        this.indexing = true;
        this.controllers.clear();

        // Reset bloom filter for fresh index
        this.controllerBloom = new BloomFilter({ expectedElements: 200 });
        this.invalidateTrie();

        try {
            const controllersDir = path.join(root, this.stimulusPath);

            // Check if controllers directory exists
            try {
                await fs.access(controllersDir);
            } catch {
                this.outputChannel.appendLine(`[Stimulus] Controllers directory not found: ${controllersDir}`);
                return;
            }

            // Find all controller files
            const files = await vscode.workspace.findFiles(
                new vscode.RelativePattern(root, `${this.stimulusPath}/**/*_controller.{js,ts}`),
                '**/node_modules/**'
            );

            this.outputChannel.appendLine(`[Stimulus] Found ${files.length} controller files`);

            // Index each controller
            for (const file of files) {
                await this.indexController(file.fsPath);
            }

            // Save to cache
            await this.saveToCache();

            this.outputChannel.appendLine(`[Stimulus] Indexed ${this.controllers.size} controllers`);
        } finally {
            this.indexing = false;
        }
    }

    /**
     * Index a single controller file
     */
    private async indexController(filePath: string): Promise<void> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');

            // Verify it's a valid Stimulus controller
            if (!(await this.parser.isValidController(content, filePath))) {
                return;
            }

            const stats = await fs.stat(filePath);
            const controller = await this.parser.parseController(content, filePath, stats.mtimeMs);

            if (controller) {
                this.controllers.set(controller.name, controller);
                // Add to bloom filter for O(1) negative lookups
                this.controllerBloom.add(controller.name);
            }
        } catch (error) {
            this.outputChannel.appendLine(`[Stimulus] Error indexing ${filePath}: ${error}`);
        }
    }

    /**
     * Load index from cache
     */
    private async loadFromCache(): Promise<boolean> {
        try {
            const cacheContent = await fs.readFile(this.cacheFilePath, 'utf-8');
            const index: StimulusIndex = JSON.parse(cacheContent);

            // Check version
            if (index.version !== STIMULUS_INDEX_VERSION) {
                this.outputChannel.appendLine('[Stimulus] Cache version mismatch, reindexing...');
                return false;
            }

            // Validate and load controllers
            let validCount = 0;
            let invalidCount = 0;

            for (const [name, data] of Object.entries(index.controllers)) {
                try {
                    // Check if file still exists and hasn't changed
                    const stats = await fs.stat(data.filePath);
                    if (Math.abs(stats.mtimeMs - data.mtime) < 1000) {
                        // File hasn't changed, use cached data
                        const controller: StimulusController = {
                            name,
                            filePath: data.filePath,
                            uri: vscode.Uri.file(data.filePath),
                            targets: data.targets,
                            values: data.values,
                            outlets: data.outlets,
                            actions: data.actions.map(a => ({
                                name: a.name,
                                line: a.line
                            })),
                            classes: data.classes,
                            mtime: data.mtime
                        };
                        this.controllers.set(name, controller);
                        validCount++;
                    } else {
                        // File changed, reindex it
                        await this.indexController(data.filePath);
                        validCount++;
                    }
                } catch {
                    // File doesn't exist anymore
                    invalidCount++;
                }
            }

            if (invalidCount > 0) {
                // Save updated cache
                await this.saveToCache();
            }

            this.outputChannel.appendLine(`[Stimulus] Loaded ${validCount} controllers from cache`);
            return true;
        } catch {
            // Cache doesn't exist or is invalid
            return false;
        }
    }

    /**
     * Save index to cache
     */
    private async saveToCache(): Promise<void> {
        try {
            // Ensure cache directory exists
            await fs.mkdir(this.cacheDir, { recursive: true });

            const index: StimulusIndex = {
                version: STIMULUS_INDEX_VERSION,
                indexedAt: Date.now(),
                controllers: {}
            };

            for (const [name, controller] of this.controllers) {
                index.controllers[name] = {
                    filePath: controller.filePath,
                    targets: controller.targets,
                    values: controller.values,
                    outlets: controller.outlets,
                    actions: controller.actions.map(a => ({
                        name: a.name,
                        line: a.line
                    })),
                    classes: controller.classes,
                    mtime: controller.mtime
                };
            }

            await fs.writeFile(this.cacheFilePath, JSON.stringify(index, null, 2));
        } catch (error) {
            this.outputChannel.appendLine(`[Stimulus] Error saving cache: ${error}`);
        }
    }

    /**
     * Get all indexed controllers
     */
    getControllers(): Map<string, StimulusController> {
        return this.controllers;
    }

    /**
     * Get a specific controller by name
     */
    getController(name: string): StimulusController | undefined {
        return this.controllers.get(name);
    }

    /**
     * Get controller names for completion
     */
    getControllerNames(): string[] {
        return Array.from(this.controllers.keys());
    }

    /**
     * Get controller names matching a prefix (O(k) with Trie)
     */
    getControllerNamesWithPrefix(prefix: string): string[] {
        if (!prefix) {
            return this.getControllerNames();
        }

        this.ensureTrieBuilt();
        return this.controllerTrie.searchPrefix(prefix);
    }

    /**
     * Quick check if a name could be a controller (O(1) with BloomFilter)
     * Returns false only if DEFINITELY not a controller.
     * Returns true if POSSIBLY a controller (may have false positives).
     */
    mightBeController(name: string): boolean {
        return this.controllerBloom.mightContain(name);
    }

    /**
     * Check if a controller exists (with bloom filter optimization)
     */
    hasController(name: string): boolean {
        // Quick negative check with bloom filter
        if (!this.controllerBloom.mightContain(name)) {
            return false;
        }
        // Confirm with actual lookup
        return this.controllers.has(name);
    }

    /**
     * Get actions for a specific controller
     */
    getActions(controllerName: string): StimulusController['actions'] {
        const controller = this.controllers.get(controllerName);
        return controller?.actions ?? [];
    }

    /**
     * Get targets for a specific controller
     */
    getTargets(controllerName: string): string[] {
        const controller = this.controllers.get(controllerName);
        return controller?.targets ?? [];
    }

    /**
     * Get values for a specific controller
     */
    getValues(controllerName: string): StimulusController['values'] {
        const controller = this.controllers.get(controllerName);
        return controller?.values ?? [];
    }

    /**
     * Get outlets for a specific controller
     */
    getOutlets(controllerName: string): string[] {
        const controller = this.controllers.get(controllerName);
        return controller?.outlets ?? [];
    }

    /**
     * Get classes for a specific controller
     */
    getClasses(controllerName: string): string[] {
        const controller = this.controllers.get(controllerName);
        return controller?.classes ?? [];
    }

    /**
     * Force reindex all controllers
     */
    async reindex(): Promise<void> {
        await this.indexAllControllers();
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        // Cancel pending debounced operations
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }

        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}

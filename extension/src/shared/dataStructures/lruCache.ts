/**
 * LRU (Least Recently Used) Cache implementation
 * Performance: O(1) for get/set operations
 *
 * Uses a doubly-linked list combined with a Map for O(1) access and eviction
 */

import { BloomFilter } from './bloomFilter';

interface CacheNode<K, V> {
    key: K;
    value: V;
    prev: CacheNode<K, V> | null;
    next: CacheNode<K, V> | null;
    timestamp: number;
}

export interface LRUCacheOptions {
    maxSize?: number;
    maxAge?: number; // TTL in milliseconds
    onEvict?: <K, V>(key: K, value: V) => void;
}

export class LRUCache<K, V> {
    private cache: Map<K, CacheNode<K, V>> = new Map();
    private head: CacheNode<K, V> | null = null;
    private tail: CacheNode<K, V> | null = null;
    private maxSize: number;
    private maxAge: number | undefined;
    private onEvict?: <K, V>(key: K, value: V) => void;
    private hits: number = 0;
    private misses: number = 0;

    constructor(options: LRUCacheOptions = {}) {
        const maxSize = options.maxSize ?? 1000;
        if (maxSize < 1) {
            throw new Error('maxSize must be at least 1');
        }
        if (options.maxAge !== undefined && options.maxAge < 0) {
            throw new Error('maxAge cannot be negative');
        }

        this.maxSize = maxSize;
        this.maxAge = options.maxAge;
        this.onEvict = options.onEvict;
    }

    /**
     * Safely increment hits counter (prevents overflow)
     */
    private incrementHits(): void {
        if (this.hits < Number.MAX_SAFE_INTEGER) {
            this.hits++;
        }
    }

    /**
     * Safely increment misses counter (prevents overflow)
     */
    private incrementMisses(): void {
        if (this.misses < Number.MAX_SAFE_INTEGER) {
            this.misses++;
        }
    }

    /**
     * Get a value from the cache
     * Returns undefined if not found or expired
     */
    get(key: K): V | undefined {
        const node = this.cache.get(key);

        if (!node) {
            this.incrementMisses();
            return undefined;
        }

        // Check if expired
        if (this.isExpired(node)) {
            this.delete(key);
            this.incrementMisses();
            return undefined;
        }

        // Move to front (most recently used)
        this.moveToFront(node);
        this.incrementHits();
        return node.value;
    }

    /**
     * Set a value in the cache
     */
    set(key: K, value: V): this {
        let node = this.cache.get(key);

        if (node) {
            // Update existing node
            node.value = value;
            node.timestamp = Date.now();
            this.moveToFront(node);
        } else {
            // Create new node
            node = {
                key,
                value,
                prev: null,
                next: this.head,
                timestamp: Date.now()
            };

            if (this.head) {
                this.head.prev = node;
            }
            this.head = node;

            if (!this.tail) {
                this.tail = node;
            }

            this.cache.set(key, node);

            // Evict if over capacity
            while (this.cache.size > this.maxSize) {
                this.evictLRU();
            }
        }

        return this;
    }

    /**
     * Check if a key exists and is not expired
     */
    has(key: K): boolean {
        const node = this.cache.get(key);
        if (!node) {
            return false;
        }
        if (this.isExpired(node)) {
            this.delete(key);
            return false;
        }
        return true;
    }

    /**
     * Delete a key from the cache
     */
    delete(key: K): boolean {
        const node = this.cache.get(key);
        if (!node) {
            return false;
        }

        this.removeNode(node);
        this.cache.delete(key);
        return true;
    }

    /**
     * Clear the entire cache
     */
    clear(): void {
        if (this.onEvict) {
            for (const node of this.cache.values()) {
                this.onEvict(node.key, node.value);
            }
        }
        this.cache.clear();
        this.head = null;
        this.tail = null;
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Get the current size of the cache
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * Get all keys in the cache (from most to least recently used)
     */
    keys(): K[] {
        const keys: K[] = [];
        let node = this.head;
        while (node) {
            if (!this.isExpired(node)) {
                keys.push(node.key);
            }
            node = node.next;
        }
        return keys;
    }

    /**
     * Get all values in the cache (from most to least recently used)
     */
    values(): V[] {
        const values: V[] = [];
        let node = this.head;
        while (node) {
            if (!this.isExpired(node)) {
                values.push(node.value);
            }
            node = node.next;
        }
        return values;
    }

    /**
     * Get all entries in the cache
     */
    entries(): Array<[K, V]> {
        const entries: Array<[K, V]> = [];
        let node = this.head;
        while (node) {
            if (!this.isExpired(node)) {
                entries.push([node.key, node.value]);
            }
            node = node.next;
        }
        return entries;
    }

    /**
     * Iterate over each entry
     */
    forEach(callback: (value: V, key: K, cache: LRUCache<K, V>) => void): void {
        let node = this.head;
        while (node) {
            if (!this.isExpired(node)) {
                callback(node.value, node.key, this);
            }
            node = node.next;
        }
    }

    /**
     * Peek at a value without updating its position
     */
    peek(key: K): V | undefined {
        const node = this.cache.get(key);
        if (!node || this.isExpired(node)) {
            return undefined;
        }
        return node.value;
    }

    /**
     * Get cache statistics
     */
    getStats(): { hits: number; misses: number; hitRate: number; size: number } {
        const total = this.hits + this.misses;
        return {
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0,
            size: this.cache.size
        };
    }

    /**
     * Reset statistics
     */
    resetStats(): void {
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Prune expired entries
     */
    prune(): number {
        if (!this.maxAge) {
            return 0;
        }

        let pruned = 0;
        const keysToDelete: K[] = [];

        for (const [key, node] of this.cache) {
            if (this.isExpired(node)) {
                keysToDelete.push(key);
            }
        }

        for (const key of keysToDelete) {
            this.delete(key);
            pruned++;
        }

        return pruned;
    }

    /**
     * Resize the cache
     */
    resize(newMaxSize: number): void {
        this.maxSize = newMaxSize;
        while (this.cache.size > this.maxSize) {
            this.evictLRU();
        }
    }

    private isExpired(node: CacheNode<K, V>): boolean {
        if (!this.maxAge) {
            return false;
        }
        return Date.now() - node.timestamp > this.maxAge;
    }

    private moveToFront(node: CacheNode<K, V>): void {
        if (node === this.head) {
            return;
        }

        this.removeNode(node);

        node.prev = null;
        node.next = this.head;

        if (this.head) {
            this.head.prev = node;
        }

        this.head = node;

        if (!this.tail) {
            this.tail = node;
        }
    }

    private removeNode(node: CacheNode<K, V>): void {
        if (node.prev) {
            node.prev.next = node.next;
        } else {
            this.head = node.next;
        }

        if (node.next) {
            node.next.prev = node.prev;
        } else {
            this.tail = node.prev;
        }
    }

    private evictLRU(): void {
        if (!this.tail) {
            return;
        }

        const evictedNode = this.tail;
        this.removeNode(evictedNode);
        this.cache.delete(evictedNode.key);

        if (this.onEvict) {
            this.onEvict(evictedNode.key, evictedNode.value);
        }
    }
}

/**
 * Specialized cache for file existence checks
 *
 * Uses a BloomFilter for O(1) negative lookups - if the BloomFilter says
 * "definitely not", we skip the expensive filesystem check entirely.
 * This significantly reduces I/O for repeated lookups of non-existent files.
 */
export class FileExistenceCache {
    private cache: LRUCache<string, boolean>;
    private pendingChecks: Map<string, Promise<boolean>> = new Map();

    /**
     * BloomFilter for tracking non-existent files (negative cache).
     * When a file is confirmed not to exist, we add it to this filter.
     * On lookup, if the filter says "definitely not", we skip the I/O check.
     */
    private nonExistentFilter: BloomFilter;
    private bloomFilterHits: number = 0;

    constructor(maxSize: number = 5000, maxAge: number = 60000) {
        this.cache = new LRUCache<string, boolean>({ maxSize, maxAge });

        // Configure BloomFilter for expected non-existent file lookups
        // Using 10000 expected elements with 1% false positive rate
        // This uses ~12KB of memory and provides O(1) negative lookups
        this.nonExistentFilter = new BloomFilter({
            expectedElements: 10000,
            falsePositiveRate: 0.01
        });
    }

    /**
     * Check if a file exists (cached)
     * Uses BloomFilter for O(1) negative lookup optimization
     */
    async exists(filePath: string, checkFn: (path: string) => Promise<boolean>): Promise<boolean> {
        // Check cache first
        const cached = this.cache.get(filePath);
        if (cached !== undefined) {
            return cached;
        }

        // Check BloomFilter for quick negative lookup
        // If the filter says the file is in the "non-existent" set,
        // it's either definitely not there, or a rare false positive
        if (this.nonExistentFilter.mightContain(filePath)) {
            // BloomFilter says "might not exist" - but it could be a false positive
            // We still need to verify, but we track this for statistics
            this.bloomFilterHits++;
        }

        // Check if there's already a pending check for this path
        const pending = this.pendingChecks.get(filePath);
        if (pending) {
            return pending;
        }

        // Perform the check and cache the result
        const checkPromise = checkFn(filePath)
            .then(result => {
                this.cache.set(filePath, result);
                this.pendingChecks.delete(filePath);

                // If file doesn't exist, add to BloomFilter for future fast lookups
                if (!result) {
                    this.nonExistentFilter.add(filePath);
                }

                return result;
            })
            .catch(() => {
                this.cache.set(filePath, false);
                this.pendingChecks.delete(filePath);

                // File check failed, treat as non-existent
                this.nonExistentFilter.add(filePath);

                return false;
            });

        this.pendingChecks.set(filePath, checkPromise);
        return checkPromise;
    }

    /**
     * Quick check if a file definitely doesn't exist (O(1) using BloomFilter).
     * Returns true if the file DEFINITELY does not exist.
     * Returns false if the file might exist (needs full check).
     *
     * This is useful for pre-filtering before expensive operations.
     */
    definitelyNotExists(filePath: string): boolean {
        // If not in the non-existent filter, it might exist
        // BloomFilter never has false negatives, so if it's not in the filter,
        // we haven't confirmed it doesn't exist
        return false; // BloomFilter can only tell us "might contain", not "definitely doesn't"
    }

    /**
     * Pre-populate the BloomFilter with known non-existent paths.
     * Useful for bulk initialization from previous sessions.
     */
    addKnownNonExistent(filePath: string): void {
        this.nonExistentFilter.add(filePath);
    }

    /**
     * Invalidate a cached path
     * Note: Cannot remove from BloomFilter (standard limitation),
     * but we clear the LRU cache entry
     */
    invalidate(filePath: string): void {
        this.cache.delete(filePath);
        // Note: BloomFilter doesn't support deletion
        // If you need deletion support, use CountingBloomFilter instead
    }

    /**
     * Invalidate all paths matching a pattern
     */
    invalidatePattern(pattern: RegExp): void {
        for (const key of this.cache.keys()) {
            if (pattern.test(key)) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Clear all cached entries and reset BloomFilter
     */
    clear(): void {
        this.cache.clear();
        this.pendingChecks.clear();
        this.nonExistentFilter.clear();
        this.bloomFilterHits = 0;
    }

    /**
     * Get cache statistics including BloomFilter metrics
     */
    getStats() {
        const cacheStats = this.cache.getStats();
        return {
            ...cacheStats,
            bloomFilter: {
                hits: this.bloomFilterHits,
                fillRatio: this.nonExistentFilter.fillRatio,
                estimatedFPR: this.nonExistentFilter.estimatedFalsePositiveRate,
                memoryBytes: this.nonExistentFilter.memoryUsage,
                itemCount: this.nonExistentFilter.count
            }
        };
    }
}

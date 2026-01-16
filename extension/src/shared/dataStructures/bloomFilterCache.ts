/**
 * BloomFilterCache - A hybrid cache combining LRUCache with BloomFilter
 *
 * This utility provides O(1) negative lookups using a BloomFilter while
 * maintaining an LRU cache for positive results. It's ideal for scenarios
 * where cache misses are frequent and expensive to compute.
 *
 * Use cases:
 * - File existence checks (quickly filter non-existent paths)
 * - Symbol lookups (avoid expensive searches for non-existent symbols)
 * - Database query caching (skip queries for non-existent records)
 *
 * Performance characteristics:
 * - Get: O(1) for cache hit or BloomFilter negative
 * - Set: O(1) for both cache and BloomFilter
 * - Memory: ~10 bits per expected element for 1% FPR
 */

import { LRUCache, LRUCacheOptions } from './lruCache';
import { BloomFilter, CountingBloomFilter, BloomFilterOptions } from './bloomFilter';

export interface BloomFilterCacheOptions<K, V> extends LRUCacheOptions {
    /**
     * Expected number of negative entries (items that will be marked as "not found")
     * Used to size the BloomFilter appropriately.
     * Default: 10000
     */
    expectedNegatives?: number;

    /**
     * False positive rate for the BloomFilter.
     * Lower values use more memory but have fewer false positives.
     * Default: 0.01 (1%)
     */
    falsePositiveRate?: number;

    /**
     * If true, use CountingBloomFilter which supports deletion.
     * Uses ~4x more memory than standard BloomFilter.
     * Default: false
     */
    supportDeletion?: boolean;

    /**
     * Function to convert the key to a string for BloomFilter storage.
     * Default: String(key)
     */
    keyToString?: (key: K) => string;
}

export interface BloomFilterCacheStats {
    cache: {
        hits: number;
        misses: number;
        hitRate: number;
        size: number;
    };
    bloomFilter: {
        negativeCount: number;
        fillRatio: number;
        estimatedFPR: number;
        memoryBytes: number;
    };
    performance: {
        bloomFilterSkips: number;
        totalLookups: number;
        skipRate: number;
    };
}

/**
 * BloomFilterCache - Combines LRUCache with BloomFilter for optimized lookups
 *
 * @example
 * ```typescript
 * // Create a cache for file existence checks
 * const fileCache = new BloomFilterCache<string, boolean>({
 *     maxSize: 1000,
 *     expectedNegatives: 5000,
 *     falsePositiveRate: 0.01
 * });
 *
 * // Mark a file as non-existent
 * fileCache.setNegative('/path/that/does/not/exist');
 *
 * // Quick check - O(1) if previously marked negative
 * if (fileCache.isDefinitelyNegative('/path/that/does/not/exist')) {
 *     // Skip expensive filesystem check
 *     return false;
 * }
 * ```
 */
export class BloomFilterCache<K, V> {
    private cache: LRUCache<K, V>;
    private negativeFilter: BloomFilter | CountingBloomFilter;
    private keyToString: (key: K) => string;
    private supportsDeletion: boolean;

    // Statistics
    private bloomFilterSkips: number = 0;
    private totalLookups: number = 0;

    constructor(options: BloomFilterCacheOptions<K, V> = {}) {
        const {
            expectedNegatives = 10000,
            falsePositiveRate = 0.01,
            supportDeletion = false,
            keyToString = (k: K) => String(k),
            ...cacheOptions
        } = options;

        this.cache = new LRUCache<K, V>(cacheOptions);
        this.keyToString = keyToString;
        this.supportsDeletion = supportDeletion;

        const bloomOptions: BloomFilterOptions = {
            expectedElements: expectedNegatives,
            falsePositiveRate
        };

        this.negativeFilter = supportDeletion
            ? new CountingBloomFilter(bloomOptions)
            : new BloomFilter(bloomOptions);
    }

    /**
     * Get a value from the cache.
     * Returns undefined if not found in cache.
     * Does NOT automatically check BloomFilter - use isDefinitelyNegative first.
     */
    get(key: K): V | undefined {
        this.totalLookups++;
        return this.cache.get(key);
    }

    /**
     * Get a value, checking BloomFilter first for quick negative lookups.
     * If the key is in the negative filter, returns undefined immediately.
     */
    getWithBloomCheck(key: K): V | undefined {
        this.totalLookups++;

        // Check BloomFilter first for quick negative lookup
        if (this.isDefinitelyNegative(key)) {
            this.bloomFilterSkips++;
            return undefined;
        }

        return this.cache.get(key);
    }

    /**
     * Set a positive value in the cache.
     * If the key was previously marked as negative, it will be removed
     * from the negative filter (only if supportDeletion is enabled).
     */
    set(key: K, value: V): this {
        // Remove from negative filter if deletion is supported
        if (this.supportsDeletion) {
            const keyStr = this.keyToString(key);
            (this.negativeFilter as CountingBloomFilter).remove(keyStr);
        }

        this.cache.set(key, value);
        return this;
    }

    /**
     * Mark a key as "definitely negative" (e.g., file doesn't exist).
     * Future lookups with isDefinitelyNegative will return true in O(1).
     */
    setNegative(key: K): this {
        const keyStr = this.keyToString(key);
        this.negativeFilter.add(keyStr);
        return this;
    }

    /**
     * Check if a key is definitely negative (not in the set).
     * Returns true if the key was previously marked as negative.
     *
     * Note: Due to BloomFilter characteristics:
     * - If returns true: Key MIGHT be negative (small chance of false positive)
     * - If returns false: Key is DEFINITELY not marked as negative
     */
    isDefinitelyNegative(key: K): boolean {
        const keyStr = this.keyToString(key);
        return this.negativeFilter.mightContain(keyStr);
    }

    /**
     * Check if a key might exist (not marked as negative).
     * This is the inverse of isDefinitelyNegative.
     */
    mightExist(key: K): boolean {
        return !this.isDefinitelyNegative(key);
    }

    /**
     * Check if a key exists in the positive cache.
     */
    has(key: K): boolean {
        return this.cache.has(key);
    }

    /**
     * Delete a key from both the cache and negative filter.
     * Only removes from BloomFilter if supportDeletion is enabled.
     */
    delete(key: K): boolean {
        const cacheDeleted = this.cache.delete(key);

        if (this.supportsDeletion) {
            const keyStr = this.keyToString(key);
            (this.negativeFilter as CountingBloomFilter).remove(keyStr);
        }

        return cacheDeleted;
    }

    /**
     * Clear both the cache and the BloomFilter.
     */
    clear(): void {
        this.cache.clear();
        this.negativeFilter.clear();
        this.bloomFilterSkips = 0;
        this.totalLookups = 0;
    }

    /**
     * Get the current size of the positive cache.
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * Get all keys from the positive cache.
     */
    keys(): K[] {
        return this.cache.keys();
    }

    /**
     * Get comprehensive statistics about the cache.
     */
    getStats(): BloomFilterCacheStats {
        const cacheStats = this.cache.getStats();

        return {
            cache: cacheStats,
            bloomFilter: {
                negativeCount: this.negativeFilter.count,
                fillRatio: this.negativeFilter.fillRatio,
                estimatedFPR: this.negativeFilter.estimatedFalsePositiveRate,
                memoryBytes: this.negativeFilter.memoryUsage
            },
            performance: {
                bloomFilterSkips: this.bloomFilterSkips,
                totalLookups: this.totalLookups,
                skipRate: this.totalLookups > 0
                    ? this.bloomFilterSkips / this.totalLookups
                    : 0
            }
        };
    }

    /**
     * Reset performance statistics.
     */
    resetStats(): void {
        this.cache.resetStats();
        this.bloomFilterSkips = 0;
        this.totalLookups = 0;
    }
}

/**
 * Pre-configured cache optimized for string keys.
 * Useful for file paths, symbol names, URLs, etc.
 */
export class StringBloomFilterCache<V> extends BloomFilterCache<string, V> {
    constructor(options: Omit<BloomFilterCacheOptions<string, V>, 'keyToString'> = {}) {
        super({
            ...options,
            keyToString: (k) => k
        });
    }
}

/**
 * Pre-configured cache optimized for async operations.
 * Includes deduplication of in-flight requests.
 */
export class AsyncBloomFilterCache<K, V> {
    private cache: BloomFilterCache<K, V>;
    private pending: Map<string, Promise<V | null>> = new Map();
    private keyToString: (key: K) => string;

    constructor(options: BloomFilterCacheOptions<K, V> = {}) {
        this.keyToString = options.keyToString || ((k: K) => String(k));
        this.cache = new BloomFilterCache<K, V>(options);
    }

    /**
     * Get a value, computing it if not cached.
     * Deduplicates concurrent requests for the same key.
     *
     * @param key - The cache key
     * @param compute - Async function to compute the value if not cached
     * @returns The cached or computed value, or null if marked as negative
     */
    async get(key: K, compute: (key: K) => Promise<V | null>): Promise<V | null> {
        // Check cache first
        const cached = this.cache.get(key);
        if (cached !== undefined) {
            return cached;
        }

        // Check if definitely negative
        if (this.cache.isDefinitelyNegative(key)) {
            return null;
        }

        // Check for pending request
        const keyStr = this.keyToString(key);
        const pendingPromise = this.pending.get(keyStr);
        if (pendingPromise) {
            return pendingPromise;
        }

        // Compute the value
        const computePromise = compute(key)
            .then(value => {
                this.pending.delete(keyStr);

                if (value !== null) {
                    this.cache.set(key, value);
                } else {
                    this.cache.setNegative(key);
                }

                return value;
            })
            .catch(() => {
                this.pending.delete(keyStr);
                this.cache.setNegative(key);
                return null;
            });

        this.pending.set(keyStr, computePromise);
        return computePromise;
    }

    /**
     * Invalidate a cached key.
     */
    invalidate(key: K): void {
        this.cache.delete(key);
        const keyStr = this.keyToString(key);
        this.pending.delete(keyStr);
    }

    /**
     * Clear all cached entries.
     */
    clear(): void {
        this.cache.clear();
        this.pending.clear();
    }

    /**
     * Get cache statistics.
     */
    getStats(): BloomFilterCacheStats & { pendingRequests: number } {
        return {
            ...this.cache.getStats(),
            pendingRequests: this.pending.size
        };
    }
}

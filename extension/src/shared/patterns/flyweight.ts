/**
 * Flyweight Pattern Implementation
 *
 * Provides string interning and object pooling to reduce memory usage
 * when dealing with many similar objects (like symbols with repeated names).
 */

import * as vscode from 'vscode';
import { IndexedSymbol } from '../indexes/symbolIndex';

/**
 * Options for StringPool
 */
export interface StringPoolOptions {
    /** Maximum number of unique strings to intern. Default: 100000 */
    maxSize?: number;
}

/**
 * String Pool (String Interning)
 *
 * Ensures that identical strings share the same memory reference,
 * reducing memory usage when many objects contain the same string values.
 *
 * Expected memory savings: 30-50% for string-heavy data
 */
export class StringPool {
    private pool: Map<string, string> = new Map();
    private readonly maxSize: number;
    private stats = {
        totalRequests: 0,
        uniqueStrings: 0,
        savedBytes: 0,
        skippedDueToLimit: 0
    };

    constructor(options: StringPoolOptions = {}) {
        this.maxSize = options.maxSize ?? 100000;
    }

    /**
     * Intern a string - returns the pooled version if it exists
     * @param str - String to intern
     * @returns The interned string (same reference for identical strings)
     */
    intern(str: string): string {
        if (!str) {
            return str;
        }

        this.stats.totalRequests++;

        const existing = this.pool.get(str);
        if (existing !== undefined) {
            // String already in pool, track savings (only count on reuse)
            this.stats.savedBytes += str.length * 2; // UTF-16 = 2 bytes per char
            return existing;
        }

        // Check if pool is at capacity
        if (this.pool.size >= this.maxSize) {
            this.stats.skippedDueToLimit++;
            return str; // Return as-is without interning
        }

        // Add new string to pool
        this.pool.set(str, str);
        this.stats.uniqueStrings++;
        return str;
    }

    /**
     * Intern multiple strings at once
     */
    internAll(strings: string[]): string[] {
        return strings.map(s => this.intern(s));
    }

    /**
     * Check if a string is already interned
     */
    isInterned(str: string): boolean {
        return this.pool.has(str);
    }

    /**
     * Get the number of unique strings in the pool
     */
    get size(): number {
        return this.pool.size;
    }

    /**
     * Get pool statistics
     */
    getStats(): {
        totalRequests: number;
        uniqueStrings: number;
        savedBytes: number;
        estimatedSavedMB: number;
        skippedDueToLimit: number;
        poolSize: number;
        maxSize: number;
    } {
        return {
            ...this.stats,
            estimatedSavedMB: this.stats.savedBytes / (1024 * 1024),
            poolSize: this.pool.size,
            maxSize: this.maxSize
        };
    }

    /**
     * Clear the pool (use with caution - invalidates all interned references)
     */
    clear(): void {
        this.pool.clear();
        this.stats = {
            totalRequests: 0,
            uniqueStrings: 0,
            savedBytes: 0,
            skippedDueToLimit: 0
        };
    }

    /**
     * Remove unused strings from the pool (requires reference tracking)
     * Note: This is a no-op without external reference counting
     */
    prune(): void {
        // In a full implementation, this would remove strings with zero references
        // For now, we rely on the pool growing and GC handling orphaned strings
    }
}

/**
 * Location Pool
 *
 * Pools vscode.Location objects that share the same URI,
 * reducing memory for files with many symbols.
 */
export class LocationPool {
    private uriPool: Map<string, vscode.Uri> = new Map();

    /**
     * Get or create a pooled URI
     */
    internUri(uri: vscode.Uri): vscode.Uri {
        const key = uri.toString();
        const existing = this.uriPool.get(key);
        if (existing) {
            return existing;
        }
        this.uriPool.set(key, uri);
        return uri;
    }

    /**
     * Create a location with a pooled URI
     */
    createLocation(uri: vscode.Uri, range: vscode.Range): vscode.Location {
        return new vscode.Location(this.internUri(uri), range);
    }

    /**
     * Get the number of unique URIs in the pool
     */
    get size(): number {
        return this.uriPool.size;
    }

    /**
     * Clear the pool
     */
    clear(): void {
        this.uriPool.clear();
    }
}

/**
 * Symbol Factory with Flyweight Pattern
 *
 * Creates optimized symbol objects that share common string data.
 */
export class OptimizedSymbolFactory {
    private stringPool: StringPool;
    private locationPool: LocationPool;
    private symbolCount: number = 0;

    constructor(stringPool?: StringPool, locationPool?: LocationPool) {
        this.stringPool = stringPool || new StringPool();
        this.locationPool = locationPool || new LocationPool();
    }

    /**
     * Create an optimized symbol with interned strings
     */
    createSymbol(data: {
        name: string;
        kind: vscode.SymbolKind;
        location: vscode.Location;
        containerName?: string;
        detail?: string;
        fullyQualifiedName?: string;
    }): IndexedSymbol {
        this.symbolCount++;

        return {
            name: this.stringPool.intern(data.name),
            kind: data.kind,
            location: this.locationPool.createLocation(
                data.location.uri,
                data.location.range
            ),
            containerName: data.containerName
                ? this.stringPool.intern(data.containerName)
                : undefined,
            detail: data.detail
                ? this.stringPool.intern(data.detail)
                : undefined,
            fullyQualifiedName: data.fullyQualifiedName
                ? this.stringPool.intern(data.fullyQualifiedName)
                : undefined
        };
    }

    /**
     * Create multiple optimized symbols
     */
    createSymbols(dataArray: Array<{
        name: string;
        kind: vscode.SymbolKind;
        location: vscode.Location;
        containerName?: string;
        detail?: string;
        fullyQualifiedName?: string;
    }>): IndexedSymbol[] {
        return dataArray.map(data => this.createSymbol(data));
    }

    /**
     * Get factory statistics
     */
    getStats(): {
        symbolsCreated: number;
        stringPool: ReturnType<StringPool['getStats']>;
        uniqueUris: number;
    } {
        return {
            symbolsCreated: this.symbolCount,
            stringPool: this.stringPool.getStats(),
            uniqueUris: this.locationPool.size
        };
    }

    /**
     * Clear all pools
     */
    clear(): void {
        this.stringPool.clear();
        this.locationPool.clear();
        this.symbolCount = 0;
    }
}

/**
 * Generic Object Pool
 *
 * Reuses objects instead of creating new ones, reducing GC pressure.
 */
export class ObjectPool<T> {
    private pool: T[] = [];
    private factory: () => T;
    private reset?: (obj: T) => void;
    private maxSize: number;

    private stats = {
        created: 0,
        reused: 0,
        returned: 0
    };

    constructor(
        factory: () => T,
        options: {
            reset?: (obj: T) => void;
            maxSize?: number;
            initialSize?: number;
        } = {}
    ) {
        this.factory = factory;
        this.reset = options.reset;
        this.maxSize = options.maxSize ?? 1000;

        // Pre-populate pool
        const initialSize = options.initialSize ?? 0;
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(factory());
            this.stats.created++;
        }
    }

    /**
     * Acquire an object from the pool
     */
    acquire(): T {
        if (this.pool.length > 0) {
            this.stats.reused++;
            return this.pool.pop()!;
        }

        this.stats.created++;
        return this.factory();
    }

    /**
     * Return an object to the pool
     */
    release(obj: T): void {
        if (this.pool.length >= this.maxSize) {
            // Pool is full, let GC handle it
            return;
        }

        if (this.reset) {
            this.reset(obj);
        }

        this.pool.push(obj);
        this.stats.returned++;
    }

    /**
     * Get pool statistics
     */
    getStats(): {
        poolSize: number;
        created: number;
        reused: number;
        returned: number;
        reuseRate: number;
    } {
        const total = this.stats.created + this.stats.reused;
        return {
            poolSize: this.pool.length,
            ...this.stats,
            reuseRate: total > 0 ? this.stats.reused / total : 0
        };
    }

    /**
     * Clear the pool
     */
    clear(): void {
        this.pool = [];
    }

    /**
     * Resize the pool
     */
    resize(newMaxSize: number): void {
        this.maxSize = newMaxSize;
        while (this.pool.length > newMaxSize) {
            this.pool.pop();
        }
    }
}

/**
 * Array Pool for reusing arrays
 *
 * Useful when creating many temporary arrays during search/filter operations.
 */
export class ArrayPool<T> {
    private pools: Map<number, T[][]> = new Map();
    private maxArraySize: number;
    private maxPoolSize: number;

    constructor(maxArraySize: number = 1000, maxPoolSize: number = 100) {
        this.maxArraySize = maxArraySize;
        this.maxPoolSize = maxPoolSize;
    }

    /**
     * Acquire an array with the given capacity
     */
    acquire(capacity: number = 10): T[] {
        // Round up to nearest power of 2 for better pooling
        const size = Math.min(this.nextPowerOf2(capacity), this.maxArraySize);

        const pool = this.pools.get(size);
        if (pool && pool.length > 0) {
            return pool.pop()!;
        }

        return new Array<T>(size);
    }

    /**
     * Return an array to the pool
     */
    release(arr: T[]): void {
        const size = this.nextPowerOf2(arr.length);
        if (size > this.maxArraySize) {
            return;
        }

        let pool = this.pools.get(size);
        if (!pool) {
            pool = [];
            this.pools.set(size, pool);
        }

        if (pool.length < this.maxPoolSize) {
            arr.length = 0; // Clear the array
            pool.push(arr);
        }
    }

    /**
     * Clear all pools
     */
    clear(): void {
        this.pools.clear();
    }

    private nextPowerOf2(n: number): number {
        // Handle edge case: 0 or negative numbers
        if (n <= 0) {
            return 1;
        }
        n--;
        n |= n >> 1;
        n |= n >> 2;
        n |= n >> 4;
        n |= n >> 8;
        n |= n >> 16;
        return n + 1;
    }
}

// Global instances for shared use
let globalStringPool: StringPool | undefined;
let globalSymbolFactory: OptimizedSymbolFactory | undefined;

/**
 * Get the global string pool instance
 */
export function getGlobalStringPool(): StringPool {
    if (!globalStringPool) {
        globalStringPool = new StringPool();
    }
    return globalStringPool;
}

/**
 * Get the global symbol factory instance
 */
export function getGlobalSymbolFactory(): OptimizedSymbolFactory {
    if (!globalSymbolFactory) {
        globalSymbolFactory = new OptimizedSymbolFactory(getGlobalStringPool());
    }
    return globalSymbolFactory;
}

/**
 * Reset all global pools (useful for testing or memory cleanup)
 */
export function resetGlobalPools(): void {
    globalStringPool?.clear();
    globalSymbolFactory?.clear();
}

/**
 * Dispose all global pools and release references (for extension deactivation)
 */
export function disposeGlobalPools(): void {
    globalStringPool?.clear();
    globalStringPool = undefined;
    globalSymbolFactory?.clear();
    globalSymbolFactory = undefined;
}

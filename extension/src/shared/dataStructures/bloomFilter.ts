/**
 * Bloom Filter implementation for fast probabilistic set membership tests
 *
 * A space-efficient probabilistic data structure that is used to test whether
 * an element is a member of a set. False positive matches are possible, but
 * false negatives are not – meaning a query returns either "possibly in set"
 * or "definitely not in set".
 *
 * Performance: O(k) where k = number of hash functions (constant time)
 * Space: O(m) where m = bit array size (typically ~10 bits per element for 1% FPR)
 */

export interface BloomFilterOptions {
    expectedElements: number;
    falsePositiveRate?: number; // Default: 0.01 (1%)
}

export class BloomFilter {
    private bitArray: Uint8Array;
    private size: number;
    private hashCount: number;
    private addedCount: number = 0;

    /**
     * Create a new Bloom filter
     * @param options Configuration options
     * @throws Error if expectedElements < 1 or falsePositiveRate not in (0, 1)
     */
    constructor(options: BloomFilterOptions) {
        const { expectedElements, falsePositiveRate = 0.01 } = options;

        // Input validation
        if (expectedElements < 1) {
            throw new Error('expectedElements must be at least 1');
        }
        if (falsePositiveRate <= 0 || falsePositiveRate >= 1) {
            throw new Error('falsePositiveRate must be between 0 and 1 (exclusive)');
        }

        // Calculate optimal size: m = -(n * ln(p)) / (ln(2)^2)
        this.size = Math.ceil(
            -(expectedElements * Math.log(falsePositiveRate)) / (Math.log(2) ** 2)
        );

        // Calculate optimal number of hash functions: k = (m/n) * ln(2)
        this.hashCount = Math.max(1, Math.ceil((this.size / expectedElements) * Math.log(2)));

        // Initialize bit array (using Uint8Array for efficiency)
        this.bitArray = new Uint8Array(Math.ceil(this.size / 8));
    }

    /**
     * Add an item to the filter
     * @param item - String item to add
     */
    add(item: string): this {
        if (item.length === 0) {
            // Empty strings may produce hash collisions; proceed but warn in debug
            // console.warn('BloomFilter: Adding empty string may cause collisions');
        }
        for (let i = 0; i < this.hashCount; i++) {
            const hash = this.hash(item, i);
            const byteIndex = Math.floor(hash / 8);
            const bitIndex = hash % 8;
            this.bitArray[byteIndex] |= (1 << bitIndex);
        }
        this.addedCount++;
        return this;
    }

    /**
     * Add multiple items to the filter
     * @param items - Array of string items to add
     */
    addAll(items: string[]): this {
        for (const item of items) {
            this.add(item);
        }
        return this;
    }

    /**
     * Check if an item might be in the set
     * @param item - String item to check
     * @returns true if the item MIGHT be in the set, false if DEFINITELY NOT
     */
    mightContain(item: string): boolean {
        for (let i = 0; i < this.hashCount; i++) {
            const hash = this.hash(item, i);
            const byteIndex = Math.floor(hash / 8);
            const bitIndex = hash % 8;
            if ((this.bitArray[byteIndex] & (1 << bitIndex)) === 0) {
                return false; // Definitely not in set
            }
        }
        return true; // Might be in set
    }

    /**
     * Clear the filter
     */
    clear(): void {
        this.bitArray.fill(0);
        this.addedCount = 0;
    }

    /**
     * Get the number of items added (note: not guaranteed unique)
     */
    get count(): number {
        return this.addedCount;
    }

    /**
     * Get the size of the bit array in bits
     */
    get bitSize(): number {
        return this.size;
    }

    /**
     * Get the number of hash functions used
     */
    get hashFunctions(): number {
        return this.hashCount;
    }

    /**
     * Get the approximate memory usage in bytes
     */
    get memoryUsage(): number {
        return this.bitArray.length;
    }

    /**
     * Get the current fill ratio (percentage of bits set to 1)
     */
    get fillRatio(): number {
        let setBits = 0;
        for (let i = 0; i < this.bitArray.length; i++) {
            let byte = this.bitArray[i];
            while (byte) {
                setBits += byte & 1;
                byte >>= 1;
            }
        }
        return setBits / this.size;
    }

    /**
     * Estimate the current false positive rate based on fill ratio
     */
    get estimatedFalsePositiveRate(): number {
        const fillRatio = this.fillRatio;
        return Math.pow(fillRatio, this.hashCount);
    }

    /**
     * Merge another bloom filter into this one (OR operation)
     * Note: Filters must have the same size and hash count
     */
    merge(other: BloomFilter): this {
        if (this.size !== other.size || this.hashCount !== other.hashCount) {
            throw new Error('Cannot merge bloom filters with different parameters');
        }

        for (let i = 0; i < this.bitArray.length; i++) {
            this.bitArray[i] |= other.bitArray[i];
        }
        this.addedCount += other.addedCount;

        return this;
    }

    /**
     * Create a copy of this bloom filter
     */
    clone(): BloomFilter {
        const clone = new BloomFilter({
            expectedElements: 1, // Will be overwritten
            falsePositiveRate: 0.01
        });
        clone.bitArray = new Uint8Array(this.bitArray);
        (clone as any).size = this.size;
        (clone as any).hashCount = this.hashCount;
        clone.addedCount = this.addedCount;
        return clone;
    }

    /**
     * Serialize the bloom filter to a JSON-compatible object
     */
    serialize(): { bitArray: number[]; size: number; hashCount: number; addedCount: number } {
        return {
            bitArray: Array.from(this.bitArray),
            size: this.size,
            hashCount: this.hashCount,
            addedCount: this.addedCount
        };
    }

    /**
     * Create a bloom filter from serialized data
     */
    static deserialize(data: { bitArray: number[]; size: number; hashCount: number; addedCount: number }): BloomFilter {
        const filter = new BloomFilter({
            expectedElements: 1, // Will be overwritten
            falsePositiveRate: 0.01
        });
        filter.bitArray = new Uint8Array(data.bitArray);
        (filter as any).size = data.size;
        (filter as any).hashCount = data.hashCount;
        filter.addedCount = data.addedCount;
        return filter;
    }

    /**
     * Hash function using double hashing technique
     * h(i, item) = h1(item) + i * h2(item)
     */
    private hash(item: string, seed: number): number {
        const h1 = this.fnv1a(item);
        const h2 = this.murmurHash3(item);
        return Math.abs((h1 + seed * h2) % this.size);
    }

    /**
     * FNV-1a hash function
     */
    private fnv1a(str: string): number {
        let hash = 2166136261; // FNV offset basis
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 16777619); // FNV prime
        }
        return hash >>> 0; // Convert to unsigned
    }

    /**
     * MurmurHash3 (32-bit) hash function
     */
    private murmurHash3(str: string, seed: number = 0): number {
        let h1 = seed;
        const c1 = 0xcc9e2d51;
        const c2 = 0x1b873593;

        for (let i = 0; i < str.length; i++) {
            let k1 = str.charCodeAt(i);
            k1 = Math.imul(k1, c1);
            k1 = (k1 << 15) | (k1 >>> 17);
            k1 = Math.imul(k1, c2);

            h1 ^= k1;
            h1 = (h1 << 13) | (h1 >>> 19);
            h1 = Math.imul(h1, 5) + 0xe6546b64;
        }

        h1 ^= str.length;
        h1 ^= h1 >>> 16;
        h1 = Math.imul(h1, 0x85ebca6b);
        h1 ^= h1 >>> 13;
        h1 = Math.imul(h1, 0xc2b2ae35);
        h1 ^= h1 >>> 16;

        return h1 >>> 0;
    }
}

/**
 * Counting Bloom Filter - supports deletion
 *
 * Uses counters instead of single bits, allowing for removal of elements.
 * Trade-off: Uses more memory (4 bits per counter = 4x more than standard bloom filter)
 */
export class CountingBloomFilter {
    private counters: Uint8Array;
    private size: number;
    private hashCount: number;
    private addedCount: number = 0;
    private maxCount: number = 15; // 4 bits per counter

    /**
     * Create a new Counting Bloom filter
     * @param options Configuration options
     * @throws Error if expectedElements < 1 or falsePositiveRate not in (0, 1)
     */
    constructor(options: BloomFilterOptions) {
        const { expectedElements, falsePositiveRate = 0.01 } = options;

        // Input validation (same as BloomFilter)
        if (expectedElements < 1) {
            throw new Error('expectedElements must be at least 1');
        }
        if (falsePositiveRate <= 0 || falsePositiveRate >= 1) {
            throw new Error('falsePositiveRate must be between 0 and 1 (exclusive)');
        }

        this.size = Math.ceil(
            -(expectedElements * Math.log(falsePositiveRate)) / (Math.log(2) ** 2)
        );
        this.hashCount = Math.max(1, Math.ceil((this.size / expectedElements) * Math.log(2)));

        // Each counter uses 4 bits, so we pack 2 counters per byte
        this.counters = new Uint8Array(Math.ceil(this.size / 2));
    }

    /**
     * Add an item to the filter
     */
    add(item: string): this {
        for (let i = 0; i < this.hashCount; i++) {
            const hash = this.hash(item, i);
            this.incrementCounter(hash);
        }
        this.addedCount++;
        return this;
    }

    /**
     * Remove an item from the filter
     * Note: Should only remove items that were previously added
     */
    remove(item: string): this {
        if (!this.mightContain(item)) {
            return this;
        }

        for (let i = 0; i < this.hashCount; i++) {
            const hash = this.hash(item, i);
            this.decrementCounter(hash);
        }
        this.addedCount = Math.max(0, this.addedCount - 1);
        return this;
    }

    /**
     * Check if an item might be in the set
     */
    mightContain(item: string): boolean {
        for (let i = 0; i < this.hashCount; i++) {
            const hash = this.hash(item, i);
            if (this.getCounter(hash) === 0) {
                return false;
            }
        }
        return true;
    }

    /**
     * Clear the filter
     */
    clear(): void {
        this.counters.fill(0);
        this.addedCount = 0;
    }

    get count(): number {
        return this.addedCount;
    }

    get memoryUsage(): number {
        return this.counters.length;
    }

    get fillRatio(): number {
        let occupied = 0;
        for (let i = 0; i < this.size; i++) {
            if (this.getCounter(i) > 0) {
                occupied++;
            }
        }
        return occupied / this.size;
    }

    get estimatedFalsePositiveRate(): number {
        return Math.pow(this.fillRatio, this.hashCount);
    }

    private getCounter(index: number): number {
        const byteIndex = Math.floor(index / 2);
        const isHighNibble = index % 2 === 1;
        const byte = this.counters[byteIndex];
        return isHighNibble ? (byte >> 4) & 0x0f : byte & 0x0f;
    }

    private setCounter(index: number, value: number): void {
        const byteIndex = Math.floor(index / 2);
        const isHighNibble = index % 2 === 1;
        const clampedValue = Math.min(this.maxCount, Math.max(0, value));

        if (isHighNibble) {
            this.counters[byteIndex] = (this.counters[byteIndex] & 0x0f) | (clampedValue << 4);
        } else {
            this.counters[byteIndex] = (this.counters[byteIndex] & 0xf0) | clampedValue;
        }
    }

    private incrementCounter(index: number): void {
        const current = this.getCounter(index);
        if (current < this.maxCount) {
            this.setCounter(index, current + 1);
        }
    }

    private decrementCounter(index: number): void {
        const current = this.getCounter(index);
        if (current > 0) {
            this.setCounter(index, current - 1);
        }
    }

    private hash(item: string, seed: number): number {
        let hash = seed;
        for (let i = 0; i < item.length; i++) {
            hash = ((hash << 5) - hash) + item.charCodeAt(i);
            hash = hash & hash;
        }
        return Math.abs(hash) % this.size;
    }
}

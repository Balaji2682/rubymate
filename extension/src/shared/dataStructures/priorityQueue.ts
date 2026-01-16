/**
 * Priority Queue Implementation
 *
 * A min-heap based priority queue for efficient priority-based ordering.
 * Useful for ranking search results by relevance score.
 *
 * Time Complexity:
 * - enqueue: O(log n)
 * - dequeue: O(log n)
 * - peek: O(1)
 */

/**
 * Options for configuring the priority queue
 */
export interface PriorityQueueOptions<T> {
    /** Custom comparator function. Returns negative if a < b, positive if a > b, 0 if equal.
     * Default: numeric comparison for numbers, or compares items with < operator */
    comparator?: (a: T, b: T) => number;

    /** Maximum number of items to keep. Excess items are automatically dequeued.
     * Default: unlimited */
    maxSize?: number;
}

/**
 * Priority Queue using a binary min-heap
 *
 * @example
 * ```typescript
 * const pq = new PriorityQueue<number>();
 * pq.enqueue(5);
 * pq.enqueue(2);
 * pq.enqueue(8);
 * pq.dequeue(); // 2
 * pq.dequeue(); // 5
 * ```
 */
export class PriorityQueue<T> {
    private heap: T[] = [];
    private readonly comparator: (a: T, b: T) => number;
    private readonly maxSize: number;

    constructor(options: PriorityQueueOptions<T> = {}) {
        this.comparator = options.comparator ?? ((a, b) => {
            if (a < b) return -1;
            if (a > b) return 1;
            return 0;
        });
        this.maxSize = options.maxSize ?? Number.MAX_SAFE_INTEGER;

        if (this.maxSize < 1) {
            throw new Error('maxSize must be at least 1');
        }
    }

    /**
     * Add an item to the queue
     * @param item - The item to add
     */
    enqueue(item: T): void {
        this.heap.push(item);
        this.bubbleUp(this.heap.length - 1);

        // Enforce max size by removing lowest priority items
        while (this.heap.length > this.maxSize) {
            // Remove the last item (lowest priority in a max-heap, highest in min-heap)
            // For a min-heap, we need to find and remove the max
            this.removeMax();
        }
    }

    /**
     * Remove and return the highest priority item (smallest by default)
     * @returns The highest priority item, or undefined if empty
     */
    dequeue(): T | undefined {
        if (this.heap.length === 0) {
            return undefined;
        }

        if (this.heap.length === 1) {
            return this.heap.pop();
        }

        const result = this.heap[0];
        this.heap[0] = this.heap.pop()!;
        this.bubbleDown(0);
        return result;
    }

    /**
     * Return the highest priority item without removing it
     * @returns The highest priority item, or undefined if empty
     */
    peek(): T | undefined {
        return this.heap[0];
    }

    /**
     * Get the number of items in the queue
     */
    get size(): number {
        return this.heap.length;
    }

    /**
     * Check if the queue is empty
     */
    isEmpty(): boolean {
        return this.heap.length === 0;
    }

    /**
     * Remove all items from the queue
     */
    clear(): void {
        this.heap = [];
    }

    /**
     * Convert the queue to a sorted array (does not modify the queue)
     * @returns Array of items in priority order
     */
    toArray(): T[] {
        // Create a copy and sort it
        const copy = [...this.heap];
        return copy.sort(this.comparator);
    }

    /**
     * Iterate over items in the queue (not in priority order)
     */
    forEach(callback: (item: T, index: number) => void): void {
        this.heap.forEach(callback);
    }

    /**
     * Check if an item exists in the queue
     */
    contains(item: T, equals?: (a: T, b: T) => boolean): boolean {
        const eq = equals ?? ((a, b) => a === b);
        return this.heap.some(i => eq(i, item));
    }

    private bubbleUp(index: number): void {
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            if (this.comparator(this.heap[index], this.heap[parentIndex]) >= 0) {
                break;
            }
            this.swap(index, parentIndex);
            index = parentIndex;
        }
    }

    private bubbleDown(index: number): void {
        const length = this.heap.length;

        while (true) {
            const leftChild = 2 * index + 1;
            const rightChild = 2 * index + 2;
            let smallest = index;

            if (leftChild < length &&
                this.comparator(this.heap[leftChild], this.heap[smallest]) < 0) {
                smallest = leftChild;
            }

            if (rightChild < length &&
                this.comparator(this.heap[rightChild], this.heap[smallest]) < 0) {
                smallest = rightChild;
            }

            if (smallest === index) {
                break;
            }

            this.swap(index, smallest);
            index = smallest;
        }
    }

    private swap(i: number, j: number): void {
        const temp = this.heap[i];
        this.heap[i] = this.heap[j];
        this.heap[j] = temp;
    }

    /**
     * Remove the maximum element (for enforcing maxSize in min-heap)
     */
    private removeMax(): void {
        if (this.heap.length <= 1) {
            this.heap.pop();
            return;
        }

        // Find the maximum element (must be in the leaves for a min-heap)
        const startLeaf = Math.floor(this.heap.length / 2);
        let maxIndex = startLeaf;

        for (let i = startLeaf + 1; i < this.heap.length; i++) {
            if (this.comparator(this.heap[i], this.heap[maxIndex]) > 0) {
                maxIndex = i;
            }
        }

        // Remove by replacing with last element
        if (maxIndex === this.heap.length - 1) {
            this.heap.pop();
        } else {
            this.heap[maxIndex] = this.heap.pop()!;
            // May need to bubble up if new element is smaller than parent
            this.bubbleUp(maxIndex);
        }
    }
}

/**
 * Item with an associated score for search result ranking
 */
export interface ScoredItem<T> {
    item: T;
    score: number;
}

/**
 * Priority Queue specialized for scored search results
 *
 * Uses a max-heap to keep highest scores at the top.
 *
 * @example
 * ```typescript
 * const pq = new ScoredPriorityQueue<string>();
 * pq.addWithScore('result1', 0.95);
 * pq.addWithScore('result2', 0.87);
 * pq.addWithScore('result3', 0.92);
 * pq.getTopN(2); // ['result1', 'result3']
 * ```
 */
export class ScoredPriorityQueue<T> {
    private queue: PriorityQueue<ScoredItem<T>>;
    private readonly maxSize: number;

    constructor(options: { maxSize?: number } = {}) {
        this.maxSize = options.maxSize ?? Number.MAX_SAFE_INTEGER;

        if (this.maxSize < 1) {
            throw new Error('maxSize must be at least 1');
        }

        // Max-heap: higher scores come first
        this.queue = new PriorityQueue<ScoredItem<T>>({
            comparator: (a, b) => b.score - a.score,
            maxSize: this.maxSize
        });
    }

    /**
     * Add an item with its relevance score
     * @param item - The item to add
     * @param score - The relevance score (higher = more relevant)
     */
    addWithScore(item: T, score: number): void {
        if (typeof score !== 'number' || isNaN(score)) {
            throw new Error('Score must be a valid number');
        }
        this.queue.enqueue({ item, score });
    }

    /**
     * Get the top N items by score
     * @param n - Number of items to return
     * @returns Array of items in score order (highest first)
     */
    getTopN(n: number): T[] {
        if (n < 0) {
            throw new Error('n must be non-negative');
        }

        const results: T[] = [];
        const items: ScoredItem<T>[] = [];

        // Dequeue up to n items
        const count = Math.min(n, this.queue.size);
        for (let i = 0; i < count; i++) {
            const scored = this.queue.dequeue();
            if (scored) {
                results.push(scored.item);
                items.push(scored);
            }
        }

        // Re-enqueue the items
        for (const item of items) {
            this.queue.enqueue(item);
        }

        return results;
    }

    /**
     * Get all items sorted by score
     * @returns Array of items in score order (highest first)
     */
    getAll(): T[] {
        return this.queue.toArray().map(scored => scored.item);
    }

    /**
     * Get all scored items sorted by score
     * @returns Array of ScoredItem in score order (highest first)
     */
    getAllWithScores(): ScoredItem<T>[] {
        return this.queue.toArray();
    }

    /**
     * Remove and return the highest scored item
     */
    pop(): T | undefined {
        const scored = this.queue.dequeue();
        return scored?.item;
    }

    /**
     * Peek at the highest scored item without removing it
     */
    peek(): T | undefined {
        const scored = this.queue.peek();
        return scored?.item;
    }

    /**
     * Peek at the highest scored item with its score
     */
    peekWithScore(): ScoredItem<T> | undefined {
        return this.queue.peek();
    }

    /**
     * Get the number of items
     */
    get size(): number {
        return this.queue.size;
    }

    /**
     * Check if empty
     */
    isEmpty(): boolean {
        return this.queue.isEmpty();
    }

    /**
     * Remove all items
     */
    clear(): void {
        this.queue.clear();
    }
}

/**
 * Create a priority queue with a max-heap configuration (highest values first)
 */
export function createMaxPriorityQueue<T>(options: Omit<PriorityQueueOptions<T>, 'comparator'> & {
    comparator?: (a: T, b: T) => number;
} = {}): PriorityQueue<T> {
    const baseComparator = options.comparator ?? ((a, b) => {
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
    });

    return new PriorityQueue<T>({
        ...options,
        comparator: (a, b) => -baseComparator(a, b) // Invert for max-heap
    });
}

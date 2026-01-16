/**
 * Interval Tree for Range-Based Lookups
 *
 * Fast lookup of symbols by line/column ranges.
 * Used for finding "which symbol contains position X:Y?"
 */

/**
 * Represents a 1D interval
 */
export interface Interval {
    start: number;
    end: number;
}

/**
 * Represents a 2D position (line and column)
 */
export interface Position {
    line: number;
    column: number;
}

/**
 * Represents a 2D range (start and end positions)
 */
export interface Range {
    start: Position;
    end: Position;
}

/**
 * Options for interval tree configuration
 */
export interface IntervalTreeOptions {
    /** Allow overlapping intervals. Default: true */
    allowOverlap?: boolean;
}

/**
 * Internal node for the interval tree
 */
interface IntervalNode<T> {
    interval: Interval;
    data: T;
    max: number;
    left?: IntervalNode<T>;
    right?: IntervalNode<T>;
    height: number;
}

/**
 * Interval Tree using an augmented AVL tree for O(log n) operations
 *
 * @typeParam T - Type of data stored with each interval
 *
 * @example
 * ```typescript
 * const tree = new IntervalTree<string>();
 * tree.insert({ start: 10, end: 20 }, 'function foo');
 * tree.insert({ start: 15, end: 25 }, 'variable bar');
 *
 * const results = tree.search(17); // Returns ['function foo', 'variable bar']
 * ```
 */
export class IntervalTree<T> {
    private root?: IntervalNode<T>;
    private nodeCount: number = 0;
    private readonly allowOverlap: boolean;

    constructor(options: IntervalTreeOptions = {}) {
        this.allowOverlap = options.allowOverlap ?? true;
    }

    /**
     * Insert an interval with associated data
     */
    insert(interval: Interval, data: T): void {
        if (interval.start > interval.end) {
            throw new Error('Invalid interval: start must be <= end');
        }

        if (!this.allowOverlap && this.hasOverlap(interval)) {
            throw new Error('Overlapping intervals not allowed');
        }

        this.root = this.insertNode(this.root, interval, data);
        this.nodeCount++;
    }

    /**
     * Remove an interval (first match)
     */
    remove(interval: Interval): boolean {
        const initialCount = this.nodeCount;
        this.root = this.removeNode(this.root, interval);
        return this.nodeCount < initialCount;
    }

    /**
     * Find all intervals containing a point
     */
    search(point: number): T[] {
        const results: T[] = [];
        this.searchNode(this.root, point, results);
        return results;
    }

    /**
     * Find all intervals overlapping with a range
     */
    searchRange(start: number, end: number): T[] {
        const results: T[] = [];
        this.searchRangeNode(this.root, start, end, results);
        return results;
    }

    /**
     * Find exact interval match
     */
    searchExact(interval: Interval): T | undefined {
        return this.searchExactNode(this.root, interval);
    }

    /**
     * Check if any interval overlaps with the given interval
     */
    hasOverlap(interval: Interval): boolean {
        return this.searchRange(interval.start, interval.end).length > 0;
    }

    /**
     * Get all intervals and their data
     */
    getAll(): Array<{ interval: Interval; data: T }> {
        const results: Array<{ interval: Interval; data: T }> = [];
        this.collectAll(this.root, results);
        return results;
    }

    /**
     * Number of intervals in the tree
     */
    get size(): number {
        return this.nodeCount;
    }

    /**
     * Check if tree is empty
     */
    isEmpty(): boolean {
        return this.nodeCount === 0;
    }

    /**
     * Clear all intervals
     */
    clear(): void {
        this.root = undefined;
        this.nodeCount = 0;
    }

    /**
     * Iterate over all intervals
     */
    forEach(callback: (interval: Interval, data: T) => void): void {
        this.forEachNode(this.root, callback);
    }

    // Private helper methods

    private insertNode(
        node: IntervalNode<T> | undefined,
        interval: Interval,
        data: T
    ): IntervalNode<T> {
        if (!node) {
            return {
                interval,
                data,
                max: interval.end,
                height: 1
            };
        }

        if (interval.start < node.interval.start) {
            node.left = this.insertNode(node.left, interval, data);
        } else {
            node.right = this.insertNode(node.right, interval, data);
        }

        // Update max value
        node.max = Math.max(
            node.interval.end,
            node.left?.max ?? 0,
            node.right?.max ?? 0
        );

        // Update height
        node.height = 1 + Math.max(
            this.getHeight(node.left),
            this.getHeight(node.right)
        );

        // Balance the tree
        return this.balance(node);
    }

    private removeNode(
        node: IntervalNode<T> | undefined,
        interval: Interval
    ): IntervalNode<T> | undefined {
        if (!node) {
            return undefined;
        }

        if (interval.start < node.interval.start) {
            node.left = this.removeNode(node.left, interval);
        } else if (interval.start > node.interval.start) {
            node.right = this.removeNode(node.right, interval);
        } else if (
            interval.start === node.interval.start &&
            interval.end === node.interval.end
        ) {
            // Found the node to remove
            this.nodeCount--;

            if (!node.left) {
                return node.right;
            }
            if (!node.right) {
                return node.left;
            }

            // Find the minimum in the right subtree
            const minNode = this.findMin(node.right);
            node.interval = minNode.interval;
            node.data = minNode.data;
            node.right = this.removeNode(node.right, minNode.interval);
        } else {
            // Same start but different end, check both subtrees
            node.left = this.removeNode(node.left, interval);
            node.right = this.removeNode(node.right, interval);
        }

        // Update max and height
        node.max = Math.max(
            node.interval.end,
            node.left?.max ?? 0,
            node.right?.max ?? 0
        );
        node.height = 1 + Math.max(
            this.getHeight(node.left),
            this.getHeight(node.right)
        );

        return this.balance(node);
    }

    private findMin(node: IntervalNode<T>): IntervalNode<T> {
        while (node.left) {
            node = node.left;
        }
        return node;
    }

    private searchNode(
        node: IntervalNode<T> | undefined,
        point: number,
        results: T[]
    ): void {
        if (!node) {
            return;
        }

        // If point is beyond max of this subtree, no need to search
        if (point > node.max) {
            return;
        }

        // Search left subtree
        this.searchNode(node.left, point, results);

        // Check current node
        if (point >= node.interval.start && point <= node.interval.end) {
            results.push(node.data);
        }

        // Search right subtree if point could be there
        if (point >= node.interval.start) {
            this.searchNode(node.right, point, results);
        }
    }

    private searchRangeNode(
        node: IntervalNode<T> | undefined,
        start: number,
        end: number,
        results: T[]
    ): void {
        if (!node) {
            return;
        }

        // If range is beyond max of this subtree, no need to search
        if (start > node.max) {
            return;
        }

        // Search left subtree
        this.searchRangeNode(node.left, start, end, results);

        // Check current node for overlap
        if (this.intervalsOverlap(node.interval, { start, end })) {
            results.push(node.data);
        }

        // Search right subtree if range could overlap
        if (end >= node.interval.start) {
            this.searchRangeNode(node.right, start, end, results);
        }
    }

    private searchExactNode(
        node: IntervalNode<T> | undefined,
        interval: Interval
    ): T | undefined {
        if (!node) {
            return undefined;
        }

        if (
            interval.start === node.interval.start &&
            interval.end === node.interval.end
        ) {
            return node.data;
        }

        if (interval.start < node.interval.start) {
            return this.searchExactNode(node.left, interval);
        }

        return this.searchExactNode(node.right, interval);
    }

    private intervalsOverlap(a: Interval, b: Interval): boolean {
        return a.start <= b.end && b.start <= a.end;
    }

    private collectAll(
        node: IntervalNode<T> | undefined,
        results: Array<{ interval: Interval; data: T }>
    ): void {
        if (!node) {
            return;
        }

        this.collectAll(node.left, results);
        results.push({ interval: node.interval, data: node.data });
        this.collectAll(node.right, results);
    }

    private forEachNode(
        node: IntervalNode<T> | undefined,
        callback: (interval: Interval, data: T) => void
    ): void {
        if (!node) {
            return;
        }

        this.forEachNode(node.left, callback);
        callback(node.interval, node.data);
        this.forEachNode(node.right, callback);
    }

    private getHeight(node: IntervalNode<T> | undefined): number {
        return node?.height ?? 0;
    }

    private getBalance(node: IntervalNode<T>): number {
        return this.getHeight(node.left) - this.getHeight(node.right);
    }

    private balance(node: IntervalNode<T>): IntervalNode<T> {
        const balance = this.getBalance(node);

        // Left heavy
        if (balance > 1 && node.left) {
            if (this.getBalance(node.left) < 0) {
                // Left-Right case
                node.left = this.rotateLeft(node.left);
            }
            // Left-Left case
            return this.rotateRight(node);
        }

        // Right heavy
        if (balance < -1 && node.right) {
            if (this.getBalance(node.right) > 0) {
                // Right-Left case
                node.right = this.rotateRight(node.right);
            }
            // Right-Right case
            return this.rotateLeft(node);
        }

        return node;
    }

    private rotateRight(y: IntervalNode<T>): IntervalNode<T> {
        const x = y.left!;
        const T2 = x.right;

        x.right = y;
        y.left = T2;

        // Update heights
        y.height = 1 + Math.max(this.getHeight(y.left), this.getHeight(y.right));
        x.height = 1 + Math.max(this.getHeight(x.left), this.getHeight(x.right));

        // Update max values
        y.max = Math.max(y.interval.end, y.left?.max ?? 0, y.right?.max ?? 0);
        x.max = Math.max(x.interval.end, x.left?.max ?? 0, x.right?.max ?? 0);

        return x;
    }

    private rotateLeft(x: IntervalNode<T>): IntervalNode<T> {
        const y = x.right!;
        const T2 = y.left;

        y.left = x;
        x.right = T2;

        // Update heights
        x.height = 1 + Math.max(this.getHeight(x.left), this.getHeight(x.right));
        y.height = 1 + Math.max(this.getHeight(y.left), this.getHeight(y.right));

        // Update max values
        x.max = Math.max(x.interval.end, x.left?.max ?? 0, x.right?.max ?? 0);
        y.max = Math.max(y.interval.end, y.left?.max ?? 0, y.right?.max ?? 0);

        return y;
    }
}

/**
 * Range Tree for 2D position-based lookups (line, column)
 * Specialized for VS Code-style document positions
 *
 * @typeParam T - Type of data stored with each range
 *
 * @example
 * ```typescript
 * const tree = new RangeTree<SymbolInfo>();
 * tree.insertRange(
 *   { start: { line: 5, column: 0 }, end: { line: 10, column: 20 } },
 *   symbolInfo
 * );
 *
 * const symbols = tree.searchAtPosition({ line: 7, column: 10 });
 * ```
 */
export class RangeTree<T> {
    private items: Array<{ range: Range; data: T }> = [];

    /**
     * Insert a range with associated data
     */
    insertRange(range: Range, data: T): void {
        this.items.push({ range, data });
    }

    /**
     * Remove a range (first match by reference equality of data)
     */
    removeRange(data: T): boolean {
        const index = this.items.findIndex(item => item.data === data);
        if (index !== -1) {
            this.items.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Find all ranges containing a position
     */
    searchAtPosition(position: Position): T[] {
        return this.items
            .filter(item => this.positionInRange(position, item.range))
            .map(item => item.data);
    }

    /**
     * Find all ranges overlapping with a range
     */
    searchInRange(range: Range): T[] {
        return this.items
            .filter(item => this.rangesOverlap(range, item.range))
            .map(item => item.data);
    }

    /**
     * Find the smallest (most specific) range containing a position
     */
    searchSmallestAtPosition(position: Position): T | undefined {
        let smallest: { range: Range; data: T } | undefined;
        let smallestSize = Infinity;

        for (const item of this.items) {
            if (this.positionInRange(position, item.range)) {
                const size = this.rangeSize(item.range);
                if (size < smallestSize) {
                    smallestSize = size;
                    smallest = item;
                }
            }
        }

        return smallest?.data;
    }

    /**
     * Get all ranges and their data
     */
    getAll(): Array<{ range: Range; data: T }> {
        return [...this.items];
    }

    /**
     * Number of ranges in the tree
     */
    get size(): number {
        return this.items.length;
    }

    /**
     * Check if tree is empty
     */
    isEmpty(): boolean {
        return this.items.length === 0;
    }

    /**
     * Clear all ranges
     */
    clear(): void {
        this.items = [];
    }

    /**
     * Iterate over all ranges
     */
    forEach(callback: (range: Range, data: T) => void): void {
        for (const item of this.items) {
            callback(item.range, item.data);
        }
    }

    // Private helper methods

    private positionInRange(pos: Position, range: Range): boolean {
        // Before start
        if (pos.line < range.start.line) {
            return false;
        }
        if (pos.line === range.start.line && pos.column < range.start.column) {
            return false;
        }

        // After end
        if (pos.line > range.end.line) {
            return false;
        }
        if (pos.line === range.end.line && pos.column > range.end.column) {
            return false;
        }

        return true;
    }

    private rangesOverlap(a: Range, b: Range): boolean {
        // a ends before b starts
        if (a.end.line < b.start.line) {
            return false;
        }
        if (a.end.line === b.start.line && a.end.column < b.start.column) {
            return false;
        }

        // a starts after b ends
        if (a.start.line > b.end.line) {
            return false;
        }
        if (a.start.line === b.end.line && a.start.column > b.end.column) {
            return false;
        }

        return true;
    }

    private rangeSize(range: Range): number {
        const lines = range.end.line - range.start.line;
        if (lines === 0) {
            return range.end.column - range.start.column;
        }
        // Approximate size: lines * 100 + column span
        return lines * 100 + (range.end.column - range.start.column);
    }
}

/**
 * Line Index for fast line-based lookups
 * Optimized for "find all symbols on line X"
 *
 * @typeParam T - Type of data stored
 */
export class LineIndex<T> {
    private lineMap: Map<number, T[]> = new Map();
    private itemCount: number = 0;

    /**
     * Add an item at a specific line
     */
    addAtLine(line: number, data: T): void {
        let items = this.lineMap.get(line);
        if (!items) {
            items = [];
            this.lineMap.set(line, items);
        }
        items.push(data);
        this.itemCount++;
    }

    /**
     * Add an item spanning a range of lines
     */
    addForRange(startLine: number, endLine: number, data: T): void {
        for (let line = startLine; line <= endLine; line++) {
            this.addAtLine(line, data);
        }
    }

    /**
     * Get all items at a specific line
     */
    getAtLine(line: number): T[] {
        return this.lineMap.get(line) ?? [];
    }

    /**
     * Get all items in a range of lines
     */
    getInRange(startLine: number, endLine: number): T[] {
        const results: T[] = [];
        const seen = new Set<T>();

        for (let line = startLine; line <= endLine; line++) {
            const items = this.lineMap.get(line);
            if (items) {
                for (const item of items) {
                    if (!seen.has(item)) {
                        seen.add(item);
                        results.push(item);
                    }
                }
            }
        }

        return results;
    }

    /**
     * Remove an item from a specific line
     */
    removeFromLine(line: number, data: T): boolean {
        const items = this.lineMap.get(line);
        if (!items) {
            return false;
        }

        const index = items.indexOf(data);
        if (index !== -1) {
            items.splice(index, 1);
            this.itemCount--;
            if (items.length === 0) {
                this.lineMap.delete(line);
            }
            return true;
        }
        return false;
    }

    /**
     * Remove an item from all lines
     */
    removeFromAllLines(data: T): number {
        let removed = 0;
        for (const [line, items] of this.lineMap) {
            const index = items.indexOf(data);
            if (index !== -1) {
                items.splice(index, 1);
                removed++;
                this.itemCount--;
                if (items.length === 0) {
                    this.lineMap.delete(line);
                }
            }
        }
        return removed;
    }

    /**
     * Get all lines that have items
     */
    getOccupiedLines(): number[] {
        return Array.from(this.lineMap.keys()).sort((a, b) => a - b);
    }

    /**
     * Number of items in the index
     */
    get size(): number {
        return this.itemCount;
    }

    /**
     * Number of unique lines
     */
    get lineCount(): number {
        return this.lineMap.size;
    }

    /**
     * Clear all items
     */
    clear(): void {
        this.lineMap.clear();
        this.itemCount = 0;
    }
}

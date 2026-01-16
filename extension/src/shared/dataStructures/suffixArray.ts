/**
 * Suffix Array for Fast Substring Search
 *
 * Efficient substring search across large text content.
 * Used for searching within file contents, finding patterns in code.
 */

/**
 * Options for suffix array configuration
 */
export interface SuffixArrayOptions {
    /** Case-sensitive search. Default: true */
    caseSensitive?: boolean;
}

/**
 * Suffix Array for O(m log n) substring search
 * where m is pattern length and n is text length
 *
 * @example
 * ```typescript
 * const sa = new SuffixArray('def initialize\n  @name = name\nend');
 * const positions = sa.search('@name'); // [18]
 * const hasMatch = sa.contains('initialize'); // true
 * ```
 */
export class SuffixArray {
    private text: string;
    private searchText: string;
    private suffixArray: number[] = [];
    private readonly caseSensitive: boolean;

    constructor(text: string, options: SuffixArrayOptions = {}) {
        this.caseSensitive = options.caseSensitive ?? true;
        this.text = text;
        this.searchText = this.caseSensitive ? text : text.toLowerCase();
        this.buildSuffixArray();
    }

    /**
     * Search for all occurrences of a pattern
     * @returns Array of starting positions
     */
    search(pattern: string): number[] {
        if (pattern.length === 0) {
            return [];
        }

        const searchPattern = this.caseSensitive ? pattern : pattern.toLowerCase();
        const positions: number[] = [];

        // Find first occurrence using binary search
        let left = 0;
        let right = this.suffixArray.length - 1;
        let first = -1;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const suffix = this.searchText.substring(this.suffixArray[mid]);
            const cmp = this.comparePrefix(suffix, searchPattern);

            if (cmp >= 0) {
                if (cmp === 0) {
                    first = mid;
                }
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        }

        if (first === -1) {
            return positions;
        }

        // Collect all matching positions
        for (let i = first; i < this.suffixArray.length; i++) {
            const suffix = this.searchText.substring(this.suffixArray[i]);
            if (suffix.startsWith(searchPattern)) {
                positions.push(this.suffixArray[i]);
            } else {
                break;
            }
        }

        return positions.sort((a, b) => a - b);
    }

    /**
     * Find the first occurrence of a pattern
     * @returns Starting position or -1 if not found
     */
    searchFirst(pattern: string): number {
        const positions = this.search(pattern);
        return positions.length > 0 ? Math.min(...positions) : -1;
    }

    /**
     * Check if the text contains a pattern
     */
    contains(pattern: string): boolean {
        return this.searchFirst(pattern) !== -1;
    }

    /**
     * Count occurrences of a pattern
     */
    count(pattern: string): number {
        return this.search(pattern).length;
    }

    /**
     * Get context around a position
     * @param position - The position in the text
     * @param before - Number of characters before
     * @param after - Number of characters after
     */
    getContext(position: number, before: number, after: number): string {
        const start = Math.max(0, position - before);
        const end = Math.min(this.text.length, position + after);
        return this.text.substring(start, end);
    }

    /**
     * Get line and column for a position
     */
    getLineColumn(position: number): { line: number; column: number } {
        let line = 1;
        let lastNewline = -1;

        for (let i = 0; i < position && i < this.text.length; i++) {
            if (this.text[i] === '\n') {
                line++;
                lastNewline = i;
            }
        }

        return {
            line,
            column: position - lastNewline
        };
    }

    /**
     * Search and return results with context
     */
    searchWithContext(
        pattern: string,
        contextBefore: number = 20,
        contextAfter: number = 20
    ): Array<{
        position: number;
        line: number;
        column: number;
        context: string;
    }> {
        const positions = this.search(pattern);
        return positions.map(pos => {
            const { line, column } = this.getLineColumn(pos);
            return {
                position: pos,
                line,
                column,
                context: this.getContext(pos, contextBefore, contextAfter + pattern.length)
            };
        });
    }

    /**
     * Update the text (rebuilds the suffix array)
     */
    setText(text: string): void {
        this.text = text;
        this.searchText = this.caseSensitive ? text : text.toLowerCase();
        this.buildSuffixArray();
    }

    /**
     * Get the original text
     */
    getText(): string {
        return this.text;
    }

    /**
     * Get the length of the suffix array
     */
    get length(): number {
        return this.suffixArray.length;
    }

    /**
     * Get the text length
     */
    get textLength(): number {
        return this.text.length;
    }

    // Private methods

    private buildSuffixArray(): void {
        const n = this.searchText.length;
        if (n === 0) {
            this.suffixArray = [];
            return;
        }

        // Build suffix array using prefix doubling algorithm
        // Time complexity: O(n log n)
        const suffixes: Array<{ index: number; rank: number; nextRank: number }> = [];

        for (let i = 0; i < n; i++) {
            suffixes.push({
                index: i,
                rank: this.searchText.charCodeAt(i),
                nextRank: i + 1 < n ? this.searchText.charCodeAt(i + 1) : -1
            });
        }

        suffixes.sort((a, b) => {
            if (a.rank !== b.rank) {
                return a.rank - b.rank;
            }
            return a.nextRank - b.nextRank;
        });

        const indexToRank = new Array<number>(n);

        for (let k = 4; k < 2 * n; k *= 2) {
            // Assign ranks based on current order
            let rank = 0;
            let prevRank = suffixes[0].rank;
            let prevNextRank = suffixes[0].nextRank;
            suffixes[0].rank = rank;
            indexToRank[suffixes[0].index] = rank;

            for (let i = 1; i < n; i++) {
                if (
                    suffixes[i].rank === prevRank &&
                    suffixes[i].nextRank === prevNextRank
                ) {
                    suffixes[i].rank = rank;
                } else {
                    prevRank = suffixes[i].rank;
                    prevNextRank = suffixes[i].nextRank;
                    suffixes[i].rank = ++rank;
                }
                indexToRank[suffixes[i].index] = suffixes[i].rank;
            }

            // Update next ranks
            for (let i = 0; i < n; i++) {
                const nextIndex = suffixes[i].index + k / 2;
                suffixes[i].nextRank = nextIndex < n ? indexToRank[nextIndex] : -1;
            }

            // Sort by new ranks
            suffixes.sort((a, b) => {
                if (a.rank !== b.rank) {
                    return a.rank - b.rank;
                }
                return a.nextRank - b.nextRank;
            });
        }

        this.suffixArray = suffixes.map(s => s.index);
    }

    private comparePrefix(suffix: string, pattern: string): number {
        const len = Math.min(suffix.length, pattern.length);
        for (let i = 0; i < len; i++) {
            if (suffix[i] < pattern[i]) {
                return -1;
            }
            if (suffix[i] > pattern[i]) {
                return 1;
            }
        }
        if (suffix.length < pattern.length) {
            return -1;
        }
        return 0;
    }
}

/**
 * Multi-file suffix index for searching across multiple files
 *
 * @example
 * ```typescript
 * const index = new MultiFileSuffixIndex();
 * index.addFile('/app/models/user.rb', 'class User < ApplicationRecord');
 * index.addFile('/app/controllers/users_controller.rb', 'class UsersController');
 *
 * const results = index.search('User');
 * // Returns matches from both files
 * ```
 */
export class MultiFileSuffixIndex {
    private files: Map<string, SuffixArray> = new Map();
    private readonly caseSensitive: boolean;

    constructor(options: SuffixArrayOptions = {}) {
        this.caseSensitive = options.caseSensitive ?? true;
    }

    /**
     * Add a file to the index
     */
    addFile(uri: string, content: string): void {
        this.files.set(uri, new SuffixArray(content, {
            caseSensitive: this.caseSensitive
        }));
    }

    /**
     * Remove a file from the index
     */
    removeFile(uri: string): boolean {
        return this.files.delete(uri);
    }

    /**
     * Update a file's content
     */
    updateFile(uri: string, content: string): void {
        this.addFile(uri, content);
    }

    /**
     * Check if a file is indexed
     */
    hasFile(uri: string): boolean {
        return this.files.has(uri);
    }

    /**
     * Get file content
     */
    getFileContent(uri: string): string | undefined {
        return this.files.get(uri)?.getText();
    }

    /**
     * Search across all files
     */
    search(pattern: string): Array<{ uri: string; positions: number[] }> {
        const results: Array<{ uri: string; positions: number[] }> = [];

        for (const [uri, suffixArray] of this.files) {
            const positions = suffixArray.search(pattern);
            if (positions.length > 0) {
                results.push({ uri, positions });
            }
        }

        return results;
    }

    /**
     * Search with context across all files
     */
    searchWithContext(
        pattern: string,
        contextSize: number = 30
    ): Array<{
        uri: string;
        matches: Array<{
            position: number;
            line: number;
            column: number;
            context: string;
        }>;
    }> {
        const results: Array<{
            uri: string;
            matches: Array<{
                position: number;
                line: number;
                column: number;
                context: string;
            }>;
        }> = [];

        for (const [uri, suffixArray] of this.files) {
            const matches = suffixArray.searchWithContext(pattern, contextSize, contextSize);
            if (matches.length > 0) {
                results.push({ uri, matches });
            }
        }

        return results;
    }

    /**
     * Search in specific files
     */
    searchInFiles(
        pattern: string,
        uris: string[]
    ): Array<{ uri: string; positions: number[] }> {
        const results: Array<{ uri: string; positions: number[] }> = [];

        for (const uri of uris) {
            const suffixArray = this.files.get(uri);
            if (suffixArray) {
                const positions = suffixArray.search(pattern);
                if (positions.length > 0) {
                    results.push({ uri, positions });
                }
            }
        }

        return results;
    }

    /**
     * Count total occurrences across all files
     */
    countAll(pattern: string): number {
        let total = 0;
        for (const suffixArray of this.files.values()) {
            total += suffixArray.count(pattern);
        }
        return total;
    }

    /**
     * Get files containing a pattern
     */
    getFilesContaining(pattern: string): string[] {
        const uris: string[] = [];
        for (const [uri, suffixArray] of this.files) {
            if (suffixArray.contains(pattern)) {
                uris.push(uri);
            }
        }
        return uris;
    }

    /**
     * Get all indexed file URIs
     */
    getFiles(): string[] {
        return Array.from(this.files.keys());
    }

    /**
     * Number of indexed files
     */
    get fileCount(): number {
        return this.files.size;
    }

    /**
     * Total indexed text length
     */
    get totalLength(): number {
        let total = 0;
        for (const suffixArray of this.files.values()) {
            total += suffixArray.textLength;
        }
        return total;
    }

    /**
     * Clear all files
     */
    clear(): void {
        this.files.clear();
    }

    /**
     * Get index statistics
     */
    getStats(): {
        fileCount: number;
        totalLength: number;
        avgFileLength: number;
    } {
        const fileCount = this.files.size;
        const totalLength = this.totalLength;
        return {
            fileCount,
            totalLength,
            avgFileLength: fileCount > 0 ? totalLength / fileCount : 0
        };
    }
}

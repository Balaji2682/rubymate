/**
 * Trie (Prefix Tree) implementation for fast symbol name lookup
 * Performance: O(k) where k = query length (vs O(n*m) for linear search)
 */

export interface TrieOptions {
    /** If true, keys are case-sensitive. Default: false (case-insensitive) */
    caseSensitive?: boolean;
}

export class TrieNode<T> {
    children: Map<string, TrieNode<T>> = new Map();
    items: T[] = [];
    isEndOfWord: boolean = false;
}

export class Trie<T> {
    private root: TrieNode<T> = new TrieNode<T>();
    private size: number = 0;
    private readonly caseSensitive: boolean;

    constructor(options: TrieOptions = {}) {
        this.caseSensitive = options.caseSensitive ?? false;
    }

    /**
     * Normalize a key based on case sensitivity setting
     */
    private normalizeKey(key: string): string {
        return this.caseSensitive ? key : key.toLowerCase();
    }

    /**
     * Insert an item with its associated key into the trie
     * @param key - The string key to index by
     * @param item - The item to store
     * @param options - Insert options
     * @param options.deduplicate - If true, prevents adding duplicate items (uses reference equality)
     */
    insert(key: string, item: T, options?: { deduplicate?: boolean }): void {
        // Validate empty key
        if (!key || key.length === 0) {
            return; // Skip empty keys
        }

        let node = this.root;
        const normalizedKey = this.normalizeKey(key);

        for (const char of normalizedKey) {
            if (!node.children.has(char)) {
                node.children.set(char, new TrieNode<T>());
            }
            node = node.children.get(char)!;
        }

        // Check for duplicates if deduplication is enabled
        if (options?.deduplicate && node.items.includes(item)) {
            return;
        }

        node.items.push(item);
        node.isEndOfWord = true;
        this.size++;
    }

    /**
     * Search for items by exact key match
     * @param key - The exact key to search for
     * @returns Array of items matching the exact key
     */
    searchExact(key: string): T[] {
        if (!key || key.length === 0) {
            return [];
        }
        const node = this.findNode(this.normalizeKey(key));
        return node?.isEndOfWord ? [...node.items] : [];
    }

    /**
     * Search for all items whose keys start with the given prefix
     * @param prefix - The prefix to search for
     * @param limit - Optional limit on results
     * @returns Array of items matching the prefix
     */
    searchPrefix(prefix: string, limit?: number): T[] {
        if (!prefix || prefix.length === 0) {
            // Return all items if prefix is empty
            return this.collectAllItems(this.root, limit);
        }
        const node = this.findNode(this.normalizeKey(prefix));
        if (!node) {
            return [];
        }
        return this.collectAllItems(node, limit);
    }

    /**
     * Remove all items associated with a key
     * @param key - The key to remove
     * @returns Number of items removed
     */
    remove(key: string): number {
        if (!key || key.length === 0) {
            return 0;
        }

        const normalizedKey = this.normalizeKey(key);
        const path: Array<{ node: TrieNode<T>; char: string }> = [];
        let node = this.root;

        for (const char of normalizedKey) {
            if (!node.children.has(char)) {
                return 0;
            }
            path.push({ node, char });
            node = node.children.get(char)!;
        }

        if (!node.isEndOfWord) {
            return 0;
        }

        const removedCount = node.items.length;
        this.size -= removedCount;
        node.items = [];
        node.isEndOfWord = false;

        // Clean up empty nodes from leaf to root
        if (node.children.size === 0) {
            for (let i = path.length - 1; i >= 0; i--) {
                const { node: parentNode, char } = path[i];
                const childNode = parentNode.children.get(char)!;

                if (childNode.children.size === 0 && !childNode.isEndOfWord) {
                    parentNode.children.delete(char);
                } else {
                    break;
                }
            }
        }

        return removedCount;
    }

    /**
     * Remove a specific item from a key
     * @param key - The key to search under
     * @param predicate - Function to identify the item to remove
     * @returns true if an item was removed
     */
    removeItem(key: string, predicate: (item: T) => boolean): boolean {
        if (!key || key.length === 0) {
            return false;
        }

        const node = this.findNode(this.normalizeKey(key));
        if (!node || !node.isEndOfWord) {
            return false;
        }

        const index = node.items.findIndex(predicate);
        if (index === -1) {
            return false;
        }

        node.items.splice(index, 1);
        this.size--;

        if (node.items.length === 0) {
            node.isEndOfWord = false;
        }

        return true;
    }

    /**
     * Check if the trie contains items for a given key
     */
    has(key: string): boolean {
        if (!key || key.length === 0) {
            return false;
        }
        const node = this.findNode(this.normalizeKey(key));
        return node?.isEndOfWord ?? false;
    }

    /**
     * Check if any keys start with the given prefix
     */
    hasPrefix(prefix: string): boolean {
        if (!prefix || prefix.length === 0) {
            return this.size > 0; // Empty prefix matches if trie has items
        }
        return this.findNode(this.normalizeKey(prefix)) !== null;
    }

    /**
     * Get all keys stored in the trie
     */
    keys(): string[] {
        const result: string[] = [];
        this.collectKeys(this.root, '', result);
        return result;
    }

    /**
     * Get the total number of items stored
     */
    getSize(): number {
        return this.size;
    }

    /**
     * Clear all items from the trie
     */
    clear(): void {
        this.root = new TrieNode<T>();
        this.size = 0;
    }

    /**
     * Get suggestions for autocomplete based on prefix
     * @param prefix - The prefix to search for
     * @param maxSuggestions - Maximum number of suggestions to return
     */
    getSuggestions(prefix: string, maxSuggestions: number = 10): Array<{ key: string; items: T[] }> {
        const suggestions: Array<{ key: string; items: T[] }> = [];

        if (!prefix || prefix.length === 0) {
            // Return suggestions from root for empty prefix
            this.collectSuggestions(this.root, '', suggestions, maxSuggestions);
            return suggestions;
        }

        const normalizedPrefix = this.normalizeKey(prefix);
        const node = this.findNode(normalizedPrefix);
        if (!node) {
            return [];
        }

        this.collectSuggestions(node, normalizedPrefix, suggestions, maxSuggestions);
        return suggestions;
    }

    private findNode(key: string): TrieNode<T> | null {
        let node = this.root;
        for (const char of key) {
            if (!node.children.has(char)) {
                return null;
            }
            node = node.children.get(char)!;
        }
        return node;
    }

    private collectAllItems(node: TrieNode<T>, limit?: number): T[] {
        const result: T[] = [];
        const stack: TrieNode<T>[] = [node];

        while (stack.length > 0 && (limit === undefined || result.length < limit)) {
            const current = stack.pop()!;

            if (current.isEndOfWord) {
                const remaining = limit !== undefined ? limit - result.length : undefined;
                const itemsToAdd = remaining !== undefined
                    ? current.items.slice(0, remaining)
                    : current.items;
                result.push(...itemsToAdd);
            }

            if (limit === undefined || result.length < limit) {
                for (const child of current.children.values()) {
                    stack.push(child);
                }
            }
        }

        return result;
    }

    private collectKeys(node: TrieNode<T>, currentKey: string, result: string[]): void {
        if (node.isEndOfWord) {
            result.push(currentKey);
        }

        for (const [char, child] of node.children) {
            this.collectKeys(child, currentKey + char, result);
        }
    }

    private collectSuggestions(
        node: TrieNode<T>,
        currentKey: string,
        suggestions: Array<{ key: string; items: T[] }>,
        maxSuggestions: number
    ): void {
        if (suggestions.length >= maxSuggestions) {
            return;
        }

        if (node.isEndOfWord && node.items.length > 0) {
            suggestions.push({ key: currentKey, items: [...node.items] });
        }

        for (const [char, child] of node.children) {
            if (suggestions.length >= maxSuggestions) {
                break;
            }
            this.collectSuggestions(child, currentKey + char, suggestions, maxSuggestions);
        }
    }
}

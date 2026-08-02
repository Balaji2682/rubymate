/**
 * Inverted Index for Symbol Name → Locations
 *
 * Provides O(1) average case lookup for symbols by name, kind, or file.
 * Supports efficient incremental updates when files change.
 */

import * as vscode from 'vscode';
import { Trie } from '../dataStructures/trie';
import { BloomFilter } from '../dataStructures/bloomFilter';

export interface IndexedSymbol {
    name: string;
    kind: vscode.SymbolKind;
    location: vscode.Location;
    containerName?: string;
    detail?: string;
    definitionConfidence?: 'exact_ast' | 'rails_convention' | 'metaprogramming' | 'fuzzy' | 'fallback';
    /** Fully qualified name (e.g., Module::Class::method) */
    fullyQualifiedName?: string;
}

export interface SymbolIndexStats {
    totalSymbols: number;
    totalFiles: number;
    symbolsByKind: Map<vscode.SymbolKind, number>;
    averageSymbolsPerFile: number;
}

export class SymbolIndex {
    /** Primary index: symbol name → symbols */
    private nameIndex: Map<string, Set<IndexedSymbol>> = new Map();

    /** Secondary index: symbol kind → symbols */
    private kindIndex: Map<vscode.SymbolKind, Set<IndexedSymbol>> = new Map();

    /** File index: file URI → symbols in that file */
    private fileIndex: Map<string, Set<IndexedSymbol>> = new Map();

    /** Trie for fast prefix search - built lazily on first prefix query */
    private nameTrie: Trie<IndexedSymbol> | null = null;
    private trieBuilt: boolean = false;

    /** Bloom filter for fast negative lookups */
    private nameBloom: BloomFilter;

    /** Case-insensitive name → original names mapping */
    private caseInsensitiveIndex: Map<string, Set<string>> = new Map();

    /** Container index: container name → contained symbols */
    private containerIndex: Map<string, Set<IndexedSymbol>> = new Map();

    /** Fully qualified name index for precise lookups */
    private fqnIndex: Map<string, IndexedSymbol> = new Map();

    constructor(expectedSymbols: number = 100000, existingBloomFilter?: BloomFilter) {
        this.nameBloom = existingBloomFilter ?? new BloomFilter({
            expectedElements: expectedSymbols,
            falsePositiveRate: 0.01
        });
    }

    /**
     * Get the internal BloomFilter for persistence
     */
    getBloomFilter(): BloomFilter {
        return this.nameBloom;
    }

    /**
     * Ensure Trie is built before prefix search (lazy initialization)
     */
    private ensureTrieBuilt(): Trie<IndexedSymbol> {
        if (!this.trieBuilt || !this.nameTrie) {
            this.nameTrie = new Trie<IndexedSymbol>();
            // Populate from nameIndex
            for (const [name, symbols] of this.nameIndex) {
                for (const symbol of symbols) {
                    this.nameTrie.insert(name, symbol);
                }
            }
            this.trieBuilt = true;
        }
        return this.nameTrie;
    }

    /**
     * Invalidate the Trie (will be rebuilt on next prefix search)
     */
    invalidateTrie(): void {
        this.trieBuilt = false;
        this.nameTrie = null;
    }

    /**
     * Compare two symbols for equality by content (not reference)
     */
    private symbolEquals(a: IndexedSymbol, b: IndexedSymbol): boolean {
        return a.name === b.name &&
               a.kind === b.kind &&
               a.location.uri.toString() === b.location.uri.toString() &&
               a.location.range.start.line === b.location.range.start.line &&
               a.location.range.start.character === b.location.range.start.character &&
               a.location.range.end.line === b.location.range.end.line &&
               a.location.range.end.character === b.location.range.end.character;
    }

    /**
     * Add a symbol to the index
     */
    addSymbol(symbol: IndexedSymbol): void {
        // Skip symbols with empty names
        if (!symbol.name || symbol.name.length === 0) {
            return;
        }

        const name = symbol.name;
        const lowerName = name.toLowerCase();
        const fileUri = symbol.location.uri.toString();

        // Add to name index
        if (!this.nameIndex.has(name)) {
            this.nameIndex.set(name, new Set());
        }
        this.nameIndex.get(name)!.add(symbol);

        // Add to case-insensitive index
        if (!this.caseInsensitiveIndex.has(lowerName)) {
            this.caseInsensitiveIndex.set(lowerName, new Set());
        }
        this.caseInsensitiveIndex.get(lowerName)!.add(name);

        // Add to kind index
        if (!this.kindIndex.has(symbol.kind)) {
            this.kindIndex.set(symbol.kind, new Set());
        }
        this.kindIndex.get(symbol.kind)!.add(symbol);

        // Add to file index
        if (!this.fileIndex.has(fileUri)) {
            this.fileIndex.set(fileUri, new Set());
        }
        this.fileIndex.get(fileUri)!.add(symbol);

        // Invalidate Trie - will be rebuilt lazily on next prefix search
        if (this.trieBuilt) {
            this.invalidateTrie();
        }

        // Add to bloom filter
        this.nameBloom.add(name);
        this.nameBloom.add(lowerName);

        // Add to container index if applicable
        if (symbol.containerName) {
            if (!this.containerIndex.has(symbol.containerName)) {
                this.containerIndex.set(symbol.containerName, new Set());
            }
            this.containerIndex.get(symbol.containerName)!.add(symbol);
        }

        // Add to FQN index if applicable
        if (symbol.fullyQualifiedName) {
            if (this.fqnIndex.has(symbol.fullyQualifiedName)) {
                // FQN collision - log warning but allow overwrite
                // console.warn(`SymbolIndex: FQN collision for '${symbol.fullyQualifiedName}', overwriting`);
            }
            this.fqnIndex.set(symbol.fullyQualifiedName, symbol);
        }
    }

    /**
     * Add multiple symbols at once
     */
    addSymbols(symbols: IndexedSymbol[]): void {
        for (const symbol of symbols) {
            this.addSymbol(symbol);
        }
    }

    /**
     * Find symbols by exact name match
     * Performance: O(1) average
     */
    findByName(name: string): IndexedSymbol[] {
        // Quick bloom filter check
        if (!this.nameBloom.mightContain(name)) {
            return [];
        }
        return Array.from(this.nameIndex.get(name) || []);
    }

    /**
     * Find symbols by name (case-insensitive)
     * Performance: O(1) average
     */
    findByNameIgnoreCase(name: string): IndexedSymbol[] {
        const lowerName = name.toLowerCase();

        // Quick bloom filter check
        if (!this.nameBloom.mightContain(lowerName)) {
            return [];
        }

        const originalNames = this.caseInsensitiveIndex.get(lowerName);
        if (!originalNames) {
            return [];
        }

        const results: IndexedSymbol[] = [];
        for (const originalName of originalNames) {
            const symbols = this.nameIndex.get(originalName);
            if (symbols) {
                results.push(...symbols);
            }
        }
        return results;
    }

    /**
     * Find symbols by prefix
     * Performance: O(k + r) where k = prefix length, r = result count
     * Note: First call triggers lazy Trie build
     */
    findByPrefix(prefix: string, limit?: number): IndexedSymbol[] {
        const trie = this.ensureTrieBuilt();
        return trie.searchPrefix(prefix, limit);
    }

    /**
     * Find symbols by kind
     * Performance: O(1) average
     */
    findByKind(kind: vscode.SymbolKind): IndexedSymbol[] {
        return Array.from(this.kindIndex.get(kind) || []);
    }

    /**
     * Find symbols in a specific file
     * Performance: O(1) average
     */
    findByFile(fileUri: string): IndexedSymbol[] {
        return Array.from(this.fileIndex.get(fileUri) || []);
    }

    /**
     * Find symbols by container name
     */
    findByContainer(containerName: string): IndexedSymbol[] {
        return Array.from(this.containerIndex.get(containerName) || []);
    }

    /**
     * Find symbol by fully qualified name
     * Performance: O(1)
     */
    findByFQN(fqn: string): IndexedSymbol | undefined {
        return this.fqnIndex.get(fqn);
    }

    /**
     * Find symbols matching multiple criteria
     */
    findSymbols(options: {
        name?: string;
        prefix?: string;
        kind?: vscode.SymbolKind;
        fileUri?: string;
        containerName?: string;
        ignoreCase?: boolean;
        limit?: number;
    }): IndexedSymbol[] {
        let results: Set<IndexedSymbol> | undefined;

        // Start with the most selective filter
        if (options.name) {
            const nameResults = options.ignoreCase
                ? this.findByNameIgnoreCase(options.name)
                : this.findByName(options.name);
            results = new Set(nameResults);
        } else if (options.prefix) {
            const prefixResults = this.findByPrefix(options.prefix, options.limit);
            results = new Set(prefixResults);
        } else if (options.fileUri) {
            results = new Set(this.findByFile(options.fileUri));
        } else if (options.kind !== undefined) {
            results = new Set(this.findByKind(options.kind));
        } else if (options.containerName) {
            results = new Set(this.findByContainer(options.containerName));
        }

        if (!results) {
            // No filter specified, return all symbols (expensive!)
            results = new Set<IndexedSymbol>();
            for (const symbols of this.nameIndex.values()) {
                for (const symbol of symbols) {
                    results.add(symbol);
                }
            }
        }

        // Apply additional filters
        if (results.size > 0) {
            if (options.kind !== undefined && !options.name && !options.prefix) {
                // Kind filter not applied yet
            } else if (options.kind !== undefined) {
                results = new Set([...results].filter(s => s.kind === options.kind));
            }

            if (options.fileUri && !options.name && !options.prefix) {
                // File filter not applied yet
            } else if (options.fileUri) {
                results = new Set([...results].filter(
                    s => s.location.uri.toString() === options.fileUri
                ));
            }

            if (options.containerName && !options.name && !options.prefix) {
                // Container filter not applied yet
            } else if (options.containerName) {
                results = new Set([...results].filter(
                    s => s.containerName === options.containerName
                ));
            }
        }

        let resultArray = [...results];

        // Apply limit
        if (options.limit && resultArray.length > options.limit) {
            resultArray = resultArray.slice(0, options.limit);
        }

        return resultArray;
    }

    /**
     * Check if a symbol name exists (fast negative check)
     * Performance: O(1)
     */
    mightHaveName(name: string): boolean {
        return this.nameBloom.mightContain(name);
    }

    /**
     * Remove all symbols from a file
     * Performance: O(s) where s = symbols in file
     */
    removeFileSymbols(fileUri: string): number {
        const symbols = this.fileIndex.get(fileUri);
        if (!symbols || symbols.size === 0) {
            return 0;
        }

        const removedCount = symbols.size;

        for (const symbol of symbols) {
            // Remove from name index
            const nameSet = this.nameIndex.get(symbol.name);
            if (nameSet) {
                nameSet.delete(symbol);
                if (nameSet.size === 0) {
                    this.nameIndex.delete(symbol.name);

                    // Clean up case-insensitive index
                    const lowerName = symbol.name.toLowerCase();
                    const caseSet = this.caseInsensitiveIndex.get(lowerName);
                    if (caseSet) {
                        caseSet.delete(symbol.name);
                        if (caseSet.size === 0) {
                            this.caseInsensitiveIndex.delete(lowerName);
                        }
                    }
                }
            }

            // Remove from kind index
            const kindSet = this.kindIndex.get(symbol.kind);
            if (kindSet) {
                kindSet.delete(symbol);
                if (kindSet.size === 0) {
                    this.kindIndex.delete(symbol.kind);
                }
            }

            // Remove from container index
            if (symbol.containerName) {
                const containerSet = this.containerIndex.get(symbol.containerName);
                if (containerSet) {
                    containerSet.delete(symbol);
                    if (containerSet.size === 0) {
                        this.containerIndex.delete(symbol.containerName);
                    }
                }
            }

            // Remove from FQN index
            if (symbol.fullyQualifiedName) {
                this.fqnIndex.delete(symbol.fullyQualifiedName);
            }

            // Remove from trie if built (use content-based equality)
            if (this.nameTrie) {
                this.nameTrie.removeItem(symbol.name, (s) => this.symbolEquals(s, symbol));
            }
        }

        // Remove from file index
        this.fileIndex.delete(fileUri);

        return removedCount;
    }

    /**
     * Update symbols for a file (removes old, adds new)
     */
    updateFileSymbols(fileUri: string, newSymbols: IndexedSymbol[]): void {
        this.removeFileSymbols(fileUri);
        this.addSymbols(newSymbols);
    }

    /**
     * Clear the entire index
     */
    clear(): void {
        this.nameIndex.clear();
        this.kindIndex.clear();
        this.fileIndex.clear();
        this.caseInsensitiveIndex.clear();
        this.containerIndex.clear();
        this.fqnIndex.clear();
        this.invalidateTrie();
        this.nameBloom.clear();
    }

    /**
     * Get index statistics
     */
    getStats(): SymbolIndexStats {
        const symbolsByKind = new Map<vscode.SymbolKind, number>();
        for (const [kind, symbols] of this.kindIndex) {
            symbolsByKind.set(kind, symbols.size);
        }

        let totalSymbols = 0;
        for (const symbols of this.nameIndex.values()) {
            totalSymbols += symbols.size;
        }

        const totalFiles = this.fileIndex.size;

        return {
            totalSymbols,
            totalFiles,
            symbolsByKind,
            averageSymbolsPerFile: totalFiles > 0 ? totalSymbols / totalFiles : 0
        };
    }

    /**
     * Get all unique symbol names
     */
    getAllNames(): string[] {
        return Array.from(this.nameIndex.keys());
    }

    /**
     * Get all indexed file URIs
     */
    getAllFiles(): string[] {
        return Array.from(this.fileIndex.keys());
    }

    /**
     * Check if a file is indexed
     */
    hasFile(fileUri: string): boolean {
        return this.fileIndex.has(fileUri);
    }

    /**
     * Get the total number of symbols
     */
    get totalSymbols(): number {
        let count = 0;
        for (const symbols of this.nameIndex.values()) {
            count += symbols.size;
        }
        return count;
    }

    /**
     * Get the number of indexed files
     */
    get totalFiles(): number {
        return this.fileIndex.size;
    }
}

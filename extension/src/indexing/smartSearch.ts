import * as vscode from 'vscode';
import { SemanticGraphBuilder } from './semanticGraph';
import { RubySymbol } from '../advancedIndexer';
import { ScoredPriorityQueue } from '../shared/dataStructures/priorityQueue';
import { LRUCache } from '../shared/dataStructures/lruCache';
import { Trie } from '../shared/dataStructures/trie';

/**
 * Smart Search Engine with Context-Aware Ranking
 *
 * Performance enhancements:
 * - Uses ScoredPriorityQueue for efficient top-N result extraction
 * - Uses LRUCache for search result caching
 */

export interface SearchResult {
    symbol: RubySymbol;
    score: number;
    reasons: RankingReason[];
}

export interface RankingReason {
    factor: RankingFactor;
    weight: number;
    explanation: string;
}

export enum RankingFactor {
    ExactMatch = 'exact_match',
    PrefixMatch = 'prefix_match',
    SubstringMatch = 'substring_match',
    FuzzyMatch = 'fuzzy_match',
    UsageFrequency = 'usage_frequency',
    Recency = 'recency',
    ContextMatch = 'context_match',
    ProjectCode = 'project_code',
    FileTypeMatch = 'file_type_match',
    ScopeMatch = 'scope_match'
}

export interface SearchContext {
    currentFile?: vscode.Uri;
    currentClass?: string;
    currentMethod?: string;
    fileType?: 'model' | 'controller' | 'view' | 'spec' | 'other';
    query: string;
    searchType?: 'class' | 'method' | 'constant' | 'any';
}

export class SmartSearchEngine {
    private graphBuilder: SemanticGraphBuilder;
    private symbols: Map<string, RubySymbol[]> = new Map();
    private usageStats: Map<string, UsageStats> = new Map();
    private recentlyAccessed: Map<string, number> = new Map(); // symbolId → timestamp

    // Performance: Cache recent search results (100 entries, 30 second TTL)
    private searchCache: LRUCache<string, SearchResult[]>;

    // Performance: Trie for O(k) prefix-based symbol lookups
    private symbolTrie: Trie<RubySymbol>;

    // Weights for different ranking factors
    private weights = {
        exactMatch: 100,
        prefixMatch: 75,
        substringMatch: 50,
        fuzzyMatch: 25,
        usageFrequency: 20,
        recency: 15,
        contextMatch: 30,
        projectCode: 10,
        fileTypeMatch: 20,
        scopeMatch: 10
    };

    constructor(graphBuilder: SemanticGraphBuilder) {
        this.graphBuilder = graphBuilder;
        // Performance: Initialize search result cache (100 entries, 30s TTL)
        this.searchCache = new LRUCache<string, SearchResult[]>({ maxSize: 100, maxAge: 30000 });
        // Performance: Initialize Trie for fast prefix lookups
        this.symbolTrie = new Trie<RubySymbol>();
    }

    /**
     * Add symbols to the search index
     * Performance: Also adds symbols to Trie for O(k) prefix lookups
     */
    indexSymbols(uri: string, symbols: RubySymbol[]): void {
        // Remove old symbols from Trie before adding new ones
        const oldSymbols = this.symbols.get(uri);
        if (oldSymbols) {
            for (const symbol of oldSymbols) {
                this.symbolTrie.remove(symbol.name.toLowerCase());
            }
        }

        this.symbols.set(uri, symbols);

        // Performance: Add symbols to Trie for fast prefix lookups
        for (const symbol of symbols) {
            // Add lowercase version for case-insensitive search
            this.symbolTrie.insert(symbol.name.toLowerCase(), symbol);
            // Also add original case for exact match scenarios
            if (symbol.name !== symbol.name.toLowerCase()) {
                this.symbolTrie.insert(symbol.name, symbol);
            }
        }

        // Performance: Invalidate cache when symbols change
        this.searchCache.clear();

        // Initialize usage stats for new symbols
        for (const symbol of symbols) {
            const key = this.getSymbolKey(symbol);
            if (!this.usageStats.has(key)) {
                this.usageStats.set(key, {
                    accessCount: 0,
                    lastAccessed: Date.now()
                });
            }
        }
    }

    /**
     * Generate cache key for search query
     */
    private getCacheKey(query: string, context: SearchContext): string {
        return `${query}:${context.fileType || ''}:${context.searchType || ''}:${context.currentFile?.toString() || ''}`;
    }

    /**
     * Search for symbols with smart ranking
     * Performance: Uses LRUCache for caching and ScoredPriorityQueue for efficient top-N
     */
    search(query: string, context: SearchContext, limit: number = 50): SearchResult[] {
        // Performance: Check cache first
        const cacheKey = this.getCacheKey(query, context);
        const cached = this.searchCache.get(cacheKey);
        if (cached) {
            return cached.slice(0, limit);
        }

        const allSymbols = this.getAllSymbols();

        // Performance: Use ScoredPriorityQueue for efficient top-N extraction
        // This is O(n log k) instead of O(n log n) for full sort
        const priorityQueue = new ScoredPriorityQueue<{ symbol: RubySymbol; reasons: RankingReason[] }>({ maxSize: limit });

        for (const symbol of allSymbols) {
            const score = this.calculateScore(symbol, query, context);

            if (score > 0) {
                const reasons = this.getRankingReasons(symbol, query, context);
                priorityQueue.addWithScore({ symbol, reasons }, score);
            }
        }

        // Extract top results from priority queue with scores
        const topItems = priorityQueue.getAllWithScores();
        const results: SearchResult[] = topItems.slice(0, limit).map(scoredItem => ({
            symbol: scoredItem.item.symbol,
            score: scoredItem.score,
            reasons: scoredItem.item.reasons
        }));

        // Record access for top results
        results.forEach(r => {
            this.recordAccess(r.symbol);
        });

        // Performance: Cache results
        this.searchCache.set(cacheKey, results);

        return results;
    }

    /**
     * Calculate relevance score for a symbol
     */
    private calculateScore(symbol: RubySymbol, query: string, context: SearchContext): number {
        let score = 0;
        const symbolName = symbol.name.toLowerCase();
        const queryLower = query.toLowerCase();

        // 1. Name matching
        if (symbolName === queryLower) {
            score += this.weights.exactMatch;
        } else if (symbolName.startsWith(queryLower)) {
            score += this.weights.prefixMatch;
        } else if (symbolName.includes(queryLower)) {
            score += this.weights.substringMatch;
        } else if (this.fuzzyMatch(symbolName, queryLower)) {
            score += this.weights.fuzzyMatch;
        } else {
            return 0; // No match at all
        }

        // 2. Usage frequency
        const usageScore = this.getUsageScore(symbol);
        score += usageScore * this.weights.usageFrequency;

        // 3. Recency
        const recencyScore = this.getRecencyScore(symbol);
        score += recencyScore * this.weights.recency;

        // 4. Context matching
        const contextScore = this.getContextScore(symbol, context);
        score += contextScore * this.weights.contextMatch;

        // 5. Project vs gem code
        if (this.isProjectCode(symbol)) {
            score += this.weights.projectCode;
        }

        // 6. File type matching
        if (this.matchesFileType(symbol, context)) {
            score += this.weights.fileTypeMatch;
        }

        // 7. Scope matching (if searching in specific scope)
        if (this.matchesScope(symbol, context)) {
            score += this.weights.scopeMatch;
        }

        return score;
    }

    /**
     * Get usage score (0-1) based on how often symbol is accessed
     */
    private getUsageScore(symbol: RubySymbol): number {
        const key = this.getSymbolKey(symbol);
        const stats = this.usageStats.get(key);

        if (!stats) return 0;

        // Normalize access count (logarithmic scale)
        const maxAccess = 100; // Assume 100 accesses is "very popular"
        return Math.min(1, Math.log(stats.accessCount + 1) / Math.log(maxAccess));
    }

    /**
     * Get recency score (0-1) based on when symbol was last accessed
     */
    private getRecencyScore(symbol: RubySymbol): number {
        const key = this.getSymbolKey(symbol);
        const timestamp = this.recentlyAccessed.get(key);

        if (!timestamp) return 0;

        const now = Date.now();
        const ageMs = now - timestamp;
        const ageHours = ageMs / (1000 * 60 * 60);

        // Exponential decay: recent = 1.0, 24h ago = 0.5, 1 week ago = ~0.1
        return Math.exp(-ageHours / 24);
    }

    /**
     * Get context score (0-1) based on how well symbol matches current context
     */
    private getContextScore(symbol: RubySymbol, context: SearchContext): number {
        let score = 0;
        let factors = 0;

        const graph = this.graphBuilder.getGraph();

        // If in a controller, prefer models and views
        if (context.fileType === 'controller' && context.currentClass) {
            const controllerName = context.currentClass;
            const modelName = controllerName.replace('Controller', '').replace(/s$/, ''); // UsersController → User

            if (symbol.kind === vscode.SymbolKind.Class && symbol.name === modelName) {
                score += 1;
                factors++;
            }
        }

        // If in a model, prefer related models via associations
        if (context.fileType === 'model' && context.currentClass) {
            const associations = graph.associations.get(context.currentClass);
            if (associations) {
                const isRelatedModel = associations.some(a => a.targetModel === symbol.name);
                if (isRelatedModel) {
                    score += 0.8;
                    factors++;
                }
            }
        }

        // If in a spec, prefer the tested class/method
        if (context.fileType === 'spec' && context.currentFile) {
            const specPath = context.currentFile.fsPath;
            const testedName = this.getTestedName(specPath);

            if (symbol.name === testedName) {
                score += 1;
                factors++;
            }
        }

        // Same file = higher relevance
        if (context.currentFile && symbol.location.uri.toString() === context.currentFile.toString()) {
            score += 0.5;
            factors++;
        }

        return factors > 0 ? score / factors : 0;
    }

    /**
     * Check if symbol is from project code (not a gem)
     */
    private isProjectCode(symbol: RubySymbol): boolean {
        const path = symbol.location.uri.fsPath;
        return !path.includes('/.gem/') &&
               !path.includes('/vendor/bundle/') &&
               !path.includes('/ruby/gems/');
    }

    /**
     * Check if symbol matches the file type context
     */
    private matchesFileType(symbol: RubySymbol, context: SearchContext): boolean {
        if (!context.fileType) return false;

        const path = symbol.location.uri.fsPath;

        switch (context.fileType) {
            case 'model':
                return path.includes('/app/models/');
            case 'controller':
                return path.includes('/app/controllers/');
            case 'view':
                return path.includes('/app/views/');
            case 'spec':
                return path.includes('/spec/');
            default:
                return false;
        }
    }

    /**
     * Check if symbol matches the search scope
     */
    private matchesScope(symbol: RubySymbol, context: SearchContext): boolean {
        if (!context.searchType || context.searchType === 'any') return true;

        switch (context.searchType) {
            case 'class':
                return symbol.kind === vscode.SymbolKind.Class || symbol.kind === vscode.SymbolKind.Module;
            case 'method':
                return symbol.kind === vscode.SymbolKind.Method || symbol.kind === vscode.SymbolKind.Function;
            case 'constant':
                return symbol.kind === vscode.SymbolKind.Constant;
            default:
                return true;
        }
    }

    /**
     * Fuzzy matching using camelCase/snake_case awareness
     */
    private fuzzyMatch(text: string, pattern: string): boolean {
        if (pattern.length === 0) return true;
        if (text.length === 0) return false;

        let patternIdx = 0;
        let textIdx = 0;

        while (patternIdx < pattern.length && textIdx < text.length) {
            if (text[textIdx].toLowerCase() === pattern[patternIdx].toLowerCase()) {
                patternIdx++;
            }
            textIdx++;
        }

        return patternIdx === pattern.length;
    }

    /**
     * Get ranking reasons for display
     */
    private getRankingReasons(symbol: RubySymbol, query: string, context: SearchContext): RankingReason[] {
        const reasons: RankingReason[] = [];
        const symbolName = symbol.name.toLowerCase();
        const queryLower = query.toLowerCase();

        // Name matching reason
        if (symbolName === queryLower) {
            reasons.push({
                factor: RankingFactor.ExactMatch,
                weight: this.weights.exactMatch,
                explanation: 'Exact name match'
            });
        } else if (symbolName.startsWith(queryLower)) {
            reasons.push({
                factor: RankingFactor.PrefixMatch,
                weight: this.weights.prefixMatch,
                explanation: 'Name starts with query'
            });
        } else if (symbolName.includes(queryLower)) {
            reasons.push({
                factor: RankingFactor.SubstringMatch,
                weight: this.weights.substringMatch,
                explanation: 'Name contains query'
            });
        }

        // Usage frequency
        const usageScore = this.getUsageScore(symbol);
        if (usageScore > 0.5) {
            reasons.push({
                factor: RankingFactor.UsageFrequency,
                weight: usageScore * this.weights.usageFrequency,
                explanation: 'Frequently used'
            });
        }

        // Recency
        const recencyScore = this.getRecencyScore(symbol);
        if (recencyScore > 0.5) {
            reasons.push({
                factor: RankingFactor.Recency,
                weight: recencyScore * this.weights.recency,
                explanation: 'Recently accessed'
            });
        }

        // Context
        const contextScore = this.getContextScore(symbol, context);
        if (contextScore > 0) {
            reasons.push({
                factor: RankingFactor.ContextMatch,
                weight: contextScore * this.weights.contextMatch,
                explanation: 'Relevant to current context'
            });
        }

        // Project code
        if (this.isProjectCode(symbol)) {
            reasons.push({
                factor: RankingFactor.ProjectCode,
                weight: this.weights.projectCode,
                explanation: 'From project code'
            });
        }

        return reasons;
    }

    /**
     * Get tested name from spec file path
     */
    private getTestedName(specPath: string): string {
        const match = specPath.match(/\/([^/]+)_spec\.rb$/);
        if (match) {
            const name = match[1];
            // Convert snake_case to PascalCase
            return name.split('_').map(part =>
                part.charAt(0).toUpperCase() + part.slice(1)
            ).join('');
        }
        return '';
    }

    /**
     * Record access to a symbol
     */
    private recordAccess(symbol: RubySymbol): void {
        const key = this.getSymbolKey(symbol);
        const stats = this.usageStats.get(key);

        if (stats) {
            stats.accessCount++;
            stats.lastAccessed = Date.now();
        }

        this.recentlyAccessed.set(key, Date.now());
    }

    /**
     * Get unique key for a symbol
     */
    private getSymbolKey(symbol: RubySymbol): string {
        return `${symbol.location.uri.toString()}:${symbol.name}:${symbol.kind}`;
    }

    /**
     * Get all symbols from all indexed files
     */
    private getAllSymbols(): RubySymbol[] {
        const all: RubySymbol[] = [];
        for (const symbols of this.symbols.values()) {
            all.push(...symbols);
        }
        return all;
    }

    /**
     * Fast prefix search using Trie
     * Performance: O(k) where k is the prefix length
     */
    searchByPrefix(prefix: string, limit: number = 50): RubySymbol[] {
        const lowerPrefix = prefix.toLowerCase();
        const results = this.symbolTrie.searchPrefix(lowerPrefix, limit);
        return results;
    }

    /**
     * Get autocomplete suggestions using Trie
     * Performance: O(k + m) where k is prefix length and m is number of suggestions
     */
    getAutocompleteSuggestions(prefix: string, limit: number = 20): string[] {
        const suggestions = this.symbolTrie.getSuggestions(prefix.toLowerCase(), limit);
        return suggestions.map(s => s.key);
    }

    /**
     * Clear the index
     */
    clear(): void {
        this.symbols.clear();
        this.searchCache.clear();
        this.symbolTrie.clear();
    }

    /**
     * Get statistics
     */
    getStats(): {
        totalSymbols: number;
        indexedFiles: number;
        usageTracked: number;
    } {
        return {
            totalSymbols: this.getAllSymbols().length,
            indexedFiles: this.symbols.size,
            usageTracked: this.usageStats.size
        };
    }
}

interface UsageStats {
    accessCount: number;
    lastAccessed: number;
}

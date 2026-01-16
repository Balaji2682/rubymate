/**
 * Strategy Pattern for Symbol Search
 *
 * Provides different search strategies (exact, fuzzy, prefix, regex)
 * that can be swapped at runtime.
 */

import { IndexedSymbol } from '../indexes/symbolIndex';

/**
 * Base interface for all search strategies
 */
export interface SearchStrategy<T = IndexedSymbol> {
    /** Strategy name for identification */
    readonly name: string;

    /**
     * Search for items matching the query
     * @param query - The search query
     * @param items - Items to search through
     * @returns Matching items
     */
    search(query: string, items: T[]): T[];

    /**
     * Check if a single item matches the query
     */
    matches(query: string, item: T): boolean;
}

/**
 * Options for fuzzy search
 */
export interface FuzzySearchOptions {
    /** Minimum score threshold (0-1) */
    threshold?: number;
    /** Whether to ignore case */
    ignoreCase?: boolean;
    /** Field to search on (if items have multiple fields) */
    getSearchableText?: (item: any) => string;
    /** Behavior when query is empty: 'all' returns all items, 'none' returns empty array. Default: 'all' */
    emptyQueryBehavior?: 'all' | 'none';
    /** Maximum text length to consider for scoring (longer texts are truncated). Default: 10000 */
    maxTextLength?: number;
}

/**
 * Exact match search strategy
 * Performance: O(n) where n = items length
 */
export class ExactSearchStrategy<T extends { name: string }> implements SearchStrategy<T> {
    readonly name = 'exact';
    private ignoreCase: boolean;

    constructor(ignoreCase: boolean = false) {
        this.ignoreCase = ignoreCase;
    }

    search(query: string, items: T[]): T[] {
        return items.filter(item => this.matches(query, item));
    }

    matches(query: string, item: T): boolean {
        if (this.ignoreCase) {
            return item.name.toLowerCase() === query.toLowerCase();
        }
        return item.name === query;
    }
}

/**
 * Prefix search strategy
 * Performance: O(n) where n = items length
 */
export class PrefixSearchStrategy<T extends { name: string }> implements SearchStrategy<T> {
    readonly name = 'prefix';
    private ignoreCase: boolean;

    constructor(ignoreCase: boolean = true) {
        this.ignoreCase = ignoreCase;
    }

    search(query: string, items: T[]): T[] {
        return items.filter(item => this.matches(query, item));
    }

    matches(query: string, item: T): boolean {
        if (this.ignoreCase) {
            return item.name.toLowerCase().startsWith(query.toLowerCase());
        }
        return item.name.startsWith(query);
    }
}

/**
 * Contains search strategy (substring match)
 * Performance: O(n * m) where n = items, m = average string length
 */
export class ContainsSearchStrategy<T extends { name: string }> implements SearchStrategy<T> {
    readonly name = 'contains';
    private ignoreCase: boolean;

    constructor(ignoreCase: boolean = true) {
        this.ignoreCase = ignoreCase;
    }

    search(query: string, items: T[]): T[] {
        return items.filter(item => this.matches(query, item));
    }

    matches(query: string, item: T): boolean {
        if (this.ignoreCase) {
            return item.name.toLowerCase().includes(query.toLowerCase());
        }
        return item.name.includes(query);
    }
}

/**
 * Fuzzy search strategy
 * Uses a scoring algorithm similar to FZF/Sublime Text
 * Performance: O(n * m * k) where n = items, m = query length, k = name length
 */
export class FuzzySearchStrategy<T extends { name: string }> implements SearchStrategy<T> {
    readonly name = 'fuzzy';
    private threshold: number;
    private ignoreCase: boolean;
    private getSearchableText: (item: T) => string;
    private emptyQueryBehavior: 'all' | 'none';
    private maxTextLength: number;

    constructor(options: FuzzySearchOptions = {}) {
        this.threshold = options.threshold ?? 0.3;
        this.ignoreCase = options.ignoreCase ?? true;
        this.getSearchableText = options.getSearchableText ?? ((item: T) => item.name);
        this.emptyQueryBehavior = options.emptyQueryBehavior ?? 'all';
        this.maxTextLength = options.maxTextLength ?? 10000;
    }

    search(query: string, items: T[]): T[] {
        if (!query) {
            return this.emptyQueryBehavior === 'all' ? items : [];
        }

        const results: Array<{ item: T; score: number }> = [];

        for (const item of items) {
            const score = this.calculateScore(query, this.getSearchableText(item));
            if (score >= this.threshold) {
                results.push({ item, score });
            }
        }

        // Sort by score descending
        results.sort((a, b) => b.score - a.score);

        return results.map(r => r.item);
    }

    matches(query: string, item: T): boolean {
        const score = this.calculateScore(query, this.getSearchableText(item));
        return score >= this.threshold;
    }

    /**
     * Calculate fuzzy match score
     * Returns a value between 0 (no match) and 1 (perfect match)
     */
    private calculateScore(query: string, text: string): number {
        if (!query || !text) {
            return 0;
        }

        // Truncate very long texts for performance
        let processedText = text;
        if (text.length > this.maxTextLength) {
            processedText = text.slice(0, this.maxTextLength);
        }

        const q = this.ignoreCase ? query.toLowerCase() : query;
        const t = this.ignoreCase ? processedText.toLowerCase() : processedText;

        // Check if all characters exist in order
        let qIndex = 0;
        let score = 0;
        let consecutiveBonus = 0;
        let lastMatchIndex = -2;

        for (let i = 0; i < t.length && qIndex < q.length; i++) {
            if (t[i] === q[qIndex]) {
                // Base score for match
                score += 1;

                // Bonus for consecutive matches
                if (i === lastMatchIndex + 1) {
                    consecutiveBonus += 0.5;
                    score += consecutiveBonus;
                } else {
                    consecutiveBonus = 0;
                }

                // Bonus for match at start
                if (i === 0) {
                    score += 1;
                }

                // Bonus for match after separator (_, -, /)
                if (i > 0 && this.isSeparator(t[i - 1])) {
                    score += 0.8;
                }

                // Bonus for camelCase match
                if (i > 0 && this.isUpperCase(processedText[i]) && !this.isUpperCase(processedText[i - 1])) {
                    score += 0.7;
                }

                lastMatchIndex = i;
                qIndex++;
            }
        }

        // All query characters must match
        if (qIndex < q.length) {
            return 0;
        }

        // Normalize score
        const maxScore = q.length * 3; // Max possible score per character
        return score / maxScore;
    }

    private isSeparator(char: string): boolean {
        return char === '_' || char === '-' || char === '/' || char === '.' || char === ' ';
    }

    private isUpperCase(char: string): boolean {
        return char === char.toUpperCase() && char !== char.toLowerCase();
    }
}

/**
 * Regex search strategy
 * Performance: O(n) per search, regex compilation overhead
 */
export class RegexSearchStrategy<T extends { name: string }> implements SearchStrategy<T> {
    readonly name = 'regex';
    private flags: string;

    constructor(flags: string = 'i') {
        this.flags = flags;
    }

    search(query: string, items: T[]): T[] {
        try {
            const regex = new RegExp(query, this.flags);
            return items.filter(item => this.matchesRegex(regex, item));
        } catch {
            // Invalid regex, return empty
            return [];
        }
    }

    matches(query: string, item: T): boolean {
        try {
            const regex = new RegExp(query, this.flags);
            return this.matchesRegex(regex, item);
        } catch {
            return false;
        }
    }

    private matchesRegex(regex: RegExp, item: T): boolean {
        return regex.test(item.name);
    }
}

/**
 * CamelCase/snake_case aware search strategy
 * Matches "UC" to "UserController", "u_c" to "user_controller"
 */
export class CamelCaseSearchStrategy<T extends { name: string }> implements SearchStrategy<T> {
    readonly name = 'camelCase';

    search(query: string, items: T[]): T[] {
        const results: Array<{ item: T; score: number }> = [];

        for (const item of items) {
            const score = this.scoreMatch(query, item.name);
            if (score > 0) {
                results.push({ item, score });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.map(r => r.item);
    }

    matches(query: string, item: T): boolean {
        return this.scoreMatch(query, item.name) > 0;
    }

    private scoreMatch(query: string, name: string): number {
        const q = query.toLowerCase();
        const parts = this.splitIntoParts(name);
        const partAbbreviation = parts.map(p => p[0]?.toLowerCase() || '').join('');

        // Exact abbreviation match (e.g., "uc" matches "UserController")
        if (partAbbreviation === q) {
            return 1;
        }

        // Prefix abbreviation match
        if (partAbbreviation.startsWith(q)) {
            return 0.9;
        }

        // Parts prefix match (e.g., "us" matches "User")
        let matchedParts = 0;
        let qIndex = 0;

        for (const part of parts) {
            const lowerPart = part.toLowerCase();
            let partMatch = 0;

            for (let i = 0; i < lowerPart.length && qIndex < q.length; i++) {
                if (lowerPart[i] === q[qIndex]) {
                    partMatch++;
                    qIndex++;
                } else if (partMatch > 0) {
                    break;
                }
            }

            if (partMatch > 0) {
                matchedParts++;
            }
        }

        if (qIndex === q.length) {
            return 0.5 + (matchedParts / parts.length) * 0.4;
        }

        return 0;
    }

    private splitIntoParts(name: string): string[] {
        // Split by camelCase, PascalCase, snake_case, kebab-case
        return name
            .replace(/([a-z])([A-Z])/g, '$1\0$2')
            .replace(/[_\-]/g, '\0')
            .split('\0')
            .filter(p => p.length > 0);
    }
}

/**
 * Symbol search context that uses a configurable strategy
 */
export class SymbolSearcher<T extends { name: string } = IndexedSymbol> {
    private strategy: SearchStrategy<T>;

    constructor(strategy?: SearchStrategy<T>) {
        this.strategy = strategy || new FuzzySearchStrategy<T>();
    }

    /**
     * Set the search strategy
     */
    setStrategy(strategy: SearchStrategy<T>): void {
        this.strategy = strategy;
    }

    /**
     * Get the current strategy name
     */
    getStrategyName(): string {
        return this.strategy.name;
    }

    /**
     * Search using the current strategy
     */
    search(query: string, items: T[]): T[] {
        return this.strategy.search(query, items);
    }

    /**
     * Check if an item matches using the current strategy
     */
    matches(query: string, item: T): boolean {
        return this.strategy.matches(query, item);
    }

    /**
     * Search with a specific strategy (one-time override)
     */
    searchWith(strategyName: 'exact' | 'prefix' | 'contains' | 'fuzzy' | 'regex' | 'camelCase', query: string, items: T[]): T[] {
        const strategy = this.createStrategy(strategyName);
        return strategy.search(query, items);
    }

    private createStrategy(name: string): SearchStrategy<T> {
        switch (name) {
            case 'exact':
                return new ExactSearchStrategy<T>() as unknown as SearchStrategy<T>;
            case 'prefix':
                return new PrefixSearchStrategy<T>() as unknown as SearchStrategy<T>;
            case 'contains':
                return new ContainsSearchStrategy<T>() as unknown as SearchStrategy<T>;
            case 'fuzzy':
                return new FuzzySearchStrategy<T>() as unknown as SearchStrategy<T>;
            case 'regex':
                return new RegexSearchStrategy<T>() as unknown as SearchStrategy<T>;
            case 'camelCase':
                return new CamelCaseSearchStrategy<T>() as unknown as SearchStrategy<T>;
            default:
                return this.strategy;
        }
    }
}

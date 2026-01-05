import * as vscode from 'vscode';
import { SemanticGraphBuilder } from './semanticGraph';
import { RubySymbol } from '../advancedIndexer';

/**
 * Smart Search Engine with Context-Aware Ranking
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
    }

    /**
     * Add symbols to the search index
     */
    indexSymbols(uri: string, symbols: RubySymbol[]): void {
        this.symbols.set(uri, symbols);

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
     * Search for symbols with smart ranking
     */
    search(query: string, context: SearchContext, limit: number = 50): SearchResult[] {
        const allSymbols = this.getAllSymbols();
        const results: SearchResult[] = [];

        for (const symbol of allSymbols) {
            const score = this.calculateScore(symbol, query, context);

            if (score > 0) {
                const reasons = this.getRankingReasons(symbol, query, context);
                results.push({ symbol, score, reasons });
            }
        }

        // Sort by score descending
        results.sort((a, b) => b.score - a.score);

        // Record access for top results
        results.slice(0, limit).forEach(r => {
            this.recordAccess(r.symbol);
        });

        return results.slice(0, limit);
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
     * Clear the index
     */
    clear(): void {
        this.symbols.clear();
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

/**
 * Shared Module
 *
 * Central export point for all shared data structures, patterns, and indexes.
 * These components provide the foundation for high-performance symbol indexing
 * and manipulation in the RubyMate extension.
 *
 * ## Data Structures
 * - **Trie**: O(k) prefix search for symbol names
 * - **LRUCache**: O(1) caching with automatic eviction
 * - **BloomFilter**: O(1) probabilistic set membership
 *
 * ## Indexes
 * - **SymbolIndex**: Multi-indexed symbol storage for fast lookups
 *
 * ## Design Patterns
 * - **Strategy**: Pluggable search algorithms
 * - **Observer**: Incremental index updates
 * - **Flyweight**: Memory-efficient string pooling
 * - **Factory**: Centralized provider registration
 * - **Command**: Undoable refactoring operations
 *
 * @example
 * ```typescript
 * import {
 *   SymbolIndex,
 *   Trie,
 *   LRUCache,
 *   FuzzySearchStrategy,
 *   IndexManager,
 *   ProviderFactory
 * } from './shared';
 * ```
 */

// Data Structures
export * from './dataStructures';

// Indexes
export * from './indexes';

// Design Patterns
export * from './patterns';

// Utilities
export * from './utilities';

/**
 * Indexes Module
 *
 * Efficient indexing structures for symbol lookups.
 */

export { SymbolIndex, IndexedSymbol, SymbolIndexStats } from './symbolIndex';

// Inheritance Index
export {
    InheritanceIndex,
    InheritanceRelation,
    InheritanceType,
    ClassEntry,
    InheritanceStats,
    SourceLocation
} from './inheritanceIndex';

// Dependency Graph
export {
    DependencyGraph,
    Dependency,
    DependencyType,
    DependencyNode,
    DependencyStats,
    DependencyLocation,
    ResolveOptions
} from './dependencyGraph';

// Call Graph Index
export {
    CallGraphIndex,
    MethodCall,
    MethodReference,
    MethodDefinition,
    CallLocation,
    CallHierarchyItem,
    CallHierarchyIncomingCall,
    CallHierarchyOutgoingCall,
    CallGraphStats
} from './callGraphIndex';

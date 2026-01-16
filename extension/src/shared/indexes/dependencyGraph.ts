/**
 * Dependency Graph Index
 *
 * Track file and gem dependencies based on require statements.
 * Used for understanding load order, finding circular dependencies,
 * and identifying unused files.
 */

import { Graph } from '../dataStructures/graph';

/**
 * Source location for a dependency
 */
export interface DependencyLocation {
    uri: string;
    line: number;
    column: number;
}

/**
 * Type of dependency
 */
export type DependencyType = 'require' | 'require_relative' | 'load' | 'autoload' | 'gem';

/**
 * Dependency between files or gems
 */
export interface Dependency {
    /** Source file path */
    from: string;
    /** Target file or gem name */
    to: string;
    /** Type of require */
    type: DependencyType;
    /** Location in source code */
    location?: DependencyLocation;
    /** Whether the dependency was resolved to an actual file */
    resolved?: boolean;
    /** Resolved absolute path (if different from 'to') */
    resolvedPath?: string;
}

/**
 * Node in the dependency graph
 */
export interface DependencyNode {
    /** File path or gem name */
    path: string;
    /** Whether this is a gem (external dependency) */
    isGem: boolean;
    /** Whether this is an entry point (not required by anything) */
    isEntryPoint: boolean;
    /** Whether this file exists (for internal files) */
    exists?: boolean;
}

/**
 * Dependency graph statistics
 */
export interface DependencyStats {
    fileCount: number;
    gemCount: number;
    dependencyCount: number;
    circularDependencies: string[][];
    entryPoints: string[];
    orphanedFiles: string[];
    mostDepended: Array<{ path: string; count: number }>;
}

/**
 * Options for resolving require paths
 */
export interface ResolveOptions {
    /** Load paths to search (e.g., $LOAD_PATH) */
    loadPaths?: string[];
    /** File extensions to try */
    extensions?: string[];
    /** Known gem paths */
    gemPaths?: Map<string, string>;
}

/**
 * Dependency Graph for tracking Ruby file and gem dependencies
 *
 * @example
 * ```typescript
 * const graph = new DependencyGraph();
 *
 * // Add dependencies from parsing
 * graph.addRequire('/app/models/user.rb', 'active_record');
 * graph.addRequireRelative('/app/models/user.rb', './concerns/authenticatable');
 * graph.addRequire('/app/models/user.rb', 'bcrypt');
 *
 * // Query dependencies
 * const deps = graph.getDependencies('/app/models/user.rb');
 * const dependents = graph.getDependents('/app/models/concerns/authenticatable.rb');
 *
 * // Analyze
 * const cycles = graph.findCircularDependencies();
 * const loadOrder = graph.getLoadOrder();
 * ```
 */
export class DependencyGraph {
    private graph: Graph<DependencyNode, Dependency>;
    private fileDependencies: Map<string, Dependency[]> = new Map();
    private gemDependencies: Set<string> = new Set();
    private resolveOptions: ResolveOptions;

    constructor(options: ResolveOptions = {}) {
        this.graph = new Graph<DependencyNode, Dependency>({ directed: true });
        this.resolveOptions = {
            loadPaths: options.loadPaths ?? [],
            extensions: options.extensions ?? ['.rb', '.so', '.bundle'],
            gemPaths: options.gemPaths ?? new Map()
        };
    }

    /**
     * Add a require dependency
     */
    addRequire(fromFile: string, required: string, location?: DependencyLocation): void {
        const isGem = this.isGemRequire(required);
        const resolvedPath = isGem ? required : this.resolvePath(fromFile, required);

        this.addDependency({
            from: fromFile,
            to: required,
            type: 'require',
            location,
            resolved: resolvedPath !== null,
            resolvedPath: resolvedPath ?? undefined
        });

        if (isGem) {
            this.gemDependencies.add(required);
        }
    }

    /**
     * Add a require_relative dependency
     */
    addRequireRelative(fromFile: string, relativePath: string, location?: DependencyLocation): void {
        const resolvedPath = this.resolveRelativePath(fromFile, relativePath);

        this.addDependency({
            from: fromFile,
            to: relativePath,
            type: 'require_relative',
            location,
            resolved: resolvedPath !== null,
            resolvedPath: resolvedPath ?? undefined
        });
    }

    /**
     * Add a load dependency
     */
    addLoad(fromFile: string, loadPath: string, location?: DependencyLocation): void {
        const resolvedPath = this.resolvePath(fromFile, loadPath);

        this.addDependency({
            from: fromFile,
            to: loadPath,
            type: 'load',
            location,
            resolved: resolvedPath !== null,
            resolvedPath: resolvedPath ?? undefined
        });
    }

    /**
     * Add an autoload dependency
     */
    addAutoload(fromFile: string, constantName: string, loadPath: string, location?: DependencyLocation): void {
        const resolvedPath = this.resolvePath(fromFile, loadPath);

        this.addDependency({
            from: fromFile,
            to: loadPath,
            type: 'autoload',
            location,
            resolved: resolvedPath !== null,
            resolvedPath: resolvedPath ?? undefined
        });
    }

    /**
     * Add a gem dependency (from Gemfile)
     */
    addGemDependency(file: string, gemName: string, location?: DependencyLocation): void {
        this.gemDependencies.add(gemName);

        this.addDependency({
            from: file,
            to: gemName,
            type: 'gem',
            location,
            resolved: true
        });
    }

    /**
     * Get direct dependencies of a file
     */
    getDependencies(file: string): string[] {
        const edges = this.graph.getOutgoingEdges(file);
        return edges.map(e => e.to);
    }

    /**
     * Get files that depend on this file
     */
    getDependents(file: string): string[] {
        const edges = this.graph.getIncomingEdges(file);
        return edges.map(e => e.from);
    }

    /**
     * Get all transitive dependencies
     */
    getTransitiveDependencies(file: string): string[] {
        const visited = new Set<string>();
        const result: string[] = [];

        const traverse = (current: string): void => {
            for (const dep of this.getDependencies(current)) {
                if (!visited.has(dep)) {
                    visited.add(dep);
                    result.push(dep);
                    traverse(dep);
                }
            }
        };

        traverse(file);
        return result;
    }

    /**
     * Get all transitive dependents (files affected by changes to this file)
     */
    getTransitiveDependents(file: string): string[] {
        const visited = new Set<string>();
        const result: string[] = [];

        const traverse = (current: string): void => {
            for (const dep of this.getDependents(current)) {
                if (!visited.has(dep)) {
                    visited.add(dep);
                    result.push(dep);
                    traverse(dep);
                }
            }
        };

        traverse(file);
        return result;
    }

    /**
     * Get dependency details for a file
     */
    getDependencyDetails(file: string): Dependency[] {
        return this.fileDependencies.get(file) ?? [];
    }

    /**
     * Find circular dependencies
     */
    findCircularDependencies(): string[][] {
        return this.graph.detectCycles();
    }

    /**
     * Get the load order (topological sort)
     */
    getLoadOrder(): string[] {
        try {
            return this.graph.topologicalSort();
        } catch {
            // Cycles exist, return best effort order
            return this.getAllFiles();
        }
    }

    /**
     * Get files that are not required by any other file (entry points)
     */
    getEntryPoints(): string[] {
        return this.graph.getRoots().filter(node =>
            !this.gemDependencies.has(node)
        );
    }

    /**
     * Get files that don't require anything (leaf nodes)
     */
    getLeafFiles(): string[] {
        return this.graph.getLeaves().filter(node =>
            !this.gemDependencies.has(node)
        );
    }

    /**
     * Get files that are never required (potentially unused)
     */
    getUnusedFiles(): string[] {
        const entryPoints = new Set(this.getEntryPoints());
        const allFiles = this.getAllFiles();

        // Entry points might be intentionally unrequired (e.g., specs, scripts)
        return allFiles.filter(file =>
            !entryPoints.has(file) && this.getDependents(file).length === 0
        );
    }

    /**
     * Get missing dependencies (required but file doesn't exist)
     */
    getMissingDependencies(): Dependency[] {
        const missing: Dependency[] = [];

        for (const deps of this.fileDependencies.values()) {
            for (const dep of deps) {
                if (!dep.resolved && !this.gemDependencies.has(dep.to)) {
                    missing.push(dep);
                }
            }
        }

        return missing;
    }

    /**
     * Get all gem dependencies
     */
    getGemDependencies(): string[] {
        return Array.from(this.gemDependencies);
    }

    /**
     * Get all files in the graph
     */
    getAllFiles(): string[] {
        const files: string[] = [];
        const nodes = this.graph.getAllNodes();

        for (const { id, data } of nodes) {
            if (!data.isGem) {
                files.push(id);
            }
        }

        return files;
    }

    /**
     * Check if a path exists in the graph
     */
    hasPath(from: string, to: string): boolean {
        const path = this.graph.findPath(from, to);
        return path !== null && path.length > 0;
    }

    /**
     * Get the shortest path between two files
     */
    getPath(from: string, to: string): string[] | null {
        return this.graph.findPath(from, to);
    }

    /**
     * Remove all dependencies from a file (for incremental updates)
     */
    removeFile(uri: string): void {
        // Remove outgoing edges
        const deps = this.fileDependencies.get(uri);
        if (deps) {
            for (const dep of deps) {
                const target = dep.resolvedPath ?? dep.to;
                this.graph.removeEdge(uri, target);
            }
        }

        this.fileDependencies.delete(uri);
        this.graph.removeNode(uri);
    }

    /**
     * Update dependencies for a file
     */
    updateFile(uri: string, dependencies: Dependency[]): void {
        this.removeFile(uri);

        for (const dep of dependencies) {
            this.addDependency(dep);
        }
    }

    /**
     * Get statistics about the dependency graph
     */
    getStats(): DependencyStats {
        const files = this.getAllFiles();
        const dependencyCounts = new Map<string, number>();

        // Count how many times each file is depended on
        for (const file of files) {
            const dependents = this.getDependents(file);
            dependencyCounts.set(file, dependents.length);
        }

        // Get most depended files
        const mostDepended = Array.from(dependencyCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([path, count]) => ({ path, count }));

        return {
            fileCount: files.length,
            gemCount: this.gemDependencies.size,
            dependencyCount: this.graph.edgeCount,
            circularDependencies: this.findCircularDependencies(),
            entryPoints: this.getEntryPoints(),
            orphanedFiles: this.getUnusedFiles(),
            mostDepended
        };
    }

    /**
     * Export to Graphviz DOT format
     */
    toDot(): string {
        return this.graph.toDot();
    }

    /**
     * Clear the graph
     */
    clear(): void {
        this.graph.clear();
        this.fileDependencies.clear();
        this.gemDependencies.clear();
    }

    /**
     * Set load paths for resolution
     */
    setLoadPaths(paths: string[]): void {
        this.resolveOptions.loadPaths = paths;
    }

    /**
     * Add a load path
     */
    addLoadPath(path: string): void {
        this.resolveOptions.loadPaths?.push(path);
    }

    /**
     * Set gem paths for resolution
     */
    setGemPaths(paths: Map<string, string>): void {
        this.resolveOptions.gemPaths = paths;
    }

    // Private methods

    private addDependency(dep: Dependency): void {
        const targetPath = dep.resolvedPath ?? dep.to;
        const isGem = dep.type === 'gem' || this.gemDependencies.has(dep.to);

        // Ensure nodes exist
        if (!this.graph.hasNode(dep.from)) {
            this.graph.addNode(dep.from, {
                path: dep.from,
                isGem: false,
                isEntryPoint: true
            });
        }

        if (!this.graph.hasNode(targetPath)) {
            this.graph.addNode(targetPath, {
                path: targetPath,
                isGem,
                isEntryPoint: false
            });
        } else {
            // Mark as not entry point since it's being required
            const node = this.graph.getNode(targetPath);
            if (node) {
                node.isEntryPoint = false;
            }
        }

        // Add edge
        this.graph.addEdge(dep.from, targetPath, dep);

        // Track file dependencies
        let deps = this.fileDependencies.get(dep.from);
        if (!deps) {
            deps = [];
            this.fileDependencies.set(dep.from, deps);
        }
        deps.push(dep);
    }

    private isGemRequire(required: string): boolean {
        // Check if it's a known gem
        if (this.resolveOptions.gemPaths?.has(required)) {
            return true;
        }

        // Check if it starts with a gem-like path
        const gemPattern = /^[a-z][a-z0-9_-]*$/i;
        return gemPattern.test(required) && !required.includes('/');
    }

    private resolvePath(fromFile: string, required: string): string | null {
        // Try load paths
        for (const loadPath of this.resolveOptions.loadPaths ?? []) {
            for (const ext of this.resolveOptions.extensions ?? ['.rb']) {
                const candidate = `${loadPath}/${required}${ext}`;
                // In a real implementation, we'd check if the file exists
                // For now, just return the candidate path
                return candidate;
            }
        }

        return null;
    }

    private resolveRelativePath(fromFile: string, relativePath: string): string | null {
        // Get directory of source file
        const lastSlash = fromFile.lastIndexOf('/');
        const dir = lastSlash !== -1 ? fromFile.substring(0, lastSlash) : '.';

        // Simple path resolution
        let resolved = relativePath;
        if (relativePath.startsWith('./')) {
            resolved = `${dir}/${relativePath.substring(2)}`;
        } else if (relativePath.startsWith('../')) {
            // Handle parent directory references
            const parts = dir.split('/');
            const relParts = relativePath.split('/');

            for (const part of relParts) {
                if (part === '..') {
                    parts.pop();
                } else if (part !== '.') {
                    parts.push(part);
                }
            }

            resolved = parts.join('/');
        } else {
            resolved = `${dir}/${relativePath}`;
        }

        // Add extension if needed
        if (!resolved.endsWith('.rb')) {
            resolved += '.rb';
        }

        return resolved;
    }
}

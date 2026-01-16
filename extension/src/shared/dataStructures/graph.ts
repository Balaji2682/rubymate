/**
 * Graph Data Structure
 *
 * A flexible directed/undirected graph implementation for:
 * - Dependency tracking
 * - Call graphs
 * - Inheritance trees
 *
 * Supports common graph algorithms like topological sort, cycle detection,
 * and path finding.
 */

/**
 * Options for configuring the graph
 */
export interface GraphOptions {
    /** Whether edges have direction. Default: true */
    directed?: boolean;

    /** Whether to allow cycles. Default: true */
    allowCycles?: boolean;

    /** Whether to allow self-loops (edges from a node to itself). Default: true */
    allowSelfLoops?: boolean;
}

/**
 * Represents an edge between two nodes
 */
export interface Edge<E = unknown> {
    from: string;
    to: string;
    weight?: number;
    data?: E;
}

/**
 * Internal node representation
 */
interface GraphNode<N> {
    id: string;
    data: N;
    outgoing: Set<string>;
    incoming: Set<string>;
}

/**
 * Graph implementation supporting both directed and undirected graphs
 *
 * @typeParam N - Type of data stored in nodes
 * @typeParam E - Type of data stored in edges
 *
 * @example
 * ```typescript
 * const graph = new Graph<FileInfo, DependencyInfo>();
 * graph.addNode('a.rb', { path: 'a.rb' });
 * graph.addNode('b.rb', { path: 'b.rb' });
 * graph.addEdge('a.rb', 'b.rb', { type: 'require' });
 * graph.getOutgoingEdges('a.rb'); // edges from a.rb
 * ```
 */
export class Graph<N, E = unknown> {
    private nodes: Map<string, GraphNode<N>> = new Map();
    private edges: Map<string, Edge<E>> = new Map();
    private readonly directed: boolean;
    private readonly allowCycles: boolean;
    private readonly allowSelfLoops: boolean;

    constructor(options: GraphOptions = {}) {
        this.directed = options.directed ?? true;
        this.allowCycles = options.allowCycles ?? true;
        this.allowSelfLoops = options.allowSelfLoops ?? true;
    }

    // ==================== Node Operations ====================

    /**
     * Add a node to the graph
     * @param id - Unique identifier for the node
     * @param data - Data to associate with the node
     */
    addNode(id: string, data: N): void {
        if (!id) {
            throw new Error('Node ID cannot be empty');
        }

        if (this.nodes.has(id)) {
            // Update existing node data
            const node = this.nodes.get(id)!;
            node.data = data;
        } else {
            this.nodes.set(id, {
                id,
                data,
                outgoing: new Set(),
                incoming: new Set()
            });
        }
    }

    /**
     * Remove a node and all its edges from the graph
     * @param id - ID of the node to remove
     * @returns true if the node was removed, false if it didn't exist
     */
    removeNode(id: string): boolean {
        const node = this.nodes.get(id);
        if (!node) {
            return false;
        }

        // Remove all edges involving this node
        for (const toId of node.outgoing) {
            this.removeEdge(id, toId);
        }
        for (const fromId of node.incoming) {
            this.removeEdge(fromId, id);
        }

        this.nodes.delete(id);
        return true;
    }

    /**
     * Get data associated with a node
     * @param id - ID of the node
     * @returns Node data or undefined if not found
     */
    getNode(id: string): N | undefined {
        return this.nodes.get(id)?.data;
    }

    /**
     * Check if a node exists
     * @param id - ID to check
     */
    hasNode(id: string): boolean {
        return this.nodes.has(id);
    }

    /**
     * Get all node IDs
     */
    getNodeIds(): string[] {
        return Array.from(this.nodes.keys());
    }

    /**
     * Get all nodes with their data
     */
    getAllNodes(): Array<{ id: string; data: N }> {
        return Array.from(this.nodes.values()).map(n => ({
            id: n.id,
            data: n.data
        }));
    }

    // ==================== Edge Operations ====================

    /**
     * Add an edge between two nodes
     * @param from - Source node ID
     * @param to - Target node ID
     * @param data - Optional edge data
     * @param weight - Optional edge weight
     * @throws Error if nodes don't exist, if adding would create a cycle (when cycles not allowed),
     *         or if adding a self-loop (when self-loops not allowed)
     */
    addEdge(from: string, to: string, data?: E, weight?: number): void {
        if (!from || !to) {
            throw new Error('Edge endpoints cannot be empty');
        }

        // Check for self-loops if not allowed
        if (from === to && !this.allowSelfLoops) {
            throw new Error(`Self-loops are not allowed: ${from} -> ${to}`);
        }

        // Auto-create nodes if they don't exist
        if (!this.nodes.has(from)) {
            this.addNode(from, undefined as N);
        }
        if (!this.nodes.has(to)) {
            this.addNode(to, undefined as N);
        }

        // Check for cycles if not allowed (self-loops are always cycles)
        if (!this.allowCycles && from !== to && this.wouldCreateCycle(from, to)) {
            throw new Error(`Adding edge ${from} -> ${to} would create a cycle`);
        }

        const edgeKey = this.getEdgeKey(from, to);
        this.edges.set(edgeKey, { from, to, data, weight });

        const fromNode = this.nodes.get(from)!;
        const toNode = this.nodes.get(to)!;

        fromNode.outgoing.add(to);
        toNode.incoming.add(from);

        // For undirected graphs, add reverse edge
        if (!this.directed) {
            const reverseKey = this.getEdgeKey(to, from);
            if (!this.edges.has(reverseKey)) {
                this.edges.set(reverseKey, { from: to, to: from, data, weight });
                toNode.outgoing.add(from);
                fromNode.incoming.add(to);
            }
        }
    }

    /**
     * Remove an edge between two nodes
     * @param from - Source node ID
     * @param to - Target node ID
     * @returns true if the edge was removed, false if it didn't exist
     */
    removeEdge(from: string, to: string): boolean {
        const edgeKey = this.getEdgeKey(from, to);
        if (!this.edges.has(edgeKey)) {
            return false;
        }

        this.edges.delete(edgeKey);

        const fromNode = this.nodes.get(from);
        const toNode = this.nodes.get(to);

        if (fromNode) {
            fromNode.outgoing.delete(to);
        }
        if (toNode) {
            toNode.incoming.delete(from);
        }

        // For undirected graphs, remove reverse edge
        if (!this.directed) {
            const reverseKey = this.getEdgeKey(to, from);
            this.edges.delete(reverseKey);
            if (toNode) {
                toNode.outgoing.delete(from);
            }
            if (fromNode) {
                fromNode.incoming.delete(to);
            }
        }

        return true;
    }

    /**
     * Get an edge between two nodes
     * @param from - Source node ID
     * @param to - Target node ID
     */
    getEdge(from: string, to: string): Edge<E> | undefined {
        return this.edges.get(this.getEdgeKey(from, to));
    }

    /**
     * Check if an edge exists
     * @param from - Source node ID
     * @param to - Target node ID
     */
    hasEdge(from: string, to: string): boolean {
        return this.edges.has(this.getEdgeKey(from, to));
    }

    // ==================== Traversal ====================

    /**
     * Get all edges going out from a node
     * @param nodeId - Node ID
     */
    getOutgoingEdges(nodeId: string): Edge<E>[] {
        const node = this.nodes.get(nodeId);
        if (!node) {
            return [];
        }

        return Array.from(node.outgoing)
            .map(toId => this.getEdge(nodeId, toId))
            .filter((e): e is Edge<E> => e !== undefined);
    }

    /**
     * Get all edges coming into a node
     * @param nodeId - Node ID
     */
    getIncomingEdges(nodeId: string): Edge<E>[] {
        const node = this.nodes.get(nodeId);
        if (!node) {
            return [];
        }

        return Array.from(node.incoming)
            .map(fromId => this.getEdge(fromId, nodeId))
            .filter((e): e is Edge<E> => e !== undefined);
    }

    /**
     * Get all neighbor node IDs (outgoing for directed, both for undirected)
     * @param nodeId - Node ID
     */
    getNeighbors(nodeId: string): string[] {
        const node = this.nodes.get(nodeId);
        if (!node) {
            return [];
        }

        if (this.directed) {
            return Array.from(node.outgoing);
        } else {
            const neighbors = new Set([...node.outgoing, ...node.incoming]);
            return Array.from(neighbors);
        }
    }

    /**
     * Get all predecessor node IDs (nodes with edges pointing to this node)
     * @param nodeId - Node ID
     */
    getPredecessors(nodeId: string): string[] {
        const node = this.nodes.get(nodeId);
        return node ? Array.from(node.incoming) : [];
    }

    /**
     * Get all successor node IDs (nodes this node points to)
     * @param nodeId - Node ID
     */
    getSuccessors(nodeId: string): string[] {
        const node = this.nodes.get(nodeId);
        return node ? Array.from(node.outgoing) : [];
    }

    // ==================== Graph Algorithms ====================

    /**
     * Perform topological sort (only for directed acyclic graphs)
     * @returns Array of node IDs in topological order
     * @throws Error if the graph contains cycles
     */
    topologicalSort(): string[] {
        if (!this.directed) {
            throw new Error('Topological sort is only applicable to directed graphs');
        }

        const visited = new Set<string>();
        const temp = new Set<string>();
        const result: string[] = [];

        const visit = (nodeId: string): void => {
            if (temp.has(nodeId)) {
                throw new Error(`Graph contains a cycle involving node: ${nodeId}`);
            }
            if (visited.has(nodeId)) {
                return;
            }

            temp.add(nodeId);

            const node = this.nodes.get(nodeId);
            if (node) {
                for (const neighbor of node.outgoing) {
                    visit(neighbor);
                }
            }

            temp.delete(nodeId);
            visited.add(nodeId);
            result.unshift(nodeId);
        };

        for (const nodeId of this.nodes.keys()) {
            if (!visited.has(nodeId)) {
                visit(nodeId);
            }
        }

        return result;
    }

    /**
     * Detect all cycles in the graph
     * @returns Array of cycle paths (each path is an array of node IDs)
     */
    detectCycles(): string[][] {
        const cycles: string[][] = [];
        const visited = new Set<string>();
        const recStack = new Set<string>();
        const path: string[] = [];

        const dfs = (nodeId: string): void => {
            visited.add(nodeId);
            recStack.add(nodeId);
            path.push(nodeId);

            const node = this.nodes.get(nodeId);
            if (node) {
                for (const neighbor of node.outgoing) {
                    if (!visited.has(neighbor)) {
                        dfs(neighbor);
                    } else if (recStack.has(neighbor)) {
                        // Found a cycle
                        const cycleStart = path.indexOf(neighbor);
                        const cycle = [...path.slice(cycleStart), neighbor];
                        cycles.push(cycle);
                    }
                }
            }

            path.pop();
            recStack.delete(nodeId);
        };

        for (const nodeId of this.nodes.keys()) {
            if (!visited.has(nodeId)) {
                dfs(nodeId);
            }
        }

        return cycles;
    }

    /**
     * Check if the graph has any cycles
     */
    hasCycles(): boolean {
        return this.detectCycles().length > 0;
    }

    /**
     * Find a path between two nodes using BFS
     * @param from - Start node ID
     * @param to - End node ID
     * @returns Array of node IDs forming the path, or null if no path exists
     */
    findPath(from: string, to: string): string[] | null {
        if (!this.hasNode(from) || !this.hasNode(to)) {
            return null;
        }

        if (from === to) {
            return [from];
        }

        const queue: string[] = [from];
        const visited = new Set<string>([from]);
        const parent = new Map<string, string>();

        while (queue.length > 0) {
            const current = queue.shift()!;

            const neighbors = this.directed
                ? this.getSuccessors(current)
                : this.getNeighbors(current);

            for (const neighbor of neighbors) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    parent.set(neighbor, current);

                    if (neighbor === to) {
                        // Reconstruct path
                        const path: string[] = [to];
                        let node = to;
                        while (parent.has(node)) {
                            node = parent.get(node)!;
                            path.unshift(node);
                        }
                        return path;
                    }

                    queue.push(neighbor);
                }
            }
        }

        return null;
    }

    /**
     * Get all connected components (for undirected graphs)
     * @returns Array of components, each component is an array of node IDs
     */
    getConnectedComponents(): string[][] {
        const visited = new Set<string>();
        const components: string[][] = [];

        const bfs = (startId: string): string[] => {
            const component: string[] = [];
            const queue: string[] = [startId];
            visited.add(startId);

            while (queue.length > 0) {
                const current = queue.shift()!;
                component.push(current);

                const neighbors = this.getNeighbors(current);
                for (const neighbor of neighbors) {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        queue.push(neighbor);
                    }
                }

                // For directed graphs, also consider incoming edges
                if (this.directed) {
                    const predecessors = this.getPredecessors(current);
                    for (const pred of predecessors) {
                        if (!visited.has(pred)) {
                            visited.add(pred);
                            queue.push(pred);
                        }
                    }
                }
            }

            return component;
        };

        for (const nodeId of this.nodes.keys()) {
            if (!visited.has(nodeId)) {
                components.push(bfs(nodeId));
            }
        }

        return components;
    }

    // ==================== Analysis ====================

    /**
     * Get the in-degree and out-degree of a node
     * @param nodeId - Node ID
     */
    getNodeDegree(nodeId: string): { in: number; out: number } {
        const node = this.nodes.get(nodeId);
        if (!node) {
            return { in: 0, out: 0 };
        }
        return {
            in: node.incoming.size,
            out: node.outgoing.size
        };
    }

    /**
     * Get all root nodes (nodes with no incoming edges)
     */
    getRoots(): string[] {
        return Array.from(this.nodes.values())
            .filter(n => n.incoming.size === 0)
            .map(n => n.id);
    }

    /**
     * Get all leaf nodes (nodes with no outgoing edges)
     */
    getLeaves(): string[] {
        return Array.from(this.nodes.values())
            .filter(n => n.outgoing.size === 0)
            .map(n => n.id);
    }

    /**
     * Get all nodes reachable from a given node
     * @param nodeId - Starting node ID
     */
    getReachable(nodeId: string): string[] {
        const reachable = new Set<string>();
        const queue = [nodeId];

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (reachable.has(current)) continue;
            reachable.add(current);

            for (const neighbor of this.getSuccessors(current)) {
                if (!reachable.has(neighbor)) {
                    queue.push(neighbor);
                }
            }
        }

        reachable.delete(nodeId); // Don't include the starting node
        return Array.from(reachable);
    }

    // ==================== Utility ====================

    /**
     * Get the number of nodes in the graph
     */
    get nodeCount(): number {
        return this.nodes.size;
    }

    /**
     * Get the number of edges in the graph
     */
    get edgeCount(): number {
        return this.edges.size;
    }

    /**
     * Check if the graph is empty
     */
    isEmpty(): boolean {
        return this.nodes.size === 0;
    }

    /**
     * Remove all nodes and edges
     */
    clear(): void {
        this.nodes.clear();
        this.edges.clear();
    }

    /**
     * Create a copy of the graph
     * @param deep - If true, performs deep clone of node and edge data using structuredClone.
     *               If false (default), copies references only.
     */
    clone(deep: boolean = false): Graph<N, E> {
        const copy = new Graph<N, E>({
            directed: this.directed,
            allowCycles: this.allowCycles,
            allowSelfLoops: this.allowSelfLoops
        });

        for (const [id, node] of this.nodes) {
            const nodeData = deep ? this.deepClone(node.data) : node.data;
            copy.addNode(id, nodeData);
        }

        for (const edge of this.edges.values()) {
            const edgeData = deep ? this.deepClone(edge.data) : edge.data;
            copy.addEdge(edge.from, edge.to, edgeData, edge.weight);
        }

        return copy;
    }

    /**
     * Deep clone helper using structuredClone with fallback
     */
    private deepClone<T>(value: T): T {
        if (value === undefined || value === null) {
            return value;
        }
        try {
            // structuredClone is available in modern environments
            return structuredClone(value);
        } catch {
            // Fallback for environments without structuredClone or non-cloneable values
            try {
                return JSON.parse(JSON.stringify(value));
            } catch {
                // If all else fails, return the original reference
                console.warn('Unable to deep clone value, returning reference');
                return value;
            }
        }
    }

    /**
     * Export graph to DOT format for visualization
     */
    toDot(options: { nodeLabel?: (id: string, data: N) => string } = {}): string {
        const graphType = this.directed ? 'digraph' : 'graph';
        const edgeOp = this.directed ? '->' : '--';
        const nodeLabel = options.nodeLabel ?? ((id) => id);

        let dot = `${graphType} G {\n`;

        for (const [id, node] of this.nodes) {
            const label = nodeLabel(id, node.data);
            dot += `  "${id}" [label="${label}"];\n`;
        }

        const processedEdges = new Set<string>();
        for (const edge of this.edges.values()) {
            const key = this.directed
                ? `${edge.from}->${edge.to}`
                : [edge.from, edge.to].sort().join('--');

            if (!processedEdges.has(key)) {
                processedEdges.add(key);
                dot += `  "${edge.from}" ${edgeOp} "${edge.to}"`;
                if (edge.weight !== undefined) {
                    dot += ` [label="${edge.weight}"]`;
                }
                dot += ';\n';
            }
        }

        dot += '}\n';
        return dot;
    }

    private getEdgeKey(from: string, to: string): string {
        return `${from}::${to}`;
    }

    private wouldCreateCycle(from: string, to: string): boolean {
        // Check if there's already a path from 'to' to 'from'
        // If so, adding from->to would create a cycle
        return this.findPath(to, from) !== null;
    }
}

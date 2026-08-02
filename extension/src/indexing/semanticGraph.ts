import * as vscode from 'vscode';
import { Graph } from '../shared/dataStructures/graph';
import { InheritanceIndex, SourceLocation } from '../shared/indexes/inheritanceIndex';

/**
 * Semantic Graph - Understanding relationships between code elements
 *
 * Performance enhancements:
 * - Uses shared Graph data structure for efficient traversal
 * - Uses InheritanceIndex for Ruby-specific class hierarchy tracking
 */

export interface SemanticGraph {
    // Class relationships
    classes: Map<string, ClassInfo>;
    modules: Map<string, ModuleInfo>;

    // Method information
    methods: Map<string, MethodInfo>;

    // Call graph (who calls what)
    callGraph: Map<string, MethodCallEdge[]>;

    // Reference graph (where is symbol used)
    references: Map<string, Reference[]>;

    // File dependencies
    dependencies: Map<string, FileDependency[]>;

    // Rails associations
    associations: Map<string, Association[]>;

    // Type information
    typeInfo: Map<string, TypeInformation>;
}

export interface ClassInfo {
    name: string;
    fullyQualifiedName: string;
    location: vscode.Location;
    superclass?: string;
    mixins: string[];
    subclasses: string[];
    methods: string[]; // Method IDs
    constants: Map<string, any>;
    instanceVariables: string[];
    classVariables: string[];
    isRailsModel: boolean;
    isRailsController: boolean;
    namespace?: string;
}

export interface ModuleInfo {
    name: string;
    fullyQualifiedName: string;
    location: vscode.Location;
    methods: string[];
    includedIn: string[]; // Classes that include this module
    extendedIn: string[]; // Classes that extend this module
}

export interface MethodInfo {
    id: string; // Unique ID: "ClassName#method_name" or "ClassName.class_method"
    name: string;
    className?: string;
    location: vscode.Location;
    parameters: ParameterInfo[];
    visibility: 'public' | 'private' | 'protected';
    isClassMethod: boolean;
    returnType?: string;
    calls: string[]; // IDs of methods this method calls
    calledBy: string[]; // IDs of methods that call this method
    usageCount: number;
}

export interface ParameterInfo {
    name: string;
    type?: string;
    defaultValue?: string;
    keyword: boolean;
    splat: boolean;
    block: boolean;
}

export interface MethodCallEdge {
    caller: string; // Method ID of caller
    callee: string; // Method ID of callee
    location: vscode.Location;
    confidence: number; // 0-1 (Ruby is dynamic!)
    receiverType?: string; // If we can infer the receiver type
}

export interface Reference {
    symbolName: string;
    location: vscode.Location;
    type: ReferenceType;
    context: ReferenceContext;
}

export enum ReferenceType {
    Definition = 'definition',
    Read = 'read',
    Write = 'write',
    Call = 'call',
    Instantiation = 'instantiation'
}

export interface ReferenceContext {
    containingClass?: string;
    containingMethod?: string;
    line: string; // Full line of code for context
}

export interface FileDependency {
    from: vscode.Uri;
    to: string; // File path or gem name
    type: DependencyType;
}

export enum DependencyType {
    Require = 'require',
    RequireRelative = 'require_relative',
    Autoload = 'autoload',
    Include = 'include',
    Extend = 'extend'
}

export interface Association {
    sourceModel: string;
    targetModel: string;
    type: AssociationType;
    name: string; // Association name (e.g., 'posts', 'author')
    location: vscode.Location;
    options: Map<string, any>; // foreign_key, class_name, etc.
}

export enum AssociationType {
    HasMany = 'has_many',
    HasOne = 'has_one',
    BelongsTo = 'belongs_to',
    HasAndBelongsToMany = 'has_and_belongs_to_many',
    HasManyThrough = 'has_many_through'
}

export interface TypeInformation {
    symbol: string;
    inferredType: string;
    confidence: number; // 0-1
    source: TypeSource;
    location: vscode.Location;
}

export enum TypeSource {
    Explicit = 'explicit',      // From type annotation or YARD
    Schema = 'schema',           // From database schema
    Association = 'association', // From ActiveRecord association
    MethodReturn = 'method_return', // From method return analysis
    Inferred = 'inferred',       // From code flow analysis
    DuckTyped = 'duck_typed'     // From usage pattern
}

/**
 * Semantic Graph Builder - Constructs and maintains the semantic graph
 *
 * Performance: Uses shared data structures for efficient lookups and traversals
 */
export class SemanticGraphBuilder {
    private graph: SemanticGraph;
    private outputChannel: vscode.OutputChannel;

    // Performance: Use optimized shared data structures
    private methodCallGraph: Graph<MethodInfo, MethodCallEdge>;
    private inheritanceIndex: InheritanceIndex;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.graph = this.createEmptyGraph();
        // Initialize optimized data structures
        this.methodCallGraph = new Graph<MethodInfo, MethodCallEdge>({ directed: true });
        this.inheritanceIndex = new InheritanceIndex();
    }

    private createEmptyGraph(): SemanticGraph {
        return {
            classes: new Map(),
            modules: new Map(),
            methods: new Map(),
            callGraph: new Map(),
            references: new Map(),
            dependencies: new Map(),
            associations: new Map(),
            typeInfo: new Map()
        };
    }

    /**
     * Get the optimized inheritance index for fast hierarchy lookups
     */
    getInheritanceIndex(): InheritanceIndex {
        return this.inheritanceIndex;
    }

    /**
     * Get the optimized method call graph for traversal
     */
    getMethodCallGraph(): Graph<MethodInfo, MethodCallEdge> {
        return this.methodCallGraph;
    }

    /**
     * Get the semantic graph
     */
    getGraph(): SemanticGraph {
        return this.graph;
    }

    /**
     * Add a class to the graph
     */
    addClass(classInfo: ClassInfo): void {
        this.graph.classes.set(classInfo.fullyQualifiedName, classInfo);

        // Performance: Also populate InheritanceIndex for fast hierarchy lookups
        const location: SourceLocation = {
            uri: classInfo.location.uri.toString(),
            startLine: classInfo.location.range.start.line,
            startColumn: classInfo.location.range.start.character,
            endLine: classInfo.location.range.end.line,
            endColumn: classInfo.location.range.end.character
        };

        // Update superclass's subclasses
        if (classInfo.superclass) {
            const superclass = this.graph.classes.get(classInfo.superclass);
            if (superclass && !superclass.subclasses.includes(classInfo.fullyQualifiedName)) {
                superclass.subclasses.push(classInfo.fullyQualifiedName);
            }
            // Add to optimized inheritance index
            this.inheritanceIndex.addInheritance(classInfo.fullyQualifiedName, classInfo.superclass, location);
        }

        // Update included modules
        for (const mixin of classInfo.mixins) {
            const module = this.graph.modules.get(mixin);
            if (module && !module.includedIn.includes(classInfo.fullyQualifiedName)) {
                module.includedIn.push(classInfo.fullyQualifiedName);
            }
            // Add to optimized inheritance index
            this.inheritanceIndex.addInclude(classInfo.fullyQualifiedName, mixin, location);
        }
    }

    /**
     * Add a module to the graph
     */
    addModule(moduleInfo: ModuleInfo): void {
        this.graph.modules.set(moduleInfo.fullyQualifiedName, moduleInfo);
    }

    /**
     * Add a method to the graph
     */
    addMethod(methodInfo: MethodInfo): void {
        this.graph.methods.set(methodInfo.id, methodInfo);

        // Performance: Add to optimized call graph structure
        if (!this.methodCallGraph.hasNode(methodInfo.id)) {
            this.methodCallGraph.addNode(methodInfo.id, methodInfo);
        }

        // Add to class's method list
        if (methodInfo.className) {
            const classInfo = this.graph.classes.get(methodInfo.className);
            if (classInfo && !classInfo.methods.includes(methodInfo.id)) {
                classInfo.methods.push(methodInfo.id);
            }
        }
    }

    /**
     * Add a method call edge to the call graph
     */
    addMethodCall(edge: MethodCallEdge): void {
        // Add to call graph
        const existing = this.graph.callGraph.get(edge.caller) || [];
        existing.push(edge);
        this.graph.callGraph.set(edge.caller, existing);

        // Performance: Add to optimized Graph structure for fast traversal
        // Ensure nodes exist
        if (!this.methodCallGraph.hasNode(edge.caller)) {
            this.methodCallGraph.addNode(edge.caller, this.graph.methods.get(edge.caller)!);
        }
        if (!this.methodCallGraph.hasNode(edge.callee)) {
            const calleeMethod = this.graph.methods.get(edge.callee);
            if (calleeMethod) {
                this.methodCallGraph.addNode(edge.callee, calleeMethod);
            }
        }
        // Add edge to optimized graph
        this.methodCallGraph.addEdge(edge.caller, edge.callee, edge);

        // Update caller's calls list
        const caller = this.graph.methods.get(edge.caller);
        if (caller && !caller.calls.includes(edge.callee)) {
            caller.calls.push(edge.callee);
        }

        // Update callee's calledBy list
        const callee = this.graph.methods.get(edge.callee);
        if (callee && !callee.calledBy.includes(edge.caller)) {
            callee.calledBy.push(edge.caller);
            callee.usageCount++;
        }
    }

    /**
     * Add a reference to a symbol
     */
    addReference(reference: Reference): void {
        const existing = this.graph.references.get(reference.symbolName) || [];
        existing.push(reference);
        this.graph.references.set(reference.symbolName, existing);
    }

    /**
     * Add a file dependency
     */
    addDependency(dependency: FileDependency): void {
        const key = dependency.from.toString();
        const existing = this.graph.dependencies.get(key) || [];
        existing.push(dependency);
        this.graph.dependencies.set(key, existing);
    }

    /**
     * Add an ActiveRecord association
     */
    addAssociation(association: Association): void {
        const existing = this.graph.associations.get(association.sourceModel) || [];
        existing.push(association);
        this.graph.associations.set(association.sourceModel, existing);
    }

    /**
     * Add type information
     */
    addTypeInfo(typeInfo: TypeInformation): void {
        const key = `${typeInfo.location.uri.toString()}:${typeInfo.symbol}`;

        // Only update if confidence is higher or source is more reliable
        const existing = this.graph.typeInfo.get(key);
        if (!existing || this.isMoreReliable(typeInfo, existing)) {
            this.graph.typeInfo.set(key, typeInfo);
        }
    }

    /**
     * Remove semantic data sourced from a single file before re-indexing it.
     */
    removeFile(uri: vscode.Uri | string): void {
        const uriString = typeof uri === 'string' ? uri : uri.toString();
        const locationMatches = (location: vscode.Location): boolean => location.uri.toString() === uriString;
        const removedMethods = new Set<string>();

        for (const [name, classInfo] of Array.from(this.graph.classes.entries())) {
            if (locationMatches(classInfo.location)) {
                this.graph.classes.delete(name);
            }
        }

        for (const [name, moduleInfo] of Array.from(this.graph.modules.entries())) {
            if (locationMatches(moduleInfo.location)) {
                this.graph.modules.delete(name);
            }
        }

        for (const [id, methodInfo] of Array.from(this.graph.methods.entries())) {
            if (locationMatches(methodInfo.location)) {
                this.graph.methods.delete(id);
                removedMethods.add(id);
                this.methodCallGraph.removeNode(id);
            }
        }

        for (const [caller, edges] of Array.from(this.graph.callGraph.entries())) {
            const remaining = edges.filter(edge =>
                !removedMethods.has(edge.caller) &&
                !removedMethods.has(edge.callee) &&
                !locationMatches(edge.location)
            );

            if (remaining.length > 0) {
                this.graph.callGraph.set(caller, remaining);
            } else {
                this.graph.callGraph.delete(caller);
            }
        }

        for (const [symbolName, references] of Array.from(this.graph.references.entries())) {
            const remaining = references.filter(reference => !locationMatches(reference.location));
            if (remaining.length > 0) {
                this.graph.references.set(symbolName, remaining);
            } else {
                this.graph.references.delete(symbolName);
            }
        }

        this.graph.dependencies.delete(uriString);

        for (const [sourceModel, associations] of Array.from(this.graph.associations.entries())) {
            const remaining = associations.filter(association => !locationMatches(association.location));
            if (remaining.length > 0) {
                this.graph.associations.set(sourceModel, remaining);
            } else {
                this.graph.associations.delete(sourceModel);
            }
        }

        for (const [key, info] of Array.from(this.graph.typeInfo.entries())) {
            if (locationMatches(info.location)) {
                this.graph.typeInfo.delete(key);
            }
        }

        this.inheritanceIndex.removeFileRelations(uriString);
    }

    /**
     * Check if new type info is more reliable than existing
     */
    private isMoreReliable(newInfo: TypeInformation, existing: TypeInformation): boolean {
        const sourceOrder = [
            TypeSource.Explicit,
            TypeSource.Schema,
            TypeSource.Association,
            TypeSource.MethodReturn,
            TypeSource.Inferred,
            TypeSource.DuckTyped
        ];

        const newSourceIndex = sourceOrder.indexOf(newInfo.source);
        const existingSourceIndex = sourceOrder.indexOf(existing.source);

        if (newSourceIndex < existingSourceIndex) return true;
        if (newSourceIndex > existingSourceIndex) return false;

        // Same source, use confidence
        return newInfo.confidence > existing.confidence;
    }

    /**
     * Get all subclasses of a class (recursive)
     * Performance: Uses InheritanceIndex for O(1) lookup of direct subclasses
     */
    getAllSubclasses(className: string): string[] {
        // Performance: Use optimized InheritanceIndex
        return this.inheritanceIndex.getDescendants(className);
    }

    /**
     * Get full inheritance chain for a class
     * Performance: Uses InheritanceIndex for efficient ancestor traversal
     */
    getInheritanceChain(className: string): string[] {
        // Performance: Use optimized InheritanceIndex
        const ancestors = this.inheritanceIndex.getAncestors(className);
        return [className, ...ancestors];
    }

    /**
     * Get all methods available to a class (including inherited and mixed-in)
     * Performance: Uses InheritanceIndex MRO for correct method resolution order
     */
    getAllAvailableMethods(className: string): MethodInfo[] {
        const methods: MethodInfo[] = [];
        const seen = new Set<string>();

        // Performance: Use InheritanceIndex for proper Ruby MRO
        const mro = this.inheritanceIndex.getMethodResolutionOrder(className);

        for (const classOrModule of mro) {
            const classInfo = this.graph.classes.get(classOrModule);
            const moduleInfo = this.graph.modules.get(classOrModule);

            const methodIds = classInfo?.methods || moduleInfo?.methods || [];

            for (const methodId of methodIds) {
                const method = this.graph.methods.get(methodId);
                if (method && !seen.has(method.name)) {
                    methods.push(method);
                    seen.add(method.name);
                }
            }
        }

        return methods;
    }

    /**
     * Get call hierarchy for a method (who calls this method)
     * Performance: Uses optimized Graph structure for fast traversal
     */
    getCallHierarchy(methodId: string, visited: Set<string> = new Set()): MethodCallEdge[] {
        if (visited.has(methodId)) return [];
        visited.add(methodId);

        // Performance: Use optimized Graph for incoming edges lookup
        const incomingEdges = this.methodCallGraph.getIncomingEdges(methodId);
        const calls: MethodCallEdge[] = [];

        for (const edge of incomingEdges) {
            if (edge.data) {
                calls.push(edge.data);
                // Recursively get callers of caller
                calls.push(...this.getCallHierarchy(edge.from, visited));
            }
        }

        return calls;
    }

    /**
     * Find unused methods (dead code)
     */
    findUnusedMethods(): MethodInfo[] {
        const unused: MethodInfo[] = [];

        for (const [id, method] of this.graph.methods) {
            // Skip public methods (might be called externally)
            if (method.visibility === 'public') continue;

            // Skip Rails controller actions
            if (method.className?.includes('Controller')) continue;

            // Check if method is never called
            if (method.calledBy.length === 0 && method.usageCount === 0) {
                unused.push(method);
            }
        }

        return unused;
    }

    /**
     * Find unused classes (dead code)
     */
    findUnusedClasses(): ClassInfo[] {
        const unused: ClassInfo[] = [];

        for (const [name, classInfo] of this.graph.classes) {
            // Skip Rails models and controllers
            if (classInfo.isRailsModel || classInfo.isRailsController) continue;

            // Check if class is instantiated or referenced
            const references = this.graph.references.get(name) || [];
            const hasInstantiation = references.some(r =>
                r.type === ReferenceType.Instantiation ||
                r.type === ReferenceType.Call
            );

            // Check if any methods are called
            const hasMethodCalls = classInfo.methods.some(methodId => {
                const method = this.graph.methods.get(methodId);
                return method && method.calledBy.length > 0;
            });

            if (!hasInstantiation && !hasMethodCalls && classInfo.subclasses.length === 0) {
                unused.push(classInfo);
            }
        }

        return unused;
    }

    /**
     * Get Rails component mapping (Model → Controller → Views)
     */
    getRailsComponents(modelName: string): {
        model?: vscode.Location;
        controller?: vscode.Location;
        views: vscode.Location[];
        specs: vscode.Location[];
    } {
        const result = {
            model: undefined as vscode.Location | undefined,
            controller: undefined as vscode.Location | undefined,
            views: [] as vscode.Location[],
            specs: [] as vscode.Location[]
        };

        // Find model
        const modelClass = this.graph.classes.get(modelName);
        if (modelClass) {
            result.model = modelClass.location;
        }

        // Find controller (e.g., User → UsersController)
        const controllerName = `${modelName}sController`;
        const controller = this.graph.classes.get(controllerName);
        if (controller) {
            result.controller = controller.location;
        }

        // Views and specs would need file system search
        // (implemented in separate provider)

        return result;
    }

    /**
     * Clear the graph
     */
    clear(): void {
        this.graph = this.createEmptyGraph();
        // Clear optimized data structures
        this.methodCallGraph.clear();
        this.inheritanceIndex.clear();
    }

    /**
     * Get statistics
     */
    getStats(): {
        classes: number;
        modules: number;
        methods: number;
        callEdges: number;
        references: number;
    } {
        let callEdges = 0;
        for (const edges of this.graph.callGraph.values()) {
            callEdges += edges.length;
        }

        let references = 0;
        for (const refs of this.graph.references.values()) {
            references += refs.length;
        }

        return {
            classes: this.graph.classes.size,
            modules: this.graph.modules.size,
            methods: this.graph.methods.size,
            callEdges,
            references
        };
    }
}

import * as vscode from 'vscode';

/**
 * Semantic Graph - Understanding relationships between code elements
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
 */
export class SemanticGraphBuilder {
    private graph: SemanticGraph;
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.graph = this.createEmptyGraph();
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

        // Update superclass's subclasses
        if (classInfo.superclass) {
            const superclass = this.graph.classes.get(classInfo.superclass);
            if (superclass && !superclass.subclasses.includes(classInfo.fullyQualifiedName)) {
                superclass.subclasses.push(classInfo.fullyQualifiedName);
            }
        }

        // Update included modules
        for (const mixin of classInfo.mixins) {
            const module = this.graph.modules.get(mixin);
            if (module && !module.includedIn.includes(classInfo.fullyQualifiedName)) {
                module.includedIn.push(classInfo.fullyQualifiedName);
            }
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
     */
    getAllSubclasses(className: string): string[] {
        const result: string[] = [];
        const classInfo = this.graph.classes.get(className);

        if (!classInfo) return result;

        for (const subclass of classInfo.subclasses) {
            result.push(subclass);
            result.push(...this.getAllSubclasses(subclass));
        }

        return result;
    }

    /**
     * Get full inheritance chain for a class
     */
    getInheritanceChain(className: string): string[] {
        const chain: string[] = [className];
        let currentClass = this.graph.classes.get(className);

        while (currentClass?.superclass) {
            chain.push(currentClass.superclass);
            currentClass = this.graph.classes.get(currentClass.superclass);
        }

        return chain;
    }

    /**
     * Get all methods available to a class (including inherited and mixed-in)
     */
    getAllAvailableMethods(className: string): MethodInfo[] {
        const methods: MethodInfo[] = [];
        const classInfo = this.graph.classes.get(className);

        if (!classInfo) return methods;

        // Get own methods
        for (const methodId of classInfo.methods) {
            const method = this.graph.methods.get(methodId);
            if (method) methods.push(method);
        }

        // Get inherited methods
        if (classInfo.superclass) {
            methods.push(...this.getAllAvailableMethods(classInfo.superclass));
        }

        // Get methods from included modules
        for (const mixin of classInfo.mixins) {
            const module = this.graph.modules.get(mixin);
            if (module) {
                for (const methodId of module.methods) {
                    const method = this.graph.methods.get(methodId);
                    if (method) methods.push(method);
                }
            }
        }

        return methods;
    }

    /**
     * Get call hierarchy for a method (who calls this method)
     */
    getCallHierarchy(methodId: string, visited: Set<string> = new Set()): MethodCallEdge[] {
        if (visited.has(methodId)) return [];
        visited.add(methodId);

        const method = this.graph.methods.get(methodId);
        if (!method) return [];

        const calls: MethodCallEdge[] = [];

        // Find all edges where this method is the callee
        for (const [caller, edges] of this.graph.callGraph) {
            for (const edge of edges) {
                if (edge.callee === methodId) {
                    calls.push(edge);
                    // Recursively get callers of caller
                    calls.push(...this.getCallHierarchy(caller, visited));
                }
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

/**
 * Visitor Pattern for AST Traversal
 *
 * Generic visitor pattern implementation for traversing Ruby AST nodes.
 * Used for code analysis, symbol collection, and code transformations.
 */

/**
 * Position in source code
 */
export interface SourcePosition {
    row: number;
    column: number;
}

/**
 * Generic AST node interface
 */
export interface ASTNode {
    type: string;
    text?: string;
    startPosition: SourcePosition;
    endPosition: SourcePosition;
    children?: ASTNode[];
    parent?: ASTNode;
}

/**
 * Ruby-specific AST node with additional metadata
 */
export interface RubyNode extends ASTNode {
    /** Named children for quick access (e.g., 'name', 'body') */
    namedChildren?: Map<string, RubyNode>;
    /** Whether this is a named node (vs anonymous syntax) */
    isNamed?: boolean;
    /** Field name if this is a field child */
    fieldName?: string;
}

/**
 * Visitor interface for type-safe visitation
 */
export interface Visitor<T extends ASTNode, R = void> {
    visit(node: T): R;
}

/**
 * Traversal order options
 */
export type TraversalOrder = 'preorder' | 'postorder';

/**
 * Options for AST traversal
 */
export interface TraversalOptions {
    /** Traversal order. Default: 'preorder' */
    order?: TraversalOrder;
    /** Skip nodes matching this predicate */
    skip?: (node: ASTNode) => boolean;
    /** Maximum depth to traverse. Default: Infinity */
    maxDepth?: number;
}

/**
 * Base visitor class with optional visit methods for each node type
 *
 * @typeParam T - The AST node type
 * @typeParam R - The return type of visit methods
 *
 * @example
 * ```typescript
 * class MethodCollector extends BaseVisitor<RubyNode, void> {
 *   methods: string[] = [];
 *
 *   protected visitMethod(node: RubyNode): void {
 *     const name = node.namedChildren?.get('name');
 *     if (name?.text) {
 *       this.methods.push(name.text);
 *     }
 *   }
 * }
 *
 * const collector = new MethodCollector();
 * collector.visit(rootNode);
 * console.log(collector.methods);
 * ```
 */
export abstract class BaseVisitor<T extends ASTNode, R = void> implements Visitor<T, R> {
    protected readonly options: TraversalOptions;
    private depth: number = 0;

    constructor(options: TraversalOptions = {}) {
        this.options = {
            order: 'preorder',
            maxDepth: Infinity,
            ...options
        };
    }

    /**
     * Visit a node and its children
     */
    visit(node: T): R {
        if (this.options.skip?.(node)) {
            return this.defaultResult();
        }

        if (this.depth >= (this.options.maxDepth ?? Infinity)) {
            return this.defaultResult();
        }

        this.depth++;

        let result: R;

        if (this.options.order === 'preorder') {
            result = this.dispatchVisit(node);
            this.visitChildren(node);
        } else {
            this.visitChildren(node);
            result = this.dispatchVisit(node);
        }

        this.depth--;
        return result;
    }

    /**
     * Visit all children of a node
     */
    protected visitChildren(node: T): void {
        if (node.children) {
            for (const child of node.children) {
                this.visit(child as T);
            }
        }
    }

    /**
     * Dispatch to type-specific visit method
     */
    protected dispatchVisit(node: T): R {
        // Convert node type to method name (e.g., 'method_definition' -> 'visitMethodDefinition')
        const methodName = this.getVisitMethodName(node.type);
        const method = (this as Record<string, unknown>)[methodName];

        if (typeof method === 'function') {
            return method.call(this, node);
        }

        return this.visitDefault(node);
    }

    /**
     * Convert node type to visit method name
     */
    protected getVisitMethodName(nodeType: string): string {
        // Convert snake_case to camelCase and prefix with 'visit'
        const camelCase = nodeType
            .split('_')
            .map((part, index) =>
                index === 0
                    ? part.charAt(0).toUpperCase() + part.slice(1)
                    : part.charAt(0).toUpperCase() + part.slice(1)
            )
            .join('');

        return `visit${camelCase}`;
    }

    /**
     * Default visit method when no specific handler exists
     */
    protected visitDefault(_node: T): R {
        return this.defaultResult();
    }

    /**
     * Default result value
     */
    protected abstract defaultResult(): R;
}

/**
 * Visitor that collects results from all nodes
 */
export abstract class CollectorVisitor<T extends ASTNode, C> extends BaseVisitor<T, C[]> {
    protected results: C[] = [];

    /**
     * Get collected results
     */
    getResults(): C[] {
        return [...this.results];
    }

    /**
     * Clear collected results
     */
    clear(): void {
        this.results = [];
    }

    protected defaultResult(): C[] {
        return this.results;
    }

    /**
     * Add a result to the collection
     */
    protected collect(item: C): void {
        this.results.push(item);
    }
}

/**
 * Ruby AST Visitor with common Ruby node type handlers
 */
export abstract class RubyASTVisitor extends BaseVisitor<RubyNode, void> {
    protected defaultResult(): void {
        return undefined;
    }

    // Ruby-specific visit methods (override as needed)

    /** Visit a class definition */
    protected visitClass?(node: RubyNode): void;

    /** Visit a module definition */
    protected visitModule?(node: RubyNode): void;

    /** Visit a method definition */
    protected visitMethod?(node: RubyNode): void;

    /** Visit a singleton method (def self.method) */
    protected visitSingletonMethod?(node: RubyNode): void;

    /** Visit a method call */
    protected visitCall?(node: RubyNode): void;

    /** Visit a block ({ } or do...end) */
    protected visitBlock?(node: RubyNode): void;

    /** Visit an assignment */
    protected visitAssignment?(node: RubyNode): void;

    /** Visit a constant reference */
    protected visitConstant?(node: RubyNode): void;

    /** Visit a string literal */
    protected visitString?(node: RubyNode): void;

    /** Visit a symbol */
    protected visitSymbol?(node: RubyNode): void;

    /** Visit an instance variable */
    protected visitInstanceVariable?(node: RubyNode): void;

    /** Visit a class variable */
    protected visitClassVariable?(node: RubyNode): void;

    /** Visit a global variable */
    protected visitGlobalVariable?(node: RubyNode): void;

    /** Visit a local variable */
    protected visitIdentifier?(node: RubyNode): void;

    /** Visit a hash literal */
    protected visitHash?(node: RubyNode): void;

    /** Visit an array literal */
    protected visitArray?(node: RubyNode): void;

    /** Visit an if/unless statement */
    protected visitIf?(node: RubyNode): void;

    /** Visit a case/when statement */
    protected visitCase?(node: RubyNode): void;

    /** Visit a begin/rescue block */
    protected visitBegin?(node: RubyNode): void;

    /** Visit a lambda/proc */
    protected visitLambda?(node: RubyNode): void;
}

/**
 * Symbol information collected from AST
 */
export interface CollectedSymbol {
    name: string;
    kind: 'class' | 'module' | 'method' | 'constant' | 'variable';
    containerName?: string;
    startPosition: SourcePosition;
    endPosition: SourcePosition;
    documentation?: string;
}

/**
 * Visitor that collects symbols from Ruby AST
 */
export class SymbolCollectorVisitor extends CollectorVisitor<RubyNode, CollectedSymbol> {
    private containerStack: string[] = [];

    protected get currentContainer(): string | undefined {
        return this.containerStack.length > 0
            ? this.containerStack.join('::')
            : undefined;
    }

    protected visitClass(node: RubyNode): void {
        const name = this.getNodeName(node);
        if (name) {
            this.collect({
                name,
                kind: 'class',
                containerName: this.currentContainer,
                startPosition: node.startPosition,
                endPosition: node.endPosition
            });

            this.containerStack.push(name);
            this.visitChildren(node);
            this.containerStack.pop();
        }
    }

    protected visitModule(node: RubyNode): void {
        const name = this.getNodeName(node);
        if (name) {
            this.collect({
                name,
                kind: 'module',
                containerName: this.currentContainer,
                startPosition: node.startPosition,
                endPosition: node.endPosition
            });

            this.containerStack.push(name);
            this.visitChildren(node);
            this.containerStack.pop();
        }
    }

    protected visitMethod(node: RubyNode): void {
        const name = this.getNodeName(node);
        if (name) {
            this.collect({
                name,
                kind: 'method',
                containerName: this.currentContainer,
                startPosition: node.startPosition,
                endPosition: node.endPosition
            });
        }
    }

    protected visitConstant(node: RubyNode): void {
        const name = node.text;
        if (name) {
            this.collect({
                name,
                kind: 'constant',
                containerName: this.currentContainer,
                startPosition: node.startPosition,
                endPosition: node.endPosition
            });
        }
    }

    private getNodeName(node: RubyNode): string | undefined {
        // Try to get name from named children
        const nameNode = node.namedChildren?.get('name');
        if (nameNode?.text) {
            return nameNode.text;
        }

        // Try to find name child in children array
        if (node.children) {
            for (const child of node.children) {
                if (child.type === 'constant' || child.type === 'identifier') {
                    return child.text;
                }
            }
        }

        return undefined;
    }
}

/**
 * Method call information
 */
export interface CollectedMethodCall {
    methodName: string;
    receiver?: string;
    arguments?: string[];
    position: SourcePosition;
}

/**
 * Visitor that collects method calls from Ruby AST
 */
export class MethodCallCollectorVisitor extends CollectorVisitor<RubyNode, CollectedMethodCall> {
    protected visitCall(node: RubyNode): void {
        const methodName = this.getMethodName(node);
        if (methodName) {
            this.collect({
                methodName,
                receiver: this.getReceiver(node),
                arguments: this.getArguments(node),
                position: node.startPosition
            });
        }
    }

    private getMethodName(node: RubyNode): string | undefined {
        const methodNode = node.namedChildren?.get('method');
        return methodNode?.text;
    }

    private getReceiver(node: RubyNode): string | undefined {
        const receiverNode = node.namedChildren?.get('receiver');
        return receiverNode?.text;
    }

    private getArguments(node: RubyNode): string[] | undefined {
        const argsNode = node.namedChildren?.get('arguments');
        if (!argsNode?.children) {
            return undefined;
        }
        return argsNode.children
            .filter(child => child.text)
            .map(child => child.text!);
    }
}

/**
 * Dependency information (require/require_relative)
 */
export interface CollectedDependency {
    type: 'require' | 'require_relative' | 'load' | 'autoload';
    path: string;
    position: SourcePosition;
}

/**
 * Visitor that collects dependencies from Ruby AST
 */
export class DependencyCollectorVisitor extends CollectorVisitor<RubyNode, CollectedDependency> {
    protected visitCall(node: RubyNode): void {
        const methodName = this.getMethodName(node);

        if (methodName === 'require' || methodName === 'require_relative' || methodName === 'load') {
            const path = this.getFirstArgument(node);
            if (path) {
                this.collect({
                    type: methodName as 'require' | 'require_relative' | 'load',
                    path: this.cleanPath(path),
                    position: node.startPosition
                });
            }
        } else if (methodName === 'autoload') {
            const path = this.getSecondArgument(node);
            if (path) {
                this.collect({
                    type: 'autoload',
                    path: this.cleanPath(path),
                    position: node.startPosition
                });
            }
        }
    }

    private getMethodName(node: RubyNode): string | undefined {
        const methodNode = node.namedChildren?.get('method');
        return methodNode?.text;
    }

    private getFirstArgument(node: RubyNode): string | undefined {
        const argsNode = node.namedChildren?.get('arguments');
        if (!argsNode?.children || argsNode.children.length === 0) {
            return undefined;
        }
        return argsNode.children[0].text;
    }

    private getSecondArgument(node: RubyNode): string | undefined {
        const argsNode = node.namedChildren?.get('arguments');
        if (!argsNode?.children || argsNode.children.length < 2) {
            return undefined;
        }
        return argsNode.children[1].text;
    }

    private cleanPath(path: string): string {
        // Remove quotes from string literals
        return path.replace(/^['"]|['"]$/g, '');
    }
}

/**
 * Traverse an AST and apply a callback to each node
 */
export function traverseAST<T extends ASTNode>(
    node: T,
    callback: (node: T, depth: number) => boolean | void,
    options: TraversalOptions = {}
): void {
    const { order = 'preorder', skip, maxDepth = Infinity } = options;

    function traverse(current: T, depth: number): void {
        if (depth > maxDepth) {
            return;
        }

        if (skip?.(current)) {
            return;
        }

        if (order === 'preorder') {
            const shouldStop = callback(current, depth);
            if (shouldStop === true) {
                return;
            }
        }

        if (current.children) {
            for (const child of current.children) {
                traverse(child as T, depth + 1);
            }
        }

        if (order === 'postorder') {
            callback(current, depth);
        }
    }

    traverse(node, 0);
}

/**
 * Find all nodes matching a predicate
 */
export function findNodes<T extends ASTNode>(
    root: T,
    predicate: (node: T) => boolean,
    options: TraversalOptions = {}
): T[] {
    const results: T[] = [];

    traverseAST(root, (node) => {
        if (predicate(node)) {
            results.push(node);
        }
    }, options);

    return results;
}

/**
 * Find the first node matching a predicate
 */
export function findNode<T extends ASTNode>(
    root: T,
    predicate: (node: T) => boolean,
    options: TraversalOptions = {}
): T | undefined {
    let result: T | undefined;

    traverseAST(root, (node) => {
        if (predicate(node)) {
            result = node;
            return true; // Stop traversal
        }
    }, options);

    return result;
}

/**
 * Find the deepest node containing a position
 */
export function findNodeAtPosition<T extends ASTNode>(
    root: T,
    position: SourcePosition
): T | undefined {
    let result: T | undefined;

    traverseAST(root, (node) => {
        if (containsPosition(node, position)) {
            result = node;
        }
    });

    return result;
}

/**
 * Check if a node contains a position
 */
function containsPosition(node: ASTNode, position: SourcePosition): boolean {
    const { startPosition, endPosition } = node;

    // Before start
    if (position.row < startPosition.row) {
        return false;
    }
    if (position.row === startPosition.row && position.column < startPosition.column) {
        return false;
    }

    // After end
    if (position.row > endPosition.row) {
        return false;
    }
    if (position.row === endPosition.row && position.column > endPosition.column) {
        return false;
    }

    return true;
}

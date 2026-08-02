import * as vscode from 'vscode';
import type * as TreeSitter from 'web-tree-sitter';
import {
    ASTNode,
    ClassNode,
    MethodCall,
    MethodNode,
    NodeType,
    Parameter,
    ReturnValue
} from '../indexing/rubyParser';

export interface RubyReferenceLocation {
    name: string;
    range: vscode.Range;
    kind: 'definition' | 'read' | 'call' | 'symbol' | 'write';
}

interface RubyScope {
    namespace: string[];
    className?: string;
    visibility: 'public' | 'private' | 'protected';
}

interface PositionOffset {
    line: number;
    character: number;
}

const ASSOCIATION_METHODS = new Set([
    'has_many',
    'has_one',
    'belongs_to',
    'has_and_belongs_to_many'
]);

const VALIDATION_METHODS = new Set([
    'validates',
    'validates_presence_of',
    'validates_uniqueness_of',
    'validates_length_of',
    'validates_format_of',
    'validates_inclusion_of',
    'validates_exclusion_of',
    'validate'
]);

const VISIBILITY_METHODS = new Set(['public', 'private', 'protected']);
const MIXIN_METHODS = new Set(['include', 'extend', 'prepend']);
const ATTR_METHODS = new Set(['attr_accessor', 'attr_reader', 'attr_writer']);
const CALLBACK_METHODS = new Set([
    'before_action',
    'after_action',
    'around_action',
    'before_save',
    'after_save',
    'before_create',
    'after_create',
    'before_update',
    'after_update',
    'before_destroy',
    'after_destroy',
    'around_save',
    'around_create',
    'around_update',
    'around_destroy',
    'before_validation',
    'after_validation',
    'after_initialize',
    'after_find',
    'after_touch',
    'after_commit',
    'after_rollback',
    'before_enqueue',
    'after_enqueue',
    'around_enqueue',
    'before_perform',
    'after_perform',
    'around_perform'
]);

const RUBY_KEYWORDS = new Set([
    'if', 'unless', 'while', 'until', 'for', 'case', 'when',
    'begin', 'rescue', 'ensure', 'return', 'yield', 'break',
    'next', 'redo', 'retry', 'raise', 'and', 'or', 'not',
    'true', 'false', 'nil', 'self', 'super', '__FILE__', '__LINE__'
]);

export class RubyTreeSitterParser {
    parse(tree: TreeSitter.Tree, offset: PositionOffset = { line: 0, character: 0 }): ASTNode[] {
        const nodes: ASTNode[] = [];
        const scope: RubyScope = { namespace: [], visibility: 'public' };

        for (const child of tree.rootNode.namedChildren) {
            nodes.push(...this.convertStatement(child, scope, offset));
        }

        return nodes;
    }

    collectReferenceLocations(tree: TreeSitter.Tree, symbolName: string): RubyReferenceLocation[] {
        const references: RubyReferenceLocation[] = [];
        const visit = (node: TreeSitter.Node): void => {
            if (this.isReferenceNode(node, symbolName)) {
                references.push({
                    name: symbolName,
                    range: this.rangeFromNode(node),
                    kind: this.referenceKind(node)
                });
            }

            for (const child of node.namedChildren) {
                visit(child);
            }
        };

        visit(tree.rootNode);
        return this.dedupeReferences(references);
    }

    private convertStatement(
        node: TreeSitter.Node,
        scope: RubyScope,
        offset: PositionOffset
    ): ASTNode[] {
        switch (node.type) {
            case 'class':
                return [this.parseClass(node, scope, offset)];
            case 'module':
                return [this.parseModule(node, scope, offset)];
            case 'method':
            case 'singleton_method':
                return [this.parseMethod(node, scope, offset)];
            case 'call':
                return this.parseTopLevelCall(node, offset);
            case 'assignment':
                return this.parseAssignment(node, offset);
            case 'comment':
                return [this.node(NodeType.Comment, node.text.trim(), node, offset)];
            default: {
                const nodes: ASTNode[] = [];
                for (const child of node.namedChildren) {
                    nodes.push(...this.convertStatement(child, scope, offset));
                }
                return nodes;
            }
        }
    }

    private parseClass(node: TreeSitter.Node, scope: RubyScope, offset: PositionOffset): ClassNode {
        const rawName = this.nameText(node.childForFieldName('name')) || 'AnonymousClass';
        const qualifiedName = this.qualify(rawName, scope.namespace);
        const superclass = this.superclassText(node.childForFieldName('superclass'));
        const classNode: ClassNode = {
            type: NodeType.Class,
            name: qualifiedName,
            range: this.rangeFromNode(node, offset),
            children: [],
            metadata: new Map([
                ['rawName', rawName],
                ['containerName', scope.namespace.join('::') || undefined],
                ['parser', 'tree-sitter']
            ]),
            superclass,
            mixins: [],
            methods: []
        };

        const classScope: RubyScope = {
            namespace: [...scope.namespace, rawName],
            className: qualifiedName,
            visibility: 'public'
        };

        for (const child of this.bodyChildren(node)) {
            if (child.type === 'method' || child.type === 'singleton_method') {
                classNode.methods.push(this.parseMethod(child, classScope, offset));
                continue;
            }

            if (child.type === 'call') {
                const callName = this.callMethodName(child);
                if (callName && VISIBILITY_METHODS.has(callName) && this.callArguments(child).length === 0) {
                    classScope.visibility = callName as 'public' | 'private' | 'protected';
                    continue;
                }

                this.applyClassDslCall(classNode, child, offset);
                classNode.children.push(...this.convertNestedBlockStatements(child, classScope, offset));
                continue;
            }

            if (child.type === 'class' || child.type === 'module') {
                classNode.children.push(...this.convertStatement(child, classScope, offset));
                continue;
            }

            if (child.type === 'assignment' || child.type === 'comment') {
                classNode.children.push(...this.convertStatement(child, classScope, offset));
            }
        }

        return classNode;
    }

    private parseModule(node: TreeSitter.Node, scope: RubyScope, offset: PositionOffset): ASTNode {
        const rawName = this.nameText(node.childForFieldName('name')) || 'AnonymousModule';
        const qualifiedName = this.qualify(rawName, scope.namespace);
        const moduleNode = this.node(NodeType.Module, qualifiedName, node, offset, new Map([
            ['rawName', rawName],
            ['containerName', scope.namespace.join('::') || undefined],
            ['parser', 'tree-sitter']
        ]));

        const moduleScope: RubyScope = {
            namespace: [...scope.namespace, rawName],
            visibility: 'public'
        };

        for (const child of this.bodyChildren(node)) {
            if (child.type === 'call') {
                const callName = this.callMethodName(child);
                if (callName && VISIBILITY_METHODS.has(callName) && this.callArguments(child).length === 0) {
                    moduleScope.visibility = callName as 'public' | 'private' | 'protected';
                    continue;
                }
            }

            moduleNode.children.push(...this.convertStatement(child, moduleScope, offset));
            if (child.type === 'call') {
                moduleNode.children.push(...this.convertNestedBlockStatements(child, moduleScope, offset));
            }
        }

        return moduleNode;
    }

    private parseMethod(node: TreeSitter.Node, scope: RubyScope, offset: PositionOffset): MethodNode {
        const nameNode = node.childForFieldName('name');
        const objectNode = node.childForFieldName('object');
        const name = this.nameText(nameNode) || 'anonymous_method';
        const body = node.childForFieldName('body');

        const methodNode: MethodNode = {
            type: NodeType.Method,
            name,
            range: this.rangeFromNode(node, offset),
            children: [],
            metadata: new Map([
                ['containerName', scope.className || scope.namespace.join('::') || undefined],
                ['parser', 'tree-sitter']
            ]),
            parameters: this.parseParameters(node.childForFieldName('parameters')),
            visibility: scope.visibility,
            isClassMethod: node.type === 'singleton_method' && objectNode?.text.trim() === 'self',
            calls: body ? this.collectMethodCalls(body, offset) : [],
            returns: body ? this.collectReturnValues(body, offset) : []
        };

        return methodNode;
    }

    private parseTopLevelCall(node: TreeSitter.Node, offset: PositionOffset): ASTNode[] {
        const methodName = this.callMethodName(node);
        if (!methodName) {
            return [];
        }

        if (methodName === 'require' || methodName === 'require_relative') {
            const path = this.cleanArgumentText(this.callArguments(node)[0]);
            return [this.node(NodeType.Require, path, node, offset, new Map<string, any>([
                ['path', path],
                ['relative', methodName === 'require_relative']
            ]))];
        }

        return [];
    }

    private parseAssignment(node: TreeSitter.Node, offset: PositionOffset): ASTNode[] {
        const left = node.childForFieldName('left');
        if (!left || left.type !== 'constant') {
            return [];
        }

        return [this.node(NodeType.Constant, left.text.trim(), left, offset)];
    }

    private applyClassDslCall(classNode: ClassNode, node: TreeSitter.Node, offset: PositionOffset): void {
        const methodName = this.callMethodName(node);
        if (!methodName) {
            return;
        }

        const args = this.callArguments(node);
        const firstArg = this.cleanArgumentText(args[0]);

        if (MIXIN_METHODS.has(methodName) && firstArg) {
            classNode.mixins.push(firstArg);
            return;
        }

        if (ASSOCIATION_METHODS.has(methodName) && firstArg) {
            classNode.children.push(this.node(NodeType.Association, firstArg, node, offset, new Map([
                ['associationType', methodName],
                ['definitionConfidence', 'metaprogramming']
            ])));
            return;
        }

        if (VALIDATION_METHODS.has(methodName) && firstArg) {
            classNode.children.push(this.node(NodeType.Validation, firstArg, node, offset, new Map([
                ['validationType', methodName]
            ])));
            return;
        }

        if (methodName === 'scope' && firstArg) {
            classNode.children.push(this.node(NodeType.Scope, firstArg, node, offset, new Map([
                ['definitionConfidence', 'metaprogramming']
            ])));
            return;
        }

        if (methodName === 'delegate') {
            for (const arg of args) {
                const generatedName = this.cleanArgumentText(arg);
                if (/^[a-z_][a-z0-9_]*[?!=]?$/.test(generatedName)) {
                    classNode.children.push(this.node(NodeType.GeneratedMethod, generatedName, node, offset, new Map([
                        ['generatedBy', 'delegate'],
                        ['definitionConfidence', 'metaprogramming']
                    ])));
                }
            }
            return;
        }

        if (methodName === 'alias_method' && args.length >= 2) {
            const aliasName = this.cleanArgumentText(args[0]);
            if (aliasName) {
                classNode.children.push(this.node(NodeType.GeneratedMethod, aliasName, node, offset, new Map([
                    ['generatedBy', 'alias_method'],
                    ['aliasedFrom', this.cleanArgumentText(args[1])],
                    ['definitionConfidence', 'metaprogramming']
                ])));
            }
            return;
        }

        if (CALLBACK_METHODS.has(methodName) && firstArg) {
            classNode.children.push(this.node(NodeType.Callback, firstArg, node, offset, new Map([
                ['callbackType', methodName],
                ['definitionConfidence', 'metaprogramming']
            ])));
            return;
        }

        if (ATTR_METHODS.has(methodName)) {
            for (const arg of args) {
                const attrName = this.cleanArgumentText(arg);
                if (attrName) {
                    classNode.children.push(this.node(NodeType.Variable, attrName, node, offset, new Map([
                        ['attrType', methodName.replace('attr_', '')],
                        ['definitionConfidence', 'metaprogramming']
                    ])));
                }
            }
        }
    }

    private convertNestedBlockStatements(
        node: TreeSitter.Node,
        scope: RubyScope,
        offset: PositionOffset
    ): ASTNode[] {
        const nodes: ASTNode[] = [];
        const visit = (child: TreeSitter.Node): void => {
            if (child.equals(node)) {
                for (const nested of child.namedChildren) {
                    visit(nested);
                }
                return;
            }

            if (child.type === 'method' || child.type === 'singleton_method' || child.type === 'class' || child.type === 'module' || child.type === 'assignment') {
                nodes.push(...this.convertStatement(child, scope, offset));
                return;
            }

            for (const nested of child.namedChildren) {
                visit(nested);
            }
        };

        visit(node);
        return nodes;
    }

    private collectMethodCalls(node: TreeSitter.Node, offset: PositionOffset): MethodCall[] {
        const calls: MethodCall[] = [];
        const visit = (child: TreeSitter.Node): void => {
            if (child.type === 'call') {
                const method = this.callMethodName(child);
                const methodNode = child.childForFieldName('method');
                if (method && methodNode && !RUBY_KEYWORDS.has(method)) {
                    calls.push({
                        receiver: this.callReceiver(child),
                        method,
                        arguments: this.callArguments(child).map(arg => arg.trim()),
                        location: this.positionFromPoint(methodNode.startPosition, offset)
                    });
                }
            }

            for (const grandchild of child.namedChildren) {
                visit(grandchild);
            }
        };

        visit(node);
        return calls;
    }

    private collectReturnValues(node: TreeSitter.Node, offset: PositionOffset): ReturnValue[] {
        const returns: ReturnValue[] = [];
        const visit = (child: TreeSitter.Node): void => {
            if (child.type === 'return') {
                returns.push({
                    value: child.text.replace(/^return\b/, '').trim(),
                    location: this.positionFromPoint(child.startPosition, offset)
                });
            }

            for (const grandchild of child.namedChildren) {
                visit(grandchild);
            }
        };

        visit(node);
        return returns;
    }

    private parseParameters(parametersNode: TreeSitter.Node | null): Parameter[] {
        if (!parametersNode) {
            return [];
        }

        const params: Parameter[] = [];
        for (const child of parametersNode.namedChildren) {
            const parameter = this.parseParameter(child);
            if (parameter) {
                params.push(parameter);
            }
        }

        return params;
    }

    private parseParameter(node: TreeSitter.Node): Parameter | undefined {
        if (node.type === 'identifier') {
            return { name: node.text, keyword: false, splat: false, block: false };
        }

        const text = node.text.trim();
        const nameNode = node.childForFieldName('name')
            || node.descendantsOfType('identifier')[0]
            || node.firstNamedChild;
        const name = nameNode?.text.replace(/^[*&]+/, '').replace(/:$/, '');
        if (!name) {
            return undefined;
        }

        return {
            name,
            keyword: node.type.includes('keyword') || text.includes(':'),
            splat: text.startsWith('*') || text.startsWith('**') || node.type.includes('splat'),
            block: text.startsWith('&') || node.type.includes('block'),
            defaultValue: node.childForFieldName('value')?.text
        };
    }

    private bodyChildren(node: TreeSitter.Node): TreeSitter.Node[] {
        const body = node.childForFieldName('body');
        return body ? body.namedChildren : [];
    }

    private callMethodName(node: TreeSitter.Node): string | undefined {
        return this.nameText(node.childForFieldName('method'));
    }

    private callReceiver(node: TreeSitter.Node): string | undefined {
        const receiver = node.childForFieldName('receiver');
        return receiver?.text.trim();
    }

    private callArguments(node: TreeSitter.Node): string[] {
        const args = node.childForFieldName('arguments');
        if (!args) {
            return [];
        }

        return args.namedChildren.map(child => child.text);
    }

    private cleanArgumentText(arg: string | undefined): string {
        if (!arg) {
            return '';
        }

        return arg
            .trim()
            .replace(/^:/, '')
            .replace(/:$/, '')
            .replace(/^['"]|['"]$/g, '');
    }

    private superclassText(node: TreeSitter.Node | null): string | undefined {
        if (!node) {
            return undefined;
        }

        return (node.firstNamedChild?.text || node.text).trim();
    }

    private nameText(node: TreeSitter.Node | null): string | undefined {
        return node?.text.trim();
    }

    private qualify(rawName: string, namespace: string[]): string {
        if (rawName.includes('::') || namespace.length === 0) {
            return rawName;
        }

        return [...namespace, rawName].join('::');
    }

    private node(
        type: NodeType,
        name: string,
        sourceNode: TreeSitter.Node,
        offset: PositionOffset,
        metadata: Map<string, any> = new Map()
    ): ASTNode {
        return {
            type,
            name,
            range: this.rangeFromNode(sourceNode, offset),
            children: [],
            metadata
        };
    }

    private rangeFromNode(
        node: TreeSitter.Node,
        offset: PositionOffset = { line: 0, character: 0 }
    ): vscode.Range {
        return new vscode.Range(
            this.positionFromPoint(node.startPosition, offset),
            this.positionFromPoint(node.endPosition, offset)
        );
    }

    private positionFromPoint(point: TreeSitter.Point, offset: PositionOffset): vscode.Position {
        return new vscode.Position(
            offset.line + point.row,
            point.row === 0 ? offset.character + point.column : point.column
        );
    }

    private isReferenceNode(node: TreeSitter.Node, symbolName: string): boolean {
        if (![
            'identifier',
            'constant',
            'instance_variable',
            'class_variable',
            'global_variable',
            'simple_symbol',
            'hash_key_symbol'
        ].includes(node.type)) {
            return false;
        }

        return this.cleanArgumentText(node.text) === symbolName;
    }

    private referenceKind(node: TreeSitter.Node): RubyReferenceLocation['kind'] {
        const parent = node.parent;
        if (!parent) {
            return 'read';
        }

        if (parent.type === 'method' || parent.type === 'singleton_method' || parent.type === 'class' || parent.type === 'module') {
            return 'definition';
        }

        if (parent.type === 'call' && parent.childForFieldName('method')?.equals(node)) {
            return 'call';
        }

        if (node.type === 'simple_symbol' || node.type === 'hash_key_symbol') {
            return 'symbol';
        }

        if (parent.type === 'assignment' && parent.childForFieldName('left')?.equals(node)) {
            return 'write';
        }

        return 'read';
    }

    private dedupeReferences(references: RubyReferenceLocation[]): RubyReferenceLocation[] {
        const seen = new Set<string>();
        return references.filter(ref => {
            const key = `${ref.range.start.line}:${ref.range.start.character}:${ref.range.end.line}:${ref.range.end.character}`;
            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
    }
}

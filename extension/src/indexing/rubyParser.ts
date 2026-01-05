import * as vscode from 'vscode';

/**
 * Lightweight Ruby AST parser for semantic analysis
 * Extracts classes, methods, calls, references without full Ruby parser
 */

export interface ASTNode {
    type: NodeType;
    name: string;
    range: vscode.Range;
    children: ASTNode[];
    metadata: Map<string, any>;
}

export enum NodeType {
    Class = 'class',
    Module = 'module',
    Method = 'method',
    MethodCall = 'method_call',
    Variable = 'variable',
    Constant = 'constant',
    Symbol = 'symbol',
    String = 'string',
    Comment = 'comment',
    Require = 'require',
    Include = 'include',
    Extend = 'extend',
    Association = 'association',
    Validation = 'validation',
    Scope = 'scope'
}

export interface ClassNode extends ASTNode {
    type: NodeType.Class;
    superclass?: string;
    mixins: string[];
    methods: MethodNode[];
}

export interface MethodNode extends ASTNode {
    type: NodeType.Method;
    parameters: Parameter[];
    visibility: 'public' | 'private' | 'protected';
    isClassMethod: boolean;
    calls: MethodCall[];
    returns: ReturnValue[];
}

export interface MethodCall {
    receiver?: string;
    method: string;
    arguments: string[];
    location: vscode.Position;
}

export interface Parameter {
    name: string;
    type?: string;
    defaultValue?: string;
    keyword: boolean;
    splat: boolean;
    block: boolean;
}

export interface ReturnValue {
    value: string;
    type?: string;
    location: vscode.Position;
}

export class RubyParser {
    private document: vscode.TextDocument;
    private lines: string[];

    constructor(document: vscode.TextDocument) {
        this.document = document;
        this.lines = document.getText().split('\n');
    }

    /**
     * Parse the entire document into AST
     */
    parse(): ASTNode[] {
        const nodes: ASTNode[] = [];
        let currentClass: ClassNode | null = null;
        let currentMethod: MethodNode | null = null;
        let indentStack: number[] = [0];

        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i];
            const trimmed = line.trim();
            const indent = line.search(/\S/);

            // Skip empty lines and comments (but extract comment nodes)
            if (trimmed === '') continue;
            if (trimmed.startsWith('#')) {
                nodes.push(this.parseComment(line, i));
                continue;
            }

            // Handle end statements (pop context)
            if (trimmed === 'end') {
                if (currentMethod) {
                    currentMethod = null;
                } else if (currentClass) {
                    currentClass = null;
                }
                indentStack.pop();
                continue;
            }

            // Parse class definitions
            const classMatch = trimmed.match(/^class\s+([A-Z]\w*(?:::[A-Z]\w*)*)\s*(?:<\s*([A-Z]\w*(?:::[A-Z]\w*)*))?/);
            if (classMatch) {
                currentClass = this.parseClass(line, i, classMatch[1], classMatch[2]);
                nodes.push(currentClass);
                indentStack.push(indent);
                continue;
            }

            // Parse module definitions
            const moduleMatch = trimmed.match(/^module\s+([A-Z]\w*(?:::[A-Z]\w*)*)/);
            if (moduleMatch) {
                const moduleNode = this.parseModule(line, i, moduleMatch[1]);
                nodes.push(moduleNode);
                indentStack.push(indent);
                continue;
            }

            // Parse method definitions
            const methodMatch = trimmed.match(/^def\s+(self\.)?([a-z_]\w*[?!]?)/);
            if (methodMatch) {
                currentMethod = this.parseMethod(line, i, methodMatch[2], !!methodMatch[1]);
                if (currentClass) {
                    currentClass.methods.push(currentMethod);
                } else {
                    nodes.push(currentMethod);
                }
                indentStack.push(indent);
                continue;
            }

            // Parse method calls (if we're inside a method)
            if (currentMethod) {
                const calls = this.parseMethodCalls(line, i);
                currentMethod.calls.push(...calls);
            }

            // Parse ActiveRecord associations
            const associationMatch = trimmed.match(/^(has_many|has_one|belongs_to|has_and_belongs_to_many)\s+:(\w+)/);
            if (associationMatch && currentClass) {
                const assocNode = this.parseAssociation(line, i, associationMatch[1], associationMatch[2]);
                currentClass.children.push(assocNode);
            }

            // Parse includes/extends
            const includeMatch = trimmed.match(/^(include|extend|prepend)\s+([A-Z]\w*(?:::[A-Z]\w*)*)/);
            if (includeMatch && currentClass) {
                currentClass.mixins.push(includeMatch[2]);
            }

            // Parse requires
            const requireMatch = trimmed.match(/^require(?:_relative)?\s+['"](.*)['"]/);
            if (requireMatch) {
                nodes.push(this.parseRequire(line, i, requireMatch[1]));
            }
        }

        return nodes;
    }

    /**
     * Parse class definition
     */
    private parseClass(line: string, lineNumber: number, name: string, superclass?: string): ClassNode {
        const range = new vscode.Range(
            new vscode.Position(lineNumber, 0),
            new vscode.Position(lineNumber, line.length)
        );

        return {
            type: NodeType.Class,
            name,
            range,
            children: [],
            metadata: new Map(),
            superclass,
            mixins: [],
            methods: []
        };
    }

    /**
     * Parse module definition
     */
    private parseModule(line: string, lineNumber: number, name: string): ASTNode {
        const range = new vscode.Range(
            new vscode.Position(lineNumber, 0),
            new vscode.Position(lineNumber, line.length)
        );

        return {
            type: NodeType.Module,
            name,
            range,
            children: [],
            metadata: new Map()
        };
    }

    /**
     * Parse method definition
     */
    private parseMethod(line: string, lineNumber: number, name: string, isClassMethod: boolean): MethodNode {
        const range = new vscode.Range(
            new vscode.Position(lineNumber, 0),
            new vscode.Position(lineNumber, line.length)
        );

        // Extract parameters
        const paramsMatch = line.match(/def\s+(?:self\.)?[a-z_]\w*[?!]?\s*\((.*?)\)/);
        const parameters = paramsMatch ? this.parseParameters(paramsMatch[1]) : [];

        return {
            type: NodeType.Method,
            name,
            range,
            children: [],
            metadata: new Map(),
            parameters,
            visibility: 'public',
            isClassMethod,
            calls: [],
            returns: []
        };
    }

    /**
     * Parse method parameters
     */
    private parseParameters(paramsString: string): Parameter[] {
        if (!paramsString || paramsString.trim() === '') return [];

        const params: Parameter[] = [];
        const parts = paramsString.split(',').map(p => p.trim());

        for (const part of parts) {
            let name = part;
            let defaultValue: string | undefined;
            let keyword = false;
            let splat = false;
            let block = false;

            // Block parameter (&block)
            if (part.startsWith('&')) {
                name = part.substring(1);
                block = true;
            }
            // Splat parameter (*args)
            else if (part.startsWith('**')) {
                name = part.substring(2);
                splat = true;
                keyword = true;
            } else if (part.startsWith('*')) {
                name = part.substring(1);
                splat = true;
            }
            // Keyword parameter (key:)
            else if (part.includes(':')) {
                const [key, value] = part.split(':').map(s => s.trim());
                name = key;
                defaultValue = value || undefined;
                keyword = true;
            }
            // Default parameter (param = value)
            else if (part.includes('=')) {
                const [key, value] = part.split('=').map(s => s.trim());
                name = key;
                defaultValue = value;
            }

            params.push({
                name,
                keyword,
                splat,
                block,
                defaultValue
            });
        }

        return params;
    }

    /**
     * Parse method calls from a line
     */
    private parseMethodCalls(line: string, lineNumber: number): MethodCall[] {
        const calls: MethodCall[] = [];
        const trimmed = line.trim();

        // Match method calls: receiver.method(args) or method(args)
        const callPattern = /([a-z_]\w*)?\.?([a-z_]\w*[?!]?)\s*(?:\(([^)]*)\))?/g;
        let match;

        while ((match = callPattern.exec(trimmed)) !== null) {
            const receiver = match[1];
            const method = match[2];
            const argsString = match[3] || '';

            // Skip keywords and common non-method tokens
            if (this.isKeyword(method)) continue;

            calls.push({
                receiver,
                method,
                arguments: argsString ? argsString.split(',').map(a => a.trim()) : [],
                location: new vscode.Position(lineNumber, match.index)
            });
        }

        return calls;
    }

    /**
     * Parse ActiveRecord association
     */
    private parseAssociation(line: string, lineNumber: number, type: string, name: string): ASTNode {
        const range = new vscode.Range(
            new vscode.Position(lineNumber, 0),
            new vscode.Position(lineNumber, line.length)
        );

        const metadata = new Map();
        metadata.set('associationType', type);

        return {
            type: NodeType.Association,
            name,
            range,
            children: [],
            metadata
        };
    }

    /**
     * Parse require statement
     */
    private parseRequire(line: string, lineNumber: number, path: string): ASTNode {
        const range = new vscode.Range(
            new vscode.Position(lineNumber, 0),
            new vscode.Position(lineNumber, line.length)
        );

        const metadata = new Map();
        metadata.set('path', path);

        return {
            type: NodeType.Require,
            name: path,
            range,
            children: [],
            metadata
        };
    }

    /**
     * Parse comment
     */
    private parseComment(line: string, lineNumber: number): ASTNode {
        const range = new vscode.Range(
            new vscode.Position(lineNumber, 0),
            new vscode.Position(lineNumber, line.length)
        );

        return {
            type: NodeType.Comment,
            name: line.trim(),
            range,
            children: [],
            metadata: new Map()
        };
    }

    /**
     * Check if word is a Ruby keyword
     */
    private isKeyword(word: string): boolean {
        const keywords = [
            'if', 'unless', 'while', 'until', 'for', 'case', 'when',
            'begin', 'rescue', 'ensure', 'return', 'yield', 'break',
            'next', 'redo', 'retry', 'raise', 'and', 'or', 'not',
            'true', 'false', 'nil', 'self', 'super', '__FILE__', '__LINE__'
        ];
        return keywords.includes(word);
    }

    /**
     * Find all method calls to a specific method name
     */
    findMethodCalls(methodName: string): MethodCall[] {
        const calls: MethodCall[] = [];
        const ast = this.parse();

        const traverse = (node: ASTNode) => {
            if (node.type === NodeType.Method) {
                const methodNode = node as MethodNode;
                calls.push(...methodNode.calls.filter(c => c.method === methodName));
            }
            node.children.forEach(traverse);
        };

        ast.forEach(traverse);
        return calls;
    }

    /**
     * Find all classes in document
     */
    findClasses(): ClassNode[] {
        const classes: ClassNode[] = [];
        const ast = this.parse();

        const traverse = (node: ASTNode) => {
            if (node.type === NodeType.Class) {
                classes.push(node as ClassNode);
            }
            node.children.forEach(traverse);
        };

        ast.forEach(traverse);
        return classes;
    }

    /**
     * Get class hierarchy (superclass chain)
     */
    getClassHierarchy(className: string): string[] {
        const classes = this.findClasses();
        const hierarchy: string[] = [className];

        let currentClass = classes.find(c => c.name === className);
        while (currentClass?.superclass) {
            hierarchy.push(currentClass.superclass);
            currentClass = classes.find(c => c.name === currentClass!.superclass);
        }

        return hierarchy;
    }
}

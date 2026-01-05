import * as vscode from 'vscode';
import { SemanticGraphBuilder, Reference, ReferenceType, ReferenceContext } from './semanticGraph';
import { RubyParser, MethodCall } from './rubyParser';

/**
 * Reference Tracker - Find all usages of symbols across codebase
 */

export interface ReferenceInfo {
    symbol: string;
    references: Reference[];
    definitions: Reference[];
    reads: Reference[];
    writes: Reference[];
    calls: Reference[];
}

export interface DeadCodeAnalysis {
    unusedClasses: DeadCodeItem[];
    unusedMethods: DeadCodeItem[];
    unusedConstants: DeadCodeItem[];
    totalItems: number;
    confidence: 'high' | 'medium' | 'low';
}

export interface DeadCodeItem {
    name: string;
    location: vscode.Location;
    reason: string;
    confidence: number;
    suggestions: string[];
}

export class ReferenceTracker {
    private graphBuilder: SemanticGraphBuilder;
    private outputChannel: vscode.OutputChannel;

    constructor(graphBuilder: SemanticGraphBuilder, outputChannel: vscode.OutputChannel) {
        this.graphBuilder = graphBuilder;
        this.outputChannel = outputChannel;
    }

    /**
     * Find all references to a symbol
     */
    findReferences(symbolName: string, includeDefinition: boolean = true): ReferenceInfo {
        const graph = this.graphBuilder.getGraph();
        const allReferences = graph.references.get(symbolName) || [];

        const info: ReferenceInfo = {
            symbol: symbolName,
            references: allReferences,
            definitions: [],
            reads: [],
            writes: [],
            calls: []
        };

        // Categorize references by type
        for (const ref of allReferences) {
            switch (ref.type) {
                case ReferenceType.Definition:
                    info.definitions.push(ref);
                    break;
                case ReferenceType.Read:
                    info.reads.push(ref);
                    break;
                case ReferenceType.Write:
                    info.writes.push(ref);
                    break;
                case ReferenceType.Call:
                    info.calls.push(ref);
                    break;
            }
        }

        return info;
    }

    /**
     * Find all references to a method
     */
    findMethodReferences(className: string, methodName: string): Reference[] {
        const methodId = `${className}#${methodName}`;
        const graph = this.graphBuilder.getGraph();

        const references: Reference[] = [];

        // Find in call graph
        const callEdges = graph.callGraph.get(methodId);
        if (callEdges) {
            for (const edge of callEdges) {
                references.push({
                    symbolName: methodName,
                    location: edge.location,
                    type: ReferenceType.Call,
                    context: {
                        line: '', // Would need to read file
                        containingClass: className,
                        containingMethod: methodName
                    }
                });
            }
        }

        return references;
    }

    /**
     * Track references in a document
     */
    async trackReferencesInDocument(document: vscode.TextDocument): Promise<void> {
        const parser = new RubyParser(document);
        const ast = parser.parse();

        for (const node of ast) {
            await this.extractReferences(node, document);
        }
    }

    /**
     * Extract references from AST node
     */
    private async extractReferences(node: any, document: vscode.TextDocument): Promise<void> {
        // Extract class/module references
        if (node.type === 'class' || node.type === 'module') {
            const ref: Reference = {
                symbolName: node.name,
                location: new vscode.Location(document.uri, node.range),
                type: ReferenceType.Definition,
                context: {
                    line: document.lineAt(node.range.start.line).text,
                    containingClass: node.name
                }
            };
            this.graphBuilder.addReference(ref);

            // Extract superclass reference
            if (node.superclass) {
                const superRef: Reference = {
                    symbolName: node.superclass,
                    location: new vscode.Location(document.uri, node.range),
                    type: ReferenceType.Read,
                    context: {
                        line: document.lineAt(node.range.start.line).text,
                        containingClass: node.name
                    }
                };
                this.graphBuilder.addReference(superRef);
            }
        }

        // Extract method references
        if (node.type === 'method') {
            const ref: Reference = {
                symbolName: node.name,
                location: new vscode.Location(document.uri, node.range),
                type: ReferenceType.Definition,
                context: {
                    line: document.lineAt(node.range.start.line).text,
                    containingMethod: node.name
                }
            };
            this.graphBuilder.addReference(ref);

            // Extract method calls within the method
            if (node.calls) {
                for (const call of node.calls) {
                    const callRef: Reference = {
                        symbolName: call.method,
                        location: new vscode.Location(
                            document.uri,
                            new vscode.Position(call.location.line, call.location.character)
                        ),
                        type: ReferenceType.Call,
                        context: {
                            line: document.lineAt(call.location.line).text,
                            containingMethod: node.name
                        }
                    };
                    this.graphBuilder.addReference(callRef);
                }
            }
        }

        // Recursively process children
        if (node.children) {
            for (const child of node.children) {
                await this.extractReferences(child, document);
            }
        }
    }

    /**
     * Check if a symbol is safe to delete
     */
    isSafeToDelete(symbolName: string): {
        safe: boolean;
        reason: string;
        references: Reference[];
    } {
        const refInfo = this.findReferences(symbolName, false);

        // Exclude definition from count
        const usageCount = refInfo.reads.length + refInfo.writes.length + refInfo.calls.length;

        if (usageCount === 0) {
            return {
                safe: true,
                reason: 'No references found',
                references: []
            };
        }

        return {
            safe: false,
            reason: `Found ${usageCount} reference(s)`,
            references: refInfo.references
        };
    }

    /**
     * Detect dead code in the entire project
     */
    detectDeadCode(): DeadCodeAnalysis {
        const unusedClasses = this.findUnusedClasses();
        const unusedMethods = this.findUnusedMethods();
        const unusedConstants = this.findUnusedConstants();

        return {
            unusedClasses,
            unusedMethods,
            unusedConstants,
            totalItems: unusedClasses.length + unusedMethods.length + unusedConstants.length,
            confidence: this.calculateConfidence(unusedClasses, unusedMethods, unusedConstants)
        };
    }

    /**
     * Find unused classes
     */
    private findUnusedClasses(): DeadCodeItem[] {
        const graph = this.graphBuilder.getGraph();
        const unused: DeadCodeItem[] = [];

        for (const [name, classInfo] of graph.classes) {
            // Skip Rails framework classes
            if (this.isFrameworkClass(name, classInfo)) {
                continue;
            }

            // Check if class is referenced
            const refInfo = this.findReferences(name, false);
            const hasReferences = refInfo.references.length > 0;

            // Check if any methods are called
            const hasMethodCalls = classInfo.methods.some(methodId => {
                const method = graph.methods.get(methodId);
                return method && method.calledBy.length > 0;
            });

            // Check if has subclasses
            const hasSubclasses = classInfo.subclasses.length > 0;

            if (!hasReferences && !hasMethodCalls && !hasSubclasses) {
                unused.push({
                    name,
                    location: classInfo.location,
                    reason: 'Class is never instantiated or referenced',
                    confidence: 0.8,
                    suggestions: [
                        'Remove the class if no longer needed',
                        'Check if class is used via metaprogramming',
                        'Verify class is not loaded dynamically'
                    ]
                });
            }
        }

        return unused;
    }

    /**
     * Find unused methods
     */
    private findUnusedMethods(): DeadCodeItem[] {
        const graph = this.graphBuilder.getGraph();
        const unused: DeadCodeItem[] = [];

        for (const [id, method] of graph.methods) {
            // Skip public methods (might be called externally)
            if (method.visibility === 'public') {
                continue;
            }

            // Skip Rails controller actions
            if (method.className?.includes('Controller')) {
                continue;
            }

            // Skip callback methods (before_action, after_save, etc.)
            if (this.isCallbackMethod(method.name)) {
                continue;
            }

            // Check if method is called
            if (method.calledBy.length === 0 && method.usageCount === 0) {
                unused.push({
                    name: `${method.className}#${method.name}`,
                    location: method.location,
                    reason: 'Private/protected method is never called',
                    confidence: 0.9,
                    suggestions: [
                        'Remove the method if no longer needed',
                        'Check if method is called via send() or metaprogramming',
                        'Make the method public if it should be part of API'
                    ]
                });
            }
        }

        return unused;
    }

    /**
     * Find unused constants
     */
    private findUnusedConstants(): DeadCodeItem[] {
        const graph = this.graphBuilder.getGraph();
        const unused: DeadCodeItem[] = [];

        for (const [name, classInfo] of graph.classes) {
            for (const [constantName, constantValue] of classInfo.constants) {
                const fullName = `${name}::${constantName}`;
                const refInfo = this.findReferences(fullName, false);

                if (refInfo.references.length === 0) {
                    unused.push({
                        name: fullName,
                        location: classInfo.location,
                        reason: 'Constant is never referenced',
                        confidence: 0.7,
                        suggestions: [
                            'Remove the constant if no longer needed',
                            'Check if constant is used in config files',
                            'Verify constant is not referenced as string'
                        ]
                    });
                }
            }
        }

        return unused;
    }

    /**
     * Check if class is a framework class (Rails, ActiveRecord, etc.)
     */
    private isFrameworkClass(name: string, classInfo: any): boolean {
        // Rails models
        if (classInfo.isRailsModel) return true;

        // Rails controllers
        if (classInfo.isRailsController) return true;

        // ApplicationRecord, ApplicationController, etc.
        if (name.startsWith('Application')) return true;

        // Mailers
        if (name.endsWith('Mailer')) return true;

        // Jobs
        if (name.endsWith('Job')) return true;

        // Serializers
        if (name.endsWith('Serializer')) return true;

        return false;
    }

    /**
     * Check if method is a callback method
     */
    private isCallbackMethod(methodName: string): boolean {
        const callbacks = [
            'before_validation', 'after_validation',
            'before_save', 'after_save',
            'before_create', 'after_create',
            'before_update', 'after_update',
            'before_destroy', 'after_destroy',
            'around_save', 'around_create', 'around_update', 'around_destroy'
        ];

        return callbacks.includes(methodName);
    }

    /**
     * Calculate overall confidence in dead code detection
     */
    private calculateConfidence(
        classes: DeadCodeItem[],
        methods: DeadCodeItem[],
        constants: DeadCodeItem[]
    ): 'high' | 'medium' | 'low' {
        const allItems = [...classes, ...methods, ...constants];

        if (allItems.length === 0) return 'high';

        const avgConfidence = allItems.reduce((sum, item) => sum + item.confidence, 0) / allItems.length;

        if (avgConfidence >= 0.8) return 'high';
        if (avgConfidence >= 0.6) return 'medium';
        return 'low';
    }

    /**
     * Get dead code report as markdown
     */
    generateDeadCodeReport(analysis: DeadCodeAnalysis): string {
        const lines: string[] = [];

        lines.push('# Dead Code Analysis Report');
        lines.push('');
        lines.push(`**Total unused items found**: ${analysis.totalItems}`);
        lines.push(`**Confidence**: ${analysis.confidence.toUpperCase()}`);
        lines.push('');

        if (analysis.unusedClasses.length > 0) {
            lines.push('## Unused Classes');
            lines.push('');
            for (const item of analysis.unusedClasses) {
                lines.push(`### ${item.name}`);
                lines.push(`**Location**: ${item.location.uri.fsPath}:${item.location.range.start.line + 1}`);
                lines.push(`**Reason**: ${item.reason}`);
                lines.push(`**Confidence**: ${(item.confidence * 100).toFixed(0)}%`);
                lines.push('**Suggestions**:');
                item.suggestions.forEach(s => lines.push(`- ${s}`));
                lines.push('');
            }
        }

        if (analysis.unusedMethods.length > 0) {
            lines.push('## Unused Methods');
            lines.push('');
            for (const item of analysis.unusedMethods) {
                lines.push(`### ${item.name}`);
                lines.push(`**Location**: ${item.location.uri.fsPath}:${item.location.range.start.line + 1}`);
                lines.push(`**Reason**: ${item.reason}`);
                lines.push(`**Confidence**: ${(item.confidence * 100).toFixed(0)}%`);
                lines.push('**Suggestions**:');
                item.suggestions.forEach(s => lines.push(`- ${s}`));
                lines.push('');
            }
        }

        if (analysis.unusedConstants.length > 0) {
            lines.push('## Unused Constants');
            lines.push('');
            for (const item of analysis.unusedConstants) {
                lines.push(`### ${item.name}`);
                lines.push(`**Location**: ${item.location.uri.fsPath}:${item.location.range.start.line + 1}`);
                lines.push(`**Reason**: ${item.reason}`);
                lines.push(`**Confidence**: ${(item.confidence * 100).toFixed(0)}%`);
                lines.push('**Suggestions**:');
                item.suggestions.forEach(s => lines.push(`- ${s}`));
                lines.push('');
            }
        }

        if (analysis.totalItems === 0) {
            lines.push('## ✅ No dead code detected!');
            lines.push('');
            lines.push('Your codebase appears to be well-maintained.');
        }

        return lines.join('\n');
    }
}

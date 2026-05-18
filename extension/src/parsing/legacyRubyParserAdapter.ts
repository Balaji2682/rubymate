import * as vscode from 'vscode';
import type { RubySymbol } from '../advancedIndexer';
import {
    ASTNode,
    ClassNode,
    MethodCall,
    MethodNode,
    NodeType,
    Parameter,
    RubyParser
} from '../indexing/rubyParser';

export class LegacyRubyParserAdapter {
    parse(document: vscode.TextDocument): ASTNode[] {
        return new RubyParser(document).parse();
    }

    extractSymbols(document: vscode.TextDocument): RubySymbol[] {
        const symbols: RubySymbol[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        let currentClass: string | undefined;
        let currentModule: string | undefined;
        const indentStack: Array<{ name: string; type: 'class' | 'module'; indent: number }> = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const indent = line.search(/\S/);

            if (trimmed.startsWith('#') || trimmed.length === 0) {
                continue;
            }

            while (indentStack.length > 0 && indent <= indentStack[indentStack.length - 1].indent) {
                indentStack.pop();
            }

            if (indentStack.length > 0) {
                const current = indentStack[indentStack.length - 1];
                if (current.type === 'class') {
                    currentClass = current.name;
                } else {
                    currentModule = current.name;
                }
            } else {
                currentClass = undefined;
                currentModule = undefined;
            }

            const classMatch = trimmed.match(/^class\s+([A-Z][A-Za-z0-9_:]*)\s*(?:<\s*([A-Z][A-Za-z0-9_:]*))?/);
            if (classMatch) {
                const className = classMatch[1];
                const superclass = classMatch[2];
                currentClass = className;
                indentStack.push({ name: className, type: 'class', indent });

                symbols.push({
                    name: className,
                    kind: vscode.SymbolKind.Class,
                    location: new vscode.Location(document.uri, this.lineRange(i, line, 'class')),
                    containerName: currentModule,
                    detail: superclass ? `class (extends ${superclass})` : 'class'
                });
                continue;
            }

            const moduleMatch = trimmed.match(/^module\s+([A-Z][A-Za-z0-9_:]*)/);
            if (moduleMatch) {
                const moduleName = moduleMatch[1];
                currentModule = moduleName;
                indentStack.push({ name: moduleName, type: 'module', indent });

                symbols.push({
                    name: moduleName,
                    kind: vscode.SymbolKind.Module,
                    location: new vscode.Location(document.uri, this.lineRange(i, line, 'module')),
                    detail: 'module'
                });
                continue;
            }

            const methodMatch = trimmed.match(/^def\s+(self\.)?([a-z_][a-z0-9_?!=]*)\s*(?:\((.*?)\))?/);
            if (methodMatch) {
                const isSelfMethod = !!methodMatch[1];
                const methodName = methodMatch[2];
                const params = methodMatch[3];
                const parameters = params ? this.parseParameters(params) : [];

                symbols.push({
                    name: methodName,
                    kind: vscode.SymbolKind.Method,
                    location: new vscode.Location(document.uri, this.lineRange(i, line, 'def')),
                    containerName: currentClass || currentModule,
                    scope: isSelfMethod ? 'singleton' : 'instance',
                    detail: isSelfMethod ? 'class method' : 'instance method',
                    parameters: parameters.map(p => p.name)
                });
                continue;
            }

            const constantMatch = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*=/);
            if (constantMatch) {
                const constantName = constantMatch[1];
                symbols.push({
                    name: constantName,
                    kind: vscode.SymbolKind.Constant,
                    location: new vscode.Location(document.uri, this.lineRange(i, line, constantName)),
                    containerName: currentClass || currentModule,
                    detail: 'constant'
                });
                continue;
            }

            const attrMatch = trimmed.match(/^attr_(accessor|reader|writer)\s+(.+)/);
            if (attrMatch) {
                const attrType = attrMatch[1];
                const attrs = attrMatch[2].split(',').map(a => a.trim().replace(/^:/, '').replace(/^['"]|['"]$/g, ''));
                for (const attrName of attrs) {
                    if (attrName) {
                        symbols.push({
                            name: attrName,
                            kind: vscode.SymbolKind.Property,
                            location: new vscode.Location(document.uri, this.lineRange(i, line, attrName)),
                            containerName: currentClass,
                            detail: attrType
                        });
                    }
                }
            }
        }

        return symbols;
    }

    findReferenceLocations(
        document: vscode.TextDocument,
        word: string,
        includeDeclaration: boolean
    ): vscode.Location[] {
        const locations: vscode.Location[] = [];
        const text = document.getText();
        const escapedWord = this.escapeRegex(word);
        const patterns = [
            new RegExp(`\\b${escapedWord}\\b`, 'g'),
            new RegExp(`\\.${escapedWord}\\b`, 'g'),
            new RegExp(`::${escapedWord}\\b`, 'g'),
            new RegExp(`@${escapedWord}\\b`, 'g'),
            new RegExp(`@@${escapedWord}\\b`, 'g'),
            new RegExp(`:${escapedWord}\\b`, 'g'),
            new RegExp(`(?:send|__send__|public_send)\\s*\\(\\s*:${escapedWord}\\b`, 'g'),
            new RegExp(`(?:send|__send__|public_send)\\s*\\(\\s*["']${escapedWord}\\b`, 'g'),
            new RegExp(`(?:delegate|alias|alias_method)\\s*:${escapedWord}\\b`, 'g'),
            new RegExp(`\\|[^|]*\\b${escapedWord}\\b[^|]*\\|`, 'g'),
            new RegExp(`${escapedWord}:`, 'g'),
            new RegExp(`respond_to\\?\\s*\\(\\s*:${escapedWord}\\b`, 'g')
        ];

        for (const pattern of patterns) {
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(text)) !== null) {
                const position = document.positionAt(match.index);
                const lineText = document.lineAt(position.line).text;

                if (this.isCommentOrString(lineText, position.character, match[0])) {
                    continue;
                }

                if (!includeDeclaration && this.isDefinitionLine(lineText, word)) {
                    continue;
                }

                let startOffset = match.index;
                const matchText = match[0];
                if (matchText.startsWith('.') || matchText.startsWith(':') || matchText.startsWith('@') || matchText.startsWith('::')) {
                    startOffset += matchText.search(/\w/);
                }

                const range = new vscode.Range(
                    document.positionAt(startOffset),
                    document.positionAt(startOffset + word.length)
                );

                if (!locations.some(location => location.range.isEqual(range))) {
                    locations.push(new vscode.Location(document.uri, range));
                }
            }
        }

        return locations;
    }

    findMethodCalls(document: vscode.TextDocument, methodName: string, withinRange?: vscode.Range): vscode.Range[] {
        const text = withinRange ? document.getText(withinRange) : document.getText();
        const startOffset = withinRange ? document.offsetAt(withinRange.start) : 0;
        const ranges: vscode.Range[] = [];
        const patterns = [
            new RegExp(`\\.${this.escapeRegex(methodName)}\\b`, 'g'),
            new RegExp(`\\b${this.escapeRegex(methodName)}\\s*\\(`, 'g'),
            new RegExp(`\\b${this.escapeRegex(methodName)}\\s+\\w`, 'g')
        ];

        for (const pattern of patterns) {
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(text)) !== null) {
                const position = document.positionAt(startOffset + match.index);
                const line = document.lineAt(position.line);
                if (line.text.trim().startsWith('#')) {
                    continue;
                }

                const nameOffset = startOffset + match.index + Math.max(0, match[0].indexOf(methodName));
                ranges.push(new vscode.Range(
                    document.positionAt(nameOffset),
                    document.positionAt(nameOffset + methodName.length)
                ));
            }
        }

        return this.dedupeRanges(ranges);
    }

    findContainingMethod(document: vscode.TextDocument, ast: ASTNode[], position: vscode.Position): MethodNode | undefined {
        const methods: MethodNode[] = [];
        const visit = (node: ASTNode): void => {
            if (node.type === NodeType.Method) {
                methods.push(node as MethodNode);
            }
            if ((node as ClassNode).methods) {
                methods.push(...(node as ClassNode).methods);
            }
            node.children.forEach(visit);
        };
        ast.forEach(visit);

        return methods.find(method => method.range.contains(position));
    }

    collectMethodCalls(ast: ASTNode[]): Array<{ method: MethodNode; call: MethodCall }> {
        const calls: Array<{ method: MethodNode; call: MethodCall }> = [];
        const visit = (node: ASTNode): void => {
            if (node.type === NodeType.Method) {
                const method = node as MethodNode;
                method.calls.forEach(call => calls.push({ method, call }));
            }
            if ((node as ClassNode).methods) {
                for (const method of (node as ClassNode).methods) {
                    method.calls.forEach(call => calls.push({ method, call }));
                }
            }
            node.children.forEach(visit);
        };
        ast.forEach(visit);
        return calls;
    }

    private parseParameters(paramsStr: string): Parameter[] {
        return paramsStr.split(',').map(part => {
            const trimmed = part.trim();
            const keyword = trimmed.includes(':');
            const splat = trimmed.startsWith('*');
            const name = trimmed
                .replace(/^[*&]+/, '')
                .replace(/[:=].*$/, '')
                .trim();

            return { name, keyword, splat, block: trimmed.startsWith('&') };
        }).filter(param => param.name.length > 0);
    }

    private lineRange(lineNumber: number, line: string, token: string): vscode.Range {
        const start = Math.max(0, line.indexOf(token));
        return new vscode.Range(
            new vscode.Position(lineNumber, start),
            new vscode.Position(lineNumber, line.length)
        );
    }

    private isDefinitionLine(lineText: string, word: string): boolean {
        const escaped = this.escapeRegex(word);
        return new RegExp(`^\\s*(?:def\\s+(?:self\\.)?|class\\s+|module\\s+)${escaped}\\b`).test(lineText)
            || new RegExp(`^\\s*${escaped}\\s*=`).test(lineText);
    }

    private isCommentOrString(lineText: string, character: number, matchText: string): boolean {
        const commentIndex = lineText.indexOf('#');
        if (commentIndex !== -1 && character >= commentIndex) {
            return true;
        }

        const beforeText = lineText.substring(0, character);
        const singleQuotes = (beforeText.match(/'/g) || []).length;
        const doubleQuotes = (beforeText.match(/"/g) || []).length;
        return (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0)
            && !matchText.startsWith(':')
            && !matchText.endsWith(':');
    }

    private dedupeRanges(ranges: vscode.Range[]): vscode.Range[] {
        const seen = new Set<string>();
        return ranges.filter(range => {
            const key = `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

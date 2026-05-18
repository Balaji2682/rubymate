import * as path from 'path';
import * as vscode from 'vscode';
import type { ASTNode } from '../indexing/rubyParser';
import { RubyTreeSitterParser } from './rubyTreeSitterParser';
import { TreeSitterRuntime } from './treeSitterRuntime';

export interface EmbeddedRubyRegion {
    code: string;
    range: vscode.Range;
    ast: ASTNode[];
}

export class TemplateParser {
    private readonly rubyParser = new RubyTreeSitterParser();

    constructor(private readonly runtime: TreeSitterRuntime) {}

    async parse(document: vscode.TextDocument): Promise<EmbeddedRubyRegion[]> {
        const extension = path.basename(document.uri.fsPath).toLowerCase();
        if (extension.endsWith('.erb')) {
            return this.parseErb(document);
        }

        return this.parseLineOrInterpolationTemplates(document);
    }

    private async parseErb(document: vscode.TextDocument): Promise<EmbeddedRubyRegion[]> {
        const text = document.getText();
        const templateTree = await this.runtime.parse('embedded-template', text);

        try {
            const regions = templateTree.rootNode.descendantsOfType('code');
            return await Promise.all(regions.map(region => this.parseRegion(document, region.text, region.startIndex, region.endIndex)));
        } finally {
            templateTree.delete();
        }
    }

    private async parseLineOrInterpolationTemplates(document: vscode.TextDocument): Promise<EmbeddedRubyRegion[]> {
        const regions: EmbeddedRubyRegion[] = [];
        const lineCount = document.lineCount;

        for (let lineNumber = 0; lineNumber < lineCount; lineNumber++) {
            const line = document.lineAt(lineNumber).text;
            const trimmed = line.trimStart();
            const leading = line.length - trimmed.length;

            if (trimmed.startsWith('=') || trimmed.startsWith('-')) {
                const code = trimmed.slice(1).trim();
                if (code) {
                    const start = new vscode.Position(lineNumber, leading + 1 + (trimmed.slice(1).search(/\S/) || 0));
                    const end = new vscode.Position(lineNumber, line.length);
                    const ast = await this.parseRubySnippet(code, start);
                    regions.push({ code, range: new vscode.Range(start, end), ast });
                }
            }

            const interpolationPattern = /#\{([^}]*)\}/g;
            let match: RegExpExecArray | null;
            while ((match = interpolationPattern.exec(line)) !== null) {
                const code = match[1];
                const start = new vscode.Position(lineNumber, match.index + 2);
                const end = new vscode.Position(lineNumber, match.index + 2 + code.length);
                const ast = await this.parseRubySnippet(code, start);
                regions.push({ code, range: new vscode.Range(start, end), ast });
            }
        }

        return regions;
    }

    private async parseRegion(
        document: vscode.TextDocument,
        code: string,
        startIndex: number,
        endIndex: number
    ): Promise<EmbeddedRubyRegion> {
        const start = document.positionAt(startIndex);
        const end = document.positionAt(endIndex);
        const ast = await this.parseRubySnippet(code, start);

        return {
            code,
            range: new vscode.Range(start, end),
            ast
        };
    }

    private async parseRubySnippet(code: string, start: vscode.Position): Promise<ASTNode[]> {
        const tree = await this.runtime.parse('ruby', code);
        try {
            return this.rubyParser.parse(tree, { line: start.line, character: start.character });
        } finally {
            tree.delete();
        }
    }
}

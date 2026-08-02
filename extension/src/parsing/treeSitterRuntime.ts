import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import * as TreeSitter from 'web-tree-sitter';

export type TreeSitterLanguageId =
    | 'ruby'
    | 'html'
    | 'javascript'
    | 'typescript'
    | 'embedded-template';

const WASM_FILES: Record<TreeSitterLanguageId | 'runtime', string> = {
    runtime: 'web-tree-sitter.wasm',
    ruby: 'tree-sitter-ruby.wasm',
    html: 'tree-sitter-html.wasm',
    javascript: 'tree-sitter-javascript.wasm',
    typescript: 'tree-sitter-typescript.wasm',
    'embedded-template': 'tree-sitter-embedded_template.wasm'
};

const TREE_SITTER_RUNTIME_VERSION = 'web-tree-sitter@0.26.8';
const TREE_SITTER_LOADER_VERSION = 'wasm-buffer-loader:v1';
const TREE_SITTER_GRAMMAR_VERSION = [
    'tree-sitter-ruby@0.23.1',
    'tree-sitter-html@0.23.2',
    'tree-sitter-javascript@0.25.0',
    'tree-sitter-typescript@0.23.2',
    'tree-sitter-embedded-template@0.25.0'
].join(';');

export class TreeSitterRuntime {
    private initPromise: Promise<void> | undefined;
    private languages = new Map<TreeSitterLanguageId, Promise<TreeSitter.Language>>();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel
    ) {}

    getCacheVersion(): string {
        return `${TREE_SITTER_RUNTIME_VERSION};${TREE_SITTER_LOADER_VERSION};${TREE_SITTER_GRAMMAR_VERSION}`;
    }

    async parse(languageId: TreeSitterLanguageId, source: string): Promise<TreeSitter.Tree> {
        await this.initialize();

        const language = await this.getLanguage(languageId);
        const parser = new TreeSitter.Parser();
        parser.setLanguage(language);

        const tree = parser.parse(source);
        parser.delete();

        if (!tree) {
            throw new Error(`Tree-sitter returned no tree for ${languageId}`);
        }

        return tree;
    }

    async ensureReady(): Promise<void> {
        await this.initialize();
        await Promise.all([
            this.getLanguage('ruby'),
            this.getLanguage('javascript'),
            this.getLanguage('typescript'),
            this.getLanguage('embedded-template')
        ]);
    }

    private initialize(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = this.initializeRuntime().catch(error => {
                this.initPromise = undefined;
                throw error;
            });
        }

        return this.initPromise;
    }

    private async initializeRuntime(): Promise<void> {
        const wasmBinary = await fs.readFile(this.assetPath(WASM_FILES.runtime));

        await TreeSitter.Parser.init({
            wasmBinary,
            locateFile: (scriptName?: string) => this.assetPath(
                scriptName?.endsWith('.wasm') ? scriptName : WASM_FILES.runtime
            )
        } as any);
    }

    private getLanguage(languageId: TreeSitterLanguageId): Promise<TreeSitter.Language> {
        const cached = this.languages.get(languageId);
        if (cached) {
            return cached;
        }

        const loadPromise = fs.readFile(this.assetPath(WASM_FILES[languageId]))
            .then(bytes => TreeSitter.Language.load(new Uint8Array(bytes)))
            .catch(error => {
                this.languages.delete(languageId);
                throw error;
            });

        this.languages.set(languageId, loadPromise);
        return loadPromise;
    }

    private assetPath(fileName: string): string {
        const uri = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'tree-sitter', fileName);
        return uri.fsPath;
    }

    async assertAssetsPresent(): Promise<void> {
        const files = Object.values(WASM_FILES);
        const missing: string[] = [];

        for (const file of files) {
            try {
                await fs.access(this.assetPath(file));
            } catch {
                missing.push(file);
            }
        }

        if (missing.length > 0) {
            const message = `Tree-sitter WASM assets are missing: ${missing.join(', ')}`;
            this.outputChannel.appendLine(`[Parser] ${message}`);
            throw new Error(message);
        }
    }
}

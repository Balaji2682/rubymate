import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CoreRubyIndex } from '../../indexing/coreRubyIndex';
import { ParserService } from '../../parsing';
import { RubyDefinitionProvider } from '../../providers/rubyDefinitionProvider';
import { RubyDocumentSymbolProvider } from '../../providers/documentSymbolProvider';
import { RubyReferenceProvider } from '../../providers/referenceProvider';

suite('RubyMate Reliability Behavior', () => {
    let outputChannel: vscode.OutputChannel;

    setup(() => {
        outputChannel = vscode.window.createOutputChannel('RubyMate Reliability Tests');
    });

    teardown(() => {
        outputChannel.dispose();
    });

    test('definition resolves Ruby suffix methods and qualified constants', async function() {
        this.timeout(10000);

        const { indexer, parserService } = createIndexer(outputChannel);
        const provider = new RubyDefinitionProvider(indexer, parserService);
        const doc = await openRubyDocument(`module Admin
  class User
    def active?
      true
    end

    def save!
      true
    end

    def name=(value)
      @name = value
    end
  end
end

user = Admin::User.new
user.active?
user.save!
user.name = "Ada"
`);

        const constantDef = await definitionAt(provider, doc, 'Admin::User');
        assert.strictEqual(firstLocation(constantDef)?.range.start.line, 1);

        const predicateDef = await definitionAt(provider, doc, 'active?', 2);
        assert.strictEqual(firstLocation(predicateDef)?.range.start.line, 2);

        const bangDef = await definitionAt(provider, doc, 'save!', 2);
        assert.strictEqual(firstLocation(bangDef)?.range.start.line, 6);

        const setterDef = await definitionAt(provider, doc, 'name =');
        assert.strictEqual(firstLocation(setterDef)?.range.start.line, 10);

        indexer.dispose();
    });

    test('definition resolves exact qualified constants before basename fallback', async function() {
        this.timeout(10000);

        const { indexer, parserService } = createIndexer(outputChannel);
        const provider = new RubyDefinitionProvider(indexer, parserService);
        const doc = await openRubyDocument(`module Public
  class User
  end
end

module Admin
  class User
  end
end

target = Admin::User.new
`);

        const definition = await definitionAt(provider, doc, 'Admin::User');
        assert.strictEqual(firstLocation(definition)?.range.start.line, 6);

        indexer.dispose();
    });

    test('document symbols come from unsaved document content', async function() {
        this.timeout(10000);

        const { indexer } = createIndexer(outputChannel);
        const provider = new RubyDocumentSymbolProvider(indexer);
        const doc = await openRubyDocument(`class UnsavedUser
  scope :active, -> { where(active: true) }
  delegate :full_name, to: :profile

  def email
    @email
  end
end
`);

        const symbols = await provider.provideDocumentSymbols(doc, token());
        const rootSymbols = symbols as vscode.DocumentSymbol[];
        const user = rootSymbols.find(symbol => symbol.name === 'UnsavedUser');
        assert.ok(user, 'class symbol should be present');
        assert.ok(user.children.some(symbol => symbol.name === 'email'), 'method symbol should be nested');
        assert.ok(user.children.some(symbol => symbol.name === 'active'), 'scope symbol should be nested');
        assert.ok(user.children.some(symbol => symbol.name === 'full_name'), 'delegate-generated method should be nested');

        indexer.dispose();
    });

    test('references include Ruby metaprogramming call sites and exclude comments and strings', async function() {
        this.timeout(10000);

        const { indexer, parserService } = createIndexer(outputChannel);
        const provider = new RubyReferenceProvider(indexer, parserService);
        const doc = await openRubyDocument(`class UsersController
  alias_method :enabled?, :active?
  before_action :active?

  def active?
    true
  end

  def call
    active?
    send(:active?)
  end
end

# active?
puts "active?"
`);

        const references = await provider.provideReferences(
            doc,
            positionOf(doc, 'active?', 2),
            { includeDeclaration: false },
            token()
        );
        const lines = references.map(location => location.range.start.line);

        assert.ok(lines.includes(1), 'alias_method symbol reference should be found');
        assert.ok(lines.includes(2), 'callback symbol reference should be found');
        assert.ok(lines.includes(9), 'direct method call should be found');
        assert.ok(lines.includes(10), 'dynamic send symbol should be found');
        assert.ok(!lines.includes(14), 'comment should not be counted');
        assert.ok(!lines.includes(15), 'string literal should not be counted');

        indexer.dispose();
    });

    test('workspace symbols update after document edit and file delete', async function() {
        this.timeout(10000);

        const { indexer } = createIndexer(outputChannel);
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rubymate-index-'));
        const fileUri = vscode.Uri.file(path.join(tempDir, 'user.rb'));
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from('class BeforeEdit\nend\n'));

        const doc = await vscode.workspace.openTextDocument(fileUri);
        await indexer.indexDocument(doc, true);
        assert.ok(indexer.findClasses('BeforeEdit').length > 0, 'initial class should be indexed');

        const editor = await vscode.window.showTextDocument(doc);
        await editor.edit(builder => {
            const fullRange = new vscode.Range(
                doc.positionAt(0),
                doc.positionAt(doc.getText().length)
            );
            builder.replace(fullRange, 'class AfterEdit\nend\n');
        });

        await indexer.indexDocument(editor.document, true);
        assert.strictEqual(indexer.findClasses('BeforeEdit').length, 0, 'old class should be removed after edit');
        assert.ok(indexer.findClasses('AfterEdit').length > 0, 'new class should be indexed after edit');

        await indexer.removeFile(fileUri, 'deleted');
        assert.strictEqual(indexer.findClasses('AfterEdit').length, 0, 'deleted file symbols should be removed');
        assert.strictEqual(indexer.getFileStatus(fileUri), 'deleted');

        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        indexer.dispose();
    });

    test('untitled Ruby documents are indexed only transiently', async function() {
        this.timeout(10000);

        const { indexer } = createIndexer(outputChannel);
        const doc = await openRubyDocument(`class ScratchOnly
end
`);

        await indexer.indexDocument(doc, true);

        assert.ok(indexer.getFileSymbols(doc.uri).some(symbol => symbol.name === 'ScratchOnly'));
        assert.strictEqual(indexer.getFileStatus(doc.uri), undefined);
        assert.strictEqual(indexer.getIndexLifecycleSnapshot().totalFiles, 0);

        indexer.dispose();
    });

    test('purge keeps supported Ruby files that are outside the rb glob', async function() {
        this.timeout(10000);

        const { indexer } = createIndexer(outputChannel);
        const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rubymate-gemfile-index-'));
        const gemfileUri = vscode.Uri.file(path.join(testDir, 'Gemfile'));
        Object.defineProperty(indexer as any, 'workspaceRoot', { get: () => testDir });

        await vscode.workspace.fs.writeFile(gemfileUri, Buffer.from('class GemfileDefined\nend\n'));

        try {
            let doc = await vscode.workspace.openTextDocument(gemfileUri);
            if (doc.languageId !== 'ruby') {
                doc = await vscode.languages.setTextDocumentLanguage(doc, 'ruby');
            }

            await indexer.indexDocument(doc, true);
            assert.ok(indexer.findClasses('GemfileDefined').length > 0, 'Gemfile symbols should be indexed');

            await (indexer as any).purgeMissingWorkspaceFiles(new Set<string>());
            assert.ok(indexer.findClasses('GemfileDefined').length > 0, 'existing Gemfile symbols should survive purge');

            await vscode.workspace.fs.delete(gemfileUri);
            await (indexer as any).purgeMissingWorkspaceFiles(new Set<string>());
            assert.strictEqual(indexer.findClasses('GemfileDefined').length, 0, 'deleted Gemfile symbols should be purged');
        } finally {
            await fs.rm(testDir, { recursive: true, force: true });
            indexer.dispose();
        }
    });

    test('parser fallback is visible and still extracts useful symbols', async function() {
        this.timeout(10000);

        const missingAssetsContext = createContext(vscode.Uri.file(path.join(os.tmpdir(), 'missing-rubymate-assets')));
        const parserService = new ParserService(missingAssetsContext, outputChannel);
        await parserService.initialize();

        const doc = await openRubyDocument(`class FallbackUser
  def name
  end
end
`);
        const result = await parserService.extractRubySymbolResult(doc);

        assert.strictEqual(parserService.getRuntimeStatus(), 'degraded');
        assert.strictEqual(result.status, 'fallback');
        assert.ok(result.symbols.some(symbol => symbol.name === 'FallbackUser'), 'fallback parser should extract class symbols');
        assert.ok(result.symbols.some(symbol => symbol.name === 'name'), 'fallback parser should extract method symbols');
    });

    test('Rails associations and concerns navigate through the canonical symbol index', async function() {
        this.timeout(10000);

        const { indexer, parserService } = createIndexer(outputChannel);
        const provider = new RubyDefinitionProvider(indexer, parserService);
        const doc = await openRubyDocument(`module Trackable
  extend ActiveSupport::Concern

  included do
    def tracked?
      true
    end
  end
end

class Comment
end

class Post
  include Trackable
  has_many :comments
end
`);

        const concernDef = await definitionAt(provider, doc, 'Trackable', 2);
        assert.strictEqual(firstLocation(concernDef)?.range.start.line, 0);

        const includedMethodDef = await definitionAt(provider, doc, 'tracked?');
        assert.strictEqual(firstLocation(includedMethodDef)?.range.start.line, 4);

        const associationDef = await definitionAt(provider, doc, 'comments');
        assert.strictEqual(firstLocation(associationDef)?.range.start.line, 10);

        indexer.dispose();
    });

    test('canonical index exposes confidence-ordered Rails convention definitions', async function() {
        this.timeout(10000);

        const { indexer } = createIndexer(outputChannel);
        const doc = await openRubyDocument(`class Comment
end

class Post
  has_many :comments
end
`);

        await indexer.indexDocument(doc, true);
        const definitions = await indexer.findDefinitions('comments', {
            document: doc,
            position: positionOf(doc, 'comments')
        });

        assert.ok(definitions.length > 0, 'association should resolve through the canonical index');
        assert.strictEqual(definitions[0].confidence, 'rails_convention');
        assert.strictEqual(definitions[0].location.range.start.line, 0);

        indexer.dispose();
    });

    test('runtime index status includes parser, cache, and degraded file counts', async function() {
        this.timeout(10000);

        const { indexer } = createIndexer(outputChannel);
        const doc = await openRubyDocument(`class StatusUser
end
`);

        await indexer.indexDocument(doc, true);
        const status = indexer.getIndexStatus();

        assert.ok(status.parserEngine.length > 0, 'parser engine should be reported');
        assert.ok(status.cacheVersion.includes('parser-service'), 'cache version should include parser cache version');
        assert.strictEqual(status.indexedFiles, 1);
        assert.strictEqual(status.failedFiles, 0);

        indexer.dispose();
    });

    test('active docs and gem metadata do not claim Ruby LSP or Solargraph support', async function() {
        const root = path.resolve(__dirname, '../../../..');
        const files = [
            'README.md',
            'extension/README.md',
            'extension/package.json',
            'gem/rubymate.gemspec',
            'gem/Gemfile.lock'
        ];
        const banned = /ruby[-\s]?lsp|solargraph|fully tested/i;

        for (const relative of files) {
            const content = await fs.readFile(path.join(root, relative), 'utf-8');
            assert.ok(!banned.test(content), `${relative} should not contain removed LSP/Solargraph claims`);
        }
    });

    test('transient in-memory parse error keeps the last clean symbols', async function() {
        this.timeout(10000);

        const { indexer, parserService } = createIndexer(outputChannel);
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rubymate-downgrade-'));
        const fileUri = vscode.Uri.file(path.join(tempDir, 'solid.rb'));
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from('class SolidUser\n  def name\n  end\nend\n'));

        try {
            const doc = await vscode.workspace.openTextDocument(fileUri);
            await indexer.indexDocument(doc, true);
            assert.strictEqual(indexer.getFileStatus(fileUri), 'ok');
            assert.ok(indexer.findClasses('SolidUser').length > 0, 'clean class should be indexed');

            // Simulate a transient mid-edit parse where the parser degrades to
            // the heuristic engine and returns different, lower-confidence symbols.
            const original = parserService.extractRubySymbolResult.bind(parserService);
            (parserService as any).extractRubySymbolResult = async () => ({
                engine: 'legacy' as const,
                symbols: [{
                    name: 'HeuristicGhost',
                    kind: vscode.SymbolKind.Class,
                    location: new vscode.Location(fileUri, new vscode.Range(0, 0, 0, 1)),
                    definitionConfidence: 'fallback' as const
                }],
                status: 'fallback' as const
            });

            const editor = await vscode.window.showTextDocument(doc);
            await editor.edit(builder => {
                builder.insert(new vscode.Position(0, 0), '# edit\n');
            });

            await indexer.indexDocument(editor.document, true);

            assert.strictEqual(indexer.getFileStatus(fileUri), 'ok', 'clean status should be preserved');
            assert.ok(indexer.findClasses('SolidUser').length > 0, 'last clean symbols should survive');
            assert.strictEqual(indexer.findClasses('HeuristicGhost').length, 0, 'heuristic symbols should not overwrite clean ones');
            assert.notStrictEqual(indexer.getIndexLifecycleSnapshot().state, 'degraded', 'index should not degrade on transient parse error');

            (parserService as any).extractRubySymbolResult = original;
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            indexer.dispose();
        }
    });

    test('concurrent indexDocument calls are coalesced without duplicating symbols', async function() {
        this.timeout(10000);

        const { indexer } = createIndexer(outputChannel);
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rubymate-concurrent-'));
        const fileUri = vscode.Uri.file(path.join(tempDir, 'racy.rb'));
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from('class RacyUser\nend\n'));

        try {
            const doc = await vscode.workspace.openTextDocument(fileUri);
            await Promise.all([
                indexer.indexDocument(doc, true),
                indexer.indexDocument(doc, true),
                indexer.indexDocument(doc, false)
            ]);

            assert.strictEqual(indexer.findClasses('RacyUser').length, 1, 'symbols should not be duplicated by concurrent indexing');
            assert.strictEqual((indexer as any).inFlightIndex.size, 0, 'in-flight index tracking should be cleaned up');
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
            indexer.dispose();
        }
    });
});

function createIndexer(outputChannel: vscode.OutputChannel): {
    indexer: CoreRubyIndex;
    parserService: ParserService;
} {
    const context = createContext();
    const parserService = new ParserService(context, outputChannel);
    const indexer = new CoreRubyIndex(context, outputChannel, parserService);
    return { indexer, parserService };
}

function createContext(extensionUri = vscode.Uri.file(path.resolve(__dirname, '../../..'))): vscode.ExtensionContext {
    const storageUri = vscode.Uri.file(path.join(os.tmpdir(), `rubymate-test-storage-${process.pid}`));
    return {
        extensionUri,
        globalStorageUri: storageUri,
        subscriptions: [],
        asAbsolutePath: (relativePath: string) => path.join(extensionUri.fsPath, relativePath)
    } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext;
}

async function openRubyDocument(content: string): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({ language: 'ruby', content });
}

async function definitionAt(
    provider: RubyDefinitionProvider,
    document: vscode.TextDocument,
    needle: string,
    occurrence = 1
): Promise<vscode.Definition | undefined> {
    return provider.provideDefinition(document, positionOf(document, needle, occurrence), token());
}

function firstLocation(definition: vscode.Definition | undefined): vscode.Location | undefined {
    if (!definition) {
        return undefined;
    }

    const first = Array.isArray(definition) ? definition[0] : definition;
    if (isLocationLink(first)) {
        return new vscode.Location(first.targetUri, first.targetRange);
    }

    return first;
}

function isLocationLink(value: vscode.Location | vscode.LocationLink): value is vscode.LocationLink {
    return (value as vscode.LocationLink).targetUri !== undefined;
}

function positionOf(document: vscode.TextDocument, needle: string, occurrence = 1): vscode.Position {
    const text = document.getText();
    let offset = -1;
    let searchFrom = 0;

    for (let i = 0; i < occurrence; i++) {
        offset = text.indexOf(needle, searchFrom);
        if (offset === -1) {
            throw new Error(`Could not find '${needle}' in test document`);
        }
        searchFrom = offset + needle.length;
    }

    return document.positionAt(offset + Math.min(1, needle.length - 1));
}

function token(): vscode.CancellationToken {
    return new vscode.CancellationTokenSource().token;
}

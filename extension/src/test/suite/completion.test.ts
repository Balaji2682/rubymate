import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CoreRubyIndex } from '../../indexing/coreRubyIndex';
import { ParserService } from '../../parsing';
import { RubyCompletionProvider } from '../../completion/rubyCompletionProvider';
import { loadBundledStubs } from '../../completion/stubLoader';

/**
 * End-to-end behaviour of the semantic completion provider: the classifier,
 * scope extractor, candidate sources, and ranker composed against a real index
 * loaded with the bundled core/Rails knowledge base.
 */
suite('RubyMate Completion', () => {
    let outputChannel: vscode.OutputChannel;

    setup(() => {
        outputChannel = vscode.window.createOutputChannel('RubyMate Completion Tests');
    });

    teardown(() => {
        outputChannel.dispose();
    });

    test('bareword completion offers an in-scope local ahead of a keyword', async function() {
        this.timeout(10000);

        const { provider, indexer } = createProvider(outputChannel);
        const doc = await openRubyDocument(`class Invoice
  def total
    subtotal = 100
    su
  end
end`);
        await indexer.indexDocument(doc, true);

        const items = complete(provider, doc, new vscode.Position(3, 6));
        const labels = items.map(labelText);

        assert.ok(labels.includes('subtotal'), 'expected the local `subtotal` to be offered');

        const localIndex = labels.indexOf('subtotal');
        const keywordIndex = labels.indexOf('super');
        assert.ok(localIndex >= 0);
        if (keywordIndex >= 0) {
            assert.ok(localIndex < keywordIndex, 'a local in scope should rank above the `super` keyword');
        }
    });

    test('bareword completion offers a method on self', async function() {
        this.timeout(10000);

        const { provider, indexer } = createProvider(outputChannel);
        const doc = await openRubyDocument(`class Widget
  def render
    dr
  end

  def draw
    1
  end
end`);
        await indexer.indexDocument(doc, true);

        const items = complete(provider, doc, new vscode.Position(2, 6));
        assert.ok(items.map(labelText).includes('draw'), 'expected the self method `draw` to be offered');
    });

    test('member completion resolves core String methods on a typed local', async function() {
        this.timeout(10000);

        const { provider, indexer } = createProvider(outputChannel);
        const doc = await openRubyDocument(`class Report
  def render
    greeting = "hello"
    greeting.
  end
end`);
        await indexer.indexDocument(doc, true);

        const items = complete(provider, doc, new vscode.Position(3, 13));
        const labels = items.map(labelText);

        assert.ok(labels.includes('upcase'), 'expected String#upcase from the bundled core stubs');
        assert.ok(labels.includes('downcase'), 'expected String#downcase from the bundled core stubs');
    });

    test('no completion is offered inside a comment', async function() {
        this.timeout(10000);

        const { provider, indexer } = createProvider(outputChannel);
        const doc = await openRubyDocument(`class Note
  def body
    # write su here
  end
end`);
        await indexer.indexDocument(doc, true);

        const items = provider.provideCompletionItems(
            doc,
            new vscode.Position(2, 13),
            new vscode.CancellationTokenSource().token
        );
        assert.strictEqual(items, undefined, 'a comment position should yield no completions');
    });
});

function complete(
    provider: RubyCompletionProvider,
    document: vscode.TextDocument,
    position: vscode.Position
): vscode.CompletionItem[] {
    const items = provider.provideCompletionItems(
        document,
        position,
        new vscode.CancellationTokenSource().token
    );
    return items ?? [];
}

function labelText(item: vscode.CompletionItem): string {
    return typeof item.label === 'string' ? item.label : item.label.label;
}

function createProvider(outputChannel: vscode.OutputChannel): {
    provider: RubyCompletionProvider;
    indexer: CoreRubyIndex;
    parserService: ParserService;
} {
    const context = createContext();
    const parserService = new ParserService(context, outputChannel);
    const indexer = new CoreRubyIndex(context, outputChannel, parserService);
    const stubs = loadBundledStubs(indexer.getSemanticGraph());
    const provider = new RubyCompletionProvider(indexer, stubs.docs);
    return { provider, indexer, parserService };
}

function createContext(extensionUri = vscode.Uri.file(path.resolve(__dirname, '../../..'))): vscode.ExtensionContext {
    const storageUri = vscode.Uri.file(path.join(os.tmpdir(), `rubymate-completion-storage-${process.pid}`));
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

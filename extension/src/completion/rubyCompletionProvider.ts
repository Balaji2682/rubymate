import * as vscode from 'vscode';
import { CoreRubyIndex } from '../indexing/coreRubyIndex';
import { ParameterInfo } from '../indexing/semanticGraph';
import { CandidateKind, CandidateRequest, collectCandidates } from './candidateSources';
import { classifyCompletionContext } from './completionContext';
import { rankCandidates, RankedCandidate } from './ranker';
import { EnclosingMethod, extractLocalScope } from './scopeExtractor';

/**
 * The Ruby completion provider — the seam where the classifier, scope extractor,
 * candidate sources, and ranker come together as one VS Code feature.
 *
 * Its job is orchestration and presentation: classify the cursor, gather the
 * local scope and the enclosing class/method from the index, ask the sources for
 * the raw candidates, rank them, and turn each into a {@link vscode.CompletionItem}
 * with the icon, detail, documentation, call snippet, and `sortText` that make
 * the ranked order stick. All the intelligence lives in the modules it composes;
 * nothing here re-implements resolution or scoring.
 */
export class RubyCompletionProvider implements vscode.CompletionItemProvider {
    constructor(
        private readonly indexer: CoreRubyIndex,
        /** Curated `methodId -> doc` overlay from the bundled knowledge base. */
        private readonly docs: Map<string, string>
    ) {}

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.CompletionItem[] | undefined {
        if (token.isCancellationRequested) {
            return undefined;
        }

        const context = classifyCompletionContext(document, position);
        if (context.kind === 'none') {
            return undefined;
        }

        const enclosingMethod = this.enclosingMethodAt(document.uri, position);
        const containingClass = this.indexer.getEnclosingTypeName(document.uri, position);
        const scope = extractLocalScope(document, position, enclosingMethod);

        const request: CandidateRequest = {
            context,
            scope,
            graph: this.indexer.getSemanticGraph(),
            inference: this.indexer.getTypeInferenceEngine(),
            docs: this.docs,
            document,
            position,
            containingClass,
            containingMethod: enclosingMethod?.name
        };

        const candidates = collectCandidates(request);
        if (candidates.length === 0) {
            return undefined;
        }

        const ranked = rankCandidates(candidates, { prefix: context.prefix });
        return ranked.map(entry => this.toCompletionItem(entry, context.replaceRange));
    }

    /**
     * The innermost `def` enclosing a position — its span and parameter names —
     * shaped for the scope extractor. Reuses the index's range-tree containment
     * query rather than re-scanning the buffer.
     */
    private enclosingMethodAt(uri: vscode.Uri, position: vscode.Position): (EnclosingMethod & { name: string }) | undefined {
        const methods = this.indexer.findSymbolsContainingPosition(uri, position)
            .filter(symbol =>
                symbol.kind === vscode.SymbolKind.Method ||
                symbol.kind === vscode.SymbolKind.Function);
        if (methods.length === 0) {
            return undefined;
        }

        // The innermost method is the one whose definition starts latest.
        const innermost = methods.reduce((best, symbol) =>
            symbol.location.range.start.isAfter(best.location.range.start) ? symbol : best
        );
        return {
            name: innermost.name,
            range: innermost.location.range,
            parameters: innermost.parameters
        };
    }

    /** Present a ranked candidate as a completion item. */
    private toCompletionItem(
        entry: RankedCandidate,
        replaceRange: vscode.Range
    ): vscode.CompletionItem {
        const { candidate } = entry;
        const item = new vscode.CompletionItem(candidate.label, completionKind(candidate.kind));

        item.sortText = entry.sortText;
        item.range = replaceRange;
        if (candidate.detail) {
            item.detail = candidate.detail;
        }
        if (candidate.documentation) {
            item.documentation = new vscode.MarkdownString(candidate.documentation);
        }

        // A method with required arguments completes to a call with tab stops so
        // the developer lands on the first argument; only the label is inserted
        // into the range, so a safe-navigation `&.` already in the buffer is kept.
        if (candidate.kind === 'method') {
            const snippet = callSnippet(candidate.label, candidate.parameters);
            if (snippet) {
                item.insertText = snippet;
            }
        }

        return item;
    }
}

/** Map the semantic candidate kind to the VS Code icon for the list. */
function completionKind(kind: CandidateKind): vscode.CompletionItemKind {
    switch (kind) {
        case 'method':
            return vscode.CompletionItemKind.Method;
        case 'local':
        case 'block_argument':
            return vscode.CompletionItemKind.Variable;
        case 'parameter':
            return vscode.CompletionItemKind.Variable;
        case 'class':
            return vscode.CompletionItemKind.Class;
        case 'module':
            return vscode.CompletionItemKind.Module;
        case 'constant':
            return vscode.CompletionItemKind.Constant;
        case 'keyword':
            return vscode.CompletionItemKind.Keyword;
        case 'instance_variable':
        case 'class_variable':
            return vscode.CompletionItemKind.Field;
        default:
            return vscode.CompletionItemKind.Text;
    }
}

/**
 * Build a call snippet for a method, or undefined when a bare name is the right
 * insertion. Only the arguments the caller must supply become tab stops —
 * positional and required keyword parameters — so an optional-only method still
 * completes to just its name. Block, splat, and defaulted parameters are left
 * out of the placeholder list to keep the snippet honest about what is required.
 */
function callSnippet(label: string, parameters: ParameterInfo[] | undefined): vscode.SnippetString | undefined {
    if (!parameters || parameters.length === 0) {
        return undefined;
    }

    const required = parameters.filter(isRequiredArgument);
    if (required.length === 0) {
        return undefined;
    }

    const snippet = new vscode.SnippetString(`${label}(`);
    required.forEach((param, index) => {
        if (index > 0) {
            snippet.appendText(', ');
        }
        if (param.keyword) {
            snippet.appendText(`${param.name}: `);
            snippet.appendPlaceholder(param.name);
        } else {
            snippet.appendPlaceholder(param.name);
        }
    });
    snippet.appendText(')');
    return snippet;
}

/** A parameter the caller must pass: a plain positional or a required keyword. */
function isRequiredArgument(param: ParameterInfo): boolean {
    if (param.block || param.splat || param.defaultValue !== undefined) {
        return false;
    }
    return true;
}

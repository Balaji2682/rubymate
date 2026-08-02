import * as vscode from 'vscode';
import { MethodInfo, ParameterInfo, SemanticGraphBuilder } from '../indexing/semanticGraph';
import { InferenceContext, TypeInferenceEngine } from '../indexing/typeInference';
import { CompletionContext } from './completionContext';
import { LocalVariable, ScopeInfo } from './scopeExtractor';

/**
 * Turning a classified cursor position into the raw set of things worth
 * suggesting.
 *
 * Each {@link CompletionContext} kind admits a different family of answers — a
 * `.` wants the receiver's methods, a bareword wants locals and `self` methods
 * and keywords, an `@name` wants the enclosing object's instance variables — so
 * this module is a switch over those kinds that pulls candidates from the
 * semantic graph, the local scope, and the type-inference engine. It only
 * gathers and labels; scoring and ordering are left to the ranker, which reads
 * the {@link CandidateSignals} attached here.
 */

/** What a candidate is, kept semantic so the provider can pick an icon later. */
export type CandidateKind =
    | 'method'
    | 'local'
    | 'parameter'
    | 'block_argument'
    | 'class'
    | 'module'
    | 'constant'
    | 'keyword'
    | 'instance_variable'
    | 'class_variable';

/**
 * Where a candidate came from. The ranker turns this into a base weight — a
 * local in scope is almost always a better bareword answer than a keyword — so
 * the origin captures intent that the kind alone does not.
 */
export type CandidateOrigin =
    | 'local'
    | 'self-method'
    | 'receiver-method'
    | 'instance-variable'
    | 'constant'
    | 'keyword';

/** The ranking inputs gathered alongside a candidate; consumed by the ranker. */
export interface CandidateSignals {
    origin: CandidateOrigin;
    /** Call-graph popularity of a method; 0 for non-methods. The headline signal. */
    usageCount: number;
    /** For locals: how many lines above the cursor the binding sits (nearer wins). */
    proximity?: number;
    /** 0-1 confidence in the resolution that produced this candidate. */
    typeConfidence?: number;
}

export interface Candidate {
    label: string;
    kind: CandidateKind;
    /** Owning type / brief description shown to the right of the label. */
    detail?: string;
    documentation?: string;
    /** Method ID (`Class#m`) when the candidate is a method, for doc lookup. */
    methodId?: string;
    returnType?: string;
    /** Method parameters, so the provider can build a call snippet. */
    parameters?: ParameterInfo[];
    signals: CandidateSignals;
}

/** Everything the sources need to answer a single completion request. */
export interface CandidateRequest {
    context: CompletionContext;
    scope: ScopeInfo;
    graph: SemanticGraphBuilder;
    inference: TypeInferenceEngine;
    /** Curated `methodId -> doc` overlay from the stub loader. */
    docs: Map<string, string>;
    document: vscode.TextDocument;
    position: vscode.Position;
    /** Fully-qualified class enclosing the cursor, for `self` and `@ivar` answers. */
    containingClass?: string;
    containingMethod?: string;
}

/** Ruby keywords worth completing as barewords. */
const RUBY_KEYWORDS = [
    'def', 'class', 'module', 'if', 'elsif', 'else', 'unless', 'while', 'until',
    'for', 'in', 'do', 'begin', 'rescue', 'ensure', 'retry', 'end', 'return',
    'yield', 'break', 'next', 'redo', 'case', 'when', 'then', 'and', 'or', 'not',
    'self', 'super', 'nil', 'true', 'false'
];

/** A constant path such as `Foo` or `Foo::Bar`. */
const CONSTANT_PATH = /^[A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*$/;

/**
 * Collect every candidate appropriate to the classified context. The result is
 * unranked and loosely filtered to the typed prefix; the ranker orders it.
 */
export function collectCandidates(request: CandidateRequest): Candidate[] {
    const { context } = request;

    switch (context.kind) {
        case 'member':
            return memberCandidates(request);
        case 'bareword':
            return barewordCandidates(request);
        case 'constant':
            return constantCandidates(request);
        case 'scoped':
            return scopedCandidates(request);
        case 'instance_var':
            return instanceVariableCandidates(request);
        case 'class_var':
            return classVariableCandidates(request);
        default:
            // `symbol`, `global_var`, `require_path`, `none` have no
            // graph-backed answers here; the provider handles what it can.
            return [];
    }
}

/**
 * Methods of the receiver's type after `.`/`&.`. The receiver is resolved to a
 * type — a bare constant is the class itself (its class methods), anything else
 * is inferred to an instance (its instance methods) — and the type's full MRO
 * is offered, filtered to the visibility the caller can actually reach.
 */
function memberCandidates(request: CandidateRequest): Candidate[] {
    const { context, graph } = request;
    const receiver = context.receiver;
    if (!receiver) {
        return [];
    }

    const resolved = resolveReceiver(request, receiver);
    if (!resolved) {
        return [];
    }

    const prefix = context.prefix;
    const candidates: Candidate[] = [];
    for (const method of graph.getAllAvailableMethods(resolved.type)) {
        if (method.isClassMethod !== resolved.classMethods) {
            continue;
        }
        // An external receiver can only reach public methods; only `self`
        // completion (handled elsewhere) sees private and protected ones.
        if (method.visibility !== 'public') {
            continue;
        }
        if (!matchesPrefix(method.name, prefix)) {
            continue;
        }
        candidates.push(methodCandidate(method, 'receiver-method', request.docs, resolved.confidence));
    }
    return candidates;
}

interface ResolvedReceiver {
    type: string;
    /** True when the receiver is a class/module and class methods apply. */
    classMethods: boolean;
    confidence: number;
}

/**
 * Resolve a receiver expression to the type whose members should be offered. A
 * known constant resolves to itself with class-method semantics; every other
 * expression is handed to the inference engine, which reads the in-scope local
 * types to settle receivers like `user.` or `order.line_items.`.
 */
function resolveReceiver(request: CandidateRequest, receiver: string): ResolvedReceiver | undefined {
    const graph = request.graph.getGraph();
    if (CONSTANT_PATH.test(receiver) && (graph.classes.has(receiver) || graph.modules.has(receiver))) {
        return { type: receiver, classMethods: true, confidence: 1 };
    }

    const inferred = request.inference.inferType(receiver, inferenceContext(request));
    if (!inferred) {
        return undefined;
    }
    return { type: inferred.type, classMethods: false, confidence: inferred.confidence };
}

/**
 * Barewords: the locals in scope, the instance methods reachable through
 * `self`, and the Ruby keywords. All three families compete on one ranked list
 * because at a bareword any of them could be what the user means.
 */
function barewordCandidates(request: CandidateRequest): Candidate[] {
    const prefix = request.context.prefix;
    const candidates: Candidate[] = [];

    for (const local of request.scope.locals) {
        if (matchesPrefix(local.name, prefix)) {
            candidates.push(localCandidate(local, request.position.line));
        }
    }

    if (request.containingClass) {
        // `self` reaches its own private and protected methods, so no
        // visibility filter here — only class methods are excluded.
        for (const method of request.graph.getAllAvailableMethods(request.containingClass)) {
            if (method.isClassMethod || !matchesPrefix(method.name, prefix)) {
                continue;
            }
            candidates.push(methodCandidate(method, 'self-method', request.docs, 1));
        }
    }

    for (const keyword of RUBY_KEYWORDS) {
        if (matchesPrefix(keyword, prefix)) {
            candidates.push(keywordCandidate(keyword));
        }
    }

    return candidates;
}

/** Capitalised barewords: every known class and module name. */
function constantCandidates(request: CandidateRequest): Candidate[] {
    const prefix = request.context.prefix;
    const graph = request.graph.getGraph();
    const candidates: Candidate[] = [];

    for (const [name, info] of graph.classes) {
        if (matchesPrefix(name, prefix)) {
            candidates.push(constantCandidate(info.fullyQualifiedName ?? name, name, 'class'));
        }
    }
    for (const [name, info] of graph.modules) {
        if (matchesPrefix(name, prefix)) {
            candidates.push(constantCandidate(info.fullyQualifiedName ?? name, name, 'module'));
        }
    }
    return candidates;
}

/**
 * After `Namespace::`: the constants nested directly under the namespace and,
 * when the namespace is a known type, its class methods. Nested names are
 * offered by their last segment so `ActiveRecord::Ba` completes to `Base`.
 */
function scopedCandidates(request: CandidateRequest): Candidate[] {
    const namespace = request.context.receiver;
    if (!namespace) {
        return [];
    }

    const prefix = request.context.prefix;
    const graph = request.graph.getGraph();
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    const scopePrefix = `${namespace}::`;

    for (const [fqn, info] of graph.classes) {
        const segment = nestedSegment(fqn, scopePrefix);
        if (segment && matchesPrefix(segment, prefix) && !seen.has(segment)) {
            seen.add(segment);
            candidates.push(constantCandidate(info.fullyQualifiedName ?? fqn, segment, 'class'));
        }
    }
    for (const [fqn, info] of graph.modules) {
        const segment = nestedSegment(fqn, scopePrefix);
        if (segment && matchesPrefix(segment, prefix) && !seen.has(segment)) {
            seen.add(segment);
            candidates.push(constantCandidate(info.fullyQualifiedName ?? fqn, segment, 'module'));
        }
    }

    if (graph.classes.has(namespace) || graph.modules.has(namespace)) {
        for (const method of request.graph.getAllAvailableMethods(namespace)) {
            if (method.isClassMethod && method.visibility === 'public' && matchesPrefix(method.name, prefix)) {
                candidates.push(methodCandidate(method, 'receiver-method', request.docs, 1));
            }
        }
    }

    return candidates;
}

/** Instance variables recorded on the enclosing class. */
function instanceVariableCandidates(request: CandidateRequest): Candidate[] {
    return memberVariableCandidates(request, info => info.instanceVariables, 'instance_variable');
}

/** Class variables recorded on the enclosing class. */
function classVariableCandidates(request: CandidateRequest): Candidate[] {
    return memberVariableCandidates(request, info => info.classVariables, 'class_variable');
}

function memberVariableCandidates(
    request: CandidateRequest,
    select: (info: { instanceVariables: string[]; classVariables: string[] }) => string[],
    kind: 'instance_variable' | 'class_variable'
): Candidate[] {
    if (!request.containingClass) {
        return [];
    }
    const classInfo = request.graph.getGraph().classes.get(request.containingClass);
    if (!classInfo) {
        return [];
    }

    const prefix = request.context.prefix;
    const sigil = kind === 'instance_variable' ? '@' : '@@';
    const candidates: Candidate[] = [];
    for (const name of select(classInfo)) {
        const bare = name.replace(/^@+/, '');
        if (matchesPrefix(bare, prefix)) {
            candidates.push({
                label: bare,
                kind,
                detail: `${sigil}${bare}`,
                signals: { origin: 'instance-variable', usageCount: 0 }
            });
        }
    }
    return candidates;
}

function methodCandidate(
    method: MethodInfo,
    origin: CandidateOrigin,
    docs: Map<string, string>,
    typeConfidence: number
): Candidate {
    const owner = method.className ?? '';
    return {
        label: method.name,
        kind: 'method',
        detail: method.returnType ? `${owner} → ${method.returnType}` : owner,
        documentation: docs.get(method.id),
        methodId: method.id,
        returnType: method.returnType,
        parameters: method.parameters,
        signals: {
            origin,
            usageCount: method.usageCount,
            typeConfidence
        }
    };
}

function localCandidate(local: LocalVariable, cursorLine: number): Candidate {
    const kind: CandidateKind =
        local.kind === 'parameter' ? 'parameter'
            : local.kind === 'block_argument' ? 'block_argument'
                : 'local';
    return {
        label: local.name,
        kind,
        detail: local.type ?? local.kind,
        signals: {
            origin: 'local',
            usageCount: 0,
            proximity: Math.max(0, cursorLine - local.declarationLine),
            typeConfidence: local.typeConfidence
        }
    };
}

function constantCandidate(fullyQualifiedName: string, label: string, kind: 'class' | 'module'): Candidate {
    return {
        label,
        kind,
        detail: fullyQualifiedName === label ? undefined : fullyQualifiedName,
        signals: { origin: 'constant', usageCount: 0 }
    };
}

function keywordCandidate(keyword: string): Candidate {
    return {
        label: keyword,
        kind: 'keyword',
        detail: 'keyword',
        signals: { origin: 'keyword', usageCount: 0 }
    };
}

function inferenceContext(request: CandidateRequest): InferenceContext {
    return {
        document: request.document,
        position: request.position,
        containingClass: request.containingClass,
        containingMethod: request.containingMethod,
        localVariables: request.scope.localTypes
    };
}

/**
 * The segment a fully-qualified name contributes directly under `scopePrefix`,
 * or undefined if it is not nested there. `ActiveRecord::Base` under
 * `ActiveRecord::` yields `Base`; a deeper `ActiveRecord::Base::Foo` is skipped
 * because only the immediate child belongs at this scope.
 */
function nestedSegment(fqn: string, scopePrefix: string): string | undefined {
    if (!fqn.startsWith(scopePrefix)) {
        return undefined;
    }
    const remainder = fqn.slice(scopePrefix.length);
    return remainder.includes('::') ? undefined : remainder;
}

/**
 * Loose prefix gate. An empty prefix admits everything; otherwise a
 * case-insensitive substring match keeps the set small while still surfacing
 * `find_by` when the user has typed `by`. The ranker rewards tighter matches.
 */
function matchesPrefix(label: string, prefix: string): boolean {
    if (!prefix) {
        return true;
    }
    return label.toLowerCase().includes(prefix.toLowerCase());
}

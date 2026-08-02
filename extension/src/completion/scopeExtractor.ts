import * as vscode from 'vscode';

/**
 * How a local name came to be in scope. The kind is surfaced to the user as
 * the completion detail so a parameter reads differently from a plain local,
 * and it lets the ranker prefer the nearest, most concrete binding.
 */
export type LocalKind = 'parameter' | 'block_argument' | 'local';

export interface LocalVariable {
    name: string;
    kind: LocalKind;

    /** Inferred class name of the value, when cheaply knowable from the RHS. */
    type?: string;

    /** Confidence of {@link type}, on the same 0-1 scale as the inference engine. */
    typeConfidence?: number;

    /** Line where the binding was introduced; feeds proximity ranking. */
    declarationLine: number;
}

export interface ScopeInfo {
    /** Every local visible at the cursor, most recently bound name last. */
    locals: LocalVariable[];

    /**
     * `name -> type` for the locals whose type is known, shaped to drop
     * straight into {@link InferenceContext.localVariables} so the existing
     * type-inference engine can resolve receivers like `user.` where `user`
     * is a method-local.
     */
    localTypes: Map<string, string>;
}

/** The enclosing `def` as the index sees it: its span and parameter names. */
export interface EnclosingMethod {
    range: vscode.Range;
    parameters?: string[];
}

/** A bare Ruby local variable name (instance/class/global vars are excluded). */
const LOCAL_NAME = '[a-z_][A-Za-z0-9_]*';

/**
 * Assignment to one or more locals: `x = …`, `a, *b = …`, `count ||= 0`,
 * `total += n`. The operator is a single `=` (or a compound `||=`, `+=`, …)
 * and never `==`, `>=`, `<=`, `!=`, or the `=>` hash rocket — those are reads,
 * not bindings.
 */
const ASSIGNMENT = new RegExp(
    `^\\s*(${LOCAL_NAME}(?:\\s*,\\s*\\*?${LOCAL_NAME})*)\\s*(?:\\|\\|=|&&=|[-+*/%]=|=(?![=>]))`
);

/** Block parameters: the `|a, b|` immediately after `do` or `{`. */
const BLOCK_PARAMS = /(?:\bdo\b|\{)\s*\|([^|]*)\|/g;

/** `for x, y in …` — the loop variables are locals for the rest of the scope. */
const FOR_LOOP = new RegExp(`^\\s*for\\s+(${LOCAL_NAME}(?:\\s*,\\s*${LOCAL_NAME})*)\\s+in\\b`);

/** `rescue SomeError => e` — the captured exception is a local. */
const RESCUE_CAPTURE = new RegExp(`\\brescue\\b[^=\\n]*=>\\s*(${LOCAL_NAME})`);

/** Lines that open a definition and must never be read as assignments. */
const DEFINITION_LINE = /^\s*(?:def|class|module)\b/;

/** `Foo.new` / `Foo::Bar.new`, capturing the constructed constant. */
const CONSTRUCTOR = /^([A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*)\.new\b/;

/** A bare constant reference used as a whole expression. */
const CONSTANT_REF = /^[A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*$/;

/**
 * Collect the local variables in scope at a position: the enclosing method's
 * parameters, block arguments, and any assignments that precede the cursor.
 *
 * The scan is textual and single-buffer, mirroring the classifier: it walks the
 * lines from the enclosing method's `def` (or the top of the file for
 * script-level code) down to the cursor, stripping strings and comments so a
 * `"x = 1"` inside a literal is never mistaken for a binding.
 *
 * It deliberately over-approximates block scoping: a local assigned inside a
 * sibling block that has already closed is still reported, because for
 * completion an occasional stale name costs one extra suggestion whereas a
 * missed local costs a real answer. Type inference here is intentionally
 * shallow — literals and `Const.new` — and hands the harder cases to the
 * inference engine via {@link ScopeInfo.localTypes}.
 */
export function extractLocalScope(
    document: vscode.TextDocument,
    position: vscode.Position,
    enclosingMethod?: EnclosingMethod
): ScopeInfo {
    // Last binding of a name wins, so a Map keyed by name both de-dupes and
    // lets a later assignment refine an earlier parameter's type.
    const byName = new Map<string, LocalVariable>();

    const startLine = enclosingMethod ? enclosingMethod.range.start.line : 0;

    if (enclosingMethod?.parameters) {
        for (const name of enclosingMethod.parameters) {
            if (name) {
                byName.set(name, {
                    name,
                    kind: 'parameter',
                    declarationLine: startLine
                });
            }
        }
    }

    for (let line = startLine; line <= position.line; line++) {
        const raw = document.lineAt(line).text;
        // On the cursor line only look at what has already been typed; a
        // binding to the right of the cursor is not yet in scope.
        const text = stripStringsAndComments(
            line === position.line ? raw.slice(0, position.character) : raw
        );

        collectBlockParameters(text, line, byName);

        if (DEFINITION_LINE.test(text)) {
            continue;
        }

        collectForLoop(text, line, byName);
        collectRescueCapture(text, line, byName);
        collectAssignment(text, line, byName);
    }

    const locals = [...byName.values()].sort((a, b) => a.declarationLine - b.declarationLine);
    const localTypes = new Map<string, string>();
    for (const local of locals) {
        if (local.type) {
            localTypes.set(local.name, local.type);
        }
    }

    return { locals, localTypes };
}

function collectBlockParameters(
    text: string,
    line: number,
    byName: Map<string, LocalVariable>
): void {
    BLOCK_PARAMS.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = BLOCK_PARAMS.exec(text)) !== null) {
        for (const name of parseParamNames(match[1])) {
            record(byName, { name, kind: 'block_argument', declarationLine: line });
        }
    }
}

function collectForLoop(
    text: string,
    line: number,
    byName: Map<string, LocalVariable>
): void {
    const match = text.match(FOR_LOOP);
    if (!match) {
        return;
    }
    for (const name of match[1].split(',')) {
        record(byName, { name: name.trim(), kind: 'local', declarationLine: line });
    }
}

function collectRescueCapture(
    text: string,
    line: number,
    byName: Map<string, LocalVariable>
): void {
    const match = text.match(RESCUE_CAPTURE);
    if (match) {
        record(byName, { name: match[1], kind: 'local', declarationLine: line });
    }
}

function collectAssignment(
    text: string,
    line: number,
    byName: Map<string, LocalVariable>
): void {
    const match = text.match(ASSIGNMENT);
    if (!match) {
        return;
    }

    const targets = match[1].split(',').map(part => part.trim().replace(/^\*/, ''));

    // A type is only meaningful for a single-target assignment; a destructuring
    // `a, b = pair` spreads an unknown element type across its targets.
    const rhs = targets.length === 1
        ? inferRhsType(text.slice(match[0].length).trim())
        : undefined;

    for (const name of targets) {
        if (!name) {
            continue;
        }
        record(byName, {
            name,
            kind: 'local',
            declarationLine: line,
            type: rhs?.type,
            typeConfidence: rhs?.confidence
        });
    }
}

/**
 * Insert a binding, letting a later line overwrite an earlier one so the
 * nearest assignment's type and declaration position win — which is what a
 * Ruby reassignment means at the cursor.
 */
function record(byName: Map<string, LocalVariable>, local: LocalVariable): void {
    if (!local.name) {
        return;
    }
    byName.set(local.name, local);
}

/**
 * Names from a block/parameter list: strips `*`/`**`/`&` sigils and `key:`
 * keyword colons, ignores default-value and destructuring punctuation, and
 * keeps block-local names declared after a `;`.
 */
function parseParamNames(list: string): string[] {
    const names: string[] = [];
    const token = /[a-z_][A-Za-z0-9_]*/g;
    // Drop default values (`x = 1`) so their RHS identifiers are not captured.
    const withoutDefaults = list.replace(/=[^,;]*/g, '');
    let match: RegExpExecArray | null;
    while ((match = token.exec(withoutDefaults)) !== null) {
        // A `foo:` keyword label names the parameter `foo`; the token regex
        // already yields `foo`, so nothing extra is needed here.
        names.push(match[0]);
    }
    return names;
}

interface RhsType {
    type: string;
    confidence: number;
}

/**
 * Best-effort type of an assignment's right-hand side, limited to the cases a
 * single line can settle with certainty: literals and constructor calls. Method
 * returns, associations, and data-flow are left to the inference engine, which
 * receives these locals through {@link ScopeInfo.localTypes}.
 */
function inferRhsType(rhs: string): RhsType | undefined {
    if (!rhs) {
        return undefined;
    }

    const constructor = rhs.match(CONSTRUCTOR);
    if (constructor) {
        return { type: constructor[1], confidence: 0.9 };
    }

    if (CONSTANT_REF.test(rhs)) {
        return { type: rhs, confidence: 0.7 };
    }

    if (/^(["']).*\1$/.test(rhs) || rhs.startsWith('"') || rhs.startsWith("'")) {
        return { type: 'String', confidence: 1.0 };
    }
    if (/^-?\d+$/.test(rhs)) {
        return { type: 'Integer', confidence: 1.0 };
    }
    if (/^-?\d+\.\d+$/.test(rhs)) {
        return { type: 'Float', confidence: 1.0 };
    }
    if (rhs === 'true' || rhs === 'false') {
        return { type: 'Boolean', confidence: 1.0 };
    }
    if (rhs === 'nil') {
        return { type: 'NilClass', confidence: 1.0 };
    }
    if (rhs.startsWith('[')) {
        return { type: 'Array', confidence: 1.0 };
    }
    if (rhs.startsWith('{')) {
        return { type: 'Hash', confidence: 1.0 };
    }
    if (/^:[A-Za-z_]\w*[?!]?$/.test(rhs)) {
        return { type: 'Symbol', confidence: 1.0 };
    }

    return undefined;
}

/**
 * Blank out the contents of string literals and any trailing line comment so
 * the binding scanners never match inside them, while preserving column
 * positions. Like the classifier's gate this does not model `#{}`
 * interpolation or heredocs, which is acceptable for a name-collection pass.
 */
function stripStringsAndComments(text: string): string {
    let out = '';
    let inString = false;
    let quote = '';

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (inString) {
            if (char === '\\') {
                out += ' ';
                if (i + 1 < text.length) {
                    out += ' ';
                    i++;
                }
                continue;
            }
            if (char === quote) {
                inString = false;
                quote = '';
                out += char;
            } else {
                out += ' ';
            }
            continue;
        }

        if (char === '#') {
            break; // rest of the line is a comment
        }

        if (char === '"' || char === "'") {
            inString = true;
            quote = char;
        }

        out += char;
    }

    return out;
}

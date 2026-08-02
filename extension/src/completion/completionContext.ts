import * as vscode from 'vscode';
import { getRubyReceiverAtPosition } from '../shared/rubyToken';

/**
 * The grammatical situation the cursor is in, which decides what kinds of
 * candidates are worth offering. Ruby has no single "identifier" position:
 * a `.` means "members of the receiver", a leading `@` means "instance
 * variables of the enclosing object", a bare lowercase word could be a local,
 * a method on `self`, or a keyword. Classifying this up front lets the
 * provider ask the index only the questions that can produce useful answers.
 */
export type CompletionContextKind =
    | 'member'        // after `.` or `&.`  -> methods of the receiver's type
    | 'scoped'        // after `::`         -> constants/methods under a namespace
    | 'constant'      // Capitalized bareword -> classes, modules, constants
    | 'bareword'      // lowercase word     -> locals, self methods, keywords
    | 'instance_var'  // `@foo`             -> instance variables of self
    | 'class_var'     // `@@foo`            -> class variables
    | 'global_var'    // `$foo`             -> global variables
    | 'symbol'        // `:foo`             -> known symbol names
    | 'require_path'  // inside require '…' -> require/load path segments
    | 'none';         // comment / string / nothing completable

export interface CompletionContext {
    kind: CompletionContextKind;

    /** The partial identifier already typed; used to filter candidates. */
    prefix: string;

    /** Range the accepted completion should replace (the typed prefix). */
    replaceRange: vscode.Range;

    /**
     * For `member`/`scoped`: the receiver expression text, e.g. `user`,
     * `order.line_items`, or `Foo::Bar`. Undefined when the receiver is an
     * expression the lightweight extractor cannot name (`[1, 2].`).
     */
    receiver?: string;

    /** For `member`: true when the call used safe navigation (`&.`). */
    safeNavigation?: boolean;

    /** For `require_path`: the partial path inside the quotes. */
    requirePath?: string;
}

const NONE = (position: vscode.Position): CompletionContext => ({
    kind: 'none',
    prefix: '',
    replaceRange: new vscode.Range(position, position)
});

/** Identifier fragment being typed immediately to the left of the cursor. */
const TRAILING_WORD = /[A-Za-z_][A-Za-z0-9_]*[?!]?$/;

/** `require`/`require_relative`/`load` with an unterminated quoted argument. */
const REQUIRE_PATH = /(?:require|require_relative|load)\s+(['"])([^'"]*)$/;

/** A constant path such as `Foo` or `Foo::Bar` anchored to the end of text. */
const CONSTANT_PATH = /[A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*$/;

/**
 * Classify what the cursor is positioned to complete.
 *
 * The classifier is single-line and allocation-light: it inspects only the
 * text of the current line up to the cursor, so it stays fast enough to run on
 * every keystroke. It never parses the buffer — receiver typing is delegated to
 * the shared {@link getRubyReceiverAtPosition} helper that also backs
 * go-to-definition, keeping both features in agreement about what a "receiver"
 * is.
 */
export function classifyCompletionContext(
    document: vscode.TextDocument,
    position: vscode.Position
): CompletionContext {
    const lineText = document.lineAt(position.line).text;
    const textBefore = lineText.slice(0, position.character);

    // A require/load path lives inside a string, so it must be recognised
    // before the string guard below rejects everything else in quotes.
    const requireMatch = textBefore.match(REQUIRE_PATH);
    if (requireMatch) {
        const requirePath = requireMatch[2];
        return {
            kind: 'require_path',
            prefix: requirePath,
            requirePath,
            replaceRange: new vscode.Range(
                new vscode.Position(position.line, position.character - requirePath.length),
                position
            )
        };
    }

    // Do not complete inside comments or ordinary string literals.
    const state = scanStringComment(textBefore);
    if (state.inComment || state.inString) {
        return NONE(position);
    }

    const wordMatch = textBefore.match(TRAILING_WORD);
    const prefix = wordMatch ? wordMatch[0] : '';
    const fragStart = position.character - prefix.length;
    const fragPosition = new vscode.Position(position.line, fragStart);
    const replaceRange = new vscode.Range(fragPosition, position);
    const beforeFrag = textBefore.slice(0, fragStart);

    // --- member / scoped: something to the left ends in `.`, `&.`, or `::` ---

    if (beforeFrag.endsWith('::')) {
        const namespace = beforeFrag.slice(0, -2).match(CONSTANT_PATH);
        return {
            kind: 'scoped',
            prefix,
            replaceRange,
            receiver: namespace ? namespace[0] : undefined
        };
    }

    if (beforeFrag.endsWith('&.') || endsWithMethodDot(beforeFrag)) {
        const safeNavigation = beforeFrag.endsWith('&.');
        return {
            kind: 'member',
            prefix,
            replaceRange,
            safeNavigation,
            receiver: getRubyReceiverAtPosition(document, position, replaceRange)
        };
    }

    // --- sigil-led variables: the sigils sit just left of the word fragment ---

    if (beforeFrag.endsWith('@@')) {
        return { kind: 'class_var', prefix, replaceRange };
    }

    if (beforeFrag.endsWith('@')) {
        return { kind: 'instance_var', prefix, replaceRange };
    }

    if (beforeFrag.endsWith('$')) {
        return { kind: 'global_var', prefix, replaceRange };
    }

    // A leading `:` is a symbol only when it starts a new token (`foo(:bar`),
    // not when it closes a hash label (`foo(bar:`) — those are value positions.
    if (beforeFrag.endsWith(':') && !/[A-Za-z0-9_]$/.test(beforeFrag.slice(0, -1))) {
        return { kind: 'symbol', prefix, replaceRange };
    }

    // --- bare identifier: constant vs everything else, decided by casing ---

    if (/^[A-Z]/.test(prefix)) {
        return { kind: 'constant', prefix, replaceRange };
    }

    return { kind: 'bareword', prefix, replaceRange };
}

/**
 * True when `text` ends with a method-call dot rather than a range operator.
 * `user.` is a call; `1..` / `1...` are ranges and must not trigger member
 * completion.
 */
function endsWithMethodDot(text: string): boolean {
    return text.endsWith('.') && !text.endsWith('..');
}

interface StringCommentState {
    inString: boolean;
    inComment: boolean;
}

/**
 * Single-pass, single-line scan that reports whether the cursor sits inside a
 * string literal or a line comment. It tracks quote state (honouring
 * backslash escapes) and treats the first unescaped `#` outside a string as the
 * start of a comment. This is a deliberately lightweight heuristic: it does not
 * model `#{}` interpolation, `%w[]` literals, or heredocs, which is acceptable
 * for a completion gate where the cost of a wrong guess is one spurious or
 * missing suggestion.
 */
function scanStringComment(text: string): StringCommentState {
    let inString = false;
    let quote = '';

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (inString) {
            if (char === '\\') {
                i++; // skip the escaped character
                continue;
            }
            if (char === quote) {
                inString = false;
                quote = '';
            }
            continue;
        }

        if (char === '#') {
            return { inString: false, inComment: true };
        }

        if (char === '"' || char === "'") {
            inString = true;
            quote = char;
        }
    }

    return { inString, inComment: false };
}

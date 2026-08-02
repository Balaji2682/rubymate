import { StubMethod, StubType } from './stubLoader';
import { firstParenGroup, splitTopLevel } from './sigUtils';

/**
 * A pragmatic reader for Sorbet RBI files (`.rbi`).
 *
 * Tapioca writes one RBI per gem into a project's `sorbet/rbi/gems/`, so for a
 * Rails app that uses Sorbet these files describe the exact framework version in
 * play — the completion knowledge base gets Rails from the same source of truth
 * the team already trusts, rather than a bundled guess. RBI is ordinary Ruby
 * with `sig { ... }` type annotations, and Tapioca emits it in a very regular,
 * consistently indented shape. That regularity is what makes a line-oriented
 * reader viable here: namespace blocks are matched by the indentation of their
 * `end`, method parameters come straight from the Ruby `def`, and the return
 * type is lifted from the preceding `sig`.
 *
 * Anything it cannot confidently interpret is skipped, never fatal.
 */
export function parseRbi(source: string): StubType[] {
    const types = new Map<string, StubType>();
    const frames: Frame[] = [];

    // A `sig { ... }` annotates the `def` that follows it; hold it until then.
    // Sorbet also writes `sig do ... end`, so a block form is gathered across
    // lines before the method it belongs to is seen.
    let pendingSig: string | undefined;
    let sigBuffer: string | undefined;

    const lines = source.split(/\r?\n/);
    for (const raw of lines) {
        const indent = leadingWidth(raw);
        const line = raw.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }

        // Gather a multi-line `sig do ... end` before anything else consumes it.
        if (sigBuffer !== undefined) {
            if (line === 'end') {
                pendingSig = sigBuffer;
                sigBuffer = undefined;
            } else {
                sigBuffer += ' ' + line;
            }
            continue;
        }

        const sig = matchSig(line);
        if (sig !== undefined) {
            if (sig.complete) {
                pendingSig = sig.text;
            } else {
                sigBuffer = sig.text;
            }
            continue;
        }

        const open = matchNamespaceOpen(line);
        if (open) {
            const namespaceStack = frames.filter(f => f.kind === 'namespace').map(f => f.name);
            const fqn = open.name
                ? qualify(namespaceStack, open.name)
                : namespaceStack.join('::');
            frames.push({ kind: open.singleton ? 'singleton' : 'namespace', name: open.name ?? '', indent });
            if (!open.singleton && open.name && !types.has(fqn)) {
                types.set(fqn, {
                    name: fqn,
                    kind: open.moduleKind ? 'module' : 'class',
                    superclass: open.superclass,
                    includes: [],
                    methods: []
                });
            }
            continue;
        }

        // `end` at the indentation of the innermost namespace/singleton frame
        // closes it. `end`s from `def`/`do`/control flow sit deeper and are
        // ignored, which is why method bodies never disturb the stack.
        if (line === 'end') {
            const top = frames[frames.length - 1];
            if (top && top.indent === indent) {
                frames.pop();
            }
            continue;
        }

        const currentFqn = frames.filter(f => f.kind === 'namespace').map(f => f.name).join('::');
        const current = types.get(currentFqn);
        if (!current) {
            pendingSig = undefined;
            continue;
        }

        const mixin = matchMixin(line);
        if (mixin) {
            if (current.includes && !current.includes.includes(mixin)) {
                current.includes.push(mixin);
            }
            continue;
        }

        const def = matchDef(line);
        if (def) {
            const insideSingleton = frames[frames.length - 1]?.kind === 'singleton';
            const method = buildMethod(def, pendingSig, insideSingleton);
            current.methods!.push(method);
        }
        pendingSig = undefined;
    }

    return [...types.values()];
}

/** An open `class`/`module`/`class << self` block and its indentation. */
interface Frame {
    kind: 'namespace' | 'singleton';
    name: string;
    indent: number;
}

const CONST_PATH = '[A-Z]\\w*(?:::[A-Z]\\w*)*';

interface NamespaceOpen {
    moduleKind: boolean;
    /** Undefined for `class << self`, which opens a singleton without a name. */
    name?: string;
    superclass?: string;
    singleton: boolean;
}

const CLASS_OPEN = new RegExp(`^class\\s+(${CONST_PATH})(?:\\s*<\\s*(${CONST_PATH}))?`);
const MODULE_OPEN = new RegExp(`^module\\s+(${CONST_PATH})`);

function matchNamespaceOpen(line: string): NamespaceOpen | undefined {
    if (line === 'class << self') {
        return { moduleKind: false, singleton: true };
    }
    const cls = line.match(CLASS_OPEN);
    if (cls) {
        return { moduleKind: false, name: cls[1], superclass: cls[2], singleton: false };
    }
    const mod = line.match(MODULE_OPEN);
    if (mod) {
        return { moduleKind: true, name: mod[1], singleton: false };
    }
    return undefined;
}

const MIXIN = new RegExp(`^(?:include|prepend|extend)\\s+(${CONST_PATH})`);

function matchMixin(line: string): string | undefined {
    const match = line.match(MIXIN);
    return match ? match[1].replace(/^::/, '') : undefined;
}

interface SigMatch {
    text: string;
    complete: boolean;
}

/**
 * Recognise a `sig` line. The brace form `sig { ... }` is complete on one line;
 * the block form `sig do` starts a multi-line signature the caller gathers until
 * its matching `end`.
 */
function matchSig(line: string): SigMatch | undefined {
    const brace = line.match(/^sig\s*(?:\([^)]*\))?\s*\{(.*)\}\s*$/);
    if (brace) {
        return { text: brace[1], complete: true };
    }
    if (/^sig\s*(?:\([^)]*\))?\s*do\b/.test(line)) {
        return { text: '', complete: false };
    }
    return undefined;
}

interface DefMatch {
    name: string;
    params: string;
    classMethod: boolean;
}

// `def name(params)` / `def self.name(params)` / `def name` / `def name; end`.
// Only the name and, if present, the opening `(` of the parameter list matter;
// whatever body follows (`; end` or a later `end`) is left unmatched.
const DEF = /^def\s+(self\.)?([A-Za-z_]\w*[?!=]?|\[\]=?|[<>=!]+|[-+*/%~^&|]|<<|>>|<=>)\s*(\(.*)?/;

function matchDef(line: string): DefMatch | undefined {
    const match = line.match(DEF);
    if (!match) {
        return undefined;
    }
    const params = match[3] ? firstParenGroup(match[3]) ?? '' : '';
    return {
        name: match[2],
        params,
        classMethod: match[1] !== undefined
    };
}

/**
 * Build a {@link StubMethod} from a `def` and its preceding `sig`. Parameters
 * come from the Ruby `def` list verbatim — it is already in the compact form the
 * loader parses (`name`, `name = default`, `key:`, `*rest`, `**opts`, `&block`).
 * The return type is lifted from the sig's `.returns(...)`.
 */
function buildMethod(def: DefMatch, sig: string | undefined, insideSingleton: boolean): StubMethod {
    const method: StubMethod = { name: def.name };

    const params = splitTopLevel(def.params, ',')
        .map(p => normaliseParam(p))
        .filter((p): p is string => p !== undefined);
    if (params.length > 0) {
        method.params = params;
    }

    if (def.classMethod || insideSingleton) {
        method.classMethod = true;
    }

    const returns = sig ? extractReturn(sig) : undefined;
    if (returns) {
        method.returns = returns;
    }
    return method;
}

/**
 * Clean a single Ruby parameter for the compact param form. A default value is
 * kept as written; Sorbet's `T.untyped` default placeholder and stray type
 * annotations are dropped so only source-like specs remain.
 */
function normaliseParam(part: string): string | undefined {
    const text = part.trim();
    if (!text) {
        return undefined;
    }
    // Tapioca writes optional defaults as `= T.unsafe(nil)`; unwrap the marker
    // to the value it stands for so the spec reads like ordinary Ruby.
    return text.replace(/T\.unsafe\(([^)]*)\)/g, '$1');
}

/**
 * The `returns(Type)` of a Sorbet sig, normalised to a bare class name. The
 * `returns` call may stand alone (`sig { returns(X) }`) or be chained after
 * `params` (`sig { params(...).returns(X) }`), so it is matched by word rather
 * than by a leading dot.
 */
function extractReturn(sig: string): string | undefined {
    const match = sig.match(/\breturns\s*\(/);
    if (match?.index === undefined) {
        return undefined;
    }
    const group = firstParenGroup(sig.slice(match.index));
    return group ? normaliseSorbetType(group) : undefined;
}

/**
 * Reduce a Sorbet type to a single bare class name usable as a completion
 * receiver: unwrap `T.nilable`/`T.any`, map `T::Array`/`T::Hash`/`T::Boolean`,
 * strip generic arguments, and treat the untyped/self placeholders as unknown.
 */
function normaliseSorbetType(type: string): string | undefined {
    let text = type.trim();

    const nilable = text.match(/^T\.nilable\((.*)\)$/);
    if (nilable) {
        text = nilable[1].trim();
    }
    const any = text.match(/^T\.any\((.*)\)$/);
    if (any) {
        text = splitTopLevel(any[1], ',')[0].trim();
    }

    if (text === 'T::Boolean') {
        return 'Boolean';
    }
    const generic = text.match(/^T::(Array|Hash|Set|Range|Enumerable|Enumerator)\b/);
    if (generic) {
        return generic[1];
    }

    if (/^T\./.test(text) || text === 'void' || text === 'nil') {
        return undefined;
    }

    text = text.replace(/\[.*\]$/, '').replace(/^::/, '');
    return /^[A-Z]\w*(?:::[A-Z]\w*)*$/.test(text) ? text : undefined;
}

function qualify(stack: string[], name: string): string {
    return stack.length > 0 ? `${stack.join('::')}::${name}` : name;
}

function leadingWidth(line: string): number {
    const match = line.match(/^[ \t]*/);
    return match ? match[0].length : 0;
}

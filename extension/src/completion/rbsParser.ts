import { StubMethod, StubType } from './stubLoader';
import { bracketDepth, firstParenGroup, splitTopLevel } from './sigUtils';

/**
 * A pragmatic reader for Ruby RBS signature files (`.rbs`).
 *
 * RBS is the language Ruby ships its own core/stdlib type signatures in, so
 * parsing it lets the completion knowledge base track whatever Ruby version the
 * user actually has installed instead of a hand-maintained snapshot. This is not
 * a full RBS parser — generics, self-types, and overload alternatives beyond the
 * first are intentionally flattened away. The goal is the information member
 * completion needs: which types exist, what they inherit and include, and each
 * method's name, a best-effort parameter list, and a resolvable return type.
 *
 * The scan is line-oriented and tolerant: an unrecognised construct is skipped
 * rather than aborting the file, because a single exotic signature must never
 * cost the hundreds of ordinary ones around it.
 */
export function parseRbs(source: string): StubType[] {
    const types = new Map<string, StubType>();

    // Namespace segments of the currently open `class`/`module` blocks. Nested
    // definitions compose their fully-qualified name from this stack, so a
    // `class Base` inside `module ActiveRecord` becomes `ActiveRecord::Base`.
    const stack: string[] = [];

    const lines = source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const raw = stripComment(lines[i]);
        const line = raw.trim();
        if (!line) {
            continue;
        }

        const open = matchDefinitionOpen(line);
        if (open) {
            const fqn = qualify(stack, open.name);
            stack.push(open.name);
            // An interface (`interface _Foo`) has no runtime methods to offer;
            // record nothing but still track the block so its `end` balances.
            if (open.kind !== 'interface' && !types.has(fqn)) {
                types.set(fqn, {
                    name: fqn,
                    kind: open.kind,
                    superclass: open.superclass ? qualifyReference(open.superclass) : undefined,
                    includes: [],
                    methods: []
                });
            }
            continue;
        }

        if (line === 'end' || line.startsWith('end ') || line.startsWith('end#')) {
            stack.pop();
            continue;
        }

        const current = types.get(stack.join('::'));
        if (!current) {
            continue;
        }

        const mixin = matchMixin(line);
        if (mixin) {
            const resolved = qualifyReference(mixin);
            if (current.includes && !current.includes.includes(resolved)) {
                current.includes.push(resolved);
            }
            continue;
        }

        const def = matchDef(line);
        if (def) {
            // A signature may span several lines (overload alternatives lead
            // with `|`, and bracketed types wrap); gather the whole thing first.
            let signature = def.signature;
            while (needsContinuation(signature, lines[i + 1])) {
                i++;
                signature += ' ' + stripComment(lines[i]).trim();
            }
            const method = buildMethod(def.name, def.classMethod, signature);
            if (method) {
                current.methods!.push(method);
            }
        }
    }

    return [...types.values()];
}

interface DefinitionOpen {
    kind: 'class' | 'module' | 'interface';
    name: string;
    superclass?: string;
}

/** A constant path segment, e.g. `Base` or `ActiveRecord::Base`. */
const CONST_PATH = '[A-Z]\\w*(?:::[A-Z]\\w*)*';
// `class Name[T] < Super[T]`, `module Name[T]`, `interface _Name`. Generic
// parameter lists and any self-type annotation are discarded.
const DEFINITION_OPEN = new RegExp(
    `^(class|module|interface)\\s+(_?${CONST_PATH})(?:\\[[^\\]]*\\])?\\s*(?:<\\s*(${CONST_PATH})(?:\\[[^\\]]*\\])?)?`
);

function matchDefinitionOpen(line: string): DefinitionOpen | undefined {
    const match = line.match(DEFINITION_OPEN);
    if (!match) {
        return undefined;
    }
    return {
        kind: match[1] as DefinitionOpen['kind'],
        name: match[2],
        superclass: match[3]
    };
}

const MIXIN = new RegExp(`^(?:include|prepend|extend)\\s+(${CONST_PATH})`);

function matchMixin(line: string): string | undefined {
    const match = line.match(MIXIN);
    return match ? match[1] : undefined;
}

interface DefMatch {
    name: string;
    classMethod: boolean;
    signature: string;
}

// `def name: ...`, `def self.name: ...`, `def self?.name: ...`. RBS method
// names may be operators (`[]`, `<=>`, `+`) or end in `?`/`!`/`=`.
const DEF = /^def\s+(self\??\.)?([A-Za-z_]\w*[?!=]?|\[\]=?|[<>=!]+|[-+*/%~^&|]|<<|>>|<=>|===?|!=)\s*:\s*(.*)$/;

function matchDef(line: string): DefMatch | undefined {
    const match = line.match(DEF);
    if (!match) {
        return undefined;
    }
    return {
        name: match[2],
        classMethod: match[1] !== undefined,
        signature: match[3]
    };
}

/**
 * Whether a gathered signature is unfinished and the next line continues it.
 * Continuation shows up two ways in RBS: unbalanced brackets from a wrapped
 * type, or a fresh overload alternative that the next line begins with `|`.
 */
function needsContinuation(signature: string, next: string | undefined): boolean {
    if (next === undefined) {
        return false;
    }
    const trimmed = stripComment(next).trim();
    if (trimmed.startsWith('|')) {
        return true;
    }
    return bracketDepth(signature) > 0;
}

/**
 * Turn an RBS method signature into a {@link StubMethod}. Only the first
 * overload alternative is used; its first parenthesised group gives the
 * parameters, a trailing `{ ... }` block adds a `&block`, and the last top-level
 * `->` gives the return type.
 */
function buildMethod(name: string, classMethod: boolean, signature: string): StubMethod | undefined {
    // Keep only the first overload; later `| (...) -> ...` alternatives would
    // otherwise merge incompatible parameter lists.
    const firstAlternative = splitTopLevel(signature, '|')[0] ?? signature;

    const params = extractParams(firstAlternative);
    if (/\{[^}]*\}/.test(firstAlternative) || /\}\s*->/.test(firstAlternative)) {
        params.push('&block');
    }

    const method: StubMethod = { name };
    if (params.length > 0) {
        method.params = params;
    }
    if (classMethod) {
        method.classMethod = true;
    }
    const returns = extractReturn(firstAlternative);
    if (returns) {
        method.returns = returns;
    }
    return method;
}

/**
 * Compact parameter specs from the first `( ... )` group, in the form
 * {@link StubMethod.params} expects. RBS names are optional, so a nameless
 * positional type is given a synthetic `argN` name for display.
 */
function extractParams(signature: string): string[] {
    const group = firstParenGroup(signature);
    if (group === undefined || group.trim() === '') {
        return [];
    }

    const specs: string[] = [];
    let positional = 0;
    for (const rawPart of splitTopLevel(group, ',')) {
        const part = rawPart.trim();
        if (!part) {
            continue;
        }

        // Keyword parameter: `name: Type` or optional `?name: Type`. The colon
        // that separates a label from its type sits before any bracket.
        const keyword = part.match(/^\??([A-Za-z_]\w*):\s/);
        if (keyword) {
            specs.push(`${keyword[1]}:`);
            continue;
        }

        if (part.startsWith('**')) {
            specs.push(`**${trailingName(part) ?? 'opts'}`);
            continue;
        }
        if (part.startsWith('*')) {
            specs.push(`*${trailingName(part) ?? 'args'}`);
            continue;
        }

        const name = trailingName(part);
        specs.push(name ?? `arg${++positional}`);
    }
    return specs;
}

/** The parameter name RBS puts after the type, if any (`String name` -> `name`). */
function trailingName(part: string): string | undefined {
    const match = part.match(/([A-Za-z_]\w*)\s*$/);
    if (!match) {
        return undefined;
    }
    // A bare type such as `String` has no separate name; only treat the trailing
    // word as a name when something (the type) precedes it.
    const before = part.slice(0, part.length - match[1].length).trim();
    return before ? match[1] : undefined;
}

/** The last top-level `-> Type`, normalised to a bare resolvable class name. */
function extractReturn(signature: string): string | undefined {
    const parts = splitTopLevel(signature, '->');
    if (parts.length < 2) {
        return undefined;
    }
    return normaliseType(parts[parts.length - 1].trim());
}

/**
 * Reduce an RBS type expression to a single bare class name usable as a
 * completion receiver: strip leading `::`, generic arguments, and the nilable
 * `?`, take the first member of a union, and map RBS's lowercase aliases.
 */
function normaliseType(type: string): string | undefined {
    let text = type.trim();
    // Drop a trailing block-return artefact or anything after a top-level union.
    text = splitTopLevel(text, '|')[0].trim();
    text = text.replace(/\[[^\]]*\]/g, ''); // generic args
    text = text.replace(/^::/, '');
    text = text.replace(/\?$/, ''); // nilable

    switch (text) {
        case 'bool':
            return 'Boolean';
        case 'int':
            return 'Integer';
        case 'string':
            return 'String';
        case 'void':
        case 'nil':
        case 'untyped':
        case 'self':
        case 'instance':
        case 'class':
        case '':
            return undefined;
    }
    return /^[A-Z]\w*$/.test(text) ? text : undefined;
}

function qualify(stack: string[], name: string): string {
    return stack.length > 0 ? `${stack.join('::')}::${name}` : name;
}

/**
 * Resolve a referenced constant (a superclass or mixin) against the open
 * namespaces. An explicitly rooted `::Name` or an already-qualified `A::B` is
 * left as written; a bare name is reported unqualified, letting the inheritance
 * index link it wherever that constant is ultimately defined.
 */
function qualifyReference(name: string): string {
    return name.replace(/^::/, '');
}

/** Drop a trailing `#` line comment, preserving `#` inside no string RBS has. */
function stripComment(line: string): string {
    const hash = line.indexOf('#');
    return hash === -1 ? line : line.slice(0, hash);
}

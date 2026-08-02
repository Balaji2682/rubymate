/**
 * Small bracket-aware string helpers shared by the RBS and Sorbet RBI readers.
 * Both signature languages nest types inside `()`, `[]`, and `{}`, so naive
 * splitting on a comma or an arrow would tear `Hash[K, V]` or `(A) -> B` apart.
 * These utilities respect nesting depth so the parsers can treat a signature as
 * a shallow list of top-level parts.
 */

/** Net bracket depth of `text` (opens minus closes across `()[]{}`). */
export function bracketDepth(text: string): number {
    let depth = 0;
    for (const char of text) {
        if (char === '(' || char === '[' || char === '{') {
            depth++;
        } else if (char === ')' || char === ']' || char === '}') {
            depth--;
        }
    }
    return depth;
}

/**
 * Split `text` on every occurrence of `separator` that sits at bracket depth
 * zero, leaving separators nested inside brackets untouched. The separator may
 * be one or more characters (`,`, `->`, `|`).
 */
export function splitTopLevel(text: string, separator: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '(' || char === '[' || char === '{') {
            depth++;
        } else if (char === ')' || char === ']' || char === '}') {
            depth--;
        }
        if (depth === 0 && text.startsWith(separator, i)) {
            parts.push(current);
            current = '';
            i += separator.length - 1;
            continue;
        }
        current += char;
    }
    parts.push(current);
    return parts;
}

/** Contents of the first balanced `( ... )` group in `text`, or undefined. */
export function firstParenGroup(text: string): string | undefined {
    const start = text.indexOf('(');
    if (start === -1) {
        return undefined;
    }
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        const char = text[i];
        if (char === '(') {
            depth++;
        } else if (char === ')') {
            depth--;
            if (depth === 0) {
                return text.slice(start + 1, i);
            }
        }
    }
    return undefined;
}

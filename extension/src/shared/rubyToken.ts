import * as vscode from 'vscode';

export interface RubyToken {
    text: string;
    range: vscode.Range;
}

const RUBY_TOKEN_PATTERN = /[A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*|[@$]{0,2}[A-Za-z_][A-Za-z0-9_]*(?:[?!=])?/g;
const RUBY_TOKEN_BOUNDARY = '[A-Za-z0-9_?!=$:]';

export function getRubyTokenAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position
): RubyToken | undefined {
    const lineText = document.lineAt(position.line).text;
    RUBY_TOKEN_PATTERN.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = RUBY_TOKEN_PATTERN.exec(lineText)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (position.character >= start && position.character <= end) {
            const previousNonSpace = lineText.slice(0, start).trimEnd().slice(-1);
            const setterSuffix = /^[a-z_][A-Za-z0-9_]*$/.test(match[0])
                && previousNonSpace === '.'
                && /^\s*=/.test(lineText.slice(end))
                ? '='
                : '';
            return {
                text: `${match[0]}${setterSuffix}`,
                range: new vscode.Range(
                    new vscode.Position(position.line, start),
                    new vscode.Position(position.line, end)
                )
            };
        }
    }

    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
        return undefined;
    }

    return {
        text: document.getText(wordRange),
        range: wordRange
    };
}

/**
 * Extract the receiver expression of a method call at the given token.
 * For `user.name` at `name` returns `user`; for `User.find` returns `User`;
 * for `order.line_items.each` at `each` returns `order.line_items`.
 * Returns undefined when the token is not a `.`/`&.` method call.
 */
export function getRubyReceiverAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    tokenRange: vscode.Range
): string | undefined {
    const lineText = document.lineAt(tokenRange.start.line).text;
    let prefix = lineText.slice(0, tokenRange.start.character).trimEnd();

    // Distinguish a method call from a range operator (`..`, `...`).
    if (prefix.endsWith('&.')) {
        prefix = prefix.slice(0, -2);
    } else if (prefix.endsWith('.') && !prefix.endsWith('..')) {
        prefix = prefix.slice(0, -1);
    } else {
        return undefined;
    }

    prefix = prefix.trimEnd();
    const receiverMatch = prefix.match(
        /[@$]{0,2}[A-Za-z_][A-Za-z0-9_]*(?:(?:\.|::)[A-Za-z_][A-Za-z0-9_]*[?!]?)*[?!]?$/
    );
    return receiverMatch ? receiverMatch[0] : undefined;
}

export function getRubyLookupCandidates(word: string): string[] {
    const normalized = word
        .replace(/^:+/, '')
        .replace(/^@@?/, '')
        .replace(/^\$/, '');

    const candidates = [normalized];
    if (normalized.includes('::')) {
        candidates.push(normalized.split('::').pop()!);
    }

    return Array.from(new Set(candidates.filter(Boolean)));
}

export function rubyReferencePattern(word: string, flags = 'g'): RegExp {
    const escapedWord = escapeRegExp(word);
    return new RegExp(`(?<!${RUBY_TOKEN_BOUNDARY})${escapedWord}(?!${RUBY_TOKEN_BOUNDARY})`, flags);
}

export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

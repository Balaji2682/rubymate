import * as vscode from 'vscode';
import { CoreRubyIndex, RubySymbol } from '../advancedIndexer';
import { ParserService } from '../parsing';

/**
 * SymbolLinker — Resolves metaprogramming relationships between symbols.
 *
 * When a user renames a symbol, this module discovers all
 * "linked" symbols that should be renamed in concert.
 *
 * Examples:
 *   attr_accessor :name  →  links  @name, name, name=
 *   alias_method :new, :old  →  links  new ↔ old
 *   delegate :foo, to: :bar  →  links  foo on delegator
 */

// ── Public types ─────────────────────────────────────────────────────

export type LinkKind =
    | 'attr_reader'
    | 'attr_writer'
    | 'attr_accessor'
    | 'alias'
    | 'delegate'
    | 'send'
    | 'respond_to';

export interface LinkedSymbol {
    /** The derived name that must also be renamed */
    name: string;
    /** Why this name is linked */
    kind: LinkKind;
    /** The original symbol that spawned it */
    originalName: string;
    /** Where this linked usage lives (if known) */
    location?: vscode.Location;
}

// ── Regex patterns ───────────────────────────────────────────────────

/** Matches attr_reader / attr_writer / attr_accessor declarations */
const ATTR_PATTERN = /\b(attr_accessor|attr_reader|attr_writer)\b\s+(.+)/;

/** Matches alias_method :new_name, :old_name */
const ALIAS_METHOD_PATTERN = /\balias_method\s+:(\w+[?!=]?)\s*,\s*:(\w+[?!=]?)/;

/** Matches alias new_name old_name (Ruby keyword) */
const ALIAS_KEYWORD_PATTERN = /\balias\s+(\w+[?!=]?)\s+(\w+[?!=]?)/;

/** Matches delegate :method, to: :target */
const DELEGATE_PATTERN = /\bdelegate\s+((?::[\w?!=]+(?:\s*,\s*)?)+)\s*,\s*to:\s*:(\w+)/;

/** Matches send(:method) / __send__(:method) / public_send(:method) */
const SEND_PATTERN = /\b(?:send|__send__|public_send)\s*\(\s*:(\w+[?!=]?)/g;

/** Matches respond_to?(:method) */
const RESPOND_TO_PATTERN = /\brespond_to\?\s*\(\s*:(\w+[?!=]?)/g;

// ── Class ────────────────────────────────────────────────────────────

export class SymbolLinker {
    constructor(
        private readonly indexer: CoreRubyIndex,
        private readonly parserService: ParserService
    ) {}

    /**
     * Given a symbol name and the document it appears in, find all linked symbols
     * that should also be renamed when this symbol is renamed.
     */
    async findLinkedSymbols(
        symbolName: string,
        document: vscode.TextDocument
    ): Promise<LinkedSymbol[]> {
        const links: LinkedSymbol[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // ── attr_accessor / attr_reader / attr_writer ────────
            this.checkAttrDeclarations(line, i, symbolName, document.uri, links);

            // ── alias_method / alias ─────────────────────────────
            this.checkAliasDeclarations(line, i, symbolName, document.uri, links);

            // ── delegate ─────────────────────────────────────────
            this.checkDelegateDeclarations(line, i, symbolName, document.uri, links);

            // ── send / respond_to? ───────────────────────────────
            this.checkDynamicInvocations(line, i, symbolName, document.uri, links);
        }

        return this.deduplicateLinks(links);
    }

    /**
     * For a given attr-style declaration, returns all derived names that
     * should be renamed in concert.
     *
     * attr_accessor :name  →  ['name', 'name=', '@name']
     * attr_reader   :name  →  ['name', '@name']
     * attr_writer   :name  →  ['name=', '@name']
     */
    getAttrDerivedNames(attrName: string, attrType: 'attr_accessor' | 'attr_reader' | 'attr_writer'): string[] {
        const derived: string[] = [];

        switch (attrType) {
            case 'attr_accessor':
                derived.push(attrName, `${attrName}=`, `@${attrName}`);
                break;
            case 'attr_reader':
                derived.push(attrName, `@${attrName}`);
                break;
            case 'attr_writer':
                derived.push(`${attrName}=`, `@${attrName}`);
                break;
        }

        return derived;
    }

    // ── Private helpers ──────────────────────────────────────────────

    private checkAttrDeclarations(
        line: string,
        lineIndex: number,
        symbolName: string,
        uri: vscode.Uri,
        links: LinkedSymbol[]
    ): void {
        const match = ATTR_PATTERN.exec(line);
        if (!match) { return; }

        const attrType = match[1] as 'attr_accessor' | 'attr_reader' | 'attr_writer';
        const symbols = match[2].match(/:(\w+)/g);
        if (!symbols) { return; }

        const attrNames = symbols.map(s => s.replace(':', ''));
        const bareSymbol = symbolName.replace(/^@/, '').replace(/=$/, '');

        if (!attrNames.includes(bareSymbol)) { return; }

        const location = new vscode.Location(uri, new vscode.Position(lineIndex, 0));
        const derived = this.getAttrDerivedNames(bareSymbol, attrType);

        for (const name of derived) {
            if (name !== symbolName) {
                links.push({
                    name,
                    kind: attrType,
                    originalName: symbolName,
                    location
                });
            }
        }
    }

    private checkAliasDeclarations(
        line: string,
        lineIndex: number,
        symbolName: string,
        uri: vscode.Uri,
        links: LinkedSymbol[]
    ): void {
        const location = new vscode.Location(uri, new vscode.Position(lineIndex, 0));

        // alias_method :new_name, :old_name
        const aliasMethodMatch = ALIAS_METHOD_PATTERN.exec(line);
        if (aliasMethodMatch) {
            const [, newName, oldName] = aliasMethodMatch;
            if (symbolName === oldName) {
                links.push({ name: newName, kind: 'alias', originalName: symbolName, location });
            } else if (symbolName === newName) {
                links.push({ name: oldName, kind: 'alias', originalName: symbolName, location });
            }
        }

        // alias new_name old_name (Ruby keyword)
        const aliasKeywordMatch = ALIAS_KEYWORD_PATTERN.exec(line);
        if (aliasKeywordMatch) {
            const [, newName, oldName] = aliasKeywordMatch;
            if (symbolName === oldName) {
                links.push({ name: newName, kind: 'alias', originalName: symbolName, location });
            } else if (symbolName === newName) {
                links.push({ name: oldName, kind: 'alias', originalName: symbolName, location });
            }
        }
    }

    private checkDelegateDeclarations(
        line: string,
        lineIndex: number,
        symbolName: string,
        uri: vscode.Uri,
        links: LinkedSymbol[]
    ): void {
        const match = DELEGATE_PATTERN.exec(line);
        if (!match) { return; }

        const methods = match[1].match(/:(\w+[?!=]?)/g);
        if (!methods) { return; }

        const methodNames = methods.map(m => m.replace(':', ''));
        if (methodNames.includes(symbolName)) {
            const location = new vscode.Location(uri, new vscode.Position(lineIndex, 0));
            links.push({
                name: symbolName,
                kind: 'delegate',
                originalName: symbolName,
                location
            });
        }
    }

    private checkDynamicInvocations(
        line: string,
        lineIndex: number,
        symbolName: string,
        uri: vscode.Uri,
        links: LinkedSymbol[]
    ): void {
        const location = new vscode.Location(uri, new vscode.Position(lineIndex, 0));

        // send(:method_name)
        SEND_PATTERN.lastIndex = 0;
        let sendMatch: RegExpExecArray | null;
        while ((sendMatch = SEND_PATTERN.exec(line)) !== null) {
            if (sendMatch[1] === symbolName) {
                links.push({ name: symbolName, kind: 'send', originalName: symbolName, location });
            }
        }

        // respond_to?(:method_name)
        RESPOND_TO_PATTERN.lastIndex = 0;
        let respondMatch: RegExpExecArray | null;
        while ((respondMatch = RESPOND_TO_PATTERN.exec(line)) !== null) {
            if (respondMatch[1] === symbolName) {
                links.push({ name: symbolName, kind: 'respond_to', originalName: symbolName, location });
            }
        }
    }

    private deduplicateLinks(links: LinkedSymbol[]): LinkedSymbol[] {
        const seen = new Set<string>();
        return links.filter(link => {
            const key = `${link.name}:${link.kind}:${link.location?.uri.toString()}:${link.location?.range.start.line}`;
            if (seen.has(key)) { return false; }
            seen.add(key);
            return true;
        });
    }
}

import * as fs from 'fs';
import * as vscode from 'vscode';
import {
    ClassInfo,
    MethodInfo,
    ModuleInfo,
    ParameterInfo,
    SemanticGraphBuilder
} from '../indexing/semanticGraph';
import { parseRbi } from './rbiParser';
import { parseRbs } from './rbsParser';
import { discoverMachineSources, MachineSigSources } from './sigSources';
import { readStubCache, STUB_CACHE_SCHEMA, StubCacheKey, writeStubCache } from './stubCache';
import coreStubs from './stubs/core.json';
import railsStubs from './stubs/rails.json';

/**
 * Bundled knowledge base of Ruby core and Rails types.
 *
 * The extension cannot rely on the user's workspace to define `String`,
 * `Array`, `ActiveRecord::Base`, and friends — they live in the interpreter and
 * in gems that are rarely parsed. Without them, member completion on the most
 * common receivers would offer nothing. These hand-authored stubs fill that gap
 * by feeding the same semantic graph the parser populates, so a user model that
 * inherits `ApplicationRecord` transitively resolves `where`, `save`, and the
 * rest through the ordinary method-resolution path — no special-casing in the
 * completion provider.
 */

/** A single method's shape as authored in the stub JSON. */
export interface StubMethod {
    name: string;
    /**
     * Parameter specs in a compact source-like form: `name`, `name = default`,
     * `key:`, `key: default`, `*rest`, `**opts`, `&block`.
     */
    params?: string[];
    returns?: string;
    /** `true` for methods invoked on the class itself (`User.where`). */
    classMethod?: boolean;
    doc?: string;
}

/** A class or module definition as authored in the stub JSON. */
export interface StubType {
    name: string;
    kind: 'class' | 'module';
    /** Direct superclass (classes only). */
    superclass?: string;
    /** Included modules, contributing their methods through the MRO. */
    includes?: string[];
    methods?: StubMethod[];
}

export interface StubFile {
    types: StubType[];
}

/** Outcome of registering the bundled stubs, for logging and later enrichment. */
export interface StubLoadResult {
    moduleCount: number;
    classCount: number;
    methodCount: number;
    /**
     * `methodId -> documentation`, letting the completion provider attach a
     * description to a stub method it finds through {@link MethodInfo.id}
     * (which carries no doc field of its own).
     */
    docs: Map<string, string>;
}

// Stub definitions have no source file; they share one synthetic location so
// the graph's location-keyed bookkeeping stays consistent without pretending
// they live anywhere real.
const STUB_LOCATION = new vscode.Location(
    vscode.Uri.parse('rubymate-stub:builtin'),
    new vscode.Range(0, 0, 0, 0)
);

/** Options controlling how {@link loadCompletionStubs} sources its signatures. */
export interface CompletionStubOptions {
    /** Workspace folder used to discover a per-project Ruby and Rails RBI. */
    cwd: string;
    /** File the parsed machine signatures are cached to between activations. */
    cacheFile: string;
    /** Optional sink for a one-line summary of what was loaded. */
    log?: (message: string) => void;
}

/**
 * Load the completion knowledge base into the semantic graph, preferring the
 * signatures already on the user's machine and falling back to the bundled
 * stubs per layer.
 *
 * Core comes from the installed `rbs` gem when present, otherwise from bundled
 * `core.json`; Rails comes from the project's Sorbet RBI when present, otherwise
 * from bundled `rails.json`. The two layers are independent, so a machine with
 * RBS but no Sorbet still gets accurate core plus the bundled Rails floor.
 * Curated docs from the bundled stubs are seeded first and act as an overlay,
 * so a machine-sourced method still shows a description when one exists.
 */
export function loadCompletionStubs(
    graph: SemanticGraphBuilder,
    options: CompletionStubOptions
): StubLoadResult {
    const result = emptyResult();
    seedBundledDocs(result.docs);

    const machine = discoverMachineSources(options.cwd);
    const machineTypes = loadMachineTypes(machine, options.cacheFile);

    const types = [...machineTypes];
    if (!machine.rbsCore) {
        types.push(...(coreStubs as StubFile).types);
    }
    if (!machine.rbiGems) {
        types.push(...(railsStubs as StubFile).types);
    }

    registerTypes(graph, types, result);

    options.log?.(
        `Completion stubs: ${result.classCount} classes, ${result.moduleCount} modules, ` +
        `${result.methodCount} methods ` +
        `(core: ${machine.rbsCore ? `rbs ${machine.rubyVersion ?? '?'}` : 'bundled'}, ` +
        `rails: ${machine.rbiGems ? `rbi ${machine.railsVersion ?? '?'}` : 'bundled'})`
    );

    return result;
}

/**
 * Register only the bundled core and Rails stubs, ignoring the machine. Kept as
 * the simple, dependency-free path for tests and environments where no workspace
 * folder is available.
 */
export function loadBundledStubs(graph: SemanticGraphBuilder): StubLoadResult {
    const result = emptyResult();
    const types = [
        ...(coreStubs as StubFile).types,
        ...(railsStubs as StubFile).types
    ];
    registerTypes(graph, types, result);
    return result;
}

function emptyResult(): StubLoadResult {
    return {
        moduleCount: 0,
        classCount: 0,
        methodCount: 0,
        docs: new Map<string, string>()
    };
}

/**
 * Register a set of stub types into the graph. Modules are registered before
 * classes so a class's `includes` can link to an already-present module;
 * inheritance edges are order-independent because the inheritance index
 * auto-creates any missing parent entry.
 */
function registerTypes(
    graph: SemanticGraphBuilder,
    types: StubType[],
    result: StubLoadResult
): void {
    // A type may be reopened across several signature files; fold duplicates so
    // one class ends up with the union of its methods rather than the last
    // definition silently winning.
    const merged = mergeStubTypes(types);

    for (const type of merged) {
        if (type.kind === 'module') {
            registerType(graph, type, result);
        }
    }
    for (const type of merged) {
        if (type.kind === 'class') {
            registerType(graph, type, result);
        }
    }
}

/**
 * Parse the machine's signature files into stub types, reading a cached parse
 * when the environment is unchanged. A parse miss reparses and repopulates the
 * cache; an empty environment yields no types and leaves both layers to the
 * bundled fallback.
 */
function loadMachineTypes(machine: MachineSigSources, cacheFile: string): StubType[] {
    if (!machine.rbsCore && !machine.rbiGems) {
        return [];
    }

    const key: StubCacheKey = {
        rubyVersion: machine.rubyVersion,
        railsVersion: machine.railsVersion,
        coreMtime: machine.rbsCore?.mtime,
        rbiMtime: machine.rbiGems?.mtime,
        schema: STUB_CACHE_SCHEMA
    };

    const cached = readStubCache(cacheFile, key);
    if (cached) {
        return cached;
    }

    const types = parseMachineSources(machine);
    if (types.length > 0) {
        writeStubCache(cacheFile, key, types);
    }
    return types;
}

/** Read and parse every discovered signature file into stub types. */
function parseMachineSources(machine: MachineSigSources): StubType[] {
    const types: StubType[] = [];

    for (const file of machine.rbsCore?.files ?? []) {
        const text = readFileOrEmpty(file);
        if (text) {
            types.push(...parseRbs(text));
        }
    }
    for (const file of machine.rbiGems?.files ?? []) {
        const text = readFileOrEmpty(file);
        if (text) {
            types.push(...parseRbi(text));
        }
    }

    return types;
}

function readFileOrEmpty(file: string): string {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return '';
    }
}

/**
 * Fold types that share a fully-qualified name into one, unioning their methods
 * and includes and keeping the first superclass seen. Method names are
 * de-duplicated so a class reopened to add one method does not list the others
 * twice.
 */
function mergeStubTypes(types: StubType[]): StubType[] {
    const byName = new Map<string, StubType>();

    for (const type of types) {
        const existing = byName.get(type.name);
        if (!existing) {
            byName.set(type.name, {
                name: type.name,
                kind: type.kind,
                superclass: type.superclass,
                includes: [...(type.includes ?? [])],
                methods: [...(type.methods ?? [])]
            });
            continue;
        }

        existing.superclass = existing.superclass ?? type.superclass;
        for (const mixin of type.includes ?? []) {
            if (!existing.includes!.includes(mixin)) {
                existing.includes!.push(mixin);
            }
        }
        const seen = new Set(existing.methods!.map(m => `${m.classMethod ? '.' : '#'}${m.name}`));
        for (const method of type.methods ?? []) {
            const signature = `${method.classMethod ? '.' : '#'}${method.name}`;
            if (!seen.has(signature)) {
                seen.add(signature);
                existing.methods!.push(method);
            }
        }
    }

    return [...byName.values()];
}

/** Seed the curated docs from the bundled stubs so they overlay machine types. */
function seedBundledDocs(docs: Map<string, string>): void {
    for (const file of [coreStubs as StubFile, railsStubs as StubFile]) {
        for (const type of file.types) {
            for (const method of type.methods ?? []) {
                if (method.doc) {
                    const id = method.classMethod
                        ? `${type.name}.${method.name}`
                        : `${type.name}#${method.name}`;
                    docs.set(id, method.doc);
                }
            }
        }
    }
}

function registerType(
    graph: SemanticGraphBuilder,
    type: StubType,
    result: StubLoadResult
): void {
    // Build every method up front so the container can be created already
    // owning their IDs. `addMethod` only back-links IDs onto class entries, not
    // modules, so pre-seeding the `methods` array is what makes an included
    // module's methods reachable through `getAllAvailableMethods`.
    const methods = (type.methods ?? []).map(m => buildMethodInfo(type.name, m, result.docs));
    const methodIds = methods.map(m => m.id);

    if (type.kind === 'module') {
        const moduleInfo: ModuleInfo = {
            name: type.name,
            fullyQualifiedName: type.name,
            location: STUB_LOCATION,
            methods: methodIds,
            includedIn: [],
            extendedIn: []
        };
        graph.addModule(moduleInfo);
        result.moduleCount++;
    } else {
        const classInfo: ClassInfo = {
            name: type.name,
            fullyQualifiedName: type.name,
            location: STUB_LOCATION,
            superclass: type.superclass,
            mixins: type.includes ?? [],
            subclasses: [],
            methods: methodIds,
            constants: new Map(),
            instanceVariables: [],
            classVariables: [],
            isRailsModel: false,
            isRailsController: false
        };
        graph.addClass(classInfo);
        result.classCount++;
    }

    for (const method of methods) {
        graph.addMethod(method);
        result.methodCount++;
    }
}

function buildMethodInfo(
    typeName: string,
    method: StubMethod,
    docs: Map<string, string>
): MethodInfo {
    const id = method.classMethod
        ? `${typeName}.${method.name}`
        : `${typeName}#${method.name}`;

    if (method.doc) {
        docs.set(id, method.doc);
    }

    return {
        id,
        name: method.name,
        className: typeName,
        location: STUB_LOCATION,
        parameters: (method.params ?? []).map(parseStubParam),
        visibility: 'public',
        isClassMethod: method.classMethod ?? false,
        returnType: method.returns,
        calls: [],
        calledBy: [],
        usageCount: 0
    };
}

/**
 * Parse a compact parameter spec into the graph's {@link ParameterInfo}. A
 * leading `&`/`*`/`**` marks a block/splat/keyword-splat, a `key:` form marks a
 * keyword parameter (optionally with a default after the colon), and a
 * positional default is written `name = value`.
 */
function parseStubParam(spec: string): ParameterInfo {
    let text = spec.trim();
    let block = false;
    let splat = false;
    let keyword = false;
    let defaultValue: string | undefined;

    if (text.startsWith('&')) {
        block = true;
        text = text.slice(1);
    } else if (text.startsWith('**')) {
        splat = true;
        keyword = true;
        text = text.slice(2);
    } else if (text.startsWith('*')) {
        splat = true;
        text = text.slice(1);
    }

    const colon = text.indexOf(':');
    const equals = text.indexOf('=');

    // A `key:` colon that precedes any `=` marks a keyword parameter; anything
    // after the colon is its default value.
    if (colon !== -1 && (equals === -1 || colon < equals)) {
        keyword = true;
        const rest = text.slice(colon + 1).trim();
        return {
            name: text.slice(0, colon).trim(),
            keyword,
            splat,
            block,
            defaultValue: rest || undefined
        };
    }

    if (equals !== -1) {
        defaultValue = text.slice(equals + 1).trim();
        text = text.slice(0, equals).trim();
    }

    return { name: text.trim(), keyword, splat, block, defaultValue };
}

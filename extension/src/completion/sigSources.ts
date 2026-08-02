import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Discovery of type-signature material already present on the user's machine.
 *
 * The knowledge base is most accurate when it reflects the exact Ruby and Rails
 * the project runs, so before falling back to bundled stubs the extension looks
 * for two things it can read directly: the RBS core signatures that ship inside
 * the `rbs` gem (keyed to the installed Ruby), and the Sorbet RBI files Tapioca
 * writes under `sorbet/rbi/gems/` (keyed to the project's gem versions). Neither
 * is guaranteed to exist; every probe fails softly to `undefined` so a machine
 * without them simply uses the bundled floor.
 */

/** A set of signature files found on disk, with the newest mtime for caching. */
export interface SigSource {
    files: string[];
    /** Milliseconds since epoch of the most recently modified file. */
    mtime: number;
}

export interface MachineSigSources {
    rubyVersion?: string;
    railsVersion?: string;
    /** RBS core signatures from the installed `rbs` gem. */
    rbsCore?: SigSource;
    /** Sorbet RBI files for Rails gems, from the project's `sorbet/rbi/gems/`. */
    rbiGems?: SigSource;
}

/** Gems whose RBI files carry the Rails surface worth loading for completion. */
const RAILS_GEMS = new Set([
    'activerecord',
    'activemodel',
    'activesupport',
    'actionpack',
    'actionview',
    'actionmailer',
    'actioncable',
    'activejob',
    'activestorage',
    'railties'
]);

/**
 * Probe the machine and workspace for usable signatures. `cwd` should be the
 * workspace folder so a per-project Ruby version manager (rbenv/rvm/chruby)
 * resolves the interpreter the project actually uses.
 */
export function discoverMachineSources(cwd: string): MachineSigSources {
    const result: MachineSigSources = {};

    result.rubyVersion = detectRubyVersion(cwd);
    result.rbsCore = locateRbsCore(cwd);

    const rbi = locateRailsRbi(cwd);
    if (rbi) {
        result.rbiGems = rbi.source;
        result.railsVersion = rbi.railsVersion;
    }

    return result;
}

function detectRubyVersion(cwd: string): string | undefined {
    return runCommand('ruby', ['-e', 'print RUBY_VERSION'], cwd);
}

/**
 * Resolve the RBS gem's bundled `core/` directory from `gem which rbs`. The gem
 * lays out `<root>/lib/rbs.rb` alongside `<root>/core/*.rbs`, so the core
 * directory is two levels up from the entry point.
 */
function locateRbsCore(cwd: string): SigSource | undefined {
    const entry = runCommand('gem', ['which', 'rbs'], cwd);
    if (!entry) {
        return undefined;
    }
    const coreDir = path.resolve(path.dirname(entry), '..', 'core');
    return collectFiles(coreDir, name => name.endsWith('.rbs'));
}

interface RbiDiscovery {
    source: SigSource;
    railsVersion?: string;
}

/**
 * Find the Rails-gem RBI files under the project's `sorbet/rbi/gems/`. Tapioca
 * names them `<gem>@<version>.rbi`, which also yields the Rails version from the
 * `activerecord` (or, failing that, `railties`) entry.
 */
function locateRailsRbi(cwd: string): RbiDiscovery | undefined {
    const gemsDir = path.join(cwd, 'sorbet', 'rbi', 'gems');
    let entries: string[];
    try {
        entries = fs.readdirSync(gemsDir);
    } catch {
        return undefined;
    }

    const files: string[] = [];
    let newest = 0;
    let railsVersion: string | undefined;
    let railtiesVersion: string | undefined;

    for (const name of entries) {
        if (!name.endsWith('.rbi')) {
            continue;
        }
        const at = name.indexOf('@');
        const gem = at === -1 ? name.slice(0, -4) : name.slice(0, at);
        if (!RAILS_GEMS.has(gem)) {
            continue;
        }

        const full = path.join(gemsDir, name);
        const mtime = safeMtime(full);
        if (mtime === undefined) {
            continue;
        }
        files.push(full);
        newest = Math.max(newest, mtime);

        const version = at === -1 ? undefined : name.slice(at + 1, -4);
        if (gem === 'activerecord') {
            railsVersion = version;
        } else if (gem === 'railties') {
            railtiesVersion = version;
        }
    }

    if (files.length === 0) {
        return undefined;
    }
    return {
        source: { files, mtime: newest },
        railsVersion: railsVersion ?? railtiesVersion
    };
}

/** List files in `dir` matching `predicate`, with the newest mtime among them. */
function collectFiles(dir: string, predicate: (name: string) => boolean): SigSource | undefined {
    let entries: string[];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return undefined;
    }

    const files: string[] = [];
    let newest = 0;
    for (const name of entries) {
        if (!predicate(name)) {
            continue;
        }
        const full = path.join(dir, name);
        const mtime = safeMtime(full);
        if (mtime === undefined) {
            continue;
        }
        files.push(full);
        newest = Math.max(newest, mtime);
    }

    return files.length > 0 ? { files, mtime: newest } : undefined;
}

function safeMtime(file: string): number | undefined {
    try {
        return fs.statSync(file).mtimeMs;
    } catch {
        return undefined;
    }
}

/**
 * Run a short-lived command and return its trimmed stdout, or undefined on any
 * failure. Signature discovery must never throw into activation, so a missing
 * interpreter, a non-zero exit, or a slow shim all resolve to "not found".
 */
function runCommand(command: string, args: string[], cwd: string): string | undefined {
    try {
        const output = cp.execFileSync(command, args, {
            cwd,
            timeout: 5000,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        const trimmed = output.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    } catch {
        return undefined;
    }
}

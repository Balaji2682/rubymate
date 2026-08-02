import * as fs from 'fs';
import * as path from 'path';
import { StubType } from './stubLoader';

/**
 * On-disk cache of parsed machine signatures.
 *
 * Reading and parsing the RBS core plus a project's Rails RBI is hundreds of
 * files and only worth doing when something has actually changed. Keying the
 * cache on the Ruby/Rails versions and the newest source mtime means the cost is
 * paid once per environment: later activations read a single JSON blob instead
 * of re-walking the signature tree. The cache is a pure optimisation — a miss,
 * a corrupt file, or an unwritable directory all degrade to reparsing, never to
 * an error.
 */

/** Identity of a parsed signature set; a change in any field invalidates it. */
export interface StubCacheKey {
    rubyVersion?: string;
    railsVersion?: string;
    coreMtime?: number;
    rbiMtime?: number;
    /** Bumped by hand when the parser output shape changes. */
    schema: number;
}

interface CacheContents {
    key: StubCacheKey;
    types: StubType[];
}

/** Current parser-output schema; bump to force a rebuild after parser changes. */
export const STUB_CACHE_SCHEMA = 1;

/** Return the cached types when the key matches exactly, otherwise undefined. */
export function readStubCache(cacheFile: string, key: StubCacheKey): StubType[] | undefined {
    let text: string;
    try {
        text = fs.readFileSync(cacheFile, 'utf8');
    } catch {
        return undefined;
    }

    try {
        const contents = JSON.parse(text) as CacheContents;
        return keysEqual(contents.key, key) ? contents.types : undefined;
    } catch {
        return undefined;
    }
}

/** Persist parsed types under `key`, best-effort; failures are swallowed. */
export function writeStubCache(cacheFile: string, key: StubCacheKey, types: StubType[]): void {
    const contents: CacheContents = { key, types };
    try {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(contents), 'utf8');
    } catch {
        // A cache we cannot write simply means the next activation reparses.
    }
}

function keysEqual(a: StubCacheKey, b: StubCacheKey): boolean {
    return a.schema === b.schema
        && a.rubyVersion === b.rubyVersion
        && a.railsVersion === b.railsVersion
        && a.coreMtime === b.coreMtime
        && a.rbiMtime === b.rbiMtime;
}

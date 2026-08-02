/**
 * Centralized Rails-compatible inflection utilities.
 *
 * Replaces the ad-hoc private helpers scattered across
 * advancedIndexer.ts, railsIntelligence.ts, and schemaParser.ts
 * with a single, well-tested module that handles irregular words
 * and uncountable nouns.
 */

// ── Irregular word pairs (singular → plural) ─────────────────────────
const IRREGULARS: [string, string][] = [
    ['person', 'people'],
    ['man', 'men'],
    ['woman', 'women'],
    ['child', 'children'],
    ['sex', 'sexes'],
    ['move', 'moves'],
    ['goose', 'geese'],
    ['mouse', 'mice'],
    ['tooth', 'teeth'],
    ['foot', 'feet'],
    ['ox', 'oxen'],
    ['datum', 'data'],
    ['medium', 'media'],
    ['analysis', 'analyses'],
    ['criterion', 'criteria'],
    ['phenomenon', 'phenomena'],
    ['index', 'indices'],
    ['matrix', 'matrices'],
    ['vertex', 'vertices'],
    ['axis', 'axes'],
    ['crisis', 'crises'],
    ['thesis', 'theses'],
    ['quiz', 'quizzes'],
    ['database', 'databases'],
    ['status', 'statuses'],
    ['alias', 'aliases'],
    ['bus', 'buses'],
    ['campus', 'campuses'],
    ['process', 'processes'],
    ['address', 'addresses'],
];

// ── Uncountable words ────────────────────────────────────────────────
const UNCOUNTABLES = new Set([
    'equipment', 'information', 'rice', 'money', 'species',
    'series', 'fish', 'sheep', 'jeans', 'police', 'data',
    'feedback', 'staff', 'news', 'software', 'hardware',
    'metadata', 'middleware',
]);

// ── Pluralization rules (order matters — last match wins) ────────────
const PLURAL_RULES: [RegExp, string][] = [
    [/$/,                   's'],
    [/s$/i,                 's'],
    [/(ax|test)is$/i,       '$1es'],
    [/(octop|vir)us$/i,     '$1i'],
    [/(alias|status)$/i,    '$1es'],
    [/(bu|mis|gas)s$/i,     '$1ses'],
    [/(buffal|tomat)o$/i,   '$1oes'],
    [/([ti])um$/i,          '$1a'],
    [/sis$/i,               'ses'],
    [/(?:([^f])fe|([lr])f)$/i, '$1$2ves'],
    [/(hive)$/i,            '$1s'],
    [/([^aeiouy]|qu)y$/i,   '$1ies'],
    [/(x|ch|ss|sh)$/i,      '$1es'],
    [/(matr|vert|ind)ix|ex$/i, '$1ices'],
    [/([m|l])ouse$/i,       '$1ice'],
    [/^(ox)$/i,             '$1en'],
    [/(quiz)$/i,            '$1zes'],
];

// ── Singularization rules ────────────────────────────────────────────
const SINGULAR_RULES: [RegExp, string][] = [
    [/s$/i,                                    ''],
    [/(n)ews$/i,                               '$1ews'],
    [/([ti])a$/i,                              '$1um'],
    [/((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)ses$/i, '$1$2sis'],
    [/(^analy)ses$/i,                          '$1sis'],
    [/([^f])ves$/i,                            '$1fe'],
    [/(hive)s$/i,                              '$1'],
    [/(tive)s$/i,                              '$1'],
    [/([lr])ves$/i,                            '$1f'],
    [/([^aeiouy]|qu)ies$/i,                    '$1y'],
    [/(s)eries$/i,                             '$1eries'],
    [/(m)ovies$/i,                             '$1ovie'],
    [/(x|ch|ss|sh)es$/i,                       '$1'],
    [/([m|l])ice$/i,                           '$1ouse'],
    [/(bus)es$/i,                              '$1'],
    [/(o)es$/i,                                '$1'],
    [/(shoe)s$/i,                              '$1'],
    [/(cris|ax|test)es$/i,                     '$1is'],
    [/(octop|vir)i$/i,                         '$1us'],
    [/(alias|status)es$/i,                     '$1'],
    [/^(ox)en/i,                               '$1'],
    [/(vert|ind)ices$/i,                       '$1ex'],
    [/(matr)ices$/i,                           '$1ix'],
    [/(quiz)zes$/i,                            '$1'],
    [/(database)s$/i,                          '$1'],
];

// ── Public API ───────────────────────────────────────────────────────

/**
 * Returns the plural form of a word.
 * `"user"` → `"users"`, `"person"` → `"people"`, `"bus"` → `"buses"`
 */
export function pluralize(word: string): string {
    if (!word || word.length === 0) { return word; }
    const lower = word.toLowerCase();

    if (UNCOUNTABLES.has(lower)) { return word; }

    // Check irregulars
    for (const [singular, plural] of IRREGULARS) {
        if (lower === singular) {
            return preserveCase(word, plural);
        }
        if (lower === plural) {
            return word; // already plural
        }
    }

    // Apply rules in reverse order (last match wins)
    for (let i = PLURAL_RULES.length - 1; i >= 0; i--) {
        const [rule, replacement] = PLURAL_RULES[i];
        if (rule.test(word)) {
            return word.replace(rule, replacement);
        }
    }
    return word;
}

/**
 * Returns the singular form of a word.
 * `"users"` → `"user"`, `"people"` → `"person"`, `"buses"` → `"bus"`
 */
export function singularize(word: string): string {
    if (!word || word.length === 0) { return word; }
    const lower = word.toLowerCase();

    if (UNCOUNTABLES.has(lower)) { return word; }

    // Check irregulars
    for (const [singular, plural] of IRREGULARS) {
        if (lower === plural) {
            return preserveCase(word, singular);
        }
        if (lower === singular) {
            return word; // already singular
        }
    }

    // Apply rules in reverse order
    for (let i = SINGULAR_RULES.length - 1; i >= 0; i--) {
        const [rule, replacement] = SINGULAR_RULES[i];
        if (rule.test(word)) {
            return word.replace(rule, replacement);
        }
    }
    return word;
}

/**
 * Converts a string to UpperCamelCase.
 * `"active_record"` → `"ActiveRecord"`, `"active_record/errors"` → `"ActiveRecord::Errors"`
 */
export function camelize(word: string, uppercaseFirstLetter = true): string {
    let result = word
        .replace(/\/(.?)/g, (_match, chr) => `::${chr.toUpperCase()}`)
        .replace(/(?:^|_)(.)/g, (_match, chr) => chr.toUpperCase());

    if (!uppercaseFirstLetter) {
        result = result.charAt(0).toLowerCase() + result.slice(1);
    }

    return result;
}

/**
 * Converts CamelCase to snake_case.
 * `"ActiveRecord"` → `"active_record"`, `"HTMLParser"` → `"html_parser"`
 * `"ActiveRecord::Errors"` → `"active_record/errors"`
 */
export function underscore(word: string): string {
    return word
        .replace(/::/g, '/')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z\d])([A-Z])/g, '$1_$2')
        .replace(/-/g, '_')
        .toLowerCase();
}

/**
 * Converts a table name to a class name.
 * `"user_accounts"` → `"UserAccount"` (singularizes + camelizes)
 */
export function classify(tableName: string): string {
    // Strip leading schema prefix if present
    const name = tableName.replace(/.*\./, '');
    return camelize(singularize(name));
}

/**
 * Converts a class name to a table name.
 * `"UserAccount"` → `"user_accounts"` (underscores + pluralizes)
 */
export function tableize(className: string): string {
    return pluralize(underscore(className));
}

/**
 * Converts a word to a more human-readable form.
 * `"employee_salary"` → `"Employee salary"`
 */
export function humanize(word: string): string {
    let result = word.replace(/_id$/, '').replace(/_/g, ' ');
    result = result.charAt(0).toUpperCase() + result.slice(1);
    return result;
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Preserves the case pattern of the original word when applying a replacement.
 * If original is all-uppercase → result is all-uppercase.
 * If original starts with uppercase → result starts with uppercase.
 */
function preserveCase(original: string, replacement: string): string {
    if (original === original.toUpperCase()) {
        return replacement.toUpperCase();
    }
    if (original[0] === original[0].toUpperCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    return replacement;
}

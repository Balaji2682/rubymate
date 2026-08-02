import { Candidate, CandidateOrigin } from './candidateSources';

/**
 * Ordering the raw candidates into the sequence a developer expects.
 *
 * The differentiator is the call graph: a method the codebase actually calls a
 * hundred times should sit above one it never calls, so a method's usage count
 * is a first-class term in the score rather than a tie-breaker. Around that sit
 * the ordinary signals — how well the label matches what was typed, how near an
 * in-scope local was bound, how confident the type resolution behind a receiver
 * member was, and a per-origin base weight that encodes "a local beats a
 * keyword at a bareword". The score is collapsed into a VS Code `sortText` so
 * the editor preserves this order instead of re-sorting alphabetically.
 */

export interface RankedCandidate {
    candidate: Candidate;
    score: number;
    sortText: string;
}

export interface RankOptions {
    /** The identifier fragment already typed, for match-quality scoring. */
    prefix: string;
}

/**
 * Base weight per origin, expressing the default preference before any typed
 * text or usage data refines it. Locals win at a bareword because a name just
 * introduced is the likeliest reference; keywords sit lowest because they are
 * always available and rarely what completion is reached for.
 */
const ORIGIN_WEIGHT: Record<CandidateOrigin, number> = {
    'local': 8,
    'instance-variable': 7,
    'self-method': 6,
    'receiver-method': 6,
    'constant': 5,
    'keyword': 2
};

/** Rank candidates highest-first and stamp each with a VS Code `sortText`. */
export function rankCandidates(candidates: Candidate[], options: RankOptions): RankedCandidate[] {
    const ranked = candidates
        .map(candidate => {
            const score = scoreCandidate(candidate, options.prefix);
            return { candidate, score, sortText: sortTextFor(score, candidate.label) };
        })
        .sort((a, b) => b.score - a.score || a.candidate.label.localeCompare(b.candidate.label));

    return ranked;
}

function scoreCandidate(candidate: Candidate, prefix: string): number {
    const { signals } = candidate;
    return ORIGIN_WEIGHT[signals.origin]
        + matchBoost(candidate.label, prefix)
        + usageBoost(signals.usageCount)
        + proximityBoost(signals.proximity)
        + confidenceBoost(signals.typeConfidence);
}

/**
 * Reward for how well the label matches the typed prefix: an exact hit outranks
 * a same-case prefix, which outranks a case-insensitive prefix, which outranks a
 * mid-label substring. An empty prefix contributes nothing, leaving the other
 * signals to order the full list.
 */
function matchBoost(label: string, prefix: string): number {
    if (!prefix) {
        return 0;
    }
    if (label === prefix) {
        return 10;
    }
    if (label.startsWith(prefix)) {
        return 6;
    }
    if (label.toLowerCase().startsWith(prefix.toLowerCase())) {
        return 3;
    }
    return 1; // substring match (already gated by the candidate source)
}

/**
 * Call-graph contribution, compressed logarithmically so the gap from 0 to 10
 * calls matters more than 100 to 110 while a heavily-used method still clearly
 * leads. This is the signal that makes the ordering reflect the codebase.
 */
function usageBoost(usageCount: number): number {
    if (usageCount <= 0) {
        return 0;
    }
    return Math.log10(1 + usageCount) * 3;
}

/** Nearer locals score higher; the boost decays smoothly with line distance. */
function proximityBoost(proximity: number | undefined): number {
    if (proximity === undefined) {
        return 0;
    }
    return 3 / (1 + proximity / 10);
}

/** A confidently resolved candidate edges ahead of a guessed one. */
function confidenceBoost(confidence: number | undefined): number {
    if (confidence === undefined) {
        return 0;
    }
    return confidence * 2;
}

/** Largest key emitted; a higher score maps to a smaller, earlier-sorting key. */
const SORT_CEILING = 100000;

/**
 * Collapse a score into a `sortText`. VS Code sorts these ascending as strings,
 * so the score is inverted into a zero-padded key — a higher score yields a
 * smaller number that sorts first — with the label appended to keep equal
 * scores in a stable alphabetical order.
 */
function sortTextFor(score: number, label: string): string {
    const key = Math.max(0, Math.min(SORT_CEILING, Math.round((100 - score) * 1000)));
    return key.toString().padStart(7, '0') + label;
}

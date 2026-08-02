/**
 * Confidence level for a resolved definition, ordered from most to least
 * trustworthy. Used to rank candidate definitions so AST-resolved results
 * surface above convention- or metaprogramming-derived ones.
 */
export type DefinitionConfidence = 'exact_ast' | 'rails_convention' | 'metaprogramming' | 'fuzzy' | 'fallback';

const CONFIDENCE_RANK: Record<DefinitionConfidence, number> = {
    exact_ast: 0,
    rails_convention: 1,
    metaprogramming: 2,
    fuzzy: 3,
    fallback: 4
};

/**
 * Lower rank == higher confidence. Unknown/undefined confidence ranks as
 * `exact_ast` (0) to preserve existing behaviour.
 */
export function definitionConfidenceRank(confidence: DefinitionConfidence | string | undefined): number {
    return CONFIDENCE_RANK[confidence as DefinitionConfidence] ?? 0;
}

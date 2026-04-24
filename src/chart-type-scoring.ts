// ============================================================
// Chart-type scoring (pluggability seam)
// ============================================================
//
// This module is the designated pluggability point for chart-type selection.
// The input/output shape (prompt string → ranked candidates + confidence) is
// stable; the internals can later swap to embedding-based similarity, a local
// tiny LM, or any other approach without changing the MCP tool surface or
// the `chartTypes` data model.

import { chartTypes, type ChartTypeMeta } from './chart-types';

const TYPOGRAPHIC_REPLACEMENTS: [RegExp, string][] = [
  [/[‘’]/g, "'"], // curly single quotes
  [/[“”]/g, '"'], // curly double quotes
  [/[–—]/g, '-'], // en/em dash
  [/×/g, 'x'], // unicode multiplication → ASCII (for "2×2" vs "2x2")
];

/** Normalize a string to lowercase ASCII-ish tokens for matching. */
export function normalize(s: string): string[] {
  let out = s.normalize('NFKD').toLowerCase();
  for (const [re, repl] of TYPOGRAPHIC_REPLACEMENTS)
    out = out.replace(re, repl);
  return out.split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * True if `triggerTokens` appears as a contiguous slice of `promptTokens`.
 * Token-based (not substring) — prevents "scatter plot" matching "scattered
 * the plot", "ER diagram" matching "water diagram", and similar traps.
 */
export function matchesContiguously(
  promptTokens: readonly string[],
  triggerTokens: readonly string[]
): boolean {
  if (triggerTokens.length === 0 || triggerTokens.length > promptTokens.length)
    return false;
  outer: for (let i = 0; i <= promptTokens.length - triggerTokens.length; i++) {
    for (let j = 0; j < triggerTokens.length; j++) {
      if (promptTokens[i + j] !== triggerTokens[j]) continue outer;
    }
    return true;
  }
  return false;
}

export interface ChartTypeScore {
  readonly type: ChartTypeMeta;
  readonly score: number;
  readonly matched: string[];
}

/**
 * Score a single chart type against a prompt.
 *
 * Primary signal: contiguous trigger-phrase matches weighted by token count
 * (longer phrases beat shorter ones). Secondary signal: description-word
 * overlap at 0.25× weight — a tiebreak-only hint that rescues prompts which
 * miss every trigger but touch description vocabulary. Triggers always win
 * over descriptions because any trigger match is ≥1.0 and descriptions
 * contribute ≤0.25 per token.
 */
export function scoreChartType(
  prompt: string,
  type: ChartTypeMeta
): { score: number; matched: string[] } {
  const promptTokens = normalize(prompt);
  const matched: string[] = [];
  let score = 0;

  for (const trigger of type.triggers) {
    const triggerTokens = normalize(trigger);
    if (matchesContiguously(promptTokens, triggerTokens)) {
      matched.push(trigger);
      score += triggerTokens.length;
    }
  }

  const descTokens = new Set(normalize(type.description));
  let descHits = 0;
  for (const t of promptTokens) if (descTokens.has(t)) descHits++;
  score += descHits * 0.25;

  return { score, matched };
}

/**
 * Minimum trigger-based score for a confident match. A result below this
 * floor means no actual trigger fired — only description-rescue tokens
 * contributed — so the caller should drop to the fallback list instead of
 * returning a confident-looking wrong answer.
 *
 * 1.0 is the weight of a single-token trigger. Anything less came entirely
 * from 0.25× description hits.
 */
export const MIN_PRIMARY_SCORE = 1.0;

/**
 * Minimum absolute score gap required before calling a match
 * non-ambiguous. 0.5 ≈ two description-rescue tokens' worth, or half a
 * trigger-token difference. Below this, the cliff between "medium" and
 * "ambiguous" is effectively noise.
 */
export const AMBIGUITY_THRESHOLD = 0.5;

export type Confidence = 'high' | 'medium' | 'ambiguous';

/**
 * Confidence from the top two scores. Rules:
 *   1. top < MIN_PRIMARY_SCORE → ambiguous (no real trigger matched)
 *   2. second === 0            → high      (nothing competes)
 *   3. top ≥ 2 × second        → high      (top dominates)
 *   4. top − second < AMBIGUITY_THRESHOLD → ambiguous (gap is noise)
 *   5. otherwise               → medium
 */
export function confidence(top: number, second: number): Confidence {
  if (top < MIN_PRIMARY_SCORE) return 'ambiguous';
  if (second === 0) return 'high';
  if (top >= second * 2) return 'high';
  if (top - second < AMBIGUITY_THRESHOLD) return 'ambiguous';
  return 'medium';
}

export interface SuggestionResult {
  readonly ranked: readonly ChartTypeScore[];
  readonly fallback: readonly ChartTypeMeta[];
  readonly confidence: Confidence;
  readonly fellBack: boolean;
}

/**
 * Score every chart type against `prompt` and return a ranked suggestion
 * bundle. Types with score 0 are filtered out. When the top score is below
 * `MIN_PRIMARY_SCORE` (no real trigger fired), the caller should present
 * the fallback list — `fellBack` is set to true in that case.
 *
 * Array order is preserved: scoring iterates `chartTypes` in source order
 * and `.sort` is stable in V8, so ties go to the earlier entry — specialized
 * types beat generic catch-alls by construction.
 */
export function suggestChartTypes(prompt: string): SuggestionResult {
  const scored: ChartTypeScore[] = [];
  for (const type of chartTypes) {
    const { score, matched } = scoreChartType(prompt, type);
    if (score > 0) scored.push({ type, score, matched });
  }
  scored.sort((a, b) => b.score - a.score);

  const fallback = chartTypes.filter((c) => c.fallback);

  const topScore = scored[0]?.score ?? 0;
  const secondScore = scored[1]?.score ?? 0;
  const fellBack = topScore < MIN_PRIMARY_SCORE;

  return {
    ranked: scored,
    fallback,
    confidence: confidence(topScore, secondScore),
    fellBack,
  };
}

// ============================================================
// .dgmo Unified Format — Chart Type Router
// ============================================================

import { looksLikeSequence } from './sequence/parser';
import { looksLikeFlowchart } from './graph/flowchart-parser';
import { looksLikeState } from './graph/state-parser';
import { looksLikeClassDiagram } from './class/parser';
import { looksLikeERDiagram } from './er/parser';
import { looksLikeOrg } from './org/parser';
import { looksLikeSitemap } from './sitemap/parser';
import { looksLikePert } from './pert/parser';
// parseVisualization is the no-explicit-type fallback parser in parseDgmo (not
// part of the derived chartTypeParsers, which come from the registry).
import { parseVisualization } from './visualizations/parse';
import { parseFirstLine } from './utils/parsing';
import { isLiveLinkLine } from './live-link/parser';
import {
  makeDgmoError,
  suggest,
  dedupeDiagnostics,
  emit,
  MISTYPED_CHART_TYPE_DX,
} from './diagnostics';
import { attachHints } from './diagnostics-registry';
import type { DgmoError } from './diagnostics';
import { chartTypes } from './chart-types';
import {
  CHART_TYPE_REGISTRY,
  REGISTRY_BY_ID,
  isExtendedChartParser,
} from './chart-type-registry';
import type { RenderCategory } from './chart-type-registry';

// ============================================================
// Content-based chart type inference helpers
// ============================================================

/** Gantt duration patterns: `10bd Task` */
const GANTT_DURATION_RE = /^\d+(?:\.\d+)?(?:min|bd|sp|d|w|m|q|y|h)(?:\?)?\s+/;
/** Gantt date patterns: `2025-01-01 Task` */
const GANTT_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?\s+/;

/**
 * Returns true if content looks like a gantt chart.
 * Detects duration patterns like `10bd Task` or `5d Task`.
 */
export function looksLikeGantt(content: string): boolean {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (GANTT_DURATION_RE.test(trimmed) || GANTT_DATE_RE.test(trimmed)) {
      return true;
    }
  }
  return false;
}

/** C4 `Name is a person/system/container/component` pattern */
const C4_TYPE_RE = /\bis\s+an?\s+(person|system|container|component)\b/i;

/**
 * Returns true if content looks like a C4 diagram.
 * Detects `Name is a person/system/container/component` declarations.
 * Does NOT match bare words like `container` at line start.
 */
export function looksLikeC4(content: string): boolean {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (C4_TYPE_RE.test(trimmed)) {
      return true;
    }
  }
  return false;
}

/**
 * Extracts the chart type from raw file content.
 * First tries the first non-empty, non-comment line as a bare chart type name
 * (e.g., `gantt Product Launch`).
 * Falls back to inference when no explicit chart type is found.
 */
export function parseDgmoChartType(content: string): string | null {
  const lines = content.split('\n');

  // Find first non-empty, non-comment line
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Try new first-line detection (bare chart type name)
    const firstLineResult = parseFirstLine(trimmed);
    if (firstLineResult) return firstLineResult.chartType;

    // §38.6: a live link has three spellings and they parse identically. Only
    // `live-link <id>` names a chart type on its first line, so the other two —
    // a pasted share link, and the note spelling `![[live-link:<id>]]` — used to
    // fall past this loop into the visualization parser and come back as
    // "Unsupported chart type", which sends someone hunting for a typo in a
    // line that says exactly what it means. Exact, not a `looksLike*` heuristic:
    // the shared parser either recognizes the whole line as a pointer or it does
    // not, so this cannot claim a fence that was meant as something else.
    if (isLiveLinkLine(trimmed)) return 'live-link';

    // Not a chart type on the first line — stop looking for explicit declaration
    break;
  }

  // Infer chart type from content patterns (sequence before flowchart —
  // both use `->` but sequence uses bare names while flowchart uses shape delimiters)
  // C4 must come AFTER sequence (both use `is a` but with different type nouns)
  if (looksLikeSequence(content)) return 'sequence';
  if (looksLikeFlowchart(content)) return 'flowchart';
  if (looksLikeClassDiagram(content)) return 'class';
  if (looksLikeERDiagram(content)) return 'er';
  if (looksLikeState(content)) return 'state';
  if (looksLikeSitemap(content)) return 'sitemap';
  if (looksLikeOrg(content)) return 'org';
  if (looksLikeC4(content)) return 'c4';
  if (looksLikeGantt(content)) return 'gantt';
  if (looksLikePert(content)) return 'pert';

  return null;
}

// ============================================================
// Public render-category API — derived from the chart-type registry.
// ============================================================

/** User-visible rendering category for dispatch and routing. */
export type { RenderCategory };

/**
 * Returns the render category for a given chart type, or `null` if unknown.
 * Use this instead of the internal framework map for dispatch in consumers.
 */
export function getRenderCategory(chartType: string): RenderCategory | null {
  return REGISTRY_BY_ID.get(chartType.toLowerCase())?.category ?? null;
}

/**
 * Returns true if the chart type is an extended chart type
 * handled by parseExtendedChart (scatter, sankey, function, heatmap, funnel).
 * Returns false for standard chart types and all other types.
 */
export function isExtendedChartType(chartType: string): boolean {
  const descriptor = REGISTRY_BY_ID.get(chartType.toLowerCase());
  return descriptor ? isExtendedChartParser(descriptor.parse) : false;
}

/**
 * Returns all supported chart type identifiers in canonical (tier) order,
 * derived from `chartTypes`. Consumers that need alphabetical order should
 * call `.sort()` explicitly.
 */
export function getAllChartTypes(): string[] {
  return chartTypes.map((c) => c.id);
}

/**
 * Canonical descriptions for every supported chart type. Derived from
 * `chartTypes` so there is exactly one place to update when adding a new
 * type. Consumed by the CLI `dgmo types` command, the editor autocomplete
 * popup, and the MCP `list_chart_types` tool.
 */
export const CHART_TYPE_DESCRIPTIONS: Record<string, string> =
  Object.fromEntries(chartTypes.map((c) => [c.id, c.description]));

// ============================================================
// Parser registry — single source of truth for id → parser
// ============================================================

type ParseResult = { diagnostics: readonly DgmoError[] };
type ParseFn = (content: string) => ParseResult;

/**
 * Maps every chart-type id to the parser that handles it, DERIVED from
 * `CHART_TYPE_REGISTRY` (src/chart-type-registry.ts). Adding a new chart type
 * means adding ONE descriptor there plus its `chartTypes` metadata entry; the
 * `chart-type-registry.test.ts` cross-check asserts the registry, `chartTypes`,
 * the render-category sites, and the export handlers all stay in sync.
 */
export const chartTypeParsers: ReadonlyArray<readonly [string, ParseFn]> =
  CHART_TYPE_REGISTRY.map((d) => [d.id, d.parse] as const);

/** Ids in the same order as `chartTypeParsers`; used for cross-checks. */
export const knownChartTypeIds: readonly string[] = chartTypeParsers.map(
  ([id]) => id
);

const PARSER_BY_ID: Map<string, ParseFn> = new Map(chartTypeParsers);

/** All known chart type names for colon-pattern detection. */
const ALL_KNOWN_TYPES: ReadonlySet<string> = new Set(knownChartTypeIds);

/**
 * Parse DGMO content and return diagnostics without rendering.
 * Useful for the CLI and editor to surface all errors before attempting render.
 */
export function parseDgmo(content: string): {
  diagnostics: DgmoError[];
  chartType: string | null;
} {
  // Dedupe at the parse boundary so one offending line never reports the same
  // problem N times — keeps the fix-loop signal clean for the CLI, the editor,
  // and the MCP `validate_diagram` tool.
  const result = parseDgmoUndeduped(content);
  return {
    // `attachHints` backfills the registry's repair sentence by code, so the
    // hint travels however the diagnostic was constructed. See its own comment.
    diagnostics: attachHints(dedupeDiagnostics(result.diagnostics)),
    chartType: result.chartType,
  };
}

function parseDgmoUndeduped(content: string): {
  diagnostics: DgmoError[];
  chartType: string | null;
} {
  const chartType = parseDgmoChartType(content);

  if (!chartType) {
    // Check for common mistake: colon in chart type declaration (e.g. "bar: Sales")
    const colonDiag = detectColonChartType(content);
    if (colonDiag) {
      const fallback = parseVisualization(content).diagnostics;
      return { diagnostics: [colonDiag, ...fallback], chartType: null };
    }

    // No chart type detected — try visualization parser as fallback
    return {
      diagnostics: parseVisualization(content).diagnostics,
      chartType: null,
    };
  }

  const parser = PARSER_BY_ID.get(chartType);
  if (parser) {
    const result = parser(content);
    const mistyped = detectMistypedChartType(content, chartType);
    return {
      diagnostics: [
        ...(mistyped ? [mistyped] : []),
        ...result.diagnostics,
        ...detectEmptyContent(content, chartType),
      ],
      chartType,
    };
  }

  // Unknown id (defensive): fall through to visualization parser.
  const result = parseVisualization(content);
  return {
    diagnostics: [
      ...result.diagnostics,
      ...detectEmptyContent(content, chartType),
    ],
    chartType,
  };
}

// ============================================================
// Common-mistake detectors
// ============================================================

/**
 * Detects colon-separated chart type declarations like "bar: Sales" or "pie: Data".
 * Returns a diagnostic if the word before the colon is a known or similar chart type.
 */
/** Mermaid's spelling → ours, for first words no edit distance would find. */
const MERMAID_FIRST_WORDS: Readonly<Record<string, string>> = {
  graph: 'flowchart',
  journey: 'journey-map',
};

/**
 * The no-colon sibling of `detectColonChartType`: a first line whose opening
 * word is close to a chart type but is not one, on a document that therefore
 * fell through to content inference.
 *
 * 🔴 Only a LOWERCASE bare word is considered. Every chart-type id is
 * lowercase, while the first token of an inferred diagram is usually a node or
 * person name and is capitalised — so this refuses to guess at `Barr Smith` in
 * an org chart, which `suggest` would otherwise offer to "correct" to `bar`.
 */
function detectMistypedChartType(
  content: string,
  resolved: string
): DgmoError | null {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//'))
      continue;

    const match = trimmed.match(/^([a-z][a-z0-9-]*)(?:\s|$)/);
    if (!match) return null; // not a bare lowercase word — no declaration attempt
    const word = match[1]!;
    if (ALL_KNOWN_TYPES.has(word)) return null; // spelled correctly

    // Words another tool spells differently. Edit distance cannot reach these —
    // `graph` is four edits from `gantt` and nowhere near `flowchart` — and
    // arriving from Mermaid is the single likeliest way to type a first line
    // DGMO does not know.
    const alias = MERMAID_FIRST_WORDS[word];
    const suggestion = alias
      ? `Did you mean '${alias}'?`
      : suggest(word, [...ALL_KNOWN_TYPES]);
    if (!suggestion) return null;
    return emit(MISTYPED_CHART_TYPE_DX, i + 1, { word, resolved, suggestion });
  }
  return null;
}

function detectColonChartType(content: string): DgmoError | null {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const trimmed = lines[i]!.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//'))
      continue;

    const match = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (!match) return null; // First non-empty line doesn't match colon pattern

    // Regex captured groups 1 and 2 by successful match.
    const word = match[1]!.toLowerCase();
    const rest = match[2]!.trim();

    if (ALL_KNOWN_TYPES.has(word)) {
      const example = rest ? `${word} ${rest}` : word;
      return makeDgmoError(
        i + 1,
        `Remove the colon — use '${example}' instead of '${trimmed}'. DGMO chart types don't use colons.`
      );
    }

    // Check if it's a misspelling of a known type
    const hint = suggest(word, [...ALL_KNOWN_TYPES]);
    if (hint) {
      return makeDgmoError(
        i + 1,
        `Unknown chart type: ${word}. ${hint} Also, DGMO chart types don't use colons.`
      );
    }

    return null; // First line has colon but isn't a chart type — normal data
  }
  return null;
}

/**
 * Chart types for which a one-line file is the intended shape, not an omission.
 * `live-link dgm_7f2a91` IS the whole diagram — the shorthand form of §38.3,
 * and the spelling a docs fence uses — so the warning below would fire on every
 * correctly written one.
 */
const EMPTY_CONTENT_EXEMPT = new Set(['live-link']);

/**
 * Detects when content has only the chart type line with no meaningful data lines.
 */
function detectEmptyContent(
  content: string,
  chartType?: string | null
): DgmoError[] {
  if (chartType && EMPTY_CONTENT_EXEMPT.has(chartType)) return [];
  const lines = content.split('\n');
  const nonEmpty = lines.filter(
    (l) => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('//')
  );
  if (nonEmpty.length <= 1) {
    return [
      makeDgmoError(1, 'No content after chart type declaration.', 'warning'),
    ];
  }
  return [];
}

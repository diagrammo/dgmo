// ============================================================
// Chart-type DETECTION — "what kind of diagram is this?"
// ============================================================
//
// 🔴 Split out of dgmo-router.ts on 2026-09-02 because of what that module
// imports, not because of what this code is (#638).
//
// `dgmo-router` also owns `parseDgmo`, and for that it imports
// CHART_TYPE_REGISTRY — an array of descriptors each holding a direct
// reference to its chart's `parse` function, mapped at module scope into
// `chartTypeParsers`. A top-level `.map()` over a table of all 51 parsers is
// not something a bundler will remove, so importing ANY symbol from
// dgmo-router pulled every parser in the library.
//
// Measured with a one-line Vite app importing a single symbol from
// `@diagrammo/dgmo/chart-meta`:
//
//   parseDgmoChartType, from dgmo-router   1,117,251 B
//   parseFirstLine, from utils/parsing        35,438 B
//
// Same question, thirty times the answer, purely from which file it sat in.
// The eight `looksLike*` predicates it calls are NOT the weight — removing
// inference entirely saved 5,598 bytes of the 1.1 MB.
//
// So: nothing here may import `./chart-type-registry`, `./diagnostics-registry`
// or anything else that builds the parser table. Detection answers a
// question ABOUT source; parsing consumes it. Keep them apart.

import { looksLikeSequence } from './sequence/parser';
import { looksLikeFlowchart } from './graph/flowchart-parser';
import { looksLikeState } from './graph/state-parser';
import { looksLikeClassDiagram } from './class/parser';
import { looksLikeERDiagram } from './er/parser';
import { looksLikeOrg } from './org/parser';
import { looksLikeSitemap } from './sitemap/parser';
import { looksLikePert } from './pert/parser';
import { parseFirstLine } from './utils/parsing';
import { isLiveLinkLine } from './live-link/parser';

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

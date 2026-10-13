// ============================================================
// agent-reference.ts — what an agent is told about the language: the
// per-type slice of the language reference, the chart-type list, and the
// gallery examples. Pure strings; the host reads the files.
//
// Two MCP servers serve these — dgmo-mcp, and the desktop app's in-app
// endpoint (diagrammo/diagrammo#1266) — so the text lives here, once. It was
// written in dgmo-mcp first (its src/reference.ts and src/index.ts).
//
// Slicing is keyed on the `<!-- TYPE:<id> -->` anchors and the
// `<!-- TYPE-ALIASES: ... -->` map in docs/language-reference.md, the same
// source scripts/lib/ref-anchors.mjs reads.
// ============================================================

import { chartTypes } from './chart-types';
import { CHART_TYPE_DESCRIPTIONS } from './dgmo-router';

/**
 * Parse the `<!-- TYPE-ALIASES: a=b c=b ... -->` map. Grouped data-chart /
 * matrix ids (line, pie, raci, …) share another id's documented block.
 */
export function parseTypeAliases(markdown: string): Map<string, string> {
  const m = markdown.match(/<!--\s*TYPE-ALIASES:\s*([^>]*?)-->/);
  const map = new Map<string, string>();
  if (!m) return map;
  for (const pair of (m[1] ?? '').trim().split(/\s+/)) {
    const [alias, target] = pair.split('=');
    if (alias && target) map.set(alias.trim(), target.trim());
  }
  return map;
}

/**
 * Extract the universal color rule (the closed 11-name palette + the explicit
 * "no hex / no CSS color names" guidance) from the language reference. It lives
 * between `<!-- COLORS start -->` / `<!-- COLORS end -->` inside the
 * ANTIPATTERNS block. Returned so per-type slices — which omit the ANTIPATTERNS
 * core — can still carry the color contract for EVERY chart type. Returns null
 * if the markers are absent (older bundled reference).
 */
export function extractColorRule(markdown: string): string | null {
  const m = markdown.match(
    /<!--\s*COLORS start\s*-->([\s\S]*?)<!--\s*COLORS end\s*-->/
  );
  return m ? (m[1] ?? '').trim() : null;
}

/**
 * Extract the universal "always title the diagram" rule (the `<!-- TITLE start -->`
 * / `<!-- TITLE end -->` block inside the STYLING core). Like the color rule, it
 * is prepended to EVERY per-type slice so the model is told to title every
 * diagram regardless of type — the STYLING core itself never rides the slice.
 * Returns null if the markers are absent (older bundled reference).
 */
export function extractTitleRule(markdown: string): string | null {
  const m = markdown.match(
    /<!--\s*TITLE start\s*-->([\s\S]*?)<!--\s*TITLE end\s*-->/
  );
  return m ? (m[1] ?? '').trim() : null;
}

/**
 * Extract the universal "categorize and color by a tag group" rule (the
 * `<!-- CATEGORIZE start -->` / `<!-- CATEGORIZE end -->` block inside the
 * STYLING core). Like the color + title rules it is prepended to EVERY per-type
 * slice so the model is pushed to find a categorization axis and color by it for
 * every diagram. Returns null if the markers are absent (older bundled reference).
 */
export function extractCategorizeRule(markdown: string): string | null {
  const m = markdown.match(
    /<!--\s*CATEGORIZE start\s*-->([\s\S]*?)<!--\s*CATEGORIZE end\s*-->/
  );
  return m ? (m[1] ?? '').trim() : null;
}

/**
 * Slice the per-type block for `chartType`, resolving aliases first. A block
 * runs from just after its `<!-- TYPE:<id> -->` marker to the next TYPE marker
 * or the next `^## ` (H2) heading, whichever comes first. The opening TYPE
 * marker is a purely structural anchor — it is EXCLUDED from the returned slice
 * so it never reaches a consumer (the model would otherwise echo it verbatim as
 * the first line of its generated diagram). Returns null when no anchor resolves
 * (the id has neither a literal marker nor an alias).
 */
export function extractSection(
  markdown: string,
  chartType: string
): string | null {
  const aliases = parseTypeAliases(markdown);
  const resolved = aliases.get(chartType) ?? chartType;
  const startRe = new RegExp(`<!--\\s*TYPE:${resolved}\\s*-->`);
  const startMatch = startRe.exec(markdown);
  if (!startMatch) return null;
  const after = startMatch.index + startMatch[0].length;
  const rest = markdown.slice(after);
  const nextType = rest.search(/<!--\s*TYPE:[a-z0-9-]+\s*-->/);
  const nextH2 = rest.search(/^## /m);
  const ends = [nextType, nextH2].filter((n) => n !== -1);
  const end = ends.length ? after + Math.min(...ends) : markdown.length;
  return markdown.slice(after, end).trim();
}

/**
 * A chart type's reference block with the universal rules in front: the
 * closed colour set, always-title, categorize-and-colour. A per-type slice
 * omits the cores those live in, so without this the model never sees them.
 * TIPS delimiter comments are stripped so no scaffolding is echoed into a
 * generated diagram. Null when the type has no documented block.
 */
export function referenceForChartType(
  markdown: string,
  chartType: string
): string | null {
  const raw = extractSection(markdown, chartType);
  if (!raw) return null;
  const section = raw.replace(
    /[ \t]*<!--\s*TIPS (?:start|end)\s*-->[ \t]*\n?/g,
    ''
  );
  const universal = [
    extractColorRule(markdown),
    extractTitleRule(markdown),
    extractCategorizeRule(markdown),
  ].filter(Boolean);
  return universal.length
    ? `${universal.join('\n\n')}\n\n---\n\n${section}`
    : section;
}

/**
 * The chart types an agent may offer, as `list_chart_types` prints them.
 * An `internal` type routes but is never offered (nobody hand-authors a
 * live-link); a `beta` type is offered and marked, so a model choosing it on
 * someone's behalf can say it is unfinished.
 */
export function formatChartTypeList(): string {
  const meta = new Map(chartTypes.map((c) => [c.id, c]));
  const types = Object.keys(CHART_TYPE_DESCRIPTIONS).filter(
    (id) => !meta.get(id)?.internal
  );
  const lines = types.map((id) => {
    const desc = CHART_TYPE_DESCRIPTIONS[id];
    const mark = meta.get(id)?.beta ? ' [beta — expect rough edges]' : '';
    return desc ? `- ${id}${mark}: ${desc}` : `- ${id}${mark}`;
  });
  return `Supported chart types (${types.length}):\n\n${lines.join('\n')}`;
}

/**
 * Whether a gallery example belongs to `chartType`. Names are paths relative
 * to gallery/fixtures without `.dgmo`: `<type>` or `<type>-*` at the top
 * level, or anything under a `<type>/` directory.
 */
export function isExampleFor(name: string, chartType: string): boolean {
  const slash = name.indexOf('/');
  if (slash !== -1) return name.slice(0, slash) === chartType;
  return name === chartType || name.startsWith(chartType + '-');
}

/** Examples shown per call, so a type with many does not flood the context. */
export const EXAMPLES_SHOWN = 5;

/**
 * What `get_examples` returns. Without a chart type, the list of names; with
 * one, up to EXAMPLES_SHOWN sources in dgmo fences. `read` returns a named
 * example's source.
 */
export async function formatExamples(
  names: readonly string[],
  read: (name: string) => Promise<string> | string,
  chartType?: string
): Promise<{ text: string; isError: boolean }> {
  const sorted = [...names].sort();
  if (!chartType) {
    return {
      text: `Available examples (${sorted.length}):\n\n${sorted.map((n) => `- ${n}`).join('\n')}\n\nCall get_examples with a chart_type to see the full DGMO source.`,
      isError: false,
    };
  }
  const matching = sorted.filter((n) => isExampleFor(n, chartType));
  if (matching.length === 0) {
    return {
      text: `No examples found for "${chartType}". Use get_examples() without arguments to see all available examples.`,
      isError: true,
    };
  }
  const parts: string[] = [];
  for (const n of matching.slice(0, EXAMPLES_SHOWN)) {
    const source = await read(n);
    parts.push(`## ${n}\n\n\`\`\`dgmo\n${source.trim()}\n\`\`\``);
  }
  let text = parts.join('\n\n---\n\n');
  if (matching.length > EXAMPLES_SHOWN) {
    text += `\n\n(Showing ${EXAMPLES_SHOWN} of ${matching.length} examples)`;
  }
  return { text, isError: false };
}

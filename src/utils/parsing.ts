/**
 * Shared parser utilities — extracted from individual parsers to eliminate
 * duplication of measureIndent, extractColor, header regexes, and
 * pipe-metadata parsing.
 */

import { resolveColor } from '../colors';
import type { PaletteColors } from '../palettes';

// ── All known chart types ────────────────────────────────────
/** Complete set of recognized chart type identifiers. */
export const ALL_CHART_TYPES = new Set([
  // data charts
  'bar', 'line', 'pie', 'doughnut', 'area', 'polar-area', 'radar',
  'bar-stacked', 'multi-line', 'scatter', 'sankey', 'chord', 'function',
  'heatmap', 'funnel',
  // visualizations
  'slope', 'wordcloud', 'arc', 'timeline', 'venn', 'quadrant',
  // diagrams
  'sequence', 'flowchart', 'class', 'er', 'org', 'kanban', 'c4',
  'initiative-status', 'state', 'sitemap', 'infra', 'gantt',
]);

/** Measure leading whitespace of a line, normalizing tabs to 4 spaces. */
export function measureIndent(line: string): number {
  let indent = 0;
  for (const ch of line) {
    if (ch === ' ') indent++;
    else if (ch === '\t') indent += 4;
    else break;
  }
  return indent;
}

/** Matches a trailing `(colorName)` suffix on a label. */
export const COLOR_SUFFIX_RE = /\(([^)]+)\)\s*$/;

/** Extract an optional trailing color suffix from a label, resolving via palette. */
export function extractColor(
  label: string,
  palette?: PaletteColors,
): { label: string; color?: string } {
  const m = label.match(COLOR_SUFFIX_RE);
  if (!m) return { label };
  const colorName = m[1].trim();
  return {
    label: label.substring(0, m.index!).trim(),
    color: resolveColor(colorName, palette) ?? undefined,
  };
}

/** @deprecated Matches `chart: <type>` header lines. Remove after all parsers migrate. */
export const CHART_TYPE_RE = /^chart\s*:\s*(.+)/i;

/** @deprecated Matches `title: <text>` header lines. Remove after all parsers migrate. */
export const TITLE_RE = /^title\s*:\s*(.+)/i;

/** @deprecated Matches `option: value` header lines. Remove after all parsers migrate. */
export const OPTION_RE = /^([a-z][a-z0-9-]*)\s*:\s*(.+)$/i;

/** Matches `option value` header lines (space-separated, no colon). */
export const OPTION_NOCOLON_RE = /^([a-z][a-z0-9-]*)\s+(.+)$/i;

/** Matches `# GroupName` lines — alternate group notation. */
export const GROUP_HASH_RE = /^#\s+(.+)$/;

/** Matches `## ...` lines — parse error with helpful hint. */
export const DOUBLE_HASH_RE = /^##\s/;

// ── New shared utilities ─────────────────────────────────────

/**
 * Parse the first non-empty, non-comment line to extract chart type and optional title.
 * The first token is matched against `ALL_CHART_TYPES`; the remainder is the title.
 *
 * Returns `null` if the first token is not a recognized chart type.
 */
export function parseFirstLine(
  line: string,
): { chartType: string; title: string | undefined } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//')) return null;

  // Try old-style `chart: type` first (for transition)
  const oldMatch = trimmed.match(CHART_TYPE_RE);
  if (oldMatch) {
    const parts = oldMatch[1].trim();
    // Could be `chart: gantt My Title` — first token is type
    const spaceIdx = parts.indexOf(' ');
    if (spaceIdx === -1) {
      const ct = parts.toLowerCase();
      return ALL_CHART_TYPES.has(ct) ? { chartType: ct, title: undefined } : null;
    }
    const ct = parts.substring(0, spaceIdx).toLowerCase();
    if (ALL_CHART_TYPES.has(ct)) {
      return { chartType: ct, title: parts.substring(spaceIdx + 1).trim() || undefined };
    }
    return null;
  }

  // New-style: first token is chart type, rest is title
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    const ct = trimmed.toLowerCase();
    return ALL_CHART_TYPES.has(ct) ? { chartType: ct, title: undefined } : null;
  }
  const firstToken = trimmed.substring(0, spaceIdx).toLowerCase();
  if (!ALL_CHART_TYPES.has(firstToken)) return null;
  return { chartType: firstToken, title: trimmed.substring(spaceIdx + 1).trim() || undefined };
}

/** Result of `prescanOptions()` — options collected from a two-pass scan. */
export interface PrescanResult {
  /** Key-value options, e.g., `direction LR` → `{ direction: 'LR' }` */
  options: Record<string, string>;
  /** Presence-based boolean options, e.g., `critical-path` → Set('critical-path') */
  booleans: Set<string>;
  /** Negated booleans, e.g., `no-dependencies` → Set('dependencies') */
  negated: Set<string>;
}

/**
 * Pre-scan all lines to collect options that can appear anywhere in the file.
 *
 * For each non-indented, non-comment line:
 * - If the first token is a known option key and the line has more tokens → key-value option
 * - If the first token is a known boolean key (bare keyword) → boolean enabled
 * - If the first token starts with `no-` and the rest is a known boolean → negated
 *
 * Comment handling: full comment lines (`// ...`) are skipped. Inline comments
 * are stripped before extraction (`direction LR // override` → option `direction: LR`).
 *
 * @param lines All lines of the document
 * @param knownOptions Set of recognized option key names (e.g., `direction`, `start`, `notation`)
 * @param knownBooleans Set of recognized boolean option names (e.g., `critical-path`, `animate`)
 */
export function prescanOptions(
  lines: string[],
  knownOptions: Set<string>,
  knownBooleans: Set<string> = new Set(),
): PrescanResult {
  const options: Record<string, string> = {};
  const booleans = new Set<string>();
  const negated = new Set<string>();

  for (const raw of lines) {
    // Skip indented lines — these are content, not top-level options
    if (raw.length > 0 && (raw[0] === ' ' || raw[0] === '\t')) continue;

    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Strip inline comments
    const commentIdx = trimmed.indexOf(' //');
    const effective = commentIdx >= 0 ? trimmed.substring(0, commentIdx).trim() : trimmed;
    if (!effective) continue;

    // Extract first token
    const spaceIdx = effective.indexOf(' ');
    const firstToken = (spaceIdx === -1 ? effective : effective.substring(0, spaceIdx)).toLowerCase();

    // Check for bare boolean (presence = on)
    if (spaceIdx === -1 && knownBooleans.has(firstToken)) {
      booleans.add(firstToken);
      continue;
    }

    // Check for negated boolean: `no-X` where X is a known boolean
    if (spaceIdx === -1 && firstToken.startsWith('no-')) {
      const base = firstToken.substring(3);
      if (knownBooleans.has(base)) {
        negated.add(base);
        continue;
      }
    }

    // Check for boolean with a value (e.g., `today-marker 2026-03-26`) —
    // must come before pure key-value check so booleans flag is also set
    if (spaceIdx !== -1 && knownBooleans.has(firstToken)) {
      booleans.add(firstToken);
      options[firstToken] = effective.substring(spaceIdx + 1).trim();
      continue;
    }

    // Check for key-value option
    if (spaceIdx !== -1 && knownOptions.has(firstToken)) {
      options[firstToken] = effective.substring(spaceIdx + 1).trim();
      continue;
    }
  }

  return { options, booleans, negated };
}

/**
 * Normalize a comma-grouped number string to a plain integer string.
 * Validates the strict pattern: leftmost group 1-3 digits, then groups of exactly 3.
 *
 * Examples: `1,087` → `'1087'`, `1,250,000` → `'1250000'`
 * Returns `null` if the string is not a valid comma-grouped number.
 */
export function normalizeGroupedNumber(token: string): string | null {
  if (!/^\d{1,3}(,\d{3})+$/.test(token)) return null;
  return token.replace(/,/g, '');
}

/**
 * Strip surrounding quotes (`"` or `'`) from a token.
 * Returns the unquoted content, or the original string if not quoted.
 */
export function stripQuotes(token: string): string {
  if (token.length >= 2) {
    if ((token[0] === '"' && token[token.length - 1] === '"') ||
        (token[0] === "'" && token[token.length - 1] === "'")) {
      return token.substring(1, token.length - 1);
    }
  }
  return token;
}

/**
 * Quote-aware tokenizer — splits a string by whitespace but keeps quoted
 * substrings (`"double"` or `'single'`) as single tokens.
 * Quotes are preserved in the output tokens — call `stripQuotes()` to remove them.
 */
export function tokenizeQuoteAware(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    // Skip whitespace
    if (input[i] === ' ' || input[i] === '\t') { i++; continue; }

    // Quoted token
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i];
      const start = i;
      i++; // skip opening quote
      while (i < input.length && input[i] !== quote) i++;
      if (i < input.length) i++; // skip closing quote
      tokens.push(input.substring(start, i));
      continue;
    }

    // Unquoted token
    const start = i;
    while (i < input.length && input[i] !== ' ' && input[i] !== '\t') i++;
    tokens.push(input.substring(start, i));
  }
  return tokens;
}

/**
 * Collect indented continuation lines as individual values.
 * Used when a property like `series:` has an empty value — subsequent
 * indented lines each become one value entry.
 *
 * - Skips blank lines and `//` comment lines within the block
 * - Stops at first non-indented non-empty line (or EOF)
 * - Strips trailing commas from values (user habit tolerance)
 * - Returns `newIndex` so caller does `i = newIndex` and the loop's `i++` lands correctly
 */
export function collectIndentedValues(
  lines: string[],
  startIndex: number,
): { values: string[]; lineNumbers: number[]; newIndex: number } {
  const values: string[] = [];
  const lineNumbers: number[] = [];
  let j = startIndex + 1;
  for (; j < lines.length; j++) {
    const raw = lines[j];
    const trimmed = raw.trim();
    // Skip blank lines within the block
    if (!trimmed) continue;
    // Skip comment lines within the block
    if (trimmed.startsWith('//')) continue;
    // Stop at non-indented lines (first char is not whitespace)
    if (raw[0] !== ' ' && raw[0] !== '\t') break;
    // Strip trailing comma and collect
    values.push(trimmed.replace(/,\s*$/, ''));
    lineNumbers.push(j + 1); // 1-based
  }
  return { values, lineNumbers, newIndex: j - 1 };
}

/**
 * Parse series names from a `series:` value or indented block, extracting
 * optional per-name color suffixes. Shared between chart.ts and echarts.ts.
 *
 * Returns the parsed names, optional colors, and the raw series string
 * (for single-series display), plus `newIndex` if indented values were consumed.
 */
export function parseSeriesNames(
  value: string,
  lines: string[],
  lineIndex: number,
  palette?: PaletteColors,
): {
  series: string;
  names: string[];
  nameColors: (string | undefined)[];
  nameLineNumbers: number[];
  newIndex: number;
} {
  let rawNames: string[];
  let series: string;
  let newIndex = lineIndex;
  let nameLineNumbers: number[] = [];
  if (value) {
    series = value;
    rawNames = value.split(',').map((s) => s.trim()).filter(Boolean);
    // Inline series names all share the same line number
    nameLineNumbers = rawNames.map(() => lineIndex + 1);
  } else {
    const collected = collectIndentedValues(lines, lineIndex);
    newIndex = collected.newIndex;
    rawNames = collected.values;
    nameLineNumbers = collected.lineNumbers;
    series = rawNames.join(', ');
  }
  const names: string[] = [];
  const nameColors: (string | undefined)[] = [];
  for (const raw of rawNames) {
    const extracted = extractColor(raw, palette);
    nameColors.push(extracted.color);
    names.push(extracted.label);
  }
  if (names.length === 1) {
    series = names[0];
  }
  return { series, names, nameColors, nameLineNumbers, newIndex };
}

/**
 * Normalize a direction/orientation value to canonical form ('LR' | 'TB').
 * Accepts 'lr', 'tb', 'horizontal', 'vertical' (case-insensitive).
 * Returns null if the value is not recognized.
 */
export function normalizeDirection(value: string): 'LR' | 'TB' | null {
  const v = value.trim().toLowerCase();
  if (v === 'lr' || v === 'horizontal') return 'LR';
  if (v === 'tb' || v === 'vertical') return 'TB';
  return null;
}

/**
 * Infer arrow color from label text.
 * Returns a named palette color or undefined if no inference applies.
 * Case-insensitive, exact match only (not prefix/substring).
 */
export function inferArrowColor(label: string): string | undefined {
  const lower = label.toLowerCase();
  // Green: positive/affirmative
  if (lower === 'yes' || lower === 'success' || lower === 'ok' || lower === 'true') return 'green';
  // Red: negative/failure
  if (lower === 'no' || lower === 'fail' || lower === 'error' || lower === 'false') return 'red';
  // Orange: uncertain/warning
  if (lower === 'maybe' || lower === 'warning') return 'orange';
  return undefined;
}

/** Warning message for multiple pipes on a single line. */
export const MULTIPLE_PIPE_WARNING =
  'Use a single "|" to start metadata, then separate items with commas.';

/**
 * Parse metadata from segments after the first (name) segment.
 * A single `|` separates the label from metadata; items after the pipe are comma-delimited.
 * Multiple pipes are treated as commas for backward compatibility but trigger a warning.
 */
export function parsePipeMetadata(
  segments: string[],
  aliasMap: Map<string, string> = new Map(),
  warnMultiplePipes?: () => void,
): Record<string, string> {
  if (segments.length > 2 && warnMultiplePipes) {
    warnMultiplePipes();
  }
  const metadata: Record<string, string> = {};
  const raw = segments.slice(1).join(',');
  for (const part of raw.split(',')) {
    const trimmedPart = part.trim();
    if (!trimmedPart) continue;
    const colonIdx = trimmedPart.indexOf(':');
    if (colonIdx > 0) {
      const rawKey = trimmedPart.substring(0, colonIdx).trim().toLowerCase();
      const key = aliasMap.get(rawKey) ?? rawKey;
      const value = trimmedPart.substring(colonIdx + 1).trim();
      metadata[key] = value;
    }
  }
  return metadata;
}

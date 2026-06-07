/**
 * Shared parser utilities — extracted from individual parsers to eliminate
 * duplication of measureIndent, extractColor, header regexes, and
 * pipe-metadata parsing.
 */

import {
  RECOGNIZED_COLOR_NAMES,
  resolveColor,
  resolveColorWithDiagnostic,
} from '../colors';
import {
  emptyMetadataValueMessage,
  makeDgmoError,
  METADATA_DIAGNOSTIC_CODES,
  suggest,
  type DgmoError,
} from '../diagnostics';
import type { PaletteColors } from '../palettes';
import {
  isReservedKey,
  type ReservedKeyRegistry,
} from './reserved-key-registry';

const RECOGNIZED_COLOR_SET: ReadonlySet<string> = new Set(
  RECOGNIZED_COLOR_NAMES
);

// ── All known chart types ────────────────────────────────────
/** Complete set of recognized chart type identifiers. */
export const ALL_CHART_TYPES = new Set([
  // data charts
  'bar',
  'line',
  'pie',
  'doughnut',
  'area',
  'polar-area',
  'radar',
  'bar-stacked',
  'multi-line',
  'scatter',
  'sankey',
  'chord',
  'function',
  'heatmap',
  'funnel',
  // visualizations
  'slope',
  'wordcloud',
  'arc',
  'timeline',
  'venn',
  'quadrant',
  // diagrams
  'sequence',
  'flowchart',
  'class',
  'er',
  'org',
  'kanban',
  'c4',
  'state',
  'sitemap',
  'infra',
  'gantt',
  'pert',
  'boxes-and-lines',
  'mindmap',
  'wireframe',
  'tech-radar',
  'cycle',
  'journey-map',
  'pyramid',
  'ring',
  'raci',
  'rasci',
  'daci',
  'map',
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

/**
 * Trailing-token color rule (see docs/dgmo-language-spec.md §1.5).
 *
 * Caller contract: `label` must be a pre-split LABEL REGION — the parser is
 * responsible for stripping structural terminators (`as <alias>`, `| pipe
 * metadata`, numeric values, date ranges, brackets, arrow constructs) BEFORE
 * invoking this function. The color rule operates only on what remains.
 *
 * Algorithm: split the label on whitespace; if the final token is exactly one
 * of `RECOGNIZED_COLOR_NAMES` (case-sensitive, lowercase only), peel it off
 * as color and return the rest as the label. Otherwise the entire input
 * stays as the label, no color.
 *
 * Case-sensitivity is deliberate: it provides the escape hatch (`Red`,
 * `Yellow`, `Green` stay as labels — useful for traffic-light tag groups).
 *
 * Returns `{ label, color? }` where `color` is the palette-resolved hex string
 * (or undefined if no color word matched).
 */
export function extractColor(
  label: string,
  palette?: PaletteColors,
  diagnostics?: DgmoError[],
  line?: number
): { label: string; color?: string } {
  const lastSpaceIdx = Math.max(
    label.lastIndexOf(' '),
    label.lastIndexOf('\t')
  );
  if (lastSpaceIdx < 0) return { label };
  const trailing = label.substring(lastSpaceIdx + 1);
  // Case-sensitive lowercase match against the closed 11-name palette.
  if (!RECOGNIZED_COLOR_SET.has(trailing)) return { label };
  let color: string | undefined;
  if (diagnostics && line !== undefined) {
    color = resolveColorWithDiagnostic(trailing, line, diagnostics, palette);
  } else {
    color = resolveColor(trailing, palette) ?? undefined;
  }
  return {
    label: label.substring(0, lastSpaceIdx).trimEnd(),
    ...(color !== undefined && { color }),
  };
}

/** Matches `option value` header lines (space-separated, no colon). */
export const OPTION_NOCOLON_RE = /^([a-z][a-z0-9-]*)\s+(.+)$/i;

/**
 * Cross-chart-type bare-boolean directives recognized in every chart parser.
 * Add new universal flags here so each parser's `tryParseSharedOption()` call
 * picks them up uniformly without per-parser changes.
 */
export const GLOBAL_BOOLEANS: ReadonlySet<string> = new Set([
  'solid-fill',
  'no-title',
  'no-notes',
]);

/**
 * If `token` (after trim, case-insensitive) matches a registered cross-cutting
 * boolean directive, returns its canonical key. Otherwise returns null.
 */
export function recognizeGlobalBoolean(token: string): string | null {
  const t = token.trim().toLowerCase();
  return GLOBAL_BOOLEANS.has(t) ? t : null;
}

/**
 * Try to parse a line as a cross-chart-type bare-keyword option. Returns true
 * if the line matched (and the option was set on `options[key] = 'on'`).
 *
 * Use inside each parser's option block so the keyword is recognized uniformly
 * across all chart types without each parser duplicating the regex.
 */
export function tryParseSharedOption(
  line: string,
  options: Record<string, string>
): boolean {
  const key = recognizeGlobalBoolean(line);
  if (key) {
    options[key] = 'on';
    return true;
  }
  return false;
}

// ── New shared utilities ─────────────────────────────────────

/**
 * Parse the first non-empty, non-comment line to extract chart type and optional title.
 * The first token is matched against `ALL_CHART_TYPES`; the remainder is the title.
 *
 * Returns `null` if the first token is not a recognized chart type.
 */
export function parseFirstLine(
  line: string
): { chartType: string; title: string | undefined } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//')) return null;

  // First token is chart type, rest is title
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    const ct = trimmed.toLowerCase();
    return ALL_CHART_TYPES.has(ct) ? { chartType: ct, title: undefined } : null;
  }
  const firstToken = trimmed.substring(0, spaceIdx).toLowerCase();
  if (!ALL_CHART_TYPES.has(firstToken)) return null;
  return {
    chartType: firstToken,
    title: trimmed.substring(spaceIdx + 1).trim() || undefined,
  };
}

/** Result of `prescanOptions()` — options collected from a two-pass scan. */
interface PrescanResult {
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
  knownBooleans: Set<string> = new Set()
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
    const effective =
      commentIdx >= 0 ? trimmed.substring(0, commentIdx).trim() : trimmed;
    if (!effective) continue;

    // Extract first token
    const spaceIdx = effective.indexOf(' ');
    const firstToken = (
      spaceIdx === -1 ? effective : effective.substring(0, spaceIdx)
    ).toLowerCase();

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
 * Normalize a numeric token with visual separators (commas or underscores) to a plain number string.
 *
 * Supported formats:
 * - Comma-grouped integers: `1,000` → `'1000'`, `1,234,567` → `'1234567'` (strict 3-digit grouping)
 * - Comma-grouped decimals: `1,234.56` → `'1234.56'`
 * - Underscore-separated integers: `1_000` → `'1000'`, `10_00_000` → `'1000000'` (any grouping)
 * - Underscore-separated decimals: `1_234.56` → `'1234.56'` (no underscores in decimal part)
 * - Negatives: `-1,000` → `'-1000'`, `-1_000` → `'-1000'`
 *
 * Returns `null` if:
 * - Token has no commas or underscores (caller should use raw token as-is)
 * - Token has BOTH commas and underscores (mixed separators rejected)
 * - Token has separators but doesn't match any valid pattern
 */
export function normalizeNumericToken(token: string): string | null {
  // No separators → null (caller uses raw token)
  if (!token.includes(',') && !token.includes('_')) return null;
  // Mixed separators → rejected
  if (token.includes(',') && token.includes('_')) return null;

  // Strip optional leading minus sign
  let sign = '';
  let unsigned = token;
  if (unsigned.startsWith('-')) {
    sign = '-';
    unsigned = unsigned.substring(1);
  }
  if (!unsigned) return null;

  if (unsigned.includes(',')) {
    // Comma-grouped integers: 1,000 or 1,234,567
    if (/^\d{1,3}(,\d{3})+$/.test(unsigned))
      return sign + unsigned.replace(/,/g, '');
    // Comma-grouped decimals: 1,234.56
    if (/^\d{1,3}(,\d{3})+\.\d+$/.test(unsigned))
      return sign + unsigned.replace(/,/g, '');
    return null;
  }

  // Underscore-separated integers: 1_000, 10_00_000
  if (/^\d+(_\d+)+$/.test(unsigned)) return sign + unsigned.replace(/_/g, '');
  // Underscore-separated decimals: 1_234.56 (no underscores in decimal part)
  if (/^\d+(_\d+)*\.\d+$/.test(unsigned) && unsigned.includes('_'))
    return sign + unsigned.replace(/_/g, '');
  return null;
}

/**
 * Strip surrounding quotes (`"` or `'`) from a token.
 * Returns the unquoted content, or the original string if not quoted.
 */
export function stripQuotes(token: string): string {
  if (token.length >= 2) {
    if (
      (token[0] === '"' && token[token.length - 1] === '"') ||
      (token[0] === "'" && token[token.length - 1] === "'")
    ) {
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
    if (input[i] === ' ' || input[i] === '\t') {
      i++;
      continue;
    }

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
  startIndex: number
): { values: string[]; lineNumbers: number[]; newIndex: number } {
  const values: string[] = [];
  const lineNumbers: number[] = [];
  let j = startIndex + 1;
  for (; j < lines.length; j++) {
    // In-bounds by loop guard.
    const raw = lines[j]!;
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
  diagnostics?: DgmoError[]
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
  let nameLineNumbers: number[] = []; // eslint-disable-line no-useless-assignment
  if (value) {
    series = value;
    rawNames = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
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
  for (let i = 0; i < rawNames.length; i++) {
    // Loop bound guarantees both are defined; nameLineNumbers is built
    // 1:1 with rawNames in both upstream branches.
    const raw = rawNames[i]!;
    const extracted = extractColor(
      raw,
      palette,
      diagnostics,
      nameLineNumbers[i]!
    );
    nameColors.push(extracted.color);
    names.push(extracted.label);
  }
  if (names.length === 1) {
    series = names[0]!;
  }
  return { series, names, nameColors, nameLineNumbers, newIndex };
}

/**
 * Peel a trailing recognized color name from a label region, returning the
 * raw color name (not a resolved hex). Used by chart types that pair the
 * universal trailing-token shortcut with their own pipe-metadata `color: …`
 * long form (cycle, pyramid, ring, raci, boxes-and-lines).
 *
 * Caller contract: `label` must already have pipe metadata stripped — this
 * function operates only on the label region.
 *
 * Returns `{ label, colorName? }`. If the trailing token is not a recognized
 * lowercase color, returns the original label and `colorName: undefined`.
 */
export function peelTrailingColorName(label: string): {
  label: string;
  colorName?: string;
} {
  const lastSpaceIdx = Math.max(
    label.lastIndexOf(' '),
    label.lastIndexOf('\t')
  );
  if (lastSpaceIdx < 0) return { label };
  const trailing = label.substring(lastSpaceIdx + 1);
  if (!RECOGNIZED_COLOR_SET.has(trailing)) return { label };
  return {
    label: label.substring(0, lastSpaceIdx).trimEnd(),
    colorName: trailing,
  };
}

/**
 * Peel up to TWO trailing recognized color names from a label region — the
 * shared value-ramp coloring convention (`<metric> <low?> <high?>`). Peels from
 * the right, stops at the first non-color token, peels AT MOST 2, and NEVER
 * reduces the label to empty (a 2nd peel that would empty the label is left as
 * label text).
 *
 * Mapping (locked): one peeled color ⇒ `{ high }` only (today's neutral→hue
 * meaning); two peeled ⇒ first(left) = `low`, second(right) = `high`.
 * Order-respecting — NO sorting, NO "did-you-mean" intent detection.
 *
 * Shared by any value-ramp chart type (map `region-metric`, b&l `box-metric`,
 * and future ramps). `peelTrailingColorName` (single-token) stays untouched for
 * the non-ramp callers (d3, sitemap, cycle, …).
 */
export function peelRampColors(label: string): {
  label: string;
  low?: string;
  high?: string;
} {
  // Peel a single trailing recognized color, but only if a token remains in
  // front of it (a lone token is never peeled — that would empty the label).
  const peelOne = (s: string): { rest: string; color?: string } => {
    const idx = Math.max(s.lastIndexOf(' '), s.lastIndexOf('\t'));
    if (idx < 0) return { rest: s };
    const trailing = s.substring(idx + 1);
    if (!RECOGNIZED_COLOR_SET.has(trailing)) return { rest: s };
    return { rest: s.substring(0, idx).trimEnd(), color: trailing };
  };
  // High (rightmost) first.
  const first = peelOne(label);
  if (first.color === undefined) return { label };
  // Low (second-from-right) — only if a non-empty label still remains after.
  const second = peelOne(first.rest);
  if (second.color === undefined) {
    return { label: first.rest, high: first.color };
  }
  return { label: second.rest, low: second.color, high: first.color };
}

/** Error message for multiple pipes on a single line. */
export const MULTIPLE_PIPE_ERROR =
  'Use a single "|" to start metadata, then separate items with commas.';

/**
 * Parse metadata from segments after the first (name) segment.
 * A single `|` separates the label from metadata; items after the pipe are comma-delimited.
 * Multiple pipes produce an error.
 */
export function parsePipeMetadata(
  segments: string[],
  aliasMap: Map<string, string> = new Map(),
  errorMultiplePipes?: () => void
): Record<string, string> {
  if (segments.length > 2) {
    if (errorMultiplePipes) errorMultiplePipes();
    return {};
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

// ============================================================
// Unified Metadata Grammar (§1.4) — splitNameAndMeta
// ============================================================
//
// Same-line metadata split for the unified §1.4 grammar.
//
// Cut order on the input line (per §1.5):
//   1. Locate the first reserved-key `<key>:` token (anchors the
//      name region / metadata region boundary).
//   2. Strip `as <alias>` postfix from the right side of the name
//      region.
//   3. Apply §1.5 trailing-token color to whatever remains of the
//      name region.
//
// Quoted name tokens (`"Auth: Service"`) are tokenized as one unit
// BEFORE the first-`:`-token scan — colons inside quoted strings do
// not trigger the metadata cut.
//
// Quoted metadata values (`description: "with, commas"`) escape the
// comma terminator within the metadata region.

export interface SplitNameAndMetaResult {
  /** Name region with color and `as <alias>` postfix stripped. */
  name: string;
  /** Parsed metadata key/value pairs (alias-resolved per the registry). */
  meta: Record<string, string>;
  /**
   * Trailing-token color name from the name region, if any
   * (raw color word like "blue" — NOT a resolved hex string).
   * Callers wanting hex should pass the result through `resolveColor()`.
   */
  color?: string;
  /** Alias declared via `as <alias>` postfix, if any. */
  alias?: string;
}

const RESERVED_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const AS_ALIAS_RE = /\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})$/;

/**
 * Tokenize a line for the §1.4 metadata-cut scan:
 * preserves quoted strings (`"..."` / `'...'`) as single tokens and
 * tracks the byte offset of each token's start in the original line
 * so callers can recover the exact name-region substring.
 */
interface ScanToken {
  /** Token text (with surrounding quotes preserved for quoted tokens). */
  readonly text: string;
  /** Start offset in the original line. */
  readonly start: number;
  /** End offset (exclusive) in the original line. */
  readonly end: number;
  /** True if this token was quoted (`"..."` / `'...'`). */
  readonly quoted: boolean;
}

function scanTokens(line: string): ScanToken[] {
  const tokens: ScanToken[] = [];
  let i = 0;
  while (i < line.length) {
    // Skip whitespace
    if (line[i] === ' ' || line[i] === '\t') {
      i++;
      continue;
    }
    if (line[i] === '"' || line[i] === "'") {
      const quote = line[i];
      const start = i;
      i++; // skip opening quote
      while (i < line.length && line[i] !== quote) i++;
      if (i < line.length) i++; // skip closing quote
      tokens.push({
        text: line.substring(start, i),
        start,
        end: i,
        quoted: true,
      });
      continue;
    }
    const start = i;
    while (i < line.length && line[i] !== ' ' && line[i] !== '\t') i++;
    tokens.push({
      text: line.substring(start, i),
      start,
      end: i,
      quoted: false,
    });
  }
  return tokens;
}

/**
 * Locate the first colon-bearing position whose preceding identifier
 * matches a reserved key, tolerating whitespace around `:` (per spec
 * §1.4.1). Returns the byte offset in the original line where the
 * name region ends (i.e. start of the key token), or `-1` if no
 * metadata cut applies.
 *
 * Quoted-token contents (a `:` inside `"..."`) never trigger the cut.
 */
function findMetadataCutOffset(
  line: string,
  tokens: ScanToken[],
  registry: ReservedKeyRegistry
): number {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.quoted) continue;
    const inlineColon = tok.text.indexOf(':');

    if (inlineColon > 0) {
      // Shape `<key>:[...]` inside this token (no whitespace before `:`).
      const keyPart = tok.text.substring(0, inlineColon);
      if (
        RESERVED_KEY_RE.test(keyPart) &&
        isReservedKey(registry, keyPart.toLowerCase())
      ) {
        return tok.start;
      }
    } else if (inlineColon < 0) {
      // Token has no colon — check whether (a) the whole token is a
      // reserved key and (b) the next non-empty content begins with `:`.
      if (
        RESERVED_KEY_RE.test(tok.text) &&
        isReservedKey(registry, tok.text.toLowerCase())
      ) {
        const tail = line.substring(tok.end).replace(/^[ \t]+/, '');
        if (tail.startsWith(':')) {
          return tok.start;
        }
      }
    }
    // `inlineColon === 0` — token starts with `:`, e.g. `:Bar` after
    // a bare key. Skip; the bare-key path above (one iteration earlier)
    // already considered the preceding token.
  }
  return -1;
}

/**
 * Parse the metadata region (substring starting at the metadata cut
 * token through end-of-line) into a key/value record. Handles
 * quoted values (`"with, commas"`) for comma escape, whitespace
 * tolerance around `:`, empty-value diagnostics, and tag-alias
 * resolution via the supplied aliasMap (callers responsible for
 * converting `tag Concern as c` declarations into `c → concern`).
 */
function parseMetadataRegion(
  region: string,
  aliasMap: Map<string, string>,
  diagnostics?: DgmoError[],
  line?: number
): Record<string, string> {
  const meta: Record<string, string> = {};
  let i = 0;
  while (i < region.length) {
    // Skip leading whitespace + commas (commas separate pairs)
    while (
      i < region.length &&
      (region[i] === ' ' || region[i] === '\t' || region[i] === ',')
    )
      i++;
    if (i >= region.length) break;
    // Read key
    const keyStart = i;
    while (i < region.length && region[i] !== ':' && region[i] !== ',') i++;
    if (i >= region.length || region[i] !== ':') break;
    const rawKey = region.substring(keyStart, i).trim().toLowerCase();
    if (!rawKey) break;
    i++; // skip ':'
    // Skip whitespace after colon
    while (i < region.length && (region[i] === ' ' || region[i] === '\t')) i++;
    // Read value — quoted (everything up to closing quote) or
    // unquoted (everything up to next unquoted comma).
    let value: string;
    if (i < region.length && (region[i] === '"' || region[i] === "'")) {
      const quote = region[i];
      i++; // skip opening quote
      const vStart = i;
      while (i < region.length && region[i] !== quote) i++;
      value = region.substring(vStart, i);
      if (i < region.length) i++; // skip closing quote
      // Skip trailing whitespace; next iteration handles comma.
      while (i < region.length && (region[i] === ' ' || region[i] === '\t'))
        i++;
    } else {
      const vStart = i;
      while (i < region.length && region[i] !== ',') i++;
      value = region.substring(vStart, i).trim();
    }
    const key = aliasMap.get(rawKey) ?? rawKey;
    if (!value) {
      if (diagnostics && line !== undefined) {
        diagnostics.push(
          makeDgmoError(
            line,
            emptyMetadataValueMessage(rawKey),
            'warning',
            METADATA_DIAGNOSTIC_CODES.EMPTY_METADATA_VALUE
          )
        );
      }
      // Drop the empty-value pair per §1.4.1.
      continue;
    }
    meta[key] = value;
  }
  return meta;
}

/**
 * Split a single line into name region + metadata per the unified
 * §1.4 metadata grammar.
 *
 * Applies the §1.5 cut order: metadata-cut first, then `as <alias>`
 * postfix strip, then trailing-token color on what remains of the
 * name region.
 *
 * @param line       The source line (already trimmed of leading indent).
 * @param registry   Active reserved-key registry for this chart type.
 * @param aliasMap   Optional tag-alias → canonical-key map (e.g. `c → concern`).
 * @param palette    Optional palette for color resolution.
 * @param diagnostics Optional accumulator for `W_EMPTY_METADATA_VALUE`.
 * @param lineNumber 1-based line number for diagnostics.
 */
export interface SplitNameAndMetaOptions {
  /**
   * When `false`, the §1.5 `as <alias>` postfix peel is skipped.
   * Set this for parsers whose name region can legitimately contain
   * the word "as" followed by a short identifier (e.g. tech-radar's
   * `Infrastructure as Code` blip name). Chart types that own an
   * alias form via their own keywords (`alias <a>`, `aka <a>`) are
   * the typical reason to disable. Default: true.
   */
  readonly peelAlias?: boolean;
}

export function splitNameAndMeta(
  line: string,
  registry: ReservedKeyRegistry,
  aliasMap: Map<string, string> = new Map(),
  palette?: PaletteColors,
  diagnostics?: DgmoError[],
  lineNumber?: number,
  options: SplitNameAndMetaOptions = {}
): SplitNameAndMetaResult {
  const tokens = scanTokens(line);
  const cutOffset = findMetadataCutOffset(line, tokens, registry);

  let nameRegion: string;
  let metaRegion: string;

  if (cutOffset === -1) {
    nameRegion = line.trim();
    metaRegion = '';
  } else {
    nameRegion = line.substring(0, cutOffset).trimEnd();
    metaRegion = line.substring(cutOffset);
  }

  // §1.5 cut order on the name region:
  // (1) trailing-token color, (2) `as <alias>` postfix.
  // Aliases sit *between* the label and the trailing color in source
  // order (`<label> as <alias> <color>`), so peeling color first
  // exposes the alias at end-of-string for the regex.
  // Use the raw-color-name peel (not the hex-resolved one) so the
  // returned `color` field matches the storage shape most parsers
  // expect — callers wanting hex pass through `resolveColor()`.
  const colorResult = peelTrailingColorName(nameRegion);
  let postColorName = colorResult.label;

  let alias: string | undefined;
  if (options.peelAlias !== false) {
    const aliasMatch = postColorName.match(AS_ALIAS_RE);
    if (aliasMatch) {
      alias = aliasMatch[1];
      postColorName = postColorName.substring(0, aliasMatch.index).trimEnd();
    }
  }

  const meta =
    metaRegion.length > 0
      ? parseMetadataRegion(metaRegion, aliasMap, diagnostics, lineNumber)
      : {};

  // Mark palette/diagnostics as intentionally unused for the
  // current peel path (kept on the signature for future hex-mode
  // callers); reference them once so eslint no-unused-vars is happy.
  void palette;
  // Avoid breaking call sites that pass diagnostics — currently we
  // only emit W_EMPTY_METADATA_VALUE from inside parseMetadataRegion.
  // The lineNumber + palette stay for symmetry with extractColor.

  return {
    name: postColorName,
    meta,
    ...(colorResult.colorName !== undefined && {
      color: colorResult.colorName,
    }),
    ...(alias !== undefined && { alias }),
  };
}

const POTENTIAL_META_RE = /\b([\w-]+)\s*:/;

export function warnUnknownMetaKeys(
  meta: Record<string, string>,
  registry: ReservedKeyRegistry,
  warn: (message: string) => void,
  nameToScan?: string
): void {
  const candidates = Array.from(registry.keys);

  for (const key of Object.keys(meta)) {
    if (isReservedKey(registry, key)) continue;
    const hint = suggest(key, candidates);
    warn(`Unknown metadata key "${key}".${hint ? ' ' + hint : ''}`);
  }

  if (nameToScan) {
    const m = nameToScan.match(POTENTIAL_META_RE);
    if (m) {
      const key = m[1]!.toLowerCase();
      if (!isReservedKey(registry, key)) {
        const hint = suggest(key, candidates);
        if (hint) {
          warn(`Unknown metadata key "${key}". ${hint}`);
        }
      }
    }
  }
}

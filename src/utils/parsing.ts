/**
 * Shared parser utilities — extracted from individual parsers to eliminate
 * duplication of measureIndent, extractColor, header regexes, and
 * pipe-metadata parsing.
 */

import { resolveColor } from '../colors';
import type { PaletteColors } from '../palettes';

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
    color: resolveColor(colorName, palette),
  };
}

/** Matches `chart: <type>` header lines. */
export const CHART_TYPE_RE = /^chart\s*:\s*(.+)/i;

/** Matches `title: <text>` header lines. */
export const TITLE_RE = /^title\s*:\s*(.+)/i;

/** Matches `option: value` header lines. */
export const OPTION_RE = /^([a-z][a-z0-9-]*)\s*:\s*(.+)$/i;

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
): { values: string[]; newIndex: number } {
  const values: string[] = [];
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
  }
  return { values, newIndex: j - 1 };
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
  newIndex: number;
} {
  let rawNames: string[];
  let series: string;
  let newIndex = lineIndex;
  if (value) {
    series = value;
    rawNames = value.split(',').map((s) => s.trim()).filter(Boolean);
  } else {
    const collected = collectIndentedValues(lines, lineIndex);
    newIndex = collected.newIndex;
    rawNames = collected.values;
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
  return { series, names, nameColors, newIndex };
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

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

/** Parse pipe-delimited metadata from segments after the first (name) segment. */
export function parsePipeMetadata(
  segments: string[],
  aliasMap: Map<string, string> = new Map(),
): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (let j = 1; j < segments.length; j++) {
    for (const part of segments[j].split(',')) {
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
  }
  return metadata;
}

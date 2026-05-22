// ============================================================
// Pyramid Diagram — Parser
// ============================================================

import { makeDgmoError, formatDgmoError } from '../diagnostics';
import {
  measureIndent,
  parseFirstLine,
  parsePipeMetadata,
  peelTrailingColorName,
  tryParseSharedOption,
} from '../utils/parsing';
import type { ParsedPyramid, PyramidLayer } from './types';

/** Heuristic: pipe content is key:value form if it starts with `word:`. */
const KEY_VALUE_PREFIX_RE = /^\s*[A-Za-z][A-Za-z0-9_-]*\s*:/;

const MAX_LAYERS = 15;

/**
 * Parse a `.dgmo` pyramid diagram document.
 *
 * Top of file = apex of pyramid (reads top-down).
 *
 * Syntax:
 * ```
 * pyramid Maslow's Hierarchy of Needs
 *
 * inverted                               // optional — flips apex to bottom
 *
 * Self-Actualization                     // indented body = description
 *   Achieving one's full potential.
 *
 * Esteem | Respect, recognition          // bare pipe shorthand = description
 *
 * Love & Belonging | color: blue         // structured metadata
 *   Friendship, intimacy, family.
 *
 * Physiological | Food, water, rest
 * ```
 */
export function parsePyramid(content: string): ParsedPyramid {
  const result: ParsedPyramid = {
    type: 'pyramid',
    title: '',
    titleLineNumber: 0,
    layers: [],
    inverted: false,
    options: {},
    diagnostics: [],
    error: null,
  };

  const lines = content.split('\n');
  let headerParsed = false;
  let currentLayer: PyramidLayer | null = null;

  const fail = (line: number, message: string): ParsedPyramid => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  const warn = (
    line: number,
    message: string,
    severity: 'warning' | 'error' = 'warning'
  ): void => {
    result.diagnostics.push(makeDgmoError(line, message, severity));
  };

  const flushLayer = (): void => {
    if (currentLayer) {
      result.layers.push(currentLayer);
      currentLayer = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    // In-bounds by loop guard.
    const raw = lines[i]!;
    const trimmed = raw.trim();

    if (!trimmed || trimmed.startsWith('//')) continue;

    const indent = measureIndent(raw);

    // ── First line: chart type declaration ──
    if (!headerParsed) {
      const firstLineResult = parseFirstLine(trimmed);
      if (firstLineResult?.chartType === 'pyramid') {
        result.title = firstLineResult.title ?? '';
        result.titleLineNumber = lineNum;
        headerParsed = true;
        continue;
      }
      return fail(lineNum, 'Expected "pyramid [Title]" as the first line.');
    }

    // ── Bare directive: inverted ──
    if (indent === 0 && trimmed.toLowerCase() === 'inverted') {
      result.inverted = true;
      continue;
    }

    // ── Shared bare keyword: solid-fill ──
    if (indent === 0 && tryParseSharedOption(trimmed, result.options)) {
      continue;
    }

    // ── Top-level: layer declaration ──
    if (indent === 0) {
      flushLayer();

      const pipeIdx = trimmed.indexOf('|');
      let label: string;
      const description: string[] = [];
      let color: string | undefined;
      let restMeta: Record<string, string> = {};

      if (pipeIdx < 0) {
        label = trimmed;
      } else {
        label = trimmed.substring(0, pipeIdx).trim();
        const after = trimmed.substring(pipeIdx + 1).trim();

        if (!after) {
          // Trailing pipe with nothing after — ignore.
        } else if (KEY_VALUE_PREFIX_RE.test(after)) {
          // Structured metadata: color: foo, other: bar
          const metadata = parsePipeMetadata([label, after]);
          color = metadata['color'];
          const descFromPipe = metadata['description'];
          if (descFromPipe) description.push(descFromPipe);
          restMeta = { ...metadata };
          delete restMeta['color'];
          delete restMeta['description'];
        } else {
          // Bare shorthand: pipe content is the description.
          description.push(after);
        }
      }

      if (!label) {
        warn(lineNum, 'Empty layer label.');
        continue;
      }

      // Universal trailing-token shortcut: `Label color` is equivalent to
      // `Label | color: <name>` when color is the only metadata key (§1.5).
      if (!color) {
        const { label: stripped, colorName: shortcutColor } =
          peelTrailingColorName(label);
        if (shortcutColor) {
          color = shortcutColor;
          label = stripped;
        }
      }

      currentLayer = {
        label,
        lineNumber: lineNum,
        ...(color !== undefined && { color }),
        description,
        metadata: restMeta,
      };
      continue;
    }

    // ── Indented: description line under current layer ──
    if (!currentLayer) {
      warn(lineNum, `Unexpected indented line: "${trimmed}".`);
      continue;
    }
    const descLine = trimmed.startsWith('- ')
      ? `• ${trimmed.substring(2)}`
      : trimmed;
    currentLayer.description.push(descLine);
  }

  flushLayer();

  if (result.layers.length < 2) {
    return fail(
      result.titleLineNumber || 1,
      'pyramid requires at least 2 layers.'
    );
  }

  if (result.layers.length > MAX_LAYERS) {
    return fail(
      result.titleLineNumber || 1,
      `pyramid supports at most ${MAX_LAYERS} layers; got ${result.layers.length}.`
    );
  }

  return result;
}

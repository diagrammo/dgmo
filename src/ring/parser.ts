// ============================================================
// Ring Diagram — Parser
// ============================================================

import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import { resolveColor, RECOGNIZED_COLOR_NAMES } from '../colors';
import {
  measureIndent,
  parseFirstLine,
  parsePipeMetadata,
  tryParseSharedOption,
  PIPE_KEY_VALUE_PREFIX_RE,
  PIPE_LIKELY_STRUCTURED_TAIL_RE,
} from '../utils/parsing';
import type { ParsedRing, RingLayer } from './types';

const MAX_LAYERS = 15;
/** Pipe-metadata keys ring layers recognize. Anything else emits a warning. */
const KNOWN_PIPE_KEYS = new Set(['color', 'description']);

/**
 * Parse a `.dgmo` ring diagram document.
 *
 * Top of file = innermost ring (rendered as a filled disc).
 * Last layer in source = outermost ring.
 */
export function parseRing(content: string): ParsedRing {
  const result: ParsedRing = {
    type: 'ring',
    title: '',
    titleLineNumber: 0,
    layers: [],
    options: {},
    diagnostics: [],
    error: null,
  };

  const lines = content.split('\n');
  let headerParsed = false;
  let currentLayer: RingLayer | null = null;

  const fail = (line: number, message: string): ParsedRing => {
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
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed || trimmed.startsWith('//')) continue;

    const indent = measureIndent(raw);

    // ── First line: chart type declaration ──
    if (!headerParsed) {
      const firstLineResult = parseFirstLine(trimmed);
      if (firstLineResult && firstLineResult.chartType === 'ring') {
        result.title = firstLineResult.title ?? '';
        result.titleLineNumber = lineNum;
        headerParsed = true;
        continue;
      }
      return fail(lineNum, 'Expected "ring [Title]" as the first line.');
    }

    // ── Stray pyramid directive: explicitly diagnose and discard so users
    //    don't end up with a literal layer named "inverted".
    if (indent === 0 && trimmed.toLowerCase() === 'inverted') {
      warn(
        lineNum,
        '"inverted" is not supported on ring diagrams; this directive is from pyramid syntax',
        'error'
      );
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
        } else if (PIPE_KEY_VALUE_PREFIX_RE.test(after)) {
          // Structured metadata: color: foo, other: bar
          const metadata = parsePipeMetadata([label, after]);
          const rawColor = metadata['color'];
          if (rawColor !== undefined) {
            // Stricter than pyramid: invalid color is an error-severity
            // diagnostic with a suggestion. Renderer falls back to the
            // series color so the chart still renders.
            const resolved = resolveColor(rawColor);
            if (resolved === null) {
              const hint = suggest(
                rawColor,
                RECOGNIZED_COLOR_NAMES as readonly string[]
              );
              const suggestion = hint ? ` ${hint}` : '';
              warn(
                lineNum,
                `Unknown color "${rawColor}". Allowed: ${RECOGNIZED_COLOR_NAMES.join(', ')}.${suggestion}`,
                'error'
              );
              color = undefined;
            } else {
              color = rawColor.toLowerCase();
            }
          }
          const descFromPipe = metadata['description'];
          if (descFromPipe) description.push(descFromPipe);
          restMeta = { ...metadata };
          delete restMeta['color'];
          delete restMeta['description'];
          // Anything left over is an unknown key — surface it so users know
          // the value was silently discarded.
          for (const key of Object.keys(restMeta)) {
            if (!KNOWN_PIPE_KEYS.has(key)) {
              warn(
                lineNum,
                `Unknown pipe key "${key}" on ring layer; allowed keys are: ${[...KNOWN_PIPE_KEYS].join(', ')}.`
              );
            }
          }
        } else {
          // Bare shorthand: pipe content is the description.
          // Catch the common mistake of `Label | bare text, color: blue` —
          // the structured-tail content is silently swallowed otherwise.
          if (PIPE_LIKELY_STRUCTURED_TAIL_RE.test(after)) {
            warn(
              lineNum,
              'Mixed shorthand and structured pipe metadata — wrap the description in `description:` or move it to an indented body line.'
            );
          }
          description.push(after);
        }
      }

      if (!label) {
        warn(lineNum, 'Empty layer label.');
        continue;
      }

      currentLayer = {
        label,
        lineNumber: lineNum,
        color,
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

  // Empty / comment-only / missing-header documents fall through the loop
  // without `headerParsed = true`. Surface the missing-header error before
  // the layer-count guards so the user sees the right diagnostic.
  if (!headerParsed) {
    return fail(1, 'Expected "ring [Title]" as the first line.');
  }

  if (result.layers.length < 2) {
    return fail(
      result.titleLineNumber || 1,
      'ring requires at least 2 layers.'
    );
  }

  if (result.layers.length > MAX_LAYERS) {
    return fail(
      result.titleLineNumber || 1,
      `ring supports at most ${MAX_LAYERS} layers; got ${result.layers.length}.`
    );
  }

  return result;
}

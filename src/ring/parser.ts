// ============================================================
// Ring Diagram — Parser
// ============================================================

import {
  bareDescriptionRemovedMessage,
  makeDgmoError,
  makeFail,
  METADATA_DIAGNOSTIC_CODES,
  pipeOperatorRemovedMessage,
  suggest,
} from '../diagnostics';
import { resolveColor, RECOGNIZED_COLOR_NAMES } from '../colors';
import {
  measureIndent,
  parseFirstLine,
  splitNameAndMeta,
  tryParseSharedOption,
  warnUnknownMetaKeys,
} from '../utils/parsing';
import { RING_REGISTRY } from '../utils/reserved-key-registry';
import type { Writable } from '../utils/brand';
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
  const options: Record<string, string> = {};
  const result: Writable<ParsedRing> = {
    type: 'ring',
    title: '',
    titleLineNumber: 0,
    layers: [],
    options,
    diagnostics: [],
    error: null,
  };

  const lines = content.split('\n');
  let headerParsed = false;
  let currentLayer: Writable<RingLayer> | null = null;

  const fail = makeFail(result);

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
      if (firstLineResult?.chartType === 'ring') {
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
    if (indent === 0 && tryParseSharedOption(trimmed, options)) {
      continue;
    }

    // ── Top-level: layer declaration ──
    if (indent === 0) {
      flushLayer();

      // Legacy `|` detection — same shape as pyramid (bare-description
      // shorthand OR structured pipe metadata).
      const pipeIdx = trimmed.indexOf('|');
      if (pipeIdx >= 0) {
        result.diagnostics.push(
          makeDgmoError(
            lineNum,
            pipeOperatorRemovedMessage(),
            'error',
            METADATA_DIAGNOSTIC_CODES.PIPE_OPERATOR_REMOVED
          )
        );
        const after = trimmed.substring(pipeIdx + 1).trim();
        if (after && !/^[A-Za-z][A-Za-z0-9_-]*\s*:/.test(after)) {
          result.diagnostics.push(
            makeDgmoError(
              lineNum,
              bareDescriptionRemovedMessage({ chartType: 'ring', text: after }),
              'error',
              METADATA_DIAGNOSTIC_CODES.RING_BARE_DESCRIPTION_REMOVED
            )
          );
        }
      }

      // §1.4 unified metadata grammar — same-line cut.
      const split = splitNameAndMeta(
        trimmed,
        RING_REGISTRY,
        new Map(),
        undefined,
        result.diagnostics,
        lineNum
      );
      warnUnknownMetaKeys(
        split.meta,
        RING_REGISTRY,
        (msg) => warn(lineNum, msg),
        split.name
      );
      const label = split.name;
      const restMeta: Record<string, string> = { ...split.meta };
      const description: string[] = [];

      // Color may arrive via §1.5 trailing-token or via the `color:` key.
      let color: string | undefined = split.color ?? restMeta['color'];
      delete restMeta['color'];
      if (color !== undefined) {
        // Validate color name (ring is stricter — unknown color is an
        // error-severity diagnostic with a "Did you mean...?" hint).
        const resolved = resolveColor(color);
        if (resolved === null) {
          const hint = suggest(
            color,
            RECOGNIZED_COLOR_NAMES as readonly string[]
          );
          const suggestion = hint ? ` ${hint}` : '';
          warn(
            lineNum,
            `Unknown color "${color}". Allowed: ${RECOGNIZED_COLOR_NAMES.join(', ')}.${suggestion}`,
            'error'
          );
          color = undefined;
        } else {
          color = color.toLowerCase();
        }
      }

      const descFromMeta = restMeta['description'];
      if (descFromMeta) description.push(descFromMeta);
      delete restMeta['description'];

      for (const key of Object.keys(restMeta)) {
        if (!KNOWN_PIPE_KEYS.has(key)) {
          warn(
            lineNum,
            `Unknown metadata key "${key}" on ring layer; allowed keys are: ${[...KNOWN_PIPE_KEYS].join(', ')}.`
          );
        }
      }

      if (!label) {
        warn(lineNum, 'Empty layer label.');
        continue;
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

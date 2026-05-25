// ============================================================
// Pyramid Diagram — Parser
// ============================================================

import {
  bareDescriptionRemovedMessage,
  formatDgmoError,
  makeDgmoError,
  METADATA_DIAGNOSTIC_CODES,
  pipeOperatorRemovedMessage,
} from '../diagnostics';
import type { Writable } from '../utils/brand';
import {
  measureIndent,
  parseFirstLine,
  splitNameAndMeta,
  tryParseSharedOption,
  warnUnknownMetaKeys,
} from '../utils/parsing';
import { PYRAMID_REGISTRY } from '../utils/reserved-key-registry';
import type { ParsedPyramid, PyramidLayer } from './types';

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
  const options: Record<string, string> = {};
  const result: Writable<ParsedPyramid> = {
    type: 'pyramid',
    title: '',
    titleLineNumber: 0,
    layers: [],
    inverted: false,
    options,
    diagnostics: [],
    error: null,
  };

  const lines = content.split('\n');
  let headerParsed = false;
  let currentLayer: Writable<PyramidLayer> | null = null;

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
    if (indent === 0 && tryParseSharedOption(trimmed, options)) {
      continue;
    }

    // ── Top-level: layer declaration ──
    if (indent === 0) {
      flushLayer();

      // Legacy `|` pipe-metadata detection (§1.4 unified grammar).
      // Pyramid had two legacy shapes after `|`:
      //   (a) `Layer | color: blue` — structured metadata
      //   (b) `Layer | Some text` — bare-description shorthand
      // Both emit pipe-removed; (b) additionally emits the
      // bare-description-removed diagnostic with the conversion hint.
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
        // Bare-description shape: no `<key>:` prefix. Emit the
        // pyramid-specific hint pointing at `description: <text>`.
        if (after && !/^[A-Za-z][A-Za-z0-9_-]*\s*:/.test(after)) {
          result.diagnostics.push(
            makeDgmoError(
              lineNum,
              bareDescriptionRemovedMessage({
                chartType: 'pyramid',
                text: after,
              }),
              'error',
              METADATA_DIAGNOSTIC_CODES.PYRAMID_BARE_DESCRIPTION_REMOVED
            )
          );
        }
      }

      // §1.4 unified metadata grammar — same-line cut.
      const split = splitNameAndMeta(
        trimmed,
        PYRAMID_REGISTRY,
        new Map(),
        undefined,
        result.diagnostics,
        lineNum
      );
      warnUnknownMetaKeys(
        split.meta,
        PYRAMID_REGISTRY,
        (msg) => warn(lineNum, msg),
        split.name
      );
      const label = split.name;
      const restMeta: Record<string, string> = { ...split.meta };
      // Color may arrive via the §1.5 trailing-token slot (`Top blue`)
      // or via the explicit `color: <name>` metadata key. Either feeds
      // the typed color slot; the metadata copy is dropped.
      const color = split.color ?? restMeta['color'];
      delete restMeta['color'];
      const description: string[] = [];
      const descFromMeta = restMeta['description'];
      if (descFromMeta) description.push(descFromMeta);
      delete restMeta['description'];

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

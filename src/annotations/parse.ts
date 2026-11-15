// ============================================================
// Chart annotations — parsing (#1832)
// ============================================================
//
//   ref-line 50
//   ref-line 50 Target
//   ref-line 50 "Target" red
//   band 40..60 Normal range
//   band 40..60 "Normal range" green
//
// The label is everything after the value. A trailing color word colors the
// mark, as on `era`; quote the label to keep a final color word as text.

import { resolveColorWithDiagnostic, RECOGNIZED_COLOR_NAMES } from '../colors';
import type { DgmoError } from '../diagnostics';
import type { ChartAnnotation } from './types';

const NUM = '-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
const REF_LINE_RE = new RegExp(`^ref-line\\s+(${NUM})(?:\\s+(.*))?$`);
const BAND_RE = new RegExp(
  `^band\\s+(${NUM})\\s*\\.\\.\\s*(${NUM})(?:\\s+(.*))?$`
);

/** Splits `rest` into a label and an optional trailing color word. */
function splitLabel(
  rest: string | undefined,
  lineNumber: number,
  diagnostics: DgmoError[],
  palette?: { colors: Record<string, string> }
): { label: string; color: string | null } {
  const text = (rest ?? '').trim();
  if (!text) return { label: '', color: null };
  const quoted = text.match(/^"([^"]*)"(?:\s+(\S+))?$/);
  let label = text;
  let colorWord: string | undefined;
  if (quoted) {
    label = quoted[1]!;
    colorWord = quoted[2];
  } else {
    const lastSpace = text.lastIndexOf(' ');
    const last = lastSpace < 0 ? text : text.substring(lastSpace + 1);
    if (
      RECOGNIZED_COLOR_NAMES.includes(
        last as (typeof RECOGNIZED_COLOR_NAMES)[number]
      )
    ) {
      colorWord = last;
      label = lastSpace < 0 ? '' : text.substring(0, lastSpace).trimEnd();
    }
  }
  const color = colorWord
    ? (resolveColorWithDiagnostic(
        colorWord,
        lineNumber,
        diagnostics,
        palette
      ) ?? null)
    : null;
  return { label, color };
}

/**
 * Parses one trimmed line as a `ref-line` or `band` directive. Returns null
 * when the line is neither, so the caller's other matchers run.
 */
export function parseAnnotationLine(
  trimmed: string,
  lineNumber: number,
  diagnostics: DgmoError[],
  palette?: { colors: Record<string, string> }
): ChartAnnotation | null {
  const ref = trimmed.match(REF_LINE_RE);
  if (ref) {
    const { label, color } = splitLabel(
      ref[2],
      lineNumber,
      diagnostics,
      palette
    );
    return {
      kind: 'ref-line',
      value: Number(ref[1]),
      label,
      color,
      lineNumber,
    };
  }
  const band = trimmed.match(BAND_RE);
  if (band) {
    const a = Number(band[1]);
    const b = Number(band[2]);
    const { label, color } = splitLabel(
      band[3],
      lineNumber,
      diagnostics,
      palette
    );
    return {
      kind: 'band',
      from: Math.min(a, b),
      to: Math.max(a, b),
      label,
      color,
      lineNumber,
    };
  }
  return null;
}

/** Every value an annotation marks — what a value axis must reach. */
export function annotationValues(
  annotations: readonly ChartAnnotation[] | undefined
): number[] {
  const out: number[] = [];
  for (const a of annotations ?? []) {
    if (a.kind === 'ref-line') out.push(a.value);
    else out.push(a.from, a.to);
  }
  return out;
}

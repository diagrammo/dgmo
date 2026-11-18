// ============================================================
// Chart annotations — parsing (#1832, #2039)
// ============================================================
//
//   marker 50 Target              a value-axis line
//   marker 2022 Launch            a period line (slope; periods share a line)
//   band 40..60 Normal range      a value range
//
// A `note`, a `highlight` and a category `marker` sit indented under the row
// they belong to (anchored.ts, #2078). `parseChartNoteLine` remains only to
// recognize the old top-level `note <datum>` form and say where it went.
//
// A label is everything after the position. A trailing color word colors the
// mark; quote the label to keep a final color word as text. The parser reads
// the line; each chart resolves positions and targets against its own data.

import { resolveColorWithDiagnostic, RECOGNIZED_COLOR_NAMES } from '../colors';
import { makeDgmoError, type DgmoError } from '../diagnostics';
import type { PaletteColors } from '../palettes';
import { extractColor } from '../utils/parsing';
import { collectNoteBody, parseNoteHeader } from '../utils/notes/parse';
import { topLevelMoved } from './anchored';
import type {
  ChartAnnotation,
  ChartMarker,
  RawAnnotation,
  RawChartNote,
} from './types';

const NUM = '-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
const NUM_RE = new RegExp(`^${NUM}$`);
const MARKER_RE = /^marker(?:\s+(x|y))?\s+(.+)$/;
const BAND_RE = new RegExp(
  `^band(?:\\s+(x|y))?\\s+(${NUM})\\s*\\.\\.\\s*(${NUM})(?:\\s+(.*))?$`
);

type Palette = { colors: Record<string, string> };

/** Peels a trailing color word off `text`, unless it closes a quoted label. */
function peelColor(
  text: string,
  lineNumber: number,
  diagnostics: DgmoError[],
  palette?: Palette
): { text: string; color: string | null } {
  const t = text.trim();
  const lastSpace = t.lastIndexOf(' ');
  if (lastSpace < 0) return { text: t, color: null };
  const last = t.substring(lastSpace + 1);
  if (
    !RECOGNIZED_COLOR_NAMES.includes(
      last as (typeof RECOGNIZED_COLOR_NAMES)[number]
    )
  )
    return { text: t, color: null };
  const color =
    resolveColorWithDiagnostic(last, lineNumber, diagnostics, palette) ?? null;
  return { text: t.substring(0, lastSpace).trimEnd(), color };
}

/** `"Code red"` → `Code red`; anything else unchanged. */
function unquote(s: string): string {
  const t = s.trim();
  const m = t.match(/^"([^"]*)"$/);
  return m ? m[1]! : t;
}

/**
 * Parses one trimmed line as a `marker` or `band` directive. Returns null
 * when the line is neither, so the caller's other matchers run.
 */
export function parseAnnotationLine(
  trimmed: string,
  lineNumber: number,
  diagnostics: DgmoError[],
  palette?: Palette
): RawAnnotation | null {
  const mk = trimmed.match(MARKER_RE);
  if (mk) {
    const { text, color } = peelColor(mk[2]!, lineNumber, diagnostics, palette);
    return {
      kind: 'marker',
      axisHint: (mk[1] as 'x' | 'y' | undefined) ?? null,
      text,
      color,
      lineNumber,
    };
  }
  const band = trimmed.match(BAND_RE);
  if (band) {
    const a = Number(band[2]);
    const b = Number(band[3]);
    const { text, color } = band[4]
      ? peelColor(band[4], lineNumber, diagnostics, palette)
      : { text: '', color: null };
    return {
      kind: 'band',
      axisHint: (band[1] as 'x' | 'y' | undefined) ?? null,
      from: Math.min(a, b),
      to: Math.max(a, b),
      label: unquote(text),
      color,
      lineNumber,
    };
  }
  return null;
}

/** True for a line that starts like an annotation but did not parse. */
export function malformedAnnotation(trimmed: string): string | null {
  if (/^marker\s*(?:x|y)?\s*$/.test(trimmed))
    return `'${trimmed}': marker needs a position — marker 50 Target, or marker Q3 Launch.`;
  if (/^band(?:\s+(?:x|y))?\s+\S*\.\./.test(trimmed))
    return `'${trimmed}': band needs two numbers — band 40..60 Normal range.`;
  return null;
}

/** What a chart's axes are, for resolving marker positions. */
export interface MarkerAxes {
  /** The category names on the cross axis; null when it is numeric. */
  readonly categories: readonly string[] | null;
  /** True when each category is a row of its own, so a category `marker`
   *  sits indented under that row (#2078) and a top-level one is the old
   *  form. Slope's periods share one line, so they keep the named form. */
  readonly categoryRows?: boolean;
}

/**
 * A `marker [label] [color]` line indented under a category row (#2078):
 * a cross-axis line at that row's category.
 */
export function anchoredMarker(
  text: string,
  category: string,
  lineNumber: number,
  diagnostics: DgmoError[],
  palette?: Palette
): ChartMarker {
  const lone = RECOGNIZED_COLOR_NAMES.includes(
    text as (typeof RECOGNIZED_COLOR_NAMES)[number]
  );
  const { text: label, color } = lone
    ? {
        text: '',
        color:
          resolveColorWithDiagnostic(text, lineNumber, diagnostics, palette) ??
          null,
      }
    : peelColor(text, lineNumber, diagnostics, palette);
  return {
    kind: 'marker',
    axis: 'cross',
    at: category,
    label: unquote(label),
    color,
    lineNumber,
  };
}

/** The longest run of leading words of `text` that names a category. */
function matchCategory(
  text: string,
  categories: readonly string[]
): { category: string; rest: string } | null {
  const quoted = text.match(/^"([^"]+)"\s*(.*)$/);
  if (quoted) {
    return categories.includes(quoted[1]!)
      ? { category: quoted[1]!, rest: quoted[2]! }
      : null;
  }
  const words = text.split(/\s+/);
  for (let w = words.length; w >= 1; w--) {
    const cand = words.slice(0, w).join(' ');
    if (categories.includes(cand))
      return { category: cand, rest: words.slice(w).join(' ') };
  }
  return null;
}

function splitNumber(text: string): { value: number; rest: string } | null {
  const sp = text.indexOf(' ');
  const head = sp < 0 ? text : text.substring(0, sp);
  if (!NUM_RE.test(head)) return null;
  return { value: Number(head), rest: sp < 0 ? '' : text.substring(sp + 1) };
}

/**
 * Resolves the raw annotations against a chart's axes. A marker that names
 * nothing on the chart warns on its line and is dropped.
 */
export function resolveAnnotations(
  raws: readonly RawAnnotation[],
  axes: MarkerAxes,
  diagnostics: DgmoError[]
): ChartAnnotation[] {
  const out: ChartAnnotation[] = [];
  const warn = (line: number, msg: string) =>
    diagnostics.push(makeDgmoError(line, msg, 'warning'));
  const cats = axes.categories;
  const numericCats =
    cats !== null && cats.length > 0 && cats.every((c) => NUM_RE.test(c));
  for (const raw of raws) {
    if (raw.kind === 'band') {
      if (raw.axisHint === 'x' && cats !== null) {
        warn(
          raw.lineNumber,
          'band x needs a numeric x axis (scatter); band marks the value axis here — band 40..60 Normal range.'
        );
        continue;
      }
      const { axisHint, ...rest } = raw;
      out.push({ ...rest, axis: axisHint === 'x' ? 'cross' : 'value' });
      continue;
    }
    const num = splitNumber(raw.text);
    const value = (v: { value: number; rest: string }): ChartMarker => ({
      kind: 'marker',
      axis: 'value',
      at: v.value,
      label: unquote(v.rest),
      color: raw.color,
      lineNumber: raw.lineNumber,
    });
    if (raw.axisHint === 'y') {
      if (num) out.push(value(num));
      else
        warn(
          raw.lineNumber,
          `'marker y ${raw.text}': marker y needs a number — marker y 50 Target.`
        );
      continue;
    }
    if (cats === null) {
      // Scatter: both axes are numeric; a bare number is the y axis.
      if (!num) {
        warn(
          raw.lineNumber,
          `'marker ${raw.text}': marker needs a number on this chart — marker 50 Target, or marker x 5 Launch.`
        );
        continue;
      }
      out.push(
        raw.axisHint === 'x' ? { ...value(num), axis: 'cross' } : value(num)
      );
      continue;
    }
    if (axes.categoryRows) {
      // Categories are rows: a top-level marker is a value-axis line.
      if (num && raw.axisHint !== 'x') {
        out.push(value(num));
        continue;
      }
      const hit = matchCategory(raw.text, cats);
      diagnostics.push(
        topLevelMoved(
          'marker',
          hit ? hit.rest : '',
          raw.lineNumber,
          hit ? hit.category : '<row>'
        )
      );
      continue;
    }
    if (raw.axisHint === null && num && numericCats) {
      warn(
        raw.lineNumber,
        `'marker ${raw.text}': the categories are numbers, so say which axis — marker x ${num.value} … for the category, marker y ${num.value} … for the value.`
      );
      continue;
    }
    if (raw.axisHint === null && num) {
      out.push(value(num));
      continue;
    }
    const hit = matchCategory(raw.text, cats);
    if (!hit) {
      warn(
        raw.lineNumber,
        `'marker ${raw.text}': no category by that name — nothing is drawn.`
      );
      continue;
    }
    out.push({
      kind: 'marker',
      axis: 'cross',
      at: hit.category,
      label: unquote(hit.rest),
      color: raw.color,
      lineNumber: raw.lineNumber,
    });
  }
  return out;
}

/** Every value-axis value an annotation marks — what the axis must reach. */
export function annotationValues(
  annotations: readonly ChartAnnotation[] | undefined,
  axis: 'value' | 'cross' = 'value'
): number[] {
  const out: number[] = [];
  for (const a of annotations ?? []) {
    if (a.axis !== axis) continue;
    if (a.kind === 'marker') {
      if (typeof a.at === 'number') out.push(a.at);
    } else out.push(a.from, a.to);
  }
  return out;
}

// ── note ────────────────────────────────────────────────────

/**
 * Parses a `note` line at `lines[index]` with its indented body. Returns null
 * when the line is not a note. Lowercase only, so a data row "Note 5" stays
 * data.
 */
export function parseChartNoteLine(
  lines: readonly string[],
  index: number,
  indent: number,
  diagnostics: DgmoError[],
  palette?: PaletteColors
): { note: RawChartNote; lastIndex: number } | null {
  const trimmed = lines[index]!.trim();
  const m = trimmed.match(/^note(?:\s+(.*))?$/);
  if (!m) return null;
  const lineNumber = index + 1;
  const { label: header, color } = extractColor(
    (m[1] ?? '').trim(),
    palette,
    diagnostics,
    lineNumber
  );
  let series: string | null = null;
  let rest = header;
  const at = header.match(/^(?:("[^"]+"|[^\s@]+)\s+)?@\s+(.*)$/);
  if (at) {
    series = at[1] ? unquote(at[1]) : null;
    rest = at[2]!;
  }
  const { ref, inlineBody } = rest
    ? parseNoteHeader(rest)
    : { ref: '', inlineBody: '' };
  const body = collectNoteBody(lines, index, indent, inlineBody);
  return {
    note: {
      series,
      target: ref,
      text: body.body,
      color: color ?? null,
      lineNumber,
    },
    lastIndex: body.lastIndex,
  };
}

/** Warns once per annotation on a chart type that does not take them. */
export function warnUnsupported(
  kinds: readonly { kind: string; lineNumber: number }[],
  where: string,
  diagnostics: DgmoError[]
): void {
  for (const a of kinds)
    diagnostics.push(
      makeDgmoError(
        a.lineNumber,
        `"${a.kind}" is only supported on ${where}; ignoring it.`,
        'warning'
      )
    );
}

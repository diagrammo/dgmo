// ============================================================
// Chart annotations — indented under the row they belong to (#2078, #2080)
// ============================================================
//
// A per-datum annotation is written on the line under its datum, indented:
//
//   Nassau  1100
//     note Record haul after the Spanish fleet ran aground
//       **Hurricane season** wrecked the *Plate Fleet*
//   Tortuga  620
//     highlight
//   1718  46 24 31
//     marker Blockade
//
// Proximity names the datum, so the annotation never repeats it. The anchor
// is the nearest line above with less indentation: a data row, a series name
// in a `series` / `stack` / `group` block, or a scatter `[Group]` header.
//
// The lines are lifted out of the source before the chart's own parser runs
// (each is blanked, so line numbers never move), then each chart resolves the
// anchor line numbers against its rows.

import { RECOGNIZED_COLOR_NAMES } from '../colors';
import { makeDgmoError, type DgmoError } from '../diagnostics';
import {
  HIGHLIGHT_OVERRIDE_MARK,
  type EmphasisDirective,
} from '../utils/emphasis';
import type { PaletteColors } from '../palettes';
import { extractColor, measureIndent } from '../utils/parsing';

export type AnchoredKeyword = 'note' | 'highlight' | 'marker';

/** One annotation line, lifted from under its anchor. */
export interface AnchoredLine {
  readonly keyword: AnchoredKeyword;
  /** 1-based line number of the anchor row. */
  readonly anchorLine: number;
  /** The anchor row's trimmed text, for messages. */
  readonly anchorText: string;
  /** The words after the keyword on its own line, trimmed. */
  readonly text: string;
  /** A note's continuation lines (indented under it), joined with `\n`. */
  readonly body: string;
  readonly lineNumber: number;
}

export interface LiftedAnchored {
  /** The source with every lifted line blanked. */
  readonly lines: string[];
  readonly anchored: AnchoredLine[];
  /** A per-export `highlight` (#2042), when the source carries one. */
  readonly override: EmphasisDirective | null;
}

const KEYWORD_RE = /^(note|highlight|marker)(?:\s+(.*))?$/;

/**
 * Lifts every indented `note`, `highlight` and `marker` line out of `lines`.
 * Lowercase only, so a series or row named `Note 5` stays data.
 */
export function liftAnchored(lines: readonly string[]): LiftedAnchored {
  const out = [...lines];
  const anchored: AnchoredLine[] = [];
  let override: EmphasisDirective | null = null;
  /** Content lines above, by indent: the anchor candidates. */
  const stack: { indent: number; index: number }[] = [];
  for (let i = 0; i < out.length; i++) {
    const raw = out[i]!;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed === HIGHLIGHT_OVERRIDE_MARK) {
      const next = out[i + 1]?.trim() ?? '';
      const m = next.match(/^highlight\s+(.+)$/);
      out[i] = '';
      if (m) {
        const names = m[1]!
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean);
        override = {
          kind: 'highlight',
          names,
          ambiguous: !m[1]!.includes(','),
          raw: m[1]!.trim(),
          lineNumber: i + 2,
        };
        out[i + 1] = '';
        i++;
      }
      continue;
    }
    if (trimmed.startsWith('//')) continue;
    const indent = measureIndent(raw);
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
    const m = indent > 0 ? trimmed.match(KEYWORD_RE) : null;
    if (!m) {
      stack.push({ indent, index: i });
      continue;
    }
    const anchor = stack.at(-1);
    const keyword = m[1] as AnchoredKeyword;
    const body: string[] = [];
    let last = i;
    if (keyword === 'note') {
      for (let j = i + 1; j < out.length; j++) {
        const t = out[j]!.trim();
        if (!t || measureIndent(out[j]!) <= indent) break;
        body.push(t);
        last = j;
      }
    }
    for (let j = i; j <= last; j++) out[j] = '';
    anchored.push({
      keyword,
      anchorLine: anchor ? anchor.index + 1 : 0,
      anchorText: anchor ? lines[anchor.index]!.trim() : '',
      text: (m[2] ?? '').trim(),
      body: body.join('\n'),
      lineNumber: i + 1,
    });
    i = last;
  }
  return { lines: out, anchored, override };
}

/** True when the first content line declares one of `types`. */
export function declaresType(
  lines: readonly string[],
  types: ReadonlySet<string>
): boolean {
  for (const l of lines) {
    const t = l.trim();
    if (!t || t.startsWith('//')) continue;
    return types.has(t.split(/\s+/, 1)[0]!.toLowerCase());
  }
  return false;
}

// ── shared resolution helpers ───────────────────────────────

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The longest run of leading words of `text` that names one of `names`
 * (a quoted run matches whole). Case-insensitive.
 */
export function leadingName(
  text: string,
  names: readonly string[]
): { index: number; rest: string } | null {
  const quoted = text.match(/^"([^"]+)"\s*(.*)$/);
  if (quoted) {
    const index = names.findIndex((n) => norm(n) === norm(quoted[1]!));
    return index >= 0 ? { index, rest: quoted[2]!.trim() } : null;
  }
  const words = text.split(/\s+/).filter(Boolean);
  for (let w = words.length; w >= 1; w--) {
    const cand = norm(words.slice(0, w).join(' '));
    const index = names.findIndex((n) => norm(n) === cand);
    if (index >= 0) return { index, rest: words.slice(w).join(' ') };
  }
  return null;
}

/**
 * A `highlight` line's colour word, when it has one. Anything else on the
 * line warns: the row above already names what is lit.
 */
export function highlightColor(
  a: AnchoredLine,
  diagnostics: DgmoError[]
): string | null {
  if (!a.text) return null;
  if (
    RECOGNIZED_COLOR_NAMES.includes(
      a.text as (typeof RECOGNIZED_COLOR_NAMES)[number]
    )
  )
    return a.text;
  diagnostics.push(
    makeDgmoError(
      a.lineNumber,
      `'highlight ${a.text}': the row above names what is lit, so highlight takes only a colour here — highlight, or highlight orange.`,
      'warning'
    )
  );
  return null;
}

/**
 * Builds the chart's emphasis from the names the `highlight` lines sit
 * under. A colour on any of them paints the subject; resolution reads it
 * off the last name, as it does for a written `highlight Nassau orange`.
 */
export function anchoredEmphasis(
  lit: readonly { name: string; color: string | null; lineNumber: number }[]
): EmphasisDirective | null {
  if (!lit.length) return null;
  const names = lit.map((l) => l.name);
  const color = lit.find((l) => l.color)?.color;
  if (color) names[names.length - 1] = `${names[names.length - 1]} ${color}`;
  return {
    kind: 'highlight',
    names,
    ambiguous: false,
    raw: names.join(', '),
    lineNumber: lit[0]!.lineNumber,
  };
}

/** Warns on an annotation whose anchor is not a row it can attach to. */
export function warnNoAnchor(
  a: AnchoredLine,
  what: string,
  diagnostics: DgmoError[]
): void {
  const under = a.anchorText
    ? `it sits under '${a.anchorText}', which is not ${what}`
    : 'nothing is above it';
  diagnostics.push(
    makeDgmoError(
      a.lineNumber,
      `'${a.keyword}' goes indented under ${what} — ${under}. Nothing is drawn.`,
      'warning'
    )
  );
}

/** The old top-level form: say where the line goes now. */
export function topLevelMoved(
  keyword: AnchoredKeyword,
  rest: string,
  lineNumber: number,
  row: string
): DgmoError {
  const example =
    keyword === 'note'
      ? `${row}\n  note ${rest || '…'}`
      : keyword === 'highlight'
        ? `${row}\n  highlight`
        : `${row}\n  marker ${rest || '…'}`;
  return makeDgmoError(
    lineNumber,
    `'${keyword}' no longer names its ${keyword === 'highlight' ? 'element' : 'datum'} — indent it under the row it belongs to, e.g.\n${example}`,
    'warning'
  );
}

/**
 * A `note` line's own words and its indented body. A trailing colour word on
 * the note line colours its ring and leader, as on every note.
 */
export function anchoredNoteText(
  a: AnchoredLine,
  diagnostics: DgmoError[],
  palette?: PaletteColors
): { header: string; body: string; color: string | null } {
  const { label, color } = extractColor(
    a.text,
    palette,
    diagnostics,
    a.lineNumber
  );
  return { header: label.trim(), body: a.body, color: color ?? null };
}

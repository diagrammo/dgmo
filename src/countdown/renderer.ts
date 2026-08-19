// ============================================================
// Countdown chart — D3 SVG Renderer
// ============================================================
//
// Bakes the no-JS floor: a stable `<text data-dgmo-countdown*>` hero holding
// the count computed at render time, plus the in-chart FOOTER resolution line
// (`→ Tue Jul 21 2026 · in 8 days`) and the "as of" freshness stamp. The
// page-level ticker (src/countdown/ticker.ts) overwrites the hero live, rolls
// recurring nodes forward, and ERASES the "as of" stamp on its first tick
// (proof of liveness; images keep it). NEVER emits a `<script>` — every
// sanitizer strips it. All `data-*` attributes survive them.
//
// Time math + formatting is shared with the ticker via ./resolve so the baked
// value and the live value never disagree.

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import {
  contrastText,
  mix,
  getSeriesColors,
  themeBaseBg,
} from '../palettes/color-utils';
import type { FillMode } from '../utils/parsing';
import { resolveColor } from '../colors';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import { wrapDescriptionLines } from '../utils/wrapped-desc';
import {
  renderInlineText,
  stripInlineMarkdown,
} from '../utils/inline-markdown';
import type { ParsedCountdown } from './types';
import {
  DAY_MS,
  dayStart as tzDayStart,
  sameDay,
  formatCompound,
  formatCount,
  formatDateShort,
  formatFooter,
  formatHuman,
  formatWordsDetail,
  ordinalFor,
  applyOrdinalTemplate,
  splitClockSeconds,
} from './resolve';

/** The hero string baked at render time (the no-JS floor). */
function bakedHero(parsed: ParsedCountdown, now: number): string {
  const resolved = parsed.resolvedMs;
  if (resolved === null) return '—';
  const tz = parsed.tz;
  const remaining = resolved - now;
  // One-shot expiry: explicit `expired <text>` wins; otherwise count UP how long
  // ago it was (the ticker keeps this live).
  if (!parsed.rule && remaining <= 0) {
    if (parsed.expired !== null) return parsed.expired;
    const elapsed = -remaining;
    if (elapsed <= 0) return 'Now!';
    if (parsed.units === 'compound' || parsed.units === 'human') {
      // Mirror the forward path: all-day (no-time) targets floor to `tz`
      // midnights so "4 days ago" reads flat instead of "4 days, 22 hours ago".
      const [a, b] = parsed.hasTime
        ? [resolved, now]
        : [tzDayStart(resolved, tz), tzDayStart(now, tz)];
      return `${formatCompound(a, b, 2, tz)} ago`;
    }
    const bu =
      parsed.units === 'full' || parsed.units === 'clock'
        ? 'days'
        : parsed.units;
    return `${formatCount(elapsed, { units: bu, round: parsed.round, fields: parsed.fields })} ago`;
  }
  // Occurrence-day label (recurring): on the day itself, show the on-day text or
  // a plain "Today!" — the all-day rule now resolves to today, not next year.
  if (parsed.rule && sameDay(resolved, now, tz))
    return parsed.onDay ?? 'Today!';
  if (parsed.units === 'human') {
    // All-day (no-time) targets floor to `tz` MIDNIGHTS so the hero reads as a
    // flat whole-day count ("8 days") instead of false hours/minutes precision
    // ("7 days, 14 hours") — it's really counting to midnight. Timed targets keep
    // the full breakdown.
    const [hn, ht] = parsed.hasTime
      ? [now, resolved]
      : [tzDayStart(now, tz), tzDayStart(resolved, tz)];
    return formatHuman(hn, ht, tz).big;
  }
  if (parsed.units === 'compound') return formatCompound(now, resolved, 2, tz);
  // Baked no-JS floor: `full`/`clock` need per-second ticking that only the live
  // ticker provides. Bake the day count as the honest static fallback — the
  // ticker upgrades it to `Nd HH:MM:SS` on live surfaces (spike §"Honest limits").
  const bakeUnits =
    parsed.units === 'full' || parsed.units === 'clock' ? 'days' : parsed.units;
  return formatCount(Math.max(0, remaining), {
    units: bakeUnits,
    round: parsed.round,
    fields: parsed.fields,
  });
}

/** Stamp the structured recurrence attrs so the ticker can roll forward. */
function stampRecur(
  sel: d3Selection.Selection<SVGTextElement, unknown, null, undefined>,
  parsed: ParsedCountdown
): void {
  const r = parsed.rule;
  if (!r) return;
  sel.attr('data-dgmo-recur-kind', r.kind);
  if (r.month !== undefined) sel.attr('data-dgmo-recur-month', r.month);
  if (r.day !== undefined) sel.attr('data-dgmo-recur-day', r.day);
  if (r.nth !== undefined) sel.attr('data-dgmo-recur-nth', r.nth);
  if (r.weekday !== undefined) sel.attr('data-dgmo-recur-weekday', r.weekday);
  sel.attr('data-dgmo-recur-hour', r.hour);
  sel.attr('data-dgmo-recur-minute', r.minute);
  sel.attr('data-dgmo-recur-allday', r.allDay ? '1' : '0');
  if (r.intervalN !== undefined)
    sel.attr('data-dgmo-recur-interval-n', r.intervalN);
  if (r.intervalUnit !== undefined)
    sel.attr('data-dgmo-recur-interval-unit', r.intervalUnit);
  if (r.anchorMs !== undefined) sel.attr('data-dgmo-recur-anchor', r.anchorMs);
  if (r.tz !== undefined) sel.attr('data-dgmo-recur-tz', r.tz);
}

type SvgSel = d3Selection.Selection<SVGSVGElement, unknown, null, undefined>;

const MON_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const WD_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const DAY_START = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
/** Whole-day span between two instants (local-midnight aligned; never an ordinal round-trip). */
const dayDelta = (a: number, b: number): number =>
  Math.round((DAY_START(b) - DAY_START(a)) / DAY_MS);
/** Monotonic yyyymmdd key for same-scale day equality/ordering. */
const keyOf = (ms: number): number => {
  const d = new Date(ms);
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
};

// ── Palette-mapped band colors — two live anchors on a bed of inert gray ──
// Color encodes DISTANCE, not decoration: `now` is a FIXED cold blue
// (you-are-here), `event` is the hot target/accent, and every cell strictly
// between them is a per-cell blend of the two (see gradStyle) — so a cell's color
// reads as how far along the now→event journey it sits. Everything outside the
// span is one inert gray. Collapsed from the old six-token set: remain+eventSoft →
// accentSoft, past+track → inert.
interface BandColors {
  readonly bg: string;
  readonly text: string;
  readonly muted: string;
  readonly faint: string;
  readonly rule: string;
  readonly now: string; // fixed blue anchor (teal if the accent is itself blue)
  readonly event: string; // the target — the accent
  readonly midSoft: string; // a pale wash at the now→event MIDPOINT (cool purple)
  readonly inert: string; // elapsed + empty-future fill (one gray)
  readonly inertBorder: string;
  // ── §1.9 fill family — restyles the live now→event chips only ──
  /** `fill-solid` / `fill-outline`; undefined ⇒ the legacy saturated chips. */
  readonly fillMode: FillMode | undefined;
  readonly baseBg: string; // theme base bg — outline-mode chip fill
  readonly onLight: string; // palette.textOnFillLight (solid-mode chip text)
  readonly onDark: string; // palette.textOnFillDark
}
function bandColors(
  palette: PaletteColors,
  accent: string,
  muted: string,
  faint: string,
  isDark: boolean,
  fillMode: FillMode | undefined
): BandColors {
  // mix(a, b, pct) = pct% of `a` blended over `b`.
  // `now` is a FIXED blue so it always stands apart from the (any-hue) accent; if
  // the accent is itself blue we shift `now` to teal so the two never merge.
  const blue =
    resolveColor('blue', palette) ?? mix(palette.text, palette.bg, 45);
  const collides = accent.toLowerCase() === blue.toLowerCase();
  const now = collides
    ? (resolveColor('teal', palette) ??
      resolveColor('cyan', palette) ??
      mix(palette.text, palette.bg, 55))
    : blue;
  // The soft wash sits at the now→event MIDPOINT (a cool purple when the anchors
  // are blue↔red), not on the warm accent — it belongs to the gradient, not the
  // target.
  const mid = mix(accent, now, 50);
  return {
    bg: palette.bg,
    text: palette.text,
    muted,
    faint,
    rule: mix(palette.text, palette.bg, 14),
    now,
    event: accent,
    midSoft: mix(mid, palette.bg, 24),
    inert: mix(palette.text, palette.bg, 7),
    inertBorder: mix(palette.text, palette.bg, 22),
    fillMode,
    baseBg: themeBaseBg(palette, isDark),
    onLight: palette.textOnFillLight,
    onDark: palette.textOnFillDark,
  };
}

// ── One unified cell convention for EVERY tier ──
// now/event = SOLID anchor chips (white text); elapsed & empty-future = one inert
// gray (told apart by text weight/position, not fill). Cells strictly BETWEEN the
// anchors use gradStyle — a now→event blend where the gradient itself is the edge.
type CellRole = 'past' | 'future' | 'today' | 'event';
interface CellStyle {
  readonly fill: string;
  readonly stroke: string;
  readonly text: string;
}
function roleStyle(C: BandColors, role: CellRole): CellStyle {
  switch (role) {
    case 'past':
      return { fill: C.inert, stroke: C.inertBorder, text: C.faint };
    case 'future':
      return { fill: C.inert, stroke: C.inertBorder, text: C.muted };
    case 'today':
      return chipStyle(C, C.now);
    case 'event':
      return chipStyle(C, C.event);
  }
}
/**
 * A live (now/event/gradient) chip under the §1.9 fill family. Default is the
 * legacy saturated chip with bg-colored text; `fill-solid` keeps the full-sat
 * fill but picks contrast-aware text; `fill-outline` moves the color to the
 * stroke + text over the theme base bg. Inert padding cells never route here —
 * they stay gray in every mode.
 */
function chipStyle(C: BandColors, color: string): CellStyle {
  if (C.fillMode === 'outline')
    return { fill: C.baseBg, stroke: color, text: color };
  if (C.fillMode === 'solid')
    return {
      fill: color,
      stroke: color,
      text: contrastText(color, C.onLight, C.onDark),
    };
  return { fill: color, stroke: color, text: C.bg };
}
/**
 * A cell strictly between the two anchors. `frac` 0 = at now (cold blue), 1 = at
 * the event (hot accent); fill is the now→event blend and the stroke matches it,
 * so the run of continuation cells reads as one gradient rather than bordered
 * chips. White text keeps the (saturated) blend legible.
 */
function gradStyle(C: BandColors, frac: number): CellStyle {
  const t = Math.max(0, Math.min(1, frac));
  const f = mix(C.event, C.now, Math.round(t * 100));
  return chipStyle(C, f);
}

/** The fixed band box each viz fills. */
interface BandBox {
  readonly left: number;
  readonly top: number;
  readonly contentW: number;
  readonly height: number;
}

// ── Tiny d3 append helpers keep the ports readable ──
function aText(
  svg: SvgSel,
  x: number,
  y: number,
  size: number,
  fill: string,
  weight: number,
  anchor: 'start' | 'middle' | 'end',
  txt: string,
  extra?: Record<string, string | number>
): void {
  const t = svg
    .append('text')
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', anchor)
    .attr('font-size', size)
    .attr('font-weight', weight)
    .attr('fill', fill)
    .attr('font-family', FONT_FAMILY)
    .attr('font-variant-numeric', 'tabular-nums')
    .text(txt);
  if (extra) for (const k in extra) t.attr(k, extra[k]!);
}
function aRect(
  svg: SvgSel,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  fill: string,
  stroke?: string,
  sw?: number
): void {
  const r = svg
    .append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', rx)
    .attr('fill', fill);
  if (stroke) r.attr('stroke', stroke).attr('stroke-width', sw ?? 1);
}
function aLine(
  svg: SvgSel,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  sw: number,
  opacity?: number
): void {
  const l = svg
    .append('line')
    .attr('x1', x1)
    .attr('y1', y1)
    .attr('x2', x2)
    .attr('y2', y2)
    .attr('stroke', stroke)
    .attr('stroke-width', sw);
  if (opacity != null) l.attr('opacity', opacity);
}

/**
 * A small "recurring" glyph — two opposing circular arrows — that marks a chart
 * as a repeating event (drawn beside the resolution footer).
 */
// Lucide `repeat` (MIT) — the recurring-event glyph, matching the icon set the
// app (lucide-react) and Obsidian (setIcon) already use. Inlined as its raw
// 24×24 path so dgmo core stays dependency-free; scaled/centered on (cx,cy).
// Lucide ships `repeat` as FOUR separate <path>s; flattening them into one
// string turns the bottom-arrow's leading `m7 22` into a RELATIVE move off the
// top bar's end point (≈21,6) → the arrow lands offscreen and the glyph reads
// as a squiggle. Force it absolute (`M7 22`) so each subpath starts where
// Lucide intends.
const REPEAT_ICON_PATH =
  'm17 2 4 4-4 4 M3 11v-1a4 4 0 0 1 4-4h14 M7 22l-4-4 4-4 M21 13v1a4 4 0 0 1-4 4H3';
function recurGlyph(
  svg: SvgSel,
  cx: number,
  cy: number,
  r: number,
  color: string
): void {
  const side = r * 2.4; // visual box side ≈ footer cap height
  const scale = side / 24;
  const swPx = Math.max(1.5, r * 0.34);
  svg
    .append('path')
    .attr('d', REPEAT_ICON_PATH)
    .attr(
      'transform',
      `translate(${cx - side / 2} ${cy - side / 2}) scale(${scale})`
    )
    // Local 0–24 coords under a transform — hide from the embed bbox parser
    // (it ignores transforms; raw coords would corrupt the tight viewBox).
    .attr('data-embed-ignore-bbox', '')
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', swPx / scale)
    .attr('stroke-linecap', 'round')
    .attr('stroke-linejoin', 'round');
}

/**
 * A bright outer ring around the event chip, split from it by a background gap,
 * so the target reads as THE destination even when the ramp's approach runs warm
 * and a neighbor cell is nearly as red. Draw right after the event cell's fill.
 */
function haloRect(
  svg: SvgSel,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  C: BandColors
): void {
  // bg gap hugging the chip (0–2px out), then the bright event ring (2–4px out).
  aRect(svg, x - 1, y - 1, w + 2, h + 2, rx + 1, 'none', C.bg, 2);
  // Bright event ring — carries the subtle flash so the target pops out of a
  // warm ramp on live surfaces. Class targets the baked `<style>` keyframes;
  // resvg (PNG) ignores the animation and bakes the opacity-1 first frame.
  svg
    .append('rect')
    .attr('class', 'dgmo-countdown-target-ring')
    .attr('x', x - 3)
    .attr('y', y - 3)
    .attr('width', w + 6)
    .attr('height', h + 6)
    .attr('rx', rx + 3)
    .attr('fill', 'none')
    .attr('stroke', C.event)
    .attr('stroke-width', 2);
}

/** Which tier fills the band, chosen from the whole-day span to the target. */
type BandKind =
  | 'years'
  | 'year'
  | 'months'
  | 'monthgrid'
  | 'weekstrip'
  | 'today'
  | 'clock';

function pickBand(
  nowMs: number,
  resolvedMs: number,
  hasTime: boolean
): BandKind {
  const days = dayDelta(nowMs, resolvedMs);
  // Timed pivot: on the final day (or past) the band becomes the H·M·S rings.
  if (hasTime && days <= 0) return 'clock';
  if (days === 0) return 'today';
  // The ramp is symmetric: a PASSED target renders the same tier as one the same
  // distance ahead, just mirrored (event anchor on the earlier side, today on the
  // later, the gradient running the opposite way). Tier is chosen from the
  // MAGNITUDE of the span; each viz lays out over the ordered [earlier..later]
  // range and colours by identity + now→event fraction.
  const mag = Math.abs(days);
  // >3yr: the per-year month tier would stack one 12-month row per year (a 70yr
  // target = 71 rows of nothing). The years-strip collapses to decade-aligned
  // rows, one cell per year, and shrinks its cells for absurd spans instead.
  if (mag > 3 * 365) return 'years';
  if (mag > 365) return 'year'; // 1–3yr → the detailed per-year month rows
  if (mag > 92) return 'months'; // 3–12mo → abstract month rectangles
  if (mag > 7) return 'monthgrid'; // 8d–3mo → real day calendars
  return 'weekstrip'; // ≤ 7d → one stretchy linear day-strip (a single week)
}

/** Inclusive count of calendar months between now's month and the target's (either order). */
function monthSpan(nowMs: number, resolvedMs: number): number {
  const n = new Date(nowMs);
  const t = new Date(resolvedMs);
  return (
    Math.abs(
      (t.getFullYear() - n.getFullYear()) * 12 + (t.getMonth() - n.getMonth())
    ) + 1
  );
}

/**
 * Layout for the day-calendar tier. Cropping the rows made stubby, wide months
 * that don't read as a calendar; instead we keep every month FULL-height and pad
 * the sides with quiet CONTEXT months so each column lands at a natural width
 * (~200px). `dim[i]` marks a context month (before now's month or after the
 * event's) — rendered dimmed, so the eye still lands on the real span.
 */
const MONTH_TARGET_PX = 200;
function monthGridLayout(
  nowMs: number,
  resolvedMs: number,
  contentW: number
): { months: Date[]; dim: boolean[] } {
  const now = new Date(nowMs);
  const ev = new Date(resolvedMs);
  const realSpan = monthSpan(nowMs, resolvedMs);
  const shown = Math.max(realSpan, Math.round(contentW / MONTH_TARGET_PX));
  const padBefore = Math.floor((shown - realSpan) / 2);
  const nowMk = now.getFullYear() * 12 + now.getMonth();
  const evMk = ev.getFullYear() * 12 + ev.getMonth();
  // Window covers the ordered [earlier..later] range so it renders identically
  // whether the target is ahead of or behind today.
  const loMk = Math.min(nowMk, evMk);
  const hiMk = Math.max(nowMk, evMk);
  const startMk = loMk - padBefore;
  const months: Date[] = [];
  const dim: boolean[] = [];
  for (let i = 0; i < shown; i++) {
    const d = new Date(Math.floor(startMk / 12), (startMk % 12) + i, 1);
    const mk = d.getFullYear() * 12 + d.getMonth();
    months.push(d);
    dim.push(mk < loMk || mk > hiMk);
  }
  return { months, dim };
}

/**
 * The years-strip span: decade-aligned rows from now's decade through the target's
 * decade (inclusive), one cell per year. `d0`/`d1` are the first years of those
 * bounding decades; `rows` is the decade count. Years before now or after the
 * target still appear (dimmed) so every row is a full, gridded decade.
 */
function yearsLayout(
  nowMs: number,
  resolvedMs: number
): { d0: number; d1: number; rows: number } {
  const y0 = new Date(nowMs).getFullYear();
  const y1 = new Date(resolvedMs).getFullYear();
  // Decade rows span the ordered range, so a past target mirrors a future one.
  const d0 = Math.floor(Math.min(y0, y1) / 10) * 10;
  const d1 = Math.floor(Math.max(y0, y1) / 10) * 10;
  return { d0, d1, rows: (d1 - d0) / 10 + 1 };
}

/**
 * The band's height is CONTENT-driven and compact — deliberately NOT tied to the
 * header height, so a tall wrapped title/note in a narrow panel never elongates
 * the calendar. Each tier returns a bounded height (its cells keep a sane aspect
 * whatever the panel width); the viz then fills that box.
 */
function bandHeightFor(
  kind: BandKind,
  nowMs: number,
  resolvedMs: number,
  contentW: number
): number {
  const clamp = (v: number, lo: number, hi: number): number =>
    Math.max(lo, Math.min(hi, v));
  switch (kind) {
    case 'years': {
      const { rows } = yearsLayout(nowMs, resolvedMs);
      const rowGap = 11;
      const labW = 54;
      const gap = 7;
      const cellW = (contentW - labW - 10 * gap) / 10;
      let cellH = clamp(cellW * 0.5, 26, 40);
      // Absurd spans (centuries) would still tower; cap the whole band and let the
      // cells shrink to fit rather than opening a fresh wall of rows.
      const MAX = 380;
      let total = rows * cellH + (rows - 1) * rowGap;
      if (total > MAX) {
        cellH = Math.max(9, (MAX - (rows - 1) * rowGap) / rows);
        total = rows * cellH + (rows - 1) * rowGap;
      }
      return total;
    }
    case 'year': {
      const R =
        Math.abs(
          new Date(resolvedMs).getFullYear() - new Date(nowMs).getFullYear()
        ) + 1;
      const yearW = 66; // left gutter for the big (right-aligned) year number
      const gap = 8; // enough that the event halo never touches a neighbor
      const cellW = (contentW - yearW - 11 * gap) / 12;
      const cellH = clamp(cellW * 0.6, 28, 44);
      const rowGap = 12;
      return R * cellH + (R - 1) * rowGap;
    }
    case 'months': {
      // Minimum 6 months, 6 per row, padded with context months (see vizMonths).
      const realSpan = monthSpan(nowMs, resolvedMs);
      const perRow = 6;
      const shown = Math.max(perRow, Math.ceil(realSpan / perRow) * perRow);
      const rows = shown / perRow;
      const cellW = (contentW - 16 * (perRow - 1)) / perRow;
      // Flat, landscape month cells — short as they can be while fitting the
      // bigger label + date.
      const cellH = clamp(cellW * 0.5, 58, 84);
      return rows * cellH + (rows - 1) * 16;
    }
    case 'monthgrid': {
      const { months } = monthGridLayout(nowMs, resolvedMs, contentW);
      const nM = months.length;
      const mw = (contentW - 20 * (nM - 1)) / nM;
      const cellW = (mw - 20) / 7;
      // Full 6-row months (padded to a natural width), so proportions read right.
      const cellH = clamp(cellW * 0.8, 15, 22);
      return 26 + 6 * cellH + 8;
    }
    case 'weekstrip': {
      // Stretchy day-strip: a cell per day earlier→later, padded to a minimum of 7.
      const n = Math.max(7, Math.abs(dayDelta(nowMs, resolvedMs)) + 1);
      const cw = (contentW - 10 * (n - 1)) / n;
      return clamp(cw * 1.5, 116, 170);
    }
    case 'clock':
      return clamp(contentW * 0.26, 150, 205);
    case 'today':
      return clamp(contentW * 0.22, 125, 170);
  }
}

// ================= FAR TIERS (box-filling) =================

/**
 * > 3yr — decade-aligned rows, ONE cell per year. Same now→event idiom as every
 * other tier: `now` is the fixed-blue anchor, the target the accent chip (haloed),
 * cells between them a per-year now→event blend, everything outside the span one
 * inert gray. Scales from a handful of years to centuries — for very long spans
 * the band height is capped upstream and the cells shrink (labels drop) rather
 * than stacking a fresh wall of rows.
 */
function vizYears(
  svg: SvgSel,
  g: BandBox,
  nowMs: number,
  resolvedMs: number,
  C: BandColors
): void {
  const now = new Date(nowMs);
  const ev = new Date(resolvedMs);
  const nowY = now.getFullYear();
  const evY = ev.getFullYear();
  const { d0, rows } = yearsLayout(nowMs, resolvedMs);
  const labW = 54;
  const gap = 7;
  const rowGap = 11;
  const rowH = (g.height - rowGap * (rows - 1)) / rows;
  const cellH = rowH;
  const cellW = (g.contentW - labW - 10 * gap) / 10;
  const rx = Math.min(6, Math.min(cellW, cellH) * 0.22);
  const showLabel = cellH >= 18 && cellW >= 22;
  const yrFont = Math.min(12, cellW * 0.34, cellH * 0.5);

  for (let r = 0; r < rows; r++) {
    const dec = d0 + r * 10;
    const ry = g.top + r * (rowH + rowGap);
    // Decade label in the left gutter, right-aligned to its edge (matches vizYear).
    aText(
      svg,
      g.left + labW - 12,
      ry + rowH / 2,
      Math.min(14, rowH * 0.5),
      C.muted,
      800,
      'end',
      `${dec}s`,
      { 'dominant-baseline': 'central' }
    );
    for (let i = 0; i < 10; i++) {
      const yr = dec + i;
      const before = yr < nowY;
      const isNow = yr === nowY;
      const isEv = yr === evY;
      const between = (yr - nowY) * (yr - evY) < 0;
      const st = isEv
        ? roleStyle(C, 'event')
        : isNow
          ? roleStyle(C, 'today')
          : between
            ? gradStyle(C, (yr - nowY) / (evY - nowY))
            : roleStyle(C, before ? 'past' : 'future');
      const x = g.left + labW + i * (cellW + gap);
      aRect(svg, x, ry, cellW, cellH, rx, st.fill, st.stroke, 1);
      if (isEv) haloRect(svg, x, ry, cellW, cellH, rx, C);
      if (showLabel) {
        aText(
          svg,
          x + cellW / 2,
          ry + cellH / 2,
          yrFont,
          st.text,
          isNow || isEv ? 800 : 650,
          'middle',
          String(yr),
          { 'dominant-baseline': 'central' }
        );
      }
    }
  }
}

/** > 1yr — one row of 12 month cells per year; rows fill height, cells fill width. */
function vizYear(
  svg: SvgSel,
  g: BandBox,
  nowMs: number,
  resolvedMs: number,
  C: BandColors
): void {
  const now = new Date(nowMs);
  const ev = new Date(resolvedMs);
  // Ordered year rows (min→max) so a past target mirrors a future one.
  const y0 = Math.min(now.getFullYear(), ev.getFullYear());
  const y1 = Math.max(now.getFullYear(), ev.getFullYear());
  const years: number[] = [];
  for (let y = y0; y <= y1; y++) years.push(y);
  const R = years.length;
  // Compact: the year lives in a LEFT GUTTER (big), rows are short, gaps tight,
  // and each month cell holds just its MMM (+ a day number on the anchors).
  const yearW = 66;
  const gap = 8;
  const rowGap = 12;
  const rowH = (g.height - rowGap * (R - 1)) / R;
  const cellH = rowH;
  const cellW = (g.contentW - yearW - 11 * gap) / 12;
  const nowY = now.getFullYear();
  const nowM = now.getMonth();
  const evY = ev.getFullYear();
  const evM = ev.getMonth();
  const nowOrd = nowY * 12 + nowM;
  const evOrd = evY * 12 + evM;
  years.forEach((yr, r) => {
    const ry = g.top + r * (rowH + rowGap);
    // Big year number in the left gutter — RIGHT-aligned to the gutter edge so it
    // never collides with (or gets clipped by) the first month cell.
    aText(
      svg,
      g.left + yearW - 12,
      ry + rowH / 2,
      Math.min(22, rowH * 0.6),
      C.muted,
      800,
      'end',
      String(yr),
      { 'dominant-baseline': 'central' }
    );
    for (let m = 0; m < 12; m++) {
      const mOrd = yr * 12 + m;
      const before = mOrd < nowOrd;
      const isNow = yr === nowY && m === nowM;
      const isEv = yr === evY && m === evM;
      const between = (mOrd - nowOrd) * (mOrd - evOrd) < 0;
      const anchor = isEv || isNow;
      const st = isEv
        ? roleStyle(C, 'event')
        : isNow
          ? roleStyle(C, 'today')
          : between
            ? gradStyle(C, (yr * 12 + m - nowOrd) / (evOrd - nowOrd))
            : roleStyle(C, before ? 'past' : 'future');
      const x = g.left + yearW + m * (cellW + gap);
      const rx = Math.min(5, Math.min(cellW, cellH) * 0.22);
      aRect(svg, x, ry, cellW, cellH, rx, st.fill, st.stroke, 1);
      if (isEv) haloRect(svg, x, ry, cellW, cellH, rx, C);
      const cx = x + cellW / 2;
      const mFont = Math.min(11, cellW * 0.32);
      if (anchor) {
        aText(
          svg,
          cx,
          ry + cellH * 0.36,
          mFont,
          st.text,
          700,
          'middle',
          MON_ABBR[m]!,
          { 'dominant-baseline': 'central' }
        );
        const dnum = isEv ? ev.getDate() : now.getDate();
        aText(
          svg,
          cx,
          ry + cellH * 0.72,
          Math.min(14, cellW * 0.42),
          st.text,
          800,
          'middle',
          String(dnum),
          { 'dominant-baseline': 'central' }
        );
      } else {
        aText(
          svg,
          cx,
          ry + cellH / 2,
          mFont,
          st.text,
          700,
          'middle',
          MON_ABBR[m]!,
          { 'dominant-baseline': 'central' }
        );
      }
    }
  });
}

/**
 * 3–12mo — one rectangle PER MONTH (same idiom as the >1yr year tier, just not
 * grouped into 12-per-row year rows): muted/role fill + solid border, a month
 * label top-left with a full-width hairline rule under it, and ONLY the now-month
 * and target-month dated (their day-of-month centered in the body). A full
 * numbered day calendar only appears once the span is short enough (≤ ~3 months).
 */
function vizMonths(
  svg: SvgSel,
  g: BandBox,
  nowMs: number,
  resolvedMs: number,
  C: BandColors
): void {
  const now = new Date(nowMs);
  const ev = new Date(resolvedMs);
  // Minimum 6 months, 6 per row, padded with dimmed context months on either side
  // so short spans read at a natural width instead of a few over-wide rectangles.
  const realSpan = monthSpan(nowMs, resolvedMs);
  const perRow = 6;
  const shown = Math.max(perRow, Math.ceil(realSpan / perRow) * perRow);
  const padBefore = Math.floor((shown - realSpan) / 2);
  const rows = shown / perRow;
  const gap = 16;
  const rowGap = 16;
  const labelH = 27;
  const cellW = (g.contentW - gap * (perRow - 1)) / perRow;
  const cellH = (g.height - rowGap * (rows - 1)) / rows;
  const nowMk = now.getFullYear() * 12 + now.getMonth();
  const evMk = ev.getFullYear() * 12 + ev.getMonth();
  // Window over the ordered [earlier..later] month range → past mirrors future.
  const loMk = Math.min(nowMk, evMk);
  const hiMk = Math.max(nowMk, evMk);
  const startMk = loMk - padBefore;
  for (let i = 0; i < shown; i++) {
    const d = new Date(Math.floor(startMk / 12), (startMk % 12) + i, 1);
    const mk = d.getFullYear() * 12 + d.getMonth();
    const isNow = mk === nowMk;
    const isEv = mk === evMk;
    const isContext = mk < loMk || mk > hiMk;
    const anchor = isNow || isEv;
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = g.left + col * (cellW + gap);
    const y = g.top + row * (cellH + rowGap);
    // Context months render dimmed so the real now→event run stays dominant.
    const mt = (
      isContext ? svg.append('g').attr('opacity', 0.42) : svg
    ) as SvgSel;
    const st = isEv
      ? roleStyle(C, 'event')
      : isNow
        ? roleStyle(C, 'today')
        : (mk - nowMk) * (mk - evMk) < 0
          ? gradStyle(C, (mk - nowMk) / (evMk - nowMk))
          : roleStyle(C, mk < nowMk ? 'past' : 'future');
    const rxM = Math.min(12, cellH * 0.14);
    aRect(mt, x, y, cellW, cellH, rxM, st.fill, st.stroke, 1.25);
    if (isEv) haloRect(mt, x, y, cellW, cellH, rxM, C);
    // Centered month name (no year — it won't fit the narrow cell).
    aText(
      mt,
      x + cellW / 2,
      y + 19,
      16,
      st.text,
      700,
      'middle',
      MON_ABBR[d.getMonth()]!
    );
    aLine(
      mt,
      x,
      y + labelH,
      x + cellW,
      y + labelH,
      st.text,
      1,
      anchor ? 0.5 : 0.3
    );
    if (anchor) {
      const dnum = isEv ? ev.getDate() : now.getDate();
      const dFont = Math.min(cellH - labelH - 6, cellW * 0.42, 44);
      aText(
        mt,
        x + cellW / 2,
        y + labelH + (cellH - labelH) / 2 + 1,
        dFont,
        st.text,
        800,
        'middle',
        String(dnum),
        { 'dominant-baseline': 'central' }
      );
    }
  }
}

// ================= CLOSE-IN TIERS (box-filling) =================

/**
 * ≤ ~3mo — real side-by-side month day-calendars. Each month sits in a rounded
 * rectangle: month name centered up top with a full-width hairline rule under it
 * (no weekday header row); the weekend columns (Sun/Sat) are shaded vertically so
 * you can read the rhythm without the S·M·T header. Day numbers carry the shared
 * role convention (today/event/remaining chips).
 */
function vizMonthGrid(
  svg: SvgSel,
  g: BandBox,
  nowMs: number,
  resolvedMs: number,
  C: BandColors
): void {
  const { months, dim: isContext } = monthGridLayout(
    nowMs,
    resolvedMs,
    g.contentW
  );
  const nM = months.length;
  const gap = 20;
  const mw = (g.contentW - gap * (nM - 1)) / nM;
  const padX = 10;
  const gridLeft = padX;
  const gridW = mw - 2 * padX;
  const cols = 7;
  const cellW = gridW / cols;
  const top = g.top;
  const headH = 26; // centered label + rule, no weekday row
  const cellH = (g.height - headH - 8) / 6; // full 6-row months
  const gridH = 6 * cellH;
  const weekendShade = mix(C.text, C.bg, 8);
  const todayKey = keyOf(nowMs);
  const evKey = keyOf(resolvedMs);
  months.forEach((m, mi) => {
    // Context months render into a dimmed group so the real span stays dominant.
    const mt = (
      isContext[mi] ? svg.append('g').attr('opacity', 0.42) : svg
    ) as SvgSel;
    const mx = g.left + mi * (mw + gap);
    // Rounded-rect container for the whole month.
    aRect(mt, mx, top, mw, g.height, 14, C.inert, C.inertBorder, 1.25);
    const gy = top + headH;
    // Weekend columns shaded vertically (Sun = col 0, Sat = col 6).
    for (const wcol of [0, 6])
      aRect(
        mt,
        mx + gridLeft + wcol * cellW,
        gy,
        cellW,
        gridH,
        6,
        weekendShade
      );
    // Centered month name + rule beneath it, spanning the container edge to edge.
    aText(
      mt,
      mx + mw / 2,
      top + 16,
      14,
      C.text,
      700,
      'middle',
      `${MON_ABBR[m.getMonth()]} ${m.getFullYear()}`
    );
    aLine(mt, mx, top + headH - 6, mx + mw, top + headH - 6, C.rule, 1.25);
    const first = new Date(m.getFullYear(), m.getMonth(), 1).getDay();
    const dim = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= dim; day++) {
      const pos = first + day - 1;
      const wk = Math.floor(pos / 7);
      const dk = keyOf(new Date(m.getFullYear(), m.getMonth(), day).getTime());
      const wd = pos % 7;
      const cx = mx + gridLeft + wd * cellW;
      const cy = gy + wk * cellH;
      const isEvent = dk === evKey;
      const isToday = dk === todayKey;
      const between = (dk - todayKey) * (dk - evKey) < 0;
      const anchor = isEvent || isToday;
      const dtMs = new Date(m.getFullYear(), m.getMonth(), day).getTime();
      const st = isEvent
        ? roleStyle(C, 'event')
        : isToday
          ? roleStyle(C, 'today')
          : between
            ? gradStyle(C, dayDelta(nowMs, dtMs) / dayDelta(nowMs, resolvedMs))
            : roleStyle(C, dk < todayKey ? 'past' : 'future');
      if (anchor) {
        // Only today & the target are DATED — a bordered chip with its number.
        const s = Math.min(cellW, cellH) * 1.02;
        const sx = cx + (cellW - s) / 2;
        const sy = cy + (cellH - s) / 2;
        aRect(mt, sx, sy, s, s, 7, st.fill, st.stroke, 2);
        if (isEvent) haloRect(mt, sx, sy, s, s, 7, C);
        aText(
          mt,
          cx + cellW / 2,
          cy + cellH / 2,
          Math.min(16, cellH * 0.62),
          st.text,
          750,
          'middle',
          String(day),
          { 'dominant-baseline': 'central' }
        );
      } else {
        // Every other day is a small unlabeled dot carrying only its role color.
        const s = Math.min(cellW, cellH) * 0.5;
        aRect(
          mt,
          cx + (cellW - s) / 2,
          cy + (cellH - s) / 2,
          s,
          s,
          Math.min(3, s * 0.3),
          st.fill,
          st.stroke,
          1
        );
      }
    }
  });
}

/**
 * ≤ 7d — one STRETCHY linear day-strip: a cell per day from today (leftmost) to
 * the event (rightmost, haloed), warming along the now→event gradient. Reserved
 * for a single week, where the run fills one calendar row and a full 6-row month
 * grid would sit mostly empty; 8d+ promote to the real day-calendar (monthgrid).
 * Weekday labels drop and cells compact as the span grows.
 */
function vizWeekStrip(
  svg: SvgSel,
  g: BandBox,
  nowMs: number,
  resolvedMs: number,
  C: BandColors
): void {
  const nReal = Math.abs(dayDelta(nowMs, resolvedMs)) + 1; // earlier .. later inclusive
  // Pad to a minimum of 7 cells with dimmed context days on either side, so a
  // 1–2 day span isn't two enormous cells.
  const n = Math.max(7, nReal);
  const padBefore = Math.floor((n - nReal) / 2);
  const gap = n <= 7 ? 14 : n <= 12 ? 10 : 7;
  const cw = (g.contentW - gap * (n - 1)) / n;
  const cellTop = g.top;
  const ch = g.height;
  const showWd = cw >= 30; // weekday label + rule fit?
  const showTag = cw >= 44; // room for a TODAY tag under the date?
  const nowOrd = DAY_START(nowMs);
  const evOrd = DAY_START(resolvedMs);
  const loOrd = Math.min(nowOrd, evOrd);
  const hiOrd = Math.max(nowOrd, evOrd);
  // Lay cells out chronologically from the EARLIER endpoint so a passed target
  // mirrors a future one (event on the left, today on the right, gradient reversed).
  const first = new Date(Math.min(nowMs, resolvedMs));
  for (let i = 0; i < n; i++) {
    // Component arithmetic (JS normalizes month overflow) — never an ordinal round-trip.
    const dt = new Date(
      first.getFullYear(),
      first.getMonth(),
      first.getDate() + i - padBefore
    );
    const dtOrd = DAY_START(dt.getTime());
    const x = g.left + i * (cw + gap);
    const isToday = dtOrd === nowOrd;
    const isEvent = dtOrd === evOrd;
    const isContext = dtOrd < loOrd || dtOrd > hiOrd;
    const st = isEvent
      ? roleStyle(C, 'event')
      : isToday
        ? roleStyle(C, 'today')
        : isContext
          ? roleStyle(C, dtOrd < nowOrd ? 'past' : 'future')
          : gradStyle(C, (dtOrd - nowOrd) / (evOrd - nowOrd));
    // Context (padding) days render dimmed so the real today→event run leads.
    const ct = (
      isContext ? svg.append('g').attr('opacity', 0.5) : svg
    ) as SvgSel;
    const sw = isToday || isEvent ? 2 : 1.25;
    aRect(ct, x, cellTop, cw, ch, 14, st.fill, st.stroke, sw);
    if (isEvent) haloRect(ct, x, cellTop, cw, ch, 14, C);
    if (showWd) {
      aText(
        ct,
        x + cw / 2,
        cellTop + 18,
        Math.min(12, cw * 0.3),
        st.text,
        700,
        'middle',
        WD_ABBR[dt.getDay()]!,
        { 'letter-spacing': '0.04em' }
      );
      aLine(
        ct,
        x,
        cellTop + 27,
        x + cw,
        cellTop + 27,
        st.text,
        1,
        isToday || isEvent ? 0.5 : 0.3
      );
    }
    aText(
      ct,
      x + cw / 2,
      cellTop + (showWd ? ch * 0.6 : ch * 0.54),
      Math.min(44, cw * 0.62),
      st.text,
      750,
      'middle',
      String(dt.getDate())
    );
    if (showTag && isToday)
      aText(
        ct,
        x + cw / 2,
        cellTop + ch - 13,
        10,
        st.text,
        700,
        'middle',
        'TODAY',
        { 'letter-spacing': '0.04em' }
      );
  }
}

/** = today (all-day, no time) — the day is the message. */
function vizToday(
  svg: SvgSel,
  g: BandBox,
  resolvedMs: number,
  C: BandColors
): void {
  const ev = new Date(resolvedMs);
  const cx = g.left + g.contentW / 2;
  const cy = g.top + g.height / 2;
  aLine(svg, g.left, cy, g.left + g.contentW, cy, C.rule, 2);
  aLine(svg, cx, cy, g.left + g.contentW, cy, C.midSoft, 2);
  const rays = 16;
  const r0 = g.height * 0.3;
  const r1 = g.height * 0.44;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    svg
      .append('line')
      .attr('x1', cx + Math.cos(a) * r0)
      .attr('y1', cy + Math.sin(a) * r0)
      .attr('x2', cx + Math.cos(a) * r1)
      .attr('y2', cy + Math.sin(a) * r1)
      .attr('stroke', C.event)
      .attr('stroke-width', 2.5)
      .attr('stroke-linecap', 'round')
      .attr('opacity', 0.45);
  }
  const w = Math.min(120, g.contentW * 0.16);
  const h = g.height * 0.52;
  // The date chip is an event chip — it follows the §1.9 fill family.
  const st = roleStyle(C, 'event');
  aRect(svg, cx - w / 2, cy - h / 2, w, h, 18, st.fill, st.stroke, 2);
  aText(
    svg,
    cx,
    cy - h * 0.14,
    14,
    st.text,
    700,
    'middle',
    MON_ABBR[ev.getMonth()]!.toUpperCase(),
    { 'letter-spacing': '0.08em' }
  );
  aText(
    svg,
    cx,
    cy + h * 0.22,
    Math.min(48, h * 0.4),
    st.text,
    800,
    'middle',
    String(ev.getDate())
  );
  aText(
    svg,
    cx,
    cy + h / 2 + 26,
    13,
    C.event,
    700,
    'middle',
    'THE DAY IS HERE',
    { 'letter-spacing': '0.12em' }
  );
}

// ── Timed finale ring gauges (hours · minutes · seconds) ──
function polar(
  cx: number,
  cy: number,
  r: number,
  deg: number
): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function arcPath(cx: number, cy: number, r: number, frac: number): string {
  frac = Math.max(0, Math.min(0.9999, frac));
  const [x0, y0] = polar(cx, cy, r, 0);
  const [x1, y1] = polar(cx, cy, r, frac * 360);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x1} ${y1}`;
}
/**
 * Three ring gauges HOURS·MINUTES·SECONDS. Symmetric down→up: `ahead` (before
 * the instant) counts DOWN with a "TO GO" caption, else UP with "AGO". Each
 * gauge tags its numeral/arc so the ticker can recompute live. Fills the band.
 */
function vizClock(
  svg: SvgSel,
  g: BandBox,
  nowMs: number,
  targetMs: number,
  C: BandColors
): void {
  const ahead = targetMs >= nowMs;
  const rem = Math.abs(targetMs - nowMs);
  const h = Math.floor(rem / 3600000);
  const m = Math.floor((rem % 3600000) / 60000);
  const s = Math.floor((rem % 60000) / 1000);
  const R = Math.min((g.contentW / 3) * 0.3, g.height * 0.34);
  const cy = g.top + g.height * 0.42;
  const sw = Math.max(8, R * 0.17);
  // Final day = imminent = hot: all three rings sweep the target accent. The live
  // seconds hand reads by its motion, not by a borrowed hue (was a fixed blue).
  const gauges = [
    { frac: (h % 24) / 24, val: h, label: 'HOURS', col: C.event, key: 'h' },
    { frac: m / 60, val: m, label: 'MINUTES', col: C.event, key: 'm' },
    { frac: s / 60, val: s, label: 'SECONDS', col: C.event, key: 's' },
  ];
  gauges.forEach((gg, i) => {
    const cx = g.left + (g.contentW * (i + 0.5)) / 3;
    svg
      .append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', R)
      .attr('fill', 'none')
      .attr('stroke', C.inert)
      .attr('stroke-width', sw);
    const arc = svg
      .append('path')
      .attr('d', gg.frac > 0.001 ? arcPath(cx, cy, R, gg.frac) : '')
      .attr('fill', 'none')
      .attr('stroke', gg.col)
      .attr('stroke-width', sw)
      .attr('stroke-linecap', 'round')
      .attr('data-dgmo-gauge-arc', gg.key)
      .attr('data-cx', cx)
      .attr('data-cy', cy)
      .attr('data-r', R);
    void arc;
    aText(
      svg,
      cx,
      cy + R * 0.22,
      R * 0.62,
      C.text,
      800,
      'middle',
      pad2(gg.val),
      {
        'data-dgmo-gauge-val': gg.key,
      }
    );
    aText(svg, cx, cy + R + 22, 12, C.muted, 700, 'middle', gg.label, {
      'letter-spacing': '0.1em',
    });
  });
  const cxMid = g.left + g.contentW * 0.5;
  aText(
    svg,
    cxMid,
    cy - R - 14,
    13,
    ahead ? C.event : C.muted,
    700,
    'middle',
    ahead ? 'TO GO' : 'AGO',
    {
      'letter-spacing': '0.12em',
      'data-dgmo-gauge-caption': '',
    }
  );
}

/** Small local pad-2 (resolve.pad2 is not exported). */
function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/**
 * Paint a clock-capable text element as `<tspan>` parts so the fast-ticking
 * seconds ride smaller (and in the cold-blue `now` hue) — subordinate to the
 * `HH:MM` lead. Marks the element (`data-dgmo-cd-clock` + baked seconds size /
 * fill) so the ticker can rebuild the same split live. Non-clock strings paint
 * as a single lead tspan (identical to plain text). The parent's tabular-nums
 * keeps every digit a fixed advance, so the right-anchored string never wobbles.
 */
function paintClock(
  sel: d3Selection.Selection<SVGTextElement, unknown, null, undefined>,
  str: string,
  secSize: number,
  secFill: string
): void {
  const { lead, sec } = splitClockSeconds(str);
  sel
    .attr('font-variant-numeric', 'tabular-nums')
    .attr('data-dgmo-cd-clock', '')
    .attr('data-dgmo-cd-sec-size', secSize)
    .attr('data-dgmo-cd-sec-fill', secFill)
    .text(null);
  sel.append('tspan').attr('data-cd-lead', '').text(lead);
  if (sec !== null)
    sel
      .append('tspan')
      .attr('data-cd-sec', '')
      .attr('font-size', secSize)
      .attr('fill', secFill)
      .attr('font-weight', 700)
      .text(sec);
}

/** Dispatch the tier-appropriate band viz, filling the fixed reservation. */
function drawBand(
  svg: SvgSel,
  kind: BandKind,
  g: BandBox,
  nowMs: number,
  resolvedMs: number,
  C: BandColors
): void {
  switch (kind) {
    case 'years':
      return vizYears(svg, g, nowMs, resolvedMs, C);
    case 'year':
      return vizYear(svg, g, nowMs, resolvedMs, C);
    case 'months':
      return vizMonths(svg, g, nowMs, resolvedMs, C);
    case 'monthgrid':
      return vizMonthGrid(svg, g, nowMs, resolvedMs, C);
    case 'weekstrip':
      return vizWeekStrip(svg, g, nowMs, resolvedMs, C);
    case 'today':
      return vizToday(svg, g, resolvedMs, C);
    case 'clock':
      return vizClock(svg, g, nowMs, resolvedMs, C);
  }
}

export function renderCountdown(
  container: HTMLDivElement,
  parsed: ParsedCountdown,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const now = Date.now();
  const resolved = parsed.resolvedMs;
  // The eyebrow is OPT-IN: `since` is mandatory on every recurring block now, so
  // keying the ordinal off it would number a standing meeting nobody asked to
  // number. `since-label` is the opt-in, and carries the template.
  const label = parsed.sinceLabel ?? parsed.title ?? '';
  const ordinal =
    parsed.sinceLabel !== null && parsed.rule !== null && resolved !== null
      ? ordinalFor(resolved, parsed.rule)
      : null;

  // Band tier — auto-picked from the whole-day span (§36.6). `no-visual` and an
  // `expired`-frozen one-shot suppress the band. The timed finale ('clock') also
  // promotes the ticking clock into the hero.
  const expiredFrozen =
    !parsed.rule &&
    parsed.expired !== null &&
    resolved !== null &&
    resolved - now <= 0;
  const bandKind: BandKind | null =
    resolved === null || parsed.noVisual || expiredFrozen
      ? null
      : pickBand(now, resolved, parsed.hasTime);

  let hero = bakedHero(parsed, now);
  // Timed finale: the hero becomes the ticking H·M·S clock (down, then up past).
  if (bandKind === 'clock' && resolved !== null) {
    const clock = formatCount(Math.abs(resolved - now), {
      units: 'clock',
      round: parsed.round,
      fields: parsed.fields,
    });
    hero = resolved - now < 0 ? `${clock} ago` : clock;
  }

  const seriesAccent = getSeriesColors(palette)[0]!;
  // The target defaults to HOT red — the far end of the now(cold)→target(hot)
  // gradient — so an un-colored countdown still reads as "heating up." The
  // gradient itself IS the urgency signal, so there is no separate traffic-light
  // ramp. An explicit §1.5 color token overrides the default (becomes the
  // gradient's hot endpoint).
  const defaultAccent = resolveColor('red', palette) ?? seriesAccent;
  const manualColor =
    (parsed.color && resolveColor(parsed.color, palette)) ||
    parsed.color ||
    null;
  const accent = manualColor ?? defaultAccent;
  const muted = mix(palette.text, themeBaseBg(palette, isDark), 55);
  // Green = time BANKED — the `since`/anniversary/tenure count (what you've
  // accumulated), the calm positive mirror of red's "time remaining." The lone
  // third hue in an otherwise blue↔red chart.
  const banked = resolveColor('green', palette) ?? muted;
  const faint = mix(palette.text, themeBaseBg(palette, isDark), 72);

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('role', 'img')
    .attr('aria-label', `${parsed.title ?? 'Countdown'}: ${hero}`)
    .style('font-family', FONT_FAMILY);

  // Subtle target flash — a slow opacity/width breathe on the bright event ring
  // so the destination stands out on live surfaces (app, Obsidian, web). resvg
  // ignores the animation and bakes the first frame; honour reduced-motion.
  svg.append('style').text(`
    @keyframes dgmo-countdown-flash {
      0%, 100% { opacity: 1; stroke-width: 2; }
      50% { opacity: 0.45; stroke-width: 3; }
    }
    .dgmo-countdown-target-ring {
      animation: dgmo-countdown-flash 1.8s ease-in-out infinite;
    }
    @media (prefers-reduced-motion: reduce) {
      .dgmo-countdown-target-ring { animation: none; }
    }
  `);

  // Background rect — sized once the banner height is known (see end).
  const bgRect = svg
    .append('rect')
    .attr('width', width)
    .attr('fill', palette.bg);

  // Width estimate without a DOM layout pass (resvg has none): Inter advances
  // ~0.58em on average; overestimating just picks a safe smaller font.
  const estWidth = (t: string, fs: number): number => t.length * fs * 0.58;
  const fitFont = (
    t: string,
    base: number,
    maxW: number,
    min: number
  ): number => {
    const w = estWidth(t, base);
    return w <= maxW ? base : Math.max(min, Math.floor((base * maxW) / w));
  };
  const dispLen = (s: string): number => stripInlineMarkdown(s).length;

  const padX = Math.max(30, Math.round(width * 0.045));
  const padY = Math.max(26, Math.round(width * 0.03));
  const contentW = width - 2 * padX;
  const leftX = padX;

  // ── Right column: the hero figure. Size it first so the left column knows
  //    how much horizontal room it has. Reserve for the WIDEST the live ticker
  //    can make it — `full`/`clock` bake a narrow day count ("52 days") but tick
  //    to `Nd HH:MM:SS` / `HH:MM:SS`, so lay out against that or the rule runs
  //    under the hero. ──
  const remainingNow = resolved === null ? 0 : Math.max(0, resolved - now);
  const dayCount = Math.ceil(remainingNow / DAY_MS);
  const heroSizeStr =
    parsed.units === 'full'
      ? `${dayCount > 0 ? `${dayCount}d ` : ''}00:00:00`
      : parsed.units === 'clock'
        ? formatCount(remainingNow, {
            units: 'clock',
            round: parsed.round,
            fields: parsed.fields,
          })
        : hero;
  const heroMaxW = contentW * 0.44;
  // Reserve for the WIDEST string the ticker can show. `heroSizeStr` is a
  // FORWARD (remaining) reservation, so once the target has passed it collapses
  // to "00:00:00" and misses the real "HH:MM:SS ago" up-count — which then
  // overflows leftward into the title column. Size to whichever is wider.
  const sizeStr =
    estWidth(hero, 1) > estWidth(heroSizeStr, 1) ? hero : heroSizeStr;
  const gapMid = Math.max(28, Math.round(width * 0.03));
  // In a narrow panel the hero string can't fit beside the title even at its
  // floor font — it would overflow leftward into the title (a long "HH:MM:SS ago"
  // count in a ~300px preview). When it would overflow the right column, STACK it
  // on its own full-width line under the header instead of crowding both together.
  const stacked = estWidth(sizeStr, 26) > heroMaxW;
  const heroFont = fitFont(sizeStr, 96, stacked ? contentW : heroMaxW, 26);
  const heroW = stacked
    ? contentW
    : Math.min(heroMaxW, estWidth(sizeStr, heroFont));
  const leftW = stacked
    ? contentW
    : Math.max(contentW * 0.42, contentW - heroW - gapMid);

  // ── Left column fonts + content ──
  // Title: keep a comfortable size and WRAP onto new lines when it runs over,
  // rather than shrinking to a tiny font or overflowing into the hero. Only a
  // single over-long word forces a shrink (so it never overflows the column).
  const titleBase = 40;
  let titleFont = 0;
  let titleLines: string[] = [];
  if (parsed.title) {
    const longestWord = parsed.title
      .split(/\s+/)
      .reduce((a, b) => (b.length > a.length ? b : a), '');
    titleFont = fitFont(longestWord, titleBase, leftW, 22);
    const cpl = Math.max(6, Math.floor(leftW / (titleFont * 0.58)));
    titleLines = wrapDescriptionLines([parsed.title], cpl).map((l) => l.text);
  }
  // The since eyebrow is a free-form template: `Nth` → ordinal word, `N` → the
  // number. Default (no since-label) = "Nth <title>".
  const eyebrowText =
    ordinal !== null
      ? applyOrdinalTemplate(parsed.sinceLabel ?? `Nth ${label}`, ordinal)
      : null;
  const eyebrowFont = 16;
  const footerText =
    resolved !== null
      ? formatFooter(resolved, parsed.hasTime, parsed.tz)
      : null;
  const footerFont = 17;
  const noteFont = 19;
  const asofFont = 13;

  // Wrap the markdown note to the left column. Normalize `- `/`* ` list markers
  // to the `• ` prefix that wrapDescriptionLines renders as a hanging bullet.
  const noteCharsPerLine = Math.max(8, Math.floor(leftW / (noteFont * 0.5)));
  const noteSource = parsed.note
    ? parsed.note.split('\n').map((l) => l.replace(/^[-*]\s+/, '• '))
    : [];
  const noteLines = noteSource.length
    ? wrapDescriptionLines(noteSource, noteCharsPerLine, dispLen)
    : [];
  const bulletPx = noteFont * 0.95;

  // ── Draw the left column top-down; record the running baseline. ──
  let y = padY;
  const drawText = (
    text: string,
    yTop: number,
    fs: number,
    fill: string,
    weight: number
  ): d3Selection.Selection<SVGTextElement, unknown, null, undefined> =>
    svg
      .append('text')
      .attr('x', leftX)
      .attr('y', yTop + fs)
      .attr('text-anchor', 'start')
      .attr('dominant-baseline', 'alphabetic')
      .attr('fill', fill)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', fs)
      .attr('font-weight', weight)
      .text(text) as unknown as d3Selection.Selection<
      SVGTextElement,
      unknown,
      null,
      undefined
    >;

  if (parsed.title) {
    titleLines.forEach((tl, i) => {
      const t = drawText(tl, y, titleFont, palette.text, 700);
      if (i === 0) t.attr('data-line-number', parsed.titleLineNumber);
      y += i < titleLines.length - 1 ? Math.round(titleFont * 1.12) : titleFont;
    });
    y += Math.round(titleFont * 0.45);
    // Hairline rule under the title. Stop it short of the hero's left edge so the
    // big count never gets a line struck through it (the hero is top-aligned and
    // taller than the title, so a full-width rule would cross it).
    const heroLeft = width - padX - heroW;
    const ruleRight = stacked
      ? width - padX
      : Math.max(leftX + 40, heroLeft - 20);
    svg
      .append('line')
      .attr('x1', leftX)
      .attr('x2', ruleRight)
      .attr('y1', y)
      .attr('y2', y)
      .attr('stroke', mix(palette.text, palette.bg, 14))
      .attr('stroke-width', 1.25);
    y += Math.round(titleFont * 0.5);
  }

  // Eyebrow ordinal (ancillary — below the rule): the `since`/tenure count is
  // BANKED time, so it wears the calm green, not the red deadline hue.
  if (eyebrowText) {
    drawText(eyebrowText, y, eyebrowFont, banked, 700).attr(
      'data-dgmo-countdown-eyebrow',
      ''
    );
    y += eyebrowFont + 8;
  }

  // Footer resolution line — recurring blocks get the ↻ glyph as a prefix.
  if (footerText) {
    const fx = parsed.rule ? leftX + 22 : leftX;
    if (parsed.rule)
      recurGlyph(svg, leftX + 8, y + footerFont * 0.52, 6.5, muted);
    svg
      .append('text')
      .attr('x', fx)
      .attr('y', y + footerFont)
      .attr('text-anchor', 'start')
      .attr('dominant-baseline', 'alphabetic')
      .attr('fill', muted)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', footerFont)
      .attr('font-weight', 500)
      .attr('data-dgmo-countdown-footer', '')
      .text(footerText);
    y += footerFont + 8;
  }

  // Markdown note.
  if (noteLines.length) {
    y += 4;
    for (const nl of noteLines) {
      const bx = nl.kind === 'plain' ? leftX : leftX + bulletPx;
      if (nl.kind === 'bullet-first') {
        svg
          .append('text')
          .attr('x', leftX)
          .attr('y', y + noteFont)
          .attr('fill', muted)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', noteFont)
          .text('•');
      }
      const t = svg
        .append('text')
        .attr('x', bx)
        .attr('y', y + noteFont)
        .attr('fill', palette.text)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', noteFont)
        .attr('font-weight', 400);
      renderInlineText(
        t as unknown as d3Selection.Selection<
          SVGTextElement,
          unknown,
          null,
          undefined
        >,
        nl.text,
        palette,
        noteFont
      );
      y += Math.round(noteFont * 1.35);
    }
    y += 2;
  }

  // The "as of" stamp — ticker removes it on first tick; a baked image keeps it.
  drawText(`as of ${formatDateShort(now)}`, y, asofFont, faint, 400).attr(
    'data-dgmo-countdown-asof',
    ''
  );
  y += asofFont;

  const leftBottom = y;

  // ── Hero sub-line: the finer remainder ("3 days") for the human hero, or the
  //    words-mode precision line, or a ticking clock for a timed target days out.
  //    The timed finale ('clock') carries its time in the ring gauges instead. ──
  const detailFont = 18;
  const remainingSub = resolved !== null ? resolved - now : 0;
  const subText: string | null =
    resolved === null || remainingSub <= 0
      ? null
      : parsed.units === 'words'
        ? formatWordsDetail(remainingSub)
        : parsed.units === 'human' && bandKind !== 'clock'
          ? parsed.hasTime
            ? formatCount(remainingSub, {
                units: 'clock',
                round: parsed.round,
                fields: parsed.fields,
              })
            : formatHuman(
                tzDayStart(now, parsed.tz),
                tzDayStart(resolved, parsed.tz),
                parsed.tz
              ).sub || null
          : null;
  const heroCapTop = stacked
    ? leftBottom + Math.round(heroFont * 0.2)
    : padY + 0.28 * titleFont;
  const heroBaseline = heroCapTop + 0.72 * heroFont;
  const heroBlockBottom =
    heroBaseline + (subText ? heroFont * 0.28 + detailFont : 0);

  // ── The calendar band ("you-are-here → event"): a FIXED reservation below the
  //    header — a constant 1.5× the header height, identical across tiers — that
  //    each viz FILLS. Default-on for date-bearing countdowns; `no-visual` off. ──
  const contentBottom = Math.max(leftBottom, heroBlockBottom);
  const hasBand = bandKind !== null;
  const topSection = contentBottom;
  const bandTop = topSection + 26;
  // Compact, content-driven band height — NOT a multiple of the header, so a tall
  // header (wrapped title/note in a narrow panel) can't stretch the calendar.
  const BAND_H =
    hasBand && resolved !== null
      ? Math.round(bandHeightFor(bandKind, now, resolved, width - 2 * padX))
      : 0;

  const bannerH = hasBand
    ? bandTop + BAND_H + padY
    : Math.max(
        contentBottom + padY,
        heroFont * 1.25 + 2 * padY,
        Math.round(width * 0.28)
      );
  svg.attr('height', bannerH).attr('viewBox', `0 0 ${width} ${bannerH}`);
  bgRect.attr('height', bannerH);

  // `now` is the fixed cold-blue anchor — shared by the band gradient AND the
  // subordinate hero/detail seconds so the whole chart's "you-are-here" reads blue.
  const bandC = bandColors(
    palette,
    accent,
    muted,
    faint,
    isDark,
    parsed.fillMode
  );
  if (hasBand && resolved !== null) {
    drawBand(
      svg,
      bandKind,
      { left: leftX, top: bandTop, contentW: width - 2 * padX, height: BAND_H },
      now,
      resolved,
      bandC
    );
  }

  // ── The live hero marker — big, accent, TOP-aligned with the title on the
  //    right. Match cap-tops: title cap-top ≈ padY + 0.28·titleFont. ──
  const value = svg
    .append('text')
    .attr('class', 'countdown-value')
    .attr('x', stacked ? leftX : width - padX)
    .attr('y', heroBaseline)
    .attr('text-anchor', stacked ? 'start' : 'end')
    .attr('dominant-baseline', 'alphabetic')
    .attr('fill', accent)
    .attr('font-family', FONT_FAMILY)
    .attr('font-size', heroFont)
    .attr('font-weight', 800)
    .attr('data-dgmo-countdown-units', parsed.units)
    .attr('data-dgmo-countdown-round', parsed.round)
    .attr('data-dgmo-countdown-fields', parsed.fields.join(','))
    .attr('data-dgmo-countdown-expired', parsed.expired)
    .attr('aria-label', `${parsed.title ?? 'Countdown'}: ${hero}`);
  // Tabular digits + subordinate seconds (clock states). Non-clock heroes
  // ("1 year, 2 months") paint as a single tspan — identical to plain text.
  paintClock(value, hero, Math.round(heroFont * 0.55), bandC.now);
  // The count target: a one-shot's authored string (ticker re-parses), or the
  // resolved instant for recurring (ticker ignores it and re-resolves the rule).
  if (parsed.rule && resolved !== null) {
    value.attr('data-dgmo-countdown', new Date(resolved).toISOString());
  } else if (parsed.target) {
    value.attr('data-dgmo-countdown', parsed.target);
  }
  if (parsed.title) value.attr('data-dgmo-countdown-title', parsed.title);
  if (parsed.onDay) value.attr('data-dgmo-countdown-onday', parsed.onDay);
  if (parsed.hasTime) value.attr('data-dgmo-countdown-hastime', '1');
  // Zone for live display (one-shot re-parse + footer/hero formatting).
  if (parsed.tz) value.attr('data-dgmo-countdown-tz', parsed.tz);
  // Bake the eyebrow TEMPLATE (Nth/N tokens) so the ticker re-applies it when the
  // ordinal rolls forward. The anchor itself rides `data-dgmo-recur-anchor`, so
  // there is no separate `-since` attribute to keep in step.
  if (parsed.sinceLabel !== null) {
    value.attr('data-dgmo-countdown-since-label', parsed.sinceLabel);
  }
  stampRecur(value, parsed);

  // Hero sub-line under the hero (right-aligned, muted, ticks): the human
  // remainder / words precision / days-out clock. Tagged so the ticker updates it.
  if (subText) {
    const detailSel = svg
      .append('text')
      .attr('x', stacked ? leftX : width - padX)
      .attr('y', heroBaseline + heroFont * 0.28 + detailFont)
      .attr('text-anchor', stacked ? 'start' : 'end')
      .attr('dominant-baseline', 'alphabetic')
      .attr('fill', muted)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', detailFont)
      .attr('font-weight', 500)
      .attr('data-dgmo-countdown-detail', '');
    paintClock(
      detailSel as unknown as d3Selection.Selection<
        SVGTextElement,
        unknown,
        null,
        undefined
      >,
      subText,
      Math.round(detailFont * 0.66),
      bandC.now
    );
  }
}

export function renderCountdownForExport(
  container: HTMLDivElement,
  parsed: ParsedCountdown,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions
): void {
  renderCountdown(container, parsed, palette, isDark, exportDims);
}

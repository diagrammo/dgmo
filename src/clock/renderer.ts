// ============================================================
// Clock chart — D3 SVG Renderer
// ============================================================
//
// Bakes the no-JS floor for a live world-clock board: a titled block then one
// row per place. Each row carries per-row `data-dgmo-clock*` anchors so the
// page-level ticker (src/clock/ticker.ts) can overwrite them live:
//   • analog hands  — `<line data-dgmo-clock-hand>` with a render-time rotate
//   • digital time  — `<text data-dgmo-clock-digital>` (main + dim :SS + am/pm)
//   • offset badge   — `<text data-dgmo-clock-offset>`
//   • weekday line   — `<text data-dgmo-clock-weekday>` (digital only)
//   • midtime        — `<text data-dgmo-clock-midtime>` (analog only)
//   • status chip    — `<text data-dgmo-clock-status>` + bg + dot
//   • sundown line   — `<text data-dgmo-clock-sun-line>` + icon
//   • day/night rule + face tint — recolored from baked hex swatches
// NEVER a `<script>` — every sanitizer strips it; the `data-*` attributes
// survive. All time math is shared with the ticker via ./resolve so the baked
// value and the live value never disagree. resvg has no layout pass, so text
// widths are estimated (never measured).

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { contrastText, mix, themeBaseBg } from '../palettes/color-utils';
import { resolveColor } from '../colors';
import type { PaletteColors } from '../palettes';
import { buildSwatches, type Swatches } from './swatches';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { D3Sel } from '../utils/legend-types';
import type { ClockColorBy, ClockEntry, ParsedClock } from './types';
import {
  fixedParts,
  formatTime,
  handAngles,
  rampColor,
  sunLine,
  workStatus,
  zoneParts,
  type WorkSpec,
  type WorkStatus,
  type ZoneParts,
} from './resolve';

type Sel = D3Sel;

/** Wall-clock parts for an entry: fixed-offset math for `fixed`, IANA/Intl for the rest. */
function partsFor(entry: ClockEntry, now: number): ZoneParts {
  return entry.kind === 'fixed'
    ? fixedParts(entry.fixedOffsetMin ?? 0, now)
    : zoneParts(entry.zone, now);
}

// ── color-by ────────────────────────────────────────────────────────────────
// A zone's resolved color: `solid` paints the time + label, `laneTint` washes
// the lane/column behind it. A hand-set per-zone shade always wins over the
// dimension. `null` means neutral (no color).
interface ZoneColor {
  readonly solid: string;
  readonly laneTint: string;
}

/** Palette accent names cycled by `color-by place`, in a pleasant rotation. */
const PLACE_ACCENTS = [
  'blue',
  'green',
  'orange',
  'purple',
  'teal',
  'red',
  'cyan',
];

interface ColorCtx {
  readonly up: boolean;
  readonly status: WorkStatus | null;
  readonly localHour: number;
  readonly sw: Swatches;
  readonly palette: PaletteColors;
  readonly cardFill: string;
}

/**
 * Resolve a zone's color for the active `color-by` dimension. A hand-set shade
 * wins; otherwise the dimension derives it. Returns `null` for neutral
 * (`color-by none`, or `work` with no working window).
 */
function resolveColorBy(
  mode: ClockColorBy,
  entry: ClockEntry,
  index: number,
  ctx: ColorCtx
): ZoneColor | null {
  if (entry.color)
    return { solid: entry.color, laneTint: mix(entry.color, ctx.cardFill, 14) };
  switch (mode) {
    case 'none':
      return null;
    case 'place': {
      const name = PLACE_ACCENTS[index % PLACE_ACCENTS.length]!;
      const c = resolveColor(name, ctx.palette) ?? ctx.sw.day;
      return { solid: c, laneTint: mix(c, ctx.cardFill, 14) };
    }
    case 'daylight':
      return ctx.up
        ? { solid: ctx.sw.day, laneTint: ctx.sw.dayTint }
        : { solid: ctx.sw.night, laneTint: ctx.sw.nightTint };
    case 'work': {
      if (!ctx.status) return null; // no working window → neutral
      const cls = ctx.status.cls;
      const solid =
        cls === 'ok' ? ctx.sw.ok : cls === 'soon' ? ctx.sw.soon : ctx.sw.off;
      const laneTint =
        cls === 'ok'
          ? ctx.sw.okSoft
          : cls === 'soon'
            ? ctx.sw.soonSoft
            : ctx.sw.offSoft;
      return { solid, laneTint };
    }
    case 'time':
      return {
        solid: rampColor(ctx.localHour),
        laneTint: mix(rampColor(ctx.localHour), ctx.cardFill, 14),
      };
  }
}

/** Per-render counter for unique clipPath ids (multiple clocks can share a page). */
let clipSeq = 0;

/** Rough advance width without a DOM layout pass (Inter ~0.58em; digits wider). */
function estWidth(t: string, fs: number): number {
  return t.length * fs * 0.6;
}

/** Largest font ≤ `base` (down to `min`) whose text fits `maxW`. */
function fitFont(t: string, base: number, maxW: number, min: number): number {
  const w = estWidth(t, base);
  return w <= maxW ? base : Math.max(min, Math.floor((base * maxW) / w));
}

/** Truncate `t` with an ellipsis so its estimated width fits `maxW`. */
function ellipsize(t: string, fs: number, maxW: number): string {
  if (maxW <= 0) return '';
  if (estWidth(t, fs) <= maxW) return t;
  let s = t;
  while (s.length > 0 && estWidth(`${s}…`, fs) > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

/** Greedy word-wrap into at most `maxLines` lines; overflow folds onto the last
 *  line and ellipsizes (so callers can detect an imperfect fit via a trailing …). */
function wrapText(
  t: string,
  fs: number,
  maxW: number,
  maxLines: number
): string[] {
  const words = t.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (estWidth(trial, fs) <= maxW) {
      cur = trial; // fits on the current line
    } else if (!cur) {
      cur = w; // a single word wider than the line — keep it (ellipsized later)
    } else if (lines.length + 1 < maxLines) {
      lines.push(cur); // start a new line
      cur = w;
    } else {
      cur = trial; // out of lines — let the last line overflow, ellipsized below
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => ellipsize(l, fs, maxW));
}

/** Baked sun (day) / crescent moon (night) glyph pair, toggled live by the ticker. */
function drawSunMoon(
  parent: Sel,
  cx: number,
  cy: number,
  up: boolean,
  sw: Swatches,
  scale = 1
): void {
  const icon = parent
    .append('g')
    .attr('data-dgmo-clock-sun-icon', '')
    .attr(
      'transform',
      scale === 1
        ? `translate(${cx},${cy})`
        : `translate(${cx},${cy}) scale(${scale})`
    ) as Sel;
  const sunG = icon
    .append('g')
    .attr('data-clock-glyph', 'sun')
    .attr('display', up ? 'inline' : 'none') as Sel;
  sunG.append('circle').attr('r', 2.5).attr('fill', sw.sunIcon);
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    sunG
      .append('line')
      .attr('x1', 3.2 * Math.cos(a))
      .attr('y1', 3.2 * Math.sin(a))
      .attr('x2', 4.6 * Math.cos(a))
      .attr('y2', 4.6 * Math.sin(a))
      .attr('stroke', sw.sunIcon)
      .attr('stroke-width', 1)
      .attr('stroke-linecap', 'round');
  }
  icon
    .append('g')
    .attr('data-clock-glyph', 'moon')
    .attr('display', up ? 'none' : 'inline')
    .append('path')
    .attr(
      'd',
      'M1.85,-3.32 A3.8,3.8 0 1,0 1.85,3.32 A3.4,3.4 0 0,1 1.85,-3.32 Z'
    )
    .attr('fill', sw.moonIcon);
}

/** Working-window bound → label matching the board's clock format (`9am`/`9`). */
function hourLabel(min: number, hours12: boolean): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const mm = m ? `:${String(m).padStart(2, '0')}` : '';
  if (!hours12) return `${h}${mm}`;
  const ap = h < 12 ? 'am' : 'pm';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${mm}${ap}`;
}

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon–Fri" when it's the classic work week, else a comma list. */
function daysLabel(days: Record<string, boolean>): string {
  const on = WEEKDAY_ABBR.filter((d) => days[d]);
  if (
    on.length === 5 &&
    days['Mon'] &&
    days['Fri'] &&
    !days['Sat'] &&
    !days['Sun']
  )
    return 'Mon–Fri';
  return on.join(', ');
}

export function renderClock(
  container: HTMLDivElement,
  parsed: ParsedClock,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const avail = exportDims?.width ?? container.clientWidth;
  const heightHint = exportDims?.height ?? container.clientHeight;
  if (avail <= 0) return;
  // Lay out at a comfortable intrinsic width, then let the viewBox + `meet`
  // scale the whole figure up or down to fill the panel (fitSvg). Clamping to a
  // floor stops narrow panels from cramping the columns into each other; a
  // ceiling stops wide panels from ballooning the clocks. Exports honor their
  // requested width verbatim.
  const cardM = 8;
  const baseWidth = Math.min(720, Math.max(460, avail));
  // Columns mode: hold each column at a readable intrinsic width and GROW the
  // canvas with the column count instead of cramming N columns into a fixed
  // 720. The viewBox `meet` (fitSvg / embed max-width) then scales the whole
  // board down into the panel — so past ~4 columns everything gets uniformly
  // smaller rather than clipping the detail text. `baseWidth` stays the floor
  // so a handful of columns still fill a wide panel. Exports keep their dims.
  const COL_MIN_W = 190;
  const width =
    exportDims?.width ??
    (parsed.columns
      ? Math.max(
          baseWidth,
          COL_MIN_W * Math.max(1, parsed.entries.length) + 2 * cardM
        )
      : baseWidth);

  const now = Date.now();
  const baseBg = themeBaseBg(palette, isDark);
  const muted = mix(palette.text, baseBg, 55);
  const faint = mix(palette.text, baseBg, 72);
  const line2 = mix(palette.text, palette.bg, 76);
  const cardFill = mix(palette.text, palette.bg, 8);
  const sw = buildSwatches(palette, muted);

  const padX = Math.max(20, Math.round(width * 0.04));
  const padY = 20;
  const rightX = width - padX;
  const rowH = 84;

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('role', 'img')
    .attr('aria-label', `${parsed.title ?? 'Clock'} — world clocks`)
    .style('font-family', FONT_FAMILY) as unknown as Sel;

  const bgRect = svg
    .append('rect')
    .attr('width', width)
    .attr('fill', palette.bg);

  // ── Container card: solid gray border + muted-gray fill behind everything.
  //    The card surface is purely decorative, so `fill-outline` empties it to
  //    the theme base bg (the gray border keeps carrying the frame). ──
  const card = svg
    .append('rect')
    .attr('x', cardM)
    .attr('y', cardM)
    .attr('width', width - 2 * cardM)
    .attr('rx', 14)
    .attr('fill', parsed.fillMode === 'outline' ? baseBg : cardFill)
    .attr('stroke', mix(palette.text, palette.bg, 40))
    .attr('stroke-width', 1);
  // Rounded clip so the row lanes can tile flush to the card edges (no gray
  // strips above/below the colored rows) without square corners poking out.
  clipSeq += 1;
  const clipId = `dgmo-clock-clip-${clipSeq}`;
  const clipRect = svg
    .append('clipPath')
    .attr('id', clipId)
    .append('rect')
    .attr('x', cardM)
    .attr('y', cardM)
    .attr('width', width - 2 * cardM)
    .attr('rx', 14);

  // Lanes (color-by, or a hand-set per-zone shade) tile flush to the card
  // edges. Without a title there is no top rule to bound them, so the rows must
  // start at the card edge — otherwise a gray strip shows above the first lane.
  const anyLane =
    parsed.colorBy !== 'none' || parsed.entries.some((e) => e.color);
  const hasTitle = Boolean(parsed.title && !parsed.noTitle);

  // ── Title block (suppressed entirely by `no-title`, summary included). ──
  let y = padY;
  if (parsed.title && !parsed.noTitle) {
    const titleFont = 20;
    // Static working-window summary, right-aligned (does not tick). Measure it
    // first so the title truncates before it collides with the summary.
    const meta = parsed.work
      ? `${hourLabel(parsed.work.startMin, parsed.hours12)}–${hourLabel(parsed.work.endMin, parsed.hours12)} · ${daysLabel(parsed.work.days)}`
      : null;
    const metaW = meta ? estWidth(meta, 12) + 16 : 0;
    svg
      .append('text')
      .attr('x', padX)
      .attr('y', y + titleFont)
      .attr('fill', palette.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', titleFont)
      .attr('font-weight', 650)
      .attr('data-line-number', parsed.titleLineNumber)
      .text(ellipsize(parsed.title, titleFont, rightX - padX - metaW));
    if (meta) {
      svg
        .append('text')
        .attr('x', rightX)
        .attr('y', y + titleFont - 3)
        .attr('text-anchor', 'end')
        .attr('fill', faint)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', 12)
        .attr('font-weight', 500)
        .text(meta);
    }
    y += titleFont + 12;
    // Edge-to-edge rule under the title (spans the full container width).
    svg
      .append('line')
      .attr('x1', cardM)
      .attr('x2', width - cardM)
      .attr('y1', y)
      .attr('y2', y)
      .attr('stroke', mix(palette.text, palette.bg, 22))
      .attr('stroke-width', 1);
    y += 1;
  }

  // No title + lanes → hug the card top so the first lane tiles flush; every
  // other case keeps the padded/rule-anchored start.
  const rowsTop = !hasTitle && anyLane ? cardM : y;
  // Rows live in a clipped group so their lane tints tile flush to the rounded
  // card without square corners escaping it.
  const body = svg.append('g').attr('clip-path', `url(#${clipId})`) as Sel;

  const col: Colors = {
    text: palette.text,
    muted,
    faint,
    line2,
    tick: mix(palette.text, palette.bg, 35),
    cardFill,
    baseBg,
    fillMode: parsed.fillMode,
    sw,
    palette,
  };

  let bannerH: number;
  if (parsed.columns) {
    bannerH = drawColumns(body, parsed, now, rowsTop, { width, cardM }, col);
  } else {
    // Uniform left column so every middle column starts at the SAME x. For
    // digital we also find the widest HH:MM ("mainW").
    let leftColW = rowH - 20; // analog dial diameter
    let mainW = 0;
    if (parsed.face === 'digital') {
      let secW = 0;
      for (const e of parsed.entries) {
        const p = partsFor(e, now);
        const t = formatTime(p.h, p.m, p.s, parsed.hours12);
        mainW = Math.max(mainW, estWidth(t.main, 48));
        secW = Math.max(secW, estWidth(`:${t.sec}`, 16), estWidth(t.ap, 16));
      }
      leftColW = Math.max(92, mainW + 5 + secW);
    }
    parsed.entries.forEach((entry, i) => {
      drawRow(
        body,
        entry,
        i,
        parsed,
        now,
        rowsTop + i * rowH,
        rowH,
        { padX, rightX, width, leftColW, mainW },
        col
      );
    });
    // With colored lanes the last row sits flush to the card's bottom edge so
    // the tint tiles corner-to-corner. Without lanes, mirror the top margin
    // (padY) below the rows so the block centers vertically in the card.
    const rowsBottom = rowsTop + parsed.entries.length * rowH;
    // Auto-color paints lanes on every row (except `off`); an explicit shade
    // does too. Either way the lanes should tile flush to the card bottom.
    const bottomMargin = anyLane ? cardM : padY;
    bannerH = Math.max(rowsBottom + bottomMargin, heightHint > 0 ? 0 : 120);
  }
  clipRect.attr('height', bannerH - 2 * cardM);
  svg.attr('height', bannerH).attr('viewBox', `0 0 ${width} ${bannerH}`);
  bgRect.attr('height', bannerH);
  card.attr('height', bannerH - 2 * cardM);
}

interface Geom {
  readonly padX: number;
  readonly rightX: number;
  readonly width: number;
  /** Uniform left-column width shared by every row so middles line up. */
  readonly leftColW: number;
  /** Widest HH:MM — the minutes seam digital times are right-anchored to. */
  readonly mainW: number;
}
interface Colors {
  readonly text: string;
  readonly muted: string;
  readonly faint: string;
  readonly line2: string;
  readonly tick: string;
  readonly cardFill: string;
  /** Theme base bg — the fill decorative surfaces empty to under `fill-outline`. */
  readonly baseBg: string;
  /** §1.9 fill family; undefined ⇒ canonical tints. */
  readonly fillMode: 'solid' | 'outline' | undefined;
  readonly sw: Swatches;
  readonly palette: PaletteColors;
}

/**
 * The §1.9 fill mode a zone's surfaces honor — only DECORATIVE identity tints
 * restyle (a hand-set shade, or the default `color-by place` accents). The
 * work / daylight / time dimensions (and the no-auto day/night face tint)
 * ENCODE LIVE STATE in their fills, so they ignore the family; status dots and
 * the sun/moon glyphs are state too and always stay filled.
 */
function zoneFillMode(
  entry: ClockEntry,
  parsed: ParsedClock,
  col: Colors
): 'solid' | 'outline' | undefined {
  return entry.color || parsed.colorBy === 'place' ? col.fillMode : undefined;
}

function drawRow(
  svg: Sel,
  entry: ClockEntry,
  index: number,
  parsed: ParsedClock,
  now: number,
  rowTop: number,
  rowH: number,
  geom: Geom,
  col: Colors
): void {
  const { padX } = geom;
  const { text, muted, line2, tick, sw, cardFill } = col;
  const center = rowTop + rowH / 2;

  // ── Compute display state from the shared resolver (the no-JS floor). ──
  const parts = partsFor(entry, now);
  const hasCoords = entry.lat !== null && entry.lon !== null;
  const sun =
    parsed.sun && hasCoords ? sunLine(now, entry.lat!, entry.lon!) : null;
  const up = sun ? sun.up : parts.h >= 6 && parts.h < 18;
  const stColor = up ? sw.day : sw.night;
  const stTint = up ? sw.dayTint : sw.nightTint;
  const ts = formatTime(parts.h, parts.m, parts.s, parsed.hours12);
  const work: WorkSpec | null = parsed.work
    ? {
        startMin: parsed.work.startMin,
        endMin: parsed.work.endMin,
        days: parsed.work.days,
      }
    : null;
  const status = workStatus(parts, work);
  const auto = resolveColorBy(parsed.colorBy, entry, index, {
    up,
    status,
    localHour: parts.h,
    sw,
    palette: col.palette,
    cardFill,
  });

  // The right column is a fixed-width detail stack (place · availability ·
  // sundown), left-aligned so its icons and text form clean columns.
  const rightBlockW = 178;
  const rightColLeft = geom.rightX - rightBlockW;

  // §1.9 fill family — applies to this row's decorative surfaces only.
  const fm = zoneFillMode(entry, parsed, col);

  // ── Row group (carries all the ticker anchors). ──
  const g = svg.append('g').attr('data-line-number', entry.lineNumber) as Sel;
  // Per-row swimlane tint — a faint wash of the resolved color (explicit shade
  // or auto mode), drawn first so it sits behind the content. 9 = card inset.
  // `fill-outline` empties the decorative wash to the base bg (the identity
  // color still rides the time/label text and the dial ring).
  if (auto) {
    g.append('rect')
      .attr('data-dgmo-clock-lane', '')
      .attr('x', 9)
      .attr('y', rowTop)
      .attr('width', geom.width - 18)
      .attr('height', rowH)
      .attr('fill', fm === 'outline' ? col.baseBg : auto.laneTint);
  }
  g.attr('data-dgmo-clock', '')
    .attr('data-dgmo-clock-zone', entry.zone)
    .attr('data-dgmo-clock-face', parsed.face)
    .attr('data-dgmo-clock-hours12', parsed.hours12 ? '1' : '0')
    .attr('data-dgmo-clock-sun', sun ? '1' : '0')
    // Baked palette swatches — the ticker is palette-blind, so recolors read these.
    .attr('data-dgmo-clock-c-day', sw.day)
    .attr('data-dgmo-clock-c-night', sw.night)
    .attr('data-dgmo-clock-c-day-soft', sw.dayTint)
    .attr('data-dgmo-clock-c-night-soft', sw.nightTint)
    .attr('data-dgmo-clock-c-ok', sw.ok)
    .attr('data-dgmo-clock-c-soon', sw.soon)
    .attr('data-dgmo-clock-c-off', sw.off)
    .attr('data-dgmo-clock-c-ok-soft', sw.okSoft)
    .attr('data-dgmo-clock-c-soon-soft', sw.soonSoft)
    .attr('data-dgmo-clock-c-off-soft', sw.offSoft);
  if (entry.lat !== null) g.attr('data-dgmo-clock-lat', entry.lat);
  if (entry.lon !== null) g.attr('data-dgmo-clock-lon', entry.lon);
  // A fixed UTC offset ticks off UTC+offset, not an IANA zone — the ticker
  // branches on this attr so it never asks `Intl` about a synthetic zone name.
  if (entry.kind === 'fixed')
    g.attr('data-dgmo-clock-fixed-offset', entry.fixedOffsetMin ?? 0);
  if (parsed.work) {
    g.attr('data-dgmo-clock-work-start', parsed.work.startMin)
      .attr('data-dgmo-clock-work-end', parsed.work.endMin)
      .attr(
        'data-dgmo-clock-work-days',
        WEEKDAY_ABBR.filter((d) => parsed.work!.days[d]).join(',')
      );
  }

  const contentLeft = padX + 4;
  // Solid coloring of the reading itself (time + label + dial accents).
  // Decorative dial faces follow the fill family: `fill-outline` empties the
  // face to the base bg (the intent color stays on the ring/second hand);
  // `fill-solid` saturates it fully. Day/night state tints (no auto) keep.
  const timeColor = auto?.solid ?? text;
  const faceFill =
    auto && fm === 'outline'
      ? col.baseBg
      : auto && fm === 'solid'
        ? auto.solid
        : auto
          ? mix(auto.solid, cardFill, 20)
          : stTint;
  const ringColor = auto?.solid ?? line2;
  // On a full-saturation face the text-colored hands would vanish — hands and
  // the center dot swap to contrast ink under `fill-solid`.
  const handInk =
    auto && fm === 'solid'
      ? contrastText(
          auto.solid,
          col.palette.textOnFillLight,
          col.palette.textOnFillDark
        )
      : text;
  const accentColor =
    auto && fm === 'solid' ? handInk : (auto?.solid ?? stColor);
  // Bake the resolved color so the ticker repaints analog dials with it rather
  // than reverting facebg/second-hand to day/night on every tick.
  if (auto) {
    g.attr('data-dgmo-clock-auto-solid', auto.solid)
      .attr('data-dgmo-clock-auto-face', faceFill)
      .attr('data-dgmo-clock-auto-mode', parsed.colorBy)
      .attr('data-dgmo-clock-cardfill', cardFill);
  }
  // Mark restyled rows so the ticker keeps the baked fills instead of
  // re-deriving the tint wash on every tick.
  if (fm) g.attr('data-dgmo-clock-fill-mode', fm);

  if (parsed.face === 'analog') {
    // Analog dial — a scaled 0-100 group so hand rotates use the mockup's "50 50".
    const size = rowH - 20;
    const fx = contentLeft;
    const fy = center - size / 2;
    const fg = g
      .append('g')
      .attr('transform', `translate(${fx},${fy}) scale(${size / 100})`) as Sel;
    fg.append('circle')
      .attr('data-dgmo-clock-facebg', '')
      .attr('cx', 50)
      .attr('cy', 50)
      .attr('r', 47)
      .attr('fill', faceFill);
    fg.append('circle')
      .attr('data-dgmo-clock-facering', '')
      .attr('cx', 50)
      .attr('cy', 50)
      .attr('r', 47)
      .attr('fill', 'none')
      .attr('stroke', ringColor)
      .attr('stroke-width', auto ? 1.6 : 1.4);
    for (let k = 0; k < 12; k++) {
      const a = (k * 30 * Math.PI) / 180;
      fg.append('line')
        .attr('x1', 50 + 39 * Math.sin(a))
        .attr('y1', 50 - 39 * Math.cos(a))
        .attr('x2', 50 + 46 * Math.sin(a))
        .attr('y2', 50 - 46 * Math.cos(a))
        .attr('stroke', tick)
        .attr('stroke-width', 1.8);
    }
    const ang = handAngles(parts.h, parts.m, parts.s);
    fg.append('line')
      .attr('data-dgmo-clock-hand', 'h')
      .attr('x1', 50)
      .attr('y1', 50)
      .attr('x2', 50)
      .attr('y2', 28)
      .attr('stroke', handInk)
      .attr('stroke-width', 4)
      .attr('stroke-linecap', 'round')
      .attr('transform', `rotate(${ang.hour} 50 50)`);
    fg.append('line')
      .attr('data-dgmo-clock-hand', 'm')
      .attr('x1', 50)
      .attr('y1', 50)
      .attr('x2', 50)
      .attr('y2', 17)
      .attr('stroke', handInk)
      .attr('stroke-width', 2.6)
      .attr('stroke-linecap', 'round')
      .attr('transform', `rotate(${ang.minute} 50 50)`);
    fg.append('line')
      .attr('data-dgmo-clock-hand', 's')
      .attr('x1', 50)
      .attr('y1', 55)
      .attr('x2', 50)
      .attr('y2', 14)
      .attr('stroke', accentColor)
      .attr('stroke-width', 1.3)
      .attr('stroke-linecap', 'round')
      .attr('transform', `rotate(${ang.second} 50 50)`);
    fg.append('circle')
      .attr('data-dgmo-clock-center', '')
      .attr('cx', 50)
      .attr('cy', 50)
      .attr('r', 2.6)
      .attr('fill', accentColor);
  } else {
    // Digital readout — big left-aligned time. Seconds + am/pm ride in a tight
    // stack hugging the minutes: seconds cap-aligned to the TOP of the digits,
    // am/pm baseline-aligned to their BOTTOM, so the trio reads as one unit.
    const mainFont = 48;
    const baseY = center + 16;
    const capTop = baseY - mainFont * 0.7;
    const sf = 20;
    // Pin the digits to an exact advance so the :SS / am-pm stack always hugs
    // them. Per-surface shaping diverges — the browser honours tabular-nums
    // (uniform ~0.6em figures) while resvg ignores it and shapes proportional
    // ('1'≈0.43em, '4'≈0.68em) — so no fixed em estimate can anchor the stack on
    // both. `textLength` forces every renderer to this width; the estimate just
    // needs to sit near the tabular natural width to keep distortion tiny.
    const mainW = [...ts.main].reduce(
      (w, c) => w + mainFont * (c === ':' ? 0.334 : 0.6),
      0
    );
    const stackX = contentLeft + mainW + 5;
    g.append('text')
      .attr('data-dgmo-clock-digital', '')
      .attr('data-dgmo-clock-digital-part', 'main')
      .attr('x', contentLeft)
      .attr('y', baseY)
      .attr('fill', timeColor)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', mainFont)
      .attr('font-weight', 600)
      .attr('textLength', mainW)
      .attr('lengthAdjust', 'spacing')
      .style('font-variant-numeric', 'tabular-nums')
      .text(ts.main);
    g.append('text')
      .attr('data-dgmo-clock-digital-part', 'sec')
      .attr('x', stackX)
      .attr('y', capTop + sf * 0.72)
      .attr('fill', muted)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', sf)
      .attr('font-weight', 600)
      .style('font-variant-numeric', 'tabular-nums')
      .text(`:${ts.sec}`);
    if (ts.ap)
      g.append('text')
        .attr('data-dgmo-clock-digital-part', 'ap')
        .attr('x', stackX)
        .attr('y', baseY)
        .attr('fill', muted)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', sf)
        .attr('font-weight', 600)
        .text(ts.ap);
  }

  // ── Middle: the alias (identity). Big and bold; long names shrink + wrap to
  //    two lines rather than truncate. ──
  const midLeft = contentLeft + geom.leftColW + 26;
  const midMaxW = Math.max(40, rightColLeft - 12 - midLeft);
  // Make the alias as big as the time when it fits; step the font down (and
  // allow more wrapped lines) only as the text demands. The chosen font is the
  // largest that fits the full name in the vertical room a bigger line eats up.
  const availH = rowH - 12;
  const ladder = [48, 40, 34, 28, 24, 20, 17];
  let aliasFont = 17;
  let aliasLines: string[] = [];
  for (const f of ladder) {
    const maxLines = Math.max(1, Math.floor(availH / (f + 4)));
    const ls = wrapText(entry.label, f, midMaxW, maxLines);
    if (!ls.some((l) => l.endsWith('…'))) {
      aliasFont = f;
      aliasLines = ls;
      break;
    }
  }
  if (aliasLines.length === 0) {
    const maxLines = Math.max(1, Math.floor(availH / 21));
    aliasLines = wrapText(entry.label, 17, midMaxW, maxLines);
  }
  const aliasLh = aliasFont + 4;
  // A single-line alias shares the time's baseline (center+16) so the name and
  // the time sit on one line; multi-line blocks stay centered on the row.
  const firstBase =
    aliasLines.length === 1
      ? center + 16
      : center - (aliasLines.length * aliasLh) / 2 + aliasFont * 0.72;
  // The bigger the display, the more muted — big + jet-black reads as shouting.
  // Auto/explicit color paints the label solid; else the muted-by-size default.
  const aliasFill =
    auto?.solid ?? mix(muted, text, Math.round(((aliasFont - 17) / 31) * 55));
  aliasLines.forEach((ln, i) => {
    g.append('text')
      .attr('x', midLeft)
      .attr('y', firstBase + i * aliasLh)
      .attr('fill', aliasFill)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', aliasFont)
      .attr('font-weight', 650)
      .text(ln);
  });

  // ── Right: a left-aligned detail stack — place, then availability, then
  //    sundown — with an icon column so everything lines up. ──
  const iconX = rightColLeft + 6;
  const textX = rightColLeft + 20;
  const textMax = geom.rightX - textX;
  interface Line {
    readonly kind: 'place' | 'avail' | 'sun' | 'fixed';
  }
  const lines: Line[] = [];
  // A fixed offset gets a "no DST" note instead of a place pin (it isn't a
  // place); a real zone shows its city when the alias differs from it.
  if (entry.kind === 'fixed') lines.push({ kind: 'fixed' });
  else if (entry.label !== entry.place) lines.push({ kind: 'place' });
  if (status) lines.push({ kind: 'avail' });
  if (sun) lines.push({ kind: 'sun' });
  const lh = 23;
  // Center the detail stack on the time's baseline so its bullets line up with
  // the big time/alias line.
  const top = center + 10 - ((lines.length - 1) * lh) / 2;

  lines.forEach((ln, i) => {
    const yy = top + i * lh;
    if (ln.kind === 'place') {
      // Map-pin glyph (teardrop) in the icon column.
      g.append('path')
        .attr('transform', `translate(${iconX},${yy - 5}) scale(1.25)`)
        .attr('d', 'M0,4 L-2.3,-0.6 A2.6,2.6 0 1 1 2.3,-0.6 Z')
        .attr('fill', muted);
      g.append('text')
        .attr('x', textX)
        .attr('y', yy)
        .attr('fill', muted)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', 14)
        .attr('font-weight', 500)
        .text(ellipsize(entry.place, 14, textMax));
    } else if (ln.kind === 'avail' && status) {
      const stCol =
        status.cls === 'ok' ? sw.ok : status.cls === 'soon' ? sw.soon : sw.off;
      drawStatusClock(g, iconX, yy - 5, 5, stCol);
      g.append('text')
        .attr('data-dgmo-clock-status', '')
        .attr('x', textX)
        .attr('y', yy)
        .attr('fill', stCol)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', 14)
        .attr('font-weight', 600)
        .text(ellipsize(status.text, 14, textMax));
    } else if (ln.kind === 'sun' && sun) {
      drawSunMoon(g, iconX, yy - 5, up, sw, 1.25);
      g.append('text')
        .attr('data-dgmo-clock-sun-line', '')
        .attr('x', textX)
        .attr('y', yy)
        .attr('fill', muted)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', 13.5)
        .text(ellipsize(sun.text, 13.5, textMax));
    } else if (ln.kind === 'fixed') {
      drawFixedGlyph(g, iconX, yy - 5, muted);
      g.append('text')
        .attr('x', textX)
        .attr('y', yy)
        .attr('fill', muted)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', 13.5)
        .text(ellipsize(`${entry.place} · no DST`, 13.5, textMax));
    }
  });
}

/** A small "fixed offset" glyph — a snowflake-ish asterisk marking a no-DST row. */
function drawFixedGlyph(
  parent: Sel,
  cx: number,
  cy: number,
  color: string
): void {
  const g = parent
    .append('g')
    .attr('transform', `translate(${cx},${cy})`) as Sel;
  for (let k = 0; k < 3; k++) {
    const a = (k * 60 * Math.PI) / 180;
    g.append('line')
      .attr('x1', -4 * Math.cos(a))
      .attr('y1', -4 * Math.sin(a))
      .attr('x2', 4 * Math.cos(a))
      .attr('y2', 4 * Math.sin(a))
      .attr('stroke', color)
      .attr('stroke-width', 1.2)
      .attr('stroke-linecap', 'round');
  }
}

/** Filled status dot marking the availability line, coloured by work state
 *  (ok/soon/off). The ticker recolours it live via `data-dgmo-clock-status-icon`.
 *  Shared by clock rows/cols and the map card so both read identically. */
function drawStatusClock(
  parent: Sel,
  cx: number,
  cy: number,
  r: number,
  color: string
): void {
  parent
    .append('circle')
    .attr('data-dgmo-clock-status-icon', '')
    .attr('cx', cx)
    .attr('cy', cy)
    .attr('r', r)
    .attr('fill', color);
}

/** Bake the ticker anchors (zone/face/state + palette swatches) onto a row/col group. */
function bakeAnchors(
  g: Sel,
  entry: ClockEntry,
  parsed: ParsedClock,
  sun: { up: boolean } | null,
  sw: Swatches
): void {
  g.attr('data-dgmo-clock', '')
    .attr('data-dgmo-clock-zone', entry.zone)
    .attr('data-dgmo-clock-face', parsed.face)
    .attr('data-dgmo-clock-hours12', parsed.hours12 ? '1' : '0')
    .attr('data-dgmo-clock-sun', sun ? '1' : '0')
    .attr('data-dgmo-clock-c-day', sw.day)
    .attr('data-dgmo-clock-c-night', sw.night)
    .attr('data-dgmo-clock-c-day-soft', sw.dayTint)
    .attr('data-dgmo-clock-c-night-soft', sw.nightTint)
    .attr('data-dgmo-clock-c-ok', sw.ok)
    .attr('data-dgmo-clock-c-soon', sw.soon)
    .attr('data-dgmo-clock-c-off', sw.off)
    .attr('data-dgmo-clock-c-ok-soft', sw.okSoft)
    .attr('data-dgmo-clock-c-soon-soft', sw.soonSoft)
    .attr('data-dgmo-clock-c-off-soft', sw.offSoft);
  if (entry.lat !== null) g.attr('data-dgmo-clock-lat', entry.lat);
  if (entry.lon !== null) g.attr('data-dgmo-clock-lon', entry.lon);
  // A fixed UTC offset ticks off UTC+offset, not an IANA zone — the ticker
  // branches on this attr so it never asks `Intl` about a synthetic zone name.
  if (entry.kind === 'fixed')
    g.attr('data-dgmo-clock-fixed-offset', entry.fixedOffsetMin ?? 0);
  if (parsed.work) {
    g.attr('data-dgmo-clock-work-start', parsed.work.startMin)
      .attr('data-dgmo-clock-work-end', parsed.work.endMin)
      .attr(
        'data-dgmo-clock-work-days',
        WEEKDAY_ABBR.filter((d) => parsed.work!.days[d]).join(',')
      );
  }
}

/** `direction lr` — entries as vertical columns (time on top, details below). */
function drawColumns(
  body: Sel,
  parsed: ParsedClock,
  now: number,
  top: number,
  geom: { width: number; cardM: number },
  col: Colors
): number {
  const { width, cardM } = geom;
  const { text, muted, line2, tick, cardFill, sw } = col;
  const n = Math.max(1, parsed.entries.length);
  const colW = (width - 2 * cardM) / n;
  const tints: Sel[] = []; // heights set once the tallest column is known
  let maxBottom = top;
  // Detail lists (place · availability · sundown) are drawn in a second pass so
  // they bottom-align across columns: a column whose title wraps to two lines
  // must not push its icon list below the others. Every list starts at the
  // deepest post-alias Y, so the lists sit on one row regardless of title wrap.
  const deferred: { kinds: number; draw: (startY: number) => void }[] = [];
  let detailTop = top;

  parsed.entries.forEach((entry, i) => {
    const x0 = cardM + i * colW;
    const cx = x0 + colW / 2;
    const parts = partsFor(entry, now);
    const hasCoords = entry.lat !== null && entry.lon !== null;
    const sun =
      parsed.sun && hasCoords ? sunLine(now, entry.lat!, entry.lon!) : null;
    const up = sun ? sun.up : parts.h >= 6 && parts.h < 18;
    const ts = formatTime(parts.h, parts.m, parts.s, parsed.hours12);
    const work: WorkSpec | null = parsed.work
      ? {
          startMin: parsed.work.startMin,
          endMin: parsed.work.endMin,
          days: parsed.work.days,
        }
      : null;
    const status = workStatus(parts, work);
    const stColor = up ? sw.day : sw.night;
    const stTint = up ? sw.dayTint : sw.nightTint;
    const auto = resolveColorBy(parsed.colorBy, entry, i, {
      up,
      status,
      localHour: parts.h,
      sw,
      palette: col.palette,
      cardFill,
    });
    // §1.9 fill family — decorative surfaces only (see zoneFillMode).
    const fm = zoneFillMode(entry, parsed, col);
    const timeColor = auto?.solid ?? text;
    const faceFill =
      auto && fm === 'outline'
        ? col.baseBg
        : auto && fm === 'solid'
          ? auto.solid
          : auto
            ? mix(auto.solid, cardFill, 20)
            : stTint;
    const ringColor = auto?.solid ?? line2;
    const handInk =
      auto && fm === 'solid'
        ? contrastText(
            auto.solid,
            col.palette.textOnFillLight,
            col.palette.textOnFillDark
          )
        : text;
    const accentColor =
      auto && fm === 'solid' ? handInk : (auto?.solid ?? stColor);
    const g = body
      .append('g')
      .attr('data-line-number', entry.lineNumber) as Sel;
    bakeAnchors(g, entry, parsed, sun, sw);
    // Column tint is g's first child so it sits behind the content and the
    // ticker can find it via the row group (`data-dgmo-clock`).
    if (auto)
      tints.push(
        g
          .append('rect')
          .attr('data-dgmo-clock-lane', '')
          .attr('x', x0)
          .attr('y', top)
          .attr('width', colW)
          .attr('fill', fm === 'outline' ? col.baseBg : auto.laneTint) as Sel
      );
    if (auto) {
      g.attr('data-dgmo-clock-auto-solid', auto.solid)
        .attr('data-dgmo-clock-auto-face', faceFill)
        .attr('data-dgmo-clock-auto-mode', parsed.colorBy)
        .attr('data-dgmo-clock-cardfill', cardFill);
    }
    if (fm) g.attr('data-dgmo-clock-fill-mode', fm);

    // Digital needs breathing room under the title rule; the analog dial reads
    // fine sitting higher (its own padding is baked into the face).
    let cy = top + (parsed.face === 'analog' ? 22 : 36);
    const innerW = colW - 16;

    if (parsed.face === 'analog') {
      const size = Math.min(innerW, 96);
      const fg = g
        .append('g')
        .attr(
          'transform',
          `translate(${cx - size / 2},${cy}) scale(${size / 100})`
        ) as Sel;
      fg.append('circle')
        .attr('data-dgmo-clock-facebg', '')
        .attr('cx', 50)
        .attr('cy', 50)
        .attr('r', 47)
        .attr('fill', faceFill);
      fg.append('circle')
        .attr('data-dgmo-clock-facering', '')
        .attr('cx', 50)
        .attr('cy', 50)
        .attr('r', 47)
        .attr('fill', 'none')
        .attr('stroke', ringColor)
        .attr('stroke-width', auto ? 1.6 : 1.4);
      for (let k = 0; k < 12; k++) {
        const a = (k * 30 * Math.PI) / 180;
        fg.append('line')
          .attr('x1', 50 + 39 * Math.sin(a))
          .attr('y1', 50 - 39 * Math.cos(a))
          .attr('x2', 50 + 46 * Math.sin(a))
          .attr('y2', 50 - 46 * Math.cos(a))
          .attr('stroke', tick)
          .attr('stroke-width', 1.8);
      }
      const ang = handAngles(parts.h, parts.m, parts.s);
      fg.append('line')
        .attr('data-dgmo-clock-hand', 'h')
        .attr('x1', 50)
        .attr('y1', 50)
        .attr('x2', 50)
        .attr('y2', 28)
        .attr('stroke', handInk)
        .attr('stroke-width', 4)
        .attr('stroke-linecap', 'round')
        .attr('transform', `rotate(${ang.hour} 50 50)`);
      fg.append('line')
        .attr('data-dgmo-clock-hand', 'm')
        .attr('x1', 50)
        .attr('y1', 50)
        .attr('x2', 50)
        .attr('y2', 17)
        .attr('stroke', handInk)
        .attr('stroke-width', 2.6)
        .attr('stroke-linecap', 'round')
        .attr('transform', `rotate(${ang.minute} 50 50)`);
      fg.append('line')
        .attr('data-dgmo-clock-hand', 's')
        .attr('x1', 50)
        .attr('y1', 55)
        .attr('x2', 50)
        .attr('y2', 14)
        .attr('stroke', accentColor)
        .attr('stroke-width', 1.3)
        .attr('stroke-linecap', 'round')
        .attr('transform', `rotate(${ang.second} 50 50)`);
      fg.append('circle')
        .attr('data-dgmo-clock-center', '')
        .attr('cx', 50)
        .attr('cy', 50)
        .attr('r', 2.6)
        .attr('fill', accentColor);
      cy += size + 6;
    } else {
      // Big HH:MM with a stack to its right — seconds hug the digits' TOP, am/pm
      // hug their BOTTOM (baseline), so the trio reads as one block. Whole group
      // centered in the column.
      const sf = 22;
      const gap = 11; // horizontal breathing room between digits and the stack
      const cap = 0.7; // Inter figure cap-height as a fraction of font size
      const tf = fitFont(ts.main, 54, innerW - 30 - gap, 20);
      // Pin the digits to an exact advance so the stack always hugs them —
      // `textLength` overrides the per-surface shaping split (browser tabular
      // ~0.6em vs resvg proportional). The estimate only sets the target width.
      const mainW = [...ts.main].reduce(
        (w, c) => w + tf * (c === ':' ? 0.334 : 0.6),
        0
      );
      const stackW = Math.max(estWidth(`:${ts.sec}`, sf), estWidth(ts.ap, sf));
      const gLeft = cx - (mainW + gap + stackW) / 2;
      const baseY = cy + tf * 0.34;
      g.append('text')
        .attr('data-dgmo-clock-digital', '')
        .attr('data-dgmo-clock-digital-part', 'main')
        .attr('x', gLeft)
        .attr('y', baseY)
        .attr('fill', timeColor)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', tf)
        .attr('font-weight', 600)
        .attr('textLength', mainW)
        .attr('lengthAdjust', 'spacing')
        .style('font-variant-numeric', 'tabular-nums')
        .text(ts.main);
      const stackX = gLeft + mainW + gap;
      // Seconds baseline sits `sf·cap` below the digit top → its cap top aligns
      // with the digits' top.
      g.append('text')
        .attr('data-dgmo-clock-digital-part', 'sec')
        .attr('x', stackX)
        .attr('y', baseY - tf * cap + sf * cap)
        .attr('fill', muted)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', sf)
        .attr('font-weight', 500)
        .text(`:${ts.sec}`);
      if (ts.ap)
        g.append('text')
          .attr('data-dgmo-clock-digital-part', 'ap')
          .attr('x', stackX)
          .attr('y', baseY)
          .attr('fill', muted)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', sf)
          .attr('font-weight', 500)
          .text(ts.ap);
      cy += tf + 8;
    }

    // Alias — centered, scaled to the column, wrapped.
    const amax = colW - 14;
    let af = 14;
    let alines: string[] = [];
    for (const f of [26, 22, 19, 16, 14]) {
      const ml = Math.max(1, Math.floor(70 / (f + 3)));
      const ls = wrapText(entry.label, f, amax, ml);
      if (!ls.some((l) => l.endsWith('…'))) {
        af = f;
        alines = ls;
        break;
      }
    }
    if (!alines.length) alines = wrapText(entry.label, 14, amax, 3);
    const alh = af + 3;
    const aFill =
      auto?.solid ?? mix(muted, text, Math.round(((af - 14) / 12) * 55));
    alines.forEach((ln, j) =>
      g
        .append('text')
        .attr('x', cx)
        .attr('y', cy + af * 0.72 + j * alh)
        .attr('text-anchor', 'middle')
        .attr('fill', aFill)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', af)
        .attr('font-weight', 650)
        .text(ln)
    );
    cy += alines.length * alh + 12;

    // Details — place · availability · sundown, left-aligned with an icon
    // column. Deferred to a second pass so every column's list starts at the
    // same Y (bottom-aligned; see `deferred` above).
    const kinds: string[] = [];
    if (entry.kind === 'fixed') kinds.push('fixed');
    else if (entry.label !== entry.place) kinds.push('place');
    if (status) kinds.push('avail');
    if (sun) kinds.push('sun');
    const iconX = x0 + 16;
    const textX = x0 + 28;
    const tmax = colW - 40;
    deferred.push({
      kinds: kinds.length,
      draw: (startY: number) => {
        kinds.forEach((kind, j) => {
          const yy = startY + j * 20;
          if (kind === 'place') {
            g.append('path')
              .attr('transform', `translate(${iconX},${yy - 4})`)
              .attr('d', 'M0,4 L-2.3,-0.6 A2.6,2.6 0 1 1 2.3,-0.6 Z')
              .attr('fill', muted);
            g.append('text')
              .attr('x', textX)
              .attr('y', yy)
              .attr('fill', muted)
              .attr('font-family', FONT_FAMILY)
              .attr('font-size', 12)
              .text(ellipsize(entry.place, 12, tmax));
          } else if (kind === 'avail' && status) {
            const stCol =
              status.cls === 'ok'
                ? sw.ok
                : status.cls === 'soon'
                  ? sw.soon
                  : sw.off;
            drawStatusClock(g, iconX, yy - 4, 4, stCol);
            g.append('text')
              .attr('data-dgmo-clock-status', '')
              .attr('x', textX)
              .attr('y', yy)
              .attr('fill', stCol)
              .attr('font-family', FONT_FAMILY)
              .attr('font-size', 12)
              .attr('font-weight', 600)
              .text(ellipsize(status.text, 12, tmax));
          } else if (kind === 'sun' && sun) {
            drawSunMoon(g, iconX, yy - 4, up, sw, 1);
            g.append('text')
              .attr('data-dgmo-clock-sun-line', '')
              .attr('x', textX)
              .attr('y', yy)
              .attr('fill', muted)
              .attr('font-family', FONT_FAMILY)
              .attr('font-size', 11.5)
              .text(ellipsize(sun.text, 11.5, tmax));
          } else if (kind === 'fixed') {
            drawFixedGlyph(g, iconX, yy - 4, muted);
            g.append('text')
              .attr('x', textX)
              .attr('y', yy)
              .attr('fill', muted)
              .attr('font-family', FONT_FAMILY)
              .attr('font-size', 11.5)
              .text(ellipsize(`${entry.place} · no DST`, 11.5, tmax));
          }
        });
      },
    });
    if (cy > detailTop) detailTop = cy;
  });

  // Second pass: draw every detail list at the common (deepest) start Y.
  deferred.forEach((d) => {
    d.draw(detailTop);
    const bottom = d.kinds ? detailTop + (d.kinds - 1) * 20 + 8 : detailTop;
    if (bottom > maxBottom) maxBottom = bottom;
  });

  const colBodyH = maxBottom - top + 14;
  tints.forEach((r) => r.attr('height', colBodyH));
  // Subtle vertical dividers between columns — same shade as the card border,
  // sitting on the seam between adjacent lane tints.
  const dividerColor = mix(col.palette.text, col.palette.bg, 40);
  for (let i = 1; i < n; i++) {
    const x = cardM + i * colW;
    body
      .append('line')
      .attr('data-dgmo-clock-col-divider', '')
      .attr('x1', x)
      .attr('x2', x)
      .attr('y1', top)
      .attr('y2', top + colBodyH)
      .attr('stroke', dividerColor)
      .attr('stroke-width', 1);
  }
  return top + colBodyH + cardM;
}

export function renderClockForExport(
  container: HTMLDivElement,
  parsed: ParsedClock,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions
): void {
  renderClock(container, parsed, palette, isDark, exportDims);
}

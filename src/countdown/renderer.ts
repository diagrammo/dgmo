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
import { mix, getSeriesColors, themeBaseBg } from '../palettes/color-utils';
import { resolveColor } from '../colors';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import { wrapDescriptionLines } from '../utils/wrapped-desc';
import {
  parseInlineMarkdown,
  renderInlineText,
} from '../utils/inline-markdown';
import type { ParsedCountdown } from './types';
import {
  DAY_MS,
  formatCompound,
  formatCount,
  formatDateShort,
  formatFooter,
  formatWordsDetail,
  ordinalFor,
  ordinalWord,
  rampIndex,
  relativePhrase,
} from './resolve';

/** The hero string baked at render time (the no-JS floor). */
function bakedHero(
  parsed: ParsedCountdown,
  now: number,
  ordinal: number | null,
  label: string
): string {
  const resolved = parsed.resolvedMs;
  if (resolved === null) return '—';
  const remaining = resolved - now;
  // One-shot expiry: explicit `expired <text>` wins; otherwise count UP how long
  // ago it was (the ticker keeps this live).
  if (!parsed.rule && remaining <= 0) {
    if (parsed.expired !== null) return parsed.expired;
    const elapsed = -remaining;
    if (elapsed <= 0) return 'Now!';
    if (parsed.units === 'compound')
      return `${formatCompound(resolved, now)} ago`;
    const bu =
      parsed.units === 'full' || parsed.units === 'clock'
        ? 'days'
        : parsed.units;
    return `${formatCount(elapsed, { units: bu, round: parsed.round, fields: parsed.fields })} ago`;
  }
  // Occurrence-day label (recurring).
  if (parsed.rule && parsed.onDay && sameLocalDay(resolved, now))
    return parsed.onDay;
  if (ordinal !== null && parsed.sinceStyle === 'headline')
    return ordinalWord(ordinal);
  if (ordinal !== null && parsed.sinceStyle === 'inline') {
    return `${ordinalWord(ordinal)} ${label} ${relativePhrase(Math.max(0, remaining))}`.trim();
  }
  if (parsed.units === 'compound') return formatCompound(now, resolved);
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

function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
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
  if (r.intervalN !== undefined)
    sel.attr('data-dgmo-recur-interval-n', r.intervalN);
  if (r.intervalUnit !== undefined)
    sel.attr('data-dgmo-recur-interval-unit', r.intervalUnit);
  if (r.anchorMs !== undefined) sel.attr('data-dgmo-recur-anchor', r.anchorMs);
}

type SvgSel = d3Selection.Selection<SVGSVGElement, unknown, null, undefined>;

/**
 * "You-are-here → event" band. v1 = a year strip: a Jan→Dec axis (spanning
 * however many years the event is out), month ticks, the now→event span shaded,
 * and two markers (now = blue, event = accent). `month`/`week` fall back to the
 * year strip for now.
 */
function drawCalendarBand(
  svg: SvgSel,
  _kind: 'year' | 'month' | 'week',
  x0: number,
  x1: number,
  top: number,
  nowMs: number,
  resolvedMs: number,
  accent: string,
  palette: PaletteColors,
  _muted: string,
  faint: string
): void {
  const W = x1 - x0;
  const startYear = new Date(nowMs).getFullYear();
  const endYear = new Date(resolvedMs).getFullYear();
  const start = new Date(startYear, 0, 1).getTime();
  const end = new Date(endYear, 11, 31, 23, 59, 59).getTime();
  const span = Math.max(1, end - start);
  const fx = (ms: number): number => x0 + ((ms - start) / span) * W;

  const trackY = top + 16;
  const trackH = 12;
  svg
    .append('rect')
    .attr('x', x0)
    .attr('y', trackY)
    .attr('width', W)
    .attr('height', trackH)
    .attr('rx', trackH / 2)
    .attr('fill', mix(palette.text, palette.bg, 10));

  const sx = fx(nowMs);
  const ex = fx(resolvedMs);
  svg
    .append('rect')
    .attr('x', sx)
    .attr('y', trackY)
    .attr('width', Math.max(0, ex - sx))
    .attr('height', trackH)
    .attr('rx', trackH / 2)
    .attr('fill', mix(accent, palette.bg, 26));

  for (let yr = startYear; yr <= endYear; yr++) {
    for (let m = 0; m < 12; m++) {
      const t = new Date(yr, m, 1).getTime();
      if (t < start || t > end) continue;
      const x = fx(t);
      svg
        .append('line')
        .attr('x1', x)
        .attr('x2', x)
        .attr('y1', trackY - 3)
        .attr('y2', trackY + trackH + 3)
        .attr('stroke', mix(palette.text, palette.bg, m === 0 ? 30 : 18))
        .attr('stroke-width', m === 0 ? 1 : 0.5);
      if (m === 0) {
        svg
          .append('text')
          .attr('x', x + 3)
          .attr('y', trackY + trackH + 17)
          .attr('text-anchor', 'start')
          .attr('font-size', 11)
          .attr('fill', faint)
          .attr('font-family', FONT_FAMILY)
          .text(String(yr));
      }
    }
  }

  const nowColor =
    resolveColor('blue', palette) ?? mix(palette.text, palette.bg, 42);
  const marker = (x: number, col: string): void => {
    svg
      .append('line')
      .attr('x1', x)
      .attr('x2', x)
      .attr('y1', trackY - 9)
      .attr('y2', trackY + trackH + 9)
      .attr('stroke', col)
      .attr('stroke-width', 1.6);
    svg
      .append('circle')
      .attr('cx', x)
      .attr('cy', trackY - 9)
      .attr('r', 4)
      .attr('fill', col);
  };
  marker(sx, nowColor);
  marker(ex, accent);
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
  const label = parsed.sinceLabel ?? parsed.title ?? '';
  const ordinal =
    parsed.since !== null && resolved !== null
      ? ordinalFor(resolved, parsed.since)
      : null;
  const hero = bakedHero(parsed, now, ordinal, label);

  const seriesAccent = getSeriesColors(palette)[0]!;
  const manualColor =
    (parsed.color && resolveColor(parsed.color, palette)) ||
    parsed.color ||
    null;

  // Traffic-light ramp — green (far) · orange (amber) · red (close). Palette-
  // aware so both themes stay legible. Ignored when a manual color is set.
  const ramp: [string, string, string] = [
    resolveColor('green', palette) ?? seriesAccent,
    resolveColor('orange', palette) ?? seriesAccent,
    resolveColor('red', palette) ?? seriesAccent,
  ];
  const remainingForRamp = resolved === null ? 0 : resolved - now;
  const useRamp = parsed.thresholds !== null && !manualColor;
  const accent = manualColor
    ? manualColor
    : useRamp
      ? ramp[
          rampIndex(
            remainingForRamp,
            parsed.thresholds![0],
            parsed.thresholds![1]
          )
        ]
      : seriesAccent;
  const muted = mix(palette.text, themeBaseBg(palette, isDark), 55);
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
  const dispLen = (s: string): number =>
    parseInlineMarkdown(s).reduce((n, sp) => n + sp.text.length, 0);

  const padX = Math.max(30, Math.round(width * 0.045));
  const padY = Math.max(26, Math.round(width * 0.03));
  const contentW = width - 2 * padX;
  const leftX = padX;

  // ── Right column: the hero figure. Size it first so the left column knows
  //    how much horizontal room it has. Reserve for the WIDEST the live ticker
  //    can make it — `full`/`clock` bake a narrow day count ("52 days") but tick
  //    to `Nd HH:MM:SS` / `HH:MM:SS`, so lay out against that or the rule runs
  //    under the hero. ──
  const isInlineHero = parsed.sinceStyle === 'inline' && ordinal !== null;
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
  const heroMaxW = contentW * (isInlineHero ? 0.5 : 0.44);
  const heroFont = fitFont(heroSizeStr, isInlineHero ? 40 : 96, heroMaxW, 26);
  const heroW = Math.min(heroMaxW, estWidth(heroSizeStr, heroFont));
  const gapMid = Math.max(28, Math.round(width * 0.03));
  const leftW = Math.max(contentW * 0.42, contentW - heroW - gapMid);

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
  const eyebrowText =
    ordinal !== null &&
    (parsed.sinceStyle === 'eyebrow' || parsed.sinceStyle === 'tenure')
      ? parsed.sinceStyle === 'tenure'
        ? `${ordinal} year${ordinal === 1 ? '' : 's'} together · ${label}`
        : `${ordinalWord(ordinal)} ${label}`.trim().toUpperCase()
      : null;
  const eyebrowFont = 16;
  const footerText =
    resolved !== null ? formatFooter(resolved, parsed.hasTime) : null;
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
    // Hairline rule under the title, spanning the left column.
    svg
      .append('line')
      .attr('x1', leftX)
      .attr('x2', leftX + leftW)
      .attr('y1', y)
      .attr('y2', y)
      .attr('stroke', mix(palette.text, palette.bg, 82))
      .attr('stroke-width', 1.25);
    y += Math.round(titleFont * 0.5);
  }

  // Eyebrow ordinal (ancillary — below the rule).
  if (eyebrowText) {
    drawText(
      eyebrowText,
      y,
      eyebrowFont,
      parsed.sinceStyle === 'tenure' ? accent : muted,
      700
    )
      .attr('letter-spacing', parsed.sinceStyle === 'eyebrow' ? '0.09em' : null)
      .attr('data-dgmo-countdown-eyebrow', '');
    y += eyebrowFont + 8;
  }

  // Footer resolution line.
  if (footerText) {
    drawText(footerText, y, footerFont, muted, 500).attr(
      'data-dgmo-countdown-footer',
      ''
    );
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

  // ── The words-mode precision sub-line ("3 days 2 hours 7 minutes"): a coarse
  //    hero ("4 months") with the exact remaining underneath, ticking live. ──
  const detailFont = 18;
  const detailText =
    parsed.units === 'words' && resolved !== null && resolved - now > 0
      ? formatWordsDetail(resolved - now)
      : null;
  const heroCapTop = padY + 0.28 * titleFont;
  const heroBaseline = heroCapTop + 0.72 * heroFont;
  const heroBlockBottom =
    heroBaseline + (detailText ? heroFont * 0.28 + detailFont : 0);

  // ── Optional calendar band ("you-are-here → event") spans the full width
  //    below both columns; reserve its height. ──
  const contentBottom = Math.max(leftBottom, heroBlockBottom);
  const calStripH = 52;
  const calTop = contentBottom + 18;
  const hasCal = parsed.calendar !== null && resolved !== null;

  // ── Banner height: the taller of the two columns (plus any calendar) drives it. ──
  const bannerH = Math.max(
    contentBottom + padY,
    hasCal ? calTop + calStripH + padY : 0,
    heroFont * 1.25 + 2 * padY,
    Math.round(width * 0.28)
  );
  svg.attr('height', bannerH).attr('viewBox', `0 0 ${width} ${bannerH}`);
  bgRect.attr('height', bannerH);

  if (hasCal) {
    drawCalendarBand(
      svg,
      parsed.calendar!,
      leftX,
      width - padX,
      calTop,
      now,
      resolved!,
      accent,
      palette,
      muted,
      faint
    );
  }

  // ── The live hero marker — big, accent, TOP-aligned with the title on the
  //    right. Match cap-tops: title cap-top ≈ padY + 0.28·titleFont. ──
  const value = svg
    .append('text')
    .attr('class', 'countdown-value')
    .attr('x', width - padX)
    .attr('y', heroBaseline)
    .attr('text-anchor', 'end')
    .attr('dominant-baseline', 'alphabetic')
    .attr('fill', accent)
    .attr('font-family', FONT_FAMILY)
    .attr('font-size', heroFont)
    .attr('font-weight', 800)
    .attr('data-dgmo-countdown-units', parsed.units)
    .attr('data-dgmo-countdown-round', parsed.round)
    .attr('data-dgmo-countdown-fields', parsed.fields.join(','))
    .attr('data-dgmo-countdown-expired', parsed.expired)
    .attr('aria-label', `${parsed.title ?? 'Countdown'}: ${hero}`)
    .text(hero);
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
  if (parsed.since !== null) {
    value.attr('data-dgmo-countdown-since', parsed.since);
    value.attr('data-dgmo-countdown-since-label', label);
  }
  if (parsed.sinceStyle === 'headline' || parsed.sinceStyle === 'inline') {
    value.attr('data-dgmo-countdown-hero', parsed.sinceStyle);
  }
  if (useRamp) {
    value.attr(
      'data-dgmo-countdown-thresholds',
      `${parsed.thresholds![0]},${parsed.thresholds![1]}`
    );
    value.attr('data-dgmo-countdown-ramp', ramp.join(','));
  }
  stampRecur(value, parsed);

  // Words-mode precision sub-line under the hero (right-aligned, muted, ticks).
  if (detailText) {
    svg
      .append('text')
      .attr('x', width - padX)
      .attr('y', heroBaseline + heroFont * 0.28 + detailFont)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'alphabetic')
      .attr('fill', muted)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', detailFont)
      .attr('font-weight', 500)
      .attr('data-dgmo-countdown-detail', '')
      .text(detailText);
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

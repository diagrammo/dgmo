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
import type { ParsedCountdown } from './types';
import {
  formatCount,
  formatDateShort,
  formatFooter,
  ordinalFor,
  ordinalWord,
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
  // One-shot expiry.
  if (!parsed.rule && remaining <= 0) return parsed.expired;
  // Occurrence-day label (recurring).
  if (parsed.rule && parsed.onDay && sameLocalDay(resolved, now))
    return parsed.onDay;
  if (ordinal !== null && parsed.sinceStyle === 'headline')
    return ordinalWord(ordinal);
  if (ordinal !== null && parsed.sinceStyle === 'inline') {
    return `${ordinalWord(ordinal)} ${label} ${relativePhrase(Math.max(0, remaining))}`.trim();
  }
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

  const accent =
    (parsed.color && resolveColor(parsed.color, palette)) ||
    parsed.color ||
    getSeriesColors(palette)[0]!;
  const muted = mix(palette.text, themeBaseBg(palette, isDark), 55);
  const faint = mix(palette.text, themeBaseBg(palette, isDark), 72);

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('role', 'img')
    .attr('aria-label', `${parsed.title ?? 'Countdown'}: ${hero}`)
    .style('font-family', FONT_FAMILY);

  svg
    .append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', palette.bg);

  const cx = width / 2;
  const pad = Math.max(24, Math.round(width * 0.05));
  const maxW = width - 2 * pad;

  // Width estimate without a DOM layout pass (resvg has none): Inter bold
  // advances ~0.6em; overestimating just picks a safe smaller font.
  const estWidth = (t: string, fs: number): number => t.length * fs * 0.6;
  const fitFont = (t: string, base: number, min: number): number => {
    const w = estWidth(t, base);
    return w <= maxW ? base : Math.max(min, Math.floor((base * maxW) / w));
  };

  // ── Vertical stack: eyebrow · title · hero · footer · as-of ──
  const showEyebrow =
    ordinal !== null &&
    (parsed.sinceStyle === 'eyebrow' || parsed.sinceStyle === 'tenure');
  const eyebrowText = showEyebrow
    ? parsed.sinceStyle === 'tenure'
      ? `${ordinal} year${ordinal === 1 ? '' : 's'} · ${label}`
      : `${ordinalWord(ordinal!)} ${label}`.trim().toUpperCase()
    : null;

  const heroFont = fitFont(hero, parsed.sinceStyle === 'inline' ? 40 : 84, 22);
  const titleFont = parsed.title ? fitFont(parsed.title, 30, 16) : 0;
  const eyebrowFont = eyebrowText ? fitFont(eyebrowText, 18, 11) : 0;

  const footerText =
    resolved !== null ? formatFooter(resolved, now, parsed.hasTime) : null;
  const footerFont = footerText ? fitFont(footerText, 18, 11) : 0;
  const asofText = `as of ${formatDateShort(now)}`;
  const asofFont = 12;

  const gap = 10;
  const blockH =
    (eyebrowFont ? eyebrowFont + gap : 0) +
    (titleFont ? titleFont + gap : 0) +
    heroFont +
    (footerFont ? gap + footerFont : 0) +
    (gap + asofFont);
  let y = height / 2 - blockH / 2;

  const line = (
    text: string,
    fs: number,
    fill: string,
    weight: number
  ): d3Selection.Selection<SVGTextElement, unknown, null, undefined> => {
    y += fs;
    const t = svg
      .append('text')
      .attr('x', cx)
      .attr('y', y - fs * 0.28)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'alphabetic')
      .attr('fill', fill)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', fs)
      .attr('font-weight', weight)
      .text(text);
    y += gap;
    return t as unknown as d3Selection.Selection<
      SVGTextElement,
      unknown,
      null,
      undefined
    >;
  };

  if (eyebrowText) {
    line(
      eyebrowText,
      eyebrowFont,
      parsed.sinceStyle === 'tenure' ? accent : muted,
      700
    )
      .attr('letter-spacing', parsed.sinceStyle === 'eyebrow' ? '0.08em' : null)
      .attr('data-dgmo-countdown-eyebrow', '');
  }

  if (parsed.title) {
    line(parsed.title, titleFont, palette.text, 700).attr(
      'data-line-number',
      parsed.titleLineNumber
    );
  }

  // ── The live hero marker ──
  const value = line(hero, heroFont, accent, 800)
    .attr('class', 'countdown-value')
    .attr('data-dgmo-countdown-units', parsed.units)
    .attr('data-dgmo-countdown-round', parsed.round)
    .attr('data-dgmo-countdown-fields', parsed.fields.join(','))
    .attr('data-dgmo-countdown-expired', parsed.expired)
    .attr('aria-label', `${parsed.title ?? 'Countdown'}: ${hero}`);
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
  stampRecur(value, parsed);

  if (footerText) {
    line(footerText, footerFont, muted, 500).attr(
      'data-dgmo-countdown-footer',
      ''
    );
  }

  // The "as of" stamp — ticker removes it on first tick; a baked image keeps it.
  line(asofText, asofFont, faint, 400).attr('data-dgmo-countdown-asof', '');
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

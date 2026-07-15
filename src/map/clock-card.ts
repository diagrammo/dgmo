// ============================================================
// Map `clock` channel (BL-122) — live local-time cards above POIs
// ============================================================
//
// A compact time card floated above each tz-resolved POI marker. The card is a
// SUBSET of a standalone clock row (digital readout + status dot, no analog
// dial / sun line), but bakes the SAME `data-dgmo-clock*` contract so the shared
// page ticker (`tickClocks` in src/clock/ticker.ts) walks and updates it every
// second. CLI/PNG keep the baked snapshot. See tech-spec-clock-on-map-wip.md.
//
// The card render is deliberately collision-naive: the design assumes offices
// are "few and spread" (memory project_clock_map_office_time_map). Card overlap
// declutter is a deferred follow-up, not v1.
import type * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { measureText } from '../utils/text-measure';
import { mix, themeBaseBg } from '../palettes/color-utils';
import type { PaletteColors } from '../palettes';
import { buildSwatches } from '../clock/swatches';
import {
  fixedParts,
  zoneParts,
  formatTime,
  sunLine,
  workStatus,
  type WorkSpec,
  type ZoneParts,
} from '../clock/resolve';
import { parseClock } from '../clock/parser';
import type { ResolvedMap, ResolvedPoi } from './resolved-types';
import type { MapLayoutPoi } from './layout';

type Sel = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/** Resolve the map's `hours`/`days` directives to a work window by reusing the
 *  clock parser verbatim (single-source — the map card and a standalone clock
 *  read the same grammar). `null` when no `hours` is set. */
function workFromDirectives(d: ResolvedMap['directives']): WorkSpec | null {
  if (d.clockHours === undefined) return null;
  const src =
    `clock\nhours ${d.clockHours}` +
    (d.clockDays !== undefined ? `\ndays ${d.clockDays}` : '');
  const w = parseClock(src).work;
  if (!w) return null;
  return { startMin: w.startMin, endMin: w.endMin, days: w.days };
}

/** Zone-local parts for a resolved POI — a fixed offset ticks off UTC+offset
 *  (DST-blind), a real IANA id goes through `Intl`. Mirrors the ticker branch. */
function partsFor(poi: ResolvedPoi, now: number): ZoneParts {
  return poi.tzFixedOffsetMin !== undefined
    ? fixedParts(poi.tzFixedOffsetMin, now)
    : zoneParts(poi.tz!, now);
}

/**
 * Draw the time cards. `gCards` is a group layered ABOVE the POI markers and
 * labels. Only POIs the resolver gave a `tz` get a card; everything else is a
 * no-op. `now` is the bake instant (the ticker recomputes live thereafter).
 */
export function renderClockCards(
  gCards: Sel,
  layout: readonly MapLayoutPoi[],
  resolved: ResolvedMap,
  palette: PaletteColors,
  isDark: boolean,
  now: number,
  frameW: number,
  frameH: number
): void {
  const withTz = resolved.pois.filter((p) => p.tz !== undefined);
  if (withTz.length === 0) return;
  const byId = new Map(withTz.map((p) => [p.id, p]));

  const baseBg = themeBaseBg(palette, isDark);
  const muted = mix(palette.text, baseBg, 55);
  const sw = buildSwatches(palette, muted);
  // An elevated, theme-consistent surface: mostly bg with a whisper of ink, an
  // opaque fill so the busy basemap never bleeds through, and a clear border so
  // the card reads over pastel land the same way the map's own POI labels do.
  const cardFill = mix(palette.text, palette.bg, 6);
  const border = mix(palette.text, palette.bg, 32);
  const work = workFromDirectives(resolved.directives);
  const hours12 = true; // map cards default to 12-hour (matches clock default)

  for (const lp of layout) {
    const poi = byId.get(lp.id);
    if (!poi) continue;

    const parts = partsFor(poi, now);
    const hasCoords = Number.isFinite(poi.lat) && Number.isFinite(poi.lon);
    const isFixed = poi.tzFixedOffsetMin !== undefined;
    // A fixed offset has no real geography → no sun line; a real zone with coords
    // gets one so day/night status colours flip correctly.
    const sun = !isFixed && hasCoords ? sunLine(now, poi.lat, poi.lon) : null;
    const ts = formatTime(parts.h, parts.m, parts.s, hours12);
    const status = workStatus(parts, work);

    // No place name on the card — the marker already carries its label right
    // below (repeating it is noise). The card is pure time info.
    // Weekday shows ONLY when the pin is on a different calendar day than the
    // viewer (the dateline case, e.g. a US viewer looking at Sydney) — otherwise
    // it is redundant. Compare against the viewer's own local weekday at `now`.
    const viewerWeekday = WEEKDAY_ABBR[new Date(now).getDay()]!;
    const showWeekday = parts.weekday !== viewerWeekday;
    const line2 = [showWeekday ? parts.weekday : null, status?.text]
      .filter(Boolean)
      .join(' · ');

    // ── Geometry: size the card to its widest line, centre it over the marker.
    // The time is a big HH:MM with a small stack to its right: seconds ABOVE,
    // am/pm BELOW (mirrors the clock chart's digital readout). ──
    const mainFont = 18;
    const sf = 8; // seconds + am/pm stack font (~0.44 of main, like the clock)
    // Pin every numeric advance to a fixed tabular estimate (colon ~0.334em,
    // digits ~0.6em) and force it with `textLength` on the ticking nodes, exactly
    // as the standalone clock does. Without this the seconds glyphs shape to their
    // proportional widths and visibly wiggle as they tick each second. `:SS` is
    // always colon + two digits → this width is invariant to the actual second.
    const advance = (s: string, f: number): number =>
      [...s].reduce((w, c) => w + f * (c === ':' ? 0.334 : 0.6), 0);
    const mainW = advance(ts.main, mainFont);
    const secW = advance(`:${ts.sec}`, sf);
    const stackW = Math.max(secW, ts.ap ? measureText(ts.ap, sf) : 0);
    const stackGap = 6;
    const padX = 9;
    // A small analog-clock glyph leads the status line (mirrors the clock chart's
    // dial); it replaces the old headline status dot. Only drawn when there IS a
    // status word to pair with — a bare weekday line stays plain.
    const iconR = 3.5;
    const iconGap = 5;
    const line2Icon = status ? iconR * 2 + iconGap : 0;
    const line1W = mainW + stackGap + stackW;
    const line2W = line2Icon + measureText(line2, 10.5);
    const cardW = Math.max(line1W, line2W) + padX * 2;
    const cardH = 44;
    const leaderGap = 7;
    const M = 6; // keep the card this far off the frame edge
    const cx = lp.cx;
    // Default: centred above the marker. Flip BELOW when it would clip the top,
    // and shift horizontally off whichever side edge it would run past — an
    // edge pin's card lands opposite its near edge instead of off-frame.
    const below = lp.cy - lp.r - leaderGap - cardH < M;
    const cardTop = clamp(
      below ? lp.cy + lp.r + leaderGap : lp.cy - lp.r - leaderGap - cardH,
      M,
      frameH - cardH - M
    );
    const cardLeft = clamp(cx - cardW / 2, M, frameW - cardW - M);

    // ── Group carries the ticker contract (subset — no analog/sun nodes). ──
    const g = gCards
      .append('g')
      .attr('data-dgmo-clock', '')
      .attr('data-dgmo-clock-zone', poi.tz!)
      .attr('data-dgmo-clock-hours12', hours12 ? '1' : '0')
      .attr('data-dgmo-clock-sun', sun ? '1' : '0')
      .attr('data-line-number', poi.lineNumber)
      .attr('data-poi-clock', poi.id)
      // Baked palette swatches — the ticker is palette-blind (reads these).
      .attr('data-dgmo-clock-c-day', sw.day)
      .attr('data-dgmo-clock-c-night', sw.night)
      .attr('data-dgmo-clock-c-day-soft', sw.dayTint)
      .attr('data-dgmo-clock-c-night-soft', sw.nightTint)
      .attr('data-dgmo-clock-c-ok', sw.ok)
      .attr('data-dgmo-clock-c-soon', sw.soon)
      .attr('data-dgmo-clock-c-off', sw.off)
      .attr('data-dgmo-clock-c-ok-soft', sw.okSoft)
      .attr('data-dgmo-clock-c-soon-soft', sw.soonSoft)
      .attr('data-dgmo-clock-c-off-soft', sw.offSoft) as Sel;
    if (hasCoords) {
      g.attr('data-dgmo-clock-lat', poi.lat).attr(
        'data-dgmo-clock-lon',
        poi.lon
      );
    }
    if (isFixed) g.attr('data-dgmo-clock-fixed-offset', poi.tzFixedOffsetMin!);
    if (work) {
      g.attr('data-dgmo-clock-work-start', work.startMin)
        .attr('data-dgmo-clock-work-end', work.endMin)
        .attr(
          'data-dgmo-clock-work-days',
          WEEKDAY_ABBR.filter((d) => work.days[d]).join(',')
        );
    }

    // Leader from the marker to the card's near edge. When the card was shifted
    // (edge clamp), aim at the nearest point on that edge instead of the marker's
    // x, so the line still meets the card.
    const leaderX = clamp(cx, cardLeft + 10, cardLeft + cardW - 10);
    g.append('line')
      .attr('x1', cx)
      .attr('y1', below ? lp.cy + lp.r : lp.cy - lp.r)
      .attr('x2', leaderX)
      .attr('y2', below ? cardTop : cardTop + cardH)
      .attr('stroke', border)
      .attr('stroke-width', 1);

    // Card body.
    g.append('rect')
      .attr('x', cardLeft)
      .attr('y', cardTop)
      .attr('width', cardW)
      .attr('height', cardH)
      .attr('rx', 6)
      .attr('fill', cardFill)
      .attr('stroke', border)
      .attr('stroke-width', 1);

    const statusColor = (cls: 'ok' | 'soon' | 'off'): string =>
      cls === 'ok' ? sw.ok : cls === 'soon' ? sw.soon : sw.off;

    // ── Time headline (ticker anchors): a big HH:MM, then a small stack to its
    // right — seconds ABOVE, am/pm BELOW (mirrors the clock chart). ──
    const line1Y = cardTop + 20; // baseline of the big HH:MM
    const timeX = cardLeft + padX;
    g.append('text')
      .attr('data-dgmo-clock-digital-part', 'main')
      .attr('x', timeX)
      .attr('y', line1Y)
      .attr('font-family', FONT_FAMILY)
      .attr('fill', palette.text)
      .attr('font-size', mainFont)
      .attr('font-weight', 600)
      .attr('textLength', mainW)
      .attr('lengthAdjust', 'spacing')
      .style('font-variant-numeric', 'tabular-nums')
      .text(ts.main);
    // Seconds cap-align to the TOP of the digits, am/pm baseline-align to their
    // BOTTOM, so the trio brackets the big HH:MM as one unit (like the clock).
    const stackX = timeX + mainW + stackGap;
    const capTop = line1Y - mainFont * 0.7;
    g.append('text')
      .attr('data-dgmo-clock-digital-part', 'sec')
      .attr('x', stackX)
      .attr('y', capTop + sf * 0.72)
      .attr('font-family', FONT_FAMILY)
      .attr('fill', muted)
      .attr('font-size', sf)
      .attr('textLength', secW)
      .attr('lengthAdjust', 'spacing')
      .style('font-variant-numeric', 'tabular-nums')
      .text(`:${ts.sec}`);
    g.append('text')
      .attr('data-dgmo-clock-digital-part', 'ap')
      .attr('x', stackX)
      .attr('y', line1Y)
      .attr('font-family', FONT_FAMILY)
      .attr('fill', muted)
      .attr('font-size', sf)
      .text(ts.ap);

    // ── Second line: weekday · availability. `status` text is the only ticked
    // part; weekday is baked (it shifts only at local midnight). Split so the
    // status word can carry a live anchor + colour. ──
    const line2Y = cardTop + 36;
    // Filled status dot leading the status word, coloured by work state — same
    // treatment as the clock chart. Ticker recolours it via the shared anchor.
    if (status) {
      g.append('circle')
        .attr('data-dgmo-clock-status-icon', '')
        .attr('cx', cardLeft + padX + iconR)
        .attr('cy', line2Y - 3.5)
        .attr('r', iconR)
        .attr('fill', statusColor(status.cls));
    }
    const l2 = g
      .append('text')
      .attr('x', cardLeft + padX + line2Icon)
      .attr('y', line2Y)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', 10.5)
      .attr('fill', muted);
    let needSep = false;
    if (showWeekday) {
      l2.append('tspan').text(parts.weekday);
      needSep = true;
    }
    if (status) {
      if (needSep) l2.append('tspan').text(' · ');
      l2.append('tspan')
        .attr('data-dgmo-clock-status', '')
        .attr(
          'fill',
          status.cls === 'ok' ? sw.ok : status.cls === 'soon' ? sw.soon : sw.off
        )
        .text(status.text);
    }
  }
}

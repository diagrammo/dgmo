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
  now: number
): void {
  const withTz = resolved.pois.filter((p) => p.tz !== undefined);
  if (withTz.length === 0) return;
  const byId = new Map(withTz.map((p) => [p.id, p]));

  const baseBg = themeBaseBg(palette, isDark);
  const muted = mix(palette.text, baseBg, 55);
  const sw = buildSwatches(palette, muted);
  const cardFill = mix(palette.bg, palette.text, 4);
  const border = mix(palette.text, palette.bg, 82);
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
    const up = sun ? sun.up : parts.h >= 6 && parts.h < 18;
    const ts = formatTime(parts.h, parts.m, parts.s, hours12);
    const status = workStatus(parts, work);

    const label = poi.label ?? poi.name ?? poi.id;
    const line2 = status
      ? `${label} · ${parts.weekday} · ${status.text}`
      : `${label} · ${parts.weekday}`;

    // ── Geometry: size the card to its widest line, centre it over the marker. ──
    const timeW =
      measureText(ts.main, 15) +
      measureText(`:${ts.sec}`, 10) +
      (ts.ap ? measureText(` ${ts.ap}`, 10) : 0);
    const dotGap = 13; // status dot + gap before the time
    const padX = 9;
    const line1W = dotGap + timeW;
    const line2W = measureText(line2, 10.5);
    const cardW = Math.max(line1W, line2W) + padX * 2;
    const cardH = 40;
    const leaderGap = 7;
    const cx = lp.cx;
    const cardBottom = lp.cy - lp.r - leaderGap;
    const cardTop = cardBottom - cardH;
    const cardLeft = cx - cardW / 2;

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

    // Leader from marker up to the card.
    g.append('line')
      .attr('x1', cx)
      .attr('y1', lp.cy - lp.r)
      .attr('x2', cx)
      .attr('y2', cardBottom)
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

    // ── Status dot (filled when open/soon, hollow ring when off). ──
    const dotCX = cardLeft + padX + 3.5;
    const line1Y = cardTop + 17;
    const dot = g
      .append('circle')
      .attr('data-dgmo-clock-status-dot', '')
      .attr('cx', dotCX)
      .attr('cy', line1Y - 4)
      .attr('r', 3.5);
    if (status) {
      const dc =
        status.cls === 'ok' ? sw.ok : status.cls === 'soon' ? sw.soon : sw.off;
      if (status.cls === 'off') {
        dot.attr('fill', 'none').attr('stroke', dc).attr('stroke-width', 1.4);
      } else {
        dot.attr('fill', dc);
      }
    } else {
      // No work window: the dot echoes day/night so it never reads as "closed".
      dot.attr('fill', up ? sw.day : sw.night);
    }

    // ── Time headline (main bold + dim seconds + am/pm) — ticker anchors. ──
    const timeX = cardLeft + padX + dotGap;
    const tText = g
      .append('text')
      .attr('x', timeX)
      .attr('y', line1Y)
      .attr('font-family', FONT_FAMILY)
      .attr('fill', palette.text);
    tText
      .append('tspan')
      .attr('data-dgmo-clock-digital-part', 'main')
      .attr('font-size', 15)
      .attr('font-weight', 600)
      .text(ts.main);
    tText
      .append('tspan')
      .attr('data-dgmo-clock-digital-part', 'sec')
      .attr('font-size', 10)
      .attr('fill', muted)
      .text(`:${ts.sec}`);
    tText
      .append('tspan')
      .attr('data-dgmo-clock-digital-part', 'ap')
      .attr('font-size', 10)
      .attr('fill', muted)
      .text(ts.ap ? ` ${ts.ap}` : '');

    // ── Second line: label · weekday · availability. `status` text is the only
    // ticked part; label/weekday are baked (weekday shifts only at local
    // midnight). Split so the status word can carry a live anchor + colour. ──
    const line2Y = cardTop + 32;
    const l2 = g
      .append('text')
      .attr('x', cardLeft + padX)
      .attr('y', line2Y)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', 10.5)
      .attr('fill', muted);
    l2.append('tspan').text(`${label} · ${parts.weekday}`);
    if (status) {
      l2.append('tspan').text(' · ');
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

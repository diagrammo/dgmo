// ============================================================
// Calendar — drawing `layout month` (§41.3, #1876): the tiles, the event
// bars over them, and the day and event cards.
// ============================================================
//
// Marks tint a tile's background with the open group's colour; events draw
// over it as bars in the fill family. A multi-day bar runs across tiles and
// the gaps between them, wraps at the week's end with square ends, and the
// continuing piece starts with `‹`. A long bar keeps its lane; past the
// tier's lanes a day shows "+N more" ("+N", or a corner dot). A bar with a
// note ends in a three-line mark. The app draws today with a ring; exports
// never do.

import type * as d3Selection from 'd3-selection';
import { escapeHtml } from '../embed/escape';
import type { PaletteColors } from '../palettes';
import { contrastText, mix, shapeFill } from '../palettes/color-utils';
import type { createTooltip } from '../utils/d3-helpers';
import { hideTooltip, showTooltip } from '../utils/d3-helpers';
import { parseInlineMarkdown } from '../utils/inline-markdown';
import { safeHref } from '../utils/safe-href';
import { tagAttrKey } from '../utils/tag-groups';
import { truncateText } from '../utils/text-measure';
import { now } from '../utils/now';
import { dayNumber, dayToIso, parts } from './dates';
import { amount, fullDate, MONTHS } from './format';
import { laneEvents } from './month';
import type { MonthGeometry, Piece } from './month';
import type {
  CalendarDay,
  CalendarEvent,
  CalendarGroupRef,
  CalendarNumberGroup,
  DayNumber,
  ParsedCalendar,
} from './types';

type Tooltip = ReturnType<typeof createTooltip>;

/** Show a card beside an element (keyboard focus has no pointer). */
export function showAt(tooltip: Tooltip, el: Element, html: string): void {
  const r = el.getBoundingClientRect();
  showTooltip(tooltip, html, {
    clientX: r.right,
    clientY: r.top,
  } as MouseEvent);
}

export interface MonthDrawContext {
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>;
  geo: MonthGeometry;
  parsed: ParsedCalendar;
  palette: PaletteColors;
  isDark: boolean;
  exportMode: boolean;
  showNotes: boolean;
  active: CalendarGroupRef | null;
  numberGroup?: CalendarNumberGroup;
  /** The shade (0–4) of a number mark. */
  level: (v: number) => number;
  /** The tile tint for each shade; 0 is unused (a zero day is a plain tile). */
  stepFills: readonly string[];
  /** Each tag value's colour, by group key then value. */
  fillsByTag: Map<string, Map<string, string>>;
  tooltip: Tooltip | null;
}

/** How dark a tag mark tints its tile, in percent of the tag colour. */
export const MARK_TINT = 30;
/** A number mark's tile tint, in percent of the step's colour. */
export const STEP_TINT = 50;
const DIM = 0.18;
const LEGEND_DIM = 0.35;
const FADE = 'opacity .12s ease';
/** A card stays this long after the pointer leaves, so it can be entered. */
const CARD_GRACE_MS = 160;

/** Draw the month tiles and their events. Returns each day's card. */
export function drawMonthDays(ctx: MonthDrawContext): Map<string, string> {
  const { svg, geo, parsed, palette, isDark, active, tooltip } = ctx;
  const { style } = geo;
  const fillMode = parsed.fillMode === 'tint' ? undefined : parsed.fillMode;
  const activeTagFills =
    active?.kind === 'tag' ? ctx.fillsByTag.get(active.key) : undefined;

  // ── Colours ────────────────────────────────────────────────
  const tileBg = palette.bg;
  const tileStroke = mix(palette.textMuted, palette.bg, 22);
  const weekendBg = mix(palette.textMuted, palette.bg, 7);
  const faintBg = mix(palette.textMuted, palette.bg, 3);
  const faintStroke = mix(palette.textMuted, palette.bg, 10);
  /** An event's colour: its value in the open tag group; the primary
   *  colour when no tag group is open; muted when it has no value. */
  const intentOf = (e: CalendarEvent): string => {
    if (active?.kind === 'tag') {
      const v = e.tags[active.key];
      return (
        (v !== undefined ? activeTagFills?.get(v) : undefined) ??
        palette.textMuted
      );
    }
    if (!active && parsed.groups.length > 0) return palette.textMuted;
    return palette.primary;
  };
  const barFill = (intent: string) =>
    shapeFill(palette, intent, isDark, { mode: fillMode });
  const inkOn = (fill: string) =>
    fillMode === 'solid'
      ? contrastText(fill, palette.bg, palette.text)
      : palette.text;

  svg.attr('data-calendar-tier', style.tier);
  const lanes = laneEvents(parsed.events, geo.blocks, geo.column, style.lanes);
  const byDay = new Map(parsed.days.map((d) => [d.day, d]));
  const tips = new Map<string, string>();
  const today = ctx.exportMode ? null : localToday();

  // ── Neighbouring months' days ──────────────────────────────
  const daysG = svg
    .append('g')
    .attr('class', 'calendar-days')
    .attr('role', 'list');
  for (const f of geo.faint)
    daysG
      .append('rect')
      .attr('class', 'calendar-outside')
      .attr('x', f.x)
      .attr('y', f.y)
      .attr('width', geo.cellW)
      .attr('height', geo.cellH)
      .attr('rx', style.radius)
      .attr('fill', faintBg)
      .attr('stroke', faintStroke)
      .attr('stroke-width', 0.5)
      .attr('aria-hidden', 'true');

  // ── Tiles ──────────────────────────────────────────────────
  const marksG = svg
    .append('g')
    .attr('class', 'calendar-day-marks')
    .attr('pointer-events', 'none');
  const dotR = Math.max(1.5, Math.min(3, geo.cellW * 0.09));
  for (const c of geo.cells) {
    const { day } = c;
    const entry = byDay.get(day);
    const evIdx = lanes.onDay.get(day) ?? [];
    const evs = evIdx.map((i) => parsed.events[i]!);
    const weekend = geo.weekend(day);
    let fill = weekend ? weekendBg : tileBg;
    let stroke = tileStroke;
    let shade: number | null = null;
    let tag: string | undefined;
    if (ctx.numberGroup) {
      const v = entry?.numbers[ctx.numberGroup.key] ?? 0;
      shade = ctx.level(v);
      if (shade > 0) fill = ctx.stepFills[shade]!;
    } else if (active?.kind === 'tag') {
      tag = entry?.tags[active.key];
      const color = tag !== undefined ? activeTagFills?.get(tag) : undefined;
      if (color) fill = mix(color, palette.bg, MARK_TINT);
    }
    // At the smallest size the tile itself takes its first event's colour.
    const first = style.tier === 'tiles' ? evs[0] : undefined;
    if (first) {
      const intent = intentOf(first);
      fill = barFill(intent);
      stroke = intent;
      if (tag === undefined && active?.kind === 'tag')
        tag = first.tags[active.key];
    }

    const rect = daysG
      .append('rect')
      .attr('class', 'calendar-day')
      .attr('data-date', dayToIso(day))
      .attr(
        'data-value',
        ctx.numberGroup ? (entry?.numbers[ctx.numberGroup.key] ?? 0) : null
      )
      .attr('data-level', shade)
      .attr('data-tag', tag ?? null)
      .attr('data-events', evs.length || null)
      .attr('data-weekend', weekend ? '' : null)
      .attr('x', c.x)
      .attr('y', c.y)
      .attr('width', geo.cellW)
      .attr('height', geo.cellH)
      .attr('rx', style.radius)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', first ? 1 : 0.75)
      .attr('role', 'listitem')
      .attr('aria-label', dayLabel(parsed, day, entry, evs));
    for (const g of parsed.tagGroups) {
      const k = tagAttrKey(g.name);
      const v = entry?.tags[k] ?? evs.find((e) => e.tags[k])?.tags[k];
      if (v !== undefined) rect.attr(`data-tag-${k}`, v.toLowerCase());
    }
    const line = entry?.lineNumber ?? evs[0]?.lineNumber;
    if (line !== undefined) rect.attr('data-line-number', line);

    // The day number, top-left; today's is bold in the primary colour.
    const isToday = day === today;
    if (geo.cellW >= 14)
      marksG
        .append('text')
        .attr('class', 'calendar-date')
        .attr('x', c.x + style.datePad)
        .attr('y', c.y + style.datePad + style.dateFont * 0.8)
        .attr('font-size', style.dateFont)
        .attr('font-weight', isToday ? 700 : 500)
        .attr(
          'fill',
          isToday
            ? palette.primary
            : first && fillMode === 'solid'
              ? inkOn(fill)
              : palette.text
        )
        .text(parts(day).date);
    if (isToday)
      marksG
        .append('rect')
        .attr('class', 'calendar-today')
        .attr('x', c.x - 1)
        .attr('y', c.y - 1)
        .attr('width', geo.cellW + 2)
        .attr('height', geo.cellH + 2)
        .attr('rx', style.radius + 1)
        .attr('fill', 'none')
        .attr('stroke', palette.primary)
        .attr('stroke-width', 2);

    // Overflow: "+N more", "+N", or a corner dot.
    const hidden = lanes.hidden.get(day) ?? [];
    const dot = (color: string) =>
      marksG
        .append('circle')
        .attr('class', 'calendar-event-dot')
        .attr('data-date', dayToIso(day))
        .attr('cx', c.x + geo.cellW - dotR - 2)
        .attr('cy', c.y + dotR + 2)
        .attr('r', dotR)
        .attr('fill', color)
        .attr('stroke', palette.bg)
        .attr('stroke-width', 0.5);
    if (style.tier === 'tiles') {
      if (evs[1]) dot(intentOf(evs[1]));
    } else if (hidden.length > 0) {
      if (style.tier === 'bars') dot(palette.textMuted);
      else
        marksG
          .append('text')
          .attr('class', 'calendar-more')
          .attr('data-date', dayToIso(day))
          .attr(
            'x',
            style.tier === 'full'
              ? c.x + style.datePad
              : c.x + geo.cellW - style.datePad
          )
          .attr(
            'y',
            style.tier === 'full'
              ? c.y + style.laneTop + style.lanes * style.laneStep + 9
              : c.y + style.datePad + style.dateFont * 0.8
          )
          .attr('text-anchor', style.tier === 'full' ? 'start' : 'end')
          .attr('font-size', style.tier === 'full' ? 10 : style.dateFont)
          .attr('font-weight', 500)
          .attr('fill', palette.textMuted)
          .text(
            style.tier === 'full'
              ? `+${hidden.length} more`
              : `+${hidden.length}`
          );
    }

    if (!tooltip) continue;
    const html = dayCard(ctx, day, entry, evs, intentOf);
    tips.set(dayToIso(day), html);
    rect.attr('tabindex', 0);
  }

  // ── Event bars ─────────────────────────────────────────────
  const eventsG = svg.append('g').attr('class', 'calendar-events');
  const cellOf = new Map(geo.cells.map((c) => [c.day, c]));
  if (style.tier !== 'tiles')
    for (const p of lanes.pieces)
      drawPiece(eventsG, p, {
        ctx,
        cellOf,
        intent: intentOf(parsed.events[p.event]!),
        barFill,
        inkOn,
      });

  if (tooltip) attachMonthInteractions(ctx, tips, intentOf);
  return tips;
}

/** The viewer's own date, read through `now()` so it can be pinned. */
function localToday(): DayNumber | null {
  const d = new Date(now());
  return dayNumber(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** A bar with rounded ends only where the event really starts or ends. */
function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  roundLeft: boolean,
  roundRight: boolean
): string {
  const rl = roundLeft ? Math.min(r, h / 2, w / 2) : 0;
  const rr = roundRight ? Math.min(r, h / 2, w / 2) : 0;
  const R = x + w;
  const B = y + h;
  return [
    `M${x + rl},${y}`,
    `H${R - rr}`,
    rr ? `A${rr},${rr} 0 0 1 ${R},${y + rr}` : '',
    `V${B - rr}`,
    rr ? `A${rr},${rr} 0 0 1 ${R - rr},${B}` : '',
    `H${x + rl}`,
    rl ? `A${rl},${rl} 0 0 1 ${x},${B - rl}` : '',
    `V${y + rl}`,
    rl ? `A${rl},${rl} 0 0 1 ${x + rl},${y}` : '',
    'Z',
  ].join('');
}

function drawPiece(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  p: Piece,
  o: {
    ctx: MonthDrawContext;
    cellOf: Map<DayNumber, { x: number; y: number }>;
    intent: string;
    barFill: (intent: string) => string;
    inkOn: (fill: string) => string;
  }
): void {
  const { ctx, intent } = o;
  const { geo, parsed, active } = ctx;
  const { style } = geo;
  const e = parsed.events[p.event]!;
  const a = o.cellOf.get(p.from)!;
  const b = o.cellOf.get(p.to)!;
  const x = p.continuesLeft ? a.x : a.x + style.inset;
  const right = p.continuesRight
    ? b.x + geo.cellW
    : b.x + geo.cellW - style.inset;
  const y = a.y + style.laneTop + p.lane * style.laneStep;
  const w = right - x;
  const fill = o.barFill(intent);
  const tag = active?.kind === 'tag' ? e.tags[active.key] : undefined;
  const piece = g
    .append('g')
    .attr('class', 'calendar-event')
    .attr('data-event', p.event)
    .attr('data-month', p.month)
    .attr('data-from', dayToIso(p.from))
    .attr('data-to', dayToIso(p.to))
    .attr('data-lane', p.lane)
    .attr('data-tag', tag ?? null)
    .attr('data-line-number', e.lineNumber)
    .attr('aria-hidden', 'true');
  if (p.continuesLeft) piece.attr('data-continues-left', '');
  if (p.continuesRight) piece.attr('data-continues-right', '');
  piece
    .append('path')
    .attr('class', 'calendar-event-bar')
    .attr(
      'd',
      barPath(
        x,
        y,
        w,
        style.barH,
        style.tier === 'bars' ? 2 : 5,
        !p.continuesLeft,
        !p.continuesRight
      )
    )
    .attr('fill', fill)
    .attr('stroke', intent)
    .attr('stroke-width', style.tier === 'bars' ? 0.75 : 1.1);
  if (style.barFont <= 0) return;

  const pad = style.tier === 'full' ? 7 : 4;
  const ink = o.inkOn(fill);
  const hasNote = ctx.showNotes && e.notes.length > 0 && !p.continuesLeft;
  const markW = style.tier === 'full' ? 7 : 5;
  const room = w - 2 * pad - (hasNote ? markW + 4 : 0);
  const name = truncateText(
    `${p.continuesLeft ? '‹ ' : ''}${e.name}`,
    style.barFont,
    room,
    { bold: false }
  );
  if (name)
    piece
      .append('text')
      .attr('class', 'calendar-event-name')
      .attr('x', x + pad)
      .attr('y', y + style.barH / 2)
      .attr('dominant-baseline', 'central')
      .attr('font-size', style.barFont)
      .attr('font-weight', 500)
      .attr('fill', ink)
      .attr('pointer-events', 'none')
      .text(name);
  if (hasNote) {
    // Three short lines at the bar's right end: this event has a note.
    const mx = right - pad - markW;
    const cy = y + style.barH / 2;
    const step = style.tier === 'full' ? 3 : 2.2;
    const h = style.tier === 'full' ? 1.3 : 1;
    const markInk = mix(ink, fill, 75);
    const mark = piece
      .append('g')
      .attr('class', 'calendar-note-mark')
      .attr('pointer-events', 'none');
    [markW, markW, markW * 0.7].forEach((lw, k) =>
      mark
        .append('rect')
        .attr('x', mx)
        .attr('y', cy - step + k * step - h / 2)
        .attr('width', lw)
        .attr('height', h)
        .attr('rx', h / 2)
        .attr('fill', markInk)
    );
  }
}

// ── Cards and labels ─────────────────────────────────────────

/** "Thursday, January 14, 2027: 4 events — Sprint review, Lunch, …". */
export function dayLabel(
  parsed: ParsedCalendar,
  day: DayNumber,
  entry: CalendarDay | undefined,
  evs: readonly CalendarEvent[]
): string {
  const said: string[] = [];
  if (evs.length > 0)
    said.push(
      `${evs.length} ${evs.length === 1 ? 'event' : 'events'} — ${evs
        .map((e) => e.name)
        .join(', ')}`
    );
  for (const g of parsed.numberGroups) {
    const v = entry?.numbers[g.key];
    if (v !== undefined) said.push(`${g.name}: ${amount(v, g.unit)}`);
  }
  for (const g of parsed.tagGroups) {
    const v = entry?.tags[tagAttrKey(g.name)];
    if (v !== undefined) said.push(`${g.name}: ${v}`);
  }
  return `${fullDate(day)}: ${said.length ? said.join('; ') : 'no events'}`;
}

/** A note line as card HTML: §34.6 inline markdown, `- ` as a bullet. */
export function noteHtml(line: string): string {
  const bullet = /^\s*[-*]\s+/.test(line);
  const text = line.replace(/^\s*[-*]\s+/, '');
  const html = parseInlineMarkdown(text)
    .map((s) => {
      let h = escapeHtml(s.text);
      if (s.code) h = `<code>${h}</code>`;
      if (s.bold) h = `<strong>${h}</strong>`;
      if (s.italic) h = `<em>${h}</em>`;
      const href = s.href ? safeHref(s.href) : null;
      if (href)
        h = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${h}</a>`;
      return h;
    })
    .join('');
  return bullet ? `• ${html}` : html;
}

const swatch = (color: string) =>
  `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;background:${color}"></span>`;

/** Each tag value an event carries, the open group's first. */
function eventTags(ctx: MonthDrawContext, e: CalendarEvent): string[] {
  const { parsed, active } = ctx;
  const keys = parsed.tagGroups.map((g) => tagAttrKey(g.name));
  if (active?.kind === 'tag')
    keys.sort((a, b) => Number(b === active.key) - Number(a === active.key));
  return keys.flatMap((k) => {
    const v = e.tags[k];
    return v !== undefined ? [v] : [];
  });
}

/** The day card: the date, the day's marks, then every event on it —
 *  including those behind "+N more" — with its colour, values and note. */
function dayCard(
  ctx: MonthDrawContext,
  day: DayNumber,
  entry: CalendarDay | undefined,
  evs: readonly CalendarEvent[],
  intentOf: (e: CalendarEvent) => string
): string {
  const { parsed } = ctx;
  const rows: string[] = [`<strong>${escapeHtml(fullDate(day))}</strong>`];
  if (entry) {
    for (const g of parsed.numberGroups) {
      const v = entry.numbers[g.key];
      if (v !== undefined)
        rows.push(`${escapeHtml(g.name)}: ${escapeHtml(amount(v, g.unit))}`);
    }
    for (const g of parsed.tagGroups) {
      const v = entry.tags[tagAttrKey(g.name)];
      if (v !== undefined) rows.push(`${escapeHtml(g.name)}: ${escapeHtml(v)}`);
    }
  }
  for (const e of evs) {
    const tags = eventTags(ctx, e);
    rows.push(
      `<div class="calendar-card-event">${swatch(intentOf(e))}<strong>${escapeHtml(e.name)}</strong>${
        tags.length ? ` · ${escapeHtml(tags.join(' · '))}` : ''
      }</div>`
    );
    if (ctx.showNotes)
      for (const n of e.notes)
        rows.push(`<div class="calendar-card-note">${noteHtml(n)}</div>`);
  }
  if (!entry && evs.length === 0) rows.push('No events');
  return rows.join('<br>').replace(/<br><div/g, '<div');
}

/** "Jan 18 – Jan 20, 2027"; one day reads as its full date. */
export function eventDates(e: CalendarEvent): string {
  if (e.start === e.end) return fullDate(e.start);
  const a = parts(e.start);
  const b = parts(e.end);
  const short = (p: { month: number; date: number }) =>
    `${MONTHS[p.month - 1]!.slice(0, 3)} ${p.date}`;
  return a.year === b.year
    ? `${short(a)} – ${short(b)}, ${b.year}`
    : `${short(a)}, ${a.year} – ${short(b)}, ${b.year}`;
}

/** The event card: name, dates, length, values and note. */
function eventCard(
  ctx: MonthDrawContext,
  e: CalendarEvent,
  intent: string
): string {
  const days = e.end - e.start + 1;
  const rows = [
    `<div class="calendar-card-event">${swatch(intent)}<strong>${escapeHtml(e.name)}</strong></div>`,
    `${escapeHtml(eventDates(e))} · ${days} ${days === 1 ? 'day' : 'days'}`,
  ];
  for (const g of ctx.parsed.tagGroups) {
    const v = e.tags[tagAttrKey(g.name)];
    if (v !== undefined) rows.push(`${escapeHtml(g.name)}: ${escapeHtml(v)}`);
  }
  if (ctx.showNotes)
    for (const n of e.notes)
      rows.push(`<div class="calendar-card-note">${noteHtml(n)}</div>`);
  return rows.join('<br>').replace(/<br><div/g, '<div');
}

// ── Interactions ─────────────────────────────────────────────

/**
 * Hovering a day opens its card; the card stays while the pointer is on it,
 * so a link in a note can be clicked. Hovering an event lights every piece
 * of it, dims the other events, and lights its value in the legend. Tab
 * walks the days; arrows move a day or a week; Enter opens the card.
 */
function attachMonthInteractions(
  ctx: MonthDrawContext,
  tips: Map<string, string>,
  intentOf: (e: CalendarEvent) => string
): void {
  const tooltip = ctx.tooltip!;
  const svg = ctx.svg.node()!;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const hideSoon = () => {
    cancel();
    timer = setTimeout(() => hideTooltip(tooltip), CARD_GRACE_MS);
  };
  const show = (html: string, ev: MouseEvent) => {
    cancel();
    showTooltip(tooltip, html, ev);
  };
  tooltip.onmouseenter = cancel;
  tooltip.onmouseleave = () => hideTooltip(tooltip);

  const days = new Map<string, SVGRectElement>();
  for (const r of svg.querySelectorAll<SVGRectElement>('.calendar-day'))
    days.set(r.getAttribute('data-date')!, r);
  for (const [iso, r] of days) {
    const html = tips.get(iso) ?? '';
    r.addEventListener('mouseenter', (ev) => show(html, ev));
    r.addEventListener('mouseleave', hideSoon);
    r.addEventListener('focus', () => {
      cancel();
      showAt(tooltip, r, html);
    });
    r.addEventListener('blur', () => hideTooltip(tooltip));
    r.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter') {
        cancel();
        showAt(tooltip, r, html);
        ev.preventDefault();
        return;
      }
      const step: Record<string, number> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7,
      };
      const d = step[ev.key];
      if (d === undefined) return;
      const next = days.get(
        dayToIso(Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000) + d)
      );
      if (next) {
        next.focus();
        ev.preventDefault();
      }
    });
  }

  const pieces = [...svg.querySelectorAll<SVGGElement>('.calendar-event')];
  for (const p of pieces) p.style.transition = FADE;
  const legendEntries = [
    ...svg.querySelectorAll<SVGGElement>(
      '.calendar-legend [data-legend-entry]'
    ),
  ];
  const light = (i: string | null, value: string | null) => {
    for (const p of pieces)
      p.style.opacity =
        i === null || p.getAttribute('data-event') === i ? '' : String(DIM);
    for (const en of legendEntries) {
      const on = en.getAttribute('data-series-name') === value;
      en.style.opacity = value === null || on ? '' : String(LEGEND_DIM);
      if (on && value !== null) en.setAttribute('data-calendar-lit', '');
      else en.removeAttribute('data-calendar-lit');
    }
  };
  for (const p of pieces) {
    const i = p.getAttribute('data-event')!;
    const e = ctx.parsed.events[Number(i)]!;
    const html = eventCard(ctx, e, intentOf(e));
    p.style.cursor = 'pointer';
    p.addEventListener('mouseenter', (ev) => {
      light(i, p.getAttribute('data-tag'));
      show(html, ev);
    });
    p.addEventListener('mouseleave', () => {
      light(null, null);
      hideSoon();
    });
  }
}

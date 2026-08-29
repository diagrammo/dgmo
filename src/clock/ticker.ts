// ============================================================
// Clock chart — page-level ticker (client runtime)
// ============================================================
//
// Single-sourced tick logic. Two entry points (mirroring countdown/ticker.ts):
//   • tickClocks(root)  — ONE update pass; hosts that own their interval
//     (the desktop app's useEffect, the Obsidian plugin's registerInterval)
//     call this on their own timer.
//   • startClocks(root) — updates once immediately AND registers ONE
//     self-managed 1s interval; used by the drop-in runtimes (auto, element)
//     and the remark client where there is no host-managed interval.
//
// Every pass recomputes each row from absolute state (the baked zone + coords +
// work window) → accurate on load with zero persisted state. No <script> is ever
// injected into the SVG (sanitizers strip it); this module is imported by the
// page runtime instead. All time math is shared with the renderer via ./resolve
// so the live value can never disagree with the baked fallback.

import {
  fixedParts,
  fixedTimeCells,
  formatTime,
  handAngles,
  rampColor,
  sunLine,
  workStatus,
  zoneParts,
  type WorkSpec,
} from './resolve';
import { mix } from '../palettes/color-utils';
import { now as currentTimeMs } from '../utils/now';

/** Reconstruct the working window from the baked `data-dgmo-clock-work-*` attrs. */
function readWork(node: Element): WorkSpec | null {
  const start = node.getAttribute('data-dgmo-clock-work-start');
  const end = node.getAttribute('data-dgmo-clock-work-end');
  if (start === null || end === null) return null;
  const days: Record<string, boolean> = {};
  (node.getAttribute('data-dgmo-clock-work-days') ?? '')
    .split(',')
    .filter(Boolean)
    .forEach((d) => {
      days[d] = true;
    });
  return { startMin: Number(start), endMin: Number(end), days };
}

/** Set a hand's rotate transform, preserving the "50 50" pivot the bake used. */
function setHand(group: Element, which: string, angle: number): void {
  const hand = group.querySelector(`[data-dgmo-clock-hand="${which}"]`);
  if (hand) hand.setAttribute('transform', `rotate(${angle} 50 50)`);
}

function setPart(group: Element, sel: string, textContent: string): void {
  const el = group.querySelector(sel);
  if (el && el.textContent !== textContent) el.textContent = textContent;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Rebuild the digital HH:MM as fixed cells (matching the renderer's initial
 * paint via the shared fixedTimeCells) and re-hug the seconds/am-pm stack to the
 * new width. Only touches the DOM when the string actually changed — the minute
 * ticks once a minute, the hour's digit-count changes at most once an hour. See
 * fixedTimeCells for why per-glyph cells beat tabular-nums / textLength here.
 */
function setDigits(group: Element, main: string): void {
  const el = group.querySelector('[data-dgmo-clock-digital-part="main"]');
  if (!el || el.textContent === main) return;
  const x0 = parseFloat(el.getAttribute('data-dgmo-clock-x0') ?? '0');
  const fs = parseFloat(el.getAttribute('data-dgmo-clock-fs') ?? '0');
  const gap = parseFloat(el.getAttribute('data-dgmo-clock-gap') ?? '0');
  const { cells, width } = fixedTimeCells(main, x0, fs);
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const c of cells) {
    const t = document.createElementNS(SVG_NS, 'tspan');
    t.setAttribute('x', String(c.x));
    t.textContent = c.ch;
    el.appendChild(t);
  }
  const stackX = String(x0 + width + gap);
  for (const part of ['sec', 'ap']) {
    const s = group.querySelector(`[data-dgmo-clock-digital-part="${part}"]`);
    if (s) s.setAttribute('x', stackX);
  }
}

/** Update one `[data-dgmo-clock]` row against `now`. */
function updateRow(group: Element, now: number): void {
  const zone = group.getAttribute('data-dgmo-clock-zone');
  if (!zone) return;
  // A fixed UTC offset ticks off UTC+offset (no DST); a real zone goes through
  // `Intl`. The renderer bakes `data-dgmo-clock-fixed-offset` for the former.
  const fixedAttr = group.getAttribute('data-dgmo-clock-fixed-offset');
  const parts =
    fixedAttr !== null
      ? fixedParts(Number(fixedAttr), now)
      : zoneParts(zone, now);

  const latAttr = group.getAttribute('data-dgmo-clock-lat');
  const lonAttr = group.getAttribute('data-dgmo-clock-lon');
  const sunOn = group.getAttribute('data-dgmo-clock-sun') === '1';
  const hasCoords = latAttr !== null && lonAttr !== null;
  const sun =
    sunOn && hasCoords ? sunLine(now, Number(latAttr), Number(lonAttr)) : null;
  const up = sun ? sun.up : parts.h >= 6 && parts.h < 18;

  const c = (name: string): string =>
    group.getAttribute(`data-dgmo-clock-c-${name}`) ?? '';
  const stColor = up ? c('day') : c('night');
  const stTint = up ? c('day-soft') : c('night-soft');

  const hours12 = group.getAttribute('data-dgmo-clock-hours12') !== '0';
  const ts = formatTime(parts.h, parts.m, parts.s, hours12);

  // ── Analog hands + day/night colour. ──
  const ang = handAngles(parts.h, parts.m, parts.s);
  setHand(group, 'h', ang.hour);
  setHand(group, 'm', ang.minute);
  setHand(group, 's', ang.second);
  // Auto-color overrides day/night on the dial: repaint face, ring, second
  // hand, and center from the baked resolved color so a hue/work/time clock
  // stays its own color instead of reverting to day/night each tick. The lane
  // wash and digital time color are baked once and never touched here.
  // Recompute the auto accent live so `daylight` flips at sunset and the `time`
  // ramp drifts by hour instead of freezing at bake time; `place`/`work` accents
  // are static so fall back to the baked solid for those.
  const mode = group.getAttribute('data-dgmo-clock-auto-mode');
  const cardFill = group.getAttribute('data-dgmo-clock-cardfill');
  // §1.9 fill family: a restyled row (fill-solid / fill-outline on a decorative
  // identity color) bakes its final face/lane/hand inks at render time — the
  // identity color never changes live, so skip the recolors (rotation still
  // ticks) rather than re-deriving the tint wash and undoing the restyle.
  const fillMode = group.getAttribute('data-dgmo-clock-fill-mode');
  let autoSolid: string | null = null;
  if (mode === 'daylight') autoSolid = up ? c('day') : c('night');
  else if (mode === 'time') autoSolid = rampColor(parts.h);
  else if (mode) autoSolid = group.getAttribute('data-dgmo-clock-auto-solid');
  if (!fillMode) {
    const faceFill =
      autoSolid && cardFill
        ? mix(autoSolid, cardFill, 20)
        : (group.getAttribute('data-dgmo-clock-auto-face') ?? stTint);
    const handColor = autoSolid ?? stColor;
    const face = group.querySelector('[data-dgmo-clock-facebg]');
    if (face) face.setAttribute('fill', faceFill);
    const ring = group.querySelector('[data-dgmo-clock-facering]');
    if (ring && autoSolid) ring.setAttribute('stroke', autoSolid);
    const center = group.querySelector('[data-dgmo-clock-center]');
    if (center) center.setAttribute('fill', handColor);
    const secondHand = group.querySelector('[data-dgmo-clock-hand="s"]');
    if (secondHand) secondHand.setAttribute('stroke', handColor);
  }

  // ── Digital readout (main + dim :SS + am/pm) + weekday sub-line. ──
  setDigits(group, ts.main);
  setPart(group, '[data-dgmo-clock-digital-part="sec"]', `:${ts.sec}`);
  // `ap` is its own stacked node (seconds above / am-pm below) — no leading
  // space (that would nudge it right of its `x` after the first tick).
  setPart(group, '[data-dgmo-clock-digital-part="ap"]', ts.ap);

  // ── Analog am/pm caption. ──
  setPart(group, '[data-dgmo-clock-ampm]', ts.ap.toUpperCase());

  // ── Working-hours status chip. ──
  const work = readWork(group);
  const status = workStatus(parts, work);
  const statusEl = group.querySelector('[data-dgmo-clock-status]');
  if (status && statusEl) {
    const col =
      status.cls === 'ok'
        ? c('ok')
        : status.cls === 'soon'
          ? c('soon')
          : c('off');
    if (statusEl.textContent !== status.text)
      statusEl.textContent = status.text;
    statusEl.setAttribute('fill', col);
    // Status dot — filled circle coloured by work state. Shared by clock
    // rows/cols and the map card.
    const icon = group.querySelector('[data-dgmo-clock-status-icon]');
    if (icon) icon.setAttribute('fill', col);
  }

  // ── Auto lane wash — repaint so work/daylight/time modes track live state.
  // The wash is otherwise baked once at render, so a page opened before
  // work-start (or before sunset) keeps a stale color all day. `place` is
  // static; leave its baked tint alone. ──
  const lane = group.querySelector('[data-dgmo-clock-lane]');
  if (lane && mode && !fillMode) {
    let laneFill: string | null = null;
    if (mode === 'daylight') laneFill = stTint;
    else if (mode === 'time' && cardFill)
      laneFill = mix(rampColor(parts.h), cardFill, 14);
    else if (mode === 'work' && status)
      laneFill =
        status.cls === 'ok'
          ? c('ok-soft')
          : status.cls === 'soon'
            ? c('soon-soft')
            : c('off-soft');
    if (laneFill) lane.setAttribute('fill', laneFill);
  }

  // ── Sundown / sunrise line + sun/moon icon. ──
  const sunEl = group.querySelector('[data-dgmo-clock-sun-line]');
  if (sun && sunEl) {
    if (sunEl.textContent !== sun.text) sunEl.textContent = sun.text;
    const icon = group.querySelector('[data-dgmo-clock-sun-icon]');
    if (icon) {
      // Toggle the baked yellow-sun / blue-moon glyphs as day flips to night.
      const sunG = icon.querySelector('[data-clock-glyph="sun"]');
      const moonG = icon.querySelector('[data-clock-glyph="moon"]');
      if (sunG) sunG.setAttribute('display', up ? 'inline' : 'none');
      if (moonG) moonG.setAttribute('display', up ? 'none' : 'inline');
    }
  }
}

/** Run one update pass over every clock row inside `root`. */
export function tickClocks(root: ParentNode = document): void {
  if (typeof document === 'undefined') return;
  const now = currentTimeMs();
  root
    .querySelectorAll('[data-dgmo-clock]')
    .forEach((group) => updateRow(group, now));
}

let intervalStarted = false;

/**
 * Update `root` immediately, then (once per page) register a single 1s interval
 * that re-scans the whole document. Idempotent — safe to call on every render /
 * route change. No-op with no DOM.
 */
export function startClocks(root: ParentNode = document): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  tickClocks(root);
  if (intervalStarted) return;
  intervalStarted = true;
  window.setInterval(() => tickClocks(document), 1000);
}

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
  formatTime,
  handAngles,
  sunLine,
  workStatus,
  zoneParts,
  type WorkSpec,
} from './resolve';

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

/** Update one `[data-dgmo-clock]` row against `now`. */
function updateRow(group: Element, now: number): void {
  const zone = group.getAttribute('data-dgmo-clock-zone');
  if (!zone) return;
  const parts = zoneParts(zone, now);

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
  const autoSolid = group.getAttribute('data-dgmo-clock-auto-solid');
  const autoFace = group.getAttribute('data-dgmo-clock-auto-face');
  const faceFill = autoFace ?? stTint;
  const handColor = autoSolid ?? stColor;
  const face = group.querySelector('[data-dgmo-clock-facebg]');
  if (face) face.setAttribute('fill', faceFill);
  const ring = group.querySelector('[data-dgmo-clock-facering]');
  if (ring && autoSolid) ring.setAttribute('stroke', autoSolid);
  const center = group.querySelector('[data-dgmo-clock-center]');
  if (center) center.setAttribute('fill', handColor);
  const secondHand = group.querySelector('[data-dgmo-clock-hand="s"]');
  if (secondHand) secondHand.setAttribute('stroke', handColor);

  // ── Digital readout (main + dim :SS + am/pm) + weekday sub-line. ──
  setPart(group, '[data-dgmo-clock-digital-part="main"]', ts.main);
  setPart(group, '[data-dgmo-clock-digital-part="sec"]', `:${ts.sec}`);
  setPart(group, '[data-dgmo-clock-digital-part="ap"]', ` ${ts.ap}`);

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
    const dot = group.querySelector('[data-dgmo-clock-status-dot]');
    if (dot) {
      // Filled disc when working/soon; hollow ring when off.
      if (status.cls === 'off') {
        dot.setAttribute('fill', 'none');
        dot.setAttribute('stroke', col);
        dot.setAttribute('stroke-width', '1.4');
      } else {
        dot.setAttribute('fill', col);
        dot.setAttribute('stroke', 'none');
      }
    }
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
  const now = Date.now();
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

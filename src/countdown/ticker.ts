// ============================================================
// Countdown chart — page-level ticker (client runtime)
// ============================================================
//
// Single-sourced tick logic. Two entry points:
//   • tickCountdowns(root)  — ONE update pass; hosts that own their interval
//     (the desktop app's useEffect, the Obsidian plugin's registerInterval)
//     call this on their own timer.
//   • startCountdowns(root) — updates once immediately AND registers ONE
//     self-managed 1s interval; used by the drop-in runtimes (auto, element)
//     and the remark client where there is no host-managed interval.
//
// Every pass recomputes from absolute state → accurate on load with zero
// persisted state. Recurring nodes roll forward by re-running resolveNext() on
// each pass. No <script> is ever injected into the SVG (sanitizers strip it);
// this module is imported by the page runtime instead.
//
// All time math + formatting is shared with the renderer via ./resolve so the
// live value can never disagree with the baked fallback.

import {
  DAY_MS,
  dayStart,
  dayDelta,
  sameDay,
  formatCompound,
  formatCount,
  formatFooter,
  formatHuman,
  formatWordsDetail,
  applyOrdinalTemplate,
  ordinalFor,
  resolveNext,
  splitClockSeconds,
  targetToMs as resolveTargetToMs,
  type CountUnits,
  type Field,
  type RecurRule,
  type RoundMode,
} from './resolve';
import { now as currentTimeMs } from '../utils/now';

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Write text into a clock-capable element (hero / detail). When the element is
 * marked `data-dgmo-cd-clock` AND the string carries a `:SS` tail, render the
 * seconds as a smaller, cold-blue `<tspan>` (mirrors renderer.paintClock so
 * live == baked); otherwise fall back to a plain text node. Reconciles in place
 * so a per-second tick only rewrites the changed segment.
 */
function setClockText(el: Element, str: string): void {
  if (el.hasAttribute('data-dgmo-cd-clock')) {
    const { lead, sec } = splitClockSeconds(str);
    if (sec !== null) {
      let leadT = el.querySelector('[data-cd-lead]');
      let secT = el.querySelector('[data-cd-sec]');
      if (!leadT || !secT) {
        while (el.firstChild) el.removeChild(el.firstChild);
        const doc = el.ownerDocument!;
        leadT = doc.createElementNS(SVG_NS, 'tspan');
        leadT.setAttribute('data-cd-lead', '');
        secT = doc.createElementNS(SVG_NS, 'tspan');
        secT.setAttribute('data-cd-sec', '');
        const size = el.getAttribute('data-dgmo-cd-sec-size');
        const fill = el.getAttribute('data-dgmo-cd-sec-fill');
        if (size) secT.setAttribute('font-size', size);
        if (fill) secT.setAttribute('fill', fill);
        secT.setAttribute('font-weight', 'bold');
        el.appendChild(leadT);
        el.appendChild(secT);
      }
      if (leadT.textContent !== lead) leadT.textContent = lead;
      if (secT.textContent !== sec) secT.textContent = sec;
      return;
    }
  }
  if (el.textContent !== str) el.textContent = str;
}

// Ring-gauge arc geometry — mirrors renderer.polar/arcPath so live == baked.
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

/** Recompute the three H·M·S ring gauges (numeral · swept arc · caption). */
function updateGauges(svg: Element, remaining: number): void {
  const rem = Math.abs(remaining);
  const vals: Record<string, number> = {
    h: Math.floor(rem / 3600000),
    m: Math.floor((rem % 3600000) / 60000),
    s: Math.floor((rem % 60000) / 1000),
  };
  const fracs: Record<string, number> = {
    h: (vals['h']! % 24) / 24,
    m: vals['m']! / 60,
    s: vals['s']! / 60,
  };
  svg.querySelectorAll('[data-dgmo-gauge-val]').forEach((el) => {
    const k = el.getAttribute('data-dgmo-gauge-val')!;
    const v = pad2(vals[k] ?? 0);
    if (el.textContent !== v) el.textContent = v;
  });
  svg.querySelectorAll('[data-dgmo-gauge-arc]').forEach((el) => {
    const k = el.getAttribute('data-dgmo-gauge-arc')!;
    const cx = Number(el.getAttribute('data-cx'));
    const cy = Number(el.getAttribute('data-cy'));
    const r = Number(el.getAttribute('data-r'));
    const f = fracs[k] ?? 0;
    el.setAttribute('d', f > 0.001 ? arcPath(cx, cy, r, f) : '');
  });
  const cap = svg.querySelector('[data-dgmo-gauge-caption]');
  if (cap) {
    const t = remaining >= 0 ? 'TO GO' : 'AGO';
    if (cap.textContent !== t) cap.textContent = t;
  }
}

/** Resolve a baked one-shot target string in `tz` (single-sourced via resolve). */
function targetToMs(target: string, tz: string | null): number | null {
  const t = resolveTargetToMs(target, tz);
  return Number.isFinite(t) ? t : null;
}

/** Reconstruct a RecurRule from the baked `data-dgmo-recur-*` attributes. */
function readRule(node: Element): RecurRule | null {
  const kind = node.getAttribute('data-dgmo-recur-kind') as
    | RecurRule['kind']
    | null;
  if (!kind) return null;
  const num = (name: string): number | undefined => {
    const v = node.getAttribute(name);
    return v === null ? undefined : Number(v);
  };
  return {
    kind,
    month: num('data-dgmo-recur-month'),
    day: num('data-dgmo-recur-day'),
    nth: num('data-dgmo-recur-nth'),
    weekday: num('data-dgmo-recur-weekday'),
    hour: num('data-dgmo-recur-hour') ?? 0,
    minute: num('data-dgmo-recur-minute') ?? 0,
    allDay: node.getAttribute('data-dgmo-recur-allday') !== '0',
    intervalN: num('data-dgmo-recur-interval-n'),
    intervalUnit:
      (node.getAttribute('data-dgmo-recur-interval-unit') as
        | RecurRule['intervalUnit']
        | null) ?? undefined,
    anchorMs: num('data-dgmo-recur-anchor'),
    tz: node.getAttribute('data-dgmo-recur-tz') ?? undefined,
  };
}

function readFields(node: Element): Field[] {
  const raw = node.getAttribute('data-dgmo-countdown-fields');
  if (!raw) return ['d', 'h', 'm', 's'];
  return raw
    .split(',')
    .filter((f): f is Field => ['d', 'h', 'm', 's'].includes(f));
}

/** Update a single `[data-dgmo-countdown]` node (+ its footer/eyebrow) against `now`. */
function updateNode(node: Element, now: number): void {
  const rule = readRule(node);
  const units = (node.getAttribute('data-dgmo-countdown-units') ||
    'days') as CountUnits;
  const round = (node.getAttribute('data-dgmo-countdown-round') ||
    'up') as RoundMode;
  const fields = readFields(node);
  const onDay = node.getAttribute('data-dgmo-countdown-onday');
  const title = node.getAttribute('data-dgmo-countdown-title');
  // Zone the wall-clock resolves/formats in (null → viewer-local, v1 default).
  const tz = node.getAttribute('data-dgmo-countdown-tz');

  let resolvedMs: number | null;
  let expiredNow = false;

  if (rule) {
    // Recurring: roll forward automatically by resolving fresh every pass.
    resolvedMs = resolveNext(rule, now);
  } else {
    const target = node.getAttribute('data-dgmo-countdown');
    resolvedMs = target ? targetToMs(target, tz) : null;
    if (resolvedMs !== null && resolvedMs - now <= 0) expiredNow = true;
  }
  if (resolvedMs === null) return; // unparseable — leave the baked text.

  const remaining = resolvedMs - now;
  const custom = node.getAttribute('data-dgmo-countdown-expired');
  const hasTime = node.getAttribute('data-dgmo-countdown-hastime') === '1';
  // Timed pivot: on the final day (or past) the hero is the ticking clock and the
  // band is the H·M·S rings. An explicit `expired` text always freezes instead.
  const frozen = expiredNow && custom !== null;
  const clockFinale = hasTime && !frozen && dayDelta(now, resolvedMs, tz) <= 0;
  let text: string;
  if (frozen) {
    text = custom!;
  } else if (clockFinale) {
    const clock = formatCount(Math.abs(remaining), {
      units: 'clock',
      round,
      fields,
    });
    text = remaining < 0 ? `${clock} ago` : clock;
  } else if (expiredNow) {
    // Count UP how long ago it was. All-day (no-time) targets floor to `tz`
    // midnights so it reads flat ("4 days ago"), mirroring the forward path.
    if (units === 'compound' || units === 'human') {
      const [a, b] = hasTime
        ? [resolvedMs, now]
        : [dayStart(resolvedMs, tz), dayStart(now, tz)];
      text = `${formatCompound(a, b, 2, tz)} ago`;
    } else {
      const elapsed = -remaining;
      text =
        elapsed <= 0
          ? 'Now!'
          : `${formatCount(elapsed, { units, round, fields })} ago`;
    }
  } else if (rule && sameDay(resolvedMs, now, tz)) {
    // On the occurrence day the all-day rule resolves to today — show on-day / Today!
    text = onDay ?? 'Today!';
  } else if (units === 'human') {
    // All-day targets floor to midnights → flat whole-day hero (baked-hero parity).
    text = hasTime
      ? formatHuman(now, resolvedMs, tz).big
      : formatHuman(dayStart(now, tz), dayStart(resolvedMs, tz), tz).big;
  } else if (units === 'compound') {
    text = formatCompound(now, resolvedMs, 2, tz);
  } else {
    text = formatCount(Math.max(0, remaining), { units, round, fields });
  }

  setClockText(node, text);
  node.setAttribute(
    'aria-label',
    title ? `${title}: ${text}` : expiredNow ? text : `${text} remaining`
  );

  // Scope sibling lookups to this countdown's own SVG.
  const svg = (node as SVGElement).ownerSVGElement ?? node.closest('svg');
  if (!svg) return;

  // Footer resolution line.
  const footer = svg.querySelector('[data-dgmo-countdown-footer]');
  if (footer && !expiredNow) {
    const hasTime = node.getAttribute('data-dgmo-countdown-hastime') === '1';
    footer.textContent = formatFooter(resolvedMs, hasTime, tz);
  }

  // Since eyebrow — re-apply the Nth/N template when the ordinal rolls forward.
  // The anchor and cadence both ride the reconstructed rule, so the ordinal
  // counts in the cadence's own unit exactly as the baked one did.
  const tpl = node.getAttribute('data-dgmo-countdown-since-label');
  const eyebrowEl = svg.querySelector('[data-dgmo-countdown-eyebrow]');
  if (eyebrowEl && tpl && rule) {
    eyebrowEl.textContent = applyOrdinalTemplate(
      tpl,
      ordinalFor(resolvedMs, rule)
    );
  }

  // Hero sub-line, ticking: words precision, or the human remainder / days-out
  // clock. Suppressed once the hero itself is the clock (rings carry the time).
  const detail = svg.querySelector('[data-dgmo-countdown-detail]');
  if (detail && !expiredNow && !clockFinale) {
    if (units === 'words') {
      setClockText(detail, formatWordsDetail(Math.max(0, remaining)));
    } else if (units === 'human' && remaining > 0) {
      setClockText(
        detail,
        hasTime
          ? formatCount(remaining, { units: 'clock', round, fields })
          : formatHuman(dayStart(now, tz), dayStart(resolvedMs, tz), tz).sub
      );
    }
  }

  // Timed finale: recompute the three ring gauges (numeral · arc · caption).
  if (clockFinale) updateGauges(svg, remaining);

  // The "as of" stamp proves liveness — erase it on the first live tick. On a
  // baked image no tick ever fires, so the stamp stays and the picture is
  // honestly dated.
  const stamp = svg.querySelector('[data-dgmo-countdown-asof]');
  if (stamp && stamp.parentNode) stamp.parentNode.removeChild(stamp);
}

/** Run one update pass over every countdown node inside `root`. */
export function tickCountdowns(root: ParentNode = document): void {
  if (typeof document === 'undefined') return;
  const now = currentTimeMs();
  root
    .querySelectorAll('[data-dgmo-countdown]')
    .forEach((node) => updateNode(node, now));
}

let intervalStarted = false;

/**
 * Update `root` immediately, then (once per page) register a single 1s interval
 * that re-scans the whole document. Idempotent — safe to call on every render /
 * route change (mirrors remark's `clickHandlerBound` guard). No-op with no DOM.
 */
export function startCountdowns(root: ParentNode = document): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  tickCountdowns(root);
  if (intervalStarted) return;
  intervalStarted = true;
  window.setInterval(() => tickCountdowns(document), 1000);
}

// Re-export DAY_MS for consumers that want the constant without importing resolve.
export { DAY_MS };

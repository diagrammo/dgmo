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
  formatCount,
  formatFooter,
  formatWordsDetail,
  ordinalFor,
  ordinalWord,
  rampIndex,
  relativePhrase,
  resolveNext,
  type CountUnits,
  type Field,
  type RecurRule,
  type RoundMode,
} from './resolve';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Mirror of parser.ts `targetToMs` (bare date → local midnight). */
function targetToMs(target: string): number | null {
  const s = target.trim();
  if (DATE_ONLY_RE.test(s)) {
    const p = s.split('-').map(Number);
    return new Date(p[0]!, p[1]! - 1, p[2]!).getTime();
  }
  const t = new Date(s).getTime();
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
    intervalN: num('data-dgmo-recur-interval-n'),
    intervalUnit:
      (node.getAttribute('data-dgmo-recur-interval-unit') as
        | RecurRule['intervalUnit']
        | null) ?? undefined,
    anchorMs: num('data-dgmo-recur-anchor'),
  };
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

  let resolvedMs: number | null;
  let expiredNow = false;

  if (rule) {
    // Recurring: roll forward automatically by resolving fresh every pass.
    resolvedMs = resolveNext(rule, now);
  } else {
    const target = node.getAttribute('data-dgmo-countdown');
    resolvedMs = target ? targetToMs(target) : null;
    if (resolvedMs !== null && resolvedMs - now <= 0) expiredNow = true;
  }
  if (resolvedMs === null) return; // unparseable — leave the baked text.

  const remaining = resolvedMs - now;
  const sinceAttr = node.getAttribute('data-dgmo-countdown-since');
  const hero = node.getAttribute('data-dgmo-countdown-hero'); // headline | inline | null
  let text: string;
  if (expiredNow) {
    // Explicit `expired <text>` wins; otherwise count UP how long ago it was.
    const custom = node.getAttribute('data-dgmo-countdown-expired');
    if (custom) text = custom;
    else {
      const elapsed = -remaining;
      text =
        elapsed <= 0
          ? 'Now!'
          : `${formatCount(elapsed, { units, round, fields })} ago`;
    }
  } else if (rule && onDay && sameLocalDay(resolvedMs, now)) {
    text = onDay;
  } else if (hero && sinceAttr) {
    // The ordinal is the hero (day-count demoted to the footer) — match the bake.
    const n = ordinalFor(resolvedMs, Number(sinceAttr));
    const label = node.getAttribute('data-dgmo-countdown-since-label') || '';
    text =
      hero === 'inline'
        ? `${ordinalWord(n)} ${label} ${relativePhrase(Math.max(0, remaining))}`.trim()
        : ordinalWord(n);
  } else {
    text = formatCount(Math.max(0, remaining), { units, round, fields });
  }

  if (node.textContent !== text) node.textContent = text;
  node.setAttribute(
    'aria-label',
    title ? `${title}: ${text}` : expiredNow ? text : `${text} remaining`
  );

  // Traffic-light ramp — recolor the hero live as it crosses a threshold.
  const thAttr = node.getAttribute('data-dgmo-countdown-thresholds');
  const rampAttr = node.getAttribute('data-dgmo-countdown-ramp');
  if (thAttr && rampAttr && !expiredNow) {
    const [amber, red] = thAttr.split(',').map(Number) as [number, number];
    const cols = rampAttr.split(',');
    const col = cols[rampIndex(Math.max(0, remaining), amber, red)];
    if (col) node.setAttribute('fill', col);
  }

  // Scope sibling lookups to this countdown's own SVG.
  const svg = (node as SVGElement).ownerSVGElement ?? node.closest('svg');
  if (!svg) return;

  // Footer resolution line.
  const footer = svg.querySelector('[data-dgmo-countdown-footer]');
  if (footer && !expiredNow) {
    const hasTime = node.getAttribute('data-dgmo-countdown-hastime') === '1';
    footer.textContent = formatFooter(resolvedMs, hasTime);
  }

  // Words-mode precision sub-line ("3 days 2 hours 7 minutes"), ticking.
  const detail = svg.querySelector('[data-dgmo-countdown-detail]');
  if (detail && units === 'words' && !expiredNow) {
    detail.textContent = formatWordsDetail(Math.max(0, remaining));
  }

  // Eyebrow ordinal (rolls up when a recurring anniversary passes).
  const eyebrow = svg.querySelector('[data-dgmo-countdown-eyebrow]');
  if (eyebrow && sinceAttr) {
    const label = node.getAttribute('data-dgmo-countdown-since-label') || '';
    const n = ordinalFor(resolvedMs, Number(sinceAttr));
    eyebrow.textContent = `${ordinalWord(n)} ${label}`.trim().toUpperCase();
  }

  // The "as of" stamp proves liveness — erase it on the first live tick. On a
  // baked image no tick ever fires, so the stamp stays and the picture is
  // honestly dated.
  const stamp = svg.querySelector('[data-dgmo-countdown-asof]');
  if (stamp && stamp.parentNode) stamp.parentNode.removeChild(stamp);
}

/** Run one update pass over every countdown node inside `root`. */
export function tickCountdowns(root: ParentNode = document): void {
  if (typeof document === 'undefined') return;
  const now = Date.now();
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

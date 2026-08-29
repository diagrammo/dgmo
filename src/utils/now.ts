// ============================================================
// now.ts — the single source of "the current instant" for every
// parser and renderer that draws it: clock hands and digits,
// countdown remaining time, and recurring-rule resolution.
//
// Pinning it is what makes those chart types snapshottable. Their
// output otherwise changes every run (clock, which is second-accurate)
// or every day (countdown, whose baseline read "42 days" against a
// fresh "28 days" on 2026-08-05), so `gallery/` had to skip them and
// four chart types shipped with no rendered evidence at all (#533).
//
// The pin is installed by the CLI's `--now` flag and by nothing else —
// in the app, the browser and every wrapper the override is absent and
// `now()` is exactly `Date.now()`. A pinned clock also stops the live
// tickers advancing, which is what a frozen render wants.
// ============================================================

let pinnedMs: number | null = null;

/** Wall-clock milliseconds, or the pinned instant when one is installed. */
export function now(): number {
  return pinnedMs ?? Date.now();
}

/** Pin `now()` to a fixed instant. Pass `null` to go back to real time. */
export function setPinnedNow(ms: number | null): void {
  pinnedMs = ms;
}

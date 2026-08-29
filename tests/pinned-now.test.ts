import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { now, setPinnedNow } from '../src/utils/now';
import { parseClock } from '../src/clock/parser';
import { renderClock } from '../src/clock/renderer';
import { getPalette } from '../src/palettes';

// The pin is what makes clock and countdown snapshottable: without it
// `clock` differs between two runs a second apart and `countdown` is wrong
// the day after its baseline is recorded, so four chart types shipped with
// no gallery snapshot at all (#533). These tests guard that property
// directly — the gallery gate is the only other thing that would catch it,
// and it fails a whole run rather than naming the cause.

const NORD_LIGHT = getPalette('nord').light;
const PIN_A = Date.parse('2026-01-15T09:00:00Z');
const PIN_B = Date.parse('2026-01-15T14:37:00Z');

const CLOCK_SRC = `clock Crew standups
London as UK team
New York as Dani (NY)`;

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [key, value] of Object.entries({
    document: win.document,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  })) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
});

afterEach(() => {
  setPinnedNow(null);
});

function renderClockSvg(): string {
  const container = document.createElement('div');
  const parsed = parseClock(CLOCK_SRC);
  renderClock(container, parsed, NORD_LIGHT, false, {
    width: 800,
    height: 400,
  });
  // The clip-path id carries a per-render counter that climbs within one
  // process. The CLI renders each fixture in a fresh process, so the gallery
  // never sees it — normalize it here rather than let it mask the thing under
  // test, which is whether anything TIME-dependent moved.
  return container.innerHTML.replace(/dgmo-clock-clip-\d+/g, 'dgmo-clock-clip');
}

describe('pinned now', () => {
  it('falls back to wall-clock time when nothing is pinned', () => {
    const before = Date.now();
    const observed = now();
    expect(observed).toBeGreaterThanOrEqual(before);
    expect(observed).toBeLessThanOrEqual(Date.now());
  });

  it('returns the pinned instant, and releases it on null', () => {
    setPinnedNow(PIN_A);
    expect(now()).toBe(PIN_A);
    expect(now()).toBe(PIN_A);
    setPinnedNow(null);
    expect(now()).not.toBe(PIN_A);
  });

  it('makes two clock renders at the same pin byte-identical', () => {
    setPinnedNow(PIN_A);
    const first = renderClockSvg();
    const second = renderClockSvg();
    expect(second).toBe(first);
  });

  it('still moves the clock when the pin moves', () => {
    setPinnedNow(PIN_A);
    const atNine = renderClockSvg();
    setPinnedNow(PIN_B);
    const atTwoThirtySeven = renderClockSvg();
    expect(atTwoThirtySeven).not.toBe(atNine);
  });
});

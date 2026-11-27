// Countdown cell hover (#2428): every tier's cells name their period and
// distance from now; the readout line is empty at rest and filled on hover.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseCountdown } from '../src/countdown/parser';
import { renderCountdown } from '../src/countdown/renderer';
import { tickCountdowns } from '../src/countdown/ticker';
import { setPinnedNow } from '../src/utils/now';
import { getPalette } from '../src/palettes';

let win: JSDOM['window'];
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  win = dom.window;
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
afterEach(() => setPinnedNow(null));

const NOW = '2026-07-10T00:00:00Z';

function renderAt(source: string, nowIso = NOW): HTMLDivElement {
  setPinnedNow(Date.parse(nowIso));
  const c = document.createElement('div') as HTMLDivElement;
  document.body.appendChild(c);
  renderCountdown(c, parseCountdown(source), getPalette('nord').light, false, {
    width: 800,
    height: 600,
  });
  return c;
}

function cells(c: HTMLElement): string[] {
  return Array.from(c.querySelectorAll('[data-dgmo-cd-cell]')).map(
    (e) => e.getAttribute('data-dgmo-cd-cell') ?? ''
  );
}

function hover(c: HTMLElement, label: string): string {
  const cell = Array.from(c.querySelectorAll('[data-dgmo-cd-cell]')).find(
    (e) => e.getAttribute('data-dgmo-cd-cell') === label
  );
  if (!cell) throw new Error(`no cell ${label}`);
  const target = cell.querySelector('rect, path, text') ?? cell;
  target.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
  return readout(c);
}

const readout = (c: HTMLElement): string =>
  c.querySelector('[data-dgmo-cd-readout]')?.textContent ?? '<none>';

describe('countdown hover — one cell per tier carries its period', () => {
  it('years (far future): year + years away, now, and the target name', () => {
    const c = renderAt('countdown The End\ntarget 9999-12-31T23:59');
    const all = cells(c);
    expect(all).toContain('2031 · 5 years away');
    expect(all).toContain('2026 · now');
    expect(all).toContain('9999 · The End');
    expect(all).toContain('2020 · 6 years ago');
    // The row (decade) label is marked so CSS can lift it.
    expect(
      c.querySelector('[data-dgmo-cd-row] [data-dgmo-cd-row-label]')
        ?.textContent
    ).toBe('2020s');
  });

  it('year (1–3yr): month + months away', () => {
    const all = cells(renderAt('countdown Trip\ntarget 2028-08-21'));
    expect(all).toContain('Jul 2026 · now');
    expect(all).toContain('Sep 2026 · 2 months away');
    expect(all).toContain('Aug 2028 · Trip');
  });

  it('months (3–12mo): month + months away', () => {
    const all = cells(renderAt('countdown Trip\ntarget 2026-12-01'));
    expect(all).toContain('Oct 2026 · 3 months away');
    expect(all).toContain('Dec 2026 · Trip');
  });

  it('monthgrid (8d–3mo): day + days away', () => {
    const c = renderAt('countdown Trip\ntarget 2026-08-21');
    const all = cells(c);
    expect(all).toContain('Fri Jul 10, 2026 · now');
    expect(all).toContain('Sun Jul 12, 2026 · 2 days away');
    expect(all).toContain('Fri Aug 21, 2026 · Trip');
    expect(c.querySelector('[data-dgmo-cd-row-frame]')).not.toBeNull();
  });

  it('weekstrip (≤7d): day + days away', () => {
    const all = cells(renderAt('countdown Trip\ntarget 2026-07-14'));
    expect(all).toContain('Sat Jul 11, 2026 · 1 day away');
    expect(all).toContain('Tue Jul 14, 2026 · Trip');
  });

  it('today: the chip names the target', () => {
    expect(cells(renderAt('countdown Trip\ntarget 2026-07-10'))).toEqual([
      'Fri Jul 10, 2026 · Trip',
    ]);
  });

  it('clock: each gauge is a cell that reads its live value', () => {
    const c = renderAt(
      'countdown Launch\ntarget 2026-07-10T05:30',
      '2026-07-10T00:00:00Z'
    );
    expect(cells(c)).toEqual(['hours', 'minutes', 'seconds']);
    expect(hover(c, 'hours')).toBe('05 hours to go');
  });
});

describe('countdown hover — readout', () => {
  it('is empty at rest, names the hovered cell, clears on leave', () => {
    const c = renderAt('countdown The End\ntarget 9999-12-31T23:59');
    expect(readout(c)).toBe('');
    expect(hover(c, '2031 · 5 years away')).toBe('2031 · 5 years away');
    const svg = c.querySelector('svg')!;
    svg.dispatchEvent(new win.MouseEvent('mouseleave'));
    expect(readout(c)).toBe('');
  });

  it('bakes the highlight as CSS, never an <svg><title>', () => {
    const c = renderAt('countdown The End\ntarget 9999-12-31T23:59');
    const css = c.querySelector('style')?.textContent ?? '';
    expect(css).toContain('[data-dgmo-cd-cell]:hover');
    expect(css).toContain(':has([data-dgmo-cd-cell]:hover)');
    expect(c.querySelector('title')).toBeNull();
  });

  it('a serialized SVG gets hover from the ticker', () => {
    const c = renderAt('countdown Trip\ntarget 2026-08-21');
    const host = document.createElement('div');
    host.innerHTML = c.innerHTML; // listeners do not survive serialization
    document.body.appendChild(host);
    tickCountdowns(host);
    expect(hover(host, 'Sun Jul 12, 2026 · 2 days away')).toBe(
      'Sun Jul 12, 2026 · 2 days away'
    );
  });
});

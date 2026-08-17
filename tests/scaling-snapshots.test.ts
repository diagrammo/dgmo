import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { renderForExport } from '../src/d3';
import { renderDataChartD3 as renderExtendedChartForExport } from '../src/charts-d3';
import { nordPalette } from '../src/palettes/nord';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  Object.defineProperty(globalThis, 'document', {
    value: win.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: win.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    value: win.SVGElement,
    configurable: true,
  });
});

const fix = (name: string) =>
  readFileSync(resolve(__dirname, `../gallery/fixtures/${name}`), 'utf-8');

const fixTest = (name: string) =>
  readFileSync(resolve(__dirname, `fixtures/${name}`), 'utf-8');

const palette = nordPalette.light;

describe('scaling baselines — ideal size (pre-renderer-change regression guard)', () => {
  it('sequence baseline', async () => {
    const svg = await renderForExport(fix('sequence.dgmo'), 'light', palette);
    expect(svg).toMatchSnapshot();
  });

  it('sequence collapsed-group baseline', async () => {
    // The collapsed group's box label and the expanded header strip draw the
    // group's name from two different code paths; this pins both (#242).
    const src = [
      'sequence Ship Ops',
      '[Backend] collapsed: true',
      '  API',
      '  DB',
      '[Frontend]',
      '  App',
      'App -request-> API',
    ].join('\n');
    const svg = await renderForExport(src, 'light', palette);
    expect(svg).toMatchSnapshot();
  });

  it('raci baseline', async () => {
    const svg = await renderForExport(
      fix('raci/voyage-operations.dgmo'),
      'light',
      palette
    );
    expect(svg).toMatchSnapshot();
  });

  it('mindmap baseline', async () => {
    const svg = await renderForExport(
      fixTest('mindmap/basic.dgmo'),
      'light',
      palette
    );
    expect(svg).toMatchSnapshot();
  });

  it('tech-radar baseline', async () => {
    const svg = await renderForExport(fix('tech-radar.dgmo'), 'light', palette);
    expect(svg).toMatchSnapshot();
  });

  it('heatmap baseline', async () => {
    const svg = await renderExtendedChartForExport(
      fix('heatmap.dgmo'),
      'light',
      palette
    );
    expect(svg).toMatchSnapshot();
  });

  it('arc baseline', async () => {
    const svg = await renderForExport(fix('arc.dgmo'), 'light', palette);
    expect(svg).toMatchSnapshot();
  });

  // Export crops tight to content — the root height must equal the content
  // height, not the 800px export-height floor (which left dead whitespace
  // below the cards before the fix).
  it('event-line baseline crops to content height', async () => {
    const svg = await renderForExport(fix('event-line.dgmo'), 'light', palette);
    const h = Number(svg.match(/height="([0-9.]+)"/)?.[1] ?? 0);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(800);
    expect(svg).toMatchSnapshot();
  });
});

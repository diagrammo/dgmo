import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  parseDgmoChartType,
  getRenderCategory,
  getAllChartTypes,
} from '../src/dgmo-router';
import { renderForExport } from '../src/d3';

// Set up jsdom globals for D3 rendering
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

describe('flowchart routing', () => {
  it('parseDgmoChartType returns flowchart for explicit header', () => {
    expect(parseDgmoChartType('flowchart\n(Start) -> (End)')).toBe('flowchart');
  });

  it('parseDgmoChartType prefers sequence for content with arrows', () => {
    // Both sequence and flowchart use `->` — sequence detection runs first
    // so content without explicit `chart:` header defaults to sequence
    expect(parseDgmoChartType('Alice -> Bob: hello')).toBe('sequence');
    // Flowchart syntax also triggers sequence first (both match ARROW_PATTERN)
    expect(parseDgmoChartType('[A] -> [B]')).toBe('sequence');
  });

  it('getRenderCategory returns diagram for flowchart', () => {
    expect(getRenderCategory('flowchart')).toBe('diagram');
  });

  it('flowchart is in getAllChartTypes', () => {
    expect(getAllChartTypes()).toContain('flowchart');
  });

  it('chart type count is 40', () => {
    expect(getAllChartTypes().length).toBe(40);
  });
});

describe('flowchart renderForExport', () => {
  it('renders flowchart to non-empty SVG', async () => {
    const svg = await renderForExport(
      'flowchart\n(Start) -> [Process] -> (End)',
      'light'
    );
    expect(svg).toBeTruthy();
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders flowchart with dark theme', async () => {
    const svg = await renderForExport('flowchart\n(Start) -> (End)', 'dark');
    expect(svg).toBeTruthy();
    expect(svg).toContain('<svg');
  });

  it('renders flowchart with transparent theme', async () => {
    const svg = await renderForExport(
      'flowchart\n(Start) -> (End)',
      'transparent'
    );
    expect(svg).toBeTruthy();
    expect(svg).toContain('<svg');
    expect(svg).toContain('background: none');
  });

  it('returns empty string for malformed flowchart content', async () => {
    const svg = await renderForExport('flowchart\n// only comments\n', 'light');
    expect(svg).toBe('');
  });

  it('renders flowchart with all shape types', async () => {
    const content = [
      'flowchart',
      '(Start) -> [Process] -> <Decision?>',
      '  -yes-> /Input/ -> [[Subroutine]] -> [Report~]',
      '  -no-> (End)',
    ].join('\n');
    const svg = await renderForExport(content, 'light');
    expect(svg).toBeTruthy();
    expect(svg).toContain('<svg');
  });
});

describe('existing chart type regression', () => {
  it('existing chart types still route correctly', () => {
    expect(getRenderCategory('bar')).toBe('data-chart');
    expect(getRenderCategory('line')).toBe('data-chart');
    expect(getRenderCategory('pie')).toBe('data-chart');
    expect(getRenderCategory('scatter')).toBe('data-chart');
    expect(getRenderCategory('sankey')).toBe('data-chart');
    expect(getRenderCategory('sequence')).toBe('diagram');
    expect(getRenderCategory('slope')).toBe('visualization');
    expect(getRenderCategory('arc')).toBe('visualization');
    expect(getRenderCategory('venn')).toBe('visualization');
    expect(getRenderCategory('quadrant')).toBe('visualization');
  });

  it('unknown chart type returns null', () => {
    expect(getRenderCategory('nonexistent')).toBeNull();
  });
});

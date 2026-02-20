import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  parseDgmoChartType,
  getDgmoFramework,
  DGMO_CHART_TYPE_MAP,
} from '../src/dgmo-router';
import { renderD3ForExport } from '../src/d3';

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
    expect(parseDgmoChartType('chart: flowchart\n(Start) -> (End)')).toBe('flowchart');
  });

  it('parseDgmoChartType prefers sequence for content with arrows', () => {
    // Both sequence and flowchart use `->` — sequence detection runs first
    // so content without explicit `chart:` header defaults to sequence
    expect(parseDgmoChartType('Alice -> Bob: hello')).toBe('sequence');
    // Flowchart syntax also triggers sequence first (both match ARROW_PATTERN)
    expect(parseDgmoChartType('[A] -> [B]')).toBe('sequence');
  });

  it('getDgmoFramework returns d3 for flowchart', () => {
    expect(getDgmoFramework('flowchart')).toBe('d3');
  });

  it('flowchart is in DGMO_CHART_TYPE_MAP', () => {
    expect(DGMO_CHART_TYPE_MAP['flowchart']).toBe('d3');
  });

  it('chart type count is 24', () => {
    expect(Object.keys(DGMO_CHART_TYPE_MAP).length).toBe(24);
  });
});

describe('flowchart renderD3ForExport', () => {
  it('renders flowchart to non-empty SVG', async () => {
    const svg = await renderD3ForExport(
      'chart: flowchart\n(Start) -> [Process] -> (End)',
      'light'
    );
    expect(svg).toBeTruthy();
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders flowchart with dark theme', async () => {
    const svg = await renderD3ForExport(
      'chart: flowchart\n(Start) -> (End)',
      'dark'
    );
    expect(svg).toBeTruthy();
    expect(svg).toContain('<svg');
  });

  it('renders flowchart with transparent theme', async () => {
    const svg = await renderD3ForExport(
      'chart: flowchart\n(Start) -> (End)',
      'transparent'
    );
    expect(svg).toBeTruthy();
    expect(svg).toContain('<svg');
    expect(svg).toContain('background: none');
  });

  it('returns empty string for malformed flowchart content', async () => {
    const svg = await renderD3ForExport(
      'chart: flowchart\n// only comments\n',
      'light'
    );
    expect(svg).toBe('');
  });

  it('renders flowchart with all shape types', async () => {
    const content = [
      'chart: flowchart',
      '(Start) -> [Process] -> <Decision?>',
      '  -yes-> /Input/ -> [[Subroutine]] -> [Report~]',
      '  -no-> (End)',
    ].join('\n');
    const svg = await renderD3ForExport(content, 'light');
    expect(svg).toBeTruthy();
    expect(svg).toContain('<svg');
  });
});

describe('existing chart type regression', () => {
  it('existing chart types still route correctly', () => {
    expect(getDgmoFramework('bar')).toBe('echart');
    expect(getDgmoFramework('line')).toBe('echart');
    expect(getDgmoFramework('pie')).toBe('echart');
    expect(getDgmoFramework('scatter')).toBe('echart');
    expect(getDgmoFramework('sankey')).toBe('echart');
    expect(getDgmoFramework('sequence')).toBe('d3');
    expect(getDgmoFramework('slope')).toBe('d3');
    expect(getDgmoFramework('arc')).toBe('d3');
    expect(getDgmoFramework('venn')).toBe('d3');
    expect(getDgmoFramework('quadrant')).toBe('d3');
  });

  it('unknown chart type returns null', () => {
    expect(getDgmoFramework('nonexistent')).toBeNull();
  });
});

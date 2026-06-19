import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseMindmap } from '../src/mindmap/parser';
import { layoutMindmap } from '../src/mindmap/layout';
import { renderMindmapForExport, renderMindmap } from '../src/mindmap/renderer';
import { getPalette } from '../src/palettes';

const palette = getPalette('bold').light;
const FIXTURE_DIR = resolve(__dirname, 'fixtures/mindmap');

const FIXTURE_FILES = [
  'basic.dgmo',
  'multi-root.dgmo',
  'single-node.dgmo',
  'one-child.dgmo',
  'deep-unbalanced.dgmo',
];

describe('mindmap renderer', () => {
  for (const file of FIXTURE_FILES) {
    it(`${file} renders to non-empty SVG`, () => {
      const content = readFileSync(resolve(FIXTURE_DIR, file), 'utf-8');
      const svg = renderMindmapForExport(content, 'light', palette);
      expect(svg).toBeTruthy();
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });
  }

  it('root node has heavier stroke', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'basic.dgmo'), 'utf-8');
    const svg = renderMindmapForExport(content, 'light', palette);
    // Root node (first rendered) should have stroke-width 2.5
    expect(svg).toContain('stroke-width="2.5"');
  });

  it('nodes have data-line-number attributes', () => {
    const content = readFileSync(
      resolve(FIXTURE_DIR, 'one-child.dgmo'),
      'utf-8'
    );
    const svg = renderMindmapForExport(content, 'light', palette);
    expect(svg).toContain('data-line-number=');
  });

  it('nodes with children have data-node-toggle attributes', () => {
    const content = readFileSync(
      resolve(FIXTURE_DIR, 'one-child.dgmo'),
      'utf-8'
    );
    const svg = renderMindmapForExport(content, 'light', palette);
    expect(svg).toContain('data-node-toggle=');
  });

  it('renders elbow-style edges', () => {
    const content = readFileSync(
      resolve(FIXTURE_DIR, 'one-child.dgmo'),
      'utf-8'
    );
    const svg = renderMindmapForExport(content, 'light', palette);
    // Elbow paths use M and multiple L commands
    expect(svg).toMatch(/d="M\s.*L\s/);
  });

  it('renders with dark theme', () => {
    const darkPalette = getPalette('bold').dark;
    const content = readFileSync(resolve(FIXTURE_DIR, 'basic.dgmo'), 'utf-8');
    const svg = renderMindmapForExport(content, 'dark', darkPalette);
    expect(svg).toBeTruthy();
    expect(svg).toContain('<svg');
  });

  // ── Fit-to-canvas (interactive) ─────────────────────────────

  const renderInteractive = (content: string, w: number, h: number) => {
    const parsed = parseMindmap(content, palette);
    const layout = layoutMindmap(parsed, palette, { interactive: true });
    const container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({
        width: w,
        height: h,
        top: 0,
        left: 0,
        right: w,
        bottom: h,
      }) as DOMRect;
    renderMindmap(container, parsed, layout, palette, false);
    const g = container.querySelector('svg > g');
    return g?.getAttribute('transform') ?? '';
  };

  const tallTree = `mindmap Tree\n${Array.from(
    { length: 24 },
    (_, i) => `  Node ${i + 1}`
  ).join('\n')}`;

  it('shrinks a tall tree to fit a short canvas (scale < 1)', () => {
    const transform = renderInteractive(tallTree, 1300, 360);
    const m = transform.match(/scale\(([\d.]+)\)/);
    expect(m).toBeTruthy();
    expect(parseFloat(m![1])).toBeLessThan(1);
  });

  it('does not scale up when the canvas is roomy', () => {
    const transform = renderInteractive(tallTree, 2000, 2000);
    // No scale() segment (or scale 1) → content rendered at natural size.
    expect(transform).not.toMatch(/scale\((?!1\))/);
  });

  it('node (color) suffix is literal — no color resolved', () => {
    const content = `mindmap Root
  Important red
  Normal`;
    const parsed = parseMindmap(content, palette);
    const layout = layoutMindmap(parsed, palette);
    const importantNode = layout.nodes.find((n) => n.label === 'Important red');
    const normalNode = layout.nodes.find((n) => n.label === 'Normal');
    // Neither should have an explicit color
    expect(importantNode?.color).toBeUndefined();
    expect(normalNode?.color).toBeUndefined();
  });
});

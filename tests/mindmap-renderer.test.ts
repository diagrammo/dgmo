import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseMindmap } from '../src/mindmap/parser';
import { layoutMindmap } from '../src/mindmap/layout';
import { renderMindmapForExport } from '../src/mindmap/renderer';
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

  it('no-descriptions suppresses description text', () => {
    const content = readFileSync(
      resolve(FIXTURE_DIR, 'tags-and-colors.dgmo'),
      'utf-8'
    );
    const svg = renderMindmapForExport(content, 'light', palette);
    // The description "This should be hidden" should not appear
    expect(svg).not.toContain('This should be hidden');
  });

  it('renders with dark theme', () => {
    const darkPalette = getPalette('bold').dark;
    const content = readFileSync(resolve(FIXTURE_DIR, 'basic.dgmo'), 'utf-8');
    const svg = renderMindmapForExport(content, 'dark', darkPalette);
    expect(svg).toBeTruthy();
    expect(svg).toContain('<svg');
  });

  it('node (color) suffix is literal — no color resolved', () => {
    const content = `mindmap Root
  Important(red)
  Normal`;
    const parsed = parseMindmap(content, palette);
    const layout = layoutMindmap(parsed, palette);
    const importantNode = layout.nodes.find(
      (n) => n.label === 'Important(red)'
    );
    const normalNode = layout.nodes.find((n) => n.label === 'Normal');
    // Neither should have an explicit color
    expect(importantNode?.color).toBeUndefined();
    expect(normalNode?.color).toBeUndefined();
  });
});

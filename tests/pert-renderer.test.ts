import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { renderPert, renderPertForExport } from '../src/pert/renderer';
import { parsePert } from '../src/pert/parser';
import { analyzePert } from '../src/pert/analyzer';
import { relayoutPert } from '../src/pert/layout';
import { getPalette } from '../src/palettes';

const FIXTURES = join(__dirname, '../test-fixtures/pert');
function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

beforeAll(() => {
  // jsdom is set up automatically by vitest's environment, but
  // renderPertForExport touches `document` directly so we make sure the
  // global is available across test workers.
  if (typeof document === 'undefined') {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    Object.defineProperty(globalThis, 'document', {
      value: dom.window.document,
    });
    Object.defineProperty(globalThis, 'window', { value: dom.window });
  }
});

const FIXTURE_NAMES = [
  'basic.dgmo',
  'three-point.dgmo',
  'with-groups.dgmo',
  'with-milestones.dgmo',
  'with-aliases.dgmo',
  'tbd-poison.dgmo',
  'pirate-voyage.dgmo',
];

// Snapshot suite: each fixture × {nord light, tokyo-night dark}. Keeps
// the snapshot count manageable in Phase 1 while still asserting both
// light and dark output across two palettes; remaining palettes/themes
// are covered by the structural assertions below.
describe('pert renderer — snapshots', () => {
  for (const name of FIXTURE_NAMES) {
    for (const palette of ['nord', 'tokyo-night'] as const) {
      for (const theme of ['light', 'dark'] as const) {
        it(`${name} | ${palette} | ${theme}`, () => {
          const colors = getPalette(palette)[theme];
          const svg = renderPertForExport(loadFixture(name), theme, colors);
          expect(svg).toMatchSnapshot();
        });
      }
    }
  }
});

// Structural assertions: walk the SVG DOM and check the data attributes
// and counts. This catches regressions that don't change the source-text
// snapshot but break the interactivity contract.
describe('pert renderer — structural assertions', () => {
  function renderForTest(input: string) {
    const colors = getPalette('nord').light;
    return renderPertForExport(input, 'light', colors);
  }

  function parseDom(svg: string): Document {
    const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
    return dom.window.document;
  }

  it('every activity g wrapper carries data-activity-id and data-line-number', () => {
    const svg = renderForTest(loadFixture('basic.dgmo'));
    const doc = parseDom(svg);
    const nodes = doc.querySelectorAll('g.pert-node');
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(n.getAttribute('data-activity-id')).not.toBeNull();
      expect(n.getAttribute('data-line-number')).not.toBeNull();
      // Children must NOT carry data-line-number (per CLAUDE.md gotcha).
      for (const child of n.children) {
        expect(child.getAttribute('data-line-number')).toBeNull();
        expect(child.getAttribute('data-activity-id')).toBeNull();
      }
    }
  });

  it('critical-path edges carry data-critical="true"', () => {
    const svg = renderForTest(loadFixture('three-point.dgmo'));
    const doc = parseDom(svg);
    const edges = doc.querySelectorAll('path.pert-edge[data-critical="true"]');
    expect(edges.length).toBeGreaterThan(0);
  });

  it('milestone activities render as polygon (diamond), not rect', () => {
    const svg = renderForTest(loadFixture('with-milestones.dgmo'));
    const doc = parseDom(svg);
    const milestones = doc.querySelectorAll(
      'g.pert-node[data-activity-id="voyage approved"] polygon, ' +
        'g.pert-node[data-activity-id="landfall"] polygon'
    );
    expect(milestones.length).toBeGreaterThan(0);
  });

  it('TBD activity nodes use dashed stroke', () => {
    const svg = renderForTest(loadFixture('tbd-poison.dgmo'));
    const doc = parseDom(svg);
    // celebrate's wrapper carries data-activity-id="celebrate"; its rect
    // child should have stroke-dasharray.
    const celebrate = doc.querySelector(
      'g.pert-node[data-activity-id="celebrate"] rect'
    );
    expect(celebrate).not.toBeNull();
    expect(celebrate!.getAttribute('stroke-dasharray')).toBe('4,3');
  });

  it('summary box appears in the SVG', () => {
    const svg = renderForTest(loadFixture('basic.dgmo'));
    expect(svg).toContain('Project μ:');
  });

  it('handles empty content without throwing', () => {
    expect(() => renderForTest('pert\n')).not.toThrow();
  });

  it('expandedActivityId emits a foreignObject content slot in place of rect+text', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);

    const parsed = parsePert(loadFixture('basic.dgmo'));
    const resolved = analyzePert(parsed);
    const expandedId = resolved.activities[0]!.activity.id;
    const layout = relayoutPert(resolved, {
      [expandedId]: { width: 280, height: 180 },
    });
    const colors = getPalette('nord').light;
    renderPert(c as HTMLDivElement, resolved, layout, colors, false, {
      title: parsed.title,
      expandedActivityId: expandedId,
    });

    const expandedG = c.querySelector(
      `g.pert-node[data-activity-id="${expandedId}"]`
    );
    expect(expandedG).not.toBeNull();
    // Slot present, rect/name-text suppressed
    expect(
      expandedG!.querySelector('foreignObject.pert-node-expanded-slot')
    ).not.toBeNull();
    expect(
      expandedG!.querySelector('[data-pert-expanded-content]')
    ).not.toBeNull();
    expect(expandedG!.querySelector(':scope > rect')).toBeNull();

    // Other activities still render as rect+text normally
    const otherG = c.querySelector(
      `g.pert-node:not([data-activity-id="${expandedId}"])`
    );
    expect(otherG?.querySelector('rect')).not.toBeNull();
    expect(otherG?.querySelector('foreignObject')).toBeNull();

    document.body.removeChild(c);
  });

  it('renders cleanly across all 10 palettes (smoke)', () => {
    const palettes = [
      'nord',
      'solarized',
      'catppuccin',
      'rose-pine',
      'gruvbox',
      'tokyo-night',
      'one-dark',
      'bold',
      'dracula',
      'monokai',
    ] as const;
    for (const p of palettes) {
      const colors = getPalette(p).light;
      const svg = renderPertForExport(
        loadFixture('basic.dgmo'),
        'light',
        colors
      );
      expect(svg).toContain('<svg');
    }
  });
});

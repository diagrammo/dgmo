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

  it('milestone activities render with the textbook card just like activities', () => {
    const svg = renderForTest(loadFixture('with-milestones.dgmo'));
    const doc = parseDom(svg);
    const milestoneIds = ['voyage approved', 'landfall'];
    for (const id of milestoneIds) {
      const wrapper = doc.querySelector(
        `g.pert-node[data-activity-id="${id}"]`
      );
      expect(wrapper).not.toBeNull();
      // Same rect treatment as activities — no diamond polygon.
      expect(wrapper!.querySelector('polygon')).toBeNull();
      expect(wrapper!.querySelector('rect')).not.toBeNull();
      // Textbook 3×3 grid: 6 internal divider lines (2 horizontal, 4
      // vertical-half-row segments).
      expect(wrapper!.querySelectorAll('line').length).toBe(6);
      // 7 text cells: ES, dur, EF, name, LS, slack, LF.
      expect(wrapper!.querySelectorAll('text').length).toBe(7);
    }
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

  it('handles empty content without throwing', () => {
    expect(() => renderForTest('pert\n')).not.toThrow();
  });

  it('every activity renders the textbook 3×3 card (7 text cells, 6 grid lines)', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);

    const parsed = parsePert(loadFixture('basic.dgmo'));
    const resolved = analyzePert(parsed);
    const layout = relayoutPert(resolved, {});
    const colors = getPalette('nord').light;
    renderPert(c as HTMLDivElement, resolved, layout, colors, false, {
      title: parsed.title,
    });

    const wrappers = c.querySelectorAll('g.pert-node');
    expect(wrappers.length).toBeGreaterThan(0);
    for (const w of wrappers) {
      // 7 cells: ES, dur, EF, name, LS, slack, LF.
      expect(w.querySelectorAll('text').length).toBe(7);
      // 6 grid divider segments (2 horizontal full-width, 2 vertical
      // top-row, 2 vertical bottom-row).
      expect(w.querySelectorAll('line').length).toBe(6);
    }

    document.body.removeChild(c);
  });

  it('collapsedGroupIds hides interior activities and adds rolled-up summary', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);

    const parsed = parsePert(loadFixture('with-groups.dgmo'));
    const resolved = analyzePert(parsed);
    const groupId = resolved.groups[0]!.group.id;
    const memberIds = new Set(resolved.groups[0]!.group.activityIds);

    const layout = relayoutPert(resolved, {}, new Set([groupId]));
    const colors = getPalette('nord').light;
    renderPert(c as HTMLDivElement, resolved, layout, colors, false, {
      title: parsed.title,
      collapsedGroupIds: [groupId],
    });

    // The group wrapper carries data-collapsed="true" and renders the
    // rolled-up envelope as a textbook 3×3 card with the group name in
    // the middle band.
    const groupG = c.querySelector(`g.pert-group[data-group-id="${groupId}"]`);
    expect(groupG).not.toBeNull();
    expect(groupG!.getAttribute('data-collapsed')).toBe('true');
    // 7 text cells: ES, dur, EF, group name, LS, slack, LF.
    expect(groupG!.querySelectorAll('text').length).toBe(7);

    // Interior activities are skipped — no .pert-node for any member id.
    for (const id of memberIds) {
      expect(
        c.querySelector(`g.pert-node[data-activity-id="${id}"]`)
      ).toBeNull();
    }

    // Internal-only edges (both endpoints inside the collapsed group)
    // are suppressed; cross-boundary edges still render.
    for (const e of resolved.edges) {
      const path = c.querySelector(
        `path.pert-edge[data-source="${e.source}"][data-target="${e.target}"]`
      );
      const internal = memberIds.has(e.source) && memberIds.has(e.target);
      if (internal) {
        expect(path).toBeNull();
      }
    }

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

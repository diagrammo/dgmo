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
  'start-date.dgmo',
  'end-date.dgmo',
  'backward-tbd.dgmo',
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

  it('critical-path edges also carry data-critical-path="true" (mirror of nodes)', () => {
    const svg = renderForTest(loadFixture('three-point.dgmo'));
    const doc = parseDom(svg);
    const cp = doc.querySelectorAll(
      'path.pert-edge[data-critical-path="true"]'
    );
    const cpLegacy = doc.querySelectorAll(
      'path.pert-edge[data-critical="true"]'
    );
    expect(cp.length).toBe(cpLegacy.length);
    expect(cp.length).toBeGreaterThan(0);
  });

  it('group g wrappers carry data-critical-path matching member criticality', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);

    const parsed = parsePert(loadFixture('with-groups.dgmo'));
    const resolved = analyzePert(parsed);
    const layout = relayoutPert(resolved, {});
    const colors = getPalette('nord').light;
    renderPert(c as HTMLDivElement, resolved, layout, colors, false, {
      title: parsed.title,
    });

    const groupEls = c.querySelectorAll('g.pert-group');
    expect(groupEls.length).toBeGreaterThan(0);
    for (const g of groupEls) {
      const groupId = g.getAttribute('data-group-id')!;
      const memberCritical = resolved.activities.some(
        (a) => a.activity.groupId === groupId && a.isCriticalPath
      );
      expect(g.getAttribute('data-critical-path')).toBe(String(memberCritical));
    }

    document.body.removeChild(c);
  });

  it('highlightPertCriticalPath fades non-critical activities', async () => {
    const { highlightPertCriticalPath, resetPertCriticalPath } =
      await import('../src/pert/renderer');
    const c = document.createElement('div');
    document.body.appendChild(c);

    const parsed = parsePert(loadFixture('three-point.dgmo'));
    const resolved = analyzePert(parsed);
    const layout = relayoutPert(resolved, {});
    const colors = getPalette('nord').light;
    renderPert(c as HTMLDivElement, resolved, layout, colors, false, {
      title: parsed.title,
    });

    highlightPertCriticalPath(c);
    const svg = c.querySelector('svg')!;
    expect(svg.getAttribute('data-critical-path-active')).toBe('true');

    const fadedNodes = c.querySelectorAll('g.pert-node[opacity="0.15"]');
    const fullNodes = c.querySelectorAll('g.pert-node[opacity="1"]');
    // Some critical, some not — both buckets must be non-empty for the
    // fade to be doing something useful.
    expect(fadedNodes.length).toBeGreaterThan(0);
    expect(fullNodes.length).toBeGreaterThan(0);

    resetPertCriticalPath(c);
    expect(svg.getAttribute('data-critical-path-active')).toBeNull();
    expect(c.querySelectorAll('g.pert-node[opacity]').length).toBe(0);

    document.body.removeChild(c);
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

  it('AC19: caption emits one tspan per bullet, prefixed with •; first has no dy, others have pixel dy', () => {
    const svg = renderForTest(loadFixture('three-point.dgmo'));
    const doc = parseDom(svg);
    const captions = doc.querySelectorAll('text.pert-caption');
    expect(captions.length).toBe(1);
    const tspans = captions[0]!.querySelectorAll('tspan');
    expect(tspans.length).toBeGreaterThan(0);
    expect(tspans[0]!.getAttribute('dy')).toBeNull();
    expect(tspans[0]!.textContent?.startsWith('• ')).toBe(true);
    for (let i = 1; i < tspans.length; i++) {
      const dy = tspans[i]!.getAttribute('dy');
      expect(dy).not.toBeNull();
      expect(/^\d+(\.\d+)?$/.test(dy!)).toBe(true);
      expect(tspans[i]!.textContent?.startsWith('• ')).toBe(true);
    }
  });

  it('AC20: caption renders below the diagram, wrapped in a node-styled rect', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const parsed = parsePert(loadFixture('basic.dgmo'));
    const resolved = analyzePert(parsed);
    const layout = relayoutPert(resolved, {});
    const colors = getPalette('nord').light;
    renderPert(c as HTMLDivElement, resolved, layout, colors, false, {
      title: parsed.title,
    });
    const block = c.querySelector('g.pert-caption-block');
    expect(block).not.toBeNull();
    expect(block!.querySelector('rect.pert-caption-rect')).not.toBeNull();
    // Caption rect Y is below every node g's transform Y.
    const captionRect = block!.querySelector('rect')!;
    const captionY = parseFloat(captionRect.getAttribute('y')!);
    const nodeYs = Array.from(c.querySelectorAll('g.pert-node')).map((n) => {
      const t = n.getAttribute('transform') ?? '';
      const m = t.match(/translate\(\s*[\d.]+\s*,\s*([\d.]+)/);
      return m ? parseFloat(m[1]) : 0;
    });
    const lastNodeBottom = Math.max(...nodeYs);
    expect(captionY).toBeGreaterThan(lastNodeBottom);
    document.body.removeChild(c);
  });

  it('AC21: TB and LR layouts produce byte-identical summaryText', () => {
    const lr = `pert
direction LR
A 1 2 4
B 1 2 4
A
  -> B
`;
    const tb = `pert
direction TB
A 1 2 4
B 1 2 4
A
  -> B
`;
    const resLr = analyzePert(parsePert(lr));
    const resTb = analyzePert(parsePert(tb));
    expect(resLr.summaryText).toBe(resTb.summaryText);
  });

  it('AC25: monte-carlo.dgmo (with deprecated `analysis monte-carlo`) still renders', () => {
    // The directive now warns but does not block rendering. SVG must
    // contain a caption and the chart body.
    const svg = renderForTest(loadFixture('monte-carlo.dgmo'));
    expect(svg).toContain('<svg');
    expect(svg).toContain('class="pert-caption"');
    expect(svg).toContain('class="pert-node"');
  });

  it('AC27: cycle bailout emits no caption element', () => {
    const svg = renderForTest(loadFixture('cycle-error.dgmo'));
    const doc = parseDom(svg);
    expect(doc.querySelectorAll('text.pert-caption').length).toBe(0);
  });

  it('TBD-fallback caption: legend still emits Field labels bullet', () => {
    const svg = renderForTest(loadFixture('tbd-poison.dgmo'));
    const doc = parseDom(svg);
    const tspans = doc.querySelectorAll('text.pert-caption tspan');
    expect(tspans.length).toBeGreaterThan(0);
    expect(tspans[0]!.textContent).toContain('Field labels');
  });

  it('AC12: hidden-risk activity inside collapsed group surfaces the group name', () => {
    // Diamond with a high-criticality off-CPM arm inside a group. Both
    // arms are similar length so C lands on the critical path often
    // enough to clear the 0.25 threshold. Collapse the group at render
    // time → caption should name the group, not C.
    const c = document.createElement('div');
    document.body.appendChild(c);
    const src = `pert
time-unit w
trials 2000
seed 7

A 1 1 1
B 4 5 6
[hidden-team]
  C 4 5 6
D 1 1 1

A
  -> B
  -> C
B
  -> D
C
  -> D
`;
    const parsed = parsePert(src);
    const resolved = analyzePert(parsed);
    const groupId = resolved.groups[0]!.group.id;
    // Sanity: the group must actually contain C so the collapse-aware
    // hidden-risk substitution has something to find.
    expect(resolved.groups[0]!.group.activityIds).toContain('c');
    const layout = relayoutPert(resolved, {}, new Set([groupId]));
    const colors = getPalette('nord').light;
    renderPert(c as HTMLDivElement, resolved, layout, colors, false, {
      title: parsed.title,
      collapsedGroupIds: [groupId],
    });
    const captionText = c.querySelector('text.pert-caption')!.textContent ?? '';
    // Hidden-risk sentence may or may not fire (criticality depends on
    // seed). When it does, it MUST name the group, never the inner
    // activity.
    if (captionText.includes('lands on the critical path')) {
      expect(captionText).toContain('hidden-team (collapsed)');
      expect(/\bC lands on the critical path/.test(captionText)).toBe(false);
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

describe('pert renderer — date anchoring', () => {
  function renderForTest(input: string) {
    const colors = getPalette('nord').light;
    return renderPertForExport(input, 'light', colors);
  }

  it('forward anchor: source ES renders as the literal start-date', () => {
    // recruit crew is the first activity after the milestone, so its
    // ES is the start-date carried through. Renderer formats as ISO.
    const svg = renderForTest(loadFixture('start-date.dgmo'));
    expect(svg).toContain('2026-06-01');
    // No D10 annotation in forward mode.
    expect(svg).not.toContain('Backward-anchored');
  });

  it('backward anchor: D10 italic annotation names end-date AND derived projectStart', () => {
    const svg = renderForTest(loadFixture('end-date.dgmo'));
    // Annotation names BOTH dates so the reader sees the schedule
    // envelope at a glance (per F11 review fix).
    expect(svg).toContain('end-date 2026-09-15');
    expect(svg).toContain('project start');
    expect(svg).toContain('Backward-anchored');
    expect(svg).toContain('font-style="italic"');
    expect(svg).toContain('class="pert-anchor-annotation"');
  });

  it('backward anchor + TBD upstream: schedule cells fall back to "?"', () => {
    const svg = renderForTest(loadFixture('backward-tbd.dgmo'));
    // Annotation still names the end-date, even when projectStart can't
    // be derived because of upstream TBDs (uses the fallback phrasing).
    expect(svg).toContain('Backward-anchored from end-date 2026-09-15');
    expect(svg).toContain('Project start is unknown');
    // No date strings should appear in node bodies — projectStart is null
    // so every schedule cell renders nullLabel='?'.
    expect(svg).not.toContain('2026-09-15</text>');
    expect(svg).not.toContain('2026-08-');
  });

  it('unanchored fixtures keep numeric label formatting (regression)', () => {
    const svg = renderForTest(loadFixture('basic.dgmo'));
    // No anchor present, so no ISO-date strings should leak in.
    expect(svg).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

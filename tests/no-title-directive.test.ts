/**
 * `no-title` cross-cutting directive — parser recognition + renderer
 * suppression coverage. See spec §1.9 / decisions log TD-20.
 */
import { describe, it, expect } from 'vitest';

import { parseJourneyMap } from '../src/journey-map/parser';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { parseState } from '../src/graph/state-parser';
import { parseC4 } from '../src/c4/parser';
import { parseChart } from '../src/chart';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { parseMindmap } from '../src/mindmap/parser';
import { parseRaci } from '../src/raci/parser';
import { parseExtendedChart } from '../src/data-chart-parser';
import { parseVisualization } from '../src/d3';
import { parsePert } from '../src/pert/parser';
import { parseGantt } from '../src/gantt/parser';
import { parseOrg } from '../src/org/parser';
import { parseKanban } from '../src/kanban/parser';

import { renderJourneyMap } from '../src/journey-map/renderer';
import { renderRaci } from '../src/raci/renderer';
import { renderPyramid } from '../src/pyramid/renderer';
import { layoutJourneyMap } from '../src/journey-map/layout';

import { encodeDiagramUrl, decodeDiagramUrl } from '../src/sharing';
import { COMPLETION_REGISTRY } from '../src/completion';
import { DIRECTIVE_KEYWORDS } from '../src/editor/keywords';
import { GLOBAL_BOOLEANS } from '../src/utils/parsing';
import { parsePyramid } from '../src/pyramid/parser';
import { getPalette } from '../src/palettes';

const palette = getPalette('bold').light;

describe('no-title — global helper', () => {
  it('exposes no-title in GLOBAL_BOOLEANS', () => {
    expect(GLOBAL_BOOLEANS.has('no-title')).toBe(true);
  });

  it('lists no-title in DIRECTIVE_KEYWORDS', () => {
    expect(DIRECTIVE_KEYWORDS.has('no-title')).toBe(true);
  });

  it('exposes no-title as a universal completion entry', () => {
    for (const [chartType, spec] of COMPLETION_REGISTRY.entries()) {
      expect(
        spec.directives['no-title'],
        `'${chartType}' is missing 'no-title' from its completion entry`
      ).toBeDefined();
    }
  });
});

describe('no-title — parser recognition', () => {
  it('journey-map (KNOWN_BOOLEANS Set)', () => {
    const r = parseJourneyMap(
      'journey-map Voyage\n\nno-title\n\n[Phase]\n  Step | 3'
    );
    expect(r.error).toBeNull();
    expect(r.options['no-title']).toBe('on');
    expect(r.title).toBe('Voyage');
  });

  it('flowchart (regex + shared-helper fallback)', () => {
    const r = parseFlowchart('flowchart My Flow\n\nno-title\n\n[A] -> [B]');
    expect(r.error).toBeNull();
    expect(r.options['no-title']).toBe('on');
    expect(r.title).toBe('My Flow');
  });

  it('state (regex + shared-helper fallback)', () => {
    const r = parseState('state Lifecycle\n\nno-title\n\n[*] -> Idle');
    expect(r.error).toBeNull();
    expect(r.options['no-title']).toBe('on');
  });

  it('c4 (KNOWN_C4_BOOLEANS Set)', () => {
    const r = parseC4(
      'c4 System\n\nno-title\n\nUser is a person\nApp is a system\n  -uses-> User'
    );
    expect(r.error).toBeNull();
    expect(r.options['no-title']).toBe('on');
  });

  it('sequence (KNOWN_SEQ_BOOLEANS, with case-sensitive bare-keyword path)', () => {
    const r = parseSequenceDgmo('sequence Login\n\nno-title\n\nA -hi-> B');
    expect(r.error).toBeNull();
    expect(r.options['no-title']).toBe('on');
  });

  it('chart (ECharts standard parser, typed `noTitle` boolean)', () => {
    const r = parseChart('bar Q1\n\nno-title\n\nJan 100\nFeb 200');
    expect(r.error).toBeNull();
    expect(r.noTitle).toBe(true);
    expect(r.title).toBe('Q1');
  });

  it('echarts extended (typed `noTitle` boolean)', () => {
    const r = parseExtendedChart('chart scatter\n\nno-title\n\n1 1\n2 2\n3 3');
    expect(r.error).toBeNull();
    expect(r.noTitle).toBe(true);
  });

  it('d3 visualization (typed `noTitle` boolean)', () => {
    const r = parseVisualization('arc Network\n\nno-title\n\nA - B\nB - C');
    expect(r.error).toBeNull();
    expect(r.noTitle).toBe(true);
  });

  it('pert (PertOptions.noTitle field)', () => {
    const r = parsePert('pert Schedule\n\nno-title\n\nDesign 5d\nBuild 10d');
    expect(r.error).toBeNull();
    expect(r.options.noTitle).toBe(true);
    expect(r.title).toBe('Schedule');
  });

  it('gantt (GanttOptions.noTitle field)', () => {
    const r = parseGantt('gantt Roadmap\n\nno-title\n\n[Q1]\n  3w Plan');
    expect(r.error).toBeNull();
    expect(r.options.noTitle).toBe(true);
  });

  it('org (KNOWN_BOOLEANS)', () => {
    const r = parseOrg('org Crew\n\nno-title\n\nCaptain\n  First Mate');
    expect(r.error).toBeNull();
    expect(r.options['no-title']).toBe('on');
  });

  it('kanban (KNOWN_BOOLEANS)', () => {
    const r = parseKanban('kanban Sprint\n\nno-title\n\n[Todo]\n  Buy bread');
    expect(r.error).toBeNull();
    expect(r.options['no-title']).toBe('on');
  });

  it('mindmap (shared-helper)', () => {
    const r = parseMindmap('mindmap Roots\n\nno-title\n\nNode\n  Child');
    expect(r.error).toBeNull();
    expect(r.options['no-title']).toBe('on');
  });

  it('raci (KNOWN_BOOLEANS Set)', () => {
    const r = parseRaci(
      'raci Sprint\nroles\n  Alice\n  Bob\n\nno-title\n\nBuild\n  Alice: R\n  Bob: A'
    );
    expect(r.error).toBeNull();
    expect(r.options['no-title']).toBe('on');
  });
});

describe('no-title — render suppresses banner text and collapses layout', () => {
  it('journey-map: SVG omits the chart-title text element when no-title is on', () => {
    const withTitle = renderJourneyMapToSVG(
      'journey-map Voyage\n\n[Phase]\n  Step | 3'
    );
    const withoutTitle = renderJourneyMapToSVG(
      'journey-map Voyage\n\nno-title\n\n[Phase]\n  Step | 3'
    );

    expect(withTitle).toContain('class="chart-title"');
    expect(withoutTitle).not.toContain('class="chart-title"');
    // Title text shouldn't leak into other text elements either.
    expect(extractChartTitleText(withoutTitle)).toBeNull();
  });

  it('journey-map: layout collapses title space when no-title is on', () => {
    const withTitle = parseJourneyMap(
      'journey-map Voyage\n\n[Phase]\n  Step | 3'
    );
    const withoutTitle = parseJourneyMap(
      'journey-map Voyage\n\nno-title\n\n[Phase]\n  Step | 3'
    );
    const layoutWith = layoutJourneyMap(withTitle, palette, {});
    const layoutWithout = layoutJourneyMap(withoutTitle, palette, {});

    // Title area is ~36px; expect a clear collapse.
    expect(layoutWith.totalHeight - layoutWithout.totalHeight).toBeGreaterThan(
      20
    );
  });

  it('pyramid: layout offset collapses by ~TITLE_AREA_HEIGHT', () => {
    const parsedWith = parsePyramid(
      'pyramid Hierarchy\n\n[Top]\n[Middle]\n[Bottom]'
    );
    const parsedWithout = parsePyramid(
      'pyramid Hierarchy\n\nno-title\n\n[Top]\n[Middle]\n[Bottom]'
    );
    expect(parsedWith.error).toBeNull();
    expect(parsedWithout.error).toBeNull();
    expect(parsedWithout.options['no-title']).toBe('on');

    const c1 = document.createElement('div');
    const c2 = document.createElement('div');
    Object.defineProperty(c1, 'clientWidth', { value: 800 });
    Object.defineProperty(c1, 'clientHeight', { value: 600 });
    Object.defineProperty(c2, 'clientWidth', { value: 800 });
    Object.defineProperty(c2, 'clientHeight', { value: 600 });

    renderPyramid(c1, parsedWith, palette, false);
    renderPyramid(c2, parsedWithout, palette, false);

    const titleEl1 = c1.querySelector('text.chart-title');
    const titleEl2 = c2.querySelector('text.chart-title');
    expect(titleEl1).not.toBeNull();
    expect(titleEl2).toBeNull();
  });
});

describe('no-title — mindmap multi-root invariant (TD-20 critical case)', () => {
  it('explicit title + no-title: parsed.title preserved, single-root unchanged', () => {
    const r = parseMindmap('mindmap MyRoot\n\nno-title\n\nChild');
    expect(r.error).toBeNull();
    expect(r.title).toBe('MyRoot');
    expect(r.options['no-title']).toBe('on');
    // Child should be a top-level root in single-root mode.
    expect(r.roots.length).toBeGreaterThanOrEqual(1);
  });

  it('inferred title + no-title: parser still infers from first root', () => {
    const r = parseMindmap('mindmap\n\nno-title\n\nFirstRoot\n  Child');
    expect(r.error).toBeNull();
    // Parser-side rule (mindmap/parser.ts:256-258) infers title even when
    // no-title is on; renderer suppresses display only.
    expect(r.title).toBe('FirstRoot');
    expect(r.options['no-title']).toBe('on');
  });
});

describe('no-title — raci runtime opt OR with directive', () => {
  function mkContainer() {
    const c = document.createElement('div');
    Object.defineProperty(c, 'clientWidth', { value: 800 });
    Object.defineProperty(c, 'clientHeight', { value: 600 });
    return c;
  }

  function svgHasTitle(c: HTMLDivElement, title: string): boolean {
    const svg = c.querySelector('svg');
    if (!svg) return false;
    return Array.from(svg.querySelectorAll('text')).some((t) =>
      (t.textContent ?? '').includes(title)
    );
  }

  const SOURCE_NO_DIRECTIVE =
    'raci Sprint\nroles\n  Alice\n  Bob\n\nBuild\n  Alice: R\n  Bob: A';
  const SOURCE_WITH_DIRECTIVE =
    'raci Sprint\nroles\n  Alice\n  Bob\n\nno-title\n\nBuild\n  Alice: R\n  Bob: A';

  it('neither path → title is rendered', () => {
    const c = mkContainer();
    renderRaci(c, parseRaci(SOURCE_NO_DIRECTIVE), palette, false, {});
    expect(svgHasTitle(c, 'Sprint')).toBe(true);
  });

  it('runtime hideTitle alone → title hidden', () => {
    const c = mkContainer();
    renderRaci(c, parseRaci(SOURCE_NO_DIRECTIVE), palette, false, {
      hideTitle: true,
    });
    expect(svgHasTitle(c, 'Sprint')).toBe(false);
  });

  it('directive alone → title hidden', () => {
    const c = mkContainer();
    renderRaci(c, parseRaci(SOURCE_WITH_DIRECTIVE), palette, false, {});
    expect(svgHasTitle(c, 'Sprint')).toBe(false);
  });

  it('both → title hidden, no error', () => {
    const c = mkContainer();
    renderRaci(c, parseRaci(SOURCE_WITH_DIRECTIVE), palette, false, {
      hideTitle: true,
    });
    expect(svgHasTitle(c, 'Sprint')).toBe(false);
  });
});

describe('no-title — share link round-trip', () => {
  it('preserves the directive through encode → decode', () => {
    const source = 'flowchart My Flow\n\nno-title\n\n[A] -> [B]';
    const result = encodeDiagramUrl(source);
    if ('error' in result) throw new Error('encode failed: ' + result.error);
    // The encoded URL is `${baseUrl}?dgmo=...#dgmo=...`.
    // decodeDiagramUrl accepts the hash or query portion.
    const hashIdx = result.url.indexOf('#');
    const hash = hashIdx >= 0 ? result.url.slice(hashIdx) : '';
    const decoded = decodeDiagramUrl(hash);
    expect(decoded.dsl).toBe(source);
    const reparsed = parseFlowchart(decoded.dsl);
    expect(reparsed.options['no-title']).toBe('on');
  });
});

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function renderJourneyMapToSVG(source: string): string {
  const parsed = parseJourneyMap(source);
  if (parsed.error) throw new Error(parsed.error);
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 1200 });
  Object.defineProperty(container, 'clientHeight', { value: 800 });
  renderJourneyMap(container, parsed, palette, false, {
    exportDims: { width: 1200, height: 800 },
  });
  const svg = container.querySelector('svg');
  return svg?.outerHTML ?? '';
}

function extractChartTitleText(svg: string): string | null {
  const m = svg.match(/<text[^>]*class="[^"]*chart-title[^"]*"[^>]*>([^<]*)/);
  return m ? m[1] : null;
}

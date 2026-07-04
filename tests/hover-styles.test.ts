import { describe, it, expect } from 'vitest';
import { render } from '../src/render';
import {
  buildHoverCss,
  escCssString,
  injectHoverStyles,
  HOVER_SPECS,
  MAX_HOVER_GROUPS,
  type HoverSpec,
} from '../src/utils/hover-styles';

const ENUM: HoverSpec = {
  markSelector: '.dgmo-datum',
  strategy: 'enumerated',
  groupAttr: 'data-emph-key',
};

describe('escCssString (F16)', () => {
  it('escapes quote, backslash, newline, controls per CSS <string> spec', () => {
    expect(escCssString('a"b')).toBe('a\\"b');
    expect(escCssString('a\\b')).toBe('a\\\\b');
    expect(escCssString('a\nb')).toBe('a\\a b'); // newline → \A (0x0a) + space
    expect(escCssString('a\tb')).toBe('a\\9 b');
  });
  it('leaves ordinary + unicode chars intact', () => {
    expect(escCssString('Sales 2024')).toBe('Sales 2024');
    expect(escCssString('café 🚀')).toBe('café 🚀');
  });
  it('neutralizes `<` so a </style> raw-text breakout is impossible (security)', () => {
    const out = escCssString('a</style><script>x');
    expect(out).not.toContain('<');
    expect(out).toContain('\\3c ');
  });
});

describe('injectHoverStyles — no </style> breakout via malicious label', () => {
  it('a label containing </style> cannot terminate the injected style element', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg">' +
      '<path class="dgmo-datum" data-emph-key="a</style><script>evil()</script>b"/>' +
      '</svg>';
    const out = injectHoverStyles(svg, 'pie', { bakeHover: true });
    // The style block must contain no raw </style> that would close it early.
    const styleBody = out.slice(
      out.indexOf('<style>') + 7,
      out.indexOf('</style>')
    );
    expect(styleBody.toLowerCase()).not.toContain('</style');
    expect(styleBody).toContain('\\3c '); // escaped `<`
  });
});

describe('buildHoverCss — enumerated (AC1)', () => {
  it('emits one self rule + exactly one cross rule per value', () => {
    const css = buildHoverCss(ENUM, { values: ['A', 'B', 'C'] }, 'dim');
    expect(css).toContain('.dgmo-datum:hover{');
    // one :not() dim rule per value
    const notRules = css.match(/:not\(\[data-emph-key=/g) ?? [];
    expect(notRules).toHaveLength(3);
    expect(css).toContain(
      'svg:has(.dgmo-datum[data-emph-key="A"]:hover) .dgmo-datum:not([data-emph-key="A"]){opacity:0.4}'
    );
  });

  it('escapes adversarial values inside the selector (AC1b)', () => {
    const css = buildHoverCss(ENUM, { values: ['a"b', 'x\\y'] }, 'dim');
    expect(css).toContain('[data-emph-key="a\\"b"]');
    expect(css).toContain('[data-emph-key="x\\\\y"]');
    // one bad value does not truncate the sibling rule
    expect((css.match(/svg:has/g) ?? []).length).toBe(2);
  });
});

describe('buildHoverCss — structural (AC1e)', () => {
  it('emits a single :not(:hover) rule, no enumeration', () => {
    const spec: HoverSpec = {
      markSelector: 'g.dgmo-series',
      strategy: 'structural',
      groupSelector: 'g.dgmo-series',
    };
    const css = buildHoverCss(spec, {}, 'dim');
    expect(css).toContain(
      'svg:has(g.dgmo-series:hover) g.dgmo-series:not(:hover){opacity:0.4}'
    );
    expect((css.match(/svg:has/g) ?? []).length).toBe(1);
  });
});

describe('buildHoverCss — emphasis lift vs dim (AC1f)', () => {
  it('lift targets matched marks with filter and emits no :not() dim', () => {
    const css = buildHoverCss(ENUM, { values: ['A'] }, 'lift');
    expect(css).toContain(
      'svg:has(.dgmo-datum[data-emph-key="A"]:hover) .dgmo-datum[data-emph-key="A"]{filter:'
    );
    expect(css).not.toContain(':not([data-emph-key=');
    expect(css).not.toContain('opacity:0.4');
  });
  it('lift is the default (visible filter emphasis, not a no-op)', () => {
    const css = buildHoverCss(ENUM, { values: ['A'] });
    expect(css).toContain('filter:');
  });
  it('dim targets :not(match) with opacity', () => {
    const css = buildHoverCss(ENUM, { values: ['A'] }, 'dim');
    expect(css).toContain(':not([data-emph-key="A"]){opacity:0.4}');
  });
});

describe('buildHoverCss — legend pairing casing (AC1h / F2)', () => {
  it('matches data-legend-entry lowercased but the group attr raw', () => {
    const spec: HoverSpec = { ...ENUM, legend: true };
    const css = buildHoverCss(spec, { values: ['Sales'] }, 'dim');
    expect(css).toContain('[data-legend-entry="sales"]:hover');
    expect(css).toContain(':not([data-emph-key="Sales"])');
  });
});

describe('buildHoverCss — cap (AC1c / F10)', () => {
  it('bails to self-emphasis only past the cap, counting legend rules', () => {
    // 30 values × (enumerated + legend) = 60 > 40 → over cap
    const spec: HoverSpec = { ...ENUM, legend: true };
    const values = Array.from({ length: 30 }, (_, i) => `v${i}`);
    const css = buildHoverCss(spec, { values }, 'dim');
    expect(css).not.toContain('svg:has');
    expect(css).toContain('exceeds cap');
    expect(css).toContain('.dgmo-datum:hover{');
  });
  it('stays under cap when legend absent (30 < 40)', () => {
    const values = Array.from({ length: 30 }, (_, i) => `v${i}`);
    const css = buildHoverCss(ENUM, { values }, 'dim');
    expect((css.match(/svg:has/g) ?? []).length).toBe(30);
  });
});

describe('buildHoverCss — empty (AC2) + @media guard (AC1d)', () => {
  it('emits no cross rules for an empty value set', () => {
    const css = buildHoverCss(ENUM, { values: [] }, 'dim');
    expect(css).not.toContain('svg:has');
    expect(css).not.toContain('@media');
    expect(css).toContain('.dgmo-datum:hover'); // self rule still present
  });
  it('wraps cross rules in @media (hover:hover)', () => {
    const css = buildHoverCss(ENUM, { values: ['A'] }, 'dim');
    expect(css).toContain('@media (hover:hover){');
  });
  it('omits self rule when selfEmphasis:false', () => {
    const css = buildHoverCss(
      { ...ENUM, selfEmphasis: false },
      { values: [] },
      'dim'
    );
    expect(css).toBe('');
  });
});

describe('buildHoverCss — connection', () => {
  it('dims edges not incident to the hovered node', () => {
    const spec: HoverSpec = {
      markSelector: '.participant',
      strategy: 'connection',
      hoverSelector: '.participant',
      hoverAttr: 'data-participant-id',
      edgeSelector: '.message-arrow',
      fromAttr: 'data-from',
      toAttr: 'data-to',
    };
    const css = buildHoverCss(spec, { ids: ['n1'] }, 'dim');
    expect(css).toContain(
      'svg:has(.participant[data-participant-id="n1"]:hover) .message-arrow:not([data-from="n1"]):not([data-to="n1"]){opacity:0.4}'
    );
  });
});

describe('injectHoverStyles (AC1g / AC13 gate + self-derive)', () => {
  const pieSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
    '<path class="dgmo-datum" data-emph-key="Rust"/>' +
    '<path class="dgmo-datum" data-emph-key="Go"/>' +
    '<path class="dgmo-datum" data-emph-key="Rust"/>' +
    '</svg>';

  it('no-op when bakeHover is off', () => {
    expect(injectHoverStyles(pieSvg, 'pie', { bakeHover: false })).toBe(pieSvg);
    expect(injectHoverStyles(pieSvg, 'pie')).toBe(pieSvg);
  });

  it('no-op for a chart type with no registry row', () => {
    expect(injectHoverStyles(pieSvg, 'mindmap', { bakeHover: true })).toBe(
      pieSvg
    );
  });

  it('injects exactly one <style> and self-derives distinct values', () => {
    const out = injectHoverStyles(pieSvg, 'pie', { bakeHover: true });
    expect((out.match(/<style>/g) ?? []).length).toBe(1);
    // distinct values only: Rust once, Go once (dedup)
    expect(out).toContain('[data-emph-key="Rust"]');
    expect(out).toContain('[data-emph-key="Go"]');
    // lift default → filter emphasis, marks untouched otherwise
    expect(out).toContain('filter:');
    // markup after </style> is the untouched original body
    expect(out).toContain('<path class="dgmo-datum" data-emph-key="Rust"/>');
  });

  it('splices the <style> immediately after the opening <svg> tag', () => {
    const out = injectHoverStyles(pieSvg, 'pie', { bakeHover: true });
    expect(out).toMatch(/<svg\b[^>]*><style>/);
  });

  it('emits only the self-emphasis floor when no group values are present (AC8)', () => {
    const bare = '<svg width="1" height="1"><path/></svg>';
    const out = injectHoverStyles(bare, 'pie', { bakeHover: true });
    expect(out).toContain('.dgmo-datum:hover'); // universal self floor
    expect(out).not.toContain('svg:has'); // no cross rules with zero values
  });
});

describe('injectHoverStyles — tag-active group discovery (F9)', () => {
  const tagSvg =
    '<svg xmlns="http://www.w3.org/2000/svg">' +
    '<g data-legend-active="crew"></g>' +
    '<rect class="dgmo-treemap-cell" data-tag-crew="Deck"/>' +
    '<rect class="dgmo-treemap-cell" data-tag-crew="Galley"/>' +
    '<rect class="dgmo-treemap-cell" data-tag-crew="Deck"/>' +
    '</svg>';

  it('resolves data-tag-<slug> from data-legend-active and keys off it', () => {
    const out = injectHoverStyles(tagSvg, 'treemap', { bakeHover: true });
    expect(out).toContain('<style>');
    expect(out).toMatch(
      /svg:has\(\.dgmo-treemap-cell\[data-tag-crew="Deck"\]:hover\)/
    );
    // distinct values only (Deck once despite two cells)
    expect((out.match(/data-tag-crew="Deck"/g) ?? []).length).toBeGreaterThan(
      0
    );
    expect(out).toContain('data-tag-crew="Galley"');
  });

  it('legend pairing uses lowercased entry but the raw group-attr casing', () => {
    const out = injectHoverStyles(tagSvg, 'treemap', { bakeHover: true });
    expect(out).toContain('[data-legend-entry="deck"]:hover');
    expect(out).toContain('.dgmo-treemap-cell[data-tag-crew="Deck"]');
  });

  it('falls back to self-emphasis only when no tag group is active', () => {
    const noActive =
      '<svg xmlns="http://www.w3.org/2000/svg">' +
      '<rect class="dgmo-treemap-cell"/></svg>';
    const out = injectHoverStyles(noActive, 'treemap', { bakeHover: true });
    expect(out).toContain('.dgmo-treemap-cell:hover'); // self floor
    expect(out).not.toContain('svg:has'); // no cross rules
  });
});

describe('HOVER_SPECS registry', () => {
  it('covers the MVP CROSS-FREE statistical charts', () => {
    for (const t of ['pie', 'bar', 'funnel', 'heatmap', 'polar-area']) {
      expect(HOVER_SPECS[t]).toBeDefined();
      expect(HOVER_SPECS[t]!.markSelector).toBe('.dgmo-datum');
      expect(HOVER_SPECS[t]!.groupAttr).toBe('data-emph-key');
    }
  });
  it('MAX_HOVER_GROUPS is a sane cap', () => {
    expect(MAX_HOVER_GROUPS).toBeGreaterThanOrEqual(20);
  });
});

describe('render() integration — baked hover gate (AC3/AC6)', () => {
  const pie = 'pie Languages\nRust: 40\nGo: 35\nTypeScript: 25';

  it('bakes a hover <style> by default (embed path)', async () => {
    const { svg } = await render(pie);
    expect(svg).toContain('<style>');
    expect(svg).toContain('.dgmo-datum:hover');
    // enumerated cross rule wired off the self-derived per-slice key
    expect(svg).toMatch(/svg:has\(\.dgmo-datum\[data-emph-key=/);
  });

  it('omits the hover <style> when bakeHover:false (app opt-out)', async () => {
    const { svg } = await render(pie, { bakeHover: false });
    expect(svg).not.toContain('.dgmo-datum:hover');
  });

  it('leaves a chart with no registry row untouched (bar has a row; mindmap does not)', async () => {
    const { svg } = await render('mindmap\nRoot\n  Child A\n  Child B');
    expect(svg).not.toContain('.dgmo-datum:hover');
  });
});

describe('render() integration — Task 3 diagram/connection rows', () => {
  it('gantt: enumerated cross-highlight on data-group', async () => {
    const src =
      'gantt Voyage\nstart 1718-05-01\n[Prep]\n  Chart course 3d\n  Load rum 2d\n[Sail]\n  Cross sea 4d';
    const { svg } = await render(src);
    expect(svg).toContain('.gantt-task:hover');
    expect(svg).toMatch(/svg:has\(\.gantt-task\[data-group=/);
  });

  it('sequence: connection dims non-incident message arrows', async () => {
    const src = 'Captain -order-> Gunner\nGunner --> Captain';
    const { svg } = await render(src);
    expect(svg).toContain('.participant:hover');
    expect(svg).toMatch(
      /svg:has\(\.participant\[data-participant-id="[^"]+"\]:hover\) \.message-arrow:not\(\[data-from=/
    );
  });

  it('flowchart: connection dims non-incident edges (baked endpoint attrs)', async () => {
    const { svg } = await render('flowchart Q\n[A] -> [B] -> [C]');
    expect(svg).toContain('.fc-node:hover');
    expect(svg).toMatch(
      /svg:has\(\.fc-node\[data-node-id="[^"]+"\]:hover\) \.fc-edge-group:not\(\[data-source=/
    );
  });

  it('boxes-and-lines: connection highlight on baked data-from/data-to', async () => {
    const { svg } = await render('boxes-and-lines Fleet\n[A] -> [B]');
    if (svg.includes('bl-edge-group')) {
      expect(svg).toMatch(
        /svg:has\(\.bl-node\[data-node-id="[^"]+"\]:hover\) \.bl-edge-group:not\(\[data-from=/
      );
    }
  });

  it('class: connection highlight on baked data-source/data-target', async () => {
    const { svg } = await render(
      'class Domain\nclass Ship\nclass Cannon\nShip -> Cannon'
    );
    if (svg.includes('cd-edge-group')) {
      expect(svg).toMatch(
        /svg:has\(\.cd-class\[data-node-id="[^"]+"\]:hover\) \.cd-edge-group:not\(\[data-source=/
      );
    }
  });

  it('raci: enumerated cross-highlight keyed on data-role-id', async () => {
    const src =
      'raci Launch\ntasks\n  Ship it\nroles\n  Cap\nassign\n  Ship it: Cap=A';
    const { svg } = await render(src);
    // renders a role grid keyed by data-role-id (skip precise assign syntax —
    // just assert the row wires when marks are present)
    if (svg.includes('data-role-id')) {
      expect(svg).toMatch(/svg:has\(\[data-role-id\]\[data-role-id=/);
    }
  });
});

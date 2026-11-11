// A static render — the CLI, an export, an embed — draws its legend as a plain
// key: a swatch and the full label. Never the app's interactive capsule, its
// group button, a swimlane or eye switch, an ellipsis or a "+N more"
// (diagrammo/diagrammo#1826).
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { render } from '../src/render';
import { loadMapData } from '../src/map/load-data';
import { renderDataChartD3 } from '../src/charts-d3';
import { parseTransform } from './stress/lint';

const FIXTURES = join(__dirname, '..', 'gallery', 'fixtures');

function firstToken(src: string): string {
  for (const raw of src.split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('//')) continue;
    return l.split(/\s+/)[0]!.toLowerCase();
  }
  return '';
}

/** Every legend group (`data-legend-group`) in the SVG, as DOM elements. */
function legendGroups(svg: string): Element[] {
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  return [...doc.querySelectorAll('[data-legend-group]')];
}

/** What a legend group draws that is a control rather than a key. */
function controlsIn(group: Element): string[] {
  const found: string[] = [];
  for (const rect of group.querySelectorAll('rect')) {
    // The group pill and the capsule behind it are rounded, painted rects.
    // An entry's hit area is transparent and the choropleth ramp is rx=2.
    const rx = Number(rect.getAttribute('rx') ?? 0);
    const fill = rect.getAttribute('fill') ?? '';
    if (rx > 2 && fill !== 'transparent') found.push(`pill rect rx=${rx}`);
  }
  if (group.querySelector('.gantt-swimlane-icon, [data-swimlane-toggle]'))
    found.push('swimlane switch');
  if (group.querySelector('.dgmo-legend-pill-toggle, [class*="eye"]'))
    found.push('eye switch');
  if ((group.getAttribute('style') ?? '').includes('cursor'))
    found.push('pointer cursor');
  for (const text of group.querySelectorAll('text')) {
    const t = text.textContent ?? '';
    if (t.includes('…')) found.push(`truncated "${t}"`);
    if (/^\+\d+ more$/.test(t.trim())) found.push(`"${t.trim()}"`);
  }
  return found;
}

const fixtures = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.dgmo'))
  .sort();

describe('static renders draw a plain legend key (#1826)', async () => {
  const rendered: Array<{ file: string; type: string; svg: string }> = [];
  for (const file of fixtures) {
    const src = readFileSync(join(FIXTURES, file), 'utf8');
    const { svg } = await render(src, {
      theme: 'light',
      mapData: loadMapData,
    });
    rendered.push({ file, type: firstToken(src), svg: svg ?? '' });
  }
  const withLegend = rendered.filter((r) => legendGroups(r.svg).length > 0);

  it('covers the tag-legend types, not a handful', () => {
    const types = new Set(withLegend.map((r) => r.type));
    // Every family that draws a legend through the shared engine: tag
    // groups, data-chart series and the choropleth ramp.
    for (const t of [
      'gantt',
      'sequence',
      'org',
      'kanban',
      'timeline',
      'boxes-and-lines',
      'class',
      'er',
      'sitemap',
      'map',
      'treemap',
      'bar',
      'line',
    ]) {
      expect(types, `no gallery fixture of "${t}" draws a legend`).toContain(t);
    }
  });

  it.each(withLegend.map((r) => [r.file, r.svg] as const))(
    '%s: no pill, button, switch or ellipsis in its legend',
    (_file, svg) => {
      const problems = legendGroups(svg).flatMap(controlsIn);
      expect(problems).toEqual([]);
    }
  );

  it('keeps every entry the author wrote, at full length', async () => {
    const long = 'Quartermaster General of the Western Approaches';
    const src = [
      'gantt Static legend',
      '',
      'start-date 2026-01-05',
      '',
      'tag Role as r',
      '  Command red',
      `  ${long} blue`,
      '  Crew green',
      '',
      'Plan 5d r: Command',
      `  -> Sail 10d r: ${long}`,
      '    -> Land 3d r: Crew',
    ].join('\n');
    const { svg } = await render(src, { theme: 'light', width: 420 });
    const labels = legendGroups(svg ?? '').flatMap((g) =>
      [...g.querySelectorAll('[data-legend-entry] text')].map(
        (t) => t.textContent
      )
    );
    expect(labels).toEqual(['Command', long, 'Crew']);
  });
});

describe("the app's live preview keeps its capsule", () => {
  it('a data chart rendered for the preview still draws the group pill', async () => {
    const src =
      'bar Fleet\n\ngroup\n  Ships blue\n  Guns green\n\nNassau 4 40\nTortuga 6 52\n';
    const preview = await renderDataChartD3(
      src,
      'light',
      undefined,
      { width: 600, height: 400 },
      true
    );
    const stat = await renderDataChartD3(src, 'light', undefined, {
      width: 600,
      height: 400,
    });
    const pills = (svg: string) =>
      legendGroups(svg)
        .flatMap(controlsIn)
        .filter((p) => p.startsWith('pill'));
    expect(pills(preview).length).toBeGreaterThan(0);
    expect(pills(stat)).toEqual([]);
  });
});

// ── A key taller than the preview's row cap still fits its band ─────────

type M = ReturnType<typeof parseTransform>;
const mul = (p: M, q: M): M => [
  p[0] * q[0] + p[2] * q[1],
  p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3],
  p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4],
  p[1] * q[4] + p[3] * q[5] + p[5],
];
/** The element's transform to the root, composed from every ancestor. */
function toRoot(el: Element): M {
  let m: M = [1, 0, 0, 1, 0, 0];
  const chain: Element[] = [];
  for (let e: Element | null = el; e; e = e.parentElement) chain.unshift(e);
  for (const e of chain)
    m = mul(m, parseTransform(e.getAttribute('transform')));
  return m;
}
const absY = (el: Element, y: number): number => {
  const m = toRoot(el);
  return m[1] * 0 + m[3] * y + m[5];
};

/** Bottom of the legend key and top of everything else that draws text. */
function keyAndContent(svg: string): { keyBottom: number; contentTop: number } {
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  let keyBottom = -Infinity;
  for (const hit of doc.querySelectorAll('[data-legend-entry] rect')) {
    const y = Number(hit.getAttribute('y') ?? 0);
    const h = Number(hit.getAttribute('height') ?? 0);
    keyBottom = Math.max(keyBottom, absY(hit, y + h));
  }
  let contentTop = Infinity;
  for (const t of doc.querySelectorAll('text')) {
    if (t.closest('[data-legend-group], .dgmo-legend, [class*="title"]'))
      continue;
    if (!(t.textContent ?? '').trim()) continue;
    contentTop = Math.min(
      contentTop,
      absY(t, Number(t.getAttribute('y') ?? 0))
    );
  }
  return { keyBottom, contentTop };
}

const COLORS = ['blue', 'green', 'orange', 'red', 'purple', 'yellow'];
const TALL = Array.from(
  { length: 14 },
  (_, i) => `Responsibility Area Number ${i + 1}`
);
const tagBlock = (name: string, alias: string): string =>
  [
    `tag ${name} as ${alias}`,
    ...TALL.map((v, i) => `  ${v} ${COLORS[i % 6]}`),
  ].join('\n');

describe('a static key taller than three rows stays above the chart (#1826)', () => {
  const cases: Array<[string, string]> = [
    [
      'block',
      [
        'block Tall key',
        '',
        tagBlock('Area', 'a'),
        '',
        ...TALL.map((v, i) => `[Unit ${i + 1}] a: ${v}`),
      ].join('\n'),
    ],
    [
      'treemap',
      [
        'treemap Tall key',
        '',
        tagBlock('Area', 'a'),
        '',
        ...TALL.flatMap((v, i) => [
          `Group ${i + 1} a: ${v}`,
          `  Leaf ${i + 1} ${10 + i}`,
        ]),
      ].join('\n'),
    ],
    [
      'bracket',
      [
        'bracket Tall key',
        '',
        tagBlock('Area', 'a'),
        '',
        ...TALL.map((v, i) => `Team ${i + 1} a: ${v}`),
        ...TALL.filter((_, i) => i % 2 === 0).map(
          (_, k) => `Team ${2 * k + 1} beats Team ${2 * k + 2} 2-1`
        ),
      ].join('\n'),
    ],
  ];

  it.each(cases)('%s', async (_type, src) => {
    const { svg } = await render(src, { theme: 'light', width: 420 });
    const { keyBottom, contentTop } = keyAndContent(svg ?? '');
    // More than the preview's three rows, so the case tests the static key.
    expect(keyBottom).toBeGreaterThan(3 * 28 + 28);
    expect(contentTop).toBeGreaterThanOrEqual(keyBottom);
  });
});

describe('a static gantt key is placed inside the canvas (#1826)', () => {
  const absX = (el: Element, x: number): number => {
    const m = toRoot(el);
    return m[0] * x + m[4];
  };
  /** [left, right] of every legend entry, and the canvas width. */
  function entrySpans(svg: string): {
    spans: Array<[number, number]>;
    w: number;
  } {
    const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window
      .document;
    const vb = (doc.documentElement.getAttribute('viewBox') ?? '').split(/\s+/);
    const spans: Array<[number, number]> = [];
    for (const hit of doc.querySelectorAll('[data-legend-entry] rect')) {
      const x = Number(hit.getAttribute('x') ?? 0);
      const w = Number(hit.getAttribute('width') ?? 0);
      spans.push([absX(hit, x), absX(hit, x + w)]);
    }
    return { spans, w: Number(vb[2]) };
  }
  const gantt = (n: number, inline: boolean): string =>
    [
      'gantt Wide key',
      ...(inline ? ['legend-inline'] : []),
      '',
      'start-date 2026-01-05',
      '',
      'tag Role as r',
      ...TALL.slice(0, n).map((v, i) => `  ${v} ${COLORS[i % 6]}`),
      '',
      ...TALL.slice(0, n).map((v, i) => `Task ${i + 1} 3d r: ${v}`),
    ].join('\n');

  it.each([
    [14, 600, false],
    [8, 600, false],
    [5, 800, false],
    [2, 1200, true],
  ] as const)(
    '%i entries at width %i (inline %s)',
    async (n, width, inline) => {
      const { svg } = await render(gantt(n, inline), { theme: 'light', width });
      const { spans, w } = entrySpans(svg ?? '');
      expect(spans).toHaveLength(n);
      for (const [l, r] of spans) {
        expect(l).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(w + 0.5);
      }
    }
  );
});

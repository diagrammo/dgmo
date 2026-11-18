import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseChart } from '../src/chart';
import { parseExtendedChart } from '../src/data-chart-parser';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { COMPLETION_REGISTRY } from '../src/completion-registry';
import {
  FOOTER_BOTTOM_PAD,
  FOOTER_LINE_HEIGHT,
  FOOTER_TOP_GAP,
  FOOTER_FONT_SIZE,
  FOOTER_PARAGRAPH_GAP,
  SUBTITLE_FONT_SIZE,
} from '../src/utils/chart-frame';
import { TITLE_FONT_SIZE } from '../src/utils/title-constants';

// The chart frame (#1827): `subtitle` and one `footnote` block with a markdown
// body (#2093), drawn by one shared component around every data chart.

const FRAME = [
  'subtitle Share of revenue by region, fiscal 2025',
  'footnote',
  '  - Figures are unaudited.',
  '  - EMEA includes the Gulf states.',
  '',
  '  **Source:** Company annual report',
  '',
  '  *Chart: Jane Doe*',
].join('\n');

const DATA_TYPES = [
  'bar',
  'line',
  'pie',
  'polar-area',
  'radar',
  'scatter',
  'heatmap',
  'sankey',
  'funnel',
  'function',
];

function fixture(name: string): string {
  return readFileSync(
    resolve(__dirname, `../gallery/fixtures/${name}.dgmo`),
    'utf8'
  );
}

function parse(svg: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  return doc.documentElement as unknown as SVGSVGElement;
}

function num(el: Element | null, name: string): number {
  return Number(el!.getAttribute(name));
}

function translateY(el: Element): number {
  const m = /translate\(\s*[-\d.]+\s*,\s*([-\d.]+)\s*\)/.exec(
    el.getAttribute('transform') ?? ''
  );
  return m ? Number(m[1]) : 0;
}

const BAR = `bar Revenue by region
x-axis Region
y-axis Revenue
North 120
South 95
East 140
West 80
${FRAME}`;

describe('chart frame — parsing', () => {
  it('reads the subtitle and the footnote block on a simple data chart', () => {
    const p = parseChart(BAR);
    expect(p.error).toBeFalsy();
    expect(p.frame).toEqual({
      subtitle: 'Share of revenue by region, fiscal 2025',
      subtitleLineNumber: 8,
      footnote: {
        lines: [
          '• Figures are unaudited.',
          '• EMEA includes the Gulf states.',
          '',
          '**Source:** Company annual report',
          '',
          '*Chart: Jane Doe*',
        ],
        lineNumber: 9,
      },
    });
    expect(p.data.map((d) => d.label)).toEqual([
      'North',
      'South',
      'East',
      'West',
    ]);
    expect(p.diagnostics).toEqual([]);
  });

  it('reads them on an extended data chart', () => {
    const p = parseExtendedChart(`${fixture('scatter')}\n${FRAME}`);
    expect(p.error).toBeFalsy();
    expect(p.frame?.subtitle).toBe('Share of revenue by region, fiscal 2025');
    expect(p.frame?.footnote?.lines).toHaveLength(6);
  });

  it('reads the one-line form as a one-line body', () => {
    const p = parseChart('bar X\nA 1\nfootnote Source: Company report');
    expect(p.frame?.footnote).toEqual({
      lines: ['Source: Company report'],
      lineNumber: 3,
    });
  });

  it('ends the body at the next line in column 1', () => {
    const p = parseChart('bar X\nfootnote First\n  second\n\nA 1\nB 2');
    expect(p.frame?.footnote?.lines).toEqual(['First', 'second']);
    expect(p.data.map((d) => d.label)).toEqual(['A', 'B']);
  });

  it('keeps a body line that starts with note in the footnote', () => {
    for (const src of [
      'bar X\nA 1\nfootnote\n  note that A is provisional',
      'line X\nseries S\nJan 1\nFeb 2\nfootnote\n  note that Feb is provisional',
    ]) {
      const p = parseChart(src);
      expect(p.frame?.footnote?.lines[0], src).toMatch(/^note that/);
      expect(p.diagnostics, src).toEqual([]);
    }
    const s = parseExtendedChart(
      'scatter X\nA 1, 2\nfootnote\n  note that A is provisional'
    );
    expect(s.frame?.footnote?.lines).toEqual(['note that A is provisional']);
  });

  it('leaves a capitalised data row a data row', () => {
    const p = parseChart('bar Sizes\nSource 12\nNote 3\nByline 4\nFootnote 5');
    expect(p.frame).toBeUndefined();
    expect(p.data.map((d) => [d.label, d.value])).toEqual([
      ['Source', 12],
      ['Note', 3],
      ['Byline', 4],
      ['Footnote', 5],
    ]);
  });

  it('reads `note` on a data chart as data, not a footnote', () => {
    const p = parseChart('bar Sizes\nnote 3\nB 4');
    expect(p.frame).toBeUndefined();
  });

  it('leaves a sankey flow from a node named source a flow', () => {
    const p = parseExtendedChart(
      'sankey Energy\nsource -> Grid 5\nGrid -> Homes 5\nfootnote Agency data'
    );
    expect(p.error).toBeFalsy();
    expect(p.frame?.footnote?.lines).toEqual(['Agency data']);
    expect(
      (p as { links?: { source: string; target: string }[] }).links?.map(
        (l) => `${l.source}->${l.target}`
      )
    ).toEqual(['source->Grid', 'Grid->Homes']);
  });

  it('never reads an indented line as a directive', () => {
    const p = parseExtendedChart('sankey Energy\nGrid\n  source 5\n  Homes 3');
    expect(p.frame).toBeUndefined();
  });

  it('warns on an empty footnote, a second footnote, and the removed source and byline', () => {
    const p = parseChart(
      'bar X\nA 1\nsubtitle\nfootnote\nfootnote One\nfootnote Two\nsource Agency\nbyline Jane'
    );
    expect(p.frame?.subtitle).toBeUndefined();
    expect(p.frame?.footnote?.lines).toEqual(['One', '', 'Two']);
    const msgs = p.diagnostics.map((d) => `${d.line}: ${d.message}`);
    expect(msgs).toEqual([
      expect.stringMatching(/^4: "footnote" needs text/),
      expect.stringMatching(/^6: A chart has one footnote block/),
      expect.stringMatching(/^3: "subtitle" needs its text/),
      expect.stringMatching(/^7: "source" is not a keyword/),
      expect.stringMatching(/^8: "byline" is not a keyword/),
    ]);
    expect(p.diagnostics.every((d) => d.severity === 'warning')).toBe(true);
  });

  it('is offered by completion on every data chart type', () => {
    for (const type of DATA_TYPES) {
      const spec = COMPLETION_REGISTRY.get(type)!;
      for (const token of ['subtitle', 'footnote'])
        expect(spec.directives[token], `${type} ${token}`).toBeDefined();
    }
  });
});

describe('chart frame — rendering', () => {
  it('draws nothing extra on a chart without frame directives', async () => {
    const svg = parse(await renderDataChartD3(fixture('bar'), 'light'));
    expect(svg.querySelector('.chart-frame-body')).toBeNull();
    expect(svg.querySelector('.chart-subtitle, .chart-footnote')).toBeNull();
  });

  it.each(DATA_TYPES)(
    '%s: subtitle under the title, footer at the bottom',
    async (type) => {
      const plain = parse(await renderDataChartD3(fixture(type), 'light'));
      const framed = parse(
        await renderDataChartD3(`${fixture(type)}\n${FRAME}`, 'light')
      );
      // A chart that sizes itself grows by the frame's bands, so its plot
      // keeps the height it has without them.
      const w = num(plain, 'width');
      const h = num(framed, 'height');
      expect(num(framed, 'width')).toBe(w);
      const footerBand =
        FOOTER_TOP_GAP +
        3 * FOOTER_LINE_HEIGHT +
        2 * FOOTER_PARAGRAPH_GAP +
        FOOTER_FONT_SIZE +
        FOOTER_BOTTOM_PAD;
      const top = translateY(framed.querySelector('g.chart-frame-body')!);
      expect(h).toBe(num(plain, 'height') + top + footerBand);

      // A size the caller gives is kept: the plot shrinks instead.
      const sized = parse(
        await renderDataChartD3(
          `${fixture(type)}\n${FRAME}`,
          'light',
          undefined,
          {
            width: 900,
            height: 560,
          }
        )
      );
      expect([num(sized, 'width'), num(sized, 'height')]).toEqual([900, 560]);
      const sizedFooter = [...sized.querySelectorAll('text.chart-footnote')];
      expect(num(sizedFooter.at(-1)!, 'y')).toBe(560 - FOOTER_BOTTOM_PAD);

      const title = framed.querySelector('text.chart-title');
      const subtitle = framed.querySelector('text.chart-subtitle');
      expect(subtitle?.textContent).toBe(
        'Share of revenue by region, fiscal 2025'
      );
      expect(subtitle!.getAttribute('data-line-number')).toBeTruthy();
      if (title) expect(num(subtitle, 'y')).toBeGreaterThan(num(title, 'y'));

      // The plot moved down by the subtitle band, the title stayed put.
      const body = framed.querySelector('g.chart-frame-body')!;
      expect(body).not.toBeNull();
      expect(translateY(body)).toBeGreaterThan(0);
      if (title) expect(title.parentElement).toBe(framed);

      const footer = [...framed.querySelectorAll('text.chart-footnote')];
      expect(footer.map((t) => t.textContent)).toEqual([
        '•',
        'Figures are unaudited.',
        '•',
        'EMEA includes the Gulf states.',
        'Source: Company annual report',
        'Chart: Jane Doe',
      ]);
      // Markdown draws: the bold lead and the italic credit.
      expect(
        footer[4]!.querySelector('tspan[font-weight="bold"]')?.textContent
      ).toBe('Source:');
      expect(
        footer[5]!.querySelector('tspan')!.getAttribute('font-style')
      ).toBe('italic');
      const ys = footer.map((t) => num(t, 'y'));
      expect(ys).toEqual([...ys].sort((a, b) => a - b));
      expect(ys[ys.length - 1]).toBe(h - FOOTER_BOTTOM_PAD);
      for (const t of footer)
        expect(num(t, 'font-size')).toBe(FOOTER_FONT_SIZE);
    }
  );

  it('keeps the bar plot clear of the footer', async () => {
    const framed = parse(await renderDataChartD3(BAR, 'light'));
    const body = framed.querySelector('g.chart-frame-body')!;
    const shift = translateY(body);
    // The x-axis label is the lowest thing the bar chart draws, in the
    // body's own coordinates.
    const lowest = Math.max(
      ...[...body.querySelectorAll('text')]
        .filter((t) => t.closest('[transform]') === body)
        .map((t) => num(t, 'y'))
        .filter((y) => Number.isFinite(y))
    );
    const firstFooter = framed.querySelector('text.chart-footnote')!;
    expect(lowest + shift).toBeLessThan(
      num(firstFooter, 'y') - FOOTER_FONT_SIZE
    );
  });

  it('keeps the type scale: title > subtitle > footer', () => {
    expect(TITLE_FONT_SIZE).toBeGreaterThan(SUBTITLE_FONT_SIZE);
    expect(SUBTITLE_FONT_SIZE).toBeGreaterThan(13);
    expect(13).toBeGreaterThan(FOOTER_FONT_SIZE);
  });

  it('follows a left-aligned legend-inline title', async () => {
    const src = `bar Sales
legend-inline
group
  Q1 blue
  Q2 green

North 10 20
South 15 25
subtitle Monthly, in thousands
footnote Source: Analytics`;
    const svg = parse(await renderDataChartD3(src, 'light'));
    const title = svg.querySelector('text.chart-title')!;
    const subtitle = svg.querySelector('text.chart-subtitle')!;
    // The inline header drew a left-origin title (no text-anchor="middle").
    expect(title.getAttribute('text-anchor')).toBeNull();
    expect(subtitle.getAttribute('text-anchor')).toBe('start');
    expect(num(subtitle, 'x')).toBe(num(title, 'x'));
    expect(svg.querySelector('text.chart-footnote')!.getAttribute('x')).toBe(
      title.getAttribute('x')
    );
    // The legend beside the title stays on the title row.
    const header = svg.querySelector('[data-chart-header]');
    expect(header).not.toBeNull();
    expect(header!.parentElement).toBe(svg);
  });
});

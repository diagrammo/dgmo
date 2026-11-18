// Clustered-stacked columns: rows indented under category lines (#1879).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { measureText } from '../src/utils/text-measure';

const SRC = `bar Revenue by region and year
stack
  Hardware blue
  Software green

North
  2024 40 22
  2025 44 30
South
  2024 31 18
  2025 29 26`;

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

async function draw(src: string) {
  host.innerHTML = await renderDataChartD3(src, 'light');
  const svg = host.querySelector('svg')!;
  const rects = [
    ...svg.querySelectorAll<SVGRectElement>('rect[data-line-number]'),
  ];
  return { svg, rects };
}
const n = (el: Element, a: string) => parseFloat(el.getAttribute(a)!);
const errors = (src: string) =>
  parseChart(src).diagnostics.filter((d) => d.severity === 'error');
const texts = (svg: SVGSVGElement, cls: string) =>
  [...svg.querySelectorAll(`.${cls}`)].map((t) => t.textContent);

describe('clustered-stack parsing', () => {
  it('category lines carry indented period rows', () => {
    const p = parseChart(SRC);
    expect(p.diagnostics).toEqual([]);
    expect(p.clusters?.map((c) => c.label)).toEqual(['North', 'South']);
    expect(p.periods).toEqual(['2024', '2025']);
    expect(p.data.map((d) => `${d.cluster}/${d.label}`)).toEqual([
      'North/2024',
      'North/2025',
      'South/2024',
      'South/2025',
    ]);
  });

  it('a multi-word period keeps exactly one number per series, and does not warn', () => {
    const p = parseChart(SRC.replace('  2025 44 30', '  Q1 2025 44 30'));
    expect(p.diagnostics).toEqual([]);
    expect(p.data[1]!.label).toBe('Q1 2025');
    expect([p.data[1]!.value, ...p.data[1]!.extraValues!]).toEqual([44, 30]);
  });

  it('periods follow first appearance; a missing one is just absent', () => {
    const p = parseChart(
      `${SRC}\nWest\n  2025 10 5\n  2026 12 6`.replace('  2024 31 18\n', '')
    );
    expect(p.periods).toEqual(['2024', '2025', '2026']);
    expect(p.data.filter((d) => d.cluster === 'South')).toHaveLength(1);
  });

  it('fewer numbers than series is a diagnostic', () => {
    const p = parseChart(SRC.replace('  2025 29 26', '  2025 29'));
    expect(
      p.diagnostics.some((d) =>
        /has 1 value\(s\), but 2 series/.test(d.message)
      )
    ).toBe(true);
  });

  it('indented rows need a stack block', () => {
    const e = errors(SRC.replace('stack\n', 'group\n'));
    expect(e[0]?.message).toMatch(/need a `stack` block/);
  });

  it('a flat row among clustered rows is an error', () => {
    const e = errors(`${SRC}\nEast 1 2`);
    expect(e[0]?.message).toMatch(/no category/);
  });

  it('`stack 100%` with a negative names category, period and series', () => {
    const e = errors(
      SRC.replace('stack\n', 'stack 100%\n').replace(
        '2025 29 26',
        '2025 29 -26'
      )
    );
    expect(e[0]?.code).toBe('E_VALUE_NEGATIVE');
    expect(e[0]?.message).toContain('South · 2025 · Software');
  });

  it('`sort` and `orientation-horizontal` warn and are dropped', () => {
    const p = parseChart(`${SRC}\nsort\norientation-horizontal`);
    expect(p.sort).toBeUndefined();
    expect(p.orientation).toBeUndefined();
    expect(p.diagnostics.filter((d) => d.severity === 'warning')).toHaveLength(
      2
    );
  });

  it('a flat stacked bar is unchanged', () => {
    const p = parseChart(`bar X\nstack\n  A\n  B\n\nJan 1 2\nFeb 3 4`);
    expect(p.clusters).toBeUndefined();
    expect(p.data.map((d) => d.label)).toEqual(['Jan', 'Feb']);
  });
});

describe('clustered-stack rendering', () => {
  it('one stacked column per period inside each category', async () => {
    const { svg, rects } = await draw(SRC);
    expect(rects).toHaveLength(8);
    expect(texts(svg, 'dgmo-cluster-label')).toEqual(['North', 'South']);
    expect(texts(svg, 'dgmo-period-label')).toEqual([
      '2024',
      '2025',
      '2024',
      '2025',
    ]);
    expect(svg.querySelectorAll('.dgmo-cluster-bracket')).toHaveLength(2);
    const byName = (name: string) =>
      rects.find((r) => r.getAttribute('data-name') === name)!;
    // Software sits on top of Hardware in the same column.
    const hw = byName('North · 2024 · Hardware');
    const sw = byName('North · 2024 · Software');
    expect(n(sw, 'x')).toBe(n(hw, 'x'));
    expect(n(sw, 'y') + n(sw, 'height')).toBeCloseTo(n(hw, 'y'), 5);
    // The gap between clusters is wider than the gap inside one.
    const x = (name: string) => n(byName(name), 'x');
    const w = n(hw, 'width');
    const insideGap =
      x('North · 2025 · Hardware') - x('North · 2024 · Hardware') - w;
    const betweenGap =
      x('South · 2024 · Hardware') - x('North · 2025 · Hardware') - w;
    expect(betweenGap).toBeGreaterThan(insideGap);
  });

  it('a missing period leaves its slot empty so periods line up', async () => {
    const { rects } = await draw(SRC.replace('  2024 31 18\n', ''));
    const xOf = (name: string) =>
      n(rects.find((r) => r.getAttribute('data-name') === name)!, 'x');
    const north =
      xOf('North · 2025 · Hardware') - xOf('North · 2024 · Hardware');
    const southStart = xOf('South · 2025 · Hardware');
    const outerStep =
      xOf('South · 2025 · Hardware') - xOf('North · 2025 · Hardware');
    expect(rects).toHaveLength(6);
    // South's 2025 column sits in the second slot, as North's does.
    expect(southStart - outerStep).toBeCloseTo(
      xOf('North · 2024 · Hardware') + north,
      5
    );
  });

  it('`stack 100%` scales each column on its own', async () => {
    const { rects } = await draw(SRC.replace('stack\n', 'stack 100%\n'));
    const columns = new Map<string, number>();
    for (const r of rects) {
      const key = r.getAttribute('data-name')!.split(' · ').slice(0, 2).join();
      columns.set(key, Math.min(columns.get(key) ?? Infinity, n(r, 'y')));
    }
    const tops = [...columns.values()];
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(0.01);
    const hw = rects.find(
      (r) => r.getAttribute('data-name') === 'North · 2024 · Hardware'
    )!;
    expect(hw.getAttribute('data-value')).toBe('40 · 65%');
  });
});

describe('gallery fixture', () => {
  it('parses with no diagnostics', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      'gallery/fixtures/bar-clustered-stack.dgmo',
      'utf8'
    );
    expect(parseChart(src).diagnostics).toEqual([]);
  });
});

describe('long cluster and period names (#2081)', () => {
  const LONG = `bar Ports
stack
  Gold orange
  Silver blue

Port de Saint-Barthélemy-le-Très-Long-Nom-de-la-Baie-des-Flibustiers
  Première année de la grande expédition 40 22
  Deuxième année 44 30
ميناء القراصنة الكبير
  السنة الأولى 31 18
  السنة الثانية 29 26
香港海盗港口
  第一年 20 14
  第二年 26 18
Гавань Тортуга
  Год первый 15 10
  Год второй 18 12`;

  async function labels(width: number) {
    host.innerHTML = await renderDataChartD3(LONG, 'light', undefined, {
      width,
      height: 700,
    });
    const svg = host.querySelector('svg')!;
    const spans = (cls: string) =>
      [...svg.querySelectorAll(`.${cls}`)].map((t) => {
        const tsp = [...t.querySelectorAll('tspan')];
        const lines = tsp.length
          ? tsp.map((s) => s.textContent!)
          : [t.textContent!];
        const x = n(t, 'x');
        const w = Math.max(...lines.map((l) => measureText(l, 12)));
        return { x, lines, left: x - w / 2, right: x + w / 2 };
      });
    return {
      svg,
      periods: spans('dgmo-period-label'),
      clusters: spans('dgmo-cluster-label'),
      rects: [
        ...svg.querySelectorAll<SVGRectElement>('rect[data-line-number]'),
      ],
    };
  }

  it('wraps names onto lines instead of cutting them to "…"', async () => {
    const { periods, clusters } = await labels(1285);
    expect(clusters[0]!.lines.length).toBeGreaterThan(1);
    expect(periods[0]!.lines.length).toBeGreaterThan(1);
    expect(clusters[0]!.lines.join('')).toContain('Flibustiers');
    expect(periods[0]!.lines.join(' ')).toBe(
      'Première année de la grande expédition'
    );
  });

  it('no two period labels overlap, and none leaves its cluster', async () => {
    const { periods, clusters } = await labels(1285);
    const sorted = [...periods].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++)
      expect(sorted[i]!.left).toBeGreaterThanOrEqual(sorted[i - 1]!.right);
    sorted.forEach((p, i) => {
      const c = clusters[Math.floor(i / 2)]!;
      expect(Math.abs(p.x - c.x)).toBeLessThan(160);
    });
  });

  it('spacing follows the data: columns fill the plot, not the name count', async () => {
    const { rects } = await labels(1285);
    // 8 columns across ~1285px: every column is wide, none squeezed by
    // empty slots for names that other categories own.
    const widths = rects.map((r) => n(r, 'width'));
    expect(Math.min(...widths)).toBeGreaterThan(60);
  });

  it('keeps names within the cluster step on a narrow canvas', async () => {
    const { clusters } = await labels(520);
    for (const c of clusters) expect(c.right - c.left).toBeLessThanOrEqual(130);
  });
});

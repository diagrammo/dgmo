// funnel-stage-limit.test.ts — a funnel draws at most FUNNEL_MAX_STAGES
// stages, its side labels never overlap, and stage ↔ label hover pairs
// (#2439).
import { describe, it, expect, afterEach } from 'vitest';
import { parseFunnel } from '../src/data-chart-parser';
import { FUNNEL_MAX_STAGES } from '../src/charts-d3/funnel-limits';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { attachDataChartInteractions } from '../src/charts-d3/interactions';

const funnel = (n: number, value = (i: number) => 1000 - i) =>
  [
    'funnel Many stages',
    '',
    ...Array.from({ length: n }, (_, i) => `Stage ${i + 1} ${value(i)}`),
  ].join('\n');

const LIMIT_CODE = 'E_FUNNEL_TOO_MANY_STAGES';

describe('funnel stage limit', () => {
  it(`${FUNNEL_MAX_STAGES} stages raise nothing`, () => {
    const p = parseFunnel(funnel(FUNNEL_MAX_STAGES));
    expect(p.diagnostics.filter((d) => d.code === LIMIT_CODE)).toHaveLength(0);
    expect(p.data).toHaveLength(FUNNEL_MAX_STAGES);
  });

  it('one past the limit draws the first stages and raises one error', () => {
    const p = parseFunnel(funnel(FUNNEL_MAX_STAGES + 1));
    const hits = p.diagnostics.filter((d) => d.code === LIMIT_CODE);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe('error');
    expect(hits[0]!.line).toBe(3 + FUNNEL_MAX_STAGES);
    expect(hits[0]!.message).toContain(`${FUNNEL_MAX_STAGES + 1} stages`);
    expect(hits[0]!.message).toContain(`first ${FUNNEL_MAX_STAGES}`);
    expect(p.data.map((d) => d.label)).toEqual(
      Array.from({ length: FUNNEL_MAX_STAGES }, (_, i) => `Stage ${i + 1}`)
    );
  });

  it('the 200-stage file draws the limit, one error, no overlapping text', async () => {
    const src = funnel(200);
    const p = parseFunnel(src);
    expect(p.diagnostics.filter((d) => d.code === LIMIT_CODE)).toHaveLength(1);
    const svg = await renderDataChartD3(src, 'light');
    expect(svg.match(/<polygon/g)).toHaveLength(FUNNEL_MAX_STAGES);
    expectNoOverlap(svg);
  });
});

/** Vertical extent of each side label, per column (left = end, right = start). */
function labelBoxes(svg: string): Map<string, [number, number][]> {
  const cols = new Map<string, [number, number][]>();
  for (const m of svg.matchAll(/<text([^>]*class="dgmo-ptlabel"[^>]*)>/g)) {
    const a = m[1]!;
    const y = Number(a.match(/ y="([^"]+)"/)![1]);
    const fs = Number(a.match(/font-size="([^"]+)"/)![1]);
    const anchor = a.match(/text-anchor="([^"]+)"/)![1]!;
    const c = y - fs * 0.35;
    const box = cols.get(anchor) ?? [];
    box.push([c - fs * 0.6, c + fs * 0.6]);
    cols.set(anchor, box);
  }
  return cols;
}

function expectNoOverlap(svg: string): void {
  const cols = labelBoxes(svg);
  expect(cols.size).toBeGreaterThan(0);
  for (const boxes of cols.values()) {
    boxes.sort((a, b) => a[0] - b[0]);
    for (let k = 1; k < boxes.length; k++)
      expect(boxes[k]![0]).toBeGreaterThanOrEqual(boxes[k - 1]![1] - 0.01);
  }
}

describe('funnel crowded labels', () => {
  it('a tiny stage between big ones moves its labels out, with a leader', async () => {
    // At a short pane twenty stages are thinner than a label line.
    const svg = await renderDataChartD3(
      funnel(FUNNEL_MAX_STAGES),
      'light',
      undefined,
      { width: 600, height: 360 }
    );
    expectNoOverlap(svg);
    expect(svg).toMatch(/<path[^>]*class="dgmo-ptlabel"/);
  });

  it('a roomy funnel draws no leader lines', async () => {
    const svg = await renderDataChartD3(funnel(5), 'light');
    expectNoOverlap(svg);
    expect(svg).not.toMatch(/<path[^>]*class="dgmo-ptlabel"/);
  });
});

describe('funnel hover pairing', () => {
  let host: HTMLDivElement;
  let detach: { destroy: () => void } | undefined;
  afterEach(() => {
    detach?.destroy();
    host?.remove();
  });
  const mount = async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = await renderDataChartD3(funnel(4), 'light', undefined, {
      width: 800,
      height: 500,
    });
    const svg = host.querySelector('svg')!;
    detach = attachDataChartInteractions(svg, {});
    return svg;
  };

  it('hovering a stage lights its labels and recedes the others', async () => {
    const svg = await mount();
    const band = svg.querySelectorAll<SVGElement>('.dgmo-datum')[1]!;
    const line = band.getAttribute('data-line-number');
    band.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    const labels = [...svg.querySelectorAll<SVGElement>('.dgmo-ptlabel')];
    const own = labels.filter(
      (l) => l.getAttribute('data-line-number') === line
    );
    expect(own.length).toBe(2); // name + value/percent
    expect(own.every((l) => !l.classList.contains('dgmo-dim'))).toBe(true);
    const others = labels.filter((l) => !own.includes(l));
    expect(others.every((l) => l.classList.contains('dgmo-dim'))).toBe(true);
  });

  it('hovering a label lights its stage and recedes the others', async () => {
    const svg = await mount();
    const label = [...svg.querySelectorAll<SVGElement>('.dgmo-ptlabel')][2]!;
    const line = label.getAttribute('data-line-number');
    label.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    const bands = [...svg.querySelectorAll<SVGElement>('.dgmo-datum')];
    for (const b of bands)
      expect(b.classList.contains('dgmo-dim')).toBe(
        b.getAttribute('data-line-number') !== line
      );
  });
});

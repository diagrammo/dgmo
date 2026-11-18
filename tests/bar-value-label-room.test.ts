// Value labels on bars: horizontal labels keep clear of the mark (#2082);
// a stacked segment prints its number only when the number fits (#2085).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { measureText } from '../src/utils/text-measure';
import { VALUE_FONT } from '../src/charts-d3/shared';
import { renderDataChartD3 } from '../src/charts-d3/index';

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

async function draw(src: string) {
  host.innerHTML = await renderDataChartD3(src, 'light');
  return host.querySelector('svg')!;
}

const valueTexts = (svg: SVGElement) =>
  [...svg.querySelectorAll('text')].map((t) => t.textContent);

/** Gap between the widest bar's mark and its value label, in px. */
async function gapAt(src: string, text: string, side: 'right' | 'left') {
  const svg = await draw(src);
  const label = [...svg.querySelectorAll('text')].find(
    (t) => t.textContent === text && t.getAttribute('x') !== null
  )!;
  const cx = Number(label.getAttribute('x'));
  const half = measureText(text, VALUE_FONT) / 2;
  const rects = [...svg.querySelectorAll('rect[data-line-number]')].map(
    (r) => ({
      l: Number(r.getAttribute('x')),
      r: Number(r.getAttribute('x')) + Number(r.getAttribute('width')),
    })
  );
  return side === 'right'
    ? cx - half - Math.max(...rects.map((r) => r.r))
    : Math.min(...rects.map((r) => r.l)) - (cx + half);
}

describe('horizontal value labels stay off the mark (#2082)', () => {
  it('bar: the extreme positive label sits right of the bar end', async () => {
    const gap = await gapAt(
      'bar T\norientation-horizontal\nA 960\nB 640\nC 200',
      '960',
      'right'
    );
    expect(gap).toBeGreaterThanOrEqual(0);
  });

  it('negative extreme label sits left of the bar end', async () => {
    const gap = await gapAt(
      'bar T\norientation-horizontal\nA -960\nB 640\nC 200',
      '-960',
      'left'
    );
    expect(gap).toBeGreaterThanOrEqual(0);
  });
});

describe('stacked segment labels only when they fit (#2085)', () => {
  for (const orient of ['orientation-horizontal\n', '']) {
    it(`${orient ? 'horizontal' : 'vertical'}: a wide number in a narrow segment is omitted`, async () => {
      const svg = await draw(
        `bar T\n${orient}stack\n  A\n  B\n\nHuge 20000000 1500000\nSmall 3 2`
      );
      const t = valueTexts(svg);
      expect(t).not.toContain('1,500,000');
      expect(t).toContain('20,000,000');
    });
  }
});

// A legend never runs into or off the canvas edge (#2438). The frame puts the
// legend on an edge FRAME_INSET in from the canvas, so the legend lays its
// rows out to the canvas less that inset on both sides: rows wrap, a long
// entry is cut with an ellipsis, and the capsule ends at or before the inset
// edge. Fixtures mirror the owner's pressure files (function, radar, scatter,
// treemap) plus one renderIntegratedLegend chart (boxes-and-lines).

import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderForExport } from '../src/d3';
import { FRAME_INSET } from '../src/utils/title-constants';

const LONG = 'A very long curve name '.repeat(7).slice(0, 149) + 'z';
const longBranch = (i: number) =>
  `${'Branch name that is very long '.repeat(6).slice(0, 149)}${i}`;

const FIXTURES: Record<string, string> = {
  'function, one 150-character curve name': `function Long names
x-axis 0..10

Short red: x
${LONG} blue: x*2
`,
  'radar, twelve series that wrap': `radar Many series
series
${Array.from({ length: 12 }, (_, i) => `  Series number ${i}`).join('\n')}

${['A', 'B', 'C', 'D', 'E']
  .map((a) => `${a} ${Array.from({ length: 12 }, () => 50).join(' ')}`)
  .join('\n')}
`,
  'scatter, forty categories': `scatter Many categories

${Array.from({ length: 40 }, (_, i) => `[Cat ${i}]\n  P${i} ${i} ${i}`).join('\n')}
`,
  'treemap, three 150-character branches': `treemap Long branches

${[0, 1, 2].map((i) => `${longBranch(i)}\n  leaf${i} 10`).join('\n')}
`,
  'boxes-and-lines (renderIntegratedLegend), one 150-character tag value': `boxes-and-lines Long tag

tag Team
  Frontend blue
  ${LONG} green

active-tag Team

* Login | team: Frontend
* API | team: ${LONG}
Login -> API
`,
};

/** Sum of translate() x offsets from `el` up to the root svg. */
function offsetX(el: Element): number {
  let x = 0;
  for (
    let n: Element | null = el;
    n && n.tagName !== 'svg';
    n = n.parentElement
  ) {
    const t = n.getAttribute('transform');
    if (!t) continue;
    expect(t).not.toMatch(/scale|matrix|rotate/);
    const m = /translate\(\s*([-\d.e]+)/.exec(t);
    if (m) x += Number(m[1]);
  }
  return x;
}

describe('legend stays inside the canvas inset (#2438)', () => {
  for (const [name, content] of Object.entries(FIXTURES)) {
    it(name, async () => {
      const svgText = await renderForExport(
        content,
        'light',
        undefined,
        undefined,
        {
          width: 600,
        }
      );
      const doc = new JSDOM(svgText, { contentType: 'image/svg+xml' }).window
        .document;
      const svg = doc.documentElement;
      const vb = (svg.getAttribute('viewBox') ?? '')
        .split(/[\s,]+/)
        .map(Number);
      const [vx, , vw] = vb as [number, number, number];
      const legend = doc.querySelector('g.chart-legend, g.dgmo-legend');
      expect(legend, 'legend drawn').not.toBeNull();
      const base = offsetX(legend!);
      const lo = base + Number(legend!.getAttribute('data-legend-left'));
      const hi = base + Number(legend!.getAttribute('data-legend-right'));
      expect(lo).toBeGreaterThanOrEqual(vx + FRAME_INSET - 0.5);
      expect(hi).toBeLessThanOrEqual(vx + vw - FRAME_INSET + 0.5);
      // Every capsule and pill background ends inside the inset too.
      for (const r of Array.from(legend!.querySelectorAll('rect'))) {
        const x = offsetX(r) + Number(r.getAttribute('x') ?? 0);
        const w = Number(r.getAttribute('width') ?? 0);
        expect(x).toBeGreaterThanOrEqual(vx + FRAME_INSET - 0.5);
        expect(x + w).toBeLessThanOrEqual(vx + vw - FRAME_INSET + 0.5);
      }
      // A cut entry keeps its full name for hover, and is never a <title>.
      if (content.includes(LONG)) {
        const cut = Array.from(legend!.querySelectorAll('[data-full-text]'));
        expect(cut.some((t) => t.getAttribute('data-full-text') === LONG)).toBe(
          true
        );
        expect(cut.every((t) => (t.textContent ?? '').endsWith('…'))).toBe(
          true
        );
      }
      expect(svgText).not.toContain('<title');
    });
  }
});

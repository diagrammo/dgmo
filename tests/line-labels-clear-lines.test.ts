import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderDataChartD3 as renderDataChartD3Raw } from '../src/charts-d3/index';
import { flattenTabular } from './helpers/tabular-text';
import { labelBox, type LabelAnchor } from '../src/utils/place-labels';
import { measureText } from '../src/utils/text-measure';
import { ANNOTATION_FONT } from '../src/annotations/draw';
import {
  rectCircleOverlap,
  segmentRectOverlap,
  type LabelRect,
} from '../src/label-layout';

// Point values and the mean / median end labels once printed over the
// series line and the overlay lines: the label engine only knew the point
// dots (#2106). Lines are now obstacles too.

const RUM = `line Rum barrels sold, 2026
mean
median
y-axis Barrels

Jan 310
Feb 295
Mar 340
Apr 1180
May 360
Jun 355
Jul 390
Aug 370
Sep 410
Oct 405
Nov 430
Dec 450
`;

type Seg = [number, number, number, number];

/** A box shrunk by 1px top and bottom, as the engine tests it. */
const core = (r: LabelRect): LabelRect => ({ ...r, y: r.y + 1, h: r.h - 2 });

function geometry(svg: string) {
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  const num = (el: Element, a: string) => Number(el.getAttribute(a));
  const pts = Array.from(doc.querySelectorAll('circle.dgmo-pt')).map(
    (c) => [num(c, 'cx'), num(c, 'cy')] as [number, number]
  );
  const series: Seg[] = pts
    .slice(1)
    .map(([x, y], i) => [pts[i]![0], pts[i]![1], x, y]);
  const overlays: Seg[] = Array.from(
    doc.querySelectorAll('g.dgmo-overlay line')
  ).map((l) => [num(l, 'x1'), num(l, 'y1'), num(l, 'x2'), num(l, 'y2')]);
  const values = Array.from(doc.querySelectorAll('text'))
    .filter(
      (t) => !t.getAttribute('class') && t.getAttribute('font-size') === '12'
    )
    .map((t) => ({
      text: t.textContent!,
      box: core(
        labelBox(
          t.textContent!,
          {
            x: num(t, 'x'),
            y: num(t, 'y'),
            anchor: t.getAttribute('text-anchor') as LabelAnchor,
          },
          12,
          true
        )
      ),
    }));
  const overlayLabels = Array.from(
    doc.querySelectorAll('text.dgmo-overlay-label')
  ).map((t) => {
    const w = measureText(t.textContent!, ANNOTATION_FONT, { bold: true });
    return {
      text: t.textContent!,
      box: core({
        x: num(t, 'x') - w,
        y: num(t, 'y') - ANNOTATION_FONT,
        w,
        h: ANNOTATION_FONT + 2,
      }),
    };
  });
  return { pts, series, overlays, values, overlayLabels };
}

const crosses = (b: LabelRect, segs: Seg[]) =>
  segs.some(([x0, y0, x1, y1]) => segmentRectOverlap(x0, y0, x1, y1, b));

describe('line labels keep off the lines (#2106)', () => {
  it('no point value prints over the series line or a mean / median line', async () => {
    const g = geometry(
      flattenTabular(await renderDataChartD3Raw(RUM, 'light'))
    );
    expect(g.overlays).toHaveLength(2);
    expect(g.values.length).toBeGreaterThan(0);
    const onLine = g.values
      .filter((v) => crosses(v.box, [...g.series, ...g.overlays]))
      .map((v) => v.text);
    expect(onLine).toEqual([]);
  });

  it('the mean and median labels clear the points, the series line and each other', async () => {
    const g = geometry(
      flattenTabular(await renderDataChartD3Raw(RUM, 'light'))
    );
    expect(g.overlayLabels.map((l) => l.text)).toEqual([
      'mean 441',
      'median 380',
    ]);
    for (const l of g.overlayLabels) {
      expect(crosses(l.box, g.series), l.text).toBe(false);
      expect(
        g.pts.some(([cx, cy]) => rectCircleOverlap(l.box, { cx, cy, r: 3.5 })),
        l.text
      ).toBe(false);
      for (const v of g.values)
        expect(
          v.box.x < l.box.x + l.box.w &&
            l.box.x < v.box.x + v.box.w &&
            v.box.y < l.box.y + l.box.h &&
            l.box.y < v.box.y + v.box.h,
          `${l.text} vs ${v.text}`
        ).toBe(false);
    }
    const [a, b] = g.overlayLabels.map((l) => l.box);
    expect(
      a!.x < b!.x + b!.w &&
        b!.x < a!.x + a!.w &&
        a!.y < b!.y + b!.h &&
        b!.y < a!.y + a!.h
    ).toBe(false);
  });
});

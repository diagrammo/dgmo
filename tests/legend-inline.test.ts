/**
 * `legend-inline` tests (spec §1.9, decision #50).
 *
 * `legend-inline` renders the chart title and its series legend on ONE row
 * (title left, legend right) instead of a centered title with the legend
 * stacked beneath. It is honoured by the top-center-legend data charts
 * (bar / line / radar / scatter / function) and is a no-op elsewhere. When the
 * legend can't fit on a single row beside the title, the header silently falls
 * back to the stacked layout — so a diagram is always valid.
 *
 * Discriminators in the rendered SVG:
 *  - The CENTERED title (stacked / fallback) carries `text-anchor="middle"`.
 *  - The INLINE title is left-origin (`x="8"`) with NO `text-anchor="middle"`.
 *  - The stacked legend group is `translate(0,…)`; the inline legend group is
 *    translated to a positive x (right of the title).
 */
import { describe, it, expect } from 'vitest';
import { render } from '../src/render';

async function renderOk(src: string) {
  const { svg, diagnostics } = await render(src, { theme: 'light' });
  const errors = diagnostics.filter((d) => d.severity === 'error');
  return { svg, diagnostics, errors };
}

/** Extract the `<text … class="chart-title" …>` opening tag, or ''. */
function titleTag(svg: string): string {
  const m = svg.match(/<text\b[^>]*class="chart-title"[^>]*>/);
  return m ? m[0] : '';
}

function legendGroupCount(svg: string): number {
  return svg.match(/data-legend-group=/g)?.length ?? 0;
}

/** First x-translate of a `chart-legend` group wrapper, or null. */
function legendGroupX(svg: string): number | null {
  // The legend `<g class="chart-legend">` is wrapped in a positioning `<g
  // transform="translate(x,y)">`. Find the translate immediately before it.
  const m = svg.match(
    /translate\(([-\d.]+),[-\d.]+\)"><g class="chart-legend"/
  );
  return m ? parseFloat(m[1]) : null;
}

// Short title + two short series → inline fits at the default 1200px width.
const INLINE_FITS = `bar Sales
group
  Q1 blue
  Q2 green

North 10 20
South 15 25`;

// A title long enough to consume the row on its own → must fall back to stacked.
const INLINE_OVERFLOWS = `bar Quarterly revenue by acquisition channel across every region and business unit for the trailing twelve month period
group
  Organic Search blue
  Paid Advertising green
  Social Referral red

North 10 20 30
South 15 25 35`;

function withInline(src: string): string {
  const lines = src.split('\n');
  return [lines[0], 'legend-inline', ...lines.slice(1)].join('\n');
}

describe('legend-inline (spec §1.9, decision #50)', () => {
  it('default header is centered with a stacked legend', async () => {
    const { svg, errors } = await renderOk(INLINE_FITS);
    expect(errors).toEqual([]);
    expect(titleTag(svg)).toContain('text-anchor="middle"');
    expect(legendGroupCount(svg)).toBeGreaterThan(0);
    // Stacked legend sits at x=0.
    expect(legendGroupX(svg)).toBe(0);
  });

  it('puts title left + legend right on one row when it fits', async () => {
    const { svg, errors } = await renderOk(withInline(INLINE_FITS));
    expect(errors).toEqual([]);
    const tag = titleTag(svg);
    // Left-aligned title: no centered anchor, origin at the 8px inset.
    expect(tag).not.toContain('text-anchor="middle"');
    expect(tag).toContain('x="8"');
    // Legend still rendered, now flushed to the RIGHT edge — past the short
    // title, in the right half of the canvas. Measured against the canvas the
    // chart actually chose, not a hardcoded 1200: a data chart sizes itself
    // from its content since 2026-08-29 (#532).
    expect(legendGroupCount(svg)).toBeGreaterThan(0);
    const x = legendGroupX(svg);
    expect(x).not.toBeNull();
    const canvasWidth = Number(
      /viewBox="0 0 ([\d.]+)/.exec(svg)?.[1] ?? '1200'
    );
    expect(x!).toBeGreaterThan(canvasWidth / 2);
  });

  it('falls back to the stacked header when the legend cannot fit', async () => {
    const { svg, errors } = await renderOk(withInline(INLINE_OVERFLOWS));
    expect(errors).toEqual([]);
    // Fallback → centered title + legend back at x=0.
    expect(titleTag(svg)).toContain('text-anchor="middle"');
    expect(legendGroupCount(svg)).toBeGreaterThan(0);
    expect(legendGroupX(svg)).toBe(0);
  });

  it('parses `legend-inline` without any diagnostic', async () => {
    const { diagnostics } = await renderOk(withInline(INLINE_FITS));
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('is a no-op on a single-series chart (no legend to inline)', async () => {
    const src = `bar Simple
legend-inline

North 10
South 15`;
    const { svg, errors } = await renderOk(src);
    expect(errors).toEqual([]);
    // No series legend exists, so the title stays centered.
    expect(titleTag(svg)).toContain('text-anchor="middle"');
  });

  it('is a no-op on a legend-less chart type (pie)', async () => {
    const src = `pie Share
legend-inline

Apples 30
Oranges 20
Pears 50`;
    const { svg, errors } = await renderOk(src);
    expect(errors).toEqual([]);
    expect(svg).toContain('<svg');
    expect(titleTag(svg)).toContain('text-anchor="middle"');
  });

  it('inline + no-legend suppresses the legend and centers the title', async () => {
    const src = `bar Sales
legend-inline
no-legend
group
  Q1 blue
  Q2 green

North 10 20
South 15 25`;
    const { svg, errors } = await renderOk(src);
    expect(errors).toEqual([]);
    expect(legendGroupCount(svg)).toBe(0);
    expect(titleTag(svg)).toContain('text-anchor="middle"');
  });
});

/**
 * `options.width` — what it means, and who says when it cannot be honoured
 * (issue #532).
 *
 * The width is a MAXIMUM for chart types that fit content to a canvas and an
 * exact sheet for the ones that relayout into it. Twenty-one chart types size
 * themselves from their own content and discarded the request in silence; they
 * still cannot honour it — an org chart is as wide as its cards are — but the
 * caller is now told, with `W_CANVAS_WIDTH_IGNORED`.
 *
 * The check is measured against the produced SVG rather than a list of chart
 * types, so it cannot go stale as renderers change.
 */
import { describe, it, expect } from 'vitest';
import { render } from '../src/render';

const ORG =
  'org Small Team\n\nJane Smith\n  role: CEO\n\n  Sam Wilson\n    role: Head of Sales\n';
const BAR = 'bar Revenue\n\nEnterprise 245\nProfessional 182\nStarter 97\n';

function canvasWidth(svg: string): number {
  const m = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) /.exec(svg);
  return m ? Number(m[1]) : NaN;
}
const widthWarnings = (ds: { code?: string }[]) =>
  ds.filter((d) => d.code === 'W_CANVAS_WIDTH_IGNORED');

describe('options.width', () => {
  it('a relayouting chart takes the width exactly, and says nothing', async () => {
    const { svg, diagnostics } = await render(BAR, { width: 520 });
    expect(canvasWidth(svg)).toBe(520);
    expect(widthWarnings(diagnostics)).toHaveLength(0);
  });

  it('a width with no height keeps the sheet proportions', async () => {
    const { svg } = await render(BAR, { width: 900 });
    expect(svg).toContain('viewBox="0 0 900 600"');
  });

  it('a data chart with no width asks for less than the old flat 1200', async () => {
    const { svg } = await render(BAR);
    const w = canvasWidth(svg);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(1200);
  });

  it('a content-sized chart under its natural width warns', async () => {
    const { svg, diagnostics } = await render(ORG, { width: 200 });
    const warnings = widthWarnings(diagnostics);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.severity).toBe('warning');
    // The message names both numbers, so the caller can act on it.
    expect(warnings[0]!.message).toContain(
      String(Math.round(canvasWidth(svg)))
    );
    expect(warnings[0]!.message).toContain('200');
  });

  it('a content-sized chart WITHIN the requested width is honouring it', async () => {
    const { svg, diagnostics } = await render(ORG, { width: 4000 });
    expect(canvasWidth(svg)).toBeLessThan(4000);
    expect(widthWarnings(diagnostics)).toHaveLength(0);
  });

  it('no width requested is never a warning', async () => {
    const { diagnostics } = await render(ORG);
    expect(widthWarnings(diagnostics)).toHaveLength(0);
  });
});

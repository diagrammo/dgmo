// §1.9 fill family on the heatmap: default 25%-tint ramp, fill-solid full
// intent, and fill-outline hollow cells with the value's ramp color moved to
// the cell stroke (computed at FULL intent so low values stay visible).
import { describe, it, expect } from 'vitest';
import { render } from '../src/render';
import { getPalette } from '../src/palettes';
import { mix, shapeFill, themeBaseBg } from '../src/palettes/color-utils';
import { lintSvg } from './stress/lint';

// Two values spanning the whole range: 5 → t=0 (primary stop), 8 → t=1
// (orange stop), so the expected ramp colors are exact palette stops.
const SRC = `heatmap Support Load
columns Mon, Tue
Row1 5 8`;

function withDirective(directive: string): string {
  const lines = SRC.split('\n');
  lines.splice(1, 0, directive);
  return lines.join('\n');
}

function cells(svg: string): SVGRectElement[] {
  const div = document.createElement('div');
  div.innerHTML = svg;
  return Array.from(div.querySelectorAll('rect[data-row-key]'));
}

function labels(svg: string): SVGTextElement[] {
  const div = document.createElement('div');
  div.innerHTML = svg;
  return Array.from(div.querySelectorAll('text[data-row-key][data-col-key]'));
}

const slateLight = getPalette('slate').light;
const slateDark = getPalette('slate').dark;
const OPTS = { theme: 'light', palette: 'slate' } as const;

describe('heatmap fill family', () => {
  it('fill-outline: cells render hollow with the full-intent ramp on the stroke', async () => {
    const { svg, diagnostics } = await render(
      withDirective('fill-outline'),
      OPTS
    );
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const rects = cells(svg);
    expect(rects.length).toBe(2);
    const base = themeBaseBg(slateLight, false);
    // Ramp endpoints at FULL intent ('solid' stops), not the tint ramp.
    const lowRamp = shapeFill(slateLight, slateLight.primary, false, {
      mode: 'solid',
    });
    const highRamp = shapeFill(slateLight, slateLight.colors.orange, false, {
      mode: 'solid',
    });
    for (const r of rects) {
      expect(r.getAttribute('fill')).toBe(base);
      expect(r.getAttribute('stroke-width')).toBe('1.5');
    }
    expect(rects.map((r) => r.getAttribute('stroke'))).toEqual([
      lowRamp,
      highRamp,
    ]);
  });

  it('fill-outline dark theme: hollow cells use the dark base bg (surface)', async () => {
    const { svg } = await render(withDirective('fill-outline'), {
      theme: 'dark',
      palette: 'slate',
    });
    const rects = cells(svg);
    expect(rects.length).toBe(2);
    for (const r of rects) {
      expect(r.getAttribute('fill')).toBe(themeBaseBg(slateDark, true));
    }
  });

  it('fill-outline: value labels keep the readable ramp tint (same as fill-solid)', async () => {
    // labelTint runs on the full-intent ramp color in both modes, so the
    // outline label color must match the solid-mode label color exactly.
    const outline = labels(
      (await render(withDirective('fill-outline'), OPTS)).svg
    );
    const solid = labels((await render(withDirective('fill-solid'), OPTS)).svg);
    expect(outline.length).toBe(2);
    expect(outline.map((t) => t.getAttribute('fill'))).toEqual(
      solid.map((t) => t.getAttribute('fill'))
    );
    const base = themeBaseBg(slateLight, false);
    for (const t of outline) {
      expect(t.getAttribute('fill')).not.toBe(base);
    }
  });

  it('default (no directive) keeps the 25%-tint ramp fill unchanged', async () => {
    const { svg } = await render(SRC, OPTS);
    const rects = cells(svg);
    expect(rects.length).toBe(2);
    const base = themeBaseBg(slateLight, false);
    const lowTint = mix(slateLight.primary, base, 25);
    const highTint = mix(slateLight.colors.orange, base, 25);
    expect(rects.map((r) => r.getAttribute('fill'))).toEqual([
      lowTint,
      highTint,
    ]);
    // Default cell stroke is the hairline bg separator, not the ramp.
    for (const r of rects) {
      expect(r.getAttribute('stroke')).toBe(slateLight.bg);
      expect(r.getAttribute('stroke-width')).toBe('2');
    }
  });

  it('fill-solid keeps full-intent cell fills unchanged', async () => {
    const { svg } = await render(withDirective('fill-solid'), OPTS);
    const rects = cells(svg);
    expect(rects.map((r) => r.getAttribute('fill'))).toEqual([
      slateLight.primary,
      slateLight.colors.orange,
    ]);
    for (const r of rects) {
      expect(r.getAttribute('stroke')).toBe(slateLight.bg);
    }
  });
});

// #1543: a long row label sized the plot, and rotated column labels rose
// through the title and ran past the right edge. Both are now capped and end
// in `…`, with the full text kept as a hover title.
describe('heatmap long labels (#1543)', () => {
  const ROW = 'Customer identity and access management squad lead'; // 50 chars
  const COL = 'Configuration drift after deployment'; // 36 chars
  const LONG = `heatmap Load
columns
  ${COL}
  Upstream dependency timeout
  Expired credentials or certificates
  Capacity exhaustion under load
${ROW} 4 9 2 7
Short 6 3 11 1`;

  it('#1543 keeps every text inside the canvas', async () => {
    expect(ROW.length).toBe(50);
    expect(COL.length).toBe(36);
    const { svg, diagnostics } = await render(LONG, OPTS);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(lintSvg(svg).filter((f) => f.rule === 'text-outside')).toEqual([]);
  });

  it('#1543 truncates long labels with an ellipsis and keeps the full text', async () => {
    const { svg } = await render(LONG, OPTS);
    const div = document.createElement('div');
    div.innerHTML = svg;
    // Axis labels carry their key as data-filter-value, cells as data-*-key.
    const axis = (v: string) =>
      div.querySelector(`text[data-filter-value="${v}"]`)!;
    const row = axis(ROW);
    const col = axis(COL);
    for (const [el, full] of [
      [row, ROW],
      [col, COL],
    ] as const) {
      expect(el.firstChild?.textContent).toMatch(/…$/);
      expect(el.querySelector('title')?.textContent).toBe(full);
    }
    // A short label is drawn whole, with no hover title.
    const short = axis('Short');
    expect(short.textContent).toBe('Short');
    expect(short.querySelector('title')).toBeNull();
  });
});

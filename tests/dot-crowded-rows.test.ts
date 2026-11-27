// @vitest-environment jsdom
// dot-crowded-rows.test.ts — a dot chart draws at most DOT_MAX_ROWS rows, its
// row names and gap values never collide, and hovering a row names it and
// prints its values (#2432).

import { describe, expect, it } from 'vitest';
import { parseDot } from '../src/dot/parser';
import { renderDot } from '../src/dot/renderer';
import { DOT_MAX_ROWS } from '../src/dot/diagnostics';
import { TICK_FONT, VALUE_FONT } from '../src/charts-d3/shared';
import { getPalette } from '../src/palettes';
import { measureText } from '../src/utils/text-measure';

const palette = getPalette('nord').light;
const CODE = 'E_DOT_TOO_MANY_ROWS';
const NAME = (i: number) => `Region ${i} of the northern sales territory`;

/** A dumbbell with `n` rows, two series and gaps. */
const dumbbell = (n: number) =>
  [
    'dot Pressure',
    'series 2020, 2025',
    'gap',
    '',
    ...Array.from(
      { length: n },
      (_, i) => `${NAME(i)} ${40 + (i % 17)} ${45 + ((i * 7) % 23)}`
    ),
  ].join('\n');

function draw(src: string, width = 960, height = 480): HTMLDivElement {
  const parsed = parseDot(src);
  expect(parsed.error).toBeNull();
  const container = document.createElement('div');
  renderDot(container, parsed, palette, false, undefined, { width, height });
  return container;
}

/** The text boxes a `<text>` draws, one per line, in canvas px. */
interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
function lineBoxes(t: Element, font: number): Box[] {
  const anchor = t.getAttribute('text-anchor') ?? 'start';
  const spans = [...t.querySelectorAll('tspan')];
  const parts = spans.length
    ? spans.map((s) => ({ el: s, text: s.textContent ?? '' }))
    : [{ el: t, text: t.textContent ?? '' }];
  let y = 0;
  return parts.map(({ el, text }, k) => {
    const x = Number(el.getAttribute('x') ?? t.getAttribute('x'));
    if (k === 0) {
      y = Number(el.getAttribute('y') ?? t.getAttribute('y'));
      if ((el.getAttribute('dy') ?? t.getAttribute('dy')) === '0.33em')
        y += 0.33 * font;
    } else y += Number(el.getAttribute('dy'));
    const w = measureText(text, font);
    const x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
    return { x0, x1: x0 + w, y0: y - 0.75 * font, y1: y + 0.2 * font };
  });
}
const overlap = (a: Box, b: Box) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
function expectNoOverlap(boxes: Box[]) {
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      expect(overlap(boxes[i]!, boxes[j]!), `boxes ${i} and ${j}`).toBe(false);
}

describe('dot row limit (#2432)', () => {
  it(`${DOT_MAX_ROWS} rows draw in full with no diagnostic`, () => {
    const parsed = parseDot(dumbbell(DOT_MAX_ROWS));
    expect(parsed.diagnostics.filter((d) => d.code === CODE)).toHaveLength(0);
    expect(parsed.rows).toHaveLength(DOT_MAX_ROWS);
  });

  it(`${DOT_MAX_ROWS + 1} rows draw the first ${DOT_MAX_ROWS} and raise one error naming the count`, () => {
    const parsed = parseDot(dumbbell(DOT_MAX_ROWS + 1));
    const errs = parsed.diagnostics.filter((d) => d.code === CODE);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.severity).toBe('error');
    expect(errs[0]!.message).toContain(String(DOT_MAX_ROWS + 1));
    expect(errs[0]!.message).toContain(String(DOT_MAX_ROWS));
    // On the first row left out: line 5 holds row 0.
    expect(errs[0]!.line).toBe(5 + DOT_MAX_ROWS);
    // The chart still draws.
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toHaveLength(DOT_MAX_ROWS);
    const c = draw(dumbbell(DOT_MAX_ROWS + 1));
    expect(c.querySelectorAll('.dot-row')).toHaveLength(DOT_MAX_ROWS);
  });

  it('400 rows draw 50 and one error names 400 and the limit', () => {
    const parsed = parseDot(dumbbell(400));
    const errs = parsed.diagnostics.filter((d) => d.code === CODE);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toContain('400');
    expect(parsed.rows).toHaveLength(DOT_MAX_ROWS);
  });

  it('the limit takes rows as written; sort orders only the rows kept', () => {
    const src = dumbbell(DOT_MAX_ROWS + 5).replace('gap\n', 'gap\nsort gap\n');
    const parsed = parseDot(src);
    const labels = new Set(parsed.rows.map((r) => r.label));
    for (let i = 0; i < DOT_MAX_ROWS; i++)
      expect(labels.has(NAME(i))).toBe(true);
  });
});

describe('dot labels never collide (#2432)', () => {
  it('a crowded chart: no two names overlap, and no two gap values', () => {
    const c = draw(dumbbell(DOT_MAX_ROWS));
    const names = [...c.querySelectorAll('.dot-row > text.dot-label')];
    // Thinned, but some remain, the first and the last among them.
    expect(names.length).toBeGreaterThan(1);
    expect(names.length).toBeLessThan(DOT_MAX_ROWS);
    expectNoOverlap(names.flatMap((t) => lineBoxes(t, TICK_FONT)));
    // Gaps share one column; too tight for a line each, they move to hover.
    const gaps = [...c.querySelectorAll('.dot-row > text.dot-gap')];
    expectNoOverlap(gaps.flatMap((t) => lineBoxes(t, VALUE_FONT)));
  });

  it('rows a line tall but not two keep every name on one line', () => {
    const c = draw(dumbbell(20), 960, 480);
    const names = [...c.querySelectorAll('.dot-row > text.dot-label')];
    expect(names).toHaveLength(20);
    for (const n of names) expect(n.querySelectorAll('tspan')).toHaveLength(1);
    expectNoOverlap(names.flatMap((t) => lineBoxes(t, TICK_FONT)));
    // A cut name keeps its full text, never in an <svg><title>.
    expect(names[0]!.getAttribute('data-full-text') ?? NAME(0)).toBe(NAME(0));
    expect(c.querySelectorAll('title')).toHaveLength(0);
  });

  it('dots shrink so a crowded row never reaches into the next', () => {
    const c = draw(dumbbell(DOT_MAX_ROWS));
    const rows = [...c.querySelectorAll('.dot-row')];
    const cy = (r: Element) =>
      Number(r.querySelector('.dot-dot')!.getAttribute('cy'));
    const step = cy(rows[1]!) - cy(rows[0]!);
    const r = Number(rows[0]!.querySelector('.dot-dot')!.getAttribute('r'));
    expect(2 * r).toBeLessThanOrEqual(step);
  });
});

describe('dot hover (#2432)', () => {
  const hover = (el: Element) =>
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  const unhover = (row: Element) =>
    row.dispatchEvent(new MouseEvent('mouseleave'));

  it('hovering a dot names its row, prints its values and recedes the rest', () => {
    const c = draw(dumbbell(DOT_MAX_ROWS));
    const rows = [...c.querySelectorAll<SVGGElement>('.dot-row')];
    // Row 1 has no drawn name: the thinning skipped it.
    const row = rows[1]!;
    expect(row.querySelector(':scope > text.dot-label')).toBeNull();
    hover(row.querySelector('.dot-dot')!);
    const name = row.querySelector('.dot-hover text.dot-label')!;
    expect(name.textContent).toContain('Region 1');
    expect(name.getAttribute('font-weight')).toBe('600');
    const values = [...row.querySelectorAll('.dot-hover-value')].map(
      (t) => t.textContent
    );
    expect(values).toEqual(['41', '52']);
    // The gap, hidden in the crowd, joins the hover.
    expect(row.querySelector('.dot-hover .dot-gap')!.textContent).toBe('+11');
    for (const other of rows)
      if (other !== row) expect(other.style.opacity).not.toBe('');
    expect(row.style.opacity).toBe('');

    unhover(row);
    expect(row.querySelector('.dot-hover')).toBeNull();
    for (const other of rows) expect(other.style.opacity).toBe('');
    // Back in reading order.
    expect([...c.querySelectorAll('.dot-row')]).toEqual(rows);
  });

  it('hovering a drawn name bolds it in place', () => {
    const c = draw(dumbbell(3));
    const row = c.querySelectorAll('.dot-row')[0]!;
    const name = row.querySelector('text.dot-label')!;
    hover(name);
    expect(name.getAttribute('font-weight')).toBe('600');
    expect(row.querySelectorAll('.dot-hover text.dot-label')).toHaveLength(0);
    expect(row.querySelectorAll('.dot-hover-value')).toHaveLength(2);
    unhover(row);
    expect(name.getAttribute('font-weight')).toBeNull();
  });

  it('an export draws no row hit areas; the live preview does', () => {
    expect(draw(dumbbell(3)).querySelectorAll('.dot-row-hit')).toHaveLength(0);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 960 });
    Object.defineProperty(container, 'clientHeight', { value: 480 });
    renderDot(container, parseDot(dumbbell(3)), palette, false);
    expect(container.querySelectorAll('.dot-row-hit')).toHaveLength(3);
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseRaci, allTasks } from '../src/raci/parser';
import { renderRaci } from '../src/raci/renderer';
import { MAX_RACI_ROLES, MAX_RACI_TASKS } from '../src/raci/limits';
import { getPalette } from '../src/palettes';

beforeAll(() => {
  const win = new JSDOM('<!DOCTYPE html><html><body></body></html>').window;
  for (const key of ['document', 'HTMLElement', 'SVGElement'] as const) {
    Object.defineProperty(globalThis, key, {
      value: key === 'document' ? win.document : win[key],
      configurable: true,
    });
  }
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
});

const palette = getPalette('nord').light;

/** A grid with every cell filled, like the 40 × 60 pressure file (#2460). */
function grid(roles: number, tasks: number, title = 'Pressure'): string {
  const names = Array.from({ length: roles }, (_, i) => `R${i}`);
  const out = [`raci ${title}`, `roles ${names.join(', ')}`, ''];
  for (let t = 0; t < tasks; t++) {
    out.push(`Task ${t}`);
    names.forEach((n, i) =>
      out.push(`  ${n}: ${i === 0 ? 'A' : i <= 2 ? 'R' : i % 2 ? 'C' : 'I'}`)
    );
  }
  return out.join('\n');
}

function renderAt(
  source: string,
  w: number,
  h: number,
  exportPath: boolean
): SVGSVGElement {
  const parsed = parseRaci(source, palette);
  const c = document.createElement('div');
  Object.defineProperty(c, 'clientWidth', { value: w });
  Object.defineProperty(c, 'clientHeight', { value: h });
  if (exportPath)
    renderRaci(c, parsed, palette, false, undefined, { width: w, height: h });
  else renderRaci(c, parsed, palette, false);
  return c.querySelector('svg')!;
}

const num = (el: Element, a: string) => Number(el.getAttribute(a) ?? 0);

/** Every rect of `selector` lies inside the viewBox, which `meet` fits to the canvas. */
function expectInside(svg: SVGSVGElement, selector: string): number {
  const [, , vw, vh] = svg.getAttribute('viewBox')!.split(' ').map(Number);
  const rects = [...svg.querySelectorAll(selector)];
  for (const r of rects) {
    const x = num(r, 'x');
    const y = num(r, 'y');
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + num(r, 'width')).toBeLessThanOrEqual(vw! + 0.5);
    expect(y + num(r, 'height')).toBeLessThanOrEqual(vh! + 0.5);
  }
  return rects.length;
}

const errs = (src: string, code: string) =>
  parseRaci(src, palette).diagnostics.filter((d) => d.code === code);

describe('RACI fits the canvas at the limits (#2460)', () => {
  const src = grid(MAX_RACI_ROLES, MAX_RACI_TASKS);
  const cases: Array<[string, number, number, boolean]> = [
    ['1200×800 pane', 1200, 800, false],
    ['600×400 pane', 600, 400, false],
    ['1200×800 export', 1200, 800, true],
  ];
  for (const [name, w, h, exp] of cases) {
    it(`draws every cell, header and legend pill inside the ${name}`, () => {
      const svg = renderAt(src, w, h, exp);
      // The element is the canvas, the viewBox is the layout: `meet` scales it in.
      expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMin meet');
      // Below the scale floor the element takes the container's width.
      const width = svg.getAttribute('width');
      expect(width === '100%' || Number(width) === w).toBe(true);
      if (!exp) expect(num(svg, 'height')).toBe(h);
      expect(expectInside(svg, '.raci-cell-hit')).toBe(
        MAX_RACI_ROLES * MAX_RACI_TASKS
      );
      expect(expectInside(svg, '.raci-column-body')).toBe(MAX_RACI_ROLES);
      expect(svg.querySelectorAll('.raci-column-label')).toHaveLength(
        MAX_RACI_ROLES
      );
      expect(
        expectInside(svg, '.raci-legend-chip rect')
      ).toBeGreaterThanOrEqual(4);
    });
  }

  it('the legend takes its own row instead of being cut beside a long title', () => {
    const long = 'A very long matrix title '.repeat(6).trim();
    const svg = renderAt(grid(4, 3, long), 500, 400, false);
    const chips = [...svg.querySelectorAll('.raci-legend-chip rect')];
    expect(chips.length).toBeGreaterThan(0);
    expectInside(svg, '.raci-legend-chip rect');
    // Below the title line, above the role headers.
    const titleY = num(svg.querySelector('.chart-title')!, 'y');
    const headerTop = Math.min(
      ...[...svg.querySelectorAll('.raci-column-body')].map((r) => num(r, 'y'))
    );
    for (const c of chips) {
      expect(num(c, 'y')).toBeGreaterThan(titleY);
      expect(num(c, 'y') + num(c, 'height')).toBeLessThanOrEqual(headerTop);
    }
  });
});

describe('RACI role and task limits (#2460)', () => {
  it('raises nothing at the limits', () => {
    const src = grid(MAX_RACI_ROLES, MAX_RACI_TASKS);
    expect(errs(src, 'E_RACI_TOO_MANY_ROLES')).toHaveLength(0);
    expect(errs(src, 'E_RACI_TOO_MANY_TASKS')).toHaveLength(0);
  });

  it('one role over: error on the first role left out, names the limit, suggests splitting by phase', () => {
    const src = grid(MAX_RACI_ROLES + 1, 3);
    const e = errs(src, 'E_RACI_TOO_MANY_ROLES');
    expect(e).toHaveLength(1);
    expect(e[0]!.severity).toBe('error');
    expect(e[0]!.message).toContain(`first ${MAX_RACI_ROLES}`);
    expect(e[0]!.message).toContain('MAX_RACI_ROLES');
    expect(e[0]!.message).toMatch(/per phase/);
    // The roles line declares them all; it is the first role over the limit's line.
    expect(src.split('\n')[e[0]!.line - 1]).toContain(`R${MAX_RACI_ROLES}`);
    const parsed = parseRaci(src, palette);
    expect(parsed.roles).toHaveLength(MAX_RACI_ROLES);
    for (const t of allTasks(parsed))
      expect(t.roleAssignments.every((a) => parsed.roles.includes(a.id))).toBe(
        true
      );
  });

  it('one task over: error on the first task left out, names the limit, suggests splitting by phase', () => {
    const src = grid(3, MAX_RACI_TASKS + 1);
    const e = errs(src, 'E_RACI_TOO_MANY_TASKS');
    expect(e).toHaveLength(1);
    expect(e[0]!.severity).toBe('error');
    expect(e[0]!.message).toContain(`first ${MAX_RACI_TASKS}`);
    expect(e[0]!.message).toContain('MAX_RACI_TASKS');
    expect(e[0]!.message).toMatch(/per phase/);
    expect(src.split('\n')[e[0]!.line - 1]).toBe(`Task ${MAX_RACI_TASKS}`);
    expect([...allTasks(parseRaci(src, palette))]).toHaveLength(MAX_RACI_TASKS);
  });

  it('drops a phase left with no task past the cut', () => {
    const body = Array.from(
      { length: MAX_RACI_TASKS },
      (_, i) => `  T${i}\n    Lead: A R`
    ).join('\n');
    const src = `raci\n\n[One]\n${body}\n\n[Two]\n  Late\n    Lead: A R`;
    const parsed = parseRaci(src, palette);
    expect(parsed.phases.map((p) => p.displayName)).toEqual(['One']);
  });

  it('the 40 × 60 pressure grid draws the limits and both errors', () => {
    const src = grid(40, 60);
    const parsed = parseRaci(src, palette);
    expect(parsed.roles).toHaveLength(MAX_RACI_ROLES);
    expect([...allTasks(parsed)]).toHaveLength(MAX_RACI_TASKS);
    const svg = renderAt(src, 1200, 800, false);
    expect(expectInside(svg, '.raci-cell-hit')).toBe(
      MAX_RACI_ROLES * MAX_RACI_TASKS
    );
  });
});

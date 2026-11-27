// bar-category-limit.test.ts — a bar chart draws at most BAR_MAX_CATEGORIES
// categories and raises one error past it (#2419).

import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { render } from '../src/render';
import { BAR_MAX_CATEGORIES } from '../src/charts-d3/bar-limits';

const CODE = 'E_BAR_TOO_MANY_CATEGORIES';
const rows = (n: number, values = '1') =>
  Array.from({ length: n }, (_, i) => `C${i + 1} ${values}`).join('\n');

/** 1-based line of the first data row, given the header lines before it. */
const firstRowLine = (header: string) => header.split('\n').length + 1;

describe('bar category limit (#2419)', () => {
  const variants: [string, string, string][] = [
    ['vertical', 'bar Big', '1'],
    ['horizontal', 'bar Big\norientation-horizontal', '1'],
    ['stacked', 'bar Big\nstack\n  A blue\n  B red', '1 2'],
    ['grouped', 'bar Big\ngroup\n  A blue\n  B red', '1 2'],
  ];

  for (const [name, header, values] of variants) {
    it(`${name}: ${BAR_MAX_CATEGORIES} categories raise nothing`, () => {
      const p = parseChart(`${header}\n${rows(BAR_MAX_CATEGORIES, values)}`);
      expect(p.diagnostics.filter((d) => d.code === CODE)).toEqual([]);
      expect(p.data).toHaveLength(BAR_MAX_CATEGORIES);
    });

    it(`${name}: one past the limit draws ${BAR_MAX_CATEGORIES} and raises one error`, () => {
      const n = BAR_MAX_CATEGORIES + 1;
      const p = parseChart(`${header}\n${rows(n, values)}`);
      const hits = p.diagnostics.filter((d) => d.code === CODE);
      expect(hits).toHaveLength(1);
      expect(hits[0]!.severity).toBe('error');
      expect(hits[0]!.line).toBe(firstRowLine(header) + BAR_MAX_CATEGORIES);
      expect(hits[0]!.message).toContain(`${n} categories`);
      expect(hits[0]!.message).toContain(`first ${BAR_MAX_CATEGORIES}`);
      expect(p.data).toHaveLength(BAR_MAX_CATEGORIES);
      expect(p.error).toBeFalsy();
    });
  }

  it('grouped-by-category stacks count categories, not columns', () => {
    const cats = (n: number) =>
      Array.from(
        { length: n },
        (_, i) => `Cat${i}\n  2024 1 2\n  2025 3 4`
      ).join('\n');
    const head = 'bar Big\nstack\n  A blue\n  B red\n';
    const ok = parseChart(head + cats(BAR_MAX_CATEGORIES));
    expect(ok.diagnostics.filter((d) => d.code === CODE)).toEqual([]);
    expect(ok.data).toHaveLength(BAR_MAX_CATEGORIES * 2);

    const over = parseChart(head + cats(BAR_MAX_CATEGORIES + 1));
    expect(over.diagnostics.filter((d) => d.code === CODE)).toHaveLength(1);
    expect(over.clusters).toHaveLength(BAR_MAX_CATEGORIES);
    expect(over.data).toHaveLength(BAR_MAX_CATEGORIES * 2);
  });

  it('300 categories render 50 bars and report the error through render()', async () => {
    const { svg, diagnostics } = await render(`bar Big\n${rows(300)}`, {
      theme: 'light',
    });
    expect(diagnostics.filter((d) => d.code === CODE)).toHaveLength(1);
    expect(svg).toContain('C50');
    expect(svg).not.toMatch(/>C51</);
  });
});

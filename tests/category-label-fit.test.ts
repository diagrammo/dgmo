import { describe, it, expect } from 'vitest';
import {
  planCategoryLabels,
  labelSurvives,
  TICK_FONT,
} from '../src/charts-d3/shared';
import { measureText } from '../src/utils/text-measure';
import { renderDataChartD3 } from '../src/charts-d3/index';

/** The real series that prompted this: 30 calendar days, one row missing. */
const DATES = Array.from({ length: 29 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 6, 17) + i * 86400000);
  return d.toISOString().slice(0, 10);
});

describe('planCategoryLabels', () => {
  it('draws every label flat when they all fit', () => {
    const plan = planCategoryLabels(['Q1', 'Q2', 'Q3', 'Q4'], 200);
    expect(plan).toMatchObject({ rotate: false, stride: 1 });
  });

  it('thins by 2 rather than rotating when a stride of 2 clears it', () => {
    // "Mon" is ~28px at 12px; a 20px slot needs a stride of 2, not rotation.
    const w = measureText('Mon', TICK_FONT);
    expect(w).toBeGreaterThan(20);
    expect(w + 8).toBeLessThanOrEqual(40);
    const plan = planCategoryLabels(['Mon', 'Tue', 'Wed', 'Thu'], 20);
    expect(plan).toMatchObject({ rotate: false, stride: 2 });
  });

  it('rotates rather than dropping two labels in three', () => {
    // 29 ISO dates across a ~900px plot: ~31px a slot against a ~67px label.
    const plan = planCategoryLabels(DATES, 900 / DATES.length);
    expect(plan.rotate).toBe(true);
    // Rotation buys enough room that nothing has to be dropped here.
    expect(plan.stride).toBe(1);
  });

  it('thins the rotated labels too when rotation alone is not enough', () => {
    // Two years of daily readings into the same width.
    const many = Array.from({ length: 730 }, (_, i) => `2026-01-${i}`);
    const plan = planCategoryLabels(many, 900 / many.length);
    expect(plan.rotate).toBe(true);
    expect(plan.stride).toBeGreaterThan(1);
  });

  it('reserves more vertical room for rotated labels than flat ones', () => {
    const flat = planCategoryLabels(['a', 'b'], 400);
    const rot = planCategoryLabels(DATES, 900 / DATES.length);
    expect(rot.rotate).toBe(true);
    expect(rot.height).toBeGreaterThan(flat.height);
  });

  it('never divides by an empty domain', () => {
    expect(planCategoryLabels([], 100)).toMatchObject({ stride: 1 });
    expect(() => planCategoryLabels(['a'], 0)).not.toThrow();
  });
});

describe('which labels survive thinning', () => {
  const kept = (plan: { keep: Set<number> }): number[] =>
    [...plan.keep].sort((a, b) => a - b);

  it('keeps both ends', () => {
    const plan = planCategoryLabels(DATES, 900 / DATES.length);
    const k = kept(plan);
    expect(k[0]).toBe(0);
    expect(k[k.length - 1]).toBe(DATES.length - 1);
  });

  it('never keeps two adjacent labels when it is thinning', () => {
    // The regression: 14 daily dates in a ~660px plot thinned to a stride of 2,
    // and the old rule bolted the last index on next to an already-kept one, so
    // 2026-08-15 and 2026-08-16 printed on top of each other.
    const fourteen = Array.from({ length: 14 }, (_, i) => `2026-08-${i + 3}`);
    const plan = planCategoryLabels(fourteen, 660 / fourteen.length);
    expect(plan.stride).toBeGreaterThan(1);
    const k = kept(plan);
    expect(k).toContain(0);
    expect(k).toContain(13);
    const gaps = k.slice(1).map((v, i) => v - k[i]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(plan.stride);
  });

  it('honours the stride at every count, both ends included', () => {
    for (let n = 2; n <= 200; n++) {
      const labels = Array.from({ length: n }, (_, i) => `2026-08-${i}`);
      const plan = planCategoryLabels(labels, 700 / n);
      const k = kept(plan);
      expect(k[0]).toBe(0);
      expect(k[k.length - 1]).toBe(n - 1);
      const gaps = k.slice(1).map((v, i) => v - k[i]!);
      if (gaps.length) {
        expect(Math.min(...gaps)).toBeGreaterThanOrEqual(plan.stride);
      }
    }
  });

  it('labelSurvives reads the plan', () => {
    const plan = planCategoryLabels(['a', 'b', 'c'], 500);
    expect(labelSurvives(plan, 0)).toBe(true);
    expect(labelSurvives(plan, 99)).toBe(false);
  });
});

describe('the rendered axis', () => {
  const rows = DATES.map((d, i) => `"${d}" ${(i % 9) + 1}`).join('\n');

  it('no longer stacks 29 date labels on top of each other', async () => {
    const svg = await renderDataChartD3(
      `line Active installs\n\n${rows}`,
      'light'
    );
    // Every surviving label is rotated, so none sits flat on the baseline.
    expect(svg).toContain('rotate(-40)');
    // and nothing was dropped — rotation bought enough room on its own.
    for (const d of DATES) expect(svg).toContain(`>${d}<`);
  });

  it('leaves a four-category chart flat and unthinned', async () => {
    const svg = await renderDataChartD3(
      'line Quarters\n\nQ1 4\nQ2 8\nQ3 6\nQ4 9',
      'light'
    );
    expect(svg).not.toContain('rotate(-40)');
    for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) expect(svg).toContain(`>${q}<`);
  });

  it('applies the same treatment to vertical bars', async () => {
    const svg = await renderDataChartD3(
      `bar Active installs\n\n${rows}`,
      'light'
    );
    expect(svg).toContain('rotate(-40)');
  });

  it('leaves horizontal bars alone — their names live in the left gutter', async () => {
    const svg = await renderDataChartD3(
      `bar Active installs\norientation-horizontal\n\n${rows}`,
      'light'
    );
    expect(svg).not.toContain('rotate(-40)');
  });
});

describe('the first rotated label stays inside the SVG', () => {
  const LONG = [
    "A·1 #1056 app the D mark's accessible name",
    'A·2 #930 agents consider Sonnet',
    'B5',
  ];
  const body = LONG.map((l, i) => `"${l}" ${[12.38, 6.43, 1.23][i]}`).join(
    '\n'
  );

  /** Left edge of the first rotated label, from its anchor and measured width. */
  function firstLabelLeft(svg: string): number {
    const m = svg.match(
      /<text[^>]*transform="translate\(([\d.]+),[\d.]+\) rotate\(-40\)"[^>]*>([^<]*)</
    );
    expect(m).not.toBeNull();
    const text = m![2]!.replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const rad = (40 * Math.PI) / 180;
    return Number(m![1]) - measureText(text, TICK_FONT) * Math.cos(rad);
  }

  for (const kind of ['bar', 'line']) {
    it(`${kind}: a long first label does not cross the left edge`, async () => {
      const svg = await renderDataChartD3(`${kind} Tokens\n\n${body}`, 'light');
      expect(svg).toContain('rotate(-40)');
      expect(firstLabelLeft(svg)).toBeGreaterThanOrEqual(0);
    });

    it(`${kind}: short labels keep the plot as wide as before`, async () => {
      const tight = await renderDataChartD3(
        `${kind} Tokens\n\nQ1 4\nQ2 8\nQ3 6`,
        'light'
      );
      expect(tight).not.toContain('rotate(-40)');
      // No rotation, so no widening: the gridlines start at the base margin.
      const x1 = Number(tight.match(/<line[^>]*x1="([\d.]+)"/)![1]);
      const long = await renderDataChartD3(
        `${kind} Tokens\n\n${body}`,
        'light'
      );
      const x1Long = Number(long.match(/<line[^>]*x1="([\d.]+)"/)![1]);
      expect(x1Long).toBeGreaterThan(x1);
    });
  }
});

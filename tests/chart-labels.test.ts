import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import {
  buildSimpleChartOption,
  renderExtendedChartForExport,
} from '../src/echarts';
import { getPalette } from '../src/palettes';
import { nordPalette } from '../src/palettes/nord';

const palette = getPalette('nord').light;

function build(input: string) {
  const parsed = parseChart(input, palette);
  return buildSimpleChartOption(parsed, palette, false);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function labelFormatter(opt: Record<string, unknown>): any {
  const series = (opt as { series: { label: { formatter: string } }[] }).series;
  return series?.[0]?.label?.formatter;
}

describe('Pie / Doughnut / Polar-Area configurable labels', () => {
  const data = '\nA 10\nB 20\nC 30';

  // ── Pie ────────────────────────────────────────────────────

  it('pie defaults to full format', () => {
    const opt = build('pie' + data);
    expect(labelFormatter(opt)).toBe('{b} — {c} ({d}%)');
  });

  it('pie no-value no-percent shows name only', () => {
    const opt = build('pie\nno-value\nno-percent' + data);
    expect(labelFormatter(opt)).toBe('{b}');
  });

  it('pie no-percent shows name and value', () => {
    const opt = build('pie\nno-percent' + data);
    expect(labelFormatter(opt)).toBe('{b} — {c}');
  });

  it('pie no-value shows name and percent', () => {
    const opt = build('pie\nno-value' + data);
    expect(labelFormatter(opt)).toBe('{b} — {d}%');
  });

  it('pie with all labels shows full format', () => {
    const opt = build('pie' + data);
    expect(labelFormatter(opt)).toBe('{b} — {c} ({d}%)');
  });

  // ── Doughnut ───────────────────────────────────────────────

  it('doughnut no-value no-percent shows name only', () => {
    const opt = build('doughnut\nno-value\nno-percent' + data);
    expect(labelFormatter(opt)).toBe('{b}');
  });

  // ── Polar-Area ─────────────────────────────────────────────

  it('polar-area no-name no-value shows percent only', () => {
    const opt = build('polar-area\nno-name\nno-value' + data);
    expect(labelFormatter(opt)).toBe('{d}%');
  });

  it('polar-area defaults to full format', () => {
    const opt = build('polar-area' + data);
    expect(labelFormatter(opt)).toBe('{b} — {c} ({d}%)');
  });

  // ── Parser ─────────────────────────────────────────────────

  it('parseChart stores no-* flags', () => {
    const parsed = parseChart('pie\nno-name\nno-value\nA 10', palette);
    expect(parsed.noName).toBe(true);
    expect(parsed.noValue).toBe(true);
    expect(parsed.noPercent).toBeUndefined();
  });

  it('parseChart defaults all labels visible', () => {
    const parsed = parseChart('pie\nA 10', palette);
    expect(parsed.noName).toBeUndefined();
    expect(parsed.noValue).toBeUndefined();
    expect(parsed.noPercent).toBeUndefined();
  });

  // ── Silent-ignore unknown no-* flags ───────────────────────

  it('silent-ignores typoed no-* flag (no-vlaue)', () => {
    const r = parseChart('pie\nno-vlaue\nA 10\nB 20', palette);
    expect(r.error).toBeNull();
    expect(r.noValue).toBeUndefined();
  });

  it('silent-ignores no-name on a bar chart (not honored, but parses)', () => {
    const r = parseChart('bar\nno-name\nA 10\nB 20', palette);
    expect(r.error).toBeNull();
    expect(r.noName).toBe(true);
  });
});

// ─── New cartesian value labels (Phase 2a) ────────────────────────

describe('Cartesian value labels (bar / line / area)', () => {
  const data = '\nJan 100\nFeb 200\nMar 150';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function labelShow(opt: Record<string, unknown>): any {
    const series = (opt as { series: { label?: { show?: boolean } }[] }).series;
    return series?.[0]?.label?.show;
  }

  it('bar shows values atop bars by default', () => {
    expect(labelShow(build('bar' + data))).toBe(true);
  });

  it('bar with no-value hides value labels', () => {
    expect(labelShow(build('bar\nno-value' + data))).toBe(false);
  });

  it('line shows values at points by default', () => {
    expect(labelShow(build('line' + data))).toBe(true);
  });

  it('line with no-value hides value labels', () => {
    expect(labelShow(build('line\nno-value' + data))).toBe(false);
  });

  it('area shows values at points by default', () => {
    expect(labelShow(build('area' + data))).toBe(true);
  });

  it('area with no-value hides value labels', () => {
    expect(labelShow(build('area\nno-value' + data))).toBe(false);
  });
});

// ─── Wired-existing-rendering renderer tests (Phase 1) ────────────

describe('no-value suppression on default-on charts', () => {
  it('radar shows values at vertices by default', () => {
    const data = '\nA 10\nB 20\nC 30\nD 40';
    const opt = build('radar' + data) as {
      series: { data: { label?: { show?: boolean } }[] }[];
    };
    expect(opt.series[0].data[0].label?.show).toBe(true);
  });

  it('radar with no-value hides vertex values', () => {
    const data = '\nA 10\nB 20\nC 30\nD 40';
    const opt = build('radar\nno-value' + data) as {
      series: { data: { label?: { show?: boolean } }[] }[];
    };
    expect(opt.series[0].data[0].label?.show).toBe(false);
  });

  it('bar-stacked shows segment values inside stacks by default', () => {
    const data = '\nseries A, B\nQ1 10, 20\nQ2 30, 40';
    const opt = build('bar-stacked' + data) as {
      series: { label?: { show?: boolean } }[];
    };
    expect(opt.series?.[0]?.label?.show).toBe(true);
  });

  it('bar-stacked with no-value hides segment values', () => {
    const data = '\nseries A, B\nQ1 10, 20\nQ2 30, 40';
    const opt = build('bar-stacked\nno-value' + data) as {
      series: { label?: { show?: boolean } }[];
    };
    expect(opt.series?.[0]?.label?.show).toBe(false);
  });
});

// ─── Stacked-segment label fit-gating + hover ────────────────────

describe('bar-stacked label fit-gating', () => {
  const data = '\nseries A, B\nQ1 10, 20\nQ2 30, 40';

  type FitFn = (p: {
    rect: { width: number; height: number };
    labelRect: { width: number; height: number };
  }) => { fontSize?: number; hideOverlap?: boolean };

  function fitFn(): FitFn {
    const opt = build('bar-stacked' + data) as {
      series: { labelLayout?: FitFn }[];
    };
    const fn = opt.series?.[0]?.labelLayout;
    if (typeof fn !== 'function') throw new Error('no labelLayout callback');
    return fn;
  }

  it('attaches a labelLayout fit-check to each segment series', () => {
    const opt = build('bar-stacked' + data) as {
      series: { labelLayout?: unknown }[];
    };
    for (const s of opt.series) expect(typeof s.labelLayout).toBe('function');
  });

  it('keeps the label when the value fits inside the segment', () => {
    const out = fitFn()({
      rect: { width: 80, height: 40 },
      labelRect: { width: 30, height: 16 },
    });
    expect(out.fontSize).toBeUndefined();
    expect(out.hideOverlap).toBe(true);
  });

  it('hides the label when the segment is too short to hold it', () => {
    const out = fitFn()({
      rect: { width: 80, height: 10 },
      labelRect: { width: 30, height: 16 },
    });
    expect(out.fontSize).toBe(0);
  });

  it('hides the label when the segment is too narrow to hold it', () => {
    const out = fitFn()({
      rect: { width: 20, height: 40 },
      labelRect: { width: 30, height: 16 },
    });
    expect(out.fontSize).toBe(0);
  });

  it('does not enable a native tooltip (consistent with other charts; hidden values are revealed on hover instead)', () => {
    const opt = build('bar-stacked' + data) as {
      tooltip?: { show?: boolean };
    };
    expect(opt.tooltip?.show).not.toBe(true);
  });
});

// ─── Many-series resting cull (AC9) — rendered SSR output ─────────

describe('bar-stacked many-series fit-gate culls multiple labels (AC9)', () => {
  // ~9 series with several segments too small to hold their value text,
  // mirroring the motivating "Monthly Cost by Service" pile-up case.
  const manySeries = `bar-stacked Monthly Cost by Service
x-label Month
y-label Cost USD

series
  Others gray
  Cloud Run blue
  Invoice green
  reCAPTCHA orange
  Cloud Logging red
  Cloud Dataflow purple
  Networking yellow
  Cloud Monitoring cyan
  Big teal

Jan-25 4839 98 828 265 404 1128 3032 5828 52177
Feb-25 5549 94 789 239 533 1028 2968 5303 51078
Mar-25 4802 130 855 488 808 1138 3886 6850 62152`;

  // All 27 segment values, in row order.
  const allValues = [
    4839, 98, 828, 265, 404, 1128, 3032, 5828, 52177, 5549, 94, 789, 239, 533,
    1028, 2968, 5303, 51078, 4802, 130, 855, 488, 808, 1138, 3886, 6850, 62152,
  ].map(String);

  it('culls a large fraction of segment labels, not just one', async () => {
    const svg = await renderExtendedChartForExport(
      manySeries,
      'dark',
      nordPalette.dark
    );

    // Count-based (not cherry-picked): of 27 segments, materially fewer than
    // all are labeled — proving multiple culls. A regression that stopped
    // culling (or that culled everything) fails this bound.
    const shown = allValues.filter((v) => svg.includes(`>${v}<`));
    expect(shown.length).toBeLessThan(allValues.length - 6);
    expect(shown.length).toBeGreaterThan(0);

    // The dominant segments must still be labeled.
    for (const v of ['52177', '51078', '62152']) {
      expect(svg, `large value ${v} should be shown`).toContain(`>${v}<`);
    }
    // Clearly-too-small segments must be culled.
    for (const v of ['98', '94', '130']) {
      expect(svg, `tiny value ${v} should be culled`).not.toContain(`>${v}<`);
    }
  });
});

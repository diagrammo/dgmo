import { describe, it, expect } from 'vitest';
import { parseChart, parseDataRowValues } from '../src/chart';
import { parseExtendedChart } from '../src/data-chart-parser';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

const RADAR = (row: string): string =>
  `radar Ship Combat Ratings\nseries\n  Black Pearl blue\n  Flying Dutchman orange\n\n${row}\n`;

const messages = (src: string): string[] =>
  parseChart(src, palette).diagnostics.map((d) => d.message);

// ------------------------------------------------------------
// Surplus values on a multi-series row (radar/bar/line/pie).
//
// Too-few values already warned; too-many silently absorbed the surplus into
// the label ("Armor 50 60 70 80" → axis labelled "Armor 50 60"), so a
// digit-suffixed attribute name mislabelled an axis with a clean validator.
// ------------------------------------------------------------
describe('multi-series data row — surplus values', () => {
  it('warns when a row ends in more numbers than there are series', () => {
    const msgs = messages(RADAR('Armor 50 60 70 80'));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('has 4 value(s), but 2 series defined');
  });

  it('names the label without its absorbed numbers', () => {
    // Not the corrupted "Armor 50 60" the label actually became.
    expect(messages(RADAR('Armor 50 60 70 80'))[0]).toContain(
      'Data point "Armor"'
    );
  });

  it('suggests the quoted form that resolves the ambiguity', () => {
    expect(messages(RADAR('Wi-Fi 6 70 80'))[0]).toContain(
      'quote it: "Wi-Fi 6" 70 80'
    );
  });

  it('still warns on too-few values (unchanged)', () => {
    expect(messages(RADAR('Hull 90'))[0]).toContain(
      'has 1 value(s), but 2 series defined'
    );
  });

  it('is silent when the row has exactly one value per series', () => {
    expect(messages(RADAR('Speed 70 80'))).toEqual([]);
  });

  it('is silent for a digit-bearing label with no surplus', () => {
    // "IPv6" is a single token — no ambiguity, nothing to warn about.
    expect(messages(RADAR('IPv6 70 80'))).toEqual([]);
  });
});

// ------------------------------------------------------------
// Quoting is the documented escape hatch — it must actually work.
// ------------------------------------------------------------
describe('multi-series data row — quoted label escape hatch', () => {
  it('keeps a quoted digit-suffixed label intact and strips the quotes', () => {
    const parsed = parseChart(RADAR('"Wi-Fi 6" 70 80'), palette);
    expect(parsed.data[0]?.label).toBe('Wi-Fi 6');
    expect(parsed.data[0]?.value).toBe(70);
    expect(parsed.data[0]?.extraValues).toEqual([80]);
  });

  it('silences the surplus-value warning', () => {
    expect(messages(RADAR('"Wi-Fi 6" 70 80'))).toEqual([]);
    expect(messages(RADAR('"Armor 50 60" 70 80'))).toEqual([]);
  });

  it('accepts single quotes too', () => {
    const parsed = parseChart(RADAR("'Layer 3' 70 80"), palette);
    expect(parsed.data[0]?.label).toBe('Layer 3');
    expect(parsed.data[0]?.extraValues).toEqual([80]);
  });

  it('strips quotes in single-value mode as well', () => {
    const parsed = parseChart('bar Ports\n"Tortuga 2" 300\n', palette);
    expect(parsed.data[0]?.label).toBe('Tortuga 2');
    expect(parsed.data[0]?.value).toBe(300);
  });
});

// ------------------------------------------------------------
// Single-value rows (no series header, or a naturally single-value type like
// funnel) are deliberately NOT warned. The last token is the value and
// everything before it is the label, so "Day 1 8" → label "Day 1", value 8 —
// which is correct and is the most common axis-labelling pattern there is
// (Day N, Week N, Q3 2024). Warning on it would be noise on nearly every real
// line/bar chart. The multi-series guard above stays, because a series block
// fixes an exact count and a surplus there is genuinely ambiguous.
// ------------------------------------------------------------
const SINGLE_RADAR = (row: string): string =>
  `radar Ship Combat Ratings\n\n${row}\n`;

const funnelMessages = (src: string): string[] =>
  parseExtendedChart(src, palette).diagnostics.map((d) => d.message);

describe('single-value data row — no surplus warning', () => {
  it('does not warn on a seriesless row ending in more than one number', () => {
    expect(messages(SINGLE_RADAR('Armor 50 60'))).toEqual([]);
    expect(funnelMessages('funnel Loot Pipeline\n\nArmor 50 60\n')).toEqual([]);
  });

  it('takes the last token as the value, the rest as the label', () => {
    const parsed = parseChart(SINGLE_RADAR('Armor 50 60'), palette);
    expect(parsed.data[0]?.label).toBe('Armor 50');
    expect(parsed.data[0]?.value).toBe(60);
  });

  it('a quoted label is honored and also clean', () => {
    expect(messages(SINGLE_RADAR('"Armor 50" 60'))).toEqual([]);
    const parsed = parseChart(SINGLE_RADAR('"Armor 50" 60'), palette);
    expect(parsed.data[0]?.label).toBe('Armor 50');
    expect(parsed.data[0]?.value).toBe(60);
  });

  it('stays clean on a plain single-number row', () => {
    for (const row of ['Layer3 90', 'Q1 45', 'Armor 60']) {
      expect(messages(SINGLE_RADAR(row))).toEqual([]);
      expect(funnelMessages(`funnel Loot Pipeline\n\n${row}\n`)).toEqual([]);
    }
  });
});

describe('parseDataRowValues — reporting fields', () => {
  it('reports the full trailing numeric run even when capped', () => {
    const row = parseDataRowValues('Armor 50 60 70 80', {
      multiValue: true,
      expectedValues: 2,
    });
    expect(row?.values).toEqual([70, 80]);
    expect(row?.trailingNumericCount).toBe(4);
    expect(row?.bareLabel).toBe('Armor');
    expect(row?.quotedLabel).toBe(false);
  });

  it('leaves single-value label-with-number parsing untouched', () => {
    // The documented single-value rule: only the last token is a value.
    const row = parseDataRowValues('Region 5 300');
    expect(row?.label).toBe('Region 5');
    expect(row?.values).toEqual([300]);
  });

  it('returns null for a quoted label followed by a non-numeric token', () => {
    expect(
      parseDataRowValues('"Wi-Fi 6" fast', { multiValue: true })
    ).toBeNull();
  });
});

// ------------------------------------------------------------
// Sankey link color: an unrecognized trailing token used to make the line
// match no link form, so it was re-read as a bare node — the flow band
// vanished and the only diagnostic was "No links found" on line 1.
// ------------------------------------------------------------
const links = (
  src: string
): { source: string; target: string; value: number; color?: string }[] =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((parseExtendedChart(src, palette) as any).links ?? []) as {
    source: string;
    target: string;
    value: number;
    color?: string;
  }[];

const linkDiags = (src: string): { message: string; line: number }[] =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (parseExtendedChart(src, palette) as any).diagnostics.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d: any) => ({ message: d.message as string, line: d.line as number })
  );

describe('sankey — invalid link color', () => {
  const INDENTED =
    'sankey Plunder\n\nGold Haul\n  Crew Shares 300 zzznotacolor\n';
  const ARROW = 'sankey Plunder\n\nGold Haul -> Crew Shares 300 zzznotacolor\n';

  it('keeps the link on an indented child', () => {
    expect(links(INDENTED)).toHaveLength(1);
    expect(links(INDENTED)[0]).toMatchObject({
      source: 'Gold Haul',
      target: 'Crew Shares',
      value: 300,
    });
  });

  it('keeps the link on an arrow row', () => {
    expect(links(ARROW)).toHaveLength(1);
    expect(links(ARROW)[0]).toMatchObject({
      source: 'Gold Haul',
      target: 'Crew Shares',
      value: 300,
    });
  });

  it('names the offending token on the offending line', () => {
    const diags = linkDiags(INDENTED);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.message).toContain('"zzznotacolor"');
    expect(diags[0]?.line).toBe(4);
  });

  it('no longer reports the misleading "No links found"', () => {
    expect(
      linkDiags(INDENTED).some((d) => d.message.includes('No links found'))
    ).toBe(false);
  });

  it('offers a did-you-mean suggestion for a near-miss color', () => {
    const diags = linkDiags(
      'sankey Plunder\n\nGold Haul\n  Crew Shares 300 gray\n'.replace(
        'gray',
        'grey'
      )
    );
    expect(diags[0]?.message).toContain('grey');
    expect(diags[0]?.message).toMatch(/Did you mean.*gray/);
  });

  it('leaves valid link colors working (no regression)', () => {
    const valid = 'sankey Plunder\n\nGold Haul\n  Crew Shares 300 gray\n';
    expect(linkDiags(valid)).toEqual([]);
    expect(links(valid)[0]?.color).toBeTruthy();
  });
});

// ------------------------------------------------------------
// Heatmap rows — the same ambiguity, one construct over.
//
// `columns` fixes an exact value count, so "Compound 1 5 4 3" against three
// columns is resolvable rather than ambiguous. The greedy walk used to eat the
// "1" as data: the label became "Compound", the row carried four values against
// three columns, every cell shifted one column left, and nothing warned. Filed
// from outside against 0.75.0 (the numbered heatmap row label, dgmo#42).
// ------------------------------------------------------------
describe('heatmap data row — numbered row label', () => {
  const HEATMAP = (row: string): string =>
    `heatmap Assay\ncolumns\n  X\n  Y\n  Z\n${row}\n`;
  const parse = (row: string) => parseExtendedChart(HEATMAP(row), palette);

  it('keeps the trailing number in the label when columns fix the count', () => {
    const rows = parse('Compound 1 5 4 3').heatmapRows;
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.label).toBe('Compound 1');
    expect(rows?.[0]?.values).toEqual([5, 4, 3]);
  });

  it('warns that the surplus number was welded back into the label', () => {
    const msgs = parse('Compound 1 5 4 3').diagnostics.map((d) => d.message);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('has 4 value(s), but 3 series defined');
    expect(msgs[0]).toContain('quote it: "Compound 1" 5 4 3');
  });

  it('leaves an unambiguous row alone, with no diagnostic', () => {
    const parsed = parse('Compound 5 4 3');
    expect(parsed.heatmapRows?.[0]?.label).toBe('Compound');
    expect(parsed.heatmapRows?.[0]?.values).toEqual([5, 4, 3]);
    expect(parsed.diagnostics).toEqual([]);
  });

  it('never warns on the quoted escape hatch', () => {
    const parsed = parse('"Compound 1" 5 4 3');
    expect(parsed.heatmapRows?.[0]?.label).toBe('Compound 1');
    expect(parsed.heatmapRows?.[0]?.values).toEqual([5, 4, 3]);
    expect(parsed.diagnostics).toEqual([]);
  });

  it('handles a label that is several words ending in a number', () => {
    const rows = parse('Run 3 batch 12 5 4 3').heatmapRows;
    expect(rows?.[0]?.label).toBe('Run 3 batch 12');
    expect(rows?.[0]?.values).toEqual([5, 4, 3]);
  });
});

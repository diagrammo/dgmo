import { describe, it, expect } from 'vitest';
import { loadCorpus, renderFixture } from './stress/corpus';

// #1947: a sankey cut every node name longer than the room beside its node
// with "…" (`truncateText` in src/charts-d3/sankey.ts). A name now wraps at
// word breaks into its node's band, and only the last line that fits is cut.

const fixture = loadCorpus().find(
  (f) => f.id === 'sankey/long-labels--federal-budget.dgmo'
)!;

/** Every drawn line of every 13px node label, as text. */
function labelLines(svg: string): string[] {
  const lines: string[] = [];
  for (const m of svg.matchAll(/<text([^>]*)>(.*?)<\/text>/g)) {
    if (!m[1]!.includes('font-size="13"')) continue;
    const body = m[2]!.replace(/<title>.*?<\/title>/g, '');
    const spans = [
      ...body.matchAll(/<tspan(?![^>]*font-weight)[^>]*>([^<]*)/g),
    ];
    const head = /^([^<]*)/.exec(body)![1]!;
    if (head) lines.push(head);
    for (const s of spans) lines.push(s[1]!);
  }
  return lines;
}

describe('sankey long node names (#1947)', () => {
  it('draws no name of 30–50 characters ending in "…"', async () => {
    const r = await renderFixture(fixture);
    expect(r.errors).toEqual([]);
    const lines = labelLines(r.svg);
    expect(lines.length).toBeGreaterThan(14);
    expect(lines.filter((l) => l.endsWith('…'))).toEqual([]);
    expect(r.svg).not.toContain('<title>');
  });

  it('keeps every word of every node name', async () => {
    const r = await renderFixture(fixture);
    const drawn = labelLines(r.svg).join(' ');
    for (const name of [
      'Individual income tax withheld from wages',
      'Interest payments on outstanding public debt',
      'Unemployment insurance and parental leave',
    ]) {
      for (const word of name.split(' ')) expect(drawn).toContain(word);
    }
  });

  it('lints clean: no text over text, none past the canvas', async () => {
    const r = await renderFixture(fixture);
    expect(r.findings).toEqual([]);
  });
});

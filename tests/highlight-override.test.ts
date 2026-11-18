// A per-export `highlight` (#2042): the CLI's `--highlight`, a docs fence's
// `highlight="…"` and the MCP parameter all reach `render({ highlight })`.
// It replaces the file's own `highlight` line; `none` clears it.
import { describe, it, expect } from 'vitest';
import { render } from '../src/render';
import {
  applyHighlightOverride,
  HIGHLIGHT_OVERRIDE_MARK,
} from '../src/utils/emphasis';

const LINE = `line Fleet Size

series
  Navy
    highlight
  Merchant
  Pirate

1700 11 43 27
1710 13 47 31`;

/** Series drawn in the story ground, by name. */
async function grey(highlight?: string): Promise<string[]> {
  const { svg } = await render(LINE, highlight ? { highlight } : undefined);
  const host = document.createElement('div');
  host.innerHTML = svg;
  const lit = new Set<string>();
  const all: string[] = [];
  for (const g of host.querySelectorAll('g.dgmo-series')) {
    const name = g.getAttribute('data-series-name')!;
    all.push(name);
    const stroke = g.querySelector('.dgmo-series-line')?.getAttribute('stroke');
    if (stroke === g.getAttribute('data-color')) lit.add(name);
  }
  return all.filter((n) => !lit.has(n)).sort();
}

describe('per-export highlight', () => {
  it('without an override, the file’s line wins', async () => {
    expect(await grey()).toEqual(['Merchant', 'Pirate']);
  });

  it('replaces the file’s line, never merges with it', async () => {
    expect(await grey('Pirate')).toEqual(['Merchant', 'Navy']);
  });

  it('takes a comma list', async () => {
    expect(await grey('Pirate, Merchant')).toEqual(['Navy']);
  });

  it('none clears the file’s line', async () => {
    expect(await grey('none')).toEqual([]);
  });

  it('keeps every line number in place', () => {
    const out = applyHighlightOverride(LINE, 'Pirate').split('\n');
    const src = LINE.split('\n');
    expect(out.slice(0, src.length).filter((l, i) => l !== src[i])).toEqual([
      '//',
    ]);
    // The indented `highlight` under Navy (line 5) is the one replaced.
    expect(out[4]).toBe('//');
    expect(out.at(-1)).toBe('highlight Pirate');
  });

  it('on a data chart the appended line rides on the override mark', () => {
    const out = applyHighlightOverride(LINE, 'Pirate').split('\n');
    expect(out.at(-2)).toBe(HIGHLIGHT_OVERRIDE_MARK);
    const sankey = applyHighlightOverride('sankey S\nA -> B 5', 'A');
    expect(sankey).not.toContain(HIGHLIGHT_OVERRIDE_MARK);
  });

  it('a blank override changes nothing', () => {
    expect(applyHighlightOverride(LINE, '  ')).toBe(LINE);
    expect(applyHighlightOverride(LINE, undefined)).toBe(LINE);
  });

  it('a capitalised Highlight row stays data', () => {
    const bar = `bar Reels\nHighlight Reel 5\nBlooper Reel 3`;
    expect(applyHighlightOverride(bar, 'none')).toBe(bar);
  });
});

describe('per-export highlight on each story-view type', () => {
  const cases: Record<string, string> = {
    bar: `bar Ports\nNassau 3\nTortuga 4\nHavana 2`,
    pie: `pie Share\nRum 40\nSilk 35\nSpice 25`,
    sankey: `sankey Flow\nA\n  B 10\n  C 5`,
    slope: `slope Rank\n\nperiod 2020 2025\n\nRum 1 2\nSilk 2 1`,
  };
  const name: Record<string, string> = {
    bar: 'Nassau',
    pie: 'Rum',
    sankey: 'B',
    slope: 'Rum',
  };
  for (const [type, src] of Object.entries(cases)) {
    it(`${type}: an appended highlight parses with no diagnostics`, async () => {
      const { diagnostics, svg } = await render(src, {
        highlight: name[type]!,
      });
      expect(diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
      const plain = await render(src);
      expect(svg).not.toBe(plain.svg);
    });
  }
});

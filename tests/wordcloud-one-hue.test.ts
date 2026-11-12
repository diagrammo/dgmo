// A wordcloud draws every word in ONE hue (#1931, split from #1829): size
// already carries the weight, so a hue per word encodes nothing. The hue is
// the palette's primary — the same default a single-series bar takes — in
// both the interactive renderer and the export path.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '../src/render';
import { renderWordCloud } from '../src/wordcloud/renderer';
import { parseWordcloud } from '../src/wordcloud/parser';
import '../src/palettes/index';
import { getAvailablePalettes } from '../src/palettes/registry';

const SOURCE = `wordcloud Pirate Skills
rotate none

swordsmanship 95
navigation 88
plundering 80
cannons 72
rum 65
parley 50
knots 40
maps 30`;

const fills = (svg: string): string[] =>
  [...svg.matchAll(/<text\b[^>]*?fill:\s*([^;"]+)[^>]*>/g)].map((m) =>
    m[1]!.trim().toLowerCase()
  );

// jsdom serialises a style fill as rgb(); normalise an expected hex the same way.
const norm = (color: string): string => {
  const probe = document.createElement('span');
  probe.style.fill = color;
  return probe.style.fill.toLowerCase();
};

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('wordcloud colour', () => {
  for (const p of getAvailablePalettes()) {
    for (const mode of ['light', 'dark'] as const) {
      const c = p[mode];
      it(`${p.id} ${mode}: export draws every word in the primary hue`, async () => {
        const { svg } = await render(SOURCE, { theme: mode, palette: p.id });
        const words = fills(svg).filter((f) => f !== norm(c.text));
        // Eight words, all drawn; the title is the only other text.
        expect(words).toHaveLength(8);
        expect(new Set(words)).toEqual(new Set([norm(c.primary)]));
      });
    }
  }

  it('the interactive renderer draws every word in the primary hue', () => {
    const p = getAvailablePalettes()[0]!.light;
    const parsed = parseWordcloud(SOURCE, p);
    renderWordCloud(host, parsed, p, false, undefined, {
      width: 800,
      height: 500,
    });
    const words = [...host.querySelectorAll('text')]
      .filter((t) => (t.textContent ?? '') !== 'Pirate Skills')
      .map((t) => (t.style.fill || '').toLowerCase());
    expect(words).toHaveLength(8);
    expect(new Set(words)).toEqual(new Set([norm(p.primary)]));
  });
});

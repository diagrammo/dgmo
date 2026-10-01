import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '../src/render';
import { summarizeDiagram } from '../src/utils/diagram-summary';
import { applyRootDesc } from '../src/utils/root-a11y';

// diagrammo/diagrammo#954 — every rendered SVG carries a <desc> saying what it
// shows, wired to the root with aria-describedby. Landed by chart type; the
// types below are the ones with a summarizer so far.
const SUMMARIZED = [
  'sequence',
  'org',
  'bar',
  'line',
  'pie',
  'radar',
  'polar-area',
];

const GALLERY_DIR = join(__dirname, '..', 'gallery', 'fixtures');
const fixtures = readdirSync(GALLERY_DIR)
  .filter((f) => f.endsWith('.dgmo'))
  .map((f) => ({
    file: f,
    content: readFileSync(join(GALLERY_DIR, f), 'utf8'),
  }))
  .filter(({ content }) => {
    const type = content.trimStart().split(/\s/, 1)[0]!.toLowerCase();
    return SUMMARIZED.includes(type);
  });

/** The root tag's aria-describedby target and the text of the <desc> it names. */
function rootDesc(svg: string): { id: string | null; text: string | null } {
  const root = svg.match(/<svg\b[^>]*>/)![0];
  const id = /\baria-describedby="([^"]+)"/.exec(root)?.[1] ?? null;
  if (!id) return { id, text: null };
  const after = svg.slice(svg.indexOf(root) + root.length);
  const desc = new RegExp(`^<desc id="${id}">([^<]*)</desc>`).exec(after);
  return { id, text: desc?.[1] ?? null };
}

describe('root <desc> summary (#954)', () => {
  it('covers every summarized chart type in the gallery', () => {
    const types = new Set(
      fixtures.map(({ content }) =>
        content.trimStart().split(/\s/, 1)[0]!.toLowerCase()
      )
    );
    expect([...types].sort()).toEqual([...SUMMARIZED].sort());
  });

  it.each(fixtures.map((f) => [f.file, f.content]))(
    '%s renders a non-empty <desc> as the root’s first child',
    async (_file, content) => {
      const { svg } = await render(content);
      const { id, text } = rootDesc(svg);
      expect(id).toMatch(/^dgmo-desc-[0-9a-f]{8}$/);
      expect(text?.trim()).toBeTruthy();
    }
  );

  it('says what a bar chart shows', () => {
    const src = 'bar Revenue\n\nEnterprise 245\nStarter 97\nFree Trial 43\n';
    expect(summarizeDiagram(src, 'bar')).toBe(
      'Bar chart for 3 categories, from Free Trial at 43 to Enterprise at 245.'
    );
  });

  it('names a multi-series line chart’s series and its x range', () => {
    const src =
      'line Oil\n\nseries\n  Price\n  Reserve\n\n2019 57 645\n2020 39 638\n2021 68 621\n';
    expect(summarizeDiagram(src, 'line')).toBe(
      'Line chart of 2 series, Price and Reserve, over 3 points, from 2019 to 2021; values range from 39 to 645.'
    );
  });

  it('gives a pie chart’s largest slice as a share of the total', () => {
    const src = 'pie Share\n\nA 60\nB 30\nC 10\n';
    expect(summarizeDiagram(src, 'pie')).toBe(
      'Pie chart with 3 slices totalling 100; the largest is A at 60%.'
    );
  });

  it('lists a sequence diagram’s participants and counts its messages', () => {
    const src =
      'sequence Login\n\nUser -submit-> App\nApp -check-> API\nAPI -ok-> App\n';
    expect(summarizeDiagram(src, 'sequence')).toBe(
      'Sequence diagram of 3 participants, User, App and API, exchanging 3 messages.'
    );
  });

  it('names who heads an org chart and counts the people under them', () => {
    const src =
      'org Team\n\nJane Smith\n  role: CEO\n\n  Alex Chen\n  Maria Lopez\n';
    expect(summarizeDiagram(src, 'org')).toBe(
      'Org chart of 3 people, headed by Jane Smith (CEO).'
    );
  });

  it('cuts a long name list short', () => {
    const src = `sequence Many\n\n${'ABCDEFG'
      .split('')
      .map((c, i, a) => `${c} -m-> ${a[(i + 1) % a.length]}`)
      .join('\n')}\n`;
    expect(summarizeDiagram(src, 'sequence')).toBe(
      'Sequence diagram of 7 participants, A, B, C, D, E and 2 more, exchanging 7 messages.'
    );
    // One over the limit lists everyone: "and 1 more" costs as much as the name.
    const six = `sequence Six\n\n${'ABCDEF'
      .split('')
      .map((c, i, a) => `${c} -m-> ${a[(i + 1) % a.length]}`)
      .join('\n')}\n`;
    expect(summarizeDiagram(six, 'sequence')).toBe(
      'Sequence diagram of 6 participants, A, B, C, D, E and F, exchanging 6 messages.'
    );
  });

  it('escapes the summary and leaves an existing aria-describedby alone', () => {
    const svg = '<svg viewBox="0 0 1 1"><g/></svg>';
    expect(applyRootDesc(svg, 'R&D <core>')).toMatch(
      /^<svg aria-describedby="(dgmo-desc-[0-9a-f]{8})" viewBox="0 0 1 1"><desc id="\1">R&amp;D &lt;core&gt;<\/desc><g\/><\/svg>$/
    );
    const owned = '<svg aria-describedby="mine"><g/></svg>';
    expect(applyRootDesc(owned, 'x')).toBe(owned);
    expect(applyRootDesc(svg, null)).toBe(svg);
  });

  it('gives no summary for a chart type without a summarizer yet', () => {
    expect(summarizeDiagram('flowchart F\n\nA -> B\n', 'flowchart')).toBeNull();
  });
});

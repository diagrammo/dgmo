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
  'flowchart',
  'state',
  'class',
  'er',
  'kanban',
  'c4',
  'sitemap',
  'infra',
  'gantt',
  'pert',
  'boxes-and-lines',
  'sketch',
  'swimlane',
  'family',
  'version-control',
  'mindmap',
  'wireframe',
  'journey-map',
  'raci',
  'body',
  'bracket',
  'live-link',
];

/** Summarized types the gallery has no fixture for; rendered below instead. */
const NO_GALLERY_FIXTURE = ['raci', 'live-link'];

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
    expect([...types].sort()).toEqual(
      SUMMARIZED.filter((t) => !NO_GALLERY_FIXTURE.includes(t)).sort()
    );
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

  it.each([['R$&D'], ["Low $'"], ['Basic $`'], ['Rent $$']])(
    'puts a label holding %s into the <desc> literally',
    async (label) => {
      const { svg } = await render(`bar Price\n\n${label} 10\nPro 20\n`);
      expect(rootDesc(svg).text).toBe(
        `Bar chart for 2 categories, from ${label.replace(/&/g, '&amp;')} at 10 to Pro at 20.`
      );
      expect(svg.match(/<svg\b/g)).toHaveLength(1);
      expect(svg.match(/<\/svg>/g)).toHaveLength(1);
    }
  );

  it.each([
    ['raci', 'raci Launch\n\nShip it\n  Cap: A\n  Crew: R\n'],
    [
      'live-link',
      'live-link Platform architecture\nurl https://online.diagrammo.app/d/dgm_7f2a91\n',
    ],
  ])(
    '%s renders a non-empty <desc> without a gallery fixture',
    async (_t, src) => {
      const { svg } = await render(src);
      const { id, text } = rootDesc(svg);
      expect(id).toMatch(/^dgmo-desc-[0-9a-f]{8}$/);
      expect(text?.trim()).toBeTruthy();
    }
  );

  it('counts a flowchart’s steps and decisions and names where it starts', () => {
    const src =
      'flowchart Order\n\n(Start) -> <Paid?>\n  -yes-> [Ship]\n  -no-> [Cancel]\n';
    expect(summarizeDiagram(src, 'flowchart')).toBe(
      'Flowchart of 4 steps (1 decision) and 3 connections, starting at Start.'
    );
  });

  it('leaves a state diagram’s start and end markers out of its states', () => {
    const src = 'state Door\n\n[*] -> Closed\nClosed -> Open\nOpen -> [*]\n';
    expect(summarizeDiagram(src, 'state')).toBe(
      'State diagram of 2 states, Closed and Open, with 3 transitions.'
    );
  });

  it('names where a flowchart starts, not the step written first', () => {
    const src =
      'flowchart Release\n\n[Review] -> [Ship]\n(Start) -> [Write] -> [Review]\n';
    expect(summarizeDiagram(src, 'flowchart')).toBe(
      'Flowchart of 4 steps and 3 connections, starting at Start.'
    );
    // All loop, nothing leads in from outside: no start to name.
    expect(
      summarizeDiagram(
        'flowchart Spin\n\n[A] -> [B]\n[B] -> [A]\n',
        'flowchart'
      )
    ).toBe('Flowchart of 2 steps and 2 connections.');
  });

  it('counts the matches a seeded bracket draws before any is played', () => {
    const seeds = 'ABCDEFGH'
      .split('')
      .map((c, i) => `seed ${i + 1} ${c}`)
      .join('\n');
    expect(summarizeDiagram(`bracket Cup\n\n${seeds}\n`, 'bracket')).toBe(
      'Tournament bracket of 8 competitors in 7 matches, 0 decided.'
    );
    expect(
      summarizeDiagram(
        `bracket Cup\n\n${seeds}\n\nA beats H\nB beats G\n`,
        'bracket'
      )
    ).toBe('Tournament bracket of 8 competitors in 7 matches, 2 decided.');
  });

  it('leaves a mind map’s collapsed subtree out of the ideas it counts', () => {
    const src =
      'mindmap Plan\n\nLaunch\n  Research collapsed\n    Users\n    Market\n  Build\n';
    expect(summarizeDiagram(src, 'mindmap')).toBe(
      'Mind map of 3 ideas around Plan, with 2 more folded away.'
    );
  });

  it('counts gantt tasks through nested groups and parallel blocks', () => {
    const src = [
      'gantt Build',
      '',
      'start 2024-01-01',
      '',
      '[Backend]',
      '  Design 3d',
      '  [API]',
      '    Endpoints 5d',
      'parallel',
      '  Docs 2d',
      '  Tests 2d',
      '',
    ].join('\n');
    expect(summarizeDiagram(src, 'gantt')).toBe(
      'Gantt chart of 4 tasks, Design, Endpoints, Docs and Tests, in 2 groups.'
    );
  });

  it('counts a RACI matrix’s tasks across every phase and names its roles', () => {
    const src =
      'raci Launch\n\n[Build]\n  Code\n    Dev: R\n    Lead: A\n\nShip\n  Lead: A\n';
    expect(summarizeDiagram(src, 'raci')).toBe(
      'RACI matrix of 2 tasks across 2 roles, Dev and Lead.'
    );
  });

  it('names the diagram a live-link card points at', () => {
    const src =
      'live-link Platform architecture\nurl https://online.diagrammo.app/d/dgm_7f2a91\n';
    expect(summarizeDiagram(src, 'live-link')).toBe(
      'Card linking to the shared diagram Platform architecture.'
    );
  });

  it('gives no summary for a chart type without a summarizer yet', () => {
    expect(summarizeDiagram('scatter S\n\nA 1 2\n', 'scatter')).toBeNull();
  });
});

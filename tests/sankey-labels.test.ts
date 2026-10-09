import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3';
import { measureText } from '../src/utils/text-measure';

// #1087: middle-column labels ran right and last-column labels ran left, into
// the same gap, and overprinted. Every case here asserts no two label boxes
// intersect and every label stays inside the canvas.

interface Box {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function labelBoxes(svg: string): { boxes: Box[]; width: number } {
  const width = Number(/<svg[^>]*\swidth="([\d.]+)"/.exec(svg)![1]);
  const boxes: Box[] = [];
  for (const m of svg.matchAll(/<text([^>]*)>([^<]*)/g)) {
    const attrs = m[1]!;
    if (!attrs.includes('font-size="13"')) continue;
    const x = Number(/\sx="([^"]*)"/.exec(attrs)![1]);
    const y = Number(/\sy="([^"]*)"/.exec(attrs)![1]);
    const end = attrs.includes('text-anchor="end"');
    const w = measureText(m[2]!, 13);
    boxes.push({
      text: m[2]!,
      x0: end ? x - w : x,
      x1: end ? x : x + w,
      y0: y - 10,
      y1: y + 3,
    });
  }
  return { boxes, width };
}

function expectNoCollisions(svg: string): Box[] {
  const { boxes, width } = labelBoxes(svg);
  expect(boxes.length).toBeGreaterThan(0);
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]!;
    expect(a.x0, a.text).toBeGreaterThanOrEqual(0);
    expect(a.x1, a.text).toBeLessThanOrEqual(width);
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j]!;
      const hit = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
      expect(hit, `"${a.text}" overlaps "${b.text}"`).toBe(false);
    }
  }
  return boxes;
}

const RUN_TO_MODEL = `sankey 948 — run to agent to model (thousand tokens)

2026-10-03 night A·7 (15.1M) -> general-purpose subagent (5.3M) 5334
general-purpose subagent (5.3M) -> Sonnet 5.5 (5.3M) 5334 blue
2026-10-03 night A·7 (15.1M) -> main agent (9.8M) 9775
main agent (9.8M) -> Opus 5.5 (9.8M) 9775 purple

Sonnet 5.5 (5.3M) blue
Opus 5.5 (9.8M) purple
`;

const STATUS_MOVES = `sankey Night Mon 5 Oct — every status move

Triage (2) -> Ready for agent (10) 2
Ready for agent (10) -> In progress (10) 10
In progress (10) -> Your turn (2) 2
In progress (10) -> Ready for agent again (1) 1
In progress (10) -> Done (1) 1
In progress (10) -> Awaiting release (8) 6
Ready for agent again (1) -> In progress again (1) 1
In progress again (1) -> Awaiting release (8) 1
`;

const LONG = `sankey Long

Source -> ${'A destination whose name runs on for sixty characters, yes'.padEnd(60, '!')} 3
`;

describe('sankey labels', () => {
  it('three columns: middle and last labels do not overprint', async () => {
    for (const theme of ['light', 'dark'] as const) {
      expectNoCollisions(await renderDataChartD3(RUN_TO_MODEL, theme));
    }
  });

  it('a small node level with a big last-column node does not collide', async () => {
    expectNoCollisions(await renderDataChartD3(STATUS_MOVES, 'light'));
  });

  it('a label too long for its room is truncated, with the full name kept', async () => {
    const svg = await renderDataChartD3(LONG, 'light');
    const boxes = expectNoCollisions(svg);
    const long = boxes.find((b) => b.text.startsWith('A destination'))!;
    expect(long.text.endsWith('…')).toBe(true);
    expect(svg).toContain(
      `<title>${'A destination whose name runs on for sixty characters, yes'.padEnd(60, '!')}</title>`
    );
  });

  it('labels the last column to the right of its nodes', async () => {
    const svg = await renderDataChartD3(RUN_TO_MODEL, 'light');
    expect(svg).not.toContain('text-anchor="end"');
  });
});

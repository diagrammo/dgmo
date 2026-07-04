import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSwimlane } from '../src/swimlane/parser';
import { layoutSwimlane } from '../src/swimlane/layout';

const FIX = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const layoutOf = (name: string) => layoutSwimlane(parseSwimlane(FIX(name)));

describe('swimlane layout — lane-band snap (AC6)', () => {
  it('snaps every node Y into its lane band', () => {
    const parsed = parseSwimlane(FIX('swimlane-publishing.dgmo'));
    const layout = layoutSwimlane(parsed);
    const laneById = new Map(layout.lanes.map((l) => [l.id, l]));
    for (const n of layout.nodes) {
      const band = laneById.get(n.lane)!;
      expect(n.y).toBeGreaterThanOrEqual(band.y);
      expect(n.y).toBeLessThanOrEqual(band.y + band.height);
    }
  });

  it('keeps lanes in declaration order along the cross axis', () => {
    const layout = layoutOf('swimlane-publishing.dgmo');
    const ys = layout.lanes.map((l) => l.y);
    const sorted = [...ys].sort((a, b) => a - b);
    expect(ys).toEqual(sorted);
  });
});

describe('swimlane layout — phase rank dominance (AC6)', () => {
  it('never places a later-phase node left of an earlier phase', () => {
    const parsed = parseSwimlane(FIX('swimlane-insurance.dgmo'));
    const layout = layoutSwimlane(parsed);
    const xById = new Map(layout.nodes.map((n) => [n.id, n.x]));
    // Settle (Issue Payment) must sit right of Submit (Submit Claim).
    expect(xById.get('Issue Payment')!).toBeGreaterThan(
      xById.get('Submit Claim')!
    );
    // Assess (Approve) right of Triage (Validate).
    expect(xById.get('Approve')!).toBeGreaterThan(xById.get('Validate')!);
  });
});

describe('swimlane layout — back-edge routing (AC7)', () => {
  it('marks a loop edge as a back-edge with a multi-point route', () => {
    const layout = layoutOf('swimlane-backedge.dgmo');
    const back = layout.edges.find(
      (e) => e.source === 'Check' && e.target === 'Process'
    )!;
    expect(back.back).toBe(true);
    expect(back.points.length).toBeGreaterThanOrEqual(4);
  });
});

describe('swimlane layout — back-edge box avoidance', () => {
  // Revise (Writer) and Schedule (Editor) used to share a column, so the
  // Revise→Review back-edge dropped straight through the Schedule box.
  // Corridor reservation shifts the blocking box (and its same-lane
  // successors) one column right, keeping the drop straight.
  it('shifts lower-lane blockers out of a back-edge corridor', () => {
    const layout = layoutOf('swimlane-publishing.dgmo');
    const xById = new Map(layout.nodes.map((n) => [n.id, n.x]));
    expect(xById.get('Schedule')!).toBeGreaterThan(xById.get('Revise')!);
    expect(xById.get('Publish')!).toBeGreaterThan(xById.get('Schedule')!);
    // The back-edge itself stays a plain 4-point loop — no jog needed.
    const back = layout.edges.find(
      (e) => e.source === 'Revise' && e.target === 'Review'
    )!;
    expect(back.back).toBe(true);
    expect(back.points.length).toBe(4);
  });

  it('never routes a back-edge segment through a node box', () => {
    for (const fixture of [
      'swimlane-publishing.dgmo',
      'swimlane-backedge.dgmo',
      'swimlane-insurance.dgmo',
      'swimlane-tb.dgmo',
    ]) {
      const layout = layoutOf(fixture);
      for (const e of layout.edges) {
        if (!e.back) continue;
        for (let k = 0; k < e.points.length - 1; k++) {
          const p0 = e.points[k]!;
          const p1 = e.points[k + 1]!;
          const segMinX = Math.min(p0.x, p1.x);
          const segMaxX = Math.max(p0.x, p1.x);
          const segMinY = Math.min(p0.y, p1.y);
          const segMaxY = Math.max(p0.y, p1.y);
          for (const n of layout.nodes) {
            if (n.id === e.source || n.id === e.target) continue;
            const overlap =
              segMaxX > n.x - n.width / 2 &&
              segMinX < n.x + n.width / 2 &&
              segMaxY > n.y - n.height / 2 &&
              segMinY < n.y + n.height / 2;
            expect(
              overlap,
              `${fixture}: back-edge ${e.source}→${e.target} segment ${k} pierces ${n.id}`
            ).toBe(false);
          }
        }
      }
    }
  });
});

describe('swimlane layout — TB transpose (AC9)', () => {
  it('swaps the dominant axis vs LR', () => {
    const lr = layoutSwimlane(parseSwimlane(FIX('swimlane-publishing.dgmo')));
    const tb = layoutSwimlane(parseSwimlane(FIX('swimlane-tb.dgmo')));
    // LR diagrams run wider than tall; TB runs taller than wide.
    expect(lr.width).toBeGreaterThan(lr.height);
    expect(tb.height).toBeGreaterThan(tb.width);
  });

  it('orders TB lanes along the X axis', () => {
    const tb = layoutSwimlane(parseSwimlane(FIX('swimlane-tb.dgmo')));
    const xs = tb.lanes.map((l) => l.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });
});

describe('swimlane layout — bbox', () => {
  it('produces a positive, finite canvas', () => {
    const layout = layoutOf('swimlane-insurance.dgmo');
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    expect(Number.isFinite(layout.width)).toBe(true);
    expect(Number.isFinite(layout.height)).toBe(true);
  });
});

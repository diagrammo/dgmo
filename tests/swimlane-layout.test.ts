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

describe('swimlane layout — boundary events sit on the bottom edge (#1874)', () => {
  const claims = readFileSync(
    join(__dirname, '..', 'gallery', 'fixtures', 'swimlane-bpmn.dgmo'),
    'utf8'
  );
  const tbSource = claims.replace(/^(swimlane[^\n]*)\n/, '$1\ndirection-tb\n');

  it.each([
    ['LR', claims],
    ['TB', tbSource],
  ])(
    '%s: each boundary event centres on its task bottom, inside its width',
    (_dir, src) => {
      const layout = layoutSwimlane(parseSwimlane(src));
      const byId = new Map(layout.nodes.map((n) => [n.id, n]));
      const boundaries = layout.nodes.filter((n) => n.boundaryOf !== undefined);
      expect(boundaries.length).toBeGreaterThan(0);
      for (const b of boundaries) {
        const host = byId.get(b.boundaryOf!)!;
        expect(b.y).toBeCloseTo(host.y + host.height / 2, 5);
        expect(Math.abs(b.x - host.x)).toBeLessThan(host.width / 2);
      }
    }
  );

  it('TB: the exception path leaves the boundary event downward', () => {
    const layout = layoutSwimlane(parseSwimlane(tbSource));
    const b = layout.nodes.find((n) => n.boundaryOf !== undefined)!;
    const edge = layout.edges.find((e) => e.source === b.id)!;
    const [p0, p1] = edge.points;
    expect(p0!.y).toBeCloseTo(b.y + b.height / 2, 5);
    expect(p1!.x).toBeCloseTo(p0!.x, 5);
    expect(p1!.y).toBeGreaterThan(p0!.y);
  });
});

describe('swimlane layout — lines keep off each other (#2109)', () => {
  type P = { x: number; y: number };
  /** Length over which two orthogonal polylines run along one track. */
  const sharedRun = (a: readonly P[], b: readonly P[]): number => {
    let total = 0;
    for (let i = 0; i + 1 < a.length; i++)
      for (let j = 0; j + 1 < b.length; j++) {
        const [p, q, r, s] = [a[i]!, a[i + 1]!, b[j]!, b[j + 1]!];
        const vert = p.x === q.x && r.x === s.x && p.y !== q.y && r.y !== s.y;
        const horiz = p.y === q.y && r.y === s.y && p.x !== q.x && r.x !== s.x;
        if (vert && Math.abs(p.x - r.x) < 4) {
          const lo = Math.max(Math.min(p.y, q.y), Math.min(r.y, s.y));
          const hi = Math.min(Math.max(p.y, q.y), Math.max(r.y, s.y));
          total += Math.max(0, hi - lo);
        } else if (horiz && Math.abs(p.y - r.y) < 4) {
          const lo = Math.max(Math.min(p.x, q.x), Math.min(r.x, s.x));
          const hi = Math.min(Math.max(p.x, q.x), Math.max(r.x, s.x));
          total += Math.max(0, hi - lo);
        }
      }
    return total;
  };
  const allLines = (name: string) => {
    const l = layoutOf(name);
    return [
      ...l.edges.map((e) => ({
        id: `${e.source}->${e.target}`,
        pts: e.points,
      })),
      ...l.messages.map((m) => ({
        id: `${m.source}~>${m.target}`,
        pts: m.points,
      })),
    ];
  };

  for (const name of ['swimlane-pool-ring.dgmo', 'swimlane-pool-tb.dgmo']) {
    it(`no two lines share a track in ${name}`, () => {
      const lines = allLines(name);
      const stacked: string[] = [];
      for (let i = 0; i < lines.length; i++)
        for (let j = i + 1; j < lines.length; j++)
          if (sharedRun(lines[i]!.pts, lines[j]!.pts) > 0)
            stacked.push(`${lines[i]!.id} | ${lines[j]!.id}`);
      expect(stacked).toEqual([]);
    });
  }

  it('a back-edge inside one lane loops inside that lane', () => {
    const l = layoutOf('swimlane-pool-ring.dgmo');
    const gov = l.lanes.find((b) => b.id === 'Governor')!;
    const back = l.edges.find((e) => e.back)!;
    for (const p of back.points) {
      expect(p.y).toBeGreaterThanOrEqual(gov.y);
      expect(p.y).toBeLessThanOrEqual(gov.y + gov.height);
    }
  });

  it('marks pool lanes with their place in the pool', () => {
    const l = layoutOf('swimlane-pool-ring.dgmo');
    const by = new Map(l.lanes.map((b) => [b.id, b.inPool]));
    expect(by.get('Governor')).toEqual({ first: true, last: false });
    expect(by.get('Spy')).toEqual({ first: false, last: true });
    expect(by.get('Clerk')).toEqual({ first: true, last: true });
  });
});

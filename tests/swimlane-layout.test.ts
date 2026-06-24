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

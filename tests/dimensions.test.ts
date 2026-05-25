import { describe, it, expect } from 'vitest';
import { getMinDimensions } from '../src/dimensions';

describe('getMinDimensions', () => {
  it('returns content-dependent dimensions for sequence', () => {
    const result = getMinDimensions(
      'sequence Foo\nA is an actor\nB is a database\nA -hello-> B'
    );
    expect(result.width).toBeGreaterThan(300);
    expect(result.height).toBeGreaterThanOrEqual(200);
  });

  it('more participants means wider minimum', () => {
    const small = getMinDimensions('sequence\nAlice\nBob\nAlice -hello-> Bob');
    const large = getMinDimensions(
      'sequence\nAlice\nBob\nCarol\nDave\nEve\nFrank\nAlice -hello-> Bob\nBob -hey-> Carol\nCarol -yo-> Dave\nDave -sup-> Eve\nEve -hi-> Frank'
    );
    expect(large.width).toBeGreaterThan(small.width);
  });

  it('returns content-dependent dimensions for raci', () => {
    const result = getMinDimensions(
      'raci Test\nroles\n  Dev\n  QA\n  PM\n  Ops\n  Lead\nWrite code\n  Dev: R\n  QA: I'
    );
    expect(result.width).toBeGreaterThanOrEqual(300);
    expect(result.height).toBeGreaterThanOrEqual(200);
  });

  it('returns content-dependent dimensions for mindmap', () => {
    const result = getMinDimensions(
      'mindmap Root\n  Child 1\n    Grandchild A\n    Grandchild B\n  Child 2\n    Grandchild C'
    );
    expect(result.width).toBeGreaterThanOrEqual(300);
    expect(result.height).toBeGreaterThanOrEqual(200);
  });

  it('returns fixed dimensions for tech-radar', () => {
    const result = getMinDimensions(
      'tech-radar Radar\nrings\n  Adopt\n  Trial\nQ1 quadrant: top-right\n  Foo ring: Adopt'
    );
    expect(result.width).toBe(360);
    expect(result.height).toBe(400);
  });

  it('returns content-dependent dimensions for heatmap', () => {
    const result = getMinDimensions(
      'heatmap Test\ncolumns\n  A\n  B\n  C\n  D\n  E\n  F\nRow1 1 2 3 4 5 6\nRow2 6 5 4 3 2 1'
    );
    expect(result.width).toBeGreaterThanOrEqual(240);
    expect(result.height).toBeGreaterThanOrEqual(200);
  });

  it('returns content-dependent dimensions for arc', () => {
    const result = getMinDimensions(
      'arc Test\norder group\n[Group A]\n  A -> B 3\n  B -> C 2\n[Group B]\n  C -> D 1'
    );
    expect(result.width).toBe(300);
    expect(result.height).toBeGreaterThanOrEqual(200);
  });

  it('returns default fallback for unknown chart type', () => {
    const result = getMinDimensions('this is not a valid chart');
    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
  });

  it('dimensions are reasonable for real viewports', () => {
    const result = getMinDimensions(
      'sequence Test\nA\nB\nC\nD\nE\nA -msg-> B\nB -msg-> C\nC -msg-> D'
    );
    expect(result.width).toBeLessThanOrEqual(1200);
    expect(result.height).toBeLessThanOrEqual(1200);
  });
});

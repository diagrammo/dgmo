import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseVersionControl } from '../src/version-control/parser';
import { renderVersionControl } from '../src/version-control/renderer';
import { getPalette } from '../src/palettes';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  for (const k of ['document', 'window', 'HTMLElement', 'SVGElement'] as const)
    Object.defineProperty(globalThis, k, {
      value: k === 'document' ? dom.window.document : (dom.window as never)[k],
      configurable: true,
    });
});

const SRC = `version-control Flow

main
  Initial commit
  Add README

develop from main
  Set up CI
  Add test suite

main
  merge develop tag: v1.0.0
  Hotfix typo`;

describe('version-control message labels', () => {
  it('sit near their dots: most leaders stay short', () => {
    const parsed = parseVersionControl(SRC);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 1200 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    renderVersionControl(
      container as unknown as HTMLDivElement,
      parsed,
      getPalette('nord').light,
      false
    );
    const leaders = [...container.querySelectorAll('line')].filter(
      (l) => l.getAttribute('stroke-width') === '1.5'
    );
    expect(leaders.length).toBeGreaterThan(0);
    const lengths = leaders.map((l) =>
      Math.hypot(
        +l.getAttribute('x2')! - +l.getAttribute('x1')!,
        +l.getAttribute('y2')! - +l.getAttribute('y1')!
      )
    );
    // A shelf under its own lane is ~8 units below the dot; the old band
    // layout put every leader 60+ units out.
    const near = lengths.filter((n) => n <= 60).length;
    expect(near).toBeGreaterThanOrEqual(Math.ceil(lengths.length / 2));
  });
});

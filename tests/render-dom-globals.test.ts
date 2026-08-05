// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression: dist/index and dist/block are each self-contained bundles, so a
// host importing both gets two copies of the render module. The jsdom-globals
// ref-count used to live in module state — copy A's releaseDom() deleted
// `globalThis.document` while copy B was mid-render ("document is not
// defined"). The count now lives on a `Symbol.for` slot on globalThis, shared
// by every copy. Two fresh module registries below simulate the two bundles.

const SRC = `pie
Rum: 3
Grog: 2`;

async function twoModuleCopies() {
  vi.resetModules();
  const a = await import('../src/render');
  vi.resetModules();
  const b = await import('../src/render');
  expect(a).not.toBe(b);
  return { a, b };
}

/**
 * `twoModuleCopies` resets the module registry twice and re-imports the whole
 * render graph each time, and the interleaved case then drives ten renders
 * through it. That is real work, not a wait — vitest's 5s default is a deadline
 * it can miss whenever the machine is busy, and when it does the log says
 * "timed out" on a ref-count test, which reads as the ref-count having broken.
 *
 * A ceiling high enough that crossing it means something actually hung.
 */
const SLOW_MS = 60_000;

describe('render() cross-bundle DOM globals ref-count', () => {
  beforeEach(() => {
    expect(typeof document).toBe('undefined');
  });

  it(
    'two module copies share one ref-count (interleaved renders survive)',
    async () => {
      const { a, b } = await twoModuleCopies();
      for (let i = 0; i < 5; i++) {
        const [ra, rb] = await Promise.all([a.render(SRC), b.render(SRC)]);
        expect(ra.svg).toContain('<svg');
        expect(rb.svg).toContain('<svg');
      }
      // Last release wins only once every in-flight render is done.
      expect(typeof (globalThis as { document?: unknown }).document).toBe(
        'undefined'
      );
    },
    SLOW_MS
  );

  it('sequential renders from different copies each clean up', async () => {
    const { a, b } = await twoModuleCopies();
    const ra = await a.render(SRC);
    expect(ra.svg).toContain('<svg');
    expect(typeof (globalThis as { document?: unknown }).document).toBe(
      'undefined'
    );
    const rb = await b.render(SRC);
    expect(rb.svg).toContain('<svg');
    expect(typeof (globalThis as { document?: unknown }).document).toBe(
      'undefined'
    );
  });

  it('keeps the shared state object on the well-known symbol', async () => {
    const { a } = await twoModuleCopies();
    await a.render(SRC);
    const state = (
      globalThis as unknown as Record<symbol, { refCount: number }>
    )[Symbol.for('diagrammo.dgmo.dom-globals')];
    expect(state).toBeDefined();
    expect(state.refCount).toBe(0);
  });
});

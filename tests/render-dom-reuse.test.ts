// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as JsdomModule from 'jsdom';

// Building a jsdom costs ~10 ms — most of a small chart's sequential render —
// so render() keeps the window between renders and reuses it (#1014). The
// globals still come off `globalThis` after every render: hosts that run
// their own SSR in the same process need a clean Node environment.

const counts = vi.hoisted(() => ({ jsdom: 0 }));

vi.mock('jsdom', async (importOriginal) => {
  const actual = await importOriginal<typeof JsdomModule>();
  class CountingJSDOM extends actual.JSDOM {
    constructor(...args: ConstructorParameters<typeof actual.JSDOM>) {
      super(...args);
      counts.jsdom++;
    }
  }
  return { ...actual, JSDOM: CountingJSDOM };
});

const { render } = await import('../src/render');

const STATE_KEY = Symbol.for('diagrammo.dgmo.dom-globals');
const PIE = `pie
Rum: 3
Grog: 2`;
const C4 = `c4 Shop
Customer is a person
  -Buys from-> Shop
Shop is a system`;

describe('render() reuses one jsdom across sequential renders', () => {
  beforeEach(() => {
    // Start from no retained window, whatever an earlier file left behind.
    delete (globalThis as Record<symbol, unknown>)[STATE_KEY];
    counts.jsdom = 0;
    expect(typeof document).toBe('undefined');
  });

  it('constructs jsdom once for two sequential renders, and leaks no globals', async () => {
    const first = await render(PIE);
    expect(first.svg).toContain('<svg');
    expect(typeof (globalThis as { document?: unknown }).document).toBe(
      'undefined'
    );
    const second = await render(PIE);
    expect(second.svg).toContain('<svg');
    expect(typeof (globalThis as { document?: unknown }).document).toBe(
      'undefined'
    );
    expect(counts.jsdom).toBe(1);
  });

  it('gives a reused document the output a fresh one gives', async () => {
    const fresh = await render(C4);
    expect(fresh.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const reused = await render(C4);
    expect(counts.jsdom).toBe(1);
    expect(reused.svg).toBe(fresh.svg);
  });
});

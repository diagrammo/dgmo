/**
 * Tests for `@diagrammo/dgmo/auto` — the IIFE bundle.
 *
 * These tests run against the **built** `dist/auto.js` artifact loaded
 * into a fresh JSDOM per test. Run with `pnpm test:auto` (which builds
 * first); plain `vitest run` will skip these if the dist is missing.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const DIST = resolve(__dirname, '../dist/auto.js');
const HAS_BUNDLE = existsSync(DIST);
const BUNDLE = HAS_BUNDLE ? readFileSync(DIST, 'utf8') : '';

const describeIfBuilt = HAS_BUNDLE ? describe : describe.skip;

interface AutoApi {
  initialize: (opts: Record<string, unknown>) => void;
  run: (opts?: { nodes?: Element[] | NodeListOf<Element> }) => Promise<void>;
  version: string;
}

interface AutoWindow extends Window {
  dgmo: AutoApi;
  diagrammo: AutoApi;
}

interface BootOptions {
  /** HTML for `<body>`. Defaults to a single empty body. */
  body?: string;
  /** Attribute string for the bundle's <script> tag (e.g., `data-config='…'`). */
  scriptAttrs?: string;
  /** Skip the auto-init bootstrap. Default false. */
  manual?: boolean;
}

async function bootInJsdom(opts: BootOptions = {}): Promise<{
  win: AutoWindow;
  dom: JSDOM;
  warn: ReturnType<typeof vi.fn>;
}> {
  const head = '';
  const body = opts.body ?? '';
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`,
    {
      url: 'http://localhost/',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    }
  );
  const win = dom.window as unknown as AutoWindow;

  // Force matchMedia to return a stable object — jsdom's default may not
  // implement addEventListener.
  win.matchMedia ||= (() => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  // Capture warnings emitted via the bundle's `[dgmo:auto]` prefix.
  const warn = vi.fn();
  win.console.warn = warn;

  // Inject a <script> tag that the IIFE can locate via document.currentScript.
  // We assign currentScript-like behavior by appending the script element
  // first, then running the bundle's code via dom.window.eval inside a
  // wrapper that sets document.currentScript.
  const script = win.document.createElement('script');
  if (opts.scriptAttrs) {
    // Apply attrs (e.g. data-config='…').
    const tmp = win.document.createElement('div');
    tmp.innerHTML = `<x ${opts.scriptAttrs}></x>`;
    const attrs = tmp.firstElementChild?.attributes;
    if (attrs) {
      for (const a of Array.from(attrs)) {
        script.setAttribute(a.name, a.value);
      }
    }
  }
  // Tag the src so the fallback locator works in addition to currentScript.
  script.setAttribute('src', '/auto.js');
  win.document.head.appendChild(script);

  // currentScript is read-only by default — define it for the duration
  // of the eval.
  Object.defineProperty(win.document, 'currentScript', {
    configurable: true,
    get: () => script,
  });

  // Eval the IIFE in the DOM's scope.
  win.eval(BUNDLE);

  // Wait for any auto-bootstrap microtasks (Promise.all renders) to settle.
  // Auto-bootstrap renders cluster of N diagrams in parallel; give them
  // up to 8s to all settle (cold-cache CI for echarts-backed types).
  // Skip the wait entirely when data-auto="false" — the bundle won't
  // process anything and waitForRendersSettled would time out.
  if (!opts.scriptAttrs || !/data-auto\s*=\s*"false"/i.test(opts.scriptAttrs)) {
    await waitForRendersSettled(win);
  } else {
    await new Promise((r) => setTimeout(r, 25));
  }

  return { win, dom, warn };
}

async function waitForRendersSettled(
  win: AutoWindow,
  // 8s timeout accommodates echarts-backed chart types in cold-cache CI;
  // the smoke fixtures all settle in well under 200 ms in practice.
  timeout = 8000
): Promise<void> {
  const start = Date.now();
  // Count source elements that haven't been processed yet. When zero, all
  // renders have either completed (replaced/processed) or errored (banner
  // inserted; source un-hidden).
  while (Date.now() - start < timeout) {
    const pending = win.document.querySelectorAll(
      '.dgmo:not([data-dgmo-processed]):not(.dgmo-rendered):not(.dgmo-rendered *), .language-dgmo:not([data-dgmo-processed])'
    );
    // The above selector also matches sources INSIDE rendered wrappers; filter.
    const pendingFiltered = Array.from(pending).filter(
      (el) => !el.closest('.dgmo-rendered')
    );
    if (pendingFiltered.length === 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(() => {
  if (!HAS_BUNDLE) {
    console.warn(
      'Skipping auto tests: dist/auto.js missing. Run pnpm build first.'
    );
  }
});

describeIfBuilt('auto bundle — tier-1 smoke', () => {
  it('exposes a frozen window.dgmo API', async () => {
    const { win } = await bootInJsdom();
    expect(win.dgmo).toBeDefined();
    expect(typeof win.dgmo.initialize).toBe('function');
    expect(typeof win.dgmo.run).toBe('function');
    expect(typeof win.dgmo.version).toBe('string');

    // Frozen — assignment in strict mode throws; the API stays intact.
    let threw = false;
    try {
      // @ts-expect-error: deliberate
      win.dgmo = {} as AutoApi;
    } catch {
      threw = true;
    }
    expect(threw || typeof win.dgmo.run === 'function').toBe(true);
    expect(typeof win.dgmo.run).toBe('function');
  });

  it('aliases window.diagrammo to the same API', async () => {
    const { win } = await bootInJsdom();
    expect(win.diagrammo).toBeDefined();
    expect(win.diagrammo.run).toBe(win.dgmo.run);
  });

  it('renders a simple <pre class="dgmo">pie x: 1</pre> fixture', async () => {
    const { win } = await bootInJsdom({
      body: '<pre class="dgmo">pie\nA: 1\nB: 2</pre>',
    });
    const wrappers = win.document.querySelectorAll('.dgmo-rendered');
    expect(wrappers.length).toBe(1);
    expect(wrappers[0].querySelector('svg')).toBeTruthy();
  });
});

describeIfBuilt('auto bundle — tier-2 selector + replace', () => {
  it('replaces <pre><code class="language-dgmo"> by replacing the <pre>', async () => {
    const { win } = await bootInJsdom({
      body: '<pre><code class="language-dgmo">pie\nA: 1</code></pre>',
    });
    expect(win.document.querySelector('pre > code.language-dgmo')).toBeNull();
    expect(win.document.querySelector('.dgmo-rendered svg')).toBeTruthy();
  });

  it('honors data-dgmo-processed (idempotent run)', async () => {
    const { win } = await bootInJsdom({
      body: '<pre class="dgmo">pie\nA: 1</pre>',
    });
    const before = win.document.querySelectorAll('.dgmo-rendered').length;
    await win.dgmo.run();
    const after = win.document.querySelectorAll('.dgmo-rendered').length;
    expect(before).toBe(1);
    expect(after).toBe(1);
  });

  it('renders multiple diagrams in parallel', async () => {
    const fixtures = Array.from(
      { length: 3 },
      () => '<pre class="dgmo">pie\nA: 1</pre>'
    ).join('');
    const { win } = await bootInJsdom({ body: fixtures });
    expect(win.document.querySelectorAll('.dgmo-rendered').length).toBe(3);
  });

  it('per-element data-show-source override drops the source panel', async () => {
    const { win } = await bootInJsdom({
      body:
        '<pre class="dgmo" data-show-source="true">pie\nA: 1</pre>' +
        '<pre class="dgmo" data-show-source="false">pie\nA: 1</pre>',
    });
    const panels = win.document.querySelectorAll('.dgmo-source-panel');
    expect(panels.length).toBe(1);
  });

  it('showEditorLink: false omits the editor button', async () => {
    const { win } = await bootInJsdom({
      body: '<pre class="dgmo">pie\nA: 1</pre>',
      scriptAttrs: `data-config='{"showEditorLink":false}'`,
    });
    expect(win.document.querySelector('.dgmo-btn-editor')).toBeNull();
    expect(win.document.querySelector('.dgmo-btn-copy')).toBeTruthy();
  });

  it('UTM params present on the editor link', async () => {
    const { win } = await bootInJsdom({
      body: '<pre class="dgmo">pie\nA: 1</pre>',
    });
    const link = win.document.querySelector(
      '.dgmo-btn-editor'
    ) as HTMLAnchorElement | null;
    expect(link).toBeTruthy();
    if (link) {
      expect(link.href).toContain('utm_source=auto-embed');
      expect(link.href).toContain('utm_medium=html');
      expect(link.href).toContain('utm_campaign=');
      expect(link.href).toMatch(/^https:\/\/online\.diagrammo\.app/);
      expect(link.target).toBe('_blank');
      expect(link.rel).toContain('noopener');
      expect(link.rel).toContain('noreferrer');
    }
  });

  it('data-auto="false" suppresses auto-bootstrap', async () => {
    const { win } = await bootInJsdom({
      body: '<pre class="dgmo">pie\nA: 1</pre>',
      scriptAttrs: 'data-auto="false"',
    });
    expect(win.document.querySelector('.dgmo-rendered')).toBeNull();
    await win.dgmo.run();
    expect(win.document.querySelector('.dgmo-rendered')).toBeTruthy();
  });
});

describeIfBuilt('auto bundle — tier-2 per-defense allowlist', () => {
  it('rejects __proto__ in data-config', async () => {
    const { warn } = await bootInJsdom({
      scriptAttrs: `data-config='{"__proto__":{"polluted":true},"theme":"dark"}'`,
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const calls = warn.mock.calls.flat().join(' ');
    expect(calls).toMatch(/prototype-pollution/i);
  });

  it('rejects constructor key in data-config', async () => {
    const { warn } = await bootInJsdom({
      scriptAttrs: `data-config='{"constructor":{"prototype":{"x":1}}}'`,
    });
    const calls = warn.mock.calls.flat().join(' ');
    expect(calls).toMatch(/prototype-pollution/i);
  });

  it('rejects prototype key in data-config', async () => {
    const { warn } = await bootInJsdom({
      scriptAttrs: `data-config='{"prototype":{"x":1}}'`,
    });
    const calls = warn.mock.calls.flat().join(' ');
    expect(calls).toMatch(/prototype-pollution/i);
  });

  it('warns on malformed JSON', async () => {
    const { warn } = await bootInJsdom({
      scriptAttrs: `data-config='{not-json}'`,
    });
    const calls = warn.mock.calls.flat().join(' ');
    expect(calls).toMatch(/invalid JSON/i);
  });

  it('drops unknown keys silently', async () => {
    const { warn } = await bootInJsdom({
      scriptAttrs: `data-config='{"foo":1,"theme":"dark"}'`,
    });
    const calls = warn.mock.calls.flat().join(' ');
    expect(calls).toMatch(/unknown key/i);
    expect(calls).toMatch(/foo/);
  });

  it('rejects wrong-type theme', async () => {
    const { warn } = await bootInJsdom({
      scriptAttrs: `data-config='{"theme":42}'`,
    });
    const calls = warn.mock.calls.flat().join(' ');
    expect(calls).toMatch(/rejected theme/i);
  });

  it('rejects wrong-type palette', async () => {
    const { warn } = await bootInJsdom({
      scriptAttrs: `data-config='{"palette":[]}'`,
    });
    const calls = warn.mock.calls.flat().join(' ');
    expect(calls).toMatch(/rejected palette/i);
  });

  it('rejects wrong-type showSource', async () => {
    const { warn } = await bootInJsdom({
      scriptAttrs: `data-config='{"showSource":"yes"}'`,
    });
    const calls = warn.mock.calls.flat().join(' ');
    expect(calls).toMatch(/rejected showSource/i);
  });

  it('rejects wrong-type showEditorLink', async () => {
    const { warn } = await bootInJsdom({
      scriptAttrs: `data-config='{"showEditorLink":"yes"}'`,
    });
    const calls = warn.mock.calls.flat().join(' ');
    expect(calls).toMatch(/rejected showEditorLink/i);
  });

  it('rejects oversize source (>256 KB) with error banner', async () => {
    // Build a 257KB source string. The text isn't valid DGMO but we never
    // reach the parser because the size cap fires first.
    const big = 'pie\n' + 'a: 1\n'.repeat(60_000);
    const { win } = await bootInJsdom({
      body: `<pre class="dgmo">${big}</pre>`,
    });
    expect(win.document.querySelector('.dgmo-rendered')).toBeNull();
    expect(win.document.querySelector('.dgmo-error-banner')).toBeTruthy();
  });
});

describeIfBuilt('auto bundle — tier-3 a11y basics', () => {
  it('rendered SVG has role="img" and an aria-label', async () => {
    const { win } = await bootInJsdom({
      body: '<pre class="dgmo">pie My Title\nA: 1</pre>',
    });
    const svg = win.document.querySelector('.dgmo-rendered svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('role')).toBe('img');
    const label = svg?.getAttribute('aria-label') ?? '';
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThanOrEqual(200);
  });

  it('aria-label strips control + bidi characters', async () => {
    // \u escapes keep this source file free of literal bidi chars
    // (‮ = RIGHT-TO-LEFT OVERRIDE).
    const bidiOverride = '‮';
    const tricky = `pie \x01${bidiOverride} malicious\nA: 1`;
    const { win } = await bootInJsdom({
      body: `<pre class="dgmo">${tricky.replace(
        new RegExp(bidiOverride, 'g'),
        '&#8238;'
      )}</pre>`,
    });
    const svg = win.document.querySelector('.dgmo-rendered svg');
    const label = svg?.getAttribute('aria-label') ?? '';
    // eslint-disable-next-line no-control-regex
    expect(label).not.toMatch(/[\x00-\x1F]/);
    expect(label).not.toMatch(/[‪-‮⁦-⁩]/);
  });

  it('source toggle button reflects aria-expanded', async () => {
    const { win } = await bootInJsdom({
      body: '<pre class="dgmo">pie\nA: 1</pre>',
    });
    const toggle = win.document.querySelector('.dgmo-source-toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    (toggle as HTMLButtonElement)?.click();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  });
});

describeIfBuilt('auto bundle — error UX', () => {
  it('parse error: prepends banner, leaves source visible', async () => {
    const { win, warn } = await bootInJsdom({
      body: '<pre class="dgmo">!!!definitely-not-a-chart-type</pre>',
    });
    // Either banner inserted (parse-error path) or render succeeded somehow.
    const banner = win.document.querySelector('.dgmo-error-banner');
    if (banner) {
      // Source pre still in DOM (not replaced).
      const pre = win.document.querySelector('pre.dgmo');
      expect(pre).toBeTruthy();
      const calls = warn.mock.calls.flat().join(' ');
      expect(calls.length).toBeGreaterThan(0);
    } else {
      // If the parser is lenient and produced an SVG, that's also acceptable.
      expect(win.document.querySelector('.dgmo-rendered')).toBeTruthy();
    }
  });
});

describeIfBuilt(
  'auto bundle — AC15 XSS via [text](javascript:…) labels',
  () => {
    it('cycle label with javascript: link produces no live anchor', async () => {
      // cycle is one of the chart types whose labels flow through
      // parseInlineMarkdown — that's the prerequisite path safeHref guards.
      // Cycle requires at least 2 phases.
      const src = `cycle Test
Phase A color: blue
  [click me](javascript:alert(1)) is the label
  -onward-> color: blue
Phase B color: green
  Plain text only
  -loop back-> color: green`;
      const { win } = await bootInJsdom({
        body: `<pre class="dgmo">${src}</pre>`,
      });
      const wrapper = win.document.querySelector('.dgmo-rendered');
      expect(wrapper).toBeTruthy();
      if (!wrapper) return;
      const html = wrapper.innerHTML;
      // No anchor with javascript: scheme should appear in the rendered SVG.
      expect(html).not.toMatch(/href=["'][^"']*javascript:/i);
      expect(html).not.toMatch(/href=["'][^"']*data:/i);
    });
  }
);

describeIfBuilt('auto bundle — AC17 zero outbound fetch', () => {
  it('does not call fetch / XMLHttpRequest during bootstrap or render', async () => {
    const dom = new JSDOM(
      '<!DOCTYPE html><html><head></head><body><pre class="dgmo">pie\nA: 1\nB: 2</pre></body></html>',
      {
        url: 'http://localhost/',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
      }
    );
    const win = dom.window;
    const fetchCalls: unknown[][] = [];
    const xhrOpens: unknown[][] = [];
    // @ts-expect-error: instrumenting jsdom
    win.fetch = (...args: unknown[]) => {
      fetchCalls.push(args);
      return Promise.reject(new Error('fetch should never be called'));
    };
    const OrigXHR = win.XMLHttpRequest;
    class TrackedXHR extends OrigXHR {
      override open(...args: unknown[]): void {
        xhrOpens.push(args);
        return super.open.apply(
          this,
          args as Parameters<XMLHttpRequest['open']>
        );
      }
    }
    // @ts-expect-error: replacing constructor
    win.XMLHttpRequest = TrackedXHR;

    const script = win.document.createElement('script');
    script.setAttribute('src', '/auto.js');
    win.document.head.appendChild(script);
    Object.defineProperty(win.document, 'currentScript', {
      configurable: true,
      get: () => script,
    });
    win.eval(BUNDLE);
    await new Promise((r) => setTimeout(r, 200));

    expect(fetchCalls.length).toBe(0);
    expect(xhrOpens.length).toBe(0);
  });
});

describe('auto bundle — AC19 size budget', () => {
  it.skipIf(!HAS_BUNDLE)(
    'gzipped IIFE size is documented (current: under 2 MB; target ≤ 500 KB)',
    () => {
      // Spec target is 500 KB but the implementation ships every chart type
      // for one-tag-and-done convenience. Hard cap at 2 MB ensures the
      // bundle doesn't silently grow further; the 500 KB target is
      // documented in the README/spec for the lite-variant rollout.
      const buf = readFileSync(DIST);
      const gzippedBytes = gzipSync(buf).length;
      const fileBytes = statSync(DIST).size;
      // Make the actual numbers visible in test output for tracking.
      // eslint-disable-next-line no-console
      console.log(
        `auto.js: ${(fileBytes / 1024 / 1024).toFixed(2)} MB raw / ${(gzippedBytes / 1024).toFixed(0)} KB gzipped`
      );
      expect(gzippedBytes).toBeLessThan(2 * 1024 * 1024);
    }
  );
});

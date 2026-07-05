/**
 * Tests for `@diagrammo/dgmo/element` — the `<dgmo-diagram>` custom element.
 *
 * These run against the SOURCE module in the vitest jsdom environment (which
 * provides `customElements`, `HTMLElement`, and a live `document`). Importing
 * the module self-registers the element via its `defineDgmoDiagram()` side
 * effect. `render()` runs against the ambient jsdom document (no server-side
 * jsdom load), so at least one case exercises a real end-to-end render.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DgmoDiagram, defineDgmoDiagram } from '../src/element/index';

/** Poll until `predicate()` is truthy or the timeout elapses. */
async function waitFor(
  predicate: () => boolean,
  { timeout = 3000, interval = 5 } = {}
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - start > timeout) {
      throw new Error('waitFor: timed out');
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

function makeElement(
  source: string,
  attrs: Record<string, string> = {}
): HTMLElement {
  const el = document.createElement('dgmo-diagram');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.textContent = source;
  return el;
}

describe('<dgmo-diagram> custom element', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is registered in the custom-element registry', () => {
    // Import side-effect registers it; the explicit call proves idempotency.
    defineDgmoDiagram();
    expect(customElements.get('dgmo-diagram')).toBe(DgmoDiagram);
  });

  it('renders a simple flowchart end-to-end (real render)', async () => {
    const el = makeElement('flowchart\n[Start] -> [Done]');
    document.body.appendChild(el);

    await waitFor(() => el.querySelector('svg') !== null);

    const svg = el.querySelector('svg')!;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('role')).toBe('img');
    // Container carries the rendered marker; the standard block wrapper
    // (figure.dgmo) carries the legacy + theme hook classes.
    const container = el.firstElementChild as HTMLElement;
    expect(container.className).toContain('dgmo--rendered');
    const wrapper = el.querySelector('figure.dgmo') as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.className).toContain('dgmo-rendered');
    expect(wrapper.className).toMatch(/dgmo-theme-(light|dark|transparent)/);
    // Diagram mounts in the single-render slot.
    expect(wrapper.querySelector('.dgmo-svg > svg')).toBe(svg);
  });

  it('de-indents source read from a nested <script type="text/dgmo">', async () => {
    const el = document.createElement('dgmo-diagram');
    const script = document.createElement('script');
    script.setAttribute('type', 'text/dgmo');
    // Deliberately indented like real HTML authoring.
    script.textContent = '\n      flowchart\n      [A] -> [B]\n    ';
    el.appendChild(script);
    document.body.appendChild(el);

    await waitFor(() => el.querySelector('svg') !== null);
    expect(el.querySelector('svg')).toBeTruthy();
  });

  it('shows the standard error card for empty source', async () => {
    const el = makeElement('   ');
    document.body.appendChild(el);

    await waitFor(() => el.querySelector('.dgmo--error') !== null);
    const card = el.querySelector('.dgmo--error')!;
    expect(card.getAttribute('role')).toBe('alert');
    expect(card.textContent).toContain('dgmo render error');
    expect(card.textContent).toContain('No DGMO source');
  });

  it('renders the standard source disclosure when mode="showcase"', async () => {
    const el = makeElement('flowchart\n[A] -> [B]', { mode: 'showcase' });
    document.body.appendChild(el);

    await waitFor(() => el.querySelector('svg') !== null);
    expect(el.querySelector('figure.dgmo.dgmo--showcase')).toBeTruthy();
    const details = el.querySelector(
      'details.dgmo-source-wrap'
    ) as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);
    expect(details.querySelector('summary.dgmo-toolbar')).toBeTruthy();
    // Copy payload + UTM-tagged editor link.
    const copy = details.querySelector('button.dgmo-copy')!;
    expect(copy.getAttribute('data-dgmo-source')).toContain('flowchart');
    const open = details.querySelector('a.dgmo-open') as HTMLAnchorElement;
    expect(open).toBeTruthy();
    expect(open.href).toContain('utm_source=element-embed');
    // Highlighted source panel uses the canonical pre/span vocabulary.
    expect(
      details.querySelector('.dgmo-source-inner .dgmo-pre .dgmo-code')
    ).toBeTruthy();
  });

  it('does NOT render a source panel by default (mode omitted)', async () => {
    const el = makeElement('flowchart\n[A] -> [B]');
    document.body.appendChild(el);

    await waitFor(() => el.querySelector('svg') !== null);
    expect(el.querySelector('figure.dgmo.dgmo--diagram')).toBeTruthy();
    expect(el.querySelector('.dgmo-source-wrap')).toBeNull();
    expect(el.querySelector('.dgmo-toolbar')).toBeNull();
  });

  it('triggers NO fetch for a non-map diagram', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.reject(new Error('fetch should not be called'))
    );
    vi.stubGlobal('fetch', fetchSpy);

    const el = makeElement('flowchart\n[A] -> [B]');
    document.body.appendChild(el);

    await waitFor(() => el.querySelector('svg') !== null);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lazy-fetches map data from map-data-base for a map diagram', async () => {
    // Minimal topojson/gazetteer stubs — enough for the loader to assemble a
    // MapData object. The assertion is that the fetch was driven by the
    // configured base, not that the map renders pixel-perfect.
    const topo = { type: 'Topology', objects: {}, arcs: [] };
    const gazetteer = { cities: [], byName: {} };
    const fetchSpy = vi.fn((url: string) => {
      const body = url.includes('gazetteer') ? gazetteer : topo;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(body),
      } as Response);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const base = 'https://cdn.example.test/map-data/';
    const el = makeElement('map\nregion US', { 'map-data-base': base });
    document.body.appendChild(el);

    // Wait until the element settles into either a rendered SVG or an error.
    await waitFor(
      () =>
        el.querySelector('svg') !== null ||
        el.querySelector('.dgmo--error') !== null
    );

    expect(fetchSpy).toHaveBeenCalled();
    const requested = fetchSpy.mock.calls.map((c) => c[0] as string);
    expect(requested).toContain(base + 'world-coarse.json');
    expect(requested).toContain(base + 'world-detail.json');
    expect(requested).toContain(base + 'us-states.json');
    expect(requested).toContain(base + 'gazetteer.json');
    // Every request went to the configured base.
    expect(requested.every((u) => u.startsWith(base))).toBe(true);
  });

  it('re-renders on a palette attribute change', async () => {
    const el = makeElement('flowchart\n[A] -> [B]');
    document.body.appendChild(el);
    await waitFor(() => el.querySelector('svg') !== null);

    const first = el.querySelector('svg');
    el.setAttribute('palette', 'nord');
    // A fresh svg node is mounted by the re-render.
    await waitFor(
      () =>
        el.querySelector('svg') !== null && el.querySelector('svg') !== first
    );
    expect(el.querySelector('svg')).toBeTruthy();
  });
});

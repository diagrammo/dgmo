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

  it('per-button show-* attributes toggle toolbar buttons independently', async () => {
    // showcase, but the copy + expand buttons individually turned off.
    const el = makeElement('flowchart\n[A] -> [B]', {
      mode: 'showcase',
      'show-copy': 'false',
      'show-expand': 'false',
    });
    document.body.appendChild(el);
    await waitFor(() => el.querySelector('svg') !== null);
    expect(el.querySelector('details.dgmo-source-wrap')).toBeTruthy();
    expect(el.querySelector('.dgmo-toggle')).toBeTruthy();
    expect(el.querySelector('button.dgmo-copy')).toBeNull();
    expect(el.querySelector('button.dgmo-expand')).toBeNull();
    expect(el.querySelector('a.dgmo-open')).toBeTruthy();
  });

  it('show-copy on its own in diagram mode yields a toolbar with only copy', async () => {
    const el = makeElement('flowchart\n[A] -> [B]', { 'show-copy': 'true' });
    document.body.appendChild(el);
    await waitFor(() => el.querySelector('svg') !== null);
    // No source-view toggle → plain toolbar overlay, no <details>.
    expect(el.querySelector('.dgmo-toolbar')).toBeTruthy();
    expect(el.querySelector('details')).toBeNull();
    expect(el.querySelector('button.dgmo-copy')).toBeTruthy();
    expect(el.querySelector('.dgmo-toggle')).toBeNull();
    expect(el.querySelector('a.dgmo-open')).toBeNull();
  });

  it('collapses an open source panel when the pointer leaves the block', async () => {
    const el = makeElement('flowchart\n[A] -> [B]', { mode: 'showcase' });
    document.body.appendChild(el);
    await waitFor(() => el.querySelector('svg') !== null);

    const details = el.querySelector(
      'details.dgmo-source-wrap'
    ) as HTMLDetailsElement;
    details.open = true;
    const wrapper = el.querySelector('figure.dgmo') as HTMLElement;
    wrapper.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    expect(details.open).toBe(false);
  });

  it('collapses an open source panel when focus leaves the block', async () => {
    const el = makeElement('flowchart\n[A] -> [B]', { mode: 'showcase' });
    document.body.appendChild(el);
    await waitFor(() => el.querySelector('svg') !== null);

    const details = el.querySelector(
      'details.dgmo-source-wrap'
    ) as HTMLDetailsElement;
    details.open = true;
    const wrapper = el.querySelector('figure.dgmo') as HTMLElement;
    wrapper.dispatchEvent(new FocusEvent('focusout', { relatedTarget: null }));
    expect(details.open).toBe(false);
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

// ============================================================
// Watching a live link (issue #163)
// ============================================================
//
// The point of the feature is a page nobody compiled, so these assert the two
// things such a page cannot recover from on its own: that the RIGHT diagram is
// asked for, and that every failure leaves something a reader can read. An
// empty container passes no test here.

describe('<dgmo-diagram watch>', () => {
  const ID = 'dgm_7f2a91';
  const SOURCE_URL = `https://api.diagrammo.app/public/diagrams/${ID}/source`;
  const LIVE_SOURCE = 'flowchart\n[Live] -> [Diagram]';

  /** A Cloud `source` endpoint answering with one status. */
  function stubCloud(
    status: number,
    body: unknown = {
      id: ID,
      source: LIVE_SOURCE,
      dgmoVersion: '0.64.1',
      updatedAt: 1,
    }
  ): ReturnType<typeof vi.fn> {
    const spy = vi.fn(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      } as Response)
    );
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('draws the published diagram for a bare id', async () => {
    const fetchSpy = stubCloud(200);
    const el = makeElement('', { watch: ID });
    document.body.appendChild(el);

    await waitFor(() => el.querySelector('svg') !== null);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(SOURCE_URL);
    // What was drawn is the FETCHED source, not the (empty) authored one.
    expect(el.querySelector('svg')!.textContent).toContain('Live');
    expect(el.querySelector('.dgmo--error')).toBeNull();
  });

  it('accepts a pasted share link and asks for the same diagram', async () => {
    const fetchSpy = stubCloud(200);
    const el = makeElement('', {
      watch: `https://online.diagrammo.app/d/${ID}`,
    });
    document.body.appendChild(el);

    await waitFor(() => el.querySelector('svg') !== null);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(SOURCE_URL);
  });

  it('watches a live-link written as the element SOURCE', async () => {
    const fetchSpy = stubCloud(200);
    const el = makeElement(`live-link ${ID}`);
    document.body.appendChild(el);

    await waitFor(() => el.querySelector('svg') !== null);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(SOURCE_URL);
    expect(el.querySelector('svg')!.textContent).toContain('Live');
  });

  it('a withdrawn diagram (410) draws the card and says who withdrew it', async () => {
    stubCloud(410, {});
    const el = makeElement('', { watch: ID });
    document.body.appendChild(el);

    await waitFor(() => el.querySelector('.dgmo-live-note') !== null);
    const container = el.firstElementChild as HTMLElement;
    expect(container.className).toContain('dgmo--live-state');
    // The reference card is drawn — this is not an error state.
    expect(container.querySelector('svg')).toBeTruthy();
    expect(el.querySelector('.dgmo--error')).toBeNull();
    const note = el.querySelector('.dgmo-live-note')!;
    expect(note.textContent).toContain('stopped showing');
  });

  it('a missing diagram (404) names the id it could not find', async () => {
    stubCloud(404, {});
    const el = makeElement('', { watch: ID });
    document.body.appendChild(el);

    await waitFor(() => el.querySelector('.dgmo-live-note') !== null);
    const note = el.querySelector('.dgmo-live-note')!;
    expect(note.textContent).toContain('No diagram is published');
    expect(note.textContent).toContain(ID);
  });

  it('an unreachable Cloud names the content-security-policy directive', async () => {
    // A CSP-blocked request is indistinguishable from being offline, so the
    // note has to raise the possibility itself.
    const fetchSpy = vi.fn(() => Promise.reject(new Error('Failed to fetch')));
    vi.stubGlobal('fetch', fetchSpy);

    const el = makeElement('', { watch: ID });
    document.body.appendChild(el);

    await waitFor(() => el.querySelector('.dgmo-live-note') !== null);
    const note = el.querySelector('.dgmo-live-note')!;
    expect(note.textContent).toContain('connect-src https://api.diagrammo.app');
    const link = note.querySelector('a') as HTMLAnchorElement;
    expect(link.href).toContain(ID);
  });

  it('refuses a target that is not a diagram, without asking the network', async () => {
    const fetchSpy = stubCloud(200);
    const el = makeElement('', { watch: 'my favourite diagram' });
    document.body.appendChild(el);

    await waitFor(() => el.querySelector('.dgmo--error') !== null);
    expect(el.querySelector('.dgmo--error')!.textContent).toContain(
      'is not a Diagrammo diagram'
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a pinned revision and says which pin to remove', async () => {
    const fetchSpy = stubCloud(200);
    const el = makeElement('', {
      watch: `https://online.diagrammo.app/d/${ID}?at=1712345678`,
    });
    document.body.appendChild(el);

    await waitFor(() => el.querySelector('.dgmo--error') !== null);
    const card = el.querySelector('.dgmo--error')!;
    expect(card.textContent).toContain('pinned revision');
    expect(card.textContent).toContain('?at=1712345678');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('re-fetches when the watch attribute changes', async () => {
    const fetchSpy = stubCloud(200);
    const el = makeElement('', { watch: ID });
    document.body.appendChild(el);
    await waitFor(() => el.querySelector('svg') !== null);

    el.setAttribute('watch', 'dgm_other1');
    await waitFor(() =>
      fetchSpy.mock.calls.some((c) => String(c[0]).includes('dgm_other1'))
    );
  });
});

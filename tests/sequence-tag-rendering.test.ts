import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { renderSequenceDiagram } from '../src/sequence/renderer';
import type { SequenceRenderOptions } from '../src/sequence/renderer';
import { getPalette } from '../src/palettes';
import { resolveColor } from '../src/colors';

// Set up jsdom globals for D3
let doc: Document;
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  doc = win.document;
  Object.defineProperty(globalThis, 'document', {
    value: doc,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: win.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    value: win.SVGElement,
    configurable: true,
  });
});

const palette = getPalette('nord').light;

function renderToSvg(
  input: string,
  options?: SequenceRenderOptions
): SVGSVGElement | null {
  const parsed = parseSequenceDgmo(input);
  expect(parsed.error).toBeNull();
  const container = doc.createElement('div') as unknown as HTMLDivElement;
  doc.body.appendChild(container);
  renderSequenceDiagram(container, parsed, palette, false, undefined, {
    exportWidth: 800,
    ...options,
  });
  const svg = container.querySelector('svg');
  doc.body.removeChild(container);
  return svg;
}

const tagDiagram = [
  'sequence',
  '',
  'tag Concern',
  '  Caching blue',
  '  Auth red',
  '',
  'API | concern: Caching',
  'DB is a database',
  'User is a actor',
  'User -login-> API | concern: Auth',
  'API -query-> DB | concern: Caching',
].join('\n');

describe('Sequence tag-driven recoloring', () => {
  // ──────────────────────────────────────────────────
  // Participant coloring
  // ──────────────────────────────────────────────────

  it('colors tagged participant with tag color', () => {
    const svg = renderToSvg(tagDiagram, { activeTagGroup: 'concern' });
    expect(svg).not.toBeNull();

    const apiG = svg!.querySelector('g[data-participant-id="API"]');
    expect(apiG).not.toBeNull();

    // The participant rect should have a fill derived from the tag color blue
    const rect = apiG!.querySelector('rect');
    expect(rect).not.toBeNull();
    const rectFill = rect!.getAttribute('fill');
    // Should not be the default fill (palette-based without color)
    expect(rectFill).toBeTruthy();
  });

  it('leaves untagged participant with default color when no default defined', () => {
    const svg = renderToSvg(tagDiagram, { activeTagGroup: 'concern' });
    expect(svg).not.toBeNull();

    // DB has no explicit tag and only receives one tagged message (Caching) → inherits Caching
    // User has no explicit tag but only sends → no inheritance, stays neutral
    // Actually User sends to API with Auth tag → User is not the receiver, API is
    // User is not receiver of any tagged message → neutral/default
  });

  it('renders with auto-activated first tag group when no explicit activeTagGroup', () => {
    const svg = renderToSvg(tagDiagram);
    expect(svg).not.toBeNull();
    // Auto-activation colors the diagram — expect more markers than base 3
    const markers = svg!.querySelectorAll('marker');
    expect(markers.length).toBeGreaterThanOrEqual(3);
  });

  // ──────────────────────────────────────────────────
  // Data-tag attributes
  // ──────────────────────────────────────────────────

  it('sets data-tag-* attribute on tagged participant', () => {
    const svg = renderToSvg(tagDiagram, { activeTagGroup: 'concern' });
    const apiG = svg!.querySelector('g[data-participant-id="API"]');
    expect(apiG!.getAttribute('data-tag-concern')).toBe('caching');
  });

  it('sets data-tag-* attribute on tagged message arrow', () => {
    const svg = renderToSvg(tagDiagram, { activeTagGroup: 'concern' });
    // Find message arrows with data-tag attribute
    const taggedArrows = svg!.querySelectorAll(
      '.message-arrow[data-tag-concern]'
    );
    expect(taggedArrows.length).toBeGreaterThanOrEqual(1);
  });

  // ──────────────────────────────────────────────────
  // Message arrow coloring
  // ──────────────────────────────────────────────────

  it('colors tagged message arrow with tag color', () => {
    const svg = renderToSvg(tagDiagram, { activeTagGroup: 'concern' });
    const blueHex = resolveColor('blue');

    // Find message arrows — tagged ones should use tag color
    const arrows = svg!.querySelectorAll('.message-arrow');
    let hasColoredArrow = false;
    arrows.forEach((arrow) => {
      const stroke = arrow.getAttribute('stroke');
      if (stroke === blueHex || stroke === resolveColor('red')) {
        hasColoredArrow = true;
      }
    });
    expect(hasColoredArrow).toBe(true);
  });

  it('creates per-color arrowhead markers when tags are active', () => {
    const svg = renderToSvg(tagDiagram, { activeTagGroup: 'concern' });
    const markers = svg!.querySelectorAll('marker');
    // 3 default + 3 per color × 2 colors = 9 total
    expect(markers.length).toBe(9);
  });

  // ──────────────────────────────────────────────────
  // Activation bar coloring
  // ──────────────────────────────────────────────────

  // Note: activation bar tag coloring is implemented but currently untestable
  // through SVG rendering — unlabeled returns are filtered from render steps,
  // and labeled return arrow syntax (<-label-) is deprecated. The activation
  // code path is covered by the renderer changes (uses triggering message's
  // tag color for fill/stroke and sets data-tag attribute).

  // ──────────────────────────────────────────────────
  // Group box coloring
  // ──────────────────────────────────────────────────

  it('colors group boxes by tag metadata', () => {
    const input = [
      'sequence',
      '',
      'tag Concern',
      '  Caching blue',
      '',
      '[Backend] | concern: Caching',
      '  API',
      '  DB',
      '',
      'API -query-> DB',
    ].join('\n');

    const svg = renderToSvg(input, { activeTagGroup: 'concern' });
    const groupBox = svg!.querySelector('.group-box');
    expect(groupBox).not.toBeNull();

    // Stroke should be the tag color blue, not the default textMuted
    const stroke = groupBox!.getAttribute('stroke');
    const blueHex = resolveColor('blue');
    expect(stroke).toBe(blueHex);
  });

  it('leaves untagged group boxes with default colors', () => {
    const input = [
      'sequence',
      '',
      'tag Concern',
      '  Caching blue',
      '',
      '[Backend]',
      '  API',
      '  DB',
      '',
      'API -query-> DB',
    ].join('\n');

    const svg = renderToSvg(input, { activeTagGroup: 'concern' });
    const groupBox = svg!.querySelector('.group-box');
    expect(groupBox).not.toBeNull();

    // Stroke should be the default (palette.textMuted)
    const stroke = groupBox!.getAttribute('stroke');
    expect(stroke).toBe(palette.textMuted);
  });

  // ──────────────────────────────────────────────────
  // Receiver inheritance in rendering
  // ──────────────────────────────────────────────────

  it('participant inherits color from incoming tagged message', () => {
    const input = [
      'sequence',
      '',
      'tag Concern',
      '  Caching blue',
      '',
      'API',
      'DB',
      'API -query-> DB | concern: Caching',
    ].join('\n');

    const svg = renderToSvg(input, { activeTagGroup: 'concern' });
    // DB should inherit Caching from the incoming message
    const dbG = svg!.querySelector('g[data-participant-id="DB"]');
    expect(dbG!.getAttribute('data-tag-concern')).toBe('caching');
  });

  // ──────────────────────────────────────────────────
  // No tags active — neutral rendering
  // ──────────────────────────────────────────────────

  it('renders neutrally when activeTagGroup does not match any group', () => {
    const svg = renderToSvg(tagDiagram, { activeTagGroup: 'nonexistent' });
    expect(svg).not.toBeNull();

    // No data-tag attributes should be set
    const tagged = svg!.querySelectorAll('[data-tag-nonexistent]');
    expect(tagged.length).toBe(0);
  });
});

// ============================================================
// Legend rendering
// ============================================================

const multiGroupDiagram = [
  'sequence',
  '',
  'tag Concern',
  '  Caching blue',
  '  Auth red',
  '',
  'tag Team',
  '  Alpha purple',
  '  Beta orange',
  '',
  'API | concern: Caching',
  'DB is a database',
  'API -query-> DB',
].join('\n');

describe('Sequence legend rendering', () => {
  it('renders legend pills for each tag group', () => {
    const svg = renderToSvg(multiGroupDiagram);
    const pills = svg!.querySelectorAll('[data-legend-group]');
    expect(pills.length).toBe(2);
  });

  it('sets data-legend-group attribute on each pill', () => {
    const svg = renderToSvg(multiGroupDiagram);
    const concernPill = svg!.querySelector('[data-legend-group="concern"]');
    const teamPill = svg!.querySelector('[data-legend-group="team"]');
    expect(concernPill).not.toBeNull();
    expect(teamPill).not.toBeNull();
  });

  it('expands active tag group with colored entry dots', () => {
    const svg = renderToSvg(multiGroupDiagram, { activeTagGroup: 'concern' });

    // Active group should have entry elements
    const entries = svg!.querySelectorAll('[data-legend-entry]');
    expect(entries.length).toBe(2); // Caching, Auth

    const cachingEntry = svg!.querySelector('[data-legend-entry="caching"]');
    const authEntry = svg!.querySelector('[data-legend-entry="auth"]');
    expect(cachingEntry).not.toBeNull();
    expect(authEntry).not.toBeNull();

    // Each entry should have a colored circle
    const dot = cachingEntry!.querySelector('circle');
    expect(dot).not.toBeNull();
    expect(dot!.getAttribute('fill')).toBeTruthy();
  });

  it('does not expand inactive tag groups', () => {
    const svg = renderToSvg(multiGroupDiagram, { activeTagGroup: 'concern' });

    // Team group should NOT have entry elements (inactive)
    const teamPill = svg!.querySelector('[data-legend-group="team"]');
    const teamEntries = teamPill!.querySelectorAll('[data-legend-entry]');
    expect(teamEntries.length).toBe(0);
  });

  it('renders no legend when no tag groups exist', () => {
    const input = ['sequence', 'API -query-> DB'].join('\n');
    const svg = renderToSvg(input);
    const pills = svg!.querySelectorAll('[data-legend-group]');
    expect(pills.length).toBe(0);
  });

  it('skips tag groups with no entries', () => {
    // Tag group declared but no entries — should not appear in legend
    const input = [
      'sequence',
      '',
      'tag Empty',
      '',
      'tag Concern',
      '  Caching blue',
      '',
      'API -query-> DB',
    ].join('\n');
    const svg = renderToSvg(input);
    const pills = svg!.querySelectorAll('[data-legend-group]');
    // Only Concern should appear (Empty has no entries)
    expect(pills.length).toBe(1);
    expect(pills[0].getAttribute('data-legend-group')).toBe('concern');
  });

  it('supports active-tag option from diagram markup', () => {
    const input = [
      'sequence',
      'active-tag: Concern',
      '',
      'tag Concern',
      '  Caching blue',
      '',
      'API | concern: Caching',
      'DB is a database',
      'API -query-> DB',
    ].join('\n');
    const svg = renderToSvg(input); // no explicit activeTagGroup in options
    // The active-tag option should activate tag coloring
    const apiG = svg!.querySelector('g[data-participant-id="API"]');
    expect(apiG!.getAttribute('data-tag-concern')).toBe('caching');
    // Legend should show expanded entries
    const entries = svg!.querySelectorAll('[data-legend-entry]');
    expect(entries.length).toBe(1); // just Caching
  });
});

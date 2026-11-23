import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseSitemap } from '../src/sitemap/parser';
import { layoutSitemap } from '../src/sitemap/layout';
import { renderSitemap } from '../src/sitemap/renderer';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

function renderToContainer(content: string, isDark = false) {
  const parsed = parseSitemap(content, palette);
  const layout = layoutSitemap(parsed);
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 800 });
  Object.defineProperty(container, 'clientHeight', { value: 600 });
  document.body.appendChild(container);

  renderSitemap(
    container,
    parsed,
    layout,
    isDark ? getPalette('nord').dark : palette,
    isDark,
    undefined,
    { width: 800, height: 600 }
  );

  return { container, parsed, layout };
}

describe('renderSitemap', () => {
  it('renders SVG with nodes', () => {
    const { container } = renderToContainer('Home\nAbout');
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const nodes = container.querySelectorAll('.sitemap-node');
    expect(nodes.length).toBe(2);
    document.body.removeChild(container);
  });

  it('renders a group as a dashed section node over its pages (#1861)', () => {
    const { container } = renderToContainer('[Group]\n  Page A\n  Page B');
    expect(container.querySelectorAll('.sitemap-section').length).toBe(1);
    expect(container.querySelectorAll('.sitemap-node').length).toBe(3);
    const tree = container.querySelectorAll('[data-edge-kind="tree"] path');
    expect(tree.length).toBe(2);
    for (const p of tree) expect(p.getAttribute('marker-end')).toBeNull();
    document.body.removeChild(container);
  });

  it('draws three line styles from three sources (#1861)', () => {
    const { container } = renderToContainer(
      ['Home', '  -help-> Done', '[Flow] steps', '  Start', '  Done'].join('\n')
    );
    const path = (kind: string) =>
      container.querySelector(`[data-edge-kind="${kind}"] path`)!;
    expect(path('link').getAttribute('stroke-dasharray')).toBeTruthy();
    expect(path('step').getAttribute('stroke-dasharray')).toBeNull();
    expect(path('step').getAttribute('marker-end')).toContain('sm-arrow-step');
    expect(
      [...container.querySelectorAll('.sitemap-step text')].map(
        (t) => t.textContent
      )
    ).toEqual(['1', '2']);
    document.body.removeChild(container);
  });

  it('draws page metadata as chips, not a key: value table (#1861)', () => {
    const { container } = renderToContainer(
      ['tag Auth', '  Public green', 'Home', '  Auth: Public'].join('\n')
    );
    const chip = container.querySelector('.sitemap-node .kanban-chip')!;
    expect(chip.querySelector('text')!.textContent).toBe('Public');
    expect(chip.querySelector('title')!.textContent).toBe('Auth: Public');
    const texts = [...container.querySelectorAll('.sitemap-node text')].map(
      (t) => t.textContent
    );
    expect(texts).not.toContain('Auth:');
    document.body.removeChild(container);
  });

  it('renders edges with arrowheads', () => {
    const content = 'Home\n  -go-> About\nAbout';
    const { container } = renderToContainer(content);
    const edges = container.querySelectorAll('.sitemap-edge');
    expect(edges.length).toBe(1);
    const markers = container.querySelectorAll('marker');
    expect(markers.length).toBeGreaterThanOrEqual(1);
    document.body.removeChild(container);
  });

  it('renders edge labels', () => {
    const content = 'Home\n  -navigate-> About\nAbout';
    const { container } = renderToContainer(content);
    const labels = container.querySelectorAll('.sitemap-edge-label');
    expect(labels.length).toBe(1);
    expect(labels[0].textContent).toBe('navigate');
    document.body.removeChild(container);
  });

  it('sets data-line-number on nodes', () => {
    const { container } = renderToContainer('Home\nAbout');
    const nodes = container.querySelectorAll('[data-line-number]');
    expect(nodes.length).toBeGreaterThanOrEqual(2);
    document.body.removeChild(container);
  });

  it('sets data-node-toggle on containers with children', () => {
    const { container } = renderToContainer('[Group]\n  Page A');
    const toggles = container.querySelectorAll('[data-node-toggle]');
    expect(toggles.length).toBeGreaterThanOrEqual(1);
    document.body.removeChild(container);
  });

  it('renders title', () => {
    const { container } = renderToContainer('sitemap My Site\nHome');
    const title = container.querySelector('.sitemap-title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe('My Site');
    document.body.removeChild(container);
  });

  it('renders in dark mode without errors', () => {
    const { container } = renderToContainer('Home\nAbout', true);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    document.body.removeChild(container);
  });

  it('renders default arrowhead marker (no edge color slot per §1.7)', () => {
    const content = 'Home\n  -browse-> About\nAbout';
    const { container } = renderToContainer(content);
    const markers = container.querySelectorAll('marker');
    expect(markers.length).toBeGreaterThanOrEqual(1);
    document.body.removeChild(container);
  });

  it('renders metadata on cards', () => {
    const content = 'Home\n  Auth: Public\n  Type: Landing';
    const { container } = renderToContainer(content);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // Node should have text elements for metadata
    const node = container.querySelector('.sitemap-node');
    expect(node).not.toBeNull();
    const texts = node!.querySelectorAll('text');
    // Label + 2 key texts + 2 value texts = 5
    expect(texts.length).toBeGreaterThanOrEqual(3);
    document.body.removeChild(container);
  });
});

describe('renderSitemap edge labels (#1425)', () => {
  it('draws no edge label badge over another in gallery sitemap-full', () => {
    const source = readFileSync(
      resolve(__dirname, '../gallery/fixtures/sitemap-full.dgmo'),
      'utf8'
    );
    const { container } = renderToContainer(source);
    const badges = [
      ...container.querySelectorAll('.sitemap-edge-label-bg'),
    ].map((r) => {
      const x = Number(r.getAttribute('x'));
      const y = Number(r.getAttribute('y'));
      const w = Number(r.getAttribute('width'));
      const h = Number(r.getAttribute('height'));
      return { x, y, w, h, text: r.nextElementSibling?.textContent ?? '' };
    });
    expect(badges.length).toBeGreaterThan(40);
    const overlapping: string[] = [];
    for (let i = 0; i < badges.length; i++) {
      for (let j = i + 1; j < badges.length; j++) {
        const a = badges[i]!;
        const b = badges[j]!;
        if (
          a.x < b.x + b.w &&
          b.x < a.x + a.w &&
          a.y < b.y + b.h &&
          b.y < a.y + a.h
        )
          overlapping.push(`${a.text} / ${b.text}`);
      }
    }
    expect(overlapping).toEqual([]);
    document.body.removeChild(container);
  });
});

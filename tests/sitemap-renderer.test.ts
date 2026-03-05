import { describe, it, expect } from 'vitest';
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
    { width: 800, height: 600 },
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

  it('renders containers', () => {
    const { container } = renderToContainer('[Group]\n  Page A\n  Page B');
    const containers = container.querySelectorAll('.sitemap-container');
    expect(containers.length).toBe(1);
    const nodes = container.querySelectorAll('.sitemap-node');
    expect(nodes.length).toBe(2);
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
    const { container } = renderToContainer('chart: sitemap\ntitle: My Site\nHome');
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

  it('renders colored arrowheads', () => {
    const content = 'Home\n  -(red)-> About\nAbout';
    const { container } = renderToContainer(content);
    const markers = container.querySelectorAll('marker');
    // Default + colored marker
    expect(markers.length).toBeGreaterThanOrEqual(2);
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

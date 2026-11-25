import { describe, it, expect } from 'vitest';
import { parseSitemap } from '../src/sitemap/parser';
import { layoutSitemap } from '../src/sitemap/layout';
import { renderSitemap } from '../src/sitemap/renderer';
import { getPalette } from '../src/palettes';
import { render } from '../src/render';

// #2312: a card hover lights the card, both ends of every edge touching it,
// and its children; the active tag group's chip is never drawn.

const palette = getPalette('nord').light;

const SRC = [
  'sitemap Tickets',
  'tag Auth',
  '  Public green',
  '  Required blue',
  'tag Type',
  '  Landing purple',
  '  Form orange',
  '',
  'Home',
  '  Auth: Public',
  '  Type: Landing',
  '  -sign in-> Login',
  '  -> [Shop]',
  '',
  '[Shop]',
  '  Cart',
  '    Auth: Required',
  '    Type: Form',
  '    -update-> Cart',
  '    -pay-> Checkout',
  '  Checkout',
  '    -back-> Cart',
  '',
  'Login',
  '  Auth: Public',
  '  Type: Form',
].join('\n');

function reach(label: string): string[] {
  const parsed = parseSitemap(SRC, palette);
  const layout = layoutSitemap(parsed);
  const byLabel = new Map(layout.nodes.map((n) => [n.label, n]));
  const byId = new Map(layout.nodes.map((n) => [n.id, n.label]));
  return byLabel
    .get(label)!
    .neighbors.map((id) => byId.get(id)!)
    .sort();
}

describe('sitemap hover reach (#2312)', () => {
  it('a page reaches its link targets, its sources and its tree parent', () => {
    expect(reach('Login')).toEqual(['Home', 'Login']);
  });

  it('a self-loop and edges both ways count once each', () => {
    expect(reach('Cart')).toEqual(['Cart', 'Checkout', 'Shop']);
    expect(reach('Checkout')).toEqual(['Cart', 'Checkout', 'Shop']);
  });

  it('a section reaches the pages under it', () => {
    expect(reach('Shop')).toEqual(['Cart', 'Checkout', 'Home', 'Shop']);
  });

  it('the root reaches its children and every page it links to', () => {
    expect(reach('Home')).toEqual(['Home', 'Login', 'Shop']);
  });

  it('the renderer writes the reach onto each card', () => {
    const parsed = parseSitemap(SRC, palette);
    const layout = layoutSitemap(parsed);
    const container = document.createElement('div');
    renderSitemap(container, parsed, layout, palette, false, undefined, {
      width: 800,
      height: 600,
    });
    for (const n of layout.nodes) {
      const el = container.querySelector(`[data-node-id="${n.id}"]`)!;
      expect(el.getAttribute('data-neighbors')).toBe(n.neighbors.join(' '));
    }
  });

  it('the baked export CSS dims cards outside the hovered card reach', async () => {
    const { svg } = await render(SRC);
    expect(svg).toMatch(
      /svg:has\(\.sitemap-node\[data-node-id="[^"]+"\]:hover\) \.sitemap-node:not\(\[data-neighbors~="[^"]+"\]\)\{opacity:/
    );
  });
});

describe('sitemap chips skip the active tag group (#2312)', () => {
  function chips(active: string | null): string[] {
    const parsed = parseSitemap(SRC, palette);
    const layout = layoutSitemap(parsed, undefined, active);
    const container = document.createElement('div');
    renderSitemap(
      container,
      parsed,
      layout,
      palette,
      false,
      undefined,
      { width: 800, height: 600 },
      active
    );
    return [
      ...container.querySelectorAll('.sitemap-node .kanban-chip title'),
    ].map((t) => t.textContent!.split(':')[0]!);
  }

  it('draws every group with no group active', () => {
    expect(new Set(chips(null))).toEqual(new Set(['Auth', 'Type']));
  });

  it('drops the active group and keeps the rest', () => {
    expect(new Set(chips('Auth'))).toEqual(new Set(['Type']));
    expect(new Set(chips('type'))).toEqual(new Set(['Auth']));
  });
});

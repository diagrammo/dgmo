import { describe, it, expect } from 'vitest';
import { parseSitemap } from '../src/sitemap/parser';
import { unionCollapsedSitemapNodes } from '../src/sitemap/collapse';
import type { SitemapNode, ParsedSitemap } from '../src/sitemap/types';
import { render } from '../src/render';
import {
  applyCollapsedMarkerAtLine,
  applyGroupHeaderCollapsedMarkerAtLine,
} from '../src/utils/collapse-marker';

function find(p: ParsedSitemap, label: string): SitemapNode {
  const walk = (ns: readonly SitemapNode[]): SitemapNode | undefined => {
    for (const n of ns) {
      if (n.label === label) return n;
      const hit = walk(n.children);
      if (hit) return hit;
    }
    return undefined;
  };
  const hit = walk(p.roots);
  if (!hit) throw new Error(`no node ${label}`);
  return hit;
}

const page = (line: string) =>
  `sitemap\nHome\n  ${line}\n    Widgets\n    Gadgets\n`;
const container = (line: string) =>
  `sitemap\nHome\n  ${line}\n    Cart\n    Checkout\n`;

/** Every `<g …>` opening tag carrying a toggle attribute. */
function toggles(svg: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const m of svg.matchAll(
    /<g\b([^>]*\bdata-node-toggle="[^"]*"[^>]*)>/g
  )) {
    const attrs: Record<string, string> = {};
    for (const a of m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]!] = a[2]!;
    out.push(attrs);
  }
  return out;
}
const bars = (svg: string) => (svg.match(/dgmo-collapse-bar"/g) ?? []).length;

describe('sitemap page `collapsed` marker', () => {
  it.each([
    ['Products collapsed', true],
    ['Products blue collapsed', true],
    ['Products status: live collapsed', true],
    ['Products collapsed: true', true],
    ['Products status: live, collapsed: true', true],
    ['Products collapsed: false', false],
    ['Products', undefined],
  ])('%s → collapsed %s', (line, want) => {
    const n = find(parseSitemap(page(line)), 'Products');
    expect(n.collapsed).toBe(want);
    expect(n.metadata).not.toHaveProperty('collapsed');
  });

  it('keeps other same-line metadata', () => {
    const n = find(
      parseSitemap(page('Products status: live collapsed')),
      'Products'
    );
    expect(n.metadata['status']).toBe('live');
  });

  it('capitalised Collapsed stays part of the name', () => {
    const p = parseSitemap(page('Products Collapsed'));
    expect(find(p, 'Products Collapsed').collapsed).toBeUndefined();
  });

  it('a page named `collapsed` stays a page', () => {
    const p = parseSitemap('sitemap\nHome\n  collapsed\n    Widgets\n');
    expect(find(p, 'collapsed').collapsed).toBeUndefined();
  });

  it('a root page with the bare flag is a page, not a header option', () => {
    const p = parseSitemap('sitemap\nHome collapsed\n  Products\n');
    expect(p.options).not.toHaveProperty('home');
    expect(find(p, 'Home').collapsed).toBe(true);
  });

  it('indented `collapsed: true` under a page folds it and is not drawn as metadata', () => {
    const p = parseSitemap(
      'sitemap\nHome\n  Products\n    collapsed: true\n    Widgets\n'
    );
    const n = find(p, 'Products');
    expect(n.collapsed).toBe(true);
    expect(n.metadata).not.toHaveProperty('collapsed');
  });

  it('quoted names and `as <alias>` keep their marker', () => {
    const p = parseSitemap(
      'sitemap\nHome\n  "A | B" as ab collapsed\n    Widgets\n'
    );
    expect(find(p, 'A | B').collapsed).toBe(true);
  });
});

describe('sitemap container `collapsed` marker', () => {
  it.each([
    ['[Shop] collapsed', true],
    ['[Shop] owner: Ann collapsed', true],
    ['[Shop] collapsed: true', true],
    ['[Shop] owner: Ann, collapsed: true', true],
    ['[Shop] collapsed: false', false],
    ['[Shop]', undefined],
    ['["Shop | Cart"] collapsed', true],
    ['[Shop as sh] collapsed', true],
  ])('%s → collapsed %s', (line, want) => {
    const p = parseSitemap(container(line));
    const c = p.roots[0]!.children[0]!;
    expect(c.isContainer).toBe(true);
    expect(c.collapsed).toBe(want);
    expect(c.metadata).not.toHaveProperty('collapsed');
    // never cascades to members
    for (const m of c.children) {
      expect(m.metadata).not.toHaveProperty('collapsed');
      expect(m.collapsed).toBeUndefined();
    }
  });

  it('indented `collapsed: true` under a container folds it and does not cascade', () => {
    const p = parseSitemap(
      'sitemap\nHome\n  [Shop]\n    collapsed: true\n    Cart\n'
    );
    const c = p.roots[0]!.children[0]!;
    expect(c.collapsed).toBe(true);
    expect(c.metadata).not.toHaveProperty('collapsed');
    expect(c.children[0]!.metadata).not.toHaveProperty('collapsed');
  });

  it('capitalised Collapsed is not a flag', () => {
    const c = parseSitemap(container('[Shop] Collapsed')).roots[0]!
      .children[0]!;
    expect(c.collapsed).toBeUndefined();
  });
});

describe('unionCollapsedSitemapNodes', () => {
  it('unions source markers with the interactive set', () => {
    const p = parseSitemap(
      'sitemap\nHome\n  Products collapsed\n    Widgets\n  [Shop] collapsed\n    Cart\n  About\n    Team\n'
    );
    const ids = unionCollapsedSitemapNodes(p, [find(p, 'About').id]);
    expect([...ids].sort()).toEqual(
      [find(p, 'Products').id, find(p, 'Shop').id, find(p, 'About').id].sort()
    );
  });
});

describe('sitemap static render honours the marker', () => {
  it.each([
    ['page', page('Products collapsed'), page('Products'), 3, 'Products'],
    [
      'container',
      container('[Shop] collapsed'),
      container('[Shop]'),
      3,
      'Shop',
    ],
  ])(
    '%s: one bar folded, none expanded; toggle on both states',
    async (_k, folded, open, line, label) => {
      const f = await render(folded);
      const o = await render(open);
      expect(bars(f.svg)).toBe(1);
      expect(bars(o.svg)).toBe(0);
      for (const [svg, expanded] of [
        [f.svg, 'false'],
        [o.svg, 'true'],
      ] as const) {
        const t = toggles(svg).find((a) => a['aria-label'] === label);
        expect(t).toBeDefined();
        expect(t!['data-line-number']).toBe(String(line));
        expect(t!['aria-expanded']).toBe(expanded);
        expect(t!['role']).toBe('button');
        expect(t).not.toHaveProperty('tabindex');
      }
    }
  );

  it('folded subtree is hidden in the static render', async () => {
    const f = await render(page('Products collapsed'));
    expect(f.svg).not.toContain('>Widgets<');
    const o = await render(page('Products'));
    expect(o.svg).toContain('Widgets');
  });

  it('leaf pages carry no toggle', async () => {
    const o = await render(page('Products'));
    expect(
      toggles(o.svg)
        .map((t) => t['aria-label'])
        .sort()
    ).toEqual(['Home', 'Products']);
  });
});

describe('source-edit helpers round-trip', () => {
  const folded = (src: string, label: string) =>
    find(parseSitemap(src), label).collapsed === true;

  // The label argument is the line's name region AS WRITTEN — everything
  // before the first `key:` — so a trailing colour word, quotes and an
  // `as <alias>` belong to it. Passing the parsed label ('Products') for
  // `Products blue` writes `Products blue, collapsed: true`, which parses
  // to the page name `Products blue,`.
  it.each([
    ['Products', 'Products', 'Products'],
    ['Products status: live', 'Products', 'Products'],
    ['Products blue', 'Products blue', 'Products'],
    ['"A | B"', '"A | B"', 'A | B'],
    ['"A | B" as ab', '"A | B" as ab', 'A | B'],
  ])('page line %s (label arg %s)', (line, labelArg, name) => {
    const src = page(line);
    expect(folded(src, name)).toBe(false);
    const on = applyCollapsedMarkerAtLine(src, 3, labelArg, true);
    expect(folded(on, name)).toBe(true);
    const off = applyCollapsedMarkerAtLine(on, 3, labelArg, false);
    expect(off).toBe(src);
    expect(folded(off, name)).toBe(false);
  });

  it('page line already carrying the bare flag: collapse is a no-op, expand removes it', () => {
    const src = page('Products status: live collapsed');
    expect(applyCollapsedMarkerAtLine(src, 3, 'Products', true)).toBe(src);
    const off = applyCollapsedMarkerAtLine(src, 3, 'Products', false);
    expect(off).toBe(page('Products status: live'));
    expect(folded(off, 'Products')).toBe(false);
  });

  it.each(['[Shop]', '[Shop] owner: Ann', '["Shop | Cart"]', '[Shop as sh]'])(
    'container line %s',
    (line) => {
      const src = container(line);
      const c = () => parseSitemap(src).roots[0]!.children[0]!;
      const on = applyGroupHeaderCollapsedMarkerAtLine(src, 3, true);
      expect(parseSitemap(on).roots[0]!.children[0]!.collapsed).toBe(true);
      const off = applyGroupHeaderCollapsedMarkerAtLine(on, 3, false);
      expect(off).toBe(src);
      expect(c().collapsed).toBeUndefined();
    }
  );

  it('container line already carrying the bare flag', () => {
    const src = container('[Shop] owner: Ann collapsed');
    expect(applyGroupHeaderCollapsedMarkerAtLine(src, 3, true)).toBe(src);
    const off = applyGroupHeaderCollapsedMarkerAtLine(src, 3, false);
    expect(off).toBe(container('[Shop] owner: Ann'));
  });
});

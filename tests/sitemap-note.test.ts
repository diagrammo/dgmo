import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseSitemap } from '../src/sitemap/parser';
import { layoutSitemap } from '../src/sitemap/layout';
import { renderSitemapForExport } from '../src/sitemap/renderer';
import { resolveNotes } from '../src/utils/notes';
import { getPalette } from '../src/palettes';
import type { SitemapNode } from '../src/sitemap/types';

let parseSvg: (s: string) => Document;
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [k, v] of Object.entries({
    document: win.document,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  })) {
    Object.defineProperty(globalThis, k, { value: v, configurable: true });
  }
  parseSvg = (s: string) =>
    new win.DOMParser().parseFromString(s, 'image/svg+xml');
});

const P = getPalette('nord').light;
const sm = (src: string) => renderSitemapForExport(src, 'light', P);

const errors = (d: readonly { severity: string }[]) =>
  d.filter((x) => x.severity === 'error');

const flat = (roots: readonly SitemapNode[]) => {
  const out: { id: string; label: string }[] = [];
  const walk = (ns: readonly SitemapNode[]) => {
    for (const n of ns) {
      out.push({ id: n.id, label: n.label });
      walk(n.children);
    }
  };
  walk(roots);
  return out;
};

const SRC = [
  'sitemap',
  'Home',
  '  Shop',
  '  Enlist',
  'note Home the landing page',
].join('\n');

describe('sitemap notes — parsing', () => {
  it('collects a note and resolves it to a page', () => {
    const parsed = parseSitemap(SRC, P);
    expect(parsed.error).toBeNull();
    expect(parsed.notes?.length).toBe(1);
    expect(parsed.notes![0]!.ref).toBe('Home');
    const byNode = resolveNotes(parsed.notes!, flat(parsed.roots));
    const home = flat(parsed.roots).find((n) => n.label === 'Home')!;
    expect(byNode.get(home.id)?.body).toBe('the landing page');
    expect(errors(parsed.diagnostics)).toHaveLength(0);
  });

  it('errors on an unknown ref', () => {
    const parsed = parseSitemap(
      ['sitemap', 'Home', 'note Checkout nope'].join('\n'),
      P
    );
    expect(errors(parsed.diagnostics).length).toBe(1);
    expect(errors(parsed.diagnostics)[0]!.message).toMatch(
      /unknown node id "Checkout"/
    );
  });
});

describe('sitemap notes — rendering', () => {
  it('emits a note group with toggle hook + box + connector', async () => {
    const svg = parseSvg(await sm(SRC));
    const note = svg.querySelector('.note');
    expect(note).not.toBeNull();
    expect(note!.hasAttribute('data-note-toggle')).toBe(true);
    expect(note!.getAttribute('data-line-number')).toBe('5');
    expect(svg.querySelector('.note-box')).not.toBeNull();
    expect(svg.querySelector('.note-connector')).not.toBeNull();
  });

  it('colors the note border via a trailing color word', async () => {
    const svg = parseSvg(
      await sm(['sitemap', 'Home', 'note Home busy red'].join('\n'))
    );
    const stroke = svg.querySelector('.note-box')!.getAttribute('stroke')!;
    expect(stroke).toBe(P.colors.red);
    expect(stroke).not.toBe(P.colors.yellow);
  });

  it('keeps the note within a non-negative canvas', () => {
    const parsed = parseSitemap(SRC, P);
    const layout = layoutSitemap(parsed);
    const annotated = layout.nodes.find((n) => n.note)!;
    expect(annotated.note).toBeTruthy();
    const centerY = annotated.y + annotated.height / 2;
    expect(annotated.x + annotated.note!.x).toBeGreaterThanOrEqual(0);
    expect(centerY + annotated.note!.y).toBeGreaterThanOrEqual(0);
    expect(
      annotated.x + annotated.note!.x + annotated.note!.width
    ).toBeLessThanOrEqual(layout.width);
  });

  it('no-notes suppresses the note entirely', async () => {
    const svg = parseSvg(
      await sm(['sitemap', 'no-notes', 'Home', 'note Home hidden'].join('\n'))
    );
    expect(svg.querySelector('.note')).toBeNull();
  });

  it('renders a collapsed note as a corner badge', () => {
    const parsed = parseSitemap(SRC, P);
    const layout = layoutSitemap(
      parsed,
      undefined,
      undefined,
      undefined,
      undefined,
      new Set([5])
    );
    const annotated = layout.nodes.find((n) => n.note)!;
    expect(annotated.note!.collapsed).toBe(true);
  });
});

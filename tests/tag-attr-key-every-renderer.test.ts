/**
 * Every renderer names its `data-tag-*` attributes through `tagAttrKey`, so a
 * tag key holding a space or another non-name character can never reach
 * `setAttribute` raw. A raw key threw `Invalid qualified name` mid-typing in
 * boxes-and-lines (`data-tag-heatintelnetwork s`), and the preview panel
 * crashed (tracker #1212).
 *
 * The inputs:
 * - a tag group renamed to a quoted multi-word name with a non-name character
 *   (`tag "Status (v2)" as s`), so the key is the slug `status-v2`;
 * - for boxes-and-lines, which stamps every metadata key a node carries, an
 *   undeclared key on a group line (`[Edge] heat intel.x: hot`). Its parser
 *   keeps that key raw and cascades it to the group's nodes; this is the path
 *   that still threw once tag group names were slugged (#1085).
 * The legend's active-group marker must name an attribute the marks carry, or
 * legend hover dims nothing. Map (needs injected geo data) and family (export
 * takes the active group as an option) have the same case in their renderer
 * tests.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { renderForExport } from '../src/d3';
import { getPalette } from '../src/palettes';
import { tagAttrKey } from '../src/utils/tag-groups';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [key, value] of Object.entries({
    document: win.document,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
    DOMParser: win.DOMParser,
  })) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
});

const palette = getPalette('nord').light;
const FIXTURES = resolve(__dirname, '../gallery/fixtures');

/**
 * A gallery fixture with its first tag group renamed `"<Name> (v2)"`. The old
 * alias (or the old name, as an alias) keeps every reference resolving, and an
 * `active-tag` naming the old name follows the rename.
 */
function renamedFixture(file: string): { src: string; slug: string } {
  const text = readFileSync(resolve(FIXTURES, file), 'utf8');
  const m = text.match(/^(\s*)tag ([A-Za-z]+)(?: as ([A-Za-z]+))?/m);
  if (!m) throw new Error(`${file}: no tag group`);
  const name = `${m[2]} (v2)`;
  const alias = m[3] ?? m[2].toLowerCase();
  const src = text
    .replace(m[0], `${m[1]}tag "${name}" as ${alias}`)
    .replace(new RegExp(`^active-tag ${m[2]}$`, 'mi'), `active-tag ${name}`);
  return { src, slug: tagAttrKey(name) };
}

const INLINE: Record<string, { src: string; slug: string }> = {
  bracket: {
    slug: 'ticketing-v2',
    src: [
      'bracket Playoffs',
      'tag "Ticketing (v2)" as tk',
      '  MLB Ballpark blue',
      '  Ticketmaster orange',
      '',
      '[American League]',
      '  seed 1 Blue Jays tk: MLB Ballpark',
      '  seed 2 Mariners tk: Ticketmaster',
      '  seed 3 Yankees tk: MLB Ballpark',
      '  seed 4 Red Sox tk: Ticketmaster',
    ].join('\n'),
  },
  er: {
    slug: 'domain-v2',
    src: [
      'er',
      '',
      'tag "Domain (v2)" as d',
      '  Billing blue',
      '  Shipping green',
      '',
      'Users d: Billing',
      '  id int pk',
      '',
      'Orders d: Shipping',
      '  id int pk',
    ].join('\n'),
  },
  'journey-map': {
    slug: 'channel-v2',
    src: [
      'journey-map Buying',
      '',
      'tag "Channel (v2)" as ch',
      '  Web blue',
      '  Mobile purple',
      '',
      '[Research]',
      '  Compare specs score: 4, ch: Web',
      '  Read reviews score: 3, ch: Mobile',
    ].join('\n'),
  },
  org: {
    slug: 'location-v2',
    src: [
      'org',
      '',
      'tag "Location (v2)" as loc',
      '  NY blue',
      '  SF green',
      '',
      'Alice',
      '  loc: NY',
      '  Bob',
      '    loc: SF',
    ].join('\n'),
  },
  pert: {
    slug: 'crew-v2',
    src: [
      'pert',
      'tag "Crew (v2)" as c',
      '  Captain red',
      '  Bosun orange',
      '',
      'A 1 2 4',
      '  c: Captain',
      '  -> B',
      'B 1 2 3',
      '  c: Bosun',
    ].join('\n'),
  },
  sitemap: {
    slug: 'access-v2',
    src: [
      'sitemap',
      '',
      'tag "Access (v2)" as access',
      '  Public blue',
      '  Private red',
      '',
      'Home access: Public',
      '  Account access: Private',
    ].join('\n'),
  },
};

const FIXTURE_FILES = [
  'block.dgmo',
  'boxes-and-lines.dgmo',
  'c4-full.dgmo',
  'event-line.dgmo',
  'gantt.dgmo',
  'infra.dgmo',
  'kanban.dgmo',
  'mindmap.dgmo',
  'sequence-tags.dgmo',
  'state-tags.dgmo',
  'timeline.dgmo',
  'treemap-tags.dgmo',
  'treemap-radial.dgmo',
];

/** Attribute names a browser would refuse (`Invalid qualified name`). */
function badTagAttrs(svg: string): string[] {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const bad: string[] = [];
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      if (
        a.name.startsWith('data-tag-') &&
        !/^data-tag-[a-z0-9_-]*$/.test(a.name)
      )
        bad.push(a.name);
    }
  });
  return bad;
}

function carries(svg: string, attr: string): boolean {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  return doc.querySelector(`[${attr}]`) !== null;
}

/** The legend's `data-legend-active` group, as hover-styles resolves it. */
function legendActive(svg: string): string | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  return (
    doc
      .querySelector('[data-legend-active]')
      ?.getAttribute('data-legend-active') ?? null
  );
}

const CASES: [string, () => { src: string; slug: string }][] = [
  ...FIXTURE_FILES.map(
    (f) =>
      [f, () => renamedFixture(f)] as [
        string,
        () => { src: string; slug: string },
      ]
  ),
  ...Object.entries(INLINE).map(
    ([k, v]) => [k, () => v] as [string, () => { src: string; slug: string }]
  ),
];

describe('a multi-word tag group with a non-name character', () => {
  it.each(CASES)(
    '%s renders and keys its marks by the slug',
    async (_n, get) => {
      const { src, slug } = get();
      const svg = await renderForExport(src, 'light', palette);
      expect(svg).toContain('<svg');
      expect(badTagAttrs(svg)).toEqual([]);
      expect(carries(svg, `data-tag-${slug}`)).toBe(true);
      const active = legendActive(svg);
      if (active !== null)
        expect(carries(svg, `data-tag-${tagAttrKey(active)}`)).toBe(true);
    }
  );
});

describe('a metadata key that is not a tag group', () => {
  it('boxes-and-lines stamps it by the slug — the reported crash', async () => {
    const src = [
      'boxes-and-lines',
      '',
      '[Edge] heat intel.x: hot',
      '  Gateway',
      '  Store',
      'Gateway -> Store',
    ].join('\n');
    const svg = await renderForExport(src, 'light', palette);
    expect(badTagAttrs(svg)).toEqual([]);
    expect(carries(svg, 'data-tag-heat-intel-x')).toBe(true);
  });
});

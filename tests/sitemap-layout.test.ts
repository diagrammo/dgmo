import { describe, it, expect } from 'vitest';
import { parseSitemap } from '../src/sitemap/parser';
import { layoutSitemap } from '../src/sitemap/layout';
import {
  collapseSitemapTree,
  unionCollapsedSitemapNodes,
} from '../src/sitemap/collapse';

type Box = { x: number; y: number; width: number; height: number };
/** Cards are placed by top-centre; no two may share any area. */
function expectNoOverlap(nodes: readonly Box[]): void {
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const x =
        a.x - a.width / 2 < b.x + b.width / 2 &&
        b.x - b.width / 2 < a.x + a.width / 2;
      const y = a.y < b.y + b.height && b.y < a.y + a.height;
      expect(x && y).toBe(false);
    }
}

function layout(content: string) {
  const parsed = parseSitemap(content);
  return { parsed, layout: layoutSitemap(parsed) };
}

describe('layoutSitemap', () => {
  it('returns empty for empty input', () => {
    const parsed = parseSitemap('sitemap');
    const result = layoutSitemap(parsed);
    expect(result.nodes).toHaveLength(0);
    expect(result.width).toBe(0);
  });

  it('positions a single node', () => {
    const { layout: result } = layout('Home');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].label).toBe('Home');
    expect(result.nodes[0].x).toBeGreaterThan(0);
    expect(result.nodes[0].y).toBeGreaterThan(0);
    expect(result.nodes[0].width).toBeGreaterThan(0);
    expect(result.nodes[0].height).toBeGreaterThan(0);
  });

  it('positions multiple nodes without overlap', () => {
    const { layout: result } = layout('Home\nAbout\nContact');
    expect(result.nodes).toHaveLength(3);

    // Check no two nodes overlap (using bounding boxes)
    for (let i = 0; i < result.nodes.length; i++) {
      for (let j = i + 1; j < result.nodes.length; j++) {
        const a = result.nodes[i];
        const b = result.nodes[j];
        const aLeft = a.x - a.width / 2;
        const aRight = a.x + a.width / 2;
        const bLeft = b.x - b.width / 2;
        const bRight = b.x + b.width / 2;
        // At least one axis should not overlap
        const xOverlap = aLeft < bRight && aRight > bLeft;
        const yOverlap = a.y < b.y + b.height && a.y + a.height > b.y;
        expect(xOverlap && yOverlap).toBe(false);
      }
    }
  });

  it('draws a group as a section node with its pages under it (#1861)', () => {
    const { layout: result } = layout('[Group]\n  Page A\n  Page B');
    expect(result.nodes).toHaveLength(3);
    const group = result.nodes.find((n) => n.isContainer)!;
    expect(group.label).toBe('Group');
    for (const page of result.nodes.filter((n) => !n.isContainer))
      expect(page.y).toBeGreaterThan(group.y + group.height);
    expect(result.edges.filter((e) => e.kind === 'tree')).toHaveLength(2);
  });

  it('routes edges between nodes', () => {
    const content = ['Home', '  -go-> About', 'About'].join('\n');
    const { layout: result } = layout(content);
    const links = result.edges.filter((e) => e.kind === 'link');
    expect(links).toHaveLength(1);
    expect(links[0].points.length).toBeGreaterThanOrEqual(2);
  });

  it('handles TB and LR directions', () => {
    const tb = layout('sitemap\ndirection-tb\nHome\nAbout');
    const lr = layout('sitemap\nHome\nAbout');

    // Both should produce valid layouts
    expect(tb.layout.nodes).toHaveLength(2);
    expect(lr.layout.nodes).toHaveLength(2);
    expect(tb.layout.width).toBeGreaterThan(0);
    expect(lr.layout.width).toBeGreaterThan(0);
  });

  it('computes legend for tag groups', () => {
    const content = [
      'tag Auth',
      '  Public green',
      '  Required blue',
      '',
      'Home',
      '  Auth: Public',
    ].join('\n');
    const { layout: result } = layout(content);
    expect(result.legend.length).toBeGreaterThanOrEqual(1);
    expect(result.legend[0].name).toBe('Auth');
  });

  it('handles nested containers', () => {
    const content = ['[Outer]', '  [Inner]', '    Page A', '  Page B'].join(
      '\n'
    );
    const { layout: result } = layout(content);
    expect(result.nodes.filter((n) => n.isContainer)).toHaveLength(2);
    expect(result.nodes).toHaveLength(4);
  });

  it('handles cross-group edges', () => {
    const content = [
      '[Group A]',
      '  Page A',
      '    -link-> Page B',
      '[Group B]',
      '  Page B',
    ].join('\n');
    const { layout: result } = layout(content);
    const links = result.edges.filter((e) => e.kind === 'link');
    expect(links).toHaveLength(1);
    expect(links[0].points.length).toBeGreaterThanOrEqual(2);
  });

  it('handles full baseball tickets sample without overlap', () => {
    const content = [
      'sitemap Grand Slam Tickets',
      'direction-tb',
      '',
      'tag Auth',
      '  Public green',
      '  Required blue',
      '',
      'Home',
      '  Auth: Public',
      '  -browse-> Game Schedule',
      '  -search-> Search',
      '',
      '[Browse & Discovery]',
      '  Game Schedule',
      '    Auth: Public',
      '    -select game-> Game Detail',
      '  Search',
      '    Auth: Public',
      '    -results-> Game Detail',
      '  Game Detail',
      '    Auth: Public',
      '    -buy tickets-> Seat Picker',
      '',
      '[Purchase Flow]',
      '  Seat Picker',
      '    Auth: Public',
      '    -select seats-> Cart',
      '  Cart',
      '    Auth: Public',
      '    -checkout-> Login',
      '',
      '[Account]',
      '  Login',
      '    Auth: Public',
      '    -success-> My Account',
      '  My Account',
      '    Auth: Required',
    ].join('\n');

    const parsed = parseSitemap(content);
    expect(parsed.error).toBeNull();
    const result = layoutSitemap(parsed);

    // Pages plus one section node per group; written arrows are links.
    expect(result.nodes.filter((n) => !n.isContainer)).toHaveLength(8);
    expect(result.nodes.filter((n) => n.isContainer)).toHaveLength(3);
    expect(
      result.edges.filter((e) => e.kind === 'link').length
    ).toBeGreaterThanOrEqual(6);
    expectNoOverlap(result.nodes);

    // Total dimensions should be reasonable
    expect(result.width).toBeGreaterThan(200);
    expect(result.height).toBeGreaterThan(200);
  });
});

// The legend row can out-measure the tree — a one-page sitemap with several
// tag groups does it. The box grew to fit the legend and the tree stayed where
// it was, so renderers (which centre the BOX in the canvas) drew the pages off
// to the left by half the surplus. Same defect as the org chart's, filed as
// the off-centre focused org chart (#311).
describe('sitemap: a legend wider than the tree keeps the tree centred', () => {
  const MARGIN = 40;

  const WIDE_LEGEND = `sitemap Tiny Site

tag Access Level as al
  Public
tag Payment Method as pm
  Card
tag Editorial Owner as eo
  Desk
tag Review Cadence as rc
  Weekly

Home al: Public, pm: Card, eo: Desk, rc: Weekly`;

  it('centres the page under a wider legend', () => {
    const layout = layoutSitemap(parseSitemap(WIDE_LEGEND));

    let minX = Infinity;
    let maxX = -Infinity;
    for (const n of layout.nodes) {
      minX = Math.min(minX, n.x - n.width / 2);
      maxX = Math.max(maxX, n.x + n.width / 2);
    }

    // Guard: the legend really is the wider of the two here.
    expect(layout.width).toBeGreaterThan(maxX - minX + MARGIN * 2 + 1);
    expect(minX).toBeCloseTo(layout.width - maxX, 5);
  });
});

describe('sitemap page tree (#1861)', () => {
  const byLabel = (r: ReturnType<typeof layoutSitemap>, label: string) =>
    r.nodes.find((n) => n.label === label)!;

  it('top-level groups hang under the first top-level page', () => {
    const { layout: r } = layout(
      ['Home', '', '[Browse]', '  Games', '', '[Account]', '  Login'].join('\n')
    );
    const home = byLabel(r, 'Home');
    const tree = r.edges.filter((e) => e.kind === 'tree');
    for (const g of ['Browse', 'Account']) {
      const section = byLabel(r, g);
      expect(section.isContainer).toBe(true);
      expect(section.y).toBeGreaterThan(home.y + home.height);
      expect(
        tree.some((e) => e.sourceId === home.id && e.targetId === section.id)
      ).toBe(true);
    }
  });

  it('a later top-level page starts its own tree beside the first', () => {
    const { layout: r } = layout('Home\n  About\nHelp\n  FAQ');
    const home = byLabel(r, 'Home');
    const help = byLabel(r, 'Help');
    expect(help.y).toBe(home.y);
    expect(help.x).toBeGreaterThan(home.x);
    expect(
      r.edges.some((e) => e.sourceId === home.id && e.targetId === help.id)
    ).toBe(false);
  });

  it('with no top-level page, groups stand side by side', () => {
    const { layout: r } = layout('[A]\n  One\n[B]\n  Two');
    expect(byLabel(r, 'A').y).toBe(byLabel(r, 'B').y);
  });

  it('written arrows never move a card', () => {
    const plain = layout('Home\n  About\n  Blog\n    Post').layout;
    const linked = layout(
      'Home\n  -x-> Post\n  About\n    -y-> Home\n  Blog\n    Post'
    ).layout;
    const pos = (r: typeof plain) =>
      r.nodes.map((n) => [n.label, n.x, n.y]).sort();
    expect(pos(linked)).toEqual(pos(plain));
  });

  it('a steps group draws its pages as a numbered row joined by step arrows', () => {
    const { layout: r } = layout(
      [
        'Home',
        '[Checkout] steps',
        '  Cart',
        '  Pay',
        '  Done',
        '    -back-> Cart',
      ].join('\n')
    );
    const steps = ['Cart', 'Pay', 'Done'].map((l) => byLabel(r, l));
    expect(steps.map((n) => n.step)).toEqual([1, 2, 3]);
    expect(new Set(steps.map((n) => n.y)).size).toBe(1);
    expect(steps[0]!.x).toBeLessThan(steps[1]!.x);
    expect(steps[1]!.x).toBeLessThan(steps[2]!.x);
    const stepEdges = r.edges.filter((e) => e.kind === 'step');
    expect(stepEdges.map((e) => [e.sourceId, e.targetId])).toEqual([
      [steps[0]!.id, steps[1]!.id],
      [steps[1]!.id, steps[2]!.id],
    ]);
    // The written back arrow stays a link.
    expect(r.edges.filter((e) => e.kind === 'link')).toHaveLength(1);
  });

  it('direction-lr lays the tree on its side', () => {
    const { layout: r } = layout(
      'sitemap\ndirection-lr\nHome\n  About\n  Blog'
    );
    const home = byLabel(r, 'Home');
    for (const l of ['About', 'Blog'])
      expect(byLabel(r, l).x - byLabel(r, l).width / 2).toBeGreaterThan(
        home.x + home.width / 2
      );
    expectNoOverlap(r.nodes);
  });

  it('a collapsed group is a leaf section node carrying its hidden count', () => {
    const parsed = parseSitemap(
      [
        'Home',
        '  -go-> [Account]',
        '[Account] collapsed',
        '  Login',
        '  Profile',
      ].join('\n')
    );
    const { parsed: pruned, hiddenCounts } = collapseSitemapTree(
      parsed,
      unionCollapsedSitemapNodes(parsed)
    );
    const r = layoutSitemap(pruned, hiddenCounts);
    const account = byLabel(r, 'Account');
    expect(account.hiddenCount).toBe(2);
    expect(r.nodes.some((n) => n.label === 'Login')).toBe(false);
    const link = r.edges.find((e) => e.kind === 'link')!;
    expect(link.targetId).toBe(account.id);
  });
});

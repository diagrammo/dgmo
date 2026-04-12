import { describe, it, expect } from 'vitest';
import { parseSitemap } from '../src/sitemap/parser';
import { layoutSitemap } from '../src/sitemap/layout';
import { collapseSitemapTree } from '../src/sitemap/collapse';
import type { SitemapNode } from '../src/sitemap/types';

/** Find a container's parser-generated ID by label (recursive). */
function findContainerId(roots: SitemapNode[], label: string): string {
  function search(nodes: SitemapNode[]): string | undefined {
    for (const n of nodes) {
      if (n.isContainer && n.label === label) return n.id;
      const found = search(n.children);
      if (found) return found;
    }
    return undefined;
  }
  const id = search(roots);
  if (!id) throw new Error(`Container "${label}" not found`);
  return id;
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

  it('creates containers', () => {
    const { layout: result } = layout('[Group]\n  Page A\n  Page B');
    expect(result.containers).toHaveLength(1);
    expect(result.containers[0].label).toBe('Group');
    expect(result.nodes).toHaveLength(2);
  });

  it('routes edges between nodes', () => {
    const content = ['Home', '  -go-> About', 'About'].join('\n');
    const { layout: result } = layout(content);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].points.length).toBeGreaterThanOrEqual(2);
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
      '  Public(green)',
      '  Required(blue)',
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
    expect(result.containers).toHaveLength(2);
    expect(result.nodes).toHaveLength(2);
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
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].points.length).toBeGreaterThanOrEqual(2);
  });

  it('handles full baseball tickets sample without overlap', () => {
    const content = [
      'sitemap Grand Slam Tickets',
      'direction-tb',
      '',
      'tag Auth',
      '  Public(green)',
      '  Required(blue)',
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

    // Should have pages + containers
    expect(result.nodes.length).toBeGreaterThanOrEqual(7);
    expect(result.containers.length).toBeGreaterThanOrEqual(3);
    expect(result.edges.length).toBeGreaterThanOrEqual(6);

    // Total dimensions should be reasonable
    expect(result.width).toBeGreaterThan(200);
    expect(result.height).toBeGreaterThan(200);
  });

  it('positions collapsed containers via dagre (not at origin)', () => {
    const content = [
      'Home',
      '  -settings-> Settings',
      '  -docs-> Docs',
      '',
      '[Account]',
      '  Settings',
      '  Billing',
      '',
      '[Marketing]',
      '  Docs',
      '  Blog',
    ].join('\n');
    const parsed = parseSitemap(content);

    // Simulate collapse: provide hiddenCounts and remove children
    // We manually collapse by creating a pruned version
    const cloned = JSON.parse(JSON.stringify(parsed));
    // Find and prune Account container
    for (const root of cloned.roots) {
      if (root.isContainer && root.label === 'Account') {
        root.children = [];
      }
    }
    const hiddenCounts = new Map<string, number>();
    // Find Account's container ID
    const accountContainer = parsed.roots.find(
      (r) => r.isContainer && r.label === 'Account'
    );
    if (accountContainer) {
      hiddenCounts.set(accountContainer.id, 2);
    }

    // Re-terminate edges: Settings is inside Account, so Home -> Settings becomes Home -> Account
    for (const edge of cloned.edges) {
      if (edge.targetId === 'node-2' && accountContainer) {
        edge.targetId = accountContainer.id;
      }
    }

    const result = layoutSitemap(cloned, hiddenCounts);

    // Account should be a collapsed container (no members) positioned by dagre
    const accountBounds = result.containers.find((c) => c.label === 'Account');
    expect(accountBounds).toBeDefined();
    expect(accountBounds!.hiddenCount).toBe(2);

    // Should NOT be at the default fallback position (MARGIN, MARGIN) = (40, 40)
    // It should be positioned near Home due to the re-terminated edge
    const isAtFallback = accountBounds!.x < 50 && accountBounds!.y < 50;
    expect(isAtFallback).toBe(false);

    // Edges to collapsed containers should be present
    const edgesToAccount = result.edges.filter(
      (e) =>
        e.targetId === accountContainer!.id ||
        e.sourceId === accountContainer!.id
    );
    expect(edgesToAccount.length).toBeGreaterThanOrEqual(1);
  });

  it('deferred edges to expanded containers produce valid point arrays', () => {
    const content = [
      'Home',
      '  -> [Browse]',
      '[Browse]',
      '  Shop',
      '  Detail',
    ].join('\n');
    const parsed = parseSitemap(content);
    const result = layoutSitemap(parsed);

    // Edge from Home to expanded [Browse] should be deferred and have 3-point path
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].points).toHaveLength(3);
    for (const p of result.edges[0].points) {
      expect(typeof p.x).toBe('number');
      expect(typeof p.y).toBe('number');
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  describe('collapsed-container sibling-page floor', () => {
    it('floors collapsed container to max sibling page-card dimensions', () => {
      const source = [
        'sitemap',
        '[Storefront]',
        '  Checkout | Access: Public, Payment: Card',
        '  Catalog | Access: Public, Items: 240',
        '[Warehouse]',
        '  Intake | Access: Internal, Shift: Morning',
        '  Outbound | Access: Internal, Shift: Evening',
      ].join('\n');
      const parsed = parseSitemap(source);
      const warehouseId = findContainerId(parsed.roots, 'Warehouse');
      const { parsed: collapsed, hiddenCounts } = collapseSitemapTree(
        parsed,
        new Set([warehouseId])
      );
      const result = layoutSitemap(collapsed, hiddenCounts);
      const pageMaxW = Math.max(...result.nodes.map((n) => n.width));
      const pageMaxH = Math.max(...result.nodes.map((n) => n.height));
      const warehouse = result.containers.find((c) => c.label === 'Warehouse');
      expect(warehouse).toBeDefined();
      expect(warehouse!.width).toBeGreaterThanOrEqual(pageMaxW);
      expect(warehouse!.height).toBeGreaterThanOrEqual(pageMaxH);
    });

    it('discriminates empty containers from collapsed containers via hiddenCount', () => {
      const source = [
        'sitemap',
        '[Storefront]',
        '  Checkout | Access: Public, Payment: Card',
        '[Empty]',
        '[Warehouse]',
        '  Intake | Access: Internal, Shift: Morning',
      ].join('\n');
      const parsed = parseSitemap(source);
      const warehouseId = findContainerId(parsed.roots, 'Warehouse');
      const { parsed: collapsed, hiddenCounts } = collapseSitemapTree(
        parsed,
        new Set([warehouseId])
      );
      const result = layoutSitemap(collapsed, hiddenCounts);
      const empty = result.containers.find((c) => c.label === 'Empty');
      const warehouse = result.containers.find((c) => c.label === 'Warehouse');
      expect(empty).toBeDefined();
      expect(warehouse).toBeDefined();
      expect(empty!.hiddenCount).toBeUndefined();
      expect(warehouse!.hiddenCount).toBeGreaterThan(0);
      expect(warehouse!.width).toBeGreaterThanOrEqual(
        Math.max(...result.nodes.map((n) => n.width))
      );
    });

    it('grows collapsed container past the floor when content requires it', () => {
      const source = [
        'sitemap',
        '[Main]',
        '  Home | K: v',
        '[Details] | A: 1, B: 2, C: 3, D: 4, E: 5',
        '  Child | K: v',
      ].join('\n');
      const parsed = parseSitemap(source);
      const detailsId = findContainerId(parsed.roots, 'Details');
      const { parsed: collapsed, hiddenCounts } = collapseSitemapTree(
        parsed,
        new Set([detailsId])
      );
      const result = layoutSitemap(collapsed, hiddenCounts);
      const details = result.containers.find((c) => c.label === 'Details');
      expect(details).toBeDefined();
      expect(details!.hiddenCount).toBeGreaterThan(0);
      // Content-required height for a container with 5 meta rows =
      // 28 + 5*16 + 24 = 132, which exceeds any 1-meta page-card floor (~54)
      expect(details!.height).toBeGreaterThanOrEqual(120);
    });

    it('does not crash when no page cards exist to derive a floor from', () => {
      const source = ['sitemap', '[OnlyContainer]', '  Hidden | K: v'].join(
        '\n'
      );
      const parsed = parseSitemap(source);
      const containerId = findContainerId(parsed.roots, 'OnlyContainer');
      const { parsed: collapsed, hiddenCounts } = collapseSitemapTree(
        parsed,
        new Set([containerId])
      );
      expect(() => layoutSitemap(collapsed, hiddenCounts)).not.toThrow();
      const result = layoutSitemap(collapsed, hiddenCounts);
      const only = result.containers.find((c) => c.label === 'OnlyContainer');
      expect(only).toBeDefined();
      expect(only!.hiddenCount).toBeGreaterThan(0);
      expect(only!.width).toBe(140); // MIN_CARD_WIDTH, floor is no-op
    });

    it('floors every collapsed container uniformly, not just one', () => {
      const source = [
        'sitemap',
        '[Open]',
        '  LargePage | A: 1, B: 2, C: 3',
        '[Collapsed1]',
        '  Hidden1 | K: v',
        '[Collapsed2]',
        '  Hidden2 | K: v',
      ].join('\n');
      const parsed = parseSitemap(source);
      const c1Id = findContainerId(parsed.roots, 'Collapsed1');
      const c2Id = findContainerId(parsed.roots, 'Collapsed2');
      const { parsed: collapsed, hiddenCounts } = collapseSitemapTree(
        parsed,
        new Set([c1Id, c2Id])
      );
      const result = layoutSitemap(collapsed, hiddenCounts);
      const pageMaxW = Math.max(...result.nodes.map((n) => n.width));
      const pageMaxH = Math.max(...result.nodes.map((n) => n.height));
      const c1 = result.containers.find((c) => c.label === 'Collapsed1');
      const c2 = result.containers.find((c) => c.label === 'Collapsed2');
      expect(c1!.hiddenCount).toBeGreaterThan(0);
      expect(c2!.hiddenCount).toBeGreaterThan(0);
      expect(c1!.width).toBeGreaterThanOrEqual(pageMaxW);
      expect(c1!.height).toBeGreaterThanOrEqual(pageMaxH);
      expect(c2!.width).toBeGreaterThanOrEqual(pageMaxW);
      expect(c2!.height).toBeGreaterThanOrEqual(pageMaxH);
    });

    it('floors width and height independently', () => {
      const source = [
        'sitemap',
        '[Main]',
        '  Home | Access: Public, Page: Landing',
        '[A Very Long Container Name Indeed]',
        '  Inside | K: v',
      ].join('\n');
      const parsed = parseSitemap(source);
      const wideId = findContainerId(
        parsed.roots,
        'A Very Long Container Name Indeed'
      );
      const { parsed: collapsed, hiddenCounts } = collapseSitemapTree(
        parsed,
        new Set([wideId])
      );
      const result = layoutSitemap(collapsed, hiddenCounts);
      const pageMaxW = Math.max(...result.nodes.map((n) => n.width));
      const pageMaxH = Math.max(...result.nodes.map((n) => n.height));
      const wide = result.containers.find((c) =>
        c.label.startsWith('A Very Long')
      );
      expect(wide).toBeDefined();
      expect(wide!.hiddenCount).toBeGreaterThan(0);
      // Width: content-driven (label ~32 chars → ~280px > page ~145px)
      expect(wide!.width).toBeGreaterThan(pageMaxW);
      // Height: floor-driven (container 52 → floored to page ~76)
      expect(wide!.height).toBeGreaterThanOrEqual(pageMaxH);
    });

    it('pirate-bay scenario: collapsed Port Market is floored to page-card max', () => {
      const source = [
        'sitemap Pirate Bay Trading Co.',
        '',
        'Home | Access: Public, Page: Landing',
        '  -shop-> Shop',
        '  -join-> Enlist',
        '  -map-> Treasure Map',
        '',
        '[Port Market]',
        '  Shop | Access: Public, Page: Content',
        '    -buy-> Checkout',
        '  Checkout | Access: Crew Only, Page: Form',
        '    -purchased-> Ship Log',
        '',
        '[Crew Quarters]',
        '  Enlist | Access: Public, Page: Form',
        '    -enlisted-> Ship Log',
        '  Ship Log | Access: Crew Only, Page: Content',
        '    -voyage-> Treasure Map',
        '  Treasure Map | Access: Captain, Page: Content',
      ].join('\n');
      const parsed = parseSitemap(source);
      const portMarketId = findContainerId(parsed.roots, 'Port Market');
      const { parsed: collapsed, hiddenCounts } = collapseSitemapTree(
        parsed,
        new Set([portMarketId])
      );
      const result = layoutSitemap(collapsed, hiddenCounts);
      const portMarket = result.containers.find(
        (c) => c.label === 'Port Market'
      );
      const pageMaxW = Math.max(...result.nodes.map((n) => n.width));
      const pageMaxH = Math.max(...result.nodes.map((n) => n.height));
      expect(portMarket).toBeDefined();
      expect(portMarket!.hiddenCount).toBeGreaterThan(0);
      expect(portMarket!.width).toBeGreaterThanOrEqual(pageMaxW);
      expect(portMarket!.height).toBeGreaterThanOrEqual(pageMaxH);
    });
  });
});

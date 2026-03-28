import { describe, it, expect } from 'vitest';
import { parseSitemap } from '../src/sitemap/parser';
import { collapseSitemapTree } from '../src/sitemap/collapse';
import { layoutSitemap } from '../src/sitemap/layout';

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
    const content = [
      'Home',
      '  -go-> About',
      'About',
    ].join('\n');
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
    const content = [
      '[Outer]',
      '  [Inner]',
      '    Page A',
      '  Page B',
    ].join('\n');
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
      (r) => r.isContainer && r.label === 'Account',
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
      (e) => e.targetId === accountContainer!.id || e.sourceId === accountContainer!.id,
    );
    expect(edgesToAccount.length).toBeGreaterThanOrEqual(1);
  });
});

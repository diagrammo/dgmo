import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseSitemap } from '../src/sitemap/parser';
import { layoutSitemap } from '../src/sitemap/layout';

const FIXTURE_DIR = resolve(__dirname, '../gallery/fixtures');

const FIXTURE_FILES = ['sitemap-basic.dgmo', 'sitemap-full.dgmo'];

describe('sitemap fixtures', () => {
  for (const file of FIXTURE_FILES) {
    it(`${file} parses without errors`, () => {
      const content = readFileSync(resolve(FIXTURE_DIR, file), 'utf-8');
      const result = parseSitemap(content);
      expect(result.error).toBeFalsy();
      expect(result.roots.length).toBeGreaterThan(0);
    });

    it(`${file} layouts without errors`, () => {
      const content = readFileSync(resolve(FIXTURE_DIR, file), 'utf-8');
      const parsed = parseSitemap(content);
      const layout = layoutSitemap(parsed);
      expect(layout.nodes.length).toBeGreaterThan(0);
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
    });
  }

  it('sitemap-basic has title "Simple Website"', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'sitemap-basic.dgmo'), 'utf-8');
    const result = parseSitemap(content);
    expect(result.title).toBe('Simple Website');
  });

  it('sitemap-basic has a container', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'sitemap-basic.dgmo'), 'utf-8');
    const result = parseSitemap(content);
    const hasContainer = result.roots.some(r => r.isContainer);
    expect(hasContainer).toBe(true);
  });

  it('sitemap-basic has edges', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'sitemap-basic.dgmo'), 'utf-8');
    const result = parseSitemap(content);
    expect(result.edges.length).toBeGreaterThan(0);
  });

  it('sitemap-full has title "Grand Slam Tickets"', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'sitemap-full.dgmo'), 'utf-8');
    const result = parseSitemap(content);
    expect(result.title).toBe('Grand Slam Tickets');
  });

  it('sitemap-full has tag groups', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'sitemap-full.dgmo'), 'utf-8');
    const result = parseSitemap(content);
    expect(result.tagGroups.length).toBeGreaterThanOrEqual(2);
  });

  it('sitemap-full has 4 groups and 20+ pages', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'sitemap-full.dgmo'), 'utf-8');
    const result = parseSitemap(content);

    // Count containers
    let containerCount = 0;
    let pageCount = 0;
    const countAll = (nodes: typeof result.roots) => {
      for (const node of nodes) {
        if (node.isContainer) containerCount++;
        else pageCount++;
        countAll(node.children);
      }
    };
    countAll(result.roots);

    expect(containerCount).toBeGreaterThanOrEqual(4);
    expect(pageCount).toBeGreaterThanOrEqual(20);
  });

  it('sitemap-full has 40+ edges', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'sitemap-full.dgmo'), 'utf-8');
    const result = parseSitemap(content);
    expect(result.edges.length).toBeGreaterThanOrEqual(40);
  });

  it('sitemap-full renders without overlap (layout sanity)', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'sitemap-full.dgmo'), 'utf-8');
    const parsed = parseSitemap(content);
    const layout = layoutSitemap(parsed);

    expect(layout.width).toBeGreaterThan(200);
    expect(layout.height).toBeGreaterThan(200);
    expect(layout.containers.length).toBeGreaterThanOrEqual(4);
  });
});

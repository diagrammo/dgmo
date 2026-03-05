import { describe, it, expect } from 'vitest';
import { parseSitemap } from '../src/sitemap/parser';
import { collapseSitemapTree } from '../src/sitemap/collapse';

function makeSitemap(content: string) {
  return parseSitemap(content);
}

describe('collapseSitemapTree', () => {
  it('returns original when no nodes collapsed', () => {
    const parsed = makeSitemap('Home\n  About');
    const { parsed: result, hiddenCounts } = collapseSitemapTree(parsed, new Set());
    expect(result).toBe(parsed); // same reference
    expect(hiddenCounts.size).toBe(0);
  });

  it('prunes children of collapsed node', () => {
    const content = [
      '[Group]',
      '  Page A',
      '  Page B',
    ].join('\n');
    const parsed = makeSitemap(content);
    const containerId = parsed.roots[0].id;

    const { parsed: result, hiddenCounts } = collapseSitemapTree(parsed, new Set([containerId]));
    expect(result.roots[0].children).toHaveLength(0);
    expect(hiddenCounts.get(containerId)).toBe(2);
  });

  it('does not mutate original', () => {
    const content = '[Group]\n  Page A\n  Page B';
    const parsed = makeSitemap(content);
    const containerId = parsed.roots[0].id;

    collapseSitemapTree(parsed, new Set([containerId]));
    expect(parsed.roots[0].children).toHaveLength(2);
  });

  it('re-terminates arrow to collapsed group', () => {
    const content = [
      'Home',
      '  -go-> Page A',
      '[Group]',
      '  Page A',
      '  Page B',
    ].join('\n');
    const parsed = makeSitemap(content);
    const containerId = parsed.roots[1].id; // [Group]

    const { parsed: result } = collapseSitemapTree(parsed, new Set([containerId]));
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].targetId).toBe(containerId);
  });

  it('re-terminates arrow from collapsed group', () => {
    const content = [
      '[Group]',
      '  Page A',
      '    -go-> Home',
      'Home',
    ].join('\n');
    const parsed = makeSitemap(content);
    const containerId = parsed.roots[0].id;

    const { parsed: result } = collapseSitemapTree(parsed, new Set([containerId]));
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].sourceId).toBe(containerId);
  });

  it('removes intra-group arrows when group collapsed', () => {
    const content = [
      '[Group]',
      '  Page A',
      '    -go-> Page B',
      '  Page B',
    ].join('\n');
    const parsed = makeSitemap(content);
    const containerId = parsed.roots[0].id;

    const { parsed: result } = collapseSitemapTree(parsed, new Set([containerId]));
    // Both source and target re-terminate to same group → self-loop → removed
    expect(result.edges).toHaveLength(0);
  });

  it('deduplicates edges after re-termination', () => {
    const content = [
      'Home',
      '  -a-> Page A',
      '  -b-> Page B',
      '[Group]',
      '  Page A',
      '  Page B',
    ].join('\n');
    const parsed = makeSitemap(content);
    const containerId = parsed.roots[1].id;

    const { parsed: result } = collapseSitemapTree(parsed, new Set([containerId]));
    // Both arrows re-terminate to [Group] → same source→target pair → dedup to 1
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].targetId).toBe(containerId);
  });

  it('handles nested collapse — terminates at outermost visible boundary', () => {
    const content = [
      'Home',
      '  -go-> Deep Page',
      '[Outer]',
      '  [Inner]',
      '    Deep Page',
    ].join('\n');
    const parsed = makeSitemap(content);
    const outerId = parsed.roots[1].id;

    const { parsed: result } = collapseSitemapTree(parsed, new Set([outerId]));
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].targetId).toBe(outerId);
  });
});

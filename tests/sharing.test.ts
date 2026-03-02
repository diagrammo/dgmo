import { describe, it, expect } from 'vitest';
import { encodeDiagramUrl, decodeDiagramUrl } from '../src/sharing';

describe('encodeDiagramUrl / decodeDiagramUrl', () => {
  const samples = [
    { name: 'pie chart', dsl: 'chart: pie\nA: 10\nB: 20\nC: 30' },
    { name: 'sequence diagram', dsl: 'chart: sequence\nA -hello-> B\nB -world-> A' },
    { name: 'bar chart', dsl: 'chart: bar\nApples: 40\nOranges: 25\nBananas: 60' },
    { name: 'unicode content', dsl: 'chart: pie\n日本語: 10\nEmoji 🎉: 20\nÜmlaut: 30' },
    { name: 'long lines', dsl: 'chart: sequence\n' + 'A -' + 'x'.repeat(500) + '-> B' },
    { name: 'empty DSL', dsl: '' },
  ];

  for (const { name, dsl } of samples) {
    it(`round-trips ${name}`, () => {
      const result = encodeDiagramUrl(dsl);
      if (result.error) {
        throw new Error(`Unexpected error for ${name}: ${result.error}`);
      }
      const query = new URL(result.url).search;
      expect(decodeDiagramUrl(query).dsl).toBe(dsl);
    });
  }

  it('uses the default base URL with both query and hash', () => {
    const result = encodeDiagramUrl('chart: pie\nA: 10');
    if (result.error) throw new Error('unexpected error');
    expect(result.url).toMatch(/^https:\/\/diagrammo\.app\/view\?dgmo=.+#dgmo=/);
  });

  it('accepts a custom base URL', () => {
    const result = encodeDiagramUrl('chart: pie\nA: 10', {
      baseUrl: 'https://example.com/playground',
    });
    if (result.error) throw new Error('unexpected error');
    expect(result.url).toMatch(/^https:\/\/example\.com\/playground\?dgmo=.+#dgmo=/);
  });

  it('decodes from hash when query is stripped', () => {
    const result = encodeDiagramUrl('chart: pie\nA: 10');
    if (result.error) throw new Error('unexpected error');
    const hash = new URL(result.url).hash;
    expect(decodeDiagramUrl(hash).dsl).toBe('chart: pie\nA: 10');
  });

  describe('size limit enforcement', () => {
    it('rejects payloads exceeding 8 KB compressed', () => {
      // Generate a large payload that compresses to > 8 KB
      // Random-ish data compresses poorly — use unique lines
      const lines = Array.from({ length: 2000 }, (_, i) => `item_${i}_${Math.random()}: ${i}`);
      const largeDsl = 'chart: bar\n' + lines.join('\n');

      const result = encodeDiagramUrl(largeDsl);
      expect(result.error).toBe('too-large');
      if (result.error === 'too-large') {
        expect(result.compressedSize).toBeGreaterThan(8192);
        expect(result.limit).toBe(8192);
      }
    });
  });

  describe('decodeDiagramUrl edge cases', () => {
    it('handles query with ? prefix', () => {
      const result = encodeDiagramUrl('chart: pie\nA: 10');
      if (result.error) throw new Error('unexpected error');
      const query = new URL(result.url).search; // includes ?
      expect(decodeDiagramUrl(query).dsl).toBe('chart: pie\nA: 10');
    });

    it('handles query without ? prefix', () => {
      const result = encodeDiagramUrl('chart: pie\nA: 10');
      if (result.error) throw new Error('unexpected error');
      const query = new URL(result.url).search.slice(1); // strip ?
      expect(decodeDiagramUrl(query).dsl).toBe('chart: pie\nA: 10');
    });

    it('handles bare payload (no dgmo= prefix)', () => {
      const result = encodeDiagramUrl('chart: pie\nA: 10');
      if (result.error) throw new Error('unexpected error');
      const payload = new URL(result.url).search.replace('?dgmo=', '');
      expect(decodeDiagramUrl(payload).dsl).toBe('chart: pie\nA: 10');
    });

    it('backwards compat: handles hash with # prefix', () => {
      const result = encodeDiagramUrl('chart: pie\nA: 10');
      if (result.error) throw new Error('unexpected error');
      // Simulate old-style URL with hash fragment
      const query = new URL(result.url).search.slice(1); // dgmo=...
      expect(decodeDiagramUrl(`#${query}`).dsl).toBe('chart: pie\nA: 10');
    });

    it('returns empty dsl for invalid payload', () => {
      expect(decodeDiagramUrl('not-valid-lz-data!!!')).toEqual({
        dsl: '',
        viewState: {},
      });
    });

    it('returns empty dsl for empty input', () => {
      expect(decodeDiagramUrl('')).toEqual({ dsl: '', viewState: {} });
    });

    it('returns empty dsl for just #', () => {
      expect(decodeDiagramUrl('#')).toEqual({ dsl: '', viewState: {} });
    });

    it('returns empty dsl for just #dgmo=', () => {
      expect(decodeDiagramUrl('#dgmo=')).toEqual({ dsl: '', viewState: {} });
    });
  });

  describe('view state (activeTagGroup)', () => {
    it('round-trips with activeTagGroup', () => {
      const dsl = 'chart: org\nCEO\n  VP Engineering';
      const result = encodeDiagramUrl(dsl, {
        viewState: { activeTagGroup: 'Location' },
      });
      if (result.error) throw new Error('unexpected error');
      expect(result.url).toContain('&tag=Location');
      const query = new URL(result.url).search;
      const decoded = decodeDiagramUrl(query);
      expect(decoded.dsl).toBe(dsl);
      expect(decoded.viewState.activeTagGroup).toBe('Location');
    });

    it('URL-encodes unsafe characters in tag name', () => {
      const dsl = 'chart: org\nCEO';
      const result = encodeDiagramUrl(dsl, {
        viewState: { activeTagGroup: 'Team & Role' },
      });
      if (result.error) throw new Error('unexpected error');
      expect(result.url).toContain('&tag=Team%20%26%20Role');
      const query = new URL(result.url).search;
      const decoded = decodeDiagramUrl(query);
      expect(decoded.viewState.activeTagGroup).toBe('Team & Role');
    });

    it('omits tag param when activeTagGroup is undefined', () => {
      const result = encodeDiagramUrl('chart: org\nCEO', { viewState: {} });
      if (result.error) throw new Error('unexpected error');
      expect(result.url).not.toContain('&tag=');
    });

    it('omits tag param when viewState is not provided', () => {
      const result = encodeDiagramUrl('chart: org\nCEO');
      if (result.error) throw new Error('unexpected error');
      expect(result.url).not.toContain('&tag=');
    });

    it('returns empty viewState when no tag param present', () => {
      const result = encodeDiagramUrl('chart: org\nCEO');
      if (result.error) throw new Error('unexpected error');
      const query = new URL(result.url).search;
      const decoded = decodeDiagramUrl(query);
      expect(decoded.viewState).toEqual({});
    });

    it('handles hash with tag but no dgmo prefix gracefully', () => {
      // Bare payload shouldn't have &tag but decoder should still be robust
      const decoded = decodeDiagramUrl('#dgmo=&tag=Location');
      expect(decoded.dsl).toBe('');
      expect(decoded.viewState.activeTagGroup).toBe('Location');
    });
  });
});

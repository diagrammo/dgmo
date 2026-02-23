import { describe, it, expect } from 'vitest';
import { encodeDiagramUrl, decodeDiagramUrl } from '../src/sharing';

describe('encodeDiagramUrl / decodeDiagramUrl', () => {
  const samples = [
    { name: 'pie chart', dsl: 'chart: pie\nA: 10\nB: 20\nC: 30' },
    { name: 'sequence diagram', dsl: 'chart: sequence\nA -> B: hello\nB -> A: world' },
    { name: 'bar chart', dsl: 'chart: bar\nApples: 40\nOranges: 25\nBananas: 60' },
    { name: 'unicode content', dsl: 'chart: pie\n日本語: 10\nEmoji 🎉: 20\nÜmlaut: 30' },
    { name: 'long lines', dsl: 'chart: sequence\n' + 'A -> B: ' + 'x'.repeat(500) },
    { name: 'empty DSL', dsl: '' },
  ];

  for (const { name, dsl } of samples) {
    it(`round-trips ${name}`, () => {
      const result = encodeDiagramUrl(dsl);
      if (result.error) {
        throw new Error(`Unexpected error for ${name}: ${result.error}`);
      }
      const hash = new URL(result.url).hash;
      expect(decodeDiagramUrl(hash)).toBe(dsl);
    });
  }

  it('uses the default base URL', () => {
    const result = encodeDiagramUrl('chart: pie\nA: 10');
    if (result.error) throw new Error('unexpected error');
    expect(result.url).toMatch(/^https:\/\/diagrammo\.app\/view#dgmo=/);
  });

  it('accepts a custom base URL', () => {
    const result = encodeDiagramUrl('chart: pie\nA: 10', {
      baseUrl: 'https://example.com/playground',
    });
    if (result.error) throw new Error('unexpected error');
    expect(result.url).toMatch(/^https:\/\/example\.com\/playground#dgmo=/);
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
    it('handles hash with # prefix', () => {
      const result = encodeDiagramUrl('chart: pie\nA: 10');
      if (result.error) throw new Error('unexpected error');
      const hash = new URL(result.url).hash; // includes #
      expect(decodeDiagramUrl(hash)).toBe('chart: pie\nA: 10');
    });

    it('handles hash without # prefix', () => {
      const result = encodeDiagramUrl('chart: pie\nA: 10');
      if (result.error) throw new Error('unexpected error');
      const hash = new URL(result.url).hash.slice(1); // strip #
      expect(decodeDiagramUrl(hash)).toBe('chart: pie\nA: 10');
    });

    it('handles bare payload (no dgmo= prefix)', () => {
      const result = encodeDiagramUrl('chart: pie\nA: 10');
      if (result.error) throw new Error('unexpected error');
      const payload = new URL(result.url).hash.replace('#dgmo=', '');
      expect(decodeDiagramUrl(payload)).toBe('chart: pie\nA: 10');
    });

    it('returns empty string for invalid payload', () => {
      expect(decodeDiagramUrl('not-valid-lz-data!!!')).toBe('');
    });

    it('returns empty string for empty input', () => {
      expect(decodeDiagramUrl('')).toBe('');
    });

    it('returns empty string for just #', () => {
      expect(decodeDiagramUrl('#')).toBe('');
    });

    it('returns empty string for just #dgmo=', () => {
      expect(decodeDiagramUrl('#dgmo=')).toBe('');
    });
  });
});

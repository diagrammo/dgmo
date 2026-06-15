import { describe, it, expect } from 'vitest';
import { parseVisualization } from '../src/d3';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

const hasDataCommaError = (r: { diagnostics: { code?: string }[] }): boolean =>
  r.diagnostics.some((d) => d.code === 'E_DATA_COMMA_REMOVED');

describe('numeric separators in D3 charts', () => {
  describe('quadrant', () => {
    // 1.0 freeze: data-row value commas (separator AND thousands grouping) are
    // removed. They still parse best-effort so the diagram renders, but emit
    // E_DATA_COMMA_REMOVED. Underscore grouping (`1_000`) remains valid.
    it('thousands-comma coordinates error but parse best-effort', () => {
      const input = 'quadrant\nItem 1,000 2,000';
      const result = parseVisualization(input, palette);
      expect(hasDataCommaError(result)).toBe(true);
      expect(result.quadrantPoints).toHaveLength(1);
      expect(result.quadrantPoints[0]).toMatchObject({ x: 1000, y: 2000 });
    });

    it('comma x/y separator errors but parses best-effort', () => {
      const input = 'quadrant\nItem 0.9, 0.8';
      const result = parseVisualization(input, palette);
      expect(hasDataCommaError(result)).toBe(true);
      expect(result.quadrantPoints).toHaveLength(1);
      expect(result.quadrantPoints[0]).toMatchObject({ x: 0.9, y: 0.8 });
    });

    it('space-separated coordinates parse clean (canonical)', () => {
      const input = 'quadrant\nItem 0.9 0.8';
      const result = parseVisualization(input, palette);
      expect(hasDataCommaError(result)).toBe(false);
      expect(result.quadrantPoints).toHaveLength(1);
      expect(result.quadrantPoints[0]).toMatchObject({ x: 0.9, y: 0.8 });
    });

    it('accepts underscore-separated coordinates (still valid)', () => {
      const input = 'quadrant\nItem 1_000 2_000';
      const result = parseVisualization(input, palette);
      expect(hasDataCommaError(result)).toBe(false);
      expect(result.quadrantPoints).toHaveLength(1);
      expect(result.quadrantPoints[0]).toMatchObject({ x: 1000, y: 2000 });
    });

    it('negative thousands-comma coordinates error but parse best-effort', () => {
      const input = 'quadrant\nItem -1,000 2,000';
      const result = parseVisualization(input, palette);
      expect(hasDataCommaError(result)).toBe(true);
      expect(result.quadrantPoints).toHaveLength(1);
      expect(result.quadrantPoints[0]).toMatchObject({ x: -1000, y: 2000 });
    });
  });

  describe('slope', () => {
    it('thousands-comma values error but parse best-effort', () => {
      const input = 'slope\nperiod 2020 2021\nCategory 1,000 2,000';
      const result = parseVisualization(input, palette);
      expect(hasDataCommaError(result)).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].values).toEqual([1000, 2000]);
    });

    it('space-separated values parse clean (canonical)', () => {
      const input = 'slope\nperiod 2020 2021\nCategory 1000 2000';
      const result = parseVisualization(input, palette);
      expect(hasDataCommaError(result)).toBe(false);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].values).toEqual([1000, 2000]);
    });

    it('accepts underscore-separated values (still valid)', () => {
      const input = 'slope\nperiod 2020 2021\nCategory 1_000 2_000';
      const result = parseVisualization(input, palette);
      expect(hasDataCommaError(result)).toBe(false);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].values).toEqual([1000, 2000]);
    });
  });

  describe('arc', () => {
    it('thousands-comma weight errors but parses best-effort', () => {
      const input = 'arc\nA -> B 1,000';
      const result = parseVisualization(input, palette);
      expect(hasDataCommaError(result)).toBe(true);
      expect(result.links).toHaveLength(1);
      expect(result.links[0]).toMatchObject({
        source: 'A',
        target: 'B',
        value: 1000,
      });
    });

    it('accepts underscore-separated weight (still valid)', () => {
      const input = 'arc\nA -> B 1_000';
      const result = parseVisualization(input, palette);
      expect(hasDataCommaError(result)).toBe(false);
      expect(result.links).toHaveLength(1);
      expect(result.links[0]).toMatchObject({
        source: 'A',
        target: 'B',
        value: 1000,
      });
    });
  });

  describe('wordcloud', () => {
    it('thousands-comma weight errors but parses best-effort', () => {
      const input = 'wordcloud\nBigWord 1,000';
      const result = parseVisualization(input, palette);
      expect(hasDataCommaError(result)).toBe(true);
      expect(result.words).toHaveLength(1);
      expect(result.words[0]).toMatchObject({
        text: 'BigWord',
        weight: 1000,
      });
    });

    it('accepts underscore-separated weight (still valid)', () => {
      const input = 'wordcloud\nBigWord 1_000';
      const result = parseVisualization(input, palette);
      expect(hasDataCommaError(result)).toBe(false);
      expect(result.words).toHaveLength(1);
      expect(result.words[0]).toMatchObject({
        text: 'BigWord',
        weight: 1000,
      });
    });
  });
});

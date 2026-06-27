import { describe, it, expect } from 'vitest';
import { parseVisualization } from '../src/d3';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

describe('numeric separators in D3 charts', () => {
  describe('quadrant', () => {
    // Comma-grouped numbers (`1,000`) and the comma x/y separator still parse
    // best-effort so the diagram renders. Underscore grouping (`1_000`) is the
    // canonical form.
    it('thousands-comma coordinates parse best-effort', () => {
      const input = 'quadrant\nItem 1,000 2,000';
      const result = parseVisualization(input, palette);
      expect(result.quadrantPoints).toHaveLength(1);
      expect(result.quadrantPoints[0]).toMatchObject({ x: 1000, y: 2000 });
    });

    it('comma x/y separator parses best-effort', () => {
      const input = 'quadrant\nItem 0.9, 0.8';
      const result = parseVisualization(input, palette);
      expect(result.quadrantPoints).toHaveLength(1);
      expect(result.quadrantPoints[0]).toMatchObject({ x: 0.9, y: 0.8 });
    });

    it('space-separated coordinates parse clean (canonical)', () => {
      const input = 'quadrant\nItem 0.9 0.8';
      const result = parseVisualization(input, palette);
      expect(result.quadrantPoints).toHaveLength(1);
      expect(result.quadrantPoints[0]).toMatchObject({ x: 0.9, y: 0.8 });
    });

    it('accepts underscore-separated coordinates (canonical)', () => {
      const input = 'quadrant\nItem 1_000 2_000';
      const result = parseVisualization(input, palette);
      expect(result.quadrantPoints).toHaveLength(1);
      expect(result.quadrantPoints[0]).toMatchObject({ x: 1000, y: 2000 });
    });

    it('negative thousands-comma coordinates parse best-effort', () => {
      const input = 'quadrant\nItem -1,000 2,000';
      const result = parseVisualization(input, palette);
      expect(result.quadrantPoints).toHaveLength(1);
      expect(result.quadrantPoints[0]).toMatchObject({ x: -1000, y: 2000 });
    });
  });

  describe('slope', () => {
    it('thousands-comma values parse best-effort', () => {
      const input = 'slope\nperiod 2020 2021\nCategory 1,000 2,000';
      const result = parseVisualization(input, palette);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].values).toEqual([1000, 2000]);
    });

    it('space-separated values parse clean (canonical)', () => {
      const input = 'slope\nperiod 2020 2021\nCategory 1000 2000';
      const result = parseVisualization(input, palette);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].values).toEqual([1000, 2000]);
    });

    it('accepts underscore-separated values (canonical)', () => {
      const input = 'slope\nperiod 2020 2021\nCategory 1_000 2_000';
      const result = parseVisualization(input, palette);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].values).toEqual([1000, 2000]);
    });
  });

  describe('arc', () => {
    it('thousands-comma weight parses best-effort', () => {
      const input = 'arc\nA -> B 1,000';
      const result = parseVisualization(input, palette);
      expect(result.links).toHaveLength(1);
      expect(result.links[0]).toMatchObject({
        source: 'A',
        target: 'B',
        value: 1000,
      });
    });

    it('accepts underscore-separated weight (canonical)', () => {
      const input = 'arc\nA -> B 1_000';
      const result = parseVisualization(input, palette);
      expect(result.links).toHaveLength(1);
      expect(result.links[0]).toMatchObject({
        source: 'A',
        target: 'B',
        value: 1000,
      });
    });
  });

  describe('wordcloud', () => {
    it('thousands-comma weight parses best-effort', () => {
      const input = 'wordcloud\nBigWord 1,000';
      const result = parseVisualization(input, palette);
      expect(result.words).toHaveLength(1);
      expect(result.words[0]).toMatchObject({
        text: 'BigWord',
        weight: 1000,
      });
    });

    it('accepts underscore-separated weight (canonical)', () => {
      const input = 'wordcloud\nBigWord 1_000';
      const result = parseVisualization(input, palette);
      expect(result.words).toHaveLength(1);
      expect(result.words[0]).toMatchObject({
        text: 'BigWord',
        weight: 1000,
      });
    });
  });
});

import { describe, it, expect } from 'vitest';
import { parseVisualization } from '../src/d3';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

describe('numeric separators in D3 charts', () => {
  describe('quadrant', () => {
    it('accepts comma-grouped coordinates', () => {
      const input = 'quadrant\nItem 1,000 2,000';
      const result = parseVisualization(input, palette);
      expect(result.quadrantPoints).toHaveLength(1);
      expect(result.quadrantPoints[0]).toMatchObject({ x: 1000, y: 2000 });
    });

    it('accepts underscore-separated coordinates', () => {
      const input = 'quadrant\nItem 1_000 2_000';
      const result = parseVisualization(input, palette);
      expect(result.quadrantPoints).toHaveLength(1);
      expect(result.quadrantPoints[0]).toMatchObject({ x: 1000, y: 2000 });
    });

    it('accepts negative comma-grouped coordinates', () => {
      const input = 'quadrant\nItem -1,000 2,000';
      const result = parseVisualization(input, palette);
      expect(result.quadrantPoints).toHaveLength(1);
      expect(result.quadrantPoints[0]).toMatchObject({ x: -1000, y: 2000 });
    });
  });

  describe('slope', () => {
    it('accepts comma-grouped values', () => {
      const input = 'slope\nperiod 2020 2021\nCategory 1,000 2,000';
      const result = parseVisualization(input, palette);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].values).toEqual([1000, 2000]);
    });

    it('accepts underscore-separated values', () => {
      const input = 'slope\nperiod 2020 2021\nCategory 1_000 2_000';
      const result = parseVisualization(input, palette);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].values).toEqual([1000, 2000]);
    });
  });

  describe('arc', () => {
    it('accepts comma-grouped weight', () => {
      const input = 'arc\nA -> B 1,000';
      const result = parseVisualization(input, palette);
      expect(result.links).toHaveLength(1);
      expect(result.links[0]).toMatchObject({
        source: 'A',
        target: 'B',
        value: 1000,
      });
    });

    it('accepts underscore-separated weight', () => {
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
    it('accepts comma-grouped weight', () => {
      const input = 'wordcloud\nBigWord 1,000';
      const result = parseVisualization(input, palette);
      expect(result.words).toHaveLength(1);
      expect(result.words[0]).toMatchObject({
        text: 'BigWord',
        weight: 1000,
      });
    });

    it('accepts underscore-separated weight', () => {
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

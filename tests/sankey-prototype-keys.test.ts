import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3';
import { parseExtendedChart } from '../src/data-chart-parser';

// #1866: author-named node / category colours lived in a plain `{}`, so a
// node named `constructor` read an inherited function, skipped the palette
// fallback and made `mix()` throw.
const KEYS = [
  'constructor',
  'toString',
  '__proto__',
  'valueOf',
  'hasOwnProperty',
];

describe('sankey node named like an Object.prototype member', () => {
  for (const key of KEYS) {
    it(`renders a node named ${key} with a palette colour`, async () => {
      const src = `sankey Keys\n\nA red -> ${key} 5\n${key} -> B 3\n`;
      const svg = await renderDataChartD3(src, 'light');
      expect(svg).toContain(`data-emph-key="node:${key}"`);
      const parsed = parseExtendedChart(src);
      expect(parsed.error).toBeFalsy();
      expect(parsed.nodeColors?.[key]).toBeUndefined();
      expect(parsed.nodeColors?.A).toBeTypeOf('string');
    });
  }
});

describe('scatter category named like an Object.prototype member', () => {
  for (const key of KEYS) {
    it(`renders a category named ${key}`, async () => {
      const src = `scatter Keys\n\n[Other] red\nP1 1 2\n[${key}]\nP2 3 4\n`;
      await expect(renderDataChartD3(src, 'light')).resolves.toContain('<svg');
      const parsed = parseExtendedChart(src);
      expect(parsed.error).toBeFalsy();
      expect(parsed.categoryColors?.[key]).toBeUndefined();
      expect(parsed.categoryColors?.Other).toBeTypeOf('string');
      expect(parsed.categoryLineNumbers?.[key]).toBe(5);
    });
  }
});

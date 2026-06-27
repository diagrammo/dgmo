import { describe, it, expect } from 'vitest';
import { parseVisualization } from '../src/d3';
import { getPalette } from '../src/palettes';
import type { ParsedWordcloud } from '../src/visualizations/types';

const palette = getPalette('nord').light;

function parseWordcloudViz(src: string): ParsedWordcloud {
  const result = parseVisualization(src, palette);
  expect(result.type).toBe('wordcloud');
  return result as ParsedWordcloud;
}

function diagnostics(src: string) {
  return parseVisualization(src, palette).diagnostics;
}

describe('wordcloud parser', () => {
  it('parses type, title, and weighted words (multi-word labels)', () => {
    const r = parseWordcloudViz(
      [
        'wordcloud Tech Conference Topics',
        'Kubernetes 95',
        'Machine Learning 88',
        'AI Agents 90',
      ].join('\n')
    );
    expect(r.title).toBe('Tech Conference Topics');
    expect(r.words).toHaveLength(3);
    expect(r.words[0]).toMatchObject({ text: 'Kubernetes', weight: 95 });
    // Multi-word label keeps its spaces; trailing number is the weight.
    expect(r.words[1]).toMatchObject({ text: 'Machine Learning', weight: 88 });
    expect(r.words[2]).toMatchObject({ text: 'AI Agents', weight: 90 });
  });

  it('parses clean (no diagnostics) for canonical weights', () => {
    const errs = diagnostics('wordcloud T\nDocker 65\nRust 62').filter(
      (d) => d.severity === 'error'
    );
    expect(errs).toEqual([]);
  });

  it('parses comma-formatted weights best-effort (no error)', () => {
    const ds = diagnostics('wordcloud T\nKubernetes 1,200');
    expect(ds.some((d) => d.severity === 'error')).toBe(false);
  });
});

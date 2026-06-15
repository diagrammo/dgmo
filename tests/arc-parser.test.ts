import { describe, it, expect } from 'vitest';
import { parseVisualization } from '../src/d3';
import { getPalette } from '../src/palettes';
import type { ParsedArc } from '../src/visualizations/types';

const palette = getPalette('nord').light;

function parseArcViz(src: string): ParsedArc {
  const result = parseVisualization(src, palette);
  expect(result.type).toBe('arc');
  return result as ParsedArc;
}

function diagnostics(src: string) {
  return parseVisualization(src, palette).diagnostics;
}

describe('arc parser', () => {
  it('parses type, title, and weighted links', () => {
    const r = parseArcViz(
      [
        'arc Microservice Dependencies',
        'WebApp -> API Gateway 5',
        'API Gateway -> AuthService 4',
      ].join('\n')
    );
    expect(r.title).toBe('Microservice Dependencies');
    expect(r.links).toHaveLength(2);
    expect(r.links[0]).toMatchObject({
      source: 'WebApp',
      target: 'API Gateway',
      value: 5,
    });
    expect(r.links[1]).toMatchObject({
      source: 'API Gateway',
      target: 'AuthService',
      value: 4,
    });
  });

  it('groups nodes under [Group] sections', () => {
    const r = parseArcViz(
      [
        'arc T',
        'order group',
        '[Frontend]',
        '  WebApp -> API 5',
        '[Core]',
        '  API -> DB 4',
      ].join('\n')
    );
    expect(r.arcNodeGroups.length).toBeGreaterThanOrEqual(2);
    const names = r.arcNodeGroups.map((g) => g.name);
    expect(names).toContain('Frontend');
    expect(names).toContain('Core');
  });

  it('parses clean (no diagnostics) for a canonical link', () => {
    const errs = diagnostics('arc T\nA -> B 5').filter(
      (d) => d.severity === 'error'
    );
    expect(errs).toEqual([]);
  });

  it('rejects comma-formatted link weights at 1.0 (E_DATA_COMMA_REMOVED)', () => {
    const ds = diagnostics('arc T\nA -> B 1,500');
    expect(ds.some((d) => d.code === 'E_DATA_COMMA_REMOVED')).toBe(true);
  });
});

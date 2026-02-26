import { describe, it, expect } from 'vitest';
import { injectBranding } from '../src/branding';

// ============================================================
// injectBranding()
// ============================================================

const SVG_WITH_VIEWBOX = '<svg viewBox="0 0 400 300"><rect/></svg>';
const SVG_WITH_VIEWBOX_AND_HEIGHT =
  '<svg viewBox="0 0 400 300" width="400" height="300"><rect/></svg>';
const SVG_WITH_DIMENSIONS = '<svg width="600" height="200"><rect/></svg>';
const SVG_HEIGHT_ONLY = '<svg height="150"><rect/></svg>';
const SVG_NO_DIMENSIONS = '<svg><rect/></svg>';

describe('injectBranding()', () => {
  it('increases viewBox height by 20 and injects branding text', () => {
    const result = injectBranding(SVG_WITH_VIEWBOX, '#888');
    expect(result).toContain('viewBox="0 0 400 320"');
    expect(result).toContain('diagrammo.app');
    // Text positioned at bottom-right: x = 0+400-4 = 396, y = 0+300+20-6 = 314
    expect(result).toContain('x="396"');
    expect(result).toContain('y="314"');
  });

  it('updates both viewBox and height attribute when both present', () => {
    const result = injectBranding(SVG_WITH_VIEWBOX_AND_HEIGHT, '#888');
    expect(result).toContain('viewBox="0 0 400 320"');
    expect(result).toContain('height="320"');
    expect(result).toContain('diagrammo.app');
  });

  it('uses width/height fallback when no viewBox present', () => {
    const result = injectBranding(SVG_WITH_DIMENSIONS, '#888');
    expect(result).toContain('height="220"');
    // x = 600-4 = 596, y = 200+20-6 = 214
    expect(result).toContain('x="596"');
    expect(result).toContain('y="214"');
    expect(result).toContain('diagrammo.app');
  });

  it('defaults width to 800 when only height is present', () => {
    const result = injectBranding(SVG_HEIGHT_ONLY, '#888');
    expect(result).toContain('height="170"');
    // x = 800-4 = 796
    expect(result).toContain('x="796"');
  });

  it('returns empty/falsy input unchanged', () => {
    expect(injectBranding('', '#888')).toBe('');
  });

  it('returns SVG unchanged when no dimensions found', () => {
    const result = injectBranding(SVG_NO_DIMENSIONS, '#888');
    expect(result).toBe(SVG_NO_DIMENSIONS);
  });

  it('output contains "diagrammo.app" text', () => {
    const result = injectBranding(SVG_WITH_VIEWBOX, '#888');
    expect(result).toContain('>diagrammo.app</text>');
  });

  it('uses the provided mutedColor for fill', () => {
    const result = injectBranding(SVG_WITH_VIEWBOX, '#abcdef');
    expect(result).toContain('fill="#abcdef"');
  });
});

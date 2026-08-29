import { describe, expect, it } from 'vitest';

import * as advanced from '../src/advanced';
import { SKETCH_VISUALS } from '../src/sketch/visuals';
import { TITLE_FONT_WEIGHT } from '../src/utils/title-constants';

describe('every visual constant is a value, not a word coerced to one', () => {
  // 🔴 `titleFontWeight` was `Number(TITLE_FONT_WEIGHT)` and the shared constant
  // is the STRING `bold`, so it shipped as `NaN`. Every other consumer writes
  // that constant straight into an SVG attribute, where the word is valid; this
  // one is read as a value by the desktop canvas, which puts it on an attribute
  // AND on an input's inline style. The result was `font-weight="NaN"` on every
  // sketch title, silently rendered at the default weight — so a sketch's name
  // was the one title in the product that was not bold, and nothing failed.
  it('no constant the library EXPORTS is a non-finite number', () => {
    // 🔴 The whole public surface, not just this chart type's table. The
    // instance was `SKETCH_VISUALS.titleFontWeight`; the class is any constant
    // built by coercing something that is not a number, and it can be written
    // into any of the forty-eight chart types' visual tables. A NaN here is
    // invisible at every stage — TypeScript types it `number`, the emitter
    // writes it into an attribute, and the browser silently ignores the
    // attribute and falls back — so nothing short of looking for it finds it.
    //
    // ⚠️ Values only. Functions are skipped, and a getter that throws is
    // skipped rather than failing the sweep: this is a floor, not an audit.
    const bad: string[] = [];
    const seen = new Set<unknown>();
    const walk = (value: unknown, path: string, depth: number): void => {
      if (depth > 5 || value === null || value === undefined) return;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) bad.push(`${path} = ${String(value)}`);
        return;
      }
      if (typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      for (const key of Object.keys(value)) {
        try {
          walk(
            (value as Record<string, unknown>)[key],
            `${path}.${key}`,
            depth + 1
          );
        } catch {
          // A getter that throws is not what this is looking for.
        }
      }
    };
    for (const key of Object.keys(advanced)) {
      try {
        walk((advanced as Record<string, unknown>)[key], key, 0);
      } catch {
        // ditto
      }
    }
    expect(bad.join('\n')).toBe('');
  });

  it('the sketch title is bold, at the shared weight', () => {
    expect(SKETCH_VISUALS.titleFontWeight).toBe(700);
    expect(TITLE_FONT_WEIGHT).toBe('bold');
  });
});

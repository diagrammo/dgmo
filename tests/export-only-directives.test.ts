import { describe, expect, it } from 'vitest';
import {
  EXPORT_ONLY_DIRECTIVES,
  exportOnlyDirectiveNote,
} from '../src/editor/highlight-api';
import { parseChartFrameLine } from '../src/utils/chart-frame-parse';

describe('export-only directives (#2015)', () => {
  it('flags legend-box and legend-pill, not legend-align', () => {
    expect([...EXPORT_ONLY_DIRECTIVES.keys()].sort()).toEqual([
      'legend-box',
      'legend-pill',
    ]);
    expect(exportOnlyDirectiveNote('legend-align center')).toBeNull();
  });

  it('reads a line the way the frame parser does', () => {
    for (const line of [
      'legend-box',
      'legend-pill  ',
      '  legend-box',
      'legend-box x',
      'legend-boxes',
    ]) {
      const parsed = parseChartFrameLine({}, line, 1, []);
      expect(exportOnlyDirectiveNote(line) !== null).toBe(parsed);
    }
  });

  it('carries the hover note', () => {
    expect(exportOnlyDirectiveNote('legend-box')).toMatch(/^Export only/);
  });
});

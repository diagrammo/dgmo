import { describe, expect, it } from 'vitest';

import { parseVisualization } from '../src/d3';
import { getPalette } from '../src/palettes';

const palette = getPalette('slate').light;

const BODY = `tag Era
  Ancient blue
  Modern green
1000 Founding era: Ancient
2000 Reform era: Modern`;

describe('timeline `lane-by <group>` directive', () => {
  it('sets tag-sort + the swimlane group', () => {
    const parsed = parseVisualization(
      `timeline\nlane-by Era\n${BODY}`,
      palette
    );
    expect(parsed.timelineSort).toBe('tag');
    expect(parsed.timelineDefaultSwimlaneTG).toBe('Era');
  });

  it('matches the back-compat `sort tag:<group>` spelling', () => {
    const viaLaneBy = parseVisualization(
      `timeline\nlane-by Era\n${BODY}`,
      palette
    );
    const viaSort = parseVisualization(
      `timeline\nsort tag:Era\n${BODY}`,
      palette
    );
    expect(viaLaneBy.timelineDefaultSwimlaneTG).toBe(
      viaSort.timelineDefaultSwimlaneTG
    );
    expect(viaLaneBy.timelineSort).toBe(viaSort.timelineSort);
  });

  it('does not warn about a missing date on the directive line', () => {
    const parsed = parseVisualization(
      `timeline\nlane-by Era\n${BODY}`,
      palette
    );
    expect(
      parsed.diagnostics.some((d) => /Expected a date/.test(d.message))
    ).toBe(false);
  });
});

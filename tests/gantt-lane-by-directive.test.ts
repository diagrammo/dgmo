import { describe, expect, it } from 'vitest';

import { parseGantt } from '../src/gantt/parser';
import { getPalette } from '../src/palettes';

const palette = getPalette('slate').light;

describe('gantt `lane-by <group>` directive', () => {
  it('sets tag-sort + the swimlane group', () => {
    const parsed = parseGantt(
      'gantt\nlane-by Team\ntag Team\n  A blue\n  B green\nTask 1 team: A 3d',
      palette
    );
    expect(parsed.options.sort).toBe('tag');
    expect(parsed.options.defaultSwimlaneGroup).toBe('Team');
  });

  it('is equivalent to the back-compat `sort tag:<group>` spelling', () => {
    const base = 'tag Team\n  A blue\n  B green\nTask 1 team: A 3d';
    const viaLaneBy = parseGantt(`gantt\nlane-by Team\n${base}`, palette);
    const viaSort = parseGantt(`gantt\nsort tag:Team\n${base}`, palette);
    expect(viaLaneBy.options.sort).toBe(viaSort.options.sort);
    expect(viaLaneBy.options.defaultSwimlaneGroup).toBe(
      viaSort.options.defaultSwimlaneGroup
    );
  });
});

import { describe, expect, it } from 'vitest';

import { getPalette } from '../src/palettes';
import { groupFill, groupStroke } from '../src/palettes/color-utils';
import { sketchColors, sketchContainerFill } from '../src/sketch/colors';
import type { TagGroup } from '../src/utils/tag-groups';

// 🔴 A sketch group's OWN tag value tints its frame (#619, dgmo d2cae3cd), by
// the same `groupFill` / `groupStroke` recipe boxes-and-lines, infra, c4, state
// and pert use. Before that fix the container branch of `sketchColors` returned
// a neutral frame whatever the group carried, and all 159 sketch tests stayed
// green with the fix reverted (diagrammo/diagrammo#970) — the only container
// test used a tag entry with no colour, so it never reached the tint.

const P = getPalette('slate').light;
const DECK = '#c0392b';
const HOLD = '#2471a3';

const crew: TagGroup = {
  name: 'Crew',
  entries: [
    { value: 'Deck', color: DECK, lineNumber: 2 },
    { value: 'Hold', color: HOLD, lineNumber: 3 },
  ],
  // A container must never take this: only a value on its own line tints it.
  defaultValue: 'Deck',
  lineNumber: 1,
};

const colours = sketchColors({
  palette: P,
  isDark: false,
  tagGroups: [crew],
  activeTagGroup: 'Crew',
  fillMode: undefined,
});

describe('a sketch group is tinted by its own tag', () => {
  it('tints a container whose own line carries a coloured tag value', () => {
    const bare = colours({}, true);
    const tagged = colours({ crew: 'Hold' }, true);

    expect(tagged.fill).not.toBe(bare.fill);
    expect(tagged.stroke).not.toBe(bare.stroke);
    // The shared group-frame recipe, not a sketch-only answer.
    expect(tagged.fill).toBe(groupFill(P, false, HOLD));
    expect(tagged.stroke).toBe(groupStroke(P, HOLD));
    expect(tagged.text).toBe(P.text);
  });

  it('leaves a container with no value of its own untinted, despite the group default', () => {
    // `resolveGroupTagColor` withholds `defaultValue` from containers, or every
    // untagged frame on the board would wear the first entry's colour.
    const bare = colours({}, true);
    expect(bare.fill).toBe(sketchContainerFill(P, false));
    expect(bare.fill).toBe(groupFill(P, false));
    expect(bare.stroke).toBe(groupStroke(P));
    expect(bare.fill).not.toBe(groupFill(P, false, DECK));
    expect(bare.stroke).not.toBe(groupStroke(P, DECK));
  });
});

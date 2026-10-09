import { describe, expect, it } from 'vitest';
import { BUILT_IN_PALETTE_IDS } from '../src/palettes/built-in-ids';
import { getAvailablePalettes } from '../src/palettes';

// The id list is plain strings so the light completion entry does not import
// the palettes. This keeps it from drifting away from them.
describe('BUILT_IN_PALETTE_IDS', () => {
  it('names exactly the palettes that ship', () => {
    const shipped = getAvailablePalettes().map((palette) => palette.id);
    expect([...BUILT_IN_PALETTE_IDS].sort()).toEqual(shipped.sort());
  });
});

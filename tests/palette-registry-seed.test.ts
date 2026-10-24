// The registry module alone must hold every built-in palette. A bundler that
// trusts `sideEffects` drops palette files imported only for their
// registration side effect; the web editor booted to a white screen when
// Vite 8.3 did (diagrammo/diagrammo#1517). Importing nothing but the registry
// is what such a bundle sees.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PALETTE_ID,
  getAvailablePalettes,
  getPalette,
} from '../src/palettes/registry';

describe('palette registry', () => {
  it('registers the built-ins without any palette file being imported', () => {
    expect(
      getAvailablePalettes()
        .map((p) => p.id)
        .sort()
    ).toEqual([
      'atlas',
      'blueprint',
      'catppuccin',
      'nord',
      'slate',
      'tidewater',
      'tokyo-night',
    ]);
  });

  it('resolves the default palette', () => {
    expect(getPalette(DEFAULT_PALETTE_ID).light).toBeDefined();
  });
});

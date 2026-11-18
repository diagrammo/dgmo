// Every chart type's own parser must tolerate a `palette` block (#2110).
//
// `parseDgmo` and `render` lift the block before a parser runs, but the app's
// per-type previews call the parsers directly on raw source. A parser that
// does not lift it reads each row (`radius 0`, `bg #fff1e5`) as content and
// reports "Unexpected line" — or draws it. So the check runs every registry
// parser on raw source with and without a valid block appended, and expects
// the block to add nothing.
import { describe, expect, it } from 'vitest';
import { chartTypeParsers } from '../src/dgmo-router';

// A complete, valid block: it must raise no palette warning of its own.
const BLOCK = [
  '',
  'palette Gossamer',
  '  radius 0',
  '  stroke-weight 0.25',
  '  light',
  '    bg #fff1e5',
  '    surface #f2dfce',
  '    overlay #f7e8db',
  '    border #ccc1b7',
  '    text #33302e',
  '    text-muted #66605c',
  '    text-on-fill-light #fff1e5',
  '    text-on-fill-dark #33302e',
  '    primary #0f5499',
  '    secondary #990f3d',
  '    accent #0d7680',
  '    destructive #cc0000',
  '    colors',
  '      red #990f3d',
  '      orange #d9661a',
  '      yellow #a87d00',
  '      green #00994d',
  '      blue #0f5499',
  '      purple #593380',
  '      teal #0d7680',
  '      cyan #2a87c8',
  '      gray #8a8179',
  '      black #33302e',
  '      white #f2dfce',
  '',
].join('\n');

const summary = (src: string, parse: (s: string) => unknown) => {
  const result = parse(src) as {
    diagnostics?: { code?: string; message: string }[];
  };
  return (result.diagnostics ?? []).map((d) => `${d.code ?? ''} ${d.message}`);
};

describe('a palette block on raw source (#2110)', () => {
  for (const [id, parse] of chartTypeParsers) {
    it(`${id} reports nothing for the block`, () => {
      const base = `${id} Title\n`;
      expect(summary(base + BLOCK, parse)).toEqual(summary(base, parse));
    });
  }
});

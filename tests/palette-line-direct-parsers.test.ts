// The `palette` line on the charts the app preview parses DIRECTLY (#1469):
// journey map, cycle, ring, pyramid, RACI and whiteboard. `render()` and
// `parseDgmo()` lift the line before a chart parser runs; the app preview
// calls these parsers on raw source, so a share link carrying `palette slate
// light` drew the line as a cycle node, a ring or pyramid layer, or warned
// about it as a stray step, task or element. The sequence parser's own lift
// is covered by sequence-palette-line.test.ts.

import { describe, it, expect } from 'vitest';
import { parseJourneyMap } from '../src/journey-map/parser';
import { parseCycle } from '../src/cycle/parser';
import { parseRing } from '../src/ring/parser';
import { parsePyramid } from '../src/pyramid/parser';
import { parseRaci } from '../src/raci/parser';
import { parseWhiteboard } from '../src/whiteboard/parser';
import { extractPaletteDirective } from '../src/palettes/directive';
import { render, validate } from '../src/index';

interface Parsed {
  error: string | null;
  diagnostics: readonly { code?: string; message: string }[];
}

const CHARTS: [string, (src: string) => Parsed, string][] = [
  [
    'journey map',
    parseJourneyMap,
    'journey-map Trip\n\n[Plan]\n  Search flights\n  Book hotel',
  ],
  ['cycle', parseCycle, 'cycle OODA\n\nObserve\nOrient\nDecide\nAct'],
  ['ring', parseRing, 'ring Sphere\n\nCaptain\nCrew\nAllies'],
  ['pyramid', parsePyramid, 'pyramid Maslow\n\nEsteem\nSafety'],
  ['RACI', parseRaci, 'raci Launch\n\nShip it\n  Dev: R\n  Lead: A'],
  ['whiteboard', parseWhiteboard, 'whiteboard\nnote Hi at: 0 0'],
];

const codes = (diags: readonly { code?: string }[]) => diags.map((d) => d.code);

describe.each(CHARTS)(
  '%s: the palette line, parsed directly (#1469)',
  (_name, parse, src) => {
    // What `withPaletteLines` in the app writes into an outgoing copy.
    const shared = `${src}\n\npalette slate light\n`;

    it('source plus `palette slate light` parses exactly as the source alone', () => {
      const withLine = parse(shared);
      expect(withLine.error).toBeNull();
      // The lift turns the line into `//`: the same source with that comment.
      expect(withLine).toEqual(parse(`${src}\n\n//\n`));
    });

    it('a palette line keeps every later line number: it becomes a comment', () => {
      expect(parse(`palette nord dark\n${src}`)).toEqual(parse(`//\n${src}`));
    });

    it('an embedded palette block is lifted with its line', () => {
      // A one-colour block is an incomplete palette, so the lift warns about
      // it; every other diagnostic and the parsed chart match the comments.
      const block = 'palette Mine\n  light\n    bg #ffffff\n';
      const { diagnostics, ...chart } = parse(`${block}${src}`);
      const { diagnostics: expected, ...commented } = parse(
        `//\n//\n//\n${src}`
      );
      expect(chart).toEqual(commented);
      expect(
        diagnostics.filter((d) => !d.code?.startsWith('W_PALETTE_'))
      ).toEqual(expected);
    });

    it('lifting twice is harmless: parsing lifted source gives the same result', () => {
      const lifted = extractPaletteDirective(shared).content;
      expect(parse(lifted)).toEqual(parse(shared));
    });

    describe('an unknown palette warns once, whoever lifts first', () => {
      const unknown = `${src}\npalette nope\n`;
      const once = (diags: readonly { code?: string }[]) =>
        codes(diags).filter((c) => c === 'W_PALETTE_UNKNOWN');

      it('parsed directly', () => {
        expect(once(parse(unknown).diagnostics)).toHaveLength(1);
      });

      it('through validate()', () => {
        expect(once(validate(unknown).diagnostics)).toHaveLength(1);
      });

      it('through render()', async () => {
        const { diagnostics } = await render(unknown);
        expect(once(diagnostics)).toHaveLength(1);
      });
    });
  }
);

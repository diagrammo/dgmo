// The `palette` line on a sequence diagram parsed DIRECTLY (#1469). The app
// preview calls `parseSequenceDiagram` on raw source, skipping the lift that
// `render()` and `parseDgmo()` do, so a share link carrying `palette slate
// light` showed "Unexpected line: 'palette slate light'".

import { describe, it, expect } from 'vitest';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { extractPaletteDirective } from '../src/palettes/directive';
import { render, validate } from '../src/index';

// The reported source, verbatim (the issue's own block).
const REPORTED = `sequence GAEv2

tag Owner as o
  MLB
  NEC blue

[Edge]
  Camera
  GAESW
  FanScreen
  [NEC] o:NEC
    FacialCapture
    Something
    ZMQ

[IT Closet] o:NEC
  FacialMatch
  GalleryDB

Fan -> Camera
Camera -liveStream-> FacialCapture
FacialCapture -faceImage-> ZMQ
note also creates template
ZMQ -faceImage-> Something
Something -faceImage-> FacialMatch
FacialMatch -findMatch-> GalleryDB
FacialMatch -putPersonId-> ZMQ
ZMQ -personId-> GAESW
note also photo
GAESW -showGreen-> FanScreen
GAESW -validate-> ProVenue
`;

// What `withPaletteLines` in the app writes into an outgoing copy.
const SHARED = `${REPORTED}\npalette slate light\n`;

const codes = (diags: { code?: string }[]) => diags.map((d) => d.code);

describe('sequence: the palette line, parsed directly (#1469)', () => {
  it('the reported source plus `palette slate light` parses with no new diagnostic', () => {
    const without = parseSequenceDgmo(REPORTED);
    const withLine = parseSequenceDgmo(SHARED);
    expect(withLine.error).toBeNull();
    expect(
      withLine.diagnostics.filter((d) => /palette/i.test(d.message))
    ).toEqual([]);
    expect(withLine.diagnostics).toEqual(without.diagnostics);
    expect(withLine.participants).toEqual(without.participants);
    expect(withLine.messages).toEqual(without.messages);
  });

  it('a line after the palette line keeps its number', () => {
    const src = 'sequence\n\npalette nord dark\nA -hi-> B\n';
    const parsed = parseSequenceDgmo(src);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.messages.map((m) => m.lineNumber)).toEqual([4]);
  });

  it('an embedded palette block is lifted with its line', () => {
    const src = [
      'sequence',
      'palette Mine',
      '  light',
      '    bg #ffffff',
      'A -hi-> B',
    ].join('\n');
    const parsed = parseSequenceDgmo(src);
    expect(
      parsed.diagnostics.filter((d) => /Unexpected line/.test(d.message))
    ).toEqual([]);
    expect(parsed.messages.map((m) => m.lineNumber)).toEqual([5]);
  });

  it('lifting twice is harmless: parsing lifted source gives the same result', () => {
    const lifted = extractPaletteDirective(SHARED).content;
    expect(parseSequenceDgmo(lifted)).toEqual(parseSequenceDgmo(SHARED));
  });

  describe('an unknown palette warns once, whoever lifts first', () => {
    const src = 'sequence\nA -hi-> B\npalette nope\n';

    it('parsed directly', () => {
      expect(codes(parseSequenceDgmo(src).diagnostics)).toEqual([
        'W_PALETTE_UNKNOWN',
      ]);
    });

    it('through validate()', () => {
      expect(codes(validate(src).diagnostics)).toEqual(['W_PALETTE_UNKNOWN']);
    });

    it('through render()', async () => {
      const { diagnostics } = await render(src);
      expect(
        codes(diagnostics).filter((c) => c === 'W_PALETTE_UNKNOWN')
      ).toHaveLength(1);
    });
  });
});

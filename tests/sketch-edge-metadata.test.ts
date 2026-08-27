import { describe, expect, it } from 'vitest';

import { emitSketch } from '../src/sketch/emit';
import { parseSketch } from '../src/sketch/parser';

// 🔴 An edge carries its OWN metadata and the renderer colours a line by
// exactly that tag ("a line is colored only when it carries its own tag").
// `edgeText` emitted the arrow, the label and the target and nothing else, so
// every canonical rewrite silently un-tagged every edge in the document and an
// authored colour came back a plain grey connector (2026-08-27).
//
// 🔴 `sameSketch` could not see it: it parses BOTH sides and compares, so a
// property the emitter drops is simply absent from each. The assertion has to
// be against what the emitter WROTE.

const parse = (src: string) => parseSketch(src);

describe('an edge keeps its own metadata through a rewrite', () => {
  it('round-trips a tag on a labelled edge', () => {
    const src =
      'sketch Board\n\ntag Crew\n  Deck\n\nHelm as helm at: 0 0\n  -ships-> bay crew: Deck\nHold Bay as bay at: 8 0\n';
    const out = emitSketch(parse(src));
    expect(out).toContain('crew: Deck');
    expect(parse(out).edges[0]!.metadata['crew']).toBe('Deck');
  });

  it('round-trips a tag on every arrow form', () => {
    // 🔴 Six forms, and the tail was missing from all of them — a fix applied
    // to the one an example happened to use would leave the rest lossy.
    for (const arrow of ['->', '~>', '--', '~~', '<->', '<~>']) {
      const src = `sketch Board\n\ntag Crew\n  Deck\n\nHelm as helm at: 0 0\n  ${arrow} bay crew: Deck\nHold Bay as bay at: 8 0\n`;
      const out = emitSketch(parse(src));
      expect(parse(out).edges[0]!.metadata['crew']).toBe('Deck');
    }
    for (const [open, close] of [
      ['-', '->'],
      ['~', '~>'],
      ['-', '-'],
      ['~', '~'],
      ['<-', '->'],
      ['<~', '~>'],
    ]) {
      const src = `sketch Board\n\ntag Crew\n  Deck\n\nHelm as helm at: 0 0\n  ${open}ships${close} bay crew: Deck\nHold Bay as bay at: 8 0\n`;
      const out = emitSketch(parse(src));
      expect(parse(out).edges[0]!.metadata['crew']).toBe('Deck');
      expect(parse(out).edges[0]!.label).toBe('ships');
    }
  });

  it('an untagged edge is emitted exactly as before', () => {
    const src =
      'sketch Board\n\nHelm as helm at: 0 0\n  -ships-> bay\nHold Bay as bay at: 8 0\n';
    expect(emitSketch(parse(src))).toContain('-ships-> bay\n');
  });
});

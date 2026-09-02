// A first line that ALMOST names a chart type used to be silent.
//
// The router does not fail when line 1 is unknown — it falls through to content
// inference, which is a supported path (`[A] -> [B]` with no declaration is
// legal). The cost was that a TYPO reached the same place with nothing said:
// `flowchar Deploy` over `[A] -> [B]` drew a sequence, and the author was then
// corrected in the vocabulary of a chart they never chose.
import { describe, expect, it } from 'vitest';
import { validate } from '../src/index';

const CODE = 'W_CHART_TYPE_INFERRED';
const found = (src: string) =>
  validate(src).diagnostics.filter((d) => d.code === CODE);

describe('a first line that almost names a chart type', () => {
  it('names the typo, what was drawn instead, and the correction', () => {
    const [d] = found('flowchar Deploy\n[A] -> [B]');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('warning');
    expect(d!.line).toBe(1);
    expect(d!.message).toContain("'flowchar' is not a chart type");
    expect(d!.message).toContain('drawn as a sequence');
    expect(d!.message).toContain("Did you mean 'flowchart'?");
  });

  it('carries the hint that says what line 1 is for', () => {
    const [d] = found('flowchar Deploy\n[A] -> [B]');
    expect(d!.hint).toContain('Line 1 names the chart type');
  });

  it("recognises Mermaid's `graph`, which no edit distance would reach", () => {
    const [d] = found('graph TD\n[A] -> [B]');
    expect(d!.message).toContain("Did you mean 'flowchart'?");
  });

  it('says nothing when the chart type is spelled correctly', () => {
    expect(found('flowchart Deploy\n[A] -> [B]')).toHaveLength(0);
  });

  it('says nothing when there is no declaration at all — inference is legal', () => {
    expect(found('[A] -> [B]')).toHaveLength(0);
  });

  // 🔴 The guard that keeps this from being a nuisance. `suggest` would happily
  // offer to "correct" a capitalised node name to a chart type it resembles.
  it('never corrects a capitalised first word, which is a name not a keyword', () => {
    expect(found('org Team\nBarr Smith\n  Ada Lovelace')).toHaveLength(0);
    expect(found('Barr Smith -> Ada Lovelace')).toHaveLength(0);
  });

  it('does not fire on a comment or a blank first line', () => {
    expect(found('// flowchar\nflowchart D\n[A] -> [B]')).toHaveLength(0);
  });
});

// ============================================================
// The card shown when NOTHING resolves
// ============================================================
//
// This is the product's opening move: the first keystroke in a new file. Until
// 2026-09-02 it answered `Unsupported chart type: "f". Supported types: slope,
// wordcloud, arc, timeline, venn, quadrant, sequence` — the legacy
// visualization parser's own seven, out of 51, omitting the likeliest answer.
describe('the message when no chart type resolves at all', () => {
  const first = (src: string) => validate(src).diagnostics[0]?.message ?? '';

  it('never enumerates the legacy seven', () => {
    expect(first('f')).not.toContain('wordcloud');
    expect(first('f')).not.toContain('Supported types');
  });

  it('leads with the root cause, not a complaint about the content', () => {
    // `ba Sales / Q1 10` also raises "Unexpected line" for both rows; the
    // reason none of it parsed has to come first, because consumers show
    // the first error.
    expect(first('ba Sales\nQ1 10')).toContain("'ba' is not a chart type");
  });

  it('corrects a real typo', () => {
    expect(first('ba Sales\nQ1 10')).toContain("Did you mean 'bar'?");
    expect(first('flowchar')).toContain("Did you mean 'flowchart'?");
  });

  it('says what line 1 is for when there is nothing to correct', () => {
    expect(first('xyzzy')).toContain('line 1 names the chart type');
  });

  // 🔴 A single character is not a typo, it is someone mid-word. `suggest`
  // allowed two edits on a two-letter word — the whole word replaced — so `f`
  // was answered "Did you mean 'c4'?" and `zz` likewise.
  it('does not guess at one or two characters it cannot correct', () => {
    expect(first('f')).toContain('line 1 names the chart type');
    expect(first('zz')).toContain('line 1 names the chart type');
  });
});

// ============================================================
// What counts as "close enough" to suggest
// ============================================================
//
// Two faults, fixed together on 2026-09-02 because they break the same
// assertions. Plain Levenshtein charged 2 for a TRANSPOSITION — right keys,
// wrong order, the commonest typing slip — and the loop took the first
// candidate at the minimum, so registry order decided ties. Between them,
// `bra` and `pei` were both answered "Did you mean 'er'?".
describe('choosing which chart type to suggest', () => {
  const suggestion = (word: string): string | null => {
    const msg = validate(`${word} T\nQ1 10`).diagnostics[0]?.message ?? '';
    return msg.match(/Did you mean '([^']+)'/)?.[1] ?? null;
  };

  it('reads a transposition as one slip, not two', () => {
    expect(suggestion('bra')).toBe('bar');
    expect(suggestion('pei')).toBe('pie');
    expect(suggestion('sequnece')).toBe('sequence');
  });

  it('still corrects an ordinary single edit', () => {
    expect(suggestion('flowchar')).toBe('flowchart');
    expect(suggestion('ba')).toBe('bar');
  });

  // 🔴 The magnet. A two-character id sits within two edits of almost any
  // three-character typo, so `er` and `c4` won on registry order alone.
  it('does not answer a three-letter typo with a two-letter id', () => {
    expect(suggestion('bra')).not.toBe('er');
    expect(suggestion('pei')).not.toBe('er');
  });

  it('declines when nothing is close enough', () => {
    expect(suggestion('zz')).toBeNull();
    expect(suggestion('f')).toBeNull();
    expect(suggestion('tabel')).toBeNull();
  });
});

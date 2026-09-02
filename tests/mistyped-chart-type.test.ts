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

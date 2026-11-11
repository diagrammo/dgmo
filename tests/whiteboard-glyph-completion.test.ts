// Whiteboard glyph sets in the editor (#1845, slice b): completion data for
// every set's glyphs, highlighting for `shapes` and the glyph keywords, the
// quick fix on a glyph used without its line, and the one edit that writes or
// removes the `shapes` line for all three editor paths.
import { describe, expect, it } from 'vitest';

import {
  SHAPE_SETS,
  STRUCTURAL_KEYWORDS,
  shapeSetEdits,
  type SourceEdit,
} from '../src/completion-registry';
import { highlightDgmo } from '../src/editor/highlight-api';
import { GLYPH_NAMES } from '../src/glyphs/registry';
import { parseWhiteboard } from '../src/whiteboard/parser';

/** Apply edits (ascending, non-overlapping) the way an editor does. */
function apply(source: string, edits: readonly SourceEdit[]): string {
  let out = source;
  for (const e of [...edits].reverse()) {
    out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  }
  return out;
}

const on = (src: string): string =>
  apply(src, shapeSetEdits(src, 'network', true));
const off = (src: string): string =>
  apply(src, shapeSetEdits(src, 'network', false));

const roleOf = (source: string, word: string): string | undefined =>
  highlightDgmo(source).find((t) => t.text === word)?.role;

describe('completion data', () => {
  it('SHAPE_SETS offers every glyph, each under exactly one labelled set', () => {
    const offered = SHAPE_SETS.flatMap((s) => s.glyphs);
    expect([...offered].sort()).toEqual([...GLYPH_NAMES].sort());
    expect(new Set(offered).size).toBe(offered.length);
    const network = SHAPE_SETS.find((s) => s.id === 'network');
    expect(network?.label).toBe('Network');
    expect(network?.glyphs).toContain('router');
  });

  it('`shapes` is a whiteboard keyword', () => {
    expect(STRUCTURAL_KEYWORDS.get('whiteboard')).toContain('shapes');
  });
});

describe('highlighting', () => {
  const board =
    'whiteboard Net\nshapes network\nrouter Edge at: 0 0, size: 48 48\naccess-point AP at: 60 0, size: 48 48\n';

  it('`shapes` and the glyph keywords highlight on a whiteboard', () => {
    expect(roleOf(board, 'shapes')).not.toBe('default');
    expect(roleOf(board, 'router')).not.toBe('default');
  });

  it('a glyph keyword is plain text in another chart type', () => {
    expect(roleOf('kanban Sprint\n[Todo]\n  router\n', 'router')).toBe(
      'default'
    );
  });
});

describe('quick fix on W_WHITEBOARD_SHAPE_SET_OFF', () => {
  const src = 'whiteboard Net\nrouter Edge at: 0 0, size: 48 48\n';

  it('carries the shape-set fix that adds the line', () => {
    const d = parseWhiteboard(src).diagnostics.find(
      (x) => x.code === 'W_WHITEBOARD_SHAPE_SET_OFF'
    );
    expect(d?.fix).toEqual({
      kind: 'shape-set',
      set: 'network',
      title: 'Add `shapes network`',
    });
  });

  it('applying it clears the warning', () => {
    const fixed = on(src);
    expect(fixed).toBe(
      'whiteboard Net\nshapes network\nrouter Edge at: 0 0, size: 48 48\n'
    );
    expect(parseWhiteboard(fixed).diagnostics.map((d) => d.code)).not.toContain(
      'W_WHITEBOARD_SHAPE_SET_OFF'
    );
  });

  it('other whiteboard warnings carry no fix', () => {
    const d = parseWhiteboard('whiteboard\nshapes netwrok\n').diagnostics;
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((x) => x.fix === undefined)).toBe(true);
  });
});

describe('shapeSetEdits', () => {
  it('writes the line under the title, past leading comments and blanks', () => {
    expect(on('// mine\n\nwhiteboard\nrectangle A at: 0 0, size: 10 10')).toBe(
      '// mine\n\nwhiteboard\nshapes network\nrectangle A at: 0 0, size: 10 10'
    );
    expect(on('whiteboard')).toBe('whiteboard\nshapes network');
  });

  it('appends to an existing `shapes` line rather than adding a second', () => {
    expect(on('whiteboard\nshapes  \nnote x')).toBe(
      'whiteboard\nshapes network  \nnote x'
    );
    expect(on('whiteboard\nshapes netwrok\n')).toBe(
      'whiteboard\nshapes netwrok, network\n'
    );
  });

  it('does nothing when the set is already on, in any case', () => {
    expect(
      shapeSetEdits('whiteboard\nshapes Network\n', 'network', true)
    ).toEqual([]);
    expect(
      shapeSetEdits('whiteboard\nSHAPES network\n', 'NETWORK', true)
    ).toEqual([]);
  });

  it('refuses an unbundled set and a source with no whiteboard line', () => {
    expect(shapeSetEdits('whiteboard\n', 'aws', true)).toEqual([]);
    expect(shapeSetEdits('flowchart\nA -> B\n', 'network', true)).toEqual([]);
    expect(shapeSetEdits('', 'network', true)).toEqual([]);
  });

  it('turning off deletes a line left empty, with its newline', () => {
    expect(off('whiteboard\nshapes network\nnote x\n')).toBe(
      'whiteboard\nnote x\n'
    );
    expect(off('whiteboard\nshapes network')).toBe('whiteboard');
    expect(off('whiteboard\r\nshapes network')).toBe('whiteboard');
    expect(off('whiteboard\r\nshapes network\r\nnote x')).toBe(
      'whiteboard\r\nnote x'
    );
  });

  it('turning off keeps the other ids, and clears every line naming the set', () => {
    expect(off('whiteboard\nshapes netwrok, network\n')).toBe(
      'whiteboard\nshapes netwrok\n'
    );
    expect(off('whiteboard\nshapes network\nnote x\nshapes network\n')).toBe(
      'whiteboard\nnote x\n'
    );
    expect(shapeSetEdits('whiteboard\nnote x\n', 'network', false)).toEqual([]);
  });

  it('round-trips: on then off restores the source', () => {
    const src = 'whiteboard Net\nrectangle A at: 0 0, size: 10 10\n';
    expect(off(on(src))).toBe(src);
  });
});

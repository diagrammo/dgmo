import { describe, expect, it } from 'vitest';

import { parseMindmap } from '../src/mindmap/parser';

import {
  applyCollapsedMarker,
  applyCollapsedMarkerAtLine,
  applyGroupHeaderCollapsedMarkerAtLine,
  applyIndentedGroupCollapsedMarkerAtLine,
  applyNoteCollapsedMarkerAtLine,
} from '../src/utils/collapse-marker';

describe('applyCollapsedMarker — the bare trailing flag', () => {
  const labelOf = (line: string) =>
    parseMindmap(`mindmap T\n\nTreasure\n  ${line}\n    Kid`).roots[0]!
      .children[0]!.children[0]!;

  it('expanding removes the flag, with or without metadata before it', () => {
    expect(applyCollapsedMarker('  Gold collapsed', 'Gold', false)).toBe(
      '  Gold'
    );
    expect(
      applyCollapsedMarker('  Wine w: Prized, collapsed', 'Wine', false)
    ).toBe('  Wine w: Prized');
    expect(
      applyCollapsedMarker('  [Bridge] collapsed', '[Bridge]', false)
    ).toBe('  [Bridge]');
  });

  it('collapsing an already-flagged line leaves it alone', () => {
    expect(applyCollapsedMarker('  Gold collapsed', 'Gold', true)).toBe(
      '  Gold collapsed'
    );
  });

  it('a lone `collapsed` line is a node name, never a flag', () => {
    expect(applyCollapsedMarker('  collapsed', 'collapsed', false)).toBe(
      '  collapsed'
    );
    expect(applyCollapsedMarker('  collapsed', 'collapsed', true)).toBe(
      '  collapsed collapsed: true'
    );
  });

  it('expand then collapse keeps the label the parser reads (#1571)', () => {
    const expanded = applyCollapsedMarker('  Gold collapsed', 'Gold', false);
    const again = applyCollapsedMarker(expanded, 'Gold', true);
    expect(labelOf(again.trim())).toMatchObject({
      label: 'Gold',
      collapsed: true,
    });
  });

  it('expanding heals a line the old writer doubled', () => {
    expect(
      applyCollapsedMarker(
        '  Gold collapsed, collapsed: true',
        'Gold collapsed,',
        false
      )
    ).toBe('  Gold');
  });
});

describe('applyCollapsedMarker', () => {
  it('appends the marker to a bare node line (space form)', () => {
    expect(applyCollapsedMarker('  Research', 'Research', true)).toBe(
      '  Research collapsed: true'
    );
  });

  it('comma-joins the marker when the line already has metadata', () => {
    expect(
      applyCollapsedMarker('  Research color: red', 'Research', true)
    ).toBe('  Research color: red, collapsed: true');
  });

  it('is idempotent — re-collapsing normalizes to true', () => {
    expect(
      applyCollapsedMarker('  Research collapsed: true', 'Research', true)
    ).toBe('  Research collapsed: true');
    expect(
      applyCollapsedMarker('  Research collapsed: false', 'Research', true)
    ).toBe('  Research collapsed: true');
  });

  it('AC9 round-trip: collapse then expand restores the original line exactly', () => {
    const original = '  Research color: red';
    const collapsed = applyCollapsedMarker(original, 'Research', true);
    expect(collapsed).toBe('  Research color: red, collapsed: true');
    expect(applyCollapsedMarker(collapsed, 'Research', false)).toBe(original);
  });

  it('removes the marker in the space form', () => {
    expect(
      applyCollapsedMarker('  Research collapsed: true', 'Research', false)
    ).toBe('  Research');
  });

  it('removes the marker when it leads the metadata list', () => {
    expect(
      applyCollapsedMarker(
        '  Research collapsed: true, color: red',
        'Research',
        false
      )
    ).toBe('  Research color: red');
  });

  it('leaves labels that literally end in "collapsed" untouched when expanding', () => {
    // No `collapsed:` key present — nothing to remove.
    expect(
      applyCollapsedMarker('  Deploy collapsed', 'Deploy collapsed', false)
    ).toBe('  Deploy collapsed');
  });
});

describe('applyCollapsedMarkerAtLine', () => {
  it('edits only the target 1-based line', () => {
    const doc = 'mindmap Root\n  A\n    A1\n  B';
    expect(applyCollapsedMarkerAtLine(doc, 2, 'A', true)).toBe(
      'mindmap Root\n  A collapsed: true\n    A1\n  B'
    );
  });

  it('returns the text unchanged for an out-of-range line', () => {
    const doc = 'mindmap Root\n  A';
    expect(applyCollapsedMarkerAtLine(doc, 99, 'A', true)).toBe(doc);
  });
});

describe('applyGroupHeaderCollapsedMarkerAtLine', () => {
  const doc = 'sequence Flow\n[Bridge]\n  Nav\n[Hold] color: red\n  Vault';

  it('adds the marker after the bracket on a bare group header', () => {
    expect(applyGroupHeaderCollapsedMarkerAtLine(doc, 2, true)).toBe(
      'sequence Flow\n[Bridge] collapsed: true\n  Nav\n[Hold] color: red\n  Vault'
    );
  });

  it('comma-joins when the header already has metadata', () => {
    expect(applyGroupHeaderCollapsedMarkerAtLine(doc, 4, true)).toBe(
      'sequence Flow\n[Bridge]\n  Nav\n[Hold] color: red, collapsed: true\n  Vault'
    );
  });

  it('round-trips collapse then expand', () => {
    const on = applyGroupHeaderCollapsedMarkerAtLine(doc, 2, true);
    expect(applyGroupHeaderCollapsedMarkerAtLine(on, 2, false)).toBe(doc);
  });

  it('leaves a non-group line untouched', () => {
    expect(applyGroupHeaderCollapsedMarkerAtLine(doc, 3, true)).toBe(doc);
  });
});

describe('applyIndentedGroupCollapsedMarkerAtLine', () => {
  // infra: header line 3 = "[Backend]", children indented 2.
  const doc = 'infra Net\n\n[Backend]\n  Api\n    -> Db\n  Db\n\nLighthouse';

  it('inserts an indented collapsed line as the group first child', () => {
    expect(applyIndentedGroupCollapsedMarkerAtLine(doc, 3, true)).toBe(
      'infra Net\n\n[Backend]\n  collapsed: true\n  Api\n    -> Db\n  Db\n\nLighthouse'
    );
  });

  it('round-trips: collapse then expand restores the original', () => {
    const on = applyIndentedGroupCollapsedMarkerAtLine(doc, 3, true);
    expect(applyIndentedGroupCollapsedMarkerAtLine(on, 3, false)).toBe(doc);
  });

  it('is idempotent on re-collapse (no duplicate marker line)', () => {
    const on = applyIndentedGroupCollapsedMarkerAtLine(doc, 3, true);
    expect(applyIndentedGroupCollapsedMarkerAtLine(on, 3, true)).toBe(on);
  });

  it('expand is a no-op when there is no marker', () => {
    expect(applyIndentedGroupCollapsedMarkerAtLine(doc, 3, false)).toBe(doc);
  });

  it('only removes the group’s own marker, not a nested one', () => {
    const on = applyIndentedGroupCollapsedMarkerAtLine(doc, 3, true);
    // header at line 3; its child block ends before the blank line + Lighthouse.
    expect(on.split('\n')[3]).toBe('  collapsed: true');
  });
});

describe('applyNoteCollapsedMarkerAtLine — a multi-line note head', () => {
  const at = (line: string, collapse: boolean) =>
    applyNoteCollapsedMarkerAtLine(
      `A -> B\n${line}\n  body`,
      2,
      collapse
    ).split('\n')[1];

  it('adds and removes `collapsed: true`, keeping indentation', () => {
    expect(at('  note right of B', true)).toBe(
      '  note right of B collapsed: true'
    );
    expect(at('  note right of B collapsed: true', false)).toBe(
      '  note right of B'
    );
    expect(at('note', true)).toBe('note collapsed: true');
  });

  it('recognises the bare flag', () => {
    expect(at('note left B collapsed', true)).toBe('note left B collapsed');
    expect(at('note left B collapsed', false)).toBe('note left B');
    expect(at('note collapsed', false)).toBe('note');
  });

  it('leaves a non-note line untouched', () => {
    expect(at('A -> B', true)).toBe('A -> B');
  });
});

describe('a trailing colour after the parsed label is not metadata (#1741)', () => {
  it('space-appends after a colour word when given the parsed label', () => {
    expect(applyCollapsedMarker('  Products blue', 'Products', true)).toBe(
      '  Products blue collapsed: true'
    );
    expect(
      applyCollapsedMarker('  Products blue collapsed: true', 'Products', false)
    ).toBe('  Products blue');
  });
  it('still comma-joins onto real metadata', () => {
    expect(applyCollapsedMarker('  Wine w: Prized', 'Wine', true)).toBe(
      '  Wine w: Prized, collapsed: true'
    );
  });
});

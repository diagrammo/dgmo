// sequence note source `collapsed` marker (#1741): parser forms, static render
// fold, toggle markup, and the source-edit helper round trip. The marker rides
// on a MULTI-LINE note's opening line only — a single-line note's text is prose.
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { render } from '../src/render';
import {
  parseSequenceDgmo,
  isSequenceNote,
  type SequenceNote,
} from '../src/sequence/parser';
import {
  collapsedSequenceNoteLinesFromSource,
  unionCollapsedSequenceNotes,
} from '../src/sequence/collapse';
import { applyNoteCollapsedMarkerAtLine } from '../src/utils/collapse-marker';

let win: JSDOM['window'];
beforeAll(() => {
  win = new JSDOM('<!DOCTYPE html><html><body></body></html>').window;
  for (const key of [
    'document',
    'window',
    'navigator',
    'HTMLElement',
    'SVGElement',
  ] as const) {
    Object.defineProperty(globalThis, key, {
      value: key === 'window' ? win : win[key],
      configurable: true,
    });
  }
});

const doc = (head: string): string =>
  `sequence Flow\nAPI -> DB\n${head}\n  First line\n  Second line\nDB -> API`;
const NOTE_LINE = 3;

function note(src: string): SequenceNote {
  const parsed = parseSequenceDgmo(src);
  expect(parsed.error).toBeNull();
  const n = parsed.elements.find(
    (e): e is SequenceNote => isSequenceNote(e) && e.lineNumber === NOTE_LINE
  );
  expect(n).toBeDefined();
  return n!;
}

async function staticSvg(src: string, cg?: string[]): Promise<Document> {
  const { svg } = await render(src, {
    theme: 'light',
    palette: 'nord',
    ...(cg && { viewState: { cg } }),
  });
  expect(svg).not.toBe('');
  return new win.DOMParser().parseFromString(svg, 'image/svg+xml');
}

const bars = (d: Document): number =>
  d.querySelectorAll('.dgmo-collapse-bar').length;

describe('sequence note collapsed marker — parser', () => {
  it.each([
    ['note collapsed', true],
    ['note right collapsed', true],
    ['note right of DB collapsed', true],
    ['note left DB collapsed', true],
    ['note right of DB collapsed: true', true],
    ['note right of DB collapsed: false', false],
    ['note right of DB', false],
    ['note left "DB" collapsed', true],
    ['note collapsed: true', true],
  ])('%s → collapsed %s', (head, folded) => {
    const n = note(doc(head));
    expect(n.collapsed === true).toBe(folded);
    expect(n.text).toBe('First line\nSecond line');
    // A head naming no participant hangs on the last sender.
    expect(n.participantId).toBe(/DB/.test(head) ? 'DB' : 'API');
  });

  it('a single-line note keeps a trailing `collapsed` as its text', () => {
    const n = note('sequence Flow\nAPI -> DB\nnote right of DB collapsed');
    expect(n.text).toBe('collapsed');
    expect(n.collapsed).toBeUndefined();
    const n2 = note('sequence Flow\nAPI -> DB\nnote this is collapsed');
    expect(n2.text).toBe('this is collapsed');
    expect(n2.collapsed).toBeUndefined();
  });

  it('capitalised `Collapsed` is not the marker', () => {
    const parsed = parseSequenceDgmo(doc('note right of DB Collapsed'));
    const notes = parsed.elements.filter(isSequenceNote);
    expect(notes.every((n) => n.collapsed !== true)).toBe(true);
  });

  it('source lines feed the seed helper; a one-line body is not foldable', () => {
    expect([
      ...collapsedSequenceNoteLinesFromSource(
        parseSequenceDgmo(doc('note right of DB collapsed'))
      ),
    ]).toEqual([NOTE_LINE]);
    const oneLine = parseSequenceDgmo(
      'sequence Flow\nAPI -> DB\nnote right of DB collapsed\n  Only line\nDB -> API'
    );
    expect(collapsedSequenceNoteLinesFromSource(oneLine).size).toBe(0);
  });

  it('a note inside a block is found', () => {
    const src =
      'sequence Flow\nAPI -> DB\nif ok\n  DB -> API\n  note right of API collapsed\n    a\n    b';
    expect([
      ...collapsedSequenceNoteLinesFromSource(parseSequenceDgmo(src)),
    ]).toEqual([5]);
  });
});

describe('sequence note collapsed marker — static render', () => {
  it('folds by marker: one bar, first line only, toggle attributes', async () => {
    const d = await staticSvg(doc('note right of DB collapsed'));
    expect(bars(d)).toBe(1);
    const g = d.querySelector('[data-note-toggle]')!;
    expect(g.getAttribute('data-note-toggle')).toBe(String(NOTE_LINE));
    expect(g.getAttribute('data-line-number')).toBe(String(NOTE_LINE));
    expect(g.getAttribute('aria-expanded')).toBe('false');
    expect(g.getAttribute('role')).toBe('button');
    expect(g.getAttribute('aria-label')).toBe('First line');
    expect(g.hasAttribute('tabindex')).toBe(false);
    expect(g.querySelector('.dgmo-collapse-bar')).not.toBeNull();
    expect(g.textContent).toContain('First line');
    expect(g.textContent).not.toContain('Second line');
  });

  it('expanded: no bar, every line, aria-expanded true', async () => {
    const d = await staticSvg(doc('note right of DB'));
    expect(bars(d)).toBe(0);
    const g = d.querySelector('[data-note-toggle]')!;
    expect(g.getAttribute('data-note-toggle')).toBe(String(NOTE_LINE));
    expect(g.getAttribute('data-line-number')).toBe(String(NOTE_LINE));
    expect(g.getAttribute('aria-expanded')).toBe('true');
    expect(g.getAttribute('role')).toBe('button');
    expect(g.textContent).toContain('Second line');
  });

  it('`collapsed: false` does not fold', async () => {
    expect(
      bars(await staticSvg(doc('note right of DB collapsed: false')))
    ).toBe(0);
  });

  it('export unions the marker with runtime lines from `cg`', async () => {
    expect(bars(await staticSvg(doc('note right of DB'), ['3']))).toBe(1);
    expect(
      bars(await staticSvg(doc('note right of DB collapsed'), ['3']))
    ).toBe(1);
    const parsed = parseSequenceDgmo(doc('note right of DB'));
    expect([...unionCollapsedSequenceNotes(parsed, [3, 99])]).toEqual([3]);
  });

  it('a single-line note carries no toggle', async () => {
    const d = await staticSvg(
      'sequence Flow\nAPI -> DB\nnote right of DB just a remark\nDB -> API'
    );
    expect(d.querySelector('.note')).not.toBeNull();
    expect(d.querySelector('[data-note-toggle]')).toBeNull();
  });
});

describe('sequence note collapsed marker — helper round trip', () => {
  it.each([
    'note right of DB',
    'note',
    'note left DB',
    'note left "DB"',
    '  note right of DB',
  ])('%s', async (head) => {
    const src = doc(head).replace(/\n {2}(First|Second)/g, '\n    $1');
    const folded = applyNoteCollapsedMarkerAtLine(src, NOTE_LINE, true);
    expect(folded).not.toBe(src);
    const parsed = parseSequenceDgmo(folded);
    expect(collapsedSequenceNoteLinesFromSource(parsed).has(NOTE_LINE)).toBe(
      true
    );
    expect(bars(await staticSvg(folded))).toBe(1);
    const back = applyNoteCollapsedMarkerAtLine(folded, NOTE_LINE, false);
    expect(back).toBe(src);
    expect(
      collapsedSequenceNoteLinesFromSource(parseSequenceDgmo(back)).size
    ).toBe(0);
  });

  it('a line carrying the bare flag: collapse is a no-op, expand removes it', () => {
    const src = doc('note right of DB collapsed');
    expect(applyNoteCollapsedMarkerAtLine(src, NOTE_LINE, true)).toBe(src);
    const back = applyNoteCollapsedMarkerAtLine(src, NOTE_LINE, false);
    expect(back).toBe(doc('note right of DB'));
    expect(note(back).collapsed).toBeUndefined();
  });

  it('`collapsed: false` normalises to true on collapse', () => {
    const src = doc('note right of DB collapsed: false');
    expect(applyNoteCollapsedMarkerAtLine(src, NOTE_LINE, true)).toBe(
      doc('note right of DB collapsed: true')
    );
  });

  it('a line that is not a note head is untouched', () => {
    const src = doc('note right of DB');
    expect(applyNoteCollapsedMarkerAtLine(src, 2, true)).toBe(src);
  });
});

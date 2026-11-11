import { describe, it, expect } from 'vitest';
import { boxesAndLinesToWhiteboard } from '../src/boxes-and-lines/to-whiteboard';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { parseWhiteboard } from '../src/whiteboard/parser';
import { whiteboardConnectorAttachments } from '../src/whiteboard/geometry';
import type {
  WhiteboardArrow,
  WhiteboardNote,
  WhiteboardShape,
} from '../src/whiteboard/types';

const SOURCE = `boxes-and-lines Pirate Fleet

tag Status as s
  Operational green
  Damaged red

Flagship s: Operational
  -fires on-> [Harbor]

Flagship <-> Scout

[Harbor]
  Fort s: Damaged
    -> Tower
  Tower

Scout
  -> Tower
`;

async function convert(src: string) {
  const out = await boxesAndLinesToWhiteboard(src);
  if (!out) throw new Error('no conversion');
  const back = parseWhiteboard(out.source);
  return { out, back };
}

describe('boxes-and-lines → whiteboard copy (#1884)', () => {
  it('emits whiteboard source that parses with no diagnostics', async () => {
    const { out, back } = await convert(SOURCE);
    expect(out.source.startsWith('whiteboard Pirate Fleet\n')).toBe(true);
    expect(back.error).toBeNull();
    expect(back.diagnostics).toEqual([]);
  });

  it('places every box at the source layout, relative to one origin', async () => {
    const parsed = parseBoxesAndLines(SOURCE);
    const layout = await layoutBoxesAndLines(parsed);
    const { back } = await convert(SOURCE);
    const shapes = back.elements.filter(
      (e): e is WhiteboardShape => e.kind === 'shape'
    );
    const byLabel = new Map(shapes.map((s) => [s.label.split('\n')[0], s]));
    const lefts = [...layout.nodes, ...layout.groups].map(
      (n) => n.x - n.width / 2
    );
    const tops = [...layout.nodes, ...layout.groups].map(
      (n) => n.y - n.height / 2
    );
    const ox = Math.min(...lefts);
    const oy = Math.min(...tops);
    for (const n of layout.nodes) {
      const s = byLabel.get(n.label);
      expect(s, n.label).toBeDefined();
      expect(s!.x).toBe(Math.round(n.x - n.width / 2 - ox));
      expect(s!.y).toBe(Math.round(n.y - n.height / 2 - oy));
      expect(s!.width).toBe(Math.round(n.width));
      expect(s!.height).toBe(Math.round(n.height));
    }
  });

  it('turns a group into a rectangle enclosing its members, drawn beneath them', async () => {
    const { back } = await convert(SOURCE);
    const shapes = back.elements.filter(
      (e): e is WhiteboardShape => e.kind === 'shape'
    );
    const harbor = shapes.find((s) => s.label === 'Harbor')!;
    expect(harbor).toBeDefined();
    for (const name of ['Fort', 'Tower']) {
      const m = shapes.find((s) => s.label === name)!;
      expect(m.x).toBeGreaterThanOrEqual(harbor.x);
      expect(m.y).toBeGreaterThanOrEqual(harbor.y);
      expect(m.x + m.width).toBeLessThanOrEqual(harbor.x + harbor.width);
      expect(m.y + m.height).toBeLessThanOrEqual(harbor.y + harbor.height);
      expect(back.elements.indexOf(harbor)).toBeLessThan(
        back.elements.indexOf(m)
      );
    }
  });

  it('attaches every arrow to the boxes the edge joined, keeping labels and heads', async () => {
    const { back } = await convert(SOURCE);
    const labelOf = (i: number) => {
      const el = back.elements[i];
      return el && el.kind === 'shape' ? el.label : null;
    };
    const arrows = back.elements.filter(
      (e): e is WhiteboardArrow => e.kind === 'arrow'
    );
    const pairs = arrows.map((a) => {
      const at = whiteboardConnectorAttachments(a, back.elements);
      return {
        from: labelOf(at.from),
        to: labelOf(at.to),
        label: a.label,
        heads: a.heads,
        style: a.style,
      };
    });
    expect(pairs).toEqual(
      expect.arrayContaining([
        {
          from: 'Flagship',
          to: 'Harbor',
          label: 'fires on',
          heads: 'end',
          style: 'solid',
        },
        {
          from: 'Flagship',
          to: 'Scout',
          label: '',
          heads: 'both',
          style: 'solid',
        },
        { from: 'Fort', to: 'Tower', label: '', heads: 'end', style: 'solid' },
        { from: 'Scout', to: 'Tower', label: '', heads: 'end', style: 'solid' },
      ])
    );
    expect(pairs).toHaveLength(4);
  });

  it('keeps tag colours by name and copies the tag block', async () => {
    const { back } = await convert(SOURCE);
    const shapes = back.elements.filter(
      (e): e is WhiteboardShape => e.kind === 'shape'
    );
    expect(shapes.find((s) => s.label === 'Flagship')!.color).toBe('green');
    expect(shapes.find((s) => s.label === 'Fort')!.color).toBe('red');
    expect(back.tagGroups[0]?.entries.map((e) => [e.value, e.color])).toEqual([
      ['Operational', 'green'],
      ['Damaged', 'red'],
    ]);
  });

  it('lays out collapsed groups expanded, so no box is lost', async () => {
    const src = SOURCE.replace('[Harbor]\n', '[Harbor] collapsed\n');
    const { back } = await convert(src);
    const labels = back.elements.flatMap((e) =>
      e.kind === 'shape' ? [e.label] : []
    );
    expect(labels).toEqual(expect.arrayContaining(['Fort', 'Tower']));
  });

  it('copies each note as a sticky note where the layout floated it (#1922)', async () => {
    const src = `${SOURCE}\nnote Flagship the admiral sails here\nnote Fort red\n  walls cracked\n`;
    const parsed = parseBoxesAndLines(src);
    const layout = await layoutBoxesAndLines(parsed);
    const { back } = await convert(src);
    expect(back.diagnostics).toEqual([]);
    const notes = back.elements.filter(
      (e): e is WhiteboardNote => e.kind === 'note'
    );
    expect(notes.map((n) => [n.text, n.color])).toEqual(
      expect.arrayContaining([
        ['the admiral sails here', 'yellow'],
        ['walls cracked', 'red'],
      ])
    );
    expect(notes).toHaveLength(2);

    // Same offset from its box as the layout gave it.
    const shapes = back.elements.filter(
      (e): e is WhiteboardShape => e.kind === 'shape'
    );
    const flagship = shapes.find((s) => s.label === 'Flagship')!;
    const placed = layout.nodes.find((n) => n.label === 'Flagship')!;
    const note = notes.find((n) => n.text === 'the admiral sails here')!;
    // Each position is rounded on its own, so the offset may differ by one.
    expect(
      Math.abs(note.x - flagship.x - (placed.note!.x + placed.width / 2))
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(note.y - flagship.y - (placed.note!.y + placed.height / 2))
    ).toBeLessThanOrEqual(1);
  });

  it('copies no notes from a source that says no-notes', async () => {
    const src =
      SOURCE.replace(
        'boxes-and-lines Pirate Fleet\n',
        'boxes-and-lines Pirate Fleet\nno-notes\n'
      ) + '\nnote Flagship hidden\n';
    const { back } = await convert(src);
    expect(back.elements.some((e) => e.kind === 'note')).toBe(false);
  });

  it('returns null for a source with no boxes', async () => {
    expect(await boxesAndLinesToWhiteboard('boxes-and-lines\n')).toBeNull();
  });
});

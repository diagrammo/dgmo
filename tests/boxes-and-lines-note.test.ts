import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { renderBoxesAndLines } from '../src/boxes-and-lines/renderer';
import { resolveNotes } from '../src/utils/notes';
import { getPalette } from '../src/palettes';

const P = getPalette('nord').light;

const errors = (d: readonly { severity: string }[]) =>
  d.filter((x) => x.severity === 'error');

async function render(src: string): Promise<SVGSVGElement> {
  const parsed = parseBoxesAndLines(src, P);
  const layout = await layoutBoxesAndLines(parsed);
  const el = document.createElement('div');
  renderBoxesAndLines(el, parsed, layout, P, false, {
    exportDims: { width: 800, height: 600 },
  });
  return el.querySelector('svg')!;
}

const SRC = [
  'boxes-and-lines',
  'Flagship',
  '  -> Harbor',
  'Harbor',
  'note Flagship the admiral sails here',
].join('\n');

describe('boxes-and-lines notes — parsing', () => {
  it('collects a single-line note with no errors', () => {
    const parsed = parseBoxesAndLines(SRC, P);
    expect(parsed.error).toBeNull();
    expect(parsed.notes?.length).toBe(1);
    expect(parsed.notes![0]!.ref).toBe('Flagship');
    expect(parsed.notes![0]!.body).toBe('the admiral sails here');
    expect(errors(parsed.diagnostics)).toHaveLength(0);
    const byNode = resolveNotes(
      parsed.notes!,
      parsed.nodes.map((n) => ({ id: n.label, label: n.label }))
    );
    expect(byNode.get('Flagship')?.body).toBe('the admiral sails here');
  });

  it('peels a trailing color word + multi-line body', () => {
    const parsed = parseBoxesAndLines(
      [
        'boxes-and-lines',
        'Crew',
        '  -> Flagship',
        'Flagship',
        'note Crew red',
        '  souls aboard',
      ].join('\n'),
      P
    );
    const note = parsed.notes![0]!;
    expect(note.ref).toBe('Crew');
    expect(note.body).toBe('souls aboard');
    expect(note.color).toBeTruthy();
  });

  it('errors on an unknown ref', () => {
    const parsed = parseBoxesAndLines(
      ['boxes-and-lines', 'Flagship', 'note Galleon nope'].join('\n'),
      P
    );
    const errs = errors(parsed.diagnostics);
    expect(errs.length).toBe(1);
    expect(errs[0]!.message).toMatch(/unknown node id "Galleon"/);
  });
});

describe('boxes-and-lines notes — rendering', () => {
  it('emits a note group with toggle hook + box + connector', async () => {
    const svg = await render(SRC);
    const note = svg.querySelector('.note');
    expect(note).not.toBeNull();
    expect(note!.hasAttribute('data-note-toggle')).toBe(true);
    expect(note!.getAttribute('data-line-number')).toBe('5');
    expect(svg.querySelector('.note-box')).not.toBeNull();
    expect(svg.querySelector('.note-connector')).not.toBeNull();
  });

  it('colors the note border via a trailing color word', async () => {
    const svg = await render(
      ['boxes-and-lines', 'Crew', 'note Crew hull red'].join('\n')
    );
    const stroke = svg.querySelector('.note-box')!.getAttribute('stroke')!;
    expect(stroke).toBe(P.colors.red);
    expect(stroke).not.toBe(P.colors.yellow);
  });

  it('keeps the note within a non-negative canvas', async () => {
    const parsed = parseBoxesAndLines(SRC, P);
    const layout = await layoutBoxesAndLines(parsed);
    const annotated = layout.nodes.find((n) => n.note)!;
    expect(annotated.note).toBeTruthy();
    expect(annotated.x + annotated.note!.x).toBeGreaterThanOrEqual(0);
    expect(annotated.y + annotated.note!.y).toBeGreaterThanOrEqual(0);
    expect(
      annotated.x + annotated.note!.x + annotated.note!.width
    ).toBeLessThanOrEqual(layout.width);
  });

  it('no-notes suppresses the note entirely', async () => {
    const svg = await render(
      ['boxes-and-lines', 'no-notes', 'Flagship', 'note Flagship hidden'].join(
        '\n'
      )
    );
    expect(svg.querySelector('.note')).toBeNull();
  });

  it('renders a collapsed note as a corner badge', async () => {
    const parsed = parseBoxesAndLines(SRC, P);
    const layout = await layoutBoxesAndLines(parsed, undefined, {
      collapsedNotes: new Set([5]),
    });
    const annotated = layout.nodes.find((n) => n.note)!;
    expect(annotated.note!.collapsed).toBe(true);
  });
});

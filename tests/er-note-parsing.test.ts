import { describe, it, expect } from 'vitest';
import { parseERDiagram } from '../src/er/parser';
import { resolveNotes } from '../src/utils/notes';
import { getPalette } from '../src/palettes';

const nord = getPalette('nord').light;

const errors = (d: readonly { severity: string }[]) =>
  d.filter((x) => x.severity === 'error');
const warnings = (d: readonly { severity: string }[]) =>
  d.filter((x) => x.severity === 'warning');

const anchors = (p: ReturnType<typeof parseERDiagram>) =>
  p.tables.map((t) => ({ id: t.id, label: t.name }));

describe('er notes — parsing', () => {
  it('collects a single-line note on a table with no errors', () => {
    const parsed = parseERDiagram(
      ['er', 'ships', '  id int pk', 'note ships the flagship'].join('\n'),
      nord
    );
    expect(parsed.error).toBeNull();
    expect(parsed.notes?.length).toBe(1);
    expect(parsed.notes![0]!.ref).toBe('ships');
    expect(parsed.notes![0]!.body).toBe('the flagship');
    expect(errors(parsed.diagnostics)).toHaveLength(0);

    const byNode = resolveNotes(parsed.notes!, anchors(parsed));
    const ships = parsed.tables.find((t) => t.name === 'ships')!;
    expect(byNode.get(ships.id)?.body).toBe('the flagship');
  });

  it('collects an indented multi-line body + trailing color', () => {
    const parsed = parseERDiagram(
      [
        'er',
        'ships',
        '  id int pk',
        'note ships red',
        '  line one',
        '  line two',
      ].join('\n'),
      nord
    );
    const note = parsed.notes![0]!;
    expect(note.body).toBe('line one\nline two');
    expect(note.color).toBeTruthy();
    expect(note.endLineNumber).toBe(6);
  });

  it('resolves a forward reference', () => {
    const parsed = parseERDiagram(
      ['er', 'note ships ahoy', 'ships', '  id int pk'].join('\n'),
      nord
    );
    const byNode = resolveNotes(parsed.notes!, anchors(parsed), [
      ...parsed.diagnostics,
    ]);
    const ships = parsed.tables.find((t) => t.name === 'ships')!;
    expect(byNode.get(ships.id)?.body).toBe('ahoy');
  });

  it('errors on an unknown ref', () => {
    const parsed = parseERDiagram(
      ['er', 'ships', '  id int pk', 'note galleons nope'].join('\n'),
      nord
    );
    const errs = errors(parsed.diagnostics);
    expect(errs.length).toBe(1);
    expect(errs[0]!.message).toMatch(/unknown node id "galleons"/);
  });

  it('does not treat an indented column "note ..." as a note', () => {
    const parsed = parseERDiagram(
      ['er', 'ships', '  id int pk', '  note varchar'].join('\n'),
      nord
    );
    expect(parsed.notes ?? []).toHaveLength(0);
    const ships = parsed.tables.find((t) => t.name === 'ships')!;
    expect(ships.columns.some((c) => c.name === 'note')).toBe(true);
  });

  it('warns and ignores an empty-body note', () => {
    const parsed = parseERDiagram(
      ['er', 'ships', '  id int pk', 'note ships'].join('\n'),
      nord
    );
    expect(parsed.notes ?? []).toHaveLength(0);
    expect(
      warnings(parsed.diagnostics).some((w) => /no text/.test(w.message))
    ).toBe(true);
  });
});

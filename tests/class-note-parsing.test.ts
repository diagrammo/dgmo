import { describe, it, expect } from 'vitest';
import { parseClassDiagram } from '../src/class/parser';
import { resolveNotes } from '../src/utils/notes';
import { getPalette } from '../src/palettes';

const nord = getPalette('nord').light;

const errors = (d: readonly { severity: string }[]) =>
  d.filter((x) => x.severity === 'error');
const warnings = (d: readonly { severity: string }[]) =>
  d.filter((x) => x.severity === 'warning');

const anchors = (p: ReturnType<typeof parseClassDiagram>) =>
  p.classes.map((c) => ({ id: c.id, label: c.name }));

describe('class notes — parsing', () => {
  it('collects a single-line note on a class with no errors', () => {
    const parsed = parseClassDiagram(
      ['class', 'Ship', '  + sail()', 'note Ship a comment'].join('\n'),
      nord
    );
    expect(parsed.error).toBeNull();
    expect(parsed.notes?.length).toBe(1);
    expect(parsed.notes![0]!.ref).toBe('Ship');
    expect(parsed.notes![0]!.body).toBe('a comment');
    expect(errors(parsed.diagnostics)).toHaveLength(0);

    const byNode = resolveNotes(parsed.notes!, anchors(parsed));
    const ship = parsed.classes.find((c) => c.name === 'Ship')!;
    expect(byNode.get(ship.id)?.body).toBe('a comment');
  });

  it('collects an indented multi-line body and tracks endLineNumber', () => {
    const parsed = parseClassDiagram(
      ['class', 'Ship', 'note Ship', '  line one', '  line two'].join('\n'),
      nord
    );
    expect(parsed.notes?.length).toBe(1);
    const note = parsed.notes![0]!;
    expect(note.body).toBe('line one\nline two');
    expect(note.lineNumber).toBe(3);
    expect(note.endLineNumber).toBe(5);
  });

  it('peels a trailing color word', () => {
    const parsed = parseClassDiagram(
      ['class', 'Ship', 'note Ship hull notes red'].join('\n'),
      nord
    );
    const note = parsed.notes![0]!;
    expect(note.body).toBe('hull notes');
    expect(note.color).toBeTruthy();
  });

  it('quotes a multi-word class ref', () => {
    const parsed = parseClassDiagram(
      ['class', 'Cargo Hold', 'note "Cargo Hold" stowage'].join('\n'),
      nord
    );
    expect(parsed.notes![0]!.ref).toBe('Cargo Hold');
    expect(parsed.notes![0]!.body).toBe('stowage');
    const byNode = resolveNotes(parsed.notes!, anchors(parsed), [
      ...parsed.diagnostics,
    ]);
    const hold = parsed.classes.find((c) => c.name === 'Cargo Hold')!;
    expect(byNode.get(hold.id)?.body).toBe('stowage');
  });

  it('resolves a forward reference (note before the class)', () => {
    const parsed = parseClassDiagram(
      ['class', 'note Ship ahoy', 'Ship', '  + sail()'].join('\n'),
      nord
    );
    const byNode = resolveNotes(parsed.notes!, anchors(parsed), [
      ...parsed.diagnostics,
    ]);
    const ship = parsed.classes.find((c) => c.name === 'Ship')!;
    expect(byNode.get(ship.id)?.body).toBe('ahoy');
  });

  it('errors on an unknown ref (never a silent drop)', () => {
    // The parser resolves notes at end-of-parse, so the diagnostic is already
    // on parsed.diagnostics.
    const parsed = parseClassDiagram(
      ['class', 'Ship', 'note Schooner nope'].join('\n'),
      nord
    );
    const errs = errors(parsed.diagnostics);
    expect(errs.length).toBe(1);
    expect(errs[0]!.message).toMatch(/unknown node id "Schooner"/);
  });

  it('warns and ignores an empty-body note', () => {
    const parsed = parseClassDiagram(
      ['class', 'Ship', 'note Ship'].join('\n'),
      nord
    );
    expect(parsed.notes ?? []).toHaveLength(0);
    expect(
      warnings(parsed.diagnostics).some((w) => /no text/.test(w.message))
    ).toBe(true);
  });

  it('does not treat an indented "note" member as a note', () => {
    const parsed = parseClassDiagram(
      ['class', 'Ship', '  + note here'].join('\n'),
      nord
    );
    expect(parsed.notes ?? []).toHaveLength(0);
    const ship = parsed.classes.find((c) => c.name === 'Ship')!;
    expect(ship.members.some((m) => m.name.includes('note'))).toBe(true);
  });
});

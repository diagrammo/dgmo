import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseSketch } from '../src/sketch/parser';
import { emitSketch, canonicalSketch, sameSketch } from '../src/sketch/emit';

// The standing invariant, tech-spec-sketch-rebuild.md §8: emit, re-parse,
// compare, discard. Here it is a test; in the canvas it runs after every
// mutation, which is what makes the whole tier-1 build self-checking.
function roundTrip(src: string): {
  same: boolean;
  newDiagnostics: string[];
  emitted: string;
} {
  const a = parseSketch(src);
  const emitted = emitSketch(a);
  const b = parseSketch(emitted);
  const key = (d: { code?: string; message: string }): string =>
    d.code ?? d.message;
  const before = a.diagnostics.map(key).sort();
  const newDiagnostics = b.diagnostics
    .map(key)
    .sort()
    .filter((x) => {
      const i = before.indexOf(x);
      if (i >= 0) {
        before.splice(i, 1);
        return false;
      }
      return true;
    });
  return { same: sameSketch(a, b), newDiagnostics, emitted };
}

describe('sketch emitter — the standing invariant', () => {
  it('round-trips a plain sketch', () => {
    const r = roundTrip(
      'sketch Brew\n\nKettle at: 0 0\n  -boils-> Pot\nPot at: 3 0\n'
    );
    expect(r.newDiagnostics).toEqual([]);
    expect(r.same).toBe(true);
  });

  // 🔴 `as <alias>` is a postfix separated by a SPACE, not a comma-joined
  // metadata item. Emitting `as pot, at: 2 0` makes the alias literally `pot,`,
  // which fails E_ALIAS_INVALID_FORMAT and dangles every edge naming it. This
  // was the first defect the invariant caught, on its first run.
  it('writes an alias as a space-separated postfix, not a metadata item', () => {
    const src =
      'sketch\n\nFrench Press as pot at: 2 0\nMug at: 4 0\n  -pours-> pot\n';
    const r = roundTrip(src);
    expect(r.newDiagnostics).toEqual([]);
    expect(r.same).toBe(true);
    expect(r.emitted).toContain('as pot at:');
    expect(r.emitted).not.toContain('as pot,');
  });

  it('round-trips every edge form — three head configs x solid/dashed', () => {
    for (const edge of [
      '-> B',
      '<-> B',
      '-- B',
      '~> B',
      '<~> B',
      '~~ B',
      '-runs-> B',
      '<-runs-> B',
      '-runs- B',
      '~runs~> B',
      '<~runs~> B',
      '~runs~ B',
    ]) {
      const r = roundTrip(`sketch\n\nA at: 0 0\n  ${edge}\nB at: 3 0\n`);
      expect(r.newDiagnostics, edge).toEqual([]);
      expect(r.same, edge).toBe(true);
    }
  });

  it('round-trips a box, and a box inside a box (decision #58)', () => {
    const r = roundTrip(
      'sketch Nested\n\n[Outer] at: 0 0\n  Beta at: 4 0\n  [Inner] at: 0 0\n    Alpha at: 0 0\n'
    );
    expect(r.newDiagnostics).toEqual([]);
    expect(r.same).toBe(true);
    const back = parseSketch(r.emitted);
    const inner = back.boxes.find((b) => b.label === 'Inner');
    const outer = back.boxes.find((b) => b.label === 'Outer');
    expect(inner?.parentBoxId).toBe(outer?.id);
  });

  it('round-trips tags, shapes, descriptions and directives', () => {
    const r = roundTrip(
      [
        'sketch Tagged',
        'no-legend',
        'fill-solid',
        '',
        'tag Crew',
        '  Deck',
        '  Hold',
        '',
        'Store shape: database, at: 0 0, crew: Deck',
        '  > a line of prose',
        '  > and another',
        'Cook at: 3 0, crew: Hold',
      ].join('\n')
    );
    expect(r.newDiagnostics).toEqual([]);
    expect(r.same).toBe(true);
  });

  it('never emits a comma inside a metadata value — it would truncate silently', () => {
    // A comma in a same-line value ends the value and invents keys from the
    // rest, and the parse still succeeds. The picture is what goes wrong.
    const a = parseSketch('sketch\n\nA at: 0 0\n');
    const withComma = {
      ...a,
      nodes: [{ ...a.nodes[0]!, metadata: { note: 'one, two, three' } }],
    };
    const back = parseSketch(emitSketch(withComma));
    // The whole value survives, and no extra keys are invented from its tail —
    // which is exactly what a raw comma would have done.
    expect(back.nodes[0]!.metadata.note).toBe('one — two — three');
    expect(Object.keys(back.nodes[0]!.metadata)).toEqual(['note']);
    expect(emitSketch(withComma)).not.toContain('one, two');
  });

  it('canonical form ignores ids and declaration order, not meaning', () => {
    const a = parseSketch('sketch\n\nA at: 0 0\nB at: 3 0\n');
    const b = parseSketch('sketch\n\nB at: 3 0\nA at: 0 0\n');
    expect(canonicalSketch(a)).toEqual(canonicalSketch(b));

    const moved = parseSketch('sketch\n\nA at: 0 0\nB at: 6 0\n');
    expect(canonicalSketch(a)).not.toEqual(canonicalSketch(moved));
  });
});

// 🔴 The corpus test is the one that matters: it checks the emitter against
// every sketch anyone has actually written, not against examples chosen to
// pass. It found the alias defect above on its first run.
describe('sketch emitter — the real corpus', () => {
  const root = resolve(__dirname, '../..');
  let files: string[] = [];
  try {
    files = execSync(
      `grep -rl --include='*.dgmo' -E '^[[:space:]]*sketch([[:space:]]|$)' ${root} 2>/dev/null | grep -v node_modules`,
      { encoding: 'utf8' }
    )
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    files = [];
  }

  it('finds sketch files to check, including the two inside this repo', () => {
    // A silent zero — or a sweep that quietly shrinks to nothing useful —
    // would make the assertion below vacuous and read as a clean result.
    // Name the two fixtures that live in THIS repo, so the check still bites
    // in a checkout with no workspace siblings around it.
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith('gallery/fixtures/sketch.dgmo'))).toBe(
      true
    );
    expect(
      files.some((f) => f.endsWith('tests/fixtures/conformance/sketch.dgmo'))
    ).toBe(true);
  });

  it('round-trips every sketch in the workspace, raising no NEW diagnostics', () => {
    // ⚠️ "No NEW diagnostics", not "zero". Several corpus files are legacy and
    // already warn on their own (a retired `solid-fill` directive, bare tag
    // lines, one empty file). Demanding zero would be demanding the emitter
    // REPAIR its input, which is a different job — §2 is explicit that repair
    // belongs to the parser and the emitter's obligation is only to never
    // produce something needing it.
    const failures: string[] = [];
    for (const file of files) {
      const r = roundTrip(readFileSync(file, 'utf8'));
      if (!r.same) failures.push(`${file}: scene changed`);
      if (r.newDiagnostics.length > 0) {
        failures.push(`${file}: new ${r.newDiagnostics.join(',')}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

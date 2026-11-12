import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';

// #1929: an undeclared `key: value` used to vanish without a word — kept as
// invisible tag data on a group line, absorbed into the name on a node line.

const warnings = (src: string) =>
  parseBoxesAndLines(src)
    .diagnostics.filter((d) => d.severity === 'warning')
    .map((d) => ({ line: d.line, message: d.message }));

describe('boxes-and-lines — undeclared metadata keys warn (#1929)', () => {
  it('drops an unknown key on a group line, with a warning', () => {
    const src = 'boxes-and-lines\n[Corp] style: dashed\n  DB\n';
    const parsed = parseBoxesAndLines(src);
    expect(parsed.groups[0]!.metadata).toEqual({});
    expect(parsed.nodes.find((n) => n.label === 'DB')!.metadata).toEqual({});
    expect(warnings(src)).toEqual([
      { line: 2, message: expect.stringContaining('"style"') },
    ]);
  });

  it('keeps a declared tag alias and a reserved key on a group line', () => {
    const src =
      'boxes-and-lines\ntag Kind as k\n  Store purple\n[Corp] k: Store, collapsed: true\n  DB\n';
    expect(warnings(src)).toEqual([]);
  });

  it('warns on an unknown key on a group-to-group edge', () => {
    const src =
      'boxes-and-lines\n[A]\n  X\n[B]\n  Y\n[A] -> [B] proto: https\n';
    expect(warnings(src)).toEqual([
      { line: 6, message: expect.stringContaining('"proto"') },
    ]);
  });

  it('warns when an unquoted word: stays in a node name', () => {
    const src = 'boxes-and-lines\nAPI zzz: q\n';
    const parsed = parseBoxesAndLines(src);
    expect(parsed.nodes.map((n) => n.label)).toEqual(['API zzz: q']);
    expect(warnings(src)).toEqual([
      {
        line: 2,
        message: expect.stringContaining('stays in the box name "API zzz: q"'),
      },
    ]);
  });

  it('warns when an unquoted word: stays in an edge target name', () => {
    const src = 'boxes-and-lines\nA\nA -> B zzz: q\n';
    expect(warnings(src)).toEqual([
      { line: 3, message: expect.stringContaining('"zzz:"') },
    ]);
  });

  it('stays silent for a quoted name and a capitalised colon', () => {
    expect(warnings('boxes-and-lines\n"Auth zzz: q"\n')).toEqual([]);
    expect(warnings('boxes-and-lines\nStep 1: Plan\n')).toEqual([]);
  });
});

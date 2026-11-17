import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { effectiveOwnership } from '../src/ownership/effective';
import { effectiveLines, entityCardHtml } from '../src/ownership/format';
import { parseOwnership } from '../src/ownership/parser';
import type { ParsedOwnership } from '../src/ownership/types';

const ROUND_TWO = readFileSync(
  join(__dirname, '../gallery/fixtures/ownership.dgmo'),
  'utf8'
);

const codes = (p: ParsedOwnership) => p.diagnostics.map((d) => d.code);
const entity = (p: ParsedOwnership, name: string) =>
  p.entities.find((e) => e.name === name)!;
const link = (p: ParsedOwnership, owner: string, owned: string) =>
  p.links.find(
    (l) =>
      l.ownerId === entity(p, owner).id && l.ownedId === entity(p, owned).id
  );

describe('ownership parser (#1873)', () => {
  it('reads the round-two fixture cleanly', () => {
    const p = parseOwnership(ROUND_TWO);
    expect(p.error).toBeNull();
    expect(p.diagnostics).toEqual([]);
    expect(p.title).toBe('Acme group structure');
    expect(p.entities).toHaveLength(8);
    expect(p.links).toHaveLength(8);
  });

  it('reads an indented `NN% Name` as a subsidiary at that stake', () => {
    const p = parseOwnership(ROUND_TWO);
    const l = link(p, 'Acme Inc', 'Acme Labs LLC')!;
    expect(l.pct).toBe(60);
    expect(l.arrow).toBe(false);
    expect(entity(p, 'Acme Labs LLC').treeParentId).toBe(
      entity(p, 'Acme Inc').id
    );
  });

  it('reads `NN% -> Name` as a cross-holding, forward references included', () => {
    const p = parseOwnership(ROUND_TWO);
    const l = link(p, 'Acme Inc', 'Acme GmbH')!;
    expect(l.pct).toBe(10);
    expect(l.arrow).toBe(true);
  });

  it('puts top-level entities other than the root outside the group', () => {
    const p = parseOwnership(ROUND_TWO);
    expect(p.rootId).toBe(entity(p, 'Acme Holdings plc').id);
    const outside = p.entities.filter((e) => e.outside).map((e) => e.name);
    expect(outside).toEqual(['Partner Fund LP', 'J. Moreau']);
  });

  it('reads same-line metadata, tag aliases and `type:`', () => {
    const p = parseOwnership(ROUND_TWO);
    const labs = entity(p, 'Acme Labs LLC');
    expect(labs.metadata).toEqual({ jurisdiction: 'US' });
    expect(labs.type).toBe('partnership');
    expect(entity(p, 'J. Moreau').type).toBe('individual');
    expect(entity(p, 'Acme Inc').type).toBe('corporation');
  });

  it('reads an indented reserved `key: value` as metadata and anything else as description', () => {
    const p = parseOwnership(`ownership G
tag Jurisdiction as j
  UK
  US

Holdings Ltd
  j: UK
  type: trust
  **Listed** on the LSE
  Note: founded 1902
`);
    const h = entity(p, 'Holdings Ltd');
    expect(h.metadata).toEqual({ jurisdiction: 'UK' });
    expect(h.type).toBe('trust');
    expect(h.description).toEqual([
      '**Listed** on the LSE',
      'Note: founded 1902',
    ]);
  });

  it('allows decimal stakes', () => {
    const p = parseOwnership(`ownership G

A Ltd
  33.3% B Ltd
  66.7% -> B Ltd
`);
    expect(codes(p)).toContain('E_OWNERSHIP_DUPLICATE_LINK');
    const q = parseOwnership(`ownership G

A Ltd
  33.3% B Ltd
C Ltd
  66.7% -> B Ltd
`);
    expect(q.error).toBeNull();
    expect(q.links.map((l) => l.pctText)).toEqual(['33.3', '66.7']);
  });

  it('errors when the owners of an entity hold more than 100%', () => {
    const p = parseOwnership(`ownership G

A Ltd
  70% B Ltd
F LP
  40% -> B Ltd
`);
    expect(codes(p)).toEqual(['E_OWNERSHIP_OVER_100']);
    expect(p.diagnostics[0]!.message).toContain('110%');
  });

  it('errors on an unknown `->` name, with a did-you-mean', () => {
    const p = parseOwnership(`ownership G

Acme Holdings
  100% Acme Labs
Fund LP
  40% -> Acme Lab
`);
    expect(codes(p)).toEqual(['E_OWNERSHIP_UNKNOWN_ENTITY']);
    expect(p.diagnostics[0]!.message).toContain("Did you mean 'Acme Labs'?");
    expect(p.diagnostics[0]!.line).toBe(6);
  });

  it('warns on a cycle of ownership and still draws', () => {
    const p = parseOwnership(`ownership G

A Ltd
  50% B Ltd
    10% -> A Ltd
`);
    expect(p.error).toBeNull();
    expect(codes(p)).toEqual(['W_OWNERSHIP_CYCLE']);
    expect(p.diagnostics[0]!.message).toContain('A Ltd → B Ltd → A Ltd');
  });

  it('warns on a crossing the structure forces, naming both links', () => {
    const p = parseOwnership(`ownership G

Top Ltd
  100% A Ltd
    50% C Ltd
    50% D Ltd
  100% B Ltd
    50% -> C Ltd
    50% -> D Ltd
`);
    expect(p.error).toBeNull();
    const w = p.diagnostics.filter(
      (d) => d.code === 'W_OWNERSHIP_FORCED_CROSSING'
    );
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toMatch(
      /→ [CD] Ltd \(50%\) crosses .* → [CD] Ltd \(50%\)/
    );
  });

  it('reports bad stakes, bad types, duplicates and orphan lines', () => {
    expect(codes(parseOwnership('ownership G\n\nA\n  0% B\n'))).toEqual([
      'E_OWNERSHIP_BAD_STAKE',
    ]);
    expect(codes(parseOwnership('ownership G\n\nA\n  120% B\n'))).toEqual([
      'E_OWNERSHIP_BAD_STAKE',
    ]);
    expect(codes(parseOwnership('ownership G\n\nA\n  50%\n'))).toEqual([
      'E_OWNERSHIP_MISSING_NAME',
    ]);
    const bad = parseOwnership('ownership G\n\nA  type: partnershp\n');
    expect(codes(bad)).toEqual(['E_OWNERSHIP_BAD_TYPE']);
    expect(bad.diagnostics[0]!.message).toContain("'partnership'");
    expect(
      codes(parseOwnership('ownership G\n\nA\n  50% B\n  50% C\n    10% B\n'))
    ).toEqual(['E_OWNERSHIP_DUPLICATE_ENTITY']);
    expect(codes(parseOwnership('ownership G\n\nA\n  10% -> A\n'))).toEqual([
      'E_OWNERSHIP_SELF_LINK',
    ]);
    expect(codes(parseOwnership('ownership G\n\n40% -> A\nA\n'))).toEqual([
      'E_OWNERSHIP_ORPHAN_LINE',
    ]);
    expect(codes(parseOwnership('ownership G\n'))).toEqual([
      'E_OWNERSHIP_NO_ENTITIES',
    ]);
  });

  it('reads header options and keeps the fill family exclusive', () => {
    const p = parseOwnership(`ownership G
tag Jurisdiction as j
  UK
active-tag Jurisdiction
fill-solid
fill-outline
no-legend

A Ltd  j: UK
`);
    expect(p.options['active-tag']).toBe('Jurisdiction');
    expect(p.options['fill-outline']).toBe('on');
    expect(p.options['fill-solid']).toBeUndefined();
    expect(p.options['no-legend']).toBe('on');
    expect(p.diagnostics).toEqual([]);
  });
});

describe('effective ownership (#1873)', () => {
  it('sums every path: Holdings holds GmbH 90% via BV + 10% via Inc', () => {
    const p = parseOwnership(ROUND_TWO);
    const e = effectiveOwnership(p, entity(p, 'Acme GmbH').id);
    expect(e.owners).toHaveLength(1);
    expect(e.owners[0]!.id).toBe(entity(p, 'Acme Holdings plc').id);
    expect(e.owners[0]!.total).toBeCloseTo(100);
    expect(e.owners[0]!.paths.map((x) => x.pct)).toEqual([90, 10]);
    const lines = effectiveLines(p, entity(p, 'Acme GmbH').id);
    expect(lines[0]!.paths).toEqual(['90% via Acme BV', '10% via Acme Inc']);
  });

  it('marks outside owners and says what is not shown', () => {
    const p = parseOwnership(ROUND_TWO);
    const lines = effectiveLines(p, entity(p, 'Acme Labs LLC').id);
    expect(lines).toEqual([
      {
        owner: 'Acme Holdings plc',
        outside: false,
        total: '60%',
        paths: ['60% via Acme Inc'],
      },
      {
        owner: 'Partner Fund LP',
        outside: true,
        total: '40%',
        paths: ['40% direct'],
      },
    ]);
    const card = entityCardHtml(p, entity(p, 'Acme Labs LLC'));
    expect(card).toContain('outside the group');
    expect(card).not.toContain('not shown');
    const partial = parseOwnership('ownership G\n\nA\n  60% B\n');
    expect(entityCardHtml(partial, entity(partial, 'B'))).toContain(
      '40% not shown'
    );
  });

  it('stops at a cycle', () => {
    const p = parseOwnership(`ownership G

A Ltd
  50% B Ltd
    10% -> A Ltd
`);
    const e = effectiveOwnership(p, entity(p, 'B Ltd').id);
    expect(e.owners.map((o) => o.total)).toEqual([50]);
  });
});

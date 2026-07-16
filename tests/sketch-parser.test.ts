import { describe, expect, it } from 'vitest';

import { parseSketch } from '../src/sketch/parser';
import type { ParsedSketch } from '../src/sketch/types';

const errors = (p: ParsedSketch) =>
  p.diagnostics.filter((d) => d.severity === 'error');
const warnings = (p: ParsedSketch) =>
  p.diagnostics.filter((d) => d.severity === 'warning');
const byLabel = (p: ParsedSketch, label: string) =>
  p.nodes.filter((n) => n.label === label);

describe('sketch parser — declaration', () => {
  it('parses the type token and optional title', () => {
    const p = parseSketch('sketch Plunder Pipeline\n\nCrow Nest');
    expect(p.type).toBe('sketch');
    expect(p.title).toBe('Plunder Pipeline');
    expect(p.error).toBeNull();
  });

  it('parses without a title', () => {
    const p = parseSketch('sketch\nCrow Nest');
    expect(p.title).toBeNull();
    expect(p.nodes).toHaveLength(1);
  });

  it('fails on a non-sketch first line', () => {
    const p = parseSketch('flowchart\nA -> B');
    expect(p.error).not.toBeNull();
  });

  it('fails on empty input and an empty sketch', () => {
    expect(parseSketch('').error).not.toBeNull();
    expect(parseSketch('sketch Only Title').error).not.toBeNull();
  });
});

describe('sketch parser — shapes', () => {
  it('parses multi-word bare names with metadata', () => {
    const p = parseSketch('sketch\nSpyglass Feed shape: database, at: 0 0');
    expect(p.nodes).toHaveLength(1);
    const n = p.nodes[0]!;
    expect(n.label).toBe('Spyglass Feed');
    expect(n.shape).toBe('database');
    expect(n.at).toEqual({ c: 0, r: 0 });
  });

  it('defaults to rectangle; shape: is never required', () => {
    const p = parseSketch('sketch\nCrow Nest at: 2 0');
    expect(p.nodes[0]!.shape).toBe('rectangle');
  });

  it('accepts all shape kinds', () => {
    const kinds = ['database', 'queue', 'person', 'document', 'note'];
    const src = `sketch\n${kinds.map((k, i) => `S${i} shape: ${k}`).join('\n')}`;
    const p = parseSketch(src);
    expect(p.nodes.map((n) => n.shape)).toEqual(kinds);
    expect(errors(p)).toHaveLength(0);
  });

  it('unknown shape warns W_SKETCH_UNKNOWN_SHAPE and falls back to rectangle', () => {
    const p = parseSketch('sketch\nWidget shape: hexagon');
    expect(p.nodes[0]!.shape).toBe('rectangle');
    const w = warnings(p).find((d) => d.code === 'W_SKETCH_UNKNOWN_SHAPE');
    expect(w).toBeDefined();
    expect(errors(p)).toHaveLength(0);
  });

  it('peels as-aliases', () => {
    const p = parseSketch("sketch\nCaptain's Console as con at: 2 0");
    expect(p.nodes[0]!.label).toBe("Captain's Console");
    expect(p.nodes[0]!.alias).toBe('con');
  });

  it('at: is optional — missing means flow-place (null)', () => {
    const p = parseSketch('sketch\nLazy Shape');
    expect(p.nodes[0]!.at).toBeNull();
    expect(errors(p)).toHaveLength(0);
  });

  it('malformed at: warns and flow-places', () => {
    const p = parseSketch('sketch\nBroken at: over there');
    expect(p.nodes[0]!.at).toBeNull();
    expect(warnings(p).length).toBeGreaterThan(0);
  });

  it('rejects an out-of-range at: (garbage canvas coord) and flow-places', () => {
    // A ~1e19 coord (past MAX_SAFE_INTEGER) would blow the SVG viewBox up to
    // ~1e20 and hang the renderer — warn W_SKETCH_AT_OUT_OF_RANGE, flow-place.
    const p = parseSketch('sketch\nRunaway at: 4 10932207719976796000');
    expect(p.nodes[0]!.at).toBeNull();
    const w = warnings(p).find((d) => d.code === 'W_SKETCH_AT_OUT_OF_RANGE');
    expect(w).toBeDefined();
    expect(errors(p)).toHaveLength(0);
  });

  it('accepts a large-but-sane at: coordinate', () => {
    const p = parseSketch('sketch\nEdge at: 0 2000');
    expect(p.nodes[0]!.at).toEqual({ c: 0, r: 2000 });
    expect(errors(p)).toHaveLength(0);
  });

  it('rejects a coordinate just past the bound (canvas runaway range)', () => {
    const p = parseSketch('sketch\nFar at: 0 100000');
    expect(p.nodes[0]!.at).toBeNull();
    expect(
      warnings(p).find((d) => d.code === 'W_SKETCH_AT_OUT_OF_RANGE')
    ).toBeDefined();
  });

  it('keeps a trailing color word as part of the name (no manual colors)', () => {
    const p = parseSketch('sketch\nCode Red at: 0 0');
    expect(p.nodes[0]!.label).toBe('Code Red');
  });
});

describe('sketch parser — duplicate labels', () => {
  it('aliased duplicates stay distinct shapes', () => {
    const p = parseSketch('sketch\nCache as c1 at: 0 0\nCache as c2 at: 2 0');
    expect(byLabel(p, 'Cache')).toHaveLength(2);
    expect(
      p.diagnostics.find((d) => d.code === 'I_NAME_MERGED')
    ).toBeUndefined();
  });

  it('bare duplicates merge with I_NAME_MERGED', () => {
    const p = parseSketch('sketch\nCache at: 0 0\nCache shape: database');
    expect(byLabel(p, 'Cache')).toHaveLength(1);
    expect(p.nodes[0]!.shape).toBe('database');
    expect(p.nodes[0]!.at).toEqual({ c: 0, r: 0 });
    expect(p.diagnostics.find((d) => d.code === 'I_NAME_MERGED')).toBeDefined();
  });
});

describe('sketch parser — edges', () => {
  const HEADS: Array<[string, string, boolean]> = [
    ['-load->', 'one', false],
    ['<-sync->', 'both', false],
    ['-link-', 'none', false],
    ['~load~>', 'one', true],
    ['<~sync~>', 'both', true],
    ['~link~', 'none', true],
  ];

  for (const [arrow, heads, dashed] of HEADS) {
    it(`parses ${arrow} target as heads=${heads} dashed=${dashed}`, () => {
      const p = parseSketch(`sketch\nA at: 0 0\n  ${arrow} b\nB as b at: 2 0`);
      expect(p.edges).toHaveLength(1);
      expect(p.edges[0]!.heads).toBe(heads);
      expect(p.edges[0]!.dashed).toBe(dashed);
      expect(p.edges[0]!.label).toBe(arrow.replace(/[<>~-]/g, ''));
    });
  }

  it('parses unlabeled arrow and headless forms', () => {
    const p = parseSketch(
      'sketch\nA at: 0 0\n  -> b\n  ~> b\n  <-> b\n  -- b\n  ~~ b\nB as b at: 2 0'
    );
    expect(p.edges).toHaveLength(5);
    expect(p.edges.map((e) => e.heads)).toEqual([
      'one',
      'one',
      'both',
      'none',
      'none',
    ]);
    expect(p.edges.map((e) => e.dashed)).toEqual([
      false,
      true,
      false,
      false,
      true,
    ]);
    expect(p.edges.every((e) => e.label === undefined)).toBe(true);
  });

  it('resolves forward references and bare-label targets', () => {
    const p = parseSketch(
      'sketch\nA at: 0 0\n  -> Booty Queue\nBooty Queue at: 2 0'
    );
    expect(p.edges).toHaveLength(1);
    expect(p.edges[0]!.targetId).toBe(p.nodes[1]!.id);
  });

  it('edge tail tags attach to the edge', () => {
    const p = parseSketch(
      'sketch\n\ntag Crew\n  Deck\n  Hold\n\nA at: 0 0\n  -haul-> b crew: Hold\nB as b at: 2 0'
    );
    expect(p.edges[0]!.metadata['crew']).toBe('Hold');
  });

  it('ambiguous bare target errors with E_SKETCH_AMBIGUOUS_TARGET and drops the edge', () => {
    const p = parseSketch(
      'sketch\nCache as c1 at: 0 0\nCache as c2 at: 2 0\nApp at: 4 0\n  -> Cache'
    );
    expect(p.edges).toHaveLength(0);
    expect(
      errors(p).find((d) => d.code === 'E_SKETCH_AMBIGUOUS_TARGET')
    ).toBeDefined();
    expect(p.error).toBeNull(); // degrade, never fatal
  });

  it('unknown target warns and drops the edge', () => {
    const p = parseSketch('sketch\nA at: 0 0\n  -> ghost');
    expect(p.edges).toHaveLength(0);
    expect(warnings(p).length).toBeGreaterThan(0);
  });

  it('left-pointing arrows error with the swap hint', () => {
    const p = parseSketch('sketch\nA at: 0 0\n  <- b\nB as b at: 2 0');
    expect(p.edges).toHaveLength(0);
    expect(errors(p).some((d) => /Left-pointing/i.test(d.message))).toBe(true);
  });

  it('boxes can be edge targets by alias and by [label]', () => {
    const p = parseSketch(
      'sketch\nA at: 0 0\n  -> armory\n  -> [Below Decks]\n[Armory] as armory at: 0 2\n  P at: 0 0\n[Below Decks] at: 2 2\n  Q at: 0 0'
    );
    expect(p.edges).toHaveLength(2);
    expect(p.edges[0]!.targetId).toBe(p.boxes[0]!.id);
    expect(p.edges[1]!.targetId).toBe(p.boxes[1]!.id);
  });
});

describe('sketch parser — boxes', () => {
  it('parses a box with children, box-relative at:, and cascade', () => {
    const p = parseSketch(
      'sketch\n\ntag Crew\n  Deck\n  Hold\n\n[Below Decks] at: 2 2, crew: Hold\n  Booty Queue shape: queue, at: 0 0\n  Ship Ledger shape: database, at: 2 0, crew: Deck'
    );
    expect(p.boxes).toHaveLength(1);
    const box = p.boxes[0]!;
    expect(box.label).toBe('Below Decks');
    expect(box.at).toEqual({ c: 2, r: 2 });
    expect(box.children).toHaveLength(2);
    const [q, l] = p.nodes;
    expect(q!.boxLabel).toBe('Below Decks');
    expect(q!.metadata['crew']).toBe('Hold'); // cascaded
    expect(l!.metadata['crew']).toBe('Deck'); // individual override
  });

  it('parses the bare collapsed flag and box alias', () => {
    const p = parseSketch(
      'sketch\n[Armory] as armory at: 0 2, collapsed\n  P at: 0 0'
    );
    expect(p.boxes[0]!.collapsed).toBe(true);
    expect(p.boxes[0]!.alias).toBe('armory');
  });

  it('nested boxes error with E_SKETCH_NESTED_BOX and flatten into the outer box', () => {
    const p = parseSketch(
      'sketch\n[Outer]\n  A at: 0 0\n  [Inner]\n    B at: 2 0'
    );
    expect(p.boxes).toHaveLength(1);
    expect(
      errors(p).find((d) => d.code === 'E_SKETCH_NESTED_BOX')
    ).toBeDefined();
    expect(p.error).toBeNull(); // degrade, never fatal
    expect(p.nodes).toHaveLength(2);
    expect(p.nodes.every((n) => n.boxLabel === 'Outer')).toBe(true);
  });
});

describe('sketch parser — tags & directives', () => {
  it('parses tag groups with values and auto-colors', () => {
    const p = parseSketch('sketch\n\ntag Crew\n  Deck\n  Hold\n\nA crew: Deck');
    expect(p.tagGroups).toHaveLength(1);
    expect(p.tagGroups[0]!.entries.map((e) => e.value)).toEqual([
      'Deck',
      'Hold',
    ]);
    expect(p.tagGroups[0]!.entries.every((e) => e.color !== '')).toBe(true);
    expect(p.nodes[0]!.metadata['crew']).toBe('Deck');
  });

  it('records the authored color name on explicit entries only', () => {
    const p = parseSketch('sketch\n\ntag Prio\n  High red\n  Low\n  Mid blue');
    const entries = p.tagGroups[0]!.entries;
    // Explicit named colors keep the authored token; bare values do not.
    expect(entries.map((e) => e.authoredColor)).toEqual([
      'red',
      undefined,
      'blue',
    ]);
    // `color` is always a resolved hex for every entry (auto + explicit).
    expect(entries.every((e) => /^#/.test(e.color))).toBe(true);
  });

  it('unknown tag value warns', () => {
    const p = parseSketch('sketch\n\ntag Crew\n  Deck\n\nA crew: Pirates');
    expect(warnings(p).length).toBeGreaterThan(0);
  });

  it('tag group after content errors', () => {
    const p = parseSketch('sketch\nA at: 0 0\n\ntag Crew\n  Deck');
    expect(
      errors(p).find((d) => d.code === 'E_TAG_DECLARED_AFTER_CONTENT')
    ).toBeDefined();
  });

  it('no-legend and fill-solid directives set options', () => {
    const p = parseSketch('sketch\nno-legend\nfill-solid\nA at: 0 0');
    expect(p.options.noLegend).toBe(true);
    expect(p.options.fillMode).toBe('solid');
  });

  it('unknown metadata key warns with a suggestion', () => {
    const p = parseSketch('sketch\nA shpae: cloud');
    expect(warnings(p).length).toBeGreaterThan(0);
  });
});

describe('sketch parser — gallery fixture shape', () => {
  const FIXTURE = `sketch Plunder Pipeline

tag Crew
  Deck
  Hold

Spyglass Feed shape: database, at: 0 0, crew: Deck
  -sightings-> con
Captain's Console as con at: 2 0, crew: Deck
  -orders-> bq
  -supplies-> armory
Divvy Service as dvy at: 4 0, crew: Hold
  -entries-> ledger

[Below Decks] at: 2 2, crew: Hold
  Booty Queue as bq shape: queue, at: 0 0
    ~haul~> dvy
  Ship Ledger as ledger shape: database, at: 2 0

[Armory] as armory at: 0 2, collapsed
  Powder Store at: 0 0
  Cutlass Rack at: 0 1
`;

  it('parses the canonical pirate example with zero errors', () => {
    const p = parseSketch(FIXTURE);
    expect(errors(p)).toHaveLength(0);
    expect(p.error).toBeNull();
    expect(p.nodes).toHaveLength(7);
    expect(p.boxes).toHaveLength(2);
    expect(p.edges).toHaveLength(5);
    expect(p.boxes[1]!.collapsed).toBe(true);
    // haul edge is dashed, sourced from a box child, targeting an alias
    const haul = p.edges.find((e) => e.label === 'haul')!;
    expect(haul.dashed).toBe(true);
    expect(haul.heads).toBe('one');
  });
});

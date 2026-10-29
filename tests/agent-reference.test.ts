// ============================================================
// agent-reference.test.ts — moved from dgmo-mcp's reference.test.ts.
//
// Guards the reworked per-type slicer (F4): the old heading-regex slicer
// resolved only 16/45 ids (every hyphenated + grouped data-chart id failed).
// Two layers:
//   1. Unit tests on a small fixture — exact slicing / alias / boundary logic.
//   2. An integration test against the WORKSPACE language-reference.md
//      (dgmo/docs/...) asserting all 45 chart-type ids resolve. (The published
//      node_modules copy lags until a dgmo release + dep bump — AC15 — so the
//      contract is verified against the source of truth, not the stale bundle.)
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chartTypes } from '../src/chart-types';
import {
  extractSection,
  parseTypeAliases,
  extractColorRule,
  extractTitleRule,
  extractCategorizeRule,
  referenceForChartType,
  formatChartTypeList,
  formatExamples,
  isExampleFor,
  EXAMPLES_SHOWN,
} from '../src/agent-reference';

const here = dirname(fileURLToPath(import.meta.url));

const FIXTURE = `# Ref

<!-- TYPE-ALIASES: line=bar pie=bar polar-area=bar -->

## 1. Intro

text

## 3. Sequence

<!-- TYPE:sequence -->

Sequence body.

## 16. Data Charts

<!-- TYPE:bar -->

Bar body across simple charts.

<!-- TYPE:scatter -->

Scatter body.

## 22. Journey Map

<!-- TYPE:journey-map -->

Journey body.

## 26. Colon Summary

Trailing section with no TYPE marker.
`;

describe('parseTypeAliases', () => {
  it('parses the alias map', () => {
    const m = parseTypeAliases(FIXTURE);
    expect(m.get('line')).toBe('bar');
    expect(m.get('pie')).toBe('bar');
    expect(m.get('polar-area')).toBe('bar');
    expect(m.size).toBe(3);
  });

  it('returns an empty map when no alias comment exists', () => {
    expect(parseTypeAliases('# nothing here').size).toBe(0);
  });
});

describe('extractSection (anchor-based slicer)', () => {
  it('slices a literal TYPE block, ending at the next TYPE marker', () => {
    const block = extractSection(FIXTURE, 'bar');
    expect(block).toContain('Bar body across simple charts.');
    expect(block).not.toContain('Scatter body.');
    expect(block).not.toContain('Sequence body.');
  });

  it('resolves a hyphenated id (the old slicer failed these)', () => {
    const block = extractSection(FIXTURE, 'journey-map');
    expect(block).toContain('Journey body.');
    // ends at the next H2 (no trailing TYPE marker)
    expect(block).not.toContain('Trailing section');
  });

  it('resolves grouped aliases to the shared block', () => {
    const bar = extractSection(FIXTURE, 'bar');
    expect(extractSection(FIXTURE, 'line')).toBe(bar);
    expect(extractSection(FIXTURE, 'pie')).toBe(bar);
  });

  it('ends a block at the next H2 when no further TYPE marker follows', () => {
    const block = extractSection(FIXTURE, 'journey-map');
    expect(block?.trimEnd().endsWith('Journey body.')).toBe(true);
  });

  it('returns null for an id with neither marker nor alias', () => {
    expect(extractSection(FIXTURE, 'nonexistent')).toBeNull();
  });
});

describe('extractColorRule', () => {
  it('extracts the text between the COLORS markers', () => {
    const md = `pre\n<!-- COLORS start -->\nonly 11 colors\n<!-- COLORS end -->\npost`;
    expect(extractColorRule(md)).toBe('only 11 colors');
  });

  it('returns null when the markers are absent', () => {
    expect(extractColorRule('no markers here')).toBeNull();
  });
});

describe('color rule rides every per-type slice (closed-set contract)', () => {
  const ref = workspaceReference();
  const anchored = ref != null && /<!--\s*TYPE:/.test(ref);

  it('the real reference defines the COLORS block with the closed 11-name list', () => {
    if (!anchored) return;
    const rule = extractColorRule(ref as string);
    expect(rule).toBeTruthy();
    for (const name of [
      'red',
      'orange',
      'yellow',
      'green',
      'blue',
      'purple',
      'teal',
      'cyan',
      'gray',
      'black',
      'white',
    ]) {
      expect(rule).toContain(`\`${name}\``);
    }
    // explicitly names CSS colors as INVALID so the model stops emitting them
    expect(rule).toMatch(/crimson/);
    expect(rule).toMatch(/royalblue/);
    expect(rule).toMatch(/hex/i);
  });
});

describe('title rule rides every per-type slice (always-title contract)', () => {
  const ref = workspaceReference();
  const anchored = ref != null && /<!--\s*TYPE:/.test(ref);

  it('the real reference defines the TITLE block', () => {
    if (!anchored) return;
    const rule = extractTitleRule(ref as string);
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/title/i);
    expect(rule).not.toMatch(/<!--/); // markers stripped from the extracted rule
  });
});

describe('categorize rule rides every per-type slice (color-by-grouping push)', () => {
  const ref = workspaceReference();
  const anchored = ref != null && /<!--\s*TYPE:/.test(ref);

  it('the real reference defines the CATEGORIZE block', () => {
    if (!anchored) return;
    const rule = extractCategorizeRule(ref as string);
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/tag group/i);
    expect(rule).not.toMatch(/<!--/); // markers stripped from the extracted rule
  });
});

// Resolve the workspace reference (source of truth with the new anchors).
function workspaceReference(): string | null {
  const candidates = [join(here, '..', 'docs', 'language-reference.md')];
  for (const p of candidates) if (existsSync(p)) return readFileSync(p, 'utf8');
  return null;
}

describe('integration — all 45 chart-type ids resolve against the real reference (F4/AC6)', () => {
  const ref = workspaceReference();
  const anchored = ref != null && /<!--\s*TYPE:/.test(ref);

  it('found a reference with TYPE anchors', () => {
    // If this fails in a published-only checkout, the dgmo dep predates the
    // anchor rework (AC15) — the workspace source is the contract here.
    expect(
      anchored,
      'no anchored language-reference.md found (workspace dgmo expected)'
    ).toBe(true);
  });

  for (const c of chartTypes) {
    it(`resolves ${c.id}`, () => {
      if (!anchored) return; // guarded by the assertion above
      const block = extractSection(ref as string, c.id);
      expect(block, `no TYPE block for "${c.id}"`).toBeTruthy();
      expect((block ?? '').length).toBeGreaterThan(20);
    });
  }
});

// The slice EXCLUDES the structural opening TYPE marker — it is a doc anchor, not
// DGMO syntax, and the model would echo it verbatim as the first line of output.
describe('extractSection excludes the structural TYPE marker', () => {
  it('a sliced block does not contain a <!-- TYPE:id --> anchor', () => {
    const block = extractSection(FIXTURE, 'bar') ?? '';
    expect(block).toContain('Bar body across simple charts.');
    expect(block).not.toMatch(/<!--\s*TYPE:/);
  });
});

// AC11: authored TIPS reach the per-type MCP slice automatically. This asserts the
// delivery channel for the seed tranche; aliased ids (line→bar) inherit it.
describe('per-type TIPS ride along the MCP slice (AC11)', () => {
  const ref = workspaceReference();
  const anchored = ref != null && /<!--\s*TYPE:/.test(ref);
  // A few seed types known to be authored in this spec + an alias (pie→bar).
  const seededWithTips = ['flowchart', 'map', 'bar', 'sequence', 'gantt'];

  for (const id of seededWithTips) {
    it(`get_language_reference slice for ${id} includes its TIPS block`, () => {
      if (!anchored) return;
      const block = extractSection(ref as string, id) ?? '';
      expect(block).toMatch(/<!--\s*TIPS start\s*-->/);
      expect(block).toMatch(/<!--\s*TIPS end\s*-->/);
    });
  }

  it('an aliased id (pie→bar) inherits the parent block TIPS', () => {
    if (!anchored) return;
    const block = extractSection(ref as string, 'pie') ?? '';
    expect(block).toMatch(/<!--\s*TIPS start\s*-->/);
  });
});

describe('referenceForChartType', () => {
  it('puts the universal rules in front and strips TIPS delimiters', () => {
    const ref = workspaceReference();
    if (!ref) return;
    const s = referenceForChartType(ref, 'sequence');
    expect(s).toBeTruthy();
    expect(s).toContain('---');
    expect(s).not.toMatch(/<!--\s*TIPS/);
    expect(s!.indexOf(extractColorRule(ref)!)).toBe(0);
  });

  it('is null for an unknown type', () => {
    expect(referenceForChartType(FIXTURE, 'nope')).toBeNull();
  });
});

describe('formatChartTypeList', () => {
  it('lists offered types, hides internal ones, marks beta ones', () => {
    const text = formatChartTypeList();
    expect(text).toMatch(/^Supported chart types \(\d+\):\n\n- /);
    for (const c of chartTypes) {
      if ((c as { internal?: boolean }).internal) {
        expect(text).not.toMatch(new RegExp(`^- ${c.id}[ :]`, 'm'));
      }
      if ((c as { beta?: boolean }).beta) {
        expect(text).toContain(`- ${c.id} [beta — expect rough edges]`);
      }
    }
    expect(text).toMatch(/^- sequence: /m);
  });
});

describe('formatExamples', () => {
  const names = ['sequence-basic', 'sequence-auth', 'raci/minimal', 'bar'];
  const read = (n: string) => `${n} source\n`;

  it('lists every name when no type is given', async () => {
    const r = await formatExamples(names, read);
    expect(r.isError).toBe(false);
    expect(r.text).toContain('Available examples (4):');
    expect(r.text).toContain('- raci/minimal');
  });

  it('returns matching sources in dgmo fences', async () => {
    const r = await formatExamples(names, read, 'sequence');
    expect(r.text).toContain(
      '## sequence-auth\n\n```dgmo\nsequence-auth source\n```'
    );
    expect(r.text).not.toContain('bar source');
    expect(isExampleFor('raci/minimal', 'raci')).toBe(true);
    expect(isExampleFor('sequencer', 'sequence')).toBe(false);
  });

  it('caps at EXAMPLES_SHOWN and says so', async () => {
    const many = Array.from({ length: 7 }, (_, i) => `bar-${i}`);
    const r = await formatExamples(many, read, 'bar');
    expect(r.text).toContain(`(Showing ${EXAMPLES_SHOWN} of 7 examples)`);
  });

  it('an unknown type is an error result', async () => {
    const r = await formatExamples(names, read, 'nope');
    expect(r.isError).toBe(true);
  });
});

// #1222: the whiteboard renderer draws in kind bands (spec §39.2), so the slice an
// AI generator reads must say so — "element order is drawing order" is no longer
// true across kinds, and a generator trusting it would reorder lines to no effect.
describe('the whiteboard slice states the kind-band drawing order (#1222)', () => {
  const ref = workspaceReference();
  const anchored = ref != null && /<!--\s*TYPE:/.test(ref);

  it('names the five bands, bottom to top, and file order inside a band', () => {
    if (!anchored) return;
    const block = extractSection(ref as string, 'whiteboard') ?? '';
    expect(block).toMatch(
      /kind bands, bottom to top: images, shapes and sticky notes .*, arrows and lines, text, ink/
    );
    expect(block).toMatch(/Inside a band, file order decides/);
    expect(block).not.toMatch(/Element order is drawing order/);
    expect(block).not.toMatch(/topmost wins/);
  });
});

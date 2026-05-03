import { describe, it, expect } from 'vitest';
import { normalizeName } from '../src/utils/name-normalize';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { parseState } from '../src/graph/state-parser';
import { parseInfra } from '../src/infra/parser';
import { parseERDiagram } from '../src/er/parser';
import { parseClassDiagram } from '../src/class/parser';

// =====================================================================
// Cross-parser equality property test (Universal Name Handling spec § 21)
// =====================================================================
//
// Two complementary properties:
//
// 1. Algorithmic — normalizeName produces the same key for any pair that
//    differs only in case / whitespace / NFC-vs-NFD. The shared utility is
//    the single source of truth, so this is the contract every parser
//    inherits.
//
// 2. Behavioral — every parser that auto-creates entities on first use
//    folds case-only variants of the same label into ONE entity (or, if
//    the parser surfaces duplicates as diagnostics rather than collapsing,
//    emits the corresponding warning/error). Each parser has its own
//    duplicate-handling policy (warn-and-push for B&L, hard error for C4,
//    silent dedup for the rest); we verify the merge is *visible*, not the
//    exact data shape.

describe('normalizeName — algorithmic equality', () => {
  const PAIRS: Array<[string, string]> = [
    ['Cache', 'cache'],
    ['Cache', 'CACHE'],
    ['Cache', '  Cache  '],
    ['Auth Service', 'auth service'],
    ['Auth Service', 'auth   service'],
    ['Auth Service', 'AUTH\tSERVICE'],
    ['Café', 'Café'], // NFC composed vs NFD decomposed
    ['STRAẞE', 'straße'],
    ['Auth Service', 'Auth Service'], // NBSP collapses
    ['Auth Service', 'Auth　Service'], // ideographic space collapses
  ];

  for (const [a, b] of PAIRS) {
    it(`${JSON.stringify(a)} ≡ ${JSON.stringify(b)}`, () => {
      expect(normalizeName(a)).toBe(normalizeName(b));
    });
  }
});

describe('cross-parser case-folding (silent-dedup parsers)', () => {
  // These parsers silently collapse casing variants — same normalized key,
  // single entity in the parsed result.
  const PROBES = [
    {
      name: 'flowchart',
      run: (label: string) =>
        parseFlowchart(`flowchart\n[${label}]\n[${label.toUpperCase()}]`).nodes
          .length,
    },
    {
      name: 'state',
      run: (label: string) =>
        parseState(
          `state\n${label} -> Other\n${label.toUpperCase()} -> Other`
        ).nodes.filter((n) => normalizeName(n.label) === normalizeName(label))
          .length,
    },
    {
      name: 'infra',
      run: (label: string) =>
        parseInfra(`infra\n${label}\n${label.toUpperCase()}`).nodes.filter(
          (n) => normalizeName(n.label) === normalizeName(label)
        ).length,
    },
    {
      name: 'sequence',
      run: (label: string) =>
        parseSequenceDgmo(
          `sequence\n${label} -> Other\n${label.toUpperCase()} -> Other`
        ).participants.filter(
          (p) => normalizeName(p.id) === normalizeName(label)
        ).length,
    },
  ];

  const SINGLE_WORD_LABELS = ['Cache', 'Order', 'Auth', 'Database', 'Service'];

  for (const probe of PROBES) {
    describe(probe.name, () => {
      for (const label of SINGLE_WORD_LABELS) {
        it(`folds ${JSON.stringify(label)} and ${JSON.stringify(label.toUpperCase())} to one entity`, () => {
          expect(probe.run(label)).toBe(1);
        });
      }
    });
  }
});

describe('cross-parser case-folding (diagnostic-emitting parsers)', () => {
  // These parsers warn or error on duplicate names rather than collapsing.
  // Verify the diagnostic fires — that proves normalization caught the
  // collision.
  const SINGLE_WORD_LABELS = ['Cache', 'Order', 'Service'];

  for (const label of SINGLE_WORD_LABELS) {
    it(`er: ${label} / ${label.toUpperCase()} merge surfaces as one table`, () => {
      const parsed = parseERDiagram(
        `er\n${label}\n  id\n${label.toUpperCase()}\n  email`
      );
      // ER's getOrCreateTable folds — second declaration adds columns to
      // the first, single table.
      expect(parsed.tables.length).toBe(1);
    });

    it(`class: ${label} / ${label.toUpperCase()} merge surfaces as one class`, () => {
      const parsed = parseClassDiagram(
        `class\n${label}\n${label.toUpperCase()}`
      );
      expect(parsed.classes.length).toBe(1);
    });
  }
});

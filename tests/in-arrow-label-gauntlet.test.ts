// ============================================================
// In-Arrow Label Gauntlet (spec: tech-spec-in-arrow-message-gauntlet.md)
// ============================================================
//
// One shared array of tricky label cases run against every chart type that
// supports in-arrow messages. Adding a new chart with in-arrow syntax means
// wiring it into CHART_RUNNERS below; any missing coverage fails the
// "registry sanity" test. Failures in this file indicate divergence from
// the canonical in-arrow label character-set contract (TD-1..TD-14).
//
// Each case declares a label and a per-chart expected outcome:
//   { kind: 'label', label: string | undefined }  -- parse succeeds
//   { kind: 'error', code: DiagnosticCode }       -- parse emits diagnostic
//
// Missing expected entries mean "not applicable to that chart" (e.g. ER
// cannot express dashes in its label per INDENT_REL_RE).

import { describe, it, expect } from 'vitest';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { parseState } from '../src/graph/state-parser';
import { parseInfra } from '../src/infra/parser';
import { parseC4 } from '../src/c4/parser';
import { parseERDiagram } from '../src/er/parser';
import { parseClassDiagram } from '../src/class/parser';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { ARROW_DIAGNOSTIC_CODES } from '../src/utils/arrows';

// ============================================================
// Gauntlet fixture shape
// ============================================================

type DiagnosticCode =
  (typeof ARROW_DIAGNOSTIC_CODES)[keyof typeof ARROW_DIAGNOSTIC_CODES];

type ExpectedOutcome =
  | { kind: 'label'; label: string | undefined }
  | { kind: 'error'; code: DiagnosticCode };

type ChartName =
  | 'sequence'
  | 'flowchart'
  | 'state'
  | 'infra'
  | 'c4'
  | 'er'
  | 'class'
  | 'boxes-and-lines';

type GauntletCase = {
  /** Label text under test (what goes between the arrow delimiters). */
  label: string;
  /** Default expected outcome. Per-chart overrides go in `override`. */
  expected: ExpectedOutcome;
  /** Charts that handle this case differently from the default. */
  override?: Partial<Record<ChartName, ExpectedOutcome>>;
  /** Charts that cannot express this label at all (skipped). */
  skip?: ChartName[];
  notes?: string;
};

// ============================================================
// Per-chart parser runners
// ============================================================
//
// Each runner takes a label string and returns either:
//   { label: string | undefined }   -- what the parser extracted
//   { errorCode: string }            -- the first matching E_* diagnostic
//
// Runners wrap the label in a minimal valid chart snippet that yields
// exactly one in-arrow edge, then extract the parser's view of that edge.

type RunResult =
  | { kind: 'label'; label: string | undefined }
  | { kind: 'error'; errorCode: DiagnosticCode }
  | { kind: 'no-edge' }; // parser produced zero edges AND no recognized error

const ARROW_CODE_SET: readonly DiagnosticCode[] = [
  ARROW_DIAGNOSTIC_CODES.ARROW_SUBSTRING_IN_LABEL,
  ARROW_DIAGNOSTIC_CODES.CONTROL_CHAR_IN_LABEL,
];

function firstGauntletDiagnostic(
  diagnostics: { code?: string }[]
): DiagnosticCode | null {
  for (const d of diagnostics) {
    if (d.code && (ARROW_CODE_SET as readonly string[]).includes(d.code)) {
      return d.code as DiagnosticCode;
    }
  }
  return null;
}

function asLabel(label: string | undefined | null): RunResult {
  return { kind: 'label', label: label ?? undefined };
}

function runSequence(label: string): RunResult {
  const src = `sequence\nA -${label}-> B`;
  const parsed = parseSequenceDgmo(src);
  const errorCode = firstGauntletDiagnostic(parsed.diagnostics);
  if (errorCode) return { kind: 'error', errorCode };
  const msg = parsed.messages[0];
  if (!msg) return { kind: 'no-edge' };
  return asLabel(msg.label || undefined);
}

function runFlowchart(label: string): RunResult {
  const src = `flowchart\n[A] -${label}-> [B]`;
  const parsed = parseFlowchart(src);
  const errorCode = firstGauntletDiagnostic(parsed.diagnostics);
  if (errorCode) return { kind: 'error', errorCode };
  const edge = parsed.edges[0];
  if (!edge) return { kind: 'no-edge' };
  return asLabel(edge.label);
}

function runState(label: string): RunResult {
  const src = `state\nA -${label}-> B`;
  const parsed = parseState(src);
  const errorCode = firstGauntletDiagnostic(parsed.diagnostics);
  if (errorCode) return { kind: 'error', errorCode };
  const edge = parsed.edges[0];
  if (!edge) return { kind: 'no-edge' };
  return asLabel(edge.label);
}

function runInfra(label: string): RunResult {
  const src = `infra\nA\n  -${label}-> B`;
  const parsed = parseInfra(src);
  const errorCode = firstGauntletDiagnostic(parsed.diagnostics);
  if (errorCode) return { kind: 'error', errorCode };
  const edge = parsed.edges[0];
  if (!edge) return { kind: 'no-edge' };
  // infra uses empty string when label is missing; normalize to undefined.
  return asLabel(edge.label ? edge.label : undefined);
}

function runC4(label: string): RunResult {
  const src = `c4\nA is a system\n  -${label}-> B`;
  const parsed = parseC4(src);
  const errorCode = firstGauntletDiagnostic(parsed.diagnostics);
  if (errorCode) return { kind: 'error', errorCode };
  const rel = parsed.elements[0]?.relationships[0];
  if (!rel) return { kind: 'no-edge' };
  return asLabel(rel.label);
}

function runER(label: string): RunResult {
  // ER uses symbolic cardinality: 1-label-*. Labels cannot contain dashes.
  const src = `er\ntable_a\n  1-${label}-* table_b`;
  const parsed = parseERDiagram(src);
  const errorCode = firstGauntletDiagnostic(parsed.diagnostics);
  if (errorCode) return { kind: 'error', errorCode };
  const rel = parsed.relationships[0];
  if (!rel) return { kind: 'no-edge' };
  return asLabel(rel.label);
}

function runClass(label: string): RunResult {
  // Class uses symbolic arrows: --|> Target label.
  const src = `class\nFoo\n  --|> Bar ${label}`;
  const parsed = parseClassDiagram(src);
  const errorCode = firstGauntletDiagnostic(parsed.diagnostics);
  if (errorCode) return { kind: 'error', errorCode };
  const rel = parsed.relationships[0];
  if (!rel) return { kind: 'no-edge' };
  return asLabel(rel.label);
}

function runBoxesAndLines(label: string): RunResult {
  // `[...]` in boxes-and-lines is group syntax; use plain identifiers.
  const src = `boxes-and-lines\nA -${label}-> B`;
  const parsed = parseBoxesAndLines(src);
  const errorCode = firstGauntletDiagnostic(parsed.diagnostics);
  if (errorCode) return { kind: 'error', errorCode };
  const edge = parsed.edges[0];
  if (!edge) return { kind: 'no-edge' };
  return asLabel(edge.label);
}

const CHART_RUNNERS: Record<ChartName, (label: string) => RunResult> = {
  sequence: runSequence,
  flowchart: runFlowchart,
  state: runState,
  infra: runInfra,
  c4: runC4,
  er: runER,
  class: runClass,
  'boxes-and-lines': runBoxesAndLines,
};

const CHART_NAMES = Object.keys(CHART_RUNNERS) as ChartName[];

// ============================================================
// Gauntlet cases (~70 label cases across 8 categories)
// ============================================================

function lbl(label: string): ExpectedOutcome {
  return { kind: 'label', label };
}
function err(code: DiagnosticCode): ExpectedOutcome {
  return { kind: 'error', code };
}

const CASES: GauntletCase[] = [
  // --- happy-path punctuation (TD-1 plain text) ---
  { label: 'location[]', expected: lbl('location[]') },
  { label: 'a[b]c', expected: lbl('a[b]c') },
  { label: '{json}', expected: lbl('{json}') },
  { label: '(parenthetical)', expected: lbl('(parenthetical)') },
  { label: 'a|b', expected: lbl('a|b') },
  { label: 'a*b', expected: lbl('a*b') },
  { label: 'a_b', expected: lbl('a_b') },
  { label: '`code`', expected: lbl('`code`') },
  { label: 'a<b>c', expected: lbl('a<b>c') },
  { label: 'a&b', expected: lbl('a&b') },
  { label: '"quoted"', expected: lbl('"quoted"') },
  { label: "'apostrophe'", expected: lbl("'apostrophe'") },
  { label: 'a,b,c', expected: lbl('a,b,c') },
  { label: 'a;b', expected: lbl('a;b') },
  { label: 'a=b', expected: lbl('a=b') },
  { label: 'a+b', expected: lbl('a+b') },
  { label: 'a/b', expected: lbl('a/b') },

  // Single-character labels
  { label: 'a', expected: lbl('a') },
  { label: '1', expected: lbl('1') },
  { label: '*', expected: lbl('*') },
  { label: '[', expected: lbl('[') },
  { label: ']', expected: lbl(']') },
  { label: '{', expected: lbl('{') },
  { label: '}', expected: lbl('}') },
  { label: '|', expected: lbl('|') },

  // Digits
  { label: '123', expected: lbl('123') },
  { label: '1 to many', expected: lbl('1 to many') },

  // Bare color names — now valid labels per TD-4 on flowchart/state
  {
    label: 'red',
    expected: lbl('red'),
  },
  {
    label: 'blue',
    expected: lbl('blue'),
  },
  {
    label: 'green',
    expected: lbl('green'),
  },

  // Semantic keywords still trigger inferArrowColor on flowchart/state —
  // the label text is preserved, the edge additionally gets an inferred
  // color. This pre-dates the gauntlet spec and is NOT a TD-4 concern
  // (TD-4 is about parentheses-less color *suffixes* being labels, not
  // about semantic inference). Gauntlet asserts the label round-trips
  // regardless of whether a color was inferred.
  { label: 'yes', expected: lbl('yes') },
  { label: 'no', expected: lbl('no') },
  { label: 'maybe', expected: lbl('maybe') },

  // --- Unicode labels (TD-7 preserve-as-is) ---
  { label: 'café', expected: lbl('café') },
  { label: '日本語', expected: lbl('日本語') },
  { label: '한국어', expected: lbl('한국어') },
  { label: 'עברית', expected: lbl('עברית') },
  { label: 'العربية', expected: lbl('العربية') },
  { label: 'hello שלום world', expected: lbl('hello שלום world') },
  { label: '🎉', expected: lbl('🎉') },
  { label: '👨\u200D👩\u200D👧', expected: lbl('👨\u200D👩\u200D👧') },
  {
    label: 'foo\u200Bbar',
    expected: lbl('foo\u200Bbar'),
    notes: 'ZWSP preserved (TD-8)',
  },
  {
    label: 'foo\u00A0bar',
    expected: lbl('foo\u00A0bar'),
    notes: 'NBSP preserved (TD-8)',
  },

  // --- Whitespace preservation (TD-8) + empty normalization (TD-10) ---
  {
    label: 'foo    bar',
    expected: lbl('foo    bar'),
    notes: 'internal runs preserved, NOT collapsed',
  },
  {
    label: 'foo\tbar',
    expected: lbl('foo\tbar'),
    notes: 'tab preserved inside label',
  },
  {
    label: '   leading-trim   ',
    expected: lbl('leading-trim'),
    notes: 'AC-11: leading/trailing whitespace trimmed',
  },
  {
    label: '   ',
    expected: lbl(undefined),
    notes: 'AC-12: whitespace-only label normalizes to undefined (TD-10)',
    // Several chart-specific tokenizers treat a whitespace-only label
    // as "no in-arrow label" and never run through parseInArrowLabel.
    // Those charts return `no-edge` or fall back to bare-arrow behavior
    // which is out of scope here — skip them.
    skip: ['infra', 'c4', 'boxes-and-lines', 'er', 'class'],
  },

  // --- Forbidden (TD-13 / TD-14) ---
  //
  // AC-9: `E_ARROW_SUBSTRING_IN_LABEL` is verified end-to-end through the
  // symbolic parsers (class and er) because they extract labels via their
  // own regex and then run `validateLabelCharacters` directly — there's no
  // arrow-tokenizer intervention to interfere. For the chain-tokenizing
  // charts (sequence/flowchart/state/etc.) the inner `->` is absorbed as a
  // second arrow by their own tokenizer before the validator runs, so the
  // end-to-end diagnostic would have a different code. The helper-level
  // behavior is covered by direct unit tests in `arrows-in-arrow-label.test.ts`.
  {
    label: 'uses ~> chain',
    expected: err(ARROW_DIAGNOSTIC_CODES.ARROW_SUBSTRING_IN_LABEL),
    // `class` uses `--|> Target label` so the label is everything after
    // the target name; `~>` inside it survives to `validateLabelCharacters`.
    // `er` uses `1-label-* target` so the label is between `1-` and `-*`;
    // `~>` survives to the validator.
    // Other charts run the label through their arrow tokenizer first, which
    // absorbs `~>` as a second arrow token; the diagnostic they emit is not
    // `E_ARROW_SUBSTRING_IN_LABEL`. Skip them here; helper unit tests cover
    // the validator path in isolation.
    skip: ['sequence', 'flowchart', 'state', 'infra', 'c4', 'boxes-and-lines'],
    notes: 'AC-9 end-to-end via class and er symbolic parsers.',
  },
  {
    label: 'has\u0000nul',
    expected: err(ARROW_DIAGNOSTIC_CODES.CONTROL_CHAR_IN_LABEL),
  },
];

// Charts that cannot accept dashes in labels (ER uses `-{1,2}` as delimiter).
const NO_DASH_IN_LABEL: ChartName[] = ['er'];

// Charts that split on `|` as pipe metadata before arrow parsing.
// A `|` inside the label is eaten as a metadata separator in these charts.
const NO_PIPE_IN_LABEL: ChartName[] = [
  'sequence',
  'c4',
  'boxes-and-lines',
  'infra',
];

// Helper: decide applicability of a case to a chart.
function caseApplies(gc: GauntletCase, chart: ChartName): boolean {
  if (gc.skip?.includes(chart)) return false;
  const outcome = gc.override?.[chart] ?? gc.expected;
  // ER-specific filter: any label containing a dash is unparseable there
  // because INDENT_REL_RE uses `-{1,2}` as hard delimiters.
  if (NO_DASH_IN_LABEL.includes(chart) && gc.label.includes('-')) return false;
  // Charts that split on `|` metadata pre-arrow-parse cannot preserve a `|`
  // inside a label — the chart's own tokenizer strips it.
  if (NO_PIPE_IN_LABEL.includes(chart) && gc.label.includes('|')) return false;
  return Boolean(outcome);
}

function expectedFor(gc: GauntletCase, chart: ChartName): ExpectedOutcome {
  return gc.override?.[chart] ?? gc.expected;
}

// ============================================================
// The gauntlet
// ============================================================

describe('In-Arrow Label Gauntlet (spec: in-arrow-message-gauntlet)', () => {
  for (const chart of CHART_NAMES) {
    const runner = CHART_RUNNERS[chart];
    const applicable = CASES.filter((gc) => caseApplies(gc, chart));

    describe(`${chart} (${applicable.length} cases)`, () => {
      it('has at least one applicable gauntlet case', () => {
        expect(applicable.length).toBeGreaterThan(0);
      });

      for (const gc of applicable) {
        const exp = expectedFor(gc, chart);
        const caseName = JSON.stringify(gc.label);
        it(`${caseName} → ${exp.kind === 'label' ? `label=${JSON.stringify(exp.label)}` : `error=${exp.code}`}`, () => {
          const r = runner(gc.label);
          if (exp.kind === 'label') {
            // F2 fix: reject silent no-edge as a passing result even when
            // the expected label is `undefined`. The parser must produce
            // an edge (or an explicit recognized error) for the test to pass.
            if (r.kind === 'no-edge') {
              throw new Error(
                `expected label ${JSON.stringify(exp.label)} but parser produced zero edges and zero diagnostics`
              );
            }
            if (r.kind === 'error') {
              throw new Error(
                `expected label but got error code ${r.errorCode}`
              );
            }
            expect(r.label).toBe(exp.label);
          } else {
            if (r.kind !== 'error' || r.errorCode !== exp.code) {
              throw new Error(
                `expected error ${exp.code} but got ${JSON.stringify(r)}`
              );
            }
          }
        });
      }
    });
  }

  // AC-13: every registered chart has at least one gauntlet case wired.
  it('AC-13: every chart in the registry has gauntlet coverage', () => {
    for (const chart of CHART_NAMES) {
      const applicable = CASES.filter((gc) => caseApplies(gc, chart));
      expect(applicable.length).toBeGreaterThan(0);
    }
  });
});

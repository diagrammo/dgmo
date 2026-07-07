// ============================================================
// Diagnostic Registry — the single enumerable catalog
// ============================================================
//
// Every coded diagnostic dgmo can emit is declared as a `DiagnosticSpec`
// (see `diagnostics.ts`). This module aggregates the per-chart spec
// arrays plus the universal (chart-agnostic) codes into one flat list.
//
// `listDiagnosticCodes()` is the public entry point every consumer uses
// to enumerate the catalog: the CLI `diagnostics` subcommand, the
// console error-review surface, MCP `validate_diagram`, and the spec
// docs. Keeping one source of truth is what keeps parser output and the
// language spec's error catalog from drifting.
//
// A completeness test (`tests/diagnostics-registry.test.ts`) asserts
// that every `E_`/`W_`/`I_` code literal in `src/**` appears here with a
// severity matching its prefix — so a new code can't be added without
// being cataloged.

import type { DiagnosticSpec } from './diagnostics';
import { nameMergedMessage, emptyMetadataValueMessage } from './diagnostics';
import { SWIMLANE_DIAGNOSTICS } from './swimlane/diagnostics';
import { RACI_DIAGNOSTICS } from './raci/diagnostics';
import { TREEMAP_DIAGNOSTICS } from './treemap/diagnostics';
import { EVENT_LINE_DIAGNOSTICS } from './event-line/diagnostics';
import { VERSION_CONTROL_DIAGNOSTICS } from './version-control/diagnostics';
import { ARROW_DIAGNOSTICS } from './utils/arrows-diagnostics';
import { MAP_DIAGNOSTICS } from './map/diagnostics';
import { PERT_DIAGNOSTICS } from './pert/diagnostics';
import { GRAPH_DIAGNOSTICS } from './graph/diagnostics';
import { COLOR_DIAGNOSTICS } from './colors-diagnostics';
import { SKETCH_DIAGNOSTICS } from './sketch/diagnostics';

// ── Universal codes (chartType: null) ───────────────────────
// Name handling, alias syntax, and metadata grammar apply to every
// chart type, so they carry no owning chart. Canonical wording comes
// from the message builders in `diagnostics.ts` where they exist.

export const UNIVERSAL_DIAGNOSTICS: DiagnosticSpec[] = [
  // ── Universal name handling ──
  {
    code: 'I_NAME_MERGED',
    severity: 'warning',
    chartType: null,
    title: 'Names merged (case/whitespace)',
    message: (p) =>
      nameMergedMessage({
        incomingDisplay: String(p.incomingDisplay ?? 'Backend'),
        incomingLine: Number(p.incomingLine ?? 2),
        existingDisplay: String(p.existingDisplay ?? 'backend'),
        existingLine: Number(p.existingLine ?? 1),
      }),
    hint: 'Use one consistent spelling, or add `# allow-merge` on the line if the merge is intentional.',
    example: 'infra\ninternet\n  -> gw\ngw\n  -> svc\nGW\n  -> svc\n',
  },

  // ── Unified metadata grammar (0.18.0) ──
  {
    code: 'E_TAG_DECLARED_AFTER_CONTENT',
    severity: 'error',
    chartType: null,
    title: 'Tag declared after content',
    message:
      'A `tag` declaration appears after the first content line — declare all tags before any content.',
    hint: 'Move `tag` declarations to the top of the diagram.',
    example: 'block\n[A]\ntag warn red',
  },
  {
    code: 'W_EMPTY_METADATA_VALUE',
    severity: 'warning',
    chartType: null,
    title: 'Empty metadata value',
    message: (p) => emptyMetadataValueMessage(String(p.key ?? 'color')),
    hint: 'Provide a value or remove the key.',
    example: 'mindmap\nRoot color:\n  Child',
  },
];

// ── Aggregate ───────────────────────────────────────────────

const REGISTRY: DiagnosticSpec[] = [
  ...UNIVERSAL_DIAGNOSTICS,
  ...SWIMLANE_DIAGNOSTICS,
  ...RACI_DIAGNOSTICS,
  ...TREEMAP_DIAGNOSTICS,
  ...EVENT_LINE_DIAGNOSTICS,
  ...VERSION_CONTROL_DIAGNOSTICS,
  ...ARROW_DIAGNOSTICS,
  ...MAP_DIAGNOSTICS,
  ...PERT_DIAGNOSTICS,
  ...GRAPH_DIAGNOSTICS,
  ...COLOR_DIAGNOSTICS,
  ...SKETCH_DIAGNOSTICS,
];

/**
 * The full diagnostic catalog, sorted by code. Every coded diagnostic
 * dgmo can emit — its severity, owning chart type, canonical message,
 * fix hint, and a triggering example. This is the enumerable source of
 * truth for the CLI `diagnostics` subcommand, the console error-review
 * surface, MCP, and the language-spec catalog.
 */
export function listDiagnosticCodes(): DiagnosticSpec[] {
  return [...REGISTRY].sort((a, b) => a.code.localeCompare(b.code));
}

/** Look up a single spec by its code, or `undefined` if not cataloged. */
export function getDiagnosticSpec(code: string): DiagnosticSpec | undefined {
  return REGISTRY.find((s) => s.code === code);
}

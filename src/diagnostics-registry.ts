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
import {
  nameMergedMessage,
  aliasReservedKeywordMessage,
  aliasInvalidFormatMessage,
  emptyMetadataValueMessage,
} from './diagnostics';
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
  {
    code: 'E_NAME_RESERVED_CHAR',
    severity: 'error',
    chartType: null,
    title: 'Reserved character in name',
    message:
      'Name contains a reserved character (|, :, edge sigils, or shape brackets) — wrap it in "..." to use it literally.',
    hint: 'Quote the name: "A | B".',
    // Reserved: declared in NAME_DIAGNOSTIC_CODES but no parser currently emits
    // it, so there's no triggering example.
  },

  // ── Universal alias syntax (TD-18) ──
  {
    code: 'E_ALIAS_BEFORE_DECL',
    severity: 'error',
    chartType: null,
    title: 'Alias used before declaration',
    message:
      'Alias token used before its declaration — declare the alias (`Name as x`) before referencing it.',
    hint: 'Move the `as` declaration above its first use.',
  },
  {
    code: 'E_ALIAS_COLLISION',
    severity: 'error',
    chartType: null,
    title: 'Alias collision',
    message:
      'The same alias is bound to two different names — each alias must map to exactly one canonical name.',
    hint: 'Rename one of the aliases.',
  },
  {
    code: 'E_ALIAS_SHADOWS_NAME',
    severity: 'error',
    chartType: null,
    title: 'Alias shadows a name',
    message:
      'Alias literal matches an existing canonical name — pick an alias that is not already a name.',
    hint: 'Choose a distinct alias token.',
  },
  {
    code: 'E_ALIAS_REBINDING',
    severity: 'error',
    chartType: null,
    title: 'Alias rebinding',
    message:
      'The same canonical name was re-declared with a different alias — bind one alias per name.',
    hint: 'Keep a single `Name as x` declaration per name.',
  },
  {
    code: 'E_ALIAS_OF_ALIAS',
    severity: 'error',
    chartType: null,
    title: 'Alias of an alias',
    message:
      'Cannot alias an alias — `pm as p` where `pm` is itself an alias. Alias the canonical name instead.',
    hint: 'Reference the canonical name in the `as` declaration.',
  },
  {
    code: 'E_ALIAS_RESERVED_KEYWORD',
    severity: 'error',
    chartType: null,
    title: 'Alias is a reserved keyword',
    message: (p) => aliasReservedKeywordMessage(String(p.token ?? 'as')),
    hint: 'Pick an alias that is not a reserved keyword.',
  },
  {
    code: 'E_ALIAS_INVALID_FORMAT',
    severity: 'error',
    chartType: null,
    title: 'Invalid alias format',
    message: (p) => aliasInvalidFormatMessage(String(p.token ?? '1x')),
    hint: 'Aliases must start with a letter and be ≤ 12 letters/digits/underscores.',
  },
  {
    code: 'E_ALIAS_AFTER_CANONICAL',
    severity: 'error',
    chartType: null,
    title: 'Alias declared after canonical use',
    message:
      'Canonical name was used plainly before its alias was declared — declare the alias at first mention.',
    hint: 'Add the `as` alias on the name’s first occurrence.',
  },
  {
    code: 'W_ALIAS_CASE_NEAR_MATCH',
    severity: 'warning',
    chartType: null,
    title: 'Alias case near-match',
    message:
      'Reference token differs from a declared alias only in case — did you mean the declared alias?',
    hint: 'Match the alias casing exactly.',
  },
  {
    code: 'W_ALIAS_UNDERUSED',
    severity: 'warning',
    chartType: null,
    title: 'Alias underused',
    message:
      'Alias declared but referenced at most once — the alias adds no brevity here.',
    hint: 'Drop the alias or reference it more than once.',
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
  },
  {
    code: 'W_EMPTY_METADATA_VALUE',
    severity: 'warning',
    chartType: null,
    title: 'Empty metadata value',
    message: (p) => emptyMetadataValueMessage(String(p.key ?? 'color')),
    hint: 'Provide a value or remove the key.',
  },
  {
    code: 'W_ATTRIBUTE_AT_PARENT_INDENT',
    severity: 'warning',
    chartType: null,
    title: 'Attribute at parent indent',
    message:
      'An indented attribute sits at the parent’s indent level, so it attaches to the parent — indent further to attach it to the preceding child.',
    hint: 'Add one more indent level to attach the attribute to the child.',
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

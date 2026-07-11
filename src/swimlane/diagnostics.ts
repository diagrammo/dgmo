// ============================================================
// Swimlane Diagram — Diagnostic Catalog
// ============================================================
//
// Declarative metadata for every coded diagnostic the swimlane parser
// (`src/swimlane/parser.ts`) can emit. This is ADDITIVE — the parser still
// owns emission via its local `push(line, message, code, severity)` helper;
// each entry here mirrors that call site's canonical wording so consumers
// (CLI `diagnostics`, console error-review, MCP `validate_diagram`, spec docs)
// can enumerate the catalog without the parser re-typing wording.
//
// Every message builder tolerates being called with `{}` so the catalog can
// render a representative string with no live params. The parser emits these
// via `emit(SWIMLANE_DX.<KEY>, line, params)` — the message wording lives here
// only, never re-typed at the call site.

import type { DiagnosticSpec } from '../diagnostics';

/** Keyed specs — referenced by the parser's `emit()` call sites. */
export const SWIMLANE_DX = {
  DUPLICATE_NODE: {
    code: 'E_SWIMLANE_DUPLICATE_NODE',
    severity: 'error',
    chartType: 'swimlane',
    title: 'Duplicate node',
    message: (p) => `Duplicate node name '${p.name ?? 'Foo'}'`,
    hint: 'Every node name must be unique across the diagram — rename or remove the second declaration.',
    example: `swimlane T
lane L
L
  Foo
  Foo`,
  },
  UNKNOWN_NODE: {
    code: 'E_SWIMLANE_UNKNOWN_NODE',
    severity: 'error',
    chartType: 'swimlane',
    title: 'Unknown node in edge',
    message: (p) => `Edge references unknown node '${p.node ?? 'Bar'}'`,
    hint: 'Declare the node under a lane before referencing it in a flow arrow.',
    example: `swimlane T
lane L
L
  Foo
Foo -> Bar`,
  },
  AMBIGUOUS_NODE: {
    code: 'E_SWIMLANE_AMBIGUOUS_NODE',
    severity: 'warning',
    chartType: 'swimlane',
    title: 'Ambiguous node reference',
    message: (p) =>
      `Node '${p.node ?? 'Review'}' is declared in more than one lane${
        p.lanes ? ` (${p.lanes})` : ''
      } — qualify it as Lane.${p.node ?? 'Review'}`,
    hint: 'Two lanes hold a node with this name. Prefix the reference with its lane (`Customs.Inspect`) to pick one; resolved to the first match otherwise.',
    example: `swimlane T
lane Customs
  Customs.Inspect -> Harbor.Inspect
lane Harbor
  Harbor.Inspect`,
  },
  UNKNOWN_LANE: {
    code: 'E_SWIMLANE_UNKNOWN_LANE',
    severity: 'error',
    chartType: 'swimlane',
    title: 'Node outside a lane',
    message: (p) =>
      `Node '${p.node ?? 'Foo'}' is not inside a lane — declare a lane first`,
    hint: 'Open a lane context (a bare line matching a declared lane) before the node line.',
    example: `swimlane T
lane L
[Start]
  Foo`,
  },
  NO_LANES: {
    code: 'E_SWIMLANE_NO_LANES',
    severity: 'error',
    chartType: 'swimlane',
    title: 'Phase without lanes',
    message: (p) => `Phase '${p.phase ?? 'Start'}' declared but no lanes exist`,
    hint: 'Declare at least one `lane <Name>` before any `[Phase]` header.',
    example: `swimlane T
[Start]`,
  },
  // One code, many wordings — the call site passes the exact `reason`:
  //   parseNodeToken: 'inclusive gateway (<o …>) is fast-follow', event-based,
  //                   timer|message|signal events; declareNode: 'notes are
  //                   deferred past v1', 'data objects are deferred past v1',
  //                   `${k} events are fast-follow`; addChain: 'message flow
  //                   (~>) is fast-follow'.
  UNSUPPORTED: {
    code: 'E_SWIMLANE_UNSUPPORTED',
    severity: 'error',
    chartType: 'swimlane',
    title: 'Unsupported construct',
    message: (p) =>
      typeof p.reason === 'string' && p.reason
        ? p.reason
        : 'inclusive gateway (<o …>) is fast-follow',
    hint: 'This construct is deferred past v1 / fast-follow — remove it or use a supported shape, event, or flow.',
    example: `swimlane T
lane L
L
  <o Maybe>`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const SWIMLANE_DIAGNOSTICS: DiagnosticSpec[] =
  Object.values(SWIMLANE_DX);

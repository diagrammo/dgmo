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
    hint: 'Within a lane a node name must be unique — rename or remove the second declaration (different lanes may reuse a name).',
    example: `swimlane T
lane L
  Foo
  Foo`,
  },
  UNKNOWN_NODE: {
    code: 'E_SWIMLANE_UNKNOWN_NODE',
    severity: 'error',
    chartType: 'swimlane',
    title: 'Unknown node in edge',
    message: (p) => `Edge references unknown node '${p.node ?? 'Bar'}'`,
    hint: 'A bare-task target must be declared as a line-head in some lane; delimited endpoints ((…)/<…>/[[…]]) auto-create. Check for a typo, or qualify a cross-lane name as Lane.Node.',
    example: `swimlane T
lane L
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
  MESSAGE_SAME_POOL: {
    code: 'E_SWIMLANE_MESSAGE_SAME_POOL',
    severity: 'error',
    chartType: 'swimlane',
    title: 'Message flow inside one pool',
    message: (p) =>
      `'${p.source ?? 'Check'}' and '${p.target ?? 'Pay'}' are ${
        p.pool ? `both in pool '${p.pool}'` : 'not in different pools'
      } — message flow (~>) runs between pools; use -> for flow inside a pool`,
    hint: 'Use `->` (sequence flow) between nodes of one pool. `~>` is for a message sent from one pool to another, and needs `pool` blocks.',
    example: `swimlane T
pool Insurer
  lane Claims
    Check ~> Pay
    Pay`,
  },
  UNKNOWN_TASK_TYPE: {
    code: 'E_SWIMLANE_UNKNOWN_TASK_TYPE',
    severity: 'error',
    chartType: 'swimlane',
    title: 'Unknown task type',
    message: (p) =>
      `Unknown task type '${p.value ?? 'robot'}' — use user, service, manual, script, send or receive`,
    hint: '`type:` picks the marker in a task’s top-left corner. It takes one of six values: user, service, manual, script, send, receive.',
    example: `swimlane T
lane L
  Review type: robot`,
  },
  UNNAMED_GATEWAY: {
    code: 'E_SWIMLANE_UNNAMED_GATEWAY',
    severity: 'error',
    chartType: 'swimlane',
    title: 'Gateway without a name',
    message: (p) =>
      `Gateway '${p.token ?? '<+>'}' has no label — give it a name with 'as' (${p.token ?? '<+>'} as join)`,
    hint: 'An unlabelled gateway needs `as <name>` so other lines can point at it, for example `<+> as join` and later `join -> (Done)`.',
    example: `swimlane T
lane L
  Pay -> <+>`,
  },
  COLLAPSED_POOL: {
    code: 'E_SWIMLANE_COLLAPSED_POOL',
    severity: 'error',
    chartType: 'swimlane',
    title: 'Node in a pool with no lanes',
    message: (p) =>
      `Pool '${p.pool ?? 'Customer'}' has no lanes, so it can only send or receive ~> — put '${p.node ?? 'Call'}' in a lane`,
    hint: 'A pool with no lanes is an outside party, drawn as a collapsed bar. Indent a `lane` under the pool to give it steps, or write only `~> Target` lines under it.',
    example: `swimlane T
pool Customer
  Call -> Hang up`,
  },
  LANE_OUTSIDE_POOL: {
    code: 'E_SWIMLANE_LANE_OUTSIDE_POOL',
    severity: 'error',
    chartType: 'swimlane',
    title: 'Lane outside a pool',
    message: (p) =>
      `Lane '${p.lane ?? 'Finance'}' is outside every pool — indent it under a pool`,
    hint: 'Once a diagram has `pool` lines, every `lane` belongs to one: indent the lane under its pool.',
    example: `swimlane T
pool Insurer
  lane Claims
    Check
lane Finance
  Pay`,
  },
  // One code, many wordings — the call site passes the exact `reason`:
  //   escalation / compensation / conditional events (`(x) escalation`), the
  //   key forms `timer:` / `message:` / `signal:` (a trigger is a trailing
  //   word on an event), and pools combined with `[Phase]` columns.
  UNSUPPORTED: {
    code: 'E_SWIMLANE_UNSUPPORTED',
    severity: 'error',
    chartType: 'swimlane',
    title: 'Unsupported construct',
    message: (p) => {
      const reason: unknown = p.reason;
      return typeof reason === 'string' && reason
        ? reason
        : 'escalation events are not supported';
    },
    hint: 'Remove it, or use a supported event (message, timer, signal, error, terminate), gateway or flow.',
    example: `swimlane T
lane L
  (Late) escalation -> Done
  Done`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const SWIMLANE_DIAGNOSTICS: DiagnosticSpec[] =
  Object.values(SWIMLANE_DX);

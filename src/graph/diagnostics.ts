import type { DiagnosticSpec } from '../diagnostics';

/**
 * Declarative metadata for graph-family (infra + flowchart) diagnostics that
 * are currently emitted as inline literals inside the parsers. Additive only —
 * the parsers remain the source of truth for emission; this array mirrors the
 * exact wording + the ACTUAL runtime severity for tooling/docs.
 */
export const GRAPH_DX = {
  INFRA_NO_ENTRY: {
    // src/infra/parser.ts:1094 — makeDgmoError(..., 'warning', 'W_INFRA_NO_ENTRY')
    code: 'W_INFRA_NO_ENTRY',
    severity: 'warning',
    chartType: 'infra',
    title: 'Infra diagram has no entry point',
    message:
      "Infra diagram has no 'internet' or 'edge' entry point — an infra diagram traces request traffic from an entry inward, so without one nothing carries traffic. Add an 'internet' or 'edge' node and route from it.",
    hint: "Add an 'internet' or 'edge' node and draw an edge from it into the graph.",
    example: `infra
gw
  -> svc
svc
`,
  },
  INFRA_UNREACHABLE: {
    // src/infra/parser.ts:1145 — makeDgmoError(..., 'warning', 'W_INFRA_UNREACHABLE')
    code: 'W_INFRA_UNREACHABLE',
    severity: 'warning',
    chartType: 'infra',
    title: 'Infra node is unreachable from an entry',
    message: (p) =>
      `'${String(p.label ?? '')}' is unreachable from an 'internet'/'edge' entry — no request traffic flows to it, so it's dead on an infra diagram. Connect it downstream of an entry, or remove it.`,
    hint: 'Connect the node downstream of an entry, or remove it.',
    example: `infra

edge
  rps: 1000
  -> A

A
  latency-ms: 10

Orphan
  latency-ms: 20
`,
  },
  FLOWCHART_NODE_SUFFIX: {
    // src/graph/flowchart-parser.ts:329 — makeDgmoError(..., 'warning', 'W_FLOWCHART_NODE_SUFFIX')
    code: 'W_FLOWCHART_NODE_SUFFIX',
    severity: 'warning',
    chartType: 'flowchart',
    title: 'Unsupported text after a flowchart node shape',
    message: (p) =>
      `Ignored unsupported text after a node shape: "${String(
        p.trailing ?? ''
      )}". Flowcharts have no tag groups or node metadata; node colors are assigned automatically by shape (e.g. terminals green/red, decisions yellow). Remove the suffix.`,
    hint: 'Remove the trailing tag/metadata suffix — flowchart node colors come from shape.',
    example: `flowchart
(Start) -> (Denied) s: Denied
`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const GRAPH_DIAGNOSTICS: DiagnosticSpec[] = Object.values(GRAPH_DX);

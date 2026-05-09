// ============================================================
// PERT subpath entry — minimal surface for Web Workers
// ============================================================
//
// `import { simulateCanonical } from '@diagrammo/dgmo/pert'` resolves
// to a tree-shaken bundle that contains only the simulator + types,
// not the full d3/echarts/jsdom dependency chain. Use this entry from
// Web Workers so they don't ship the entire renderer to the worker
// thread.
//
// All public types are re-exported so workers can typecheck against
// `ResolvedPert`, `MonteCarloResult`, etc. without pulling in the
// main `@diagrammo/dgmo` entry.

export {
  mulberry32,
  sampleBetaPert,
  simulateCanonical,
  simulateFast,
  buildSimulationContext,
} from './monte-carlo';

export type { ExpandedActivity, SimulateOptions } from './monte-carlo';

export type {
  MonteCarloResult,
  ParsedPert,
  PertActivity,
  PertEdge,
  PertGroup,
  PertExpandedActivity,
  PertMilestone,
  PertOptions,
  PertDirection,
  ResolvedActivity,
  ResolvedGroup,
  ResolvedPert,
  NodeDetail,
  PertLayoutNode,
  PertLayoutEdge,
  PertLayoutGroup,
  LayoutResult,
} from './types';

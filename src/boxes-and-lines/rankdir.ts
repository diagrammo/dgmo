import type { ParsedBoxesAndLines } from './types';

/**
 * The axis dagre lays out on. `direction-*` names the flow of LINES, and
 * dagre spreads same-rank siblings across that flow. A diagram with no lines
 * puts every box in one rank, so the keyword's only visible effect would be
 * the opposite axis — `direction-lr` stacking boxes into a column (#1999).
 * Without lines, the axis swaps, so `lr` reads as a row and `tb` as a column.
 */
export function layoutRankdir(parsed: ParsedBoxesAndLines): 'LR' | 'TB' {
  const flow = parsed.direction === 'TB' ? 'TB' : 'LR';
  if (parsed.edges.length > 0) return flow;
  return flow === 'TB' ? 'LR' : 'TB';
}

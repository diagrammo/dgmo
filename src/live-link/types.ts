import type { DgmoError } from '../diagnostics';

// ============================================================
// Live link — Parsed Types
// ============================================================
//
// A pointer, not a drawing. The file names a diagram published to Diagrammo
// Cloud; whoever opens it sees the publisher's current version. There are no
// elements, no children and exactly one directive (`url`).

export interface ParsedLiveLink {
  readonly type: 'live-link';
  /**
   * The headline. `null` for the shorthand form (`live-link <id>`), where the
   * title slot carries the target instead of a name — see §38.3.
   */
  readonly title: string | null;
  readonly titleLineNumber: number;
  /**
   * The diagram id, resolved through the shared reference parser. `null` when
   * absent or unparseable. We store the ID and not the URL on purpose:
   * everything downstream fetches by id, and keeping the raw string too would
   * give two representations of one fact.
   */
  readonly id: string | null;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}

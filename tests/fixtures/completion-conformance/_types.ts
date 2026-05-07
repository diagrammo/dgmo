/**
 * Fixture shape for completion-conformance tests.
 * See raci.ts for an annotated example.
 */
export interface ConformanceFixture {
  /** Chart-type id matching COMPLETION_REGISTRY key. */
  chartType: string;

  /** Spec section number (e.g. "24A", "21") — for traceability in failure messages. */
  specSection: string;

  /** The bare keyword that opens the chart on line 1, if any. */
  firstLineKeyword?: string;

  /** Tokens that look like first-line keywords but are intentionally rejected. */
  notFirstLineKeywords?: string[];

  /** Directive names the spec documents (palette/theme added automatically). */
  directives: string[];

  /**
   * Pipe metadata keys, organized by the syntactic context where the pipe
   * appears. Charts with a single context use `node`. Charts with multiple
   * contexts (raci uses `role` and `phase`) declare each separately.
   * Currently the live registry only stores `node` and `edge` — multi-context
   * charts are an open design question this fixture surfaces.
   */
  pipeKeys: {
    node?: string[];
    edge?: string[];
    role?: string[];
    phase?: string[];
    layer?: string[]; // e.g. ring layers, pyramid layers
  };

  /**
   * Optional value-enum assertions. `source: 'palettes'` looks up the
   * palette registry. Inline `values` is an exact match.
   */
  enumChecks?: Array<
    | { directive: string; source: 'palettes' }
    | { directive: string; values: string[] }
  >;

  /**
   * Tokens to exclude from the "stale registry entry" check — useful for
   * intentional internal aliases that the spec doesn't expose. Use sparingly;
   * each entry is a small reason that drift could be hiding.
   */
  allowExtras?: string[];
}

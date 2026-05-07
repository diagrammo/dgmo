/**
 * Fixture shape for highlight-conformance tests.
 *
 * Each fixture supplies a small but representative DGMO source for one chart
 * type, plus a list of (text, role) assertions. The harness runs the source
 * through `highlightDgmo()` and verifies each declared occurrence has the
 * expected role.
 *
 * For tokens that appear multiple times, use `nth` (1-indexed) to pick a
 * specific occurrence. Default is 1 (first match).
 */
export interface HighlightAssertion {
  /** Token text that should appear somewhere in the source. */
  text: string;
  /** Expected role from the highlighter (chartType, keyword, etc.). */
  role: string;
  /** Which occurrence (1-indexed) to assert against. Default 1. */
  nth?: number;
}

export interface HighlightFixture {
  chartType: string;
  /** Spec section number (e.g. "24A") for failure-message traceability. */
  specSection: string;
  /** A small DGMO source that exercises every token role we care about. */
  source: string;
  /** Per-token assertions. */
  assertions: HighlightAssertion[];
}

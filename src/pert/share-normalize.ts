// ============================================================
// PERT — share-link source normalization
// ============================================================
//
// `start-date now` resolves to the host's local date at parse time,
// but a share-link is meant to capture authoring intent — the
// recipient should see the dates the author saw, not "today, wherever
// you are."
//
// This module performs a textual substitution on the DGMO source
// BEFORE compression: any line of the form `start-date now` (with
// optional leading whitespace and trailing comment) becomes
// `start-date <today's local YYYY-MM-DD>`. Other lines pass through
// unchanged.
//
// The substitution lives here, not in `dgmo/src/sharing.ts`, because
// `sharing.ts` is DSL-agnostic by design (compresses any string).

import { formatLocalISODate } from './internal';

const START_DATE_NOW_RE = /^(\s*start-date\s+)now(\s*)$/i;

/**
 * Strip a trailing line-leading-whitespace comment, mirroring
 * parser.ts's `stripTrailingComment`. Used so we can match `now` even
 * when the author wrote `start-date now  # use today's plan`, while
 * preserving the original line shape (including the comment) on
 * substitution.
 */
function splitTrailingComment(line: string): { code: string; comment: string } {
  const m = line.match(/^(.*?)(\s+#.*)$/);
  if (!m) return { code: line, comment: '' };
  // In-bounds by regex match: groups 1 and 2 are guaranteed present.
  return { code: m[1]!, comment: m[2]! };
}

/**
 * Substitute `start-date now` with the host-local resolved date.
 * Pass the result to `encodeDiagramUrl` so the share-link captures
 * the resolved date, not the literal token.
 *
 * Lines without `start-date now` (explicit-date lines, comments,
 * other directives, activity lines containing the word "now") pass
 * through verbatim.
 */
export function normalizePertSourceForShare(dsl: string): string {
  const today = formatLocalISODate(new Date());
  const lines = dsl.split('\n');
  const out: string[] = [];

  for (const line of lines) {
    const { code, comment } = splitTrailingComment(line);
    const m = code.match(START_DATE_NOW_RE);
    if (m) {
      out.push(`${m[1]}${today}${m[2]}${comment}`);
    } else {
      out.push(line);
    }
  }

  return out.join('\n');
}

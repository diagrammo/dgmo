import { ContextTracker, type InputStream, type Stack } from '@lezer/lr';
import type { Tree } from '@lezer/common';
import {
  ChartType,
  Comment,
  TagKeyword,
  DirectiveKeyword,
  ControlKeyword,
  ModifierKeyword,
} from './dgmo.grammar.terms.js';
import {
  CHART_TYPES,
  TAG_KEYWORD,
  DIRECTIVE_KEYWORDS,
  CONTROL_KEYWORDS,
  STATUS_KEYWORDS,
  MODIFIER_KEYWORDS,
} from './keywords';
import { CHART_TYPE_IDS } from '../chart-types';
import { REGISTRY_TOKEN_CHART_TYPES } from '../directives-registry';

// ============================================================
// Document chart type — the parse context (#1734)
// ============================================================
//
// A registry keyword highlights only in the chart types its `chartTypes`
// names, so the specializer has to know the document's chart type. The
// context is that type, read off the first content token: a chart-type name
// there (`kanban Sprint 14`) sets it; anything else leaves the type unknown,
// and an unknown type highlights every keyword, as before. This mirrors
// `parseDgmoChartType`'s first-line rule; its content inference
// (`looksLike*`) is not repeated here.
//
// Encoded as a number so the context is its own hash: incremental parses
// reuse a node only when it was built under the same context, so changing
// the first line's chart type re-specializes every later line. Lezer reads a
// node built before the first context change as hash 0, so 0 must be the
// start context: PENDING is 0, and a chart type is its index plus one.

/** No content token parsed yet — blank lines and comments only. */
const PENDING = 0;
/** The first content token was not a chart-type name. */
const UNKNOWN = -1;

const CHART_TYPE_INDEX = new Map<string, number>(
  CHART_TYPE_IDS.map((id, i) => [id, i + 1])
);

function readToken(input: InputStream, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(input.peek(i));
  return s;
}

/** The context after `term` is shifted as the document's first content token. */
function decide(term: number, text: () => string): number {
  if (term !== ChartType) return UNKNOWN;
  return CHART_TYPE_INDEX.get(text()) ?? UNKNOWN;
}

export const chartTypeContext = new ContextTracker<number>({
  start: PENDING,
  shift(context: number, term: number, stack: Stack, input: InputStream) {
    if (context !== PENDING) return context;
    // Skipped whitespace and newlines are not tree nodes (their ids lie past
    // the node set); a comment line does not decide either.
    if (term >= stack.parser.nodeSet.types.length || term === Comment)
      return context;
    return decide(term, () => readToken(input, stack.pos - input.pos));
  },
  // A node reused from an earlier parse is not shifted token by token, so a
  // reused first line has to decide the context here, from its first leaf.
  // Not observed (2026-11-06, @lezer/lr 1.4.10: the first line sat in a
  // re-parsed buffer in every probe), but nothing in Lezer promises that.
  reuse(context: number, node: Tree, _stack: Stack, input: InputStream) {
    if (context !== PENDING) return context;
    // Positions inside `node` count from its start, where `input` stands.
    const cursor = node.cursor();
    for (;;) {
      if (cursor.firstChild()) continue;
      const { from, to } = cursor;
      const id = cursor.type.id;
      if (id !== Comment && to > from) {
        return decide(id, () => {
          let s = '';
          for (let i = from; i < to; i++)
            s += String.fromCharCode(input.peek(i));
          return s;
        });
      }
      if (!advance(cursor)) return context;
    }
  },
  hash: (context: number) => context,
});

/** Next node in document order, or false at the end of the tree. */
function advance(cursor: ReturnType<Tree['cursor']>): boolean {
  while (!cursor.nextSibling()) if (!cursor.parent()) return false;
  return true;
}

/** Whether `value` highlights as a keyword in the chart type `context` names. */
function inScope(value: string, context: number): boolean {
  if (context <= PENDING) return true;
  const scope = REGISTRY_TOKEN_CHART_TYPES.get(value);
  if (scope === undefined || scope === 'all') return true;
  return scope.has(CHART_TYPE_IDS[context - 1]!);
}

/**
 * Keyword specializer for the Lezer grammar.
 * Called on every Identifier token — returns a specialized term ID
 * or -1 to keep it as a plain Identifier. A registry keyword whose
 * `chartTypes` excludes the document's chart type stays an Identifier.
 */
export function specializeKeyword(value: string, stack?: Stack): number {
  if (CHART_TYPES.has(value)) return ChartType;
  if (!inScope(value, (stack?.context as number | undefined) ?? UNKNOWN))
    return -1;
  if (value === TAG_KEYWORD) return TagKeyword;
  if (DIRECTIVE_KEYWORDS.has(value)) return DirectiveKeyword;
  if (CONTROL_KEYWORDS.has(value)) return ControlKeyword;
  if (STATUS_KEYWORDS.has(value)) return ModifierKeyword;
  if (MODIFIER_KEYWORDS.has(value)) return ModifierKeyword;
  return -1;
}

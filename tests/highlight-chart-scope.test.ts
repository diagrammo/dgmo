/**
 * Chart-type-scoped keyword highlighting (#1734).
 *
 * A registry token highlights as a keyword only in the chart types its
 * `chartTypes` names. The parser learns the chart type from the document's
 * first content token (`editor/tokens.ts`, `chartTypeContext`). These tests
 * pin the first-line rule and the incremental reparse CodeMirror runs on
 * every edit, where reused nodes are kept only under the same context.
 */
import { describe, expect, it } from 'vitest';
import { TreeFragment, type Tree } from '@lezer/common';

import { parser } from '../src/editor/dgmo.grammar.js';
import { highlightDgmo } from '../src/editor/highlight-api';
import { DIRECTIVES_REGISTRY } from '../src/directives-registry';
import { CHART_TYPE_IDS } from '../src/chart-types';

/** Role of the nth occurrence of `word` in `source`. */
function roleOf(source: string, word: string, nth = 1): string | undefined {
  return highlightDgmo(source).filter((t) => t.text === word)[nth - 1]?.role;
}

/** Node names of every occurrence of `word`, read off a parse tree. */
function namesIn(tree: Tree, source: string, word: string): string[] {
  const out: string[] = [];
  tree.iterate({
    enter(n) {
      if (n.node.firstChild === null && source.slice(n.from, n.to) === word)
        out.push(n.name);
    },
  });
  return out;
}

describe('chart-type scope — first line decides', () => {
  it('a token scoped to another chart type is text', () => {
    expect(
      roleOf('kanban Sprint\n[Todo]\n  Review the roles model\n', 'roles')
    ).toBe('default');
  });

  it('a token scoped to this chart type is a keyword', () => {
    expect(roleOf('raci Launch\nroles R A\n', 'roles')).toBe('keyword');
  });

  it('blank lines and comments before the chart type do not decide it', () => {
    expect(roleOf('// header\n\nkanban Sprint\nroles\n', 'roles')).toBe(
      'default'
    );
    expect(roleOf('\n\n// a\n// b\nraci Launch\nroles R\n', 'roles')).toBe(
      'keyword'
    );
  });

  it('a first line naming no chart type highlights every keyword, as before', () => {
    expect(roleOf('Review the roles\nroles\n', 'roles')).toBe('keyword');
  });

  it('a chart-type word later in the first line does not decide it', () => {
    expect(roleOf('My kanban board\nroles\n', 'roles')).toBe('keyword');
  });

  it('a global token stays a keyword in every chart type', () => {
    expect(roleOf('kanban Sprint\nno-title\n', 'no-title')).toBe('keyword');
  });
});

describe('chart-type scope — incremental parses match a fresh parse', () => {
  function reparse(before: string, after: string): Tree {
    const old = parser.parse(before);
    // One replaced range: the shared prefix and suffix are kept.
    let a = 0;
    while (a < before.length && a < after.length && before[a] === after[a]) a++;
    let b = 0;
    while (
      b < before.length - a &&
      b < after.length - a &&
      before[before.length - 1 - b] === after[after.length - 1 - b]
    )
      b++;
    const fragments = TreeFragment.applyChanges(TreeFragment.addTree(old), [
      { fromA: a, toA: before.length - b, fromB: a, toB: after.length - b },
    ]);
    return parser.parse(after, fragments);
  }

  const body = '\n[Todo]\n  Review the roles model\n'.repeat(40);

  it('changing the first line re-specializes every later line', () => {
    const before = 'kanban Sprint' + body;
    const after = 'raci Sprint' + body;
    const tree = reparse(before, after);
    expect(namesIn(tree, after, 'roles')).toEqual(
      namesIn(parser.parse(after), after, 'roles')
    );
    expect(new Set(namesIn(tree, after, 'roles'))).toEqual(
      new Set(['DirectiveKeyword'])
    );
  });

  it('an edit below the first line keeps the chart type', () => {
    const before = 'kanban Sprint' + body;
    const after = before.replace(
      'Review the roles model',
      'Review the roles models'
    );
    const tree = reparse(before, after);
    expect(new Set(namesIn(tree, after, 'roles'))).toEqual(
      new Set(['Identifier'])
    );
  });
});

describe('chart-type scope — registry data', () => {
  const ids = new Set<string>(CHART_TYPE_IDS);

  it('every entry declares its chart types', () => {
    for (const e of DIRECTIVES_REGISTRY) {
      expect(e.chartTypes, e.token).toBeDefined();
      if (e.chartTypes === 'all') continue;
      expect(e.chartTypes.length, e.token).toBeGreaterThan(0);
      for (const t of e.chartTypes)
        expect(ids.has(t), `${e.token}: ${t}`).toBe(true);
    }
  });
});

/**
 * Highlight anti-drift guard — both render paths (Phase 1b, R5).
 *
 * Highlighting flows through two independent paths that can drift apart:
 *
 *   A. **Standalone** (`highlightDgmo()` → `NODE_TO_ROLE` → role styles) used
 *      by the CLI / React / Astro.
 *   B. **Lezer/app** (`dgmoParser` + `dgmoHighlighting` styleTags → CodeMirror
 *      tags → app HighlightStyle) used by the desktop editor.
 *
 * A fix to one can leave the other rendering a token unstyled. These tests
 * assert each path styles every keyword node, so a "vitest-green / app-broken"
 * (or vice-versa) state cannot pass.
 */
import { HighlightStyle } from '@codemirror/language';
import { highlightTree } from '@lezer/highlight';
import { tags } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';

import { dgmoParser } from '../src/editor';
import {
  NODE_TO_ROLE,
  NORD_ROLE_STYLES,
  highlightDgmo,
} from '../src/editor/highlight-api';

// ============================================================
// Path A — standalone: no orphan roles
// ============================================================

describe('highlight roles — standalone path (A)', () => {
  it('every role emitted by NODE_TO_ROLE has a render style', () => {
    for (const role of Object.values(NODE_TO_ROLE)) {
      expect(
        Object.prototype.hasOwnProperty.call(NORD_ROLE_STYLES, role),
        `Role '${role}' is emitted by NODE_TO_ROLE but has no entry in ` +
          `NORD_ROLE_STYLES — it would render unstyled on the standalone path.`
      ).toBe(true);
    }
  });

  it('every post-pass role (propertyName, noteContent, colorAnnotation) has a style', () => {
    for (const role of ['propertyName', 'noteContent', 'colorAnnotation']) {
      expect(Object.prototype.hasOwnProperty.call(NORD_ROLE_STYLES, role)).toBe(
        true
      );
    }
  });

  it('the specializer keyword node types all map to a role', () => {
    for (const node of [
      'ChartType',
      'TagKeyword',
      'DirectiveKeyword',
      'ControlKeyword',
      'ModifierKeyword',
    ]) {
      expect(
        NODE_TO_ROLE[node],
        `Specializer node '${node}' has no NODE_TO_ROLE entry — it would ` +
          `render as default on the standalone path.`
      ).toBeTruthy();
    }
  });
});

// ============================================================
// Path B — Lezer/app: specialized nodes receive a highlight tag
// ============================================================

// A HighlightStyle mapping every tag the grammar's styleTags emits to a
// class. If a specialized node had NO styleTags entry, highlightTree would
// emit no class for it and the assertion below would fail — that is the
// orphan check for the app path.
const probeStyle = HighlightStyle.define([
  { tag: tags.typeName, class: 'tok-type' },
  { tag: tags.keyword, class: 'tok-keyword' },
  { tag: tags.controlKeyword, class: 'tok-control' },
  { tag: tags.modifier, class: 'tok-modifier' },
  { tag: tags.definitionKeyword, class: 'tok-definition' },
  { tag: tags.number, class: 'tok-number' },
]);

/** Return the class highlightTree assigns to the first `text` occurrence. */
function lezerClassOf(source: string, text: string): string | null {
  const tree = dgmoParser.parse(source);
  const idx = source.indexOf(text);
  let found: string | null = null;
  highlightTree(tree, probeStyle, (from, to, classes) => {
    if (found) return;
    if (from <= idx && to >= idx + text.length) {
      found = classes;
    }
  });
  return found;
}

describe('highlight roles — Lezer/app path (B)', () => {
  const cases: { node: string; source: string; text: string; cls: string }[] = [
    {
      node: 'ChartType',
      source: 'flowchart\nA -> B\n',
      text: 'flowchart',
      cls: 'tok-type',
    },
    {
      node: 'DirectiveKeyword',
      source: 'gantt\nstart 2024-01-01\n',
      text: 'start',
      cls: 'tok-keyword',
    },
    {
      node: 'ControlKeyword',
      source: 'sequence\nif ok\n  A -> B\n',
      text: 'if',
      cls: 'tok-control',
    },
    {
      node: 'ModifierKeyword',
      source: 'sequence\nA as Server\n',
      text: 'as',
      cls: 'tok-modifier',
    },
    {
      node: 'TagKeyword',
      source: 'flowchart\ntag Status\n  Red red\n',
      text: 'tag',
      cls: 'tok-definition',
    },
  ];

  for (const c of cases) {
    it(`${c.node} '${c.text}' receives a highlight tag on the Lezer path`, () => {
      const cls = lezerClassOf(c.source, c.text);
      expect(
        cls,
        `Node '${c.node}' (token '${c.text}') produced no highlight class on ` +
          `the Lezer path — missing styleTags entry in highlight.ts would make ` +
          `it render unstyled in the desktop app.`
      ).toContain(c.cls);
    });
  }
});

// ============================================================
// propertyName — known app-only role (no Lezer node)
// ============================================================

describe('highlight roles — propertyName orphan is app-handled', () => {
  it('propertyName is emitted by the standalone path', () => {
    const tokens = highlightDgmo('infra\nAPI\n  latency-ms: 1\n');
    expect(tokens.some((t) => t.role === 'propertyName')).toBe(true);
  });

  // propertyName is NOT a Lezer node (highlight.ts has no entry), so the app
  // styles colon-keys via a dedicated ViewPlugin instead — guarded by
  // diagrammo-app/tests/features/editor/attribute-key-highlight.test.ts.
  it('propertyName has no Lezer tag (styled by the app ViewPlugin instead)', () => {
    const cls = lezerClassOf('infra\nAPI\n  latency-ms: 1\n', 'latency-ms');
    expect(cls).toBeNull();
  });
});

// ============================================================
// DateLiteral — liberal numeric dates highlight whole (§ BL-121)
// ============================================================
//
// Regression guard: `07-11` (and other slash/dash/ISO forms) must tokenize as
// ONE DateLiteral, not `Number Dash Number`. Before the dash arm was added to
// the grammar, `07-11` split — `07` highlighted, `-11` did not.

describe('highlight — liberal date literals stay whole (both paths)', () => {
  const dates = [
    '07-11', // bare MM-DD (the reported bug)
    '5-3', // bare M-D
    '12-31-2026', // US MM-DD-YYYY
    '07-11-26', // MM-DD-YY
    '2026-07-11', // ISO (already worked — guard against regression)
    '2026-07', // ISO year-month
    '1/3', // slash M/D
    '1/2/2026', // slash M/D/YYYY
  ];

  for (const d of dates) {
    it(`standalone: "${d}" is a single number token`, () => {
      // Wrap in a gantt task line so it parses in a realistic context.
      const tokens = highlightDgmo(`gantt\nTask ${d}\n`).filter((t) =>
        (t.text ?? '').trim()
      );
      const match = tokens.find((t) => t.text === d);
      expect(
        match,
        `"${d}" did not survive as a single token — got: ${tokens
          .map((t) => `${t.text}:${t.role}`)
          .join(' ')}`
      ).toBeDefined();
      expect(match?.role).toBe('number');
    });

    it(`lezer/app: "${d}" is one tok-number span`, () => {
      expect(lezerClassOf(`gantt\nTask ${d}\n`, d)).toBe('tok-number');
    });
  }
});

/**
 * Highlight anti-drift guard — coverage spine (Phase 1b, Design A).
 *
 * The conformance harness (highlight-conformance.test.ts) only asserts
 * hand-picked (text, role) pairs. This file closes two gaps it leaves open:
 *
 *  1. **Parser-authority diff (R1).** Each parser's *exported* vocabulary Set
 *     (the real authority — `keywords.ts` is a hand-typed duplicate) must be
 *     covered by the editor keyword sets: a bare token in a specializer-read
 *     Set, a colon `key: value` token in `ATTRIBUTE_KEYS`. A token the parser
 *     accepts but the editor sets don't cover would silently fail to
 *     highlight — this test names it. Derives from the parser Sets, never from
 *     `keywords.ts` itself (would be circular).
 *
 *  2. **Rendered-role spine (R2).** Set membership doesn't prove a token
 *     actually highlights — the tokenizer may split it, or a post-pass may
 *     demote it. These cases run real source lines through `highlightDgmo()`
 *     and assert the *emitted* role, so the T1 infra recategorization and the
 *     keyword wiring can't silently regress (AC7).
 */
import { describe, expect, it } from 'vitest';

import {
  CHART_TYPES,
  DIRECTIVE_KEYWORDS,
  CONTROL_KEYWORDS,
  STATUS_KEYWORDS,
  MODIFIER_KEYWORDS,
  TAG_KEYWORD,
} from '../src/editor/keywords';
import { ATTRIBUTE_KEYS, highlightDgmo } from '../src/editor/highlight-api';
import {
  REGISTRY_DIRECTIVE_TOKENS,
  REGISTRY_CONTROL_TOKENS,
  REGISTRY_COLON_KEY_TOKENS,
  REGISTRY_NON_HIGHLIGHT_TOKENS,
} from '../src/directives-registry';
import { GANTT_KNOWN_OPTIONS, GANTT_KNOWN_BOOLEANS } from '../src/gantt/parser';
import { MAP_DIRECTIVE_SET } from '../src/map/parser';
import { INFRA_TOP_LEVEL_OPTIONS } from '../src/infra/parser';
import { INFRA_BEHAVIOR_KEYS, EDGE_ONLY_KEYS } from '../src/infra/types';

// ============================================================
// Coverage sets derived from the editor keyword sets
// ============================================================

/** Tokens the Lezer specializer (tokens.ts) reclassifies into keyword nodes. */
const SPECIALIZER_BARE = new Set<string>([
  ...CHART_TYPES,
  TAG_KEYWORD,
  ...DIRECTIVE_KEYWORDS,
  ...CONTROL_KEYWORDS,
  ...STATUS_KEYWORDS,
  ...MODIFIER_KEYWORDS,
]);

/**
 * Tokens intentionally NOT highlighted even though a parser accepts them.
 * Each entry is a deliberate, reviewed exclusion (capped — keep it tiny):
 *   - `dependencies`: a gantt boolean that is ON by default, so it is almost
 *     never written bare (authors write `no-dependencies` to turn it OFF, and
 *     THAT highlights). The bare word collides with common English, and the
 *     specializer is context-free (would highlight it in every chart type), so
 *     it stays plain. See keywords.ts STATUS_KEYWORDS comment for the same
 *     prose-collision rationale applied to `new`/`up`/`down`.
 */
const INTENTIONAL_NON_HIGHLIGHT = new Set<string>(['dependencies']);

// ============================================================
// 1. Parser-authority diff (R1)
// ============================================================

interface VocabSource {
  /** Human label for failure messages. */
  name: string;
  tokens: Iterable<string>;
  /** How the token appears in source — gates which coverage set applies. */
  kind: 'bare' | 'colon' | 'either';
}

const PARSER_VOCAB: VocabSource[] = [
  { name: 'gantt KNOWN_OPTIONS', tokens: GANTT_KNOWN_OPTIONS, kind: 'bare' },
  { name: 'gantt KNOWN_BOOLEANS', tokens: GANTT_KNOWN_BOOLEANS, kind: 'bare' },
  { name: 'map DIRECTIVE_SET', tokens: MAP_DIRECTIVE_SET, kind: 'bare' },
  {
    name: 'infra TOP_LEVEL_OPTIONS',
    tokens: INFRA_TOP_LEVEL_OPTIONS,
    kind: 'bare',
  },
  // Behavior + edge keys appear as colon `key: value` node properties, EXCEPT
  // the three slo-* keys which are also bare top-level options (dual-use) —
  // `either` lets them satisfy coverage via the specializer set.
  {
    name: 'infra INFRA_BEHAVIOR_KEYS',
    tokens: INFRA_BEHAVIOR_KEYS,
    kind: 'either',
  },
  { name: 'infra EDGE_ONLY_KEYS', tokens: EDGE_ONLY_KEYS, kind: 'colon' },
];

function isCovered(token: string, kind: VocabSource['kind']): boolean {
  if (INTENTIONAL_NON_HIGHLIGHT.has(token)) return true;
  const bare = SPECIALIZER_BARE.has(token);
  const colon = ATTRIBUTE_KEYS.has(token);
  if (kind === 'bare') return bare;
  if (kind === 'colon') return colon;
  return bare || colon;
}

describe('highlight coverage — parser-authority diff (R1)', () => {
  for (const src of PARSER_VOCAB) {
    for (const token of src.tokens) {
      it(`${src.name}: '${token}' is covered by the editor keyword sets`, () => {
        expect(
          isCovered(token, src.kind),
          `Parser '${src.name}' accepts '${token}' but no editor keyword set covers it ` +
            `(${src.kind === 'colon' ? 'expected in ATTRIBUTE_KEYS' : src.kind === 'bare' ? 'expected in a specializer-read Set' : 'expected in a specializer-read Set OR ATTRIBUTE_KEYS'}). ` +
            `Add it to dgmo/src/editor/keywords.ts or highlight-api.ts ATTRIBUTE_KEYS, ` +
            `or add it to INTENTIONAL_NON_HIGHLIGHT with a documented reason.`
        ).toBe(true);
      });
    }
  }
});

// ============================================================
// 2. Rendered-role spine (R2) — infra recategorization can't regress
// ============================================================

/** Find the role the highlighter actually emits for the nth `text` token. */
function roleOf(source: string, text: string, nth = 1): string | undefined {
  const matches = highlightDgmo(source).filter((t) => t.text === text);
  return matches[nth - 1]?.role;
}

describe('highlight coverage — rendered role (R2)', () => {
  // The 17 keys moved out of DIRECTIVE_KEYWORDS render as propertyName in
  // their colon form (the T1 fix). Render each under a real infra node.
  const MOVED_BEHAVIOR_KEYS = [
    'latency-ms',
    'uptime',
    'instances',
    'max-rps',
    'cache-hit',
    'firewall-block',
    'ratelimit-rps',
    'buffer',
    'drain-rate',
    'retention-hours',
    'partitions',
    'concurrency',
    'duration-ms',
    'cold-start-ms',
    'cb-error-threshold',
    'cb-latency-threshold-ms',
  ];

  for (const key of MOVED_BEHAVIOR_KEYS) {
    it(`infra '${key}: …' renders as propertyName, not keyword`, () => {
      const source = `infra\nAPI\n  ${key}: 1\n`;
      expect(roleOf(source, key)).toBe('propertyName');
    });
  }

  it(`infra edge 'rps: …' renders as propertyName`, () => {
    expect(roleOf('infra\nedge\n  rps: 10000\n', 'rps')).toBe('propertyName');
  });

  it('infra top-level SLO option renders as keyword (bare form kept)', () => {
    expect(roleOf('infra\nslo-availability 0.999\n', 'slo-availability')).toBe(
      'keyword'
    );
  });

  it('stale `mode` is gone — renders as a plain identifier', () => {
    expect(roleOf('flowchart\nmode -> A\n', 'mode')).toBe('default');
  });
});

// ============================================================
// 3. Negative / collision (R3, T10)
// ============================================================

// ============================================================
// 4. Registry wiring (Design B, single-source) — T14 analog
// ============================================================
//
// directives-registry.ts is the single source consumed by both the parsers
// (which derive their membership Sets) and the editor keyword sets (which
// spread its contributions). These assertions guard that the spread wiring
// stays intact — remove a `...REGISTRY_*` spread and this fails, the
// direct-import equivalent of a regen-diff.

// Full inventory snapshot — the specializer keyword sets are now spread
// entirely from the registry. This pins their EXACT contents so the relocation
// (and any future registry edit) cannot silently add or drop a token without a
// visible diff here, even for chart types whose conformance fixtures don't
// assert every token.
const INVENTORY = {
  DIRECTIVE: [
    'abstract',
    'accent',
    'activations',
    'active-tag',
    'animate',
    'bottom-left',
    'bottom-right',
    'caption',
    'circle-nodes',
    'color',
    'columns',
    'components',
    'containers',
    'critical-path',
    'default-confidence',
    'default-latency-ms',
    'default-rps',
    'default-uptime',
    'deployment',
    'direction',
    'direction-counterclockwise',
    'direction-lr',
    'direction-tb',
    'end-date',
    'enum',
    'era',
    'extends',
    'flow-width',
    'hide',
    'holiday',
    'implements',
    'import',
    'interface',
    'inverted',
    'labels',
    'lane',
    'lane-by',
    'locale',
    'marker',
    'max',
    'no-activations',
    'no-cities',
    'no-cluster-pois',
    'no-coastline',
    'no-colorize',
    'no-context-labels',
    'no-dependencies',
    'no-legend',
    'no-name',
    'no-notes',
    'no-percent',
    'no-poi-labels',
    'no-region-heat-value',
    'no-region-labels',
    'no-relief',
    'no-title',
    'no-value',
    'node-detail',
    'notation',
    'order',
    'orientation',
    'orientation-horizontal',
    'orientation-vertical',
    'period',
    'persona',
    'poi',
    'poi-size',
    'region-heat',
    'rings',
    'roles',
    'rotate',
    'rounds',
    'route',
    'rows',
    'scale',
    'scrubber-trials',
    'seed',
    'series',
    'shade',
    'show-blip-legend',
    'show-sub-node-count',
    'show-values',
    'size',
    'size-label',
    'slo-availability',
    'slo-p90-latency-ms',
    'slo-warning-margin',
    'solid-fill',
    'sort',
    'sprint-length',
    'sprint-number',
    'sprint-start',
    'stacked',
    'start',
    'start-date',
    'sub-node-label',
    'tags',
    'technology',
    'time-unit',
    'title',
    'today-marker',
    'top-left',
    'top-right',
    'trend',
    'trials',
    'values',
    'workweek',
    'x',
    'x-axis',
    'x-label',
    'y-axis',
    'y-label',
  ],
  CONTROL: [
    'alert',
    'beats',
    'chart',
    'else',
    'if',
    'image',
    'loop',
    'mobile',
    'modal',
    'nav',
    'note',
    'parallel',
    'progress',
    'skeleton',
    'table',
    'tabs',
    'vs',
  ],
  STATUS: [
    'backlog',
    'blocked',
    'done',
    'in-progress',
    'na',
    'ready',
    'todo',
    'wip',
  ],
  MODIFIER: [
    'aka',
    'alias',
    'as',
    'boolean',
    'date',
    'decimal',
    'default',
    'double-elim',
    'fk',
    'float',
    'int',
    'no-round',
    'no-rounds',
    'nullable',
    'pk',
    'position',
    'seeded',
    'single-elim',
    'text',
    'timestamp',
    'unique',
    'varchar',
  ],
};

describe('highlight coverage — keyword-set inventory snapshot', () => {
  const cases: [string, Set<string>, string[]][] = [
    ['DIRECTIVE_KEYWORDS', DIRECTIVE_KEYWORDS, INVENTORY.DIRECTIVE],
    ['CONTROL_KEYWORDS', CONTROL_KEYWORDS, INVENTORY.CONTROL],
    ['STATUS_KEYWORDS', STATUS_KEYWORDS, INVENTORY.STATUS],
    ['MODIFIER_KEYWORDS', MODIFIER_KEYWORDS, INVENTORY.MODIFIER],
  ];
  for (const [name, set, expected] of cases) {
    it(`${name} contents are unchanged by the registry relocation`, () => {
      expect([...set].sort()).toEqual(expected);
    });
  }
});

describe('highlight coverage — registry wiring (Design B)', () => {
  it('every registry directive token is in DIRECTIVE_KEYWORDS', () => {
    for (const t of REGISTRY_DIRECTIVE_TOKENS) {
      expect(
        DIRECTIVE_KEYWORDS.has(t),
        `'${t}' missing from DIRECTIVE_KEYWORDS`
      ).toBe(true);
    }
  });

  it('every registry control token is in CONTROL_KEYWORDS', () => {
    for (const t of REGISTRY_CONTROL_TOKENS) {
      expect(
        CONTROL_KEYWORDS.has(t),
        `'${t}' missing from CONTROL_KEYWORDS`
      ).toBe(true);
    }
  });

  it('every registry colon-key is in ATTRIBUTE_KEYS', () => {
    for (const t of REGISTRY_COLON_KEY_TOKENS) {
      expect(ATTRIBUTE_KEYS.has(t), `'${t}' missing from ATTRIBUTE_KEYS`).toBe(
        true
      );
    }
  });

  it('registry colon-keys are NOT bare keywords (no double-classification)', () => {
    for (const t of REGISTRY_COLON_KEY_TOKENS) {
      expect(
        DIRECTIVE_KEYWORDS.has(t),
        `'${t}' is a colon-key but also a bare directive — it would never reach ` +
          `the ATTRIBUTE_KEYS colon gate (which only fires on 'default' tokens).`
      ).toBe(false);
    }
  });

  it('registry non-highlight tokens are in NO highlight set', () => {
    for (const t of REGISTRY_NON_HIGHLIGHT_TOKENS) {
      const anywhere =
        DIRECTIVE_KEYWORDS.has(t) ||
        CONTROL_KEYWORDS.has(t) ||
        ATTRIBUTE_KEYS.has(t);
      expect(
        anywhere,
        `'${t}' is marked noHighlight but appears in a highlight set`
      ).toBe(false);
    }
  });
});

describe('highlight coverage — label demotion (R3)', () => {
  // A directive keyword used inside a message label must demote to default —
  // it is content, not a directive. This is the only collision mitigation the
  // context-free specializer allows (label-zone demotion post-pass).
  it("'start' inside an arrow label renders as default, not keyword", () => {
    // Label zone must contain an Identifier ('now') for the demotion pass to
    // treat it as text (vs an offset/lag pattern like `--1w->`).
    const tokens = highlightDgmo('flowchart\nA -start now-> B\n');
    const label = tokens.filter((t) => t.text === 'start');
    expect(label.length).toBeGreaterThanOrEqual(1);
    expect(label[0]!.role).toBe('default');
  });
});

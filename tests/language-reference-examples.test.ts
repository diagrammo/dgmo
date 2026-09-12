// ============================================================
// language-reference-examples.test.ts — the CI fence-parse drift guard.
//
// HARD GATE (user-mandated): no DGMO syntax ships in any AI surface
// unvalidated. Every ```dgmo fence across the AI-instruction surfaces is run
// through parseDgmo (via the shared scripts/lib/fence-validate.mjs — the SAME
// extract+parse path the core generator uses, so generation-time and CI can
// never disagree, AC16) and MUST be 0 errors + 0 (or triaged) warnings.
//
// Created by this spec (Phase 1 / Task P1-B). Phase 2 / Task 8 extends the
// FENCE_FILES list to the generated cores and asserts per-type example
// parse-equivalence. The suite also asserts >=1 fence was collected so it can
// never pass vacuously (F14).
//
// A second block is the no-stale DENYLIST — a scoped, known-regression guard
// that locks in the Phase-1 de-stale sweep (pipe metadata, removed palettes).
// Per Murat/F-notes: the parse gate above is the REAL drift guard (it catches
// any future stale form); the denylist only re-asserts the specific
// regressions just fixed and will NOT catch a novel syntax change.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  extractDgmoFences,
  validateDgmoSource,
  formatDiagnostic,
} from '../scripts/lib/fence-validate.mjs';
import {
  extractTypeBlock,
  extractAiCore,
  listTypeAnchors,
} from '../scripts/lib/ref-anchors.mjs';
import {
  loadExampleIndex,
  resolveExample,
} from '../scripts/lib/example-source.mjs';
import { chartTypes } from '../src/advanced';

// The data-derived common set inlined into every core (must match
// gen-ai-core.mjs's COMMON_N). dgmo-content may be absent in a standalone
// dgmo checkout — guard the identity check on its presence.
const COMMON_IDS = chartTypes.slice(0, 8).map((c) => c.id);
let exampleIndex: Map<string, string> | null = null;
try {
  exampleIndex = loadExampleIndex();
} catch {
  exampleIndex = null;
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..'); // dgmo/

// Files whose ```dgmo fences are gated. language-reference.md is included so
// that when Phase 2 tags its TYPE-block examples they are covered automatically
// (today it has no ```dgmo fences and contributes none).
const FENCE_FILES = [
  'SKILL.md',
  '.cursorrules',
  '.windsurfrules',
  '.github/copilot-instructions.md',
  'docs/ai-integration.md',
  'docs/language-reference.md',
];

// Surfaces that carry the generated DGMO-AI-CORE block.
const GENERATED_CORE_FILES = [
  '.cursorrules',
  '.windsurfrules',
  '.github/copilot-instructions.md',
  'SKILL.md',
  'docs/ai-integration.md',
];

// AI-instruction surfaces scanned by the no-stale denylist. Excludes
// docs/dgmo-language-spec.md (workspace root; carries deliberate
// counter-examples, F17) and the old verbose language-reference.md (fully
// rewritten in Phase 2).
const DENYLIST_FILES = [
  'SKILL.md',
  '.cursorrules',
  '.windsurfrules',
  '.github/copilot-instructions.md',
  'README.md',
  'docs/ai-integration.md',
  '.claude/commands/dgmo.md',
  '.claude/commands/dgmo-diagram-this.md',
  '.claude/commands/dgmo-document-project.md',
];

// Known-regression denylist. Each pattern is a stale form removed at/after
// 0.18.0; a match in any AI surface is a CI failure.
const STALE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // Pipe metadata `| key:` — removed in 0.18.0 (use same-line `key: value`).
  {
    name: 'pipe metadata (| key:)',
    re: /\|\s*(split|t|desc|description|tech|color|fill)\s*:/,
  },
  // Palettes dropped from the registry — their presence implies a stale list.
  {
    name: 'removed palette name',
    re: /\b(solarized|gruvbox|rose-pine|rosé-pine|one-dark|monokai|dracula)\b/,
  },
];

// Docs that SHIP to a reader and hand out a diagram id to copy: the AI-facing
// reference bundled in @diagrammo/dgmo, and the standalone package's npm
// readme. A reader follows these literally, so an id here has to be one that
// could exist. Tests and fixtures are deliberately NOT in this list — a test
// must never name a resolvable id (a preview test resolving a live link on
// every mount was once 97% of all traffic to the public source route), so a
// fake id in a test is correct and a fake id in a doc is not. CHANGELOG.md is
// history and is left alone.
const PUBLISHED_ID_FILES = [
  'docs/language-reference.md',
  'standalone/README.md',
];

// A real Cloud diagram id is `dgm_` + a 26-character ULID, whose alphabet is
// Crockford base32 — no I, L, O or U. `dgm_7f2a91` (6 hex) shipped in this
// reference and on the public docs page for months: it is the wrong SHAPE, so
// it could never have resolved for anybody.
const PUBLISHED_ID_RE = /dgm_[0-9A-Za-z]+/g;
const WELL_FORMED_ID_RE = /^dgm_[0-9A-HJKMNP-TV-Z]{26}$/;

// Ids known to be gone from the Cloud. Shape alone cannot catch these — they
// are well-formed and were once live. This list is what stops the specific
// recurrence: a withdrawn id was swapped out of the blog post and survived in
// four other files for eight days, because nothing looked at the others.
const WITHDRAWN_IDS = new Set([
  'dgm_01KYRFCJZ2BHS18XRBEAZ0Y120', // Stop showing; answers 410 Gone
]);

function readRepoFile(rel: string): string | null {
  try {
    return readFileSync(join(repo, rel), 'utf8');
  } catch {
    return null; // a surface may be absent in some checkouts; skip it
  }
}

interface WarningAllow {
  sourcePath: string;
  code?: string;
  message?: string;
  reason: string;
}
const allowlist: WarningAllow[] = (() => {
  const raw = readRepoFile('tests/fixtures/dgmo-fence-warning-allowlist.json');
  if (!raw) return [];
  return JSON.parse(raw).allow ?? [];
})();

function isAllowed(
  sourcePath: string | undefined,
  w: { code?: string; message: string }
): boolean {
  return allowlist.some(
    (a) =>
      (sourcePath ?? '').includes(a.sourcePath) &&
      ((a.code && a.code === w.code) ||
        (a.message && w.message.includes(a.message)))
  );
}

// Collect all gated fences up front so we can assert non-vacuity.
const collected: Array<{
  source: string;
  line: number;
  sourcePath: string;
  counterExample: boolean;
}> = [];
for (const rel of FENCE_FILES) {
  const content = readRepoFile(rel);
  if (content == null) continue;
  for (const f of extractDgmoFences(content, rel)) {
    collected.push({ ...f, sourcePath: rel });
  }
}

describe('AI-surface ```dgmo fences parse clean (HARD GATE)', () => {
  it('collected at least one fence (non-vacuous, F14)', () => {
    expect(collected.length).toBeGreaterThan(0);
  });

  for (const fence of collected) {
    if (fence.counterExample) continue; // ```dgmo-bad: deliberate, not gated
    const label = `${fence.sourcePath}:${fence.line}`;
    it(`parses clean — ${label}`, () => {
      const { errors, warnings, chartType } = validateDgmoSource(fence.source);
      const errMsgs = errors.map(formatDiagnostic).join('\n  ');
      expect(
        errors.length,
        `${label} (${chartType}) errors:\n  ${errMsgs}`
      ).toBe(0);
      const untriaged = warnings.filter((w) => !isAllowed(fence.sourcePath, w));
      const warnMsgs = untriaged.map(formatDiagnostic).join('\n  ');
      expect(
        untriaged.length,
        `${label} (${chartType}) untriaged warnings:\n  ${warnMsgs}`
      ).toBe(0);
    });
  }
});

describe('Tier-1 retrieval — every chart-type id resolves to a TYPE block (F4/AC6)', () => {
  const refMd = readRepoFile('docs/language-reference.md') ?? '';

  it('every literal TYPE anchor is a real chart-type id (no typos)', () => {
    const ids = new Set(chartTypes.map((c) => c.id));
    const bad = listTypeAnchors(refMd).filter((id) => !ids.has(id));
    expect(bad.length, `unknown anchor id(s): ${bad.join(', ')}`).toBe(0);
  });

  for (const c of chartTypes) {
    it(`resolves ${c.id}`, () => {
      const block = extractTypeBlock(refMd, c.id);
      expect(
        block,
        `no TYPE block resolves for "${c.id}" (anchor or alias missing)`
      ).toBeTruthy();
      expect((block ?? '').length).toBeGreaterThan(20);
    });
  }
});

describe('generated DGMO-AI-CORE blocks are complete + single-sourced (AC4/AC11/AC12)', () => {
  // Internal types (`ChartTypeMeta.internal`) are deliberately absent from the
  // AI core — it is the widest OFFER there is, landing in .cursorrules,
  // SKILL.md and every other surface a model reads. `gen-ai-core.mjs` filters
  // them for the same reason; this mirrors that, rather than asserting the
  // opposite of what the generator does.
  const ids = chartTypes.filter((c) => !c.internal).map((c) => c.id);
  // Extract the generated block from each surface for cross-surface comparison.
  const cores = new Map<string, string>();
  for (const rel of GENERATED_CORE_FILES) {
    const content = readRepoFile(rel);
    if (content == null) continue;
    const m = content.match(
      /<!-- DGMO-AI-CORE:START -->([\s\S]*?)<!-- DGMO-AI-CORE:END -->/
    );
    if (m) cores.set(rel, m[1]);
  }

  it('the source AI-CORE blocks exist and are non-empty (AC12)', () => {
    const refMd = readRepoFile('docs/language-reference.md') ?? '';
    const anti = extractAiCore(refMd, 'ANTIPATTERNS');
    const index = extractAiCore(refMd, 'TYPE-INDEX');
    expect(
      anti && anti.length,
      'AI-CORE:ANTIPATTERNS missing/empty'
    ).toBeTruthy();
    expect(
      index && index.length,
      'AI-CORE:TYPE-INDEX missing/empty'
    ).toBeTruthy();
    const missing = ids.filter((id) => !(index ?? '').includes(`\`${id}\``));
    expect(missing.length, `index missing ids: ${missing.join(', ')}`).toBe(0);
  });

  it('every generated surface carries the core block', () => {
    expect([...cores.keys()].sort()).toEqual([...GENERATED_CORE_FILES].sort());
  });

  for (const rel of GENERATED_CORE_FILES) {
    it(`${rel} core contains all ${ids.length} type-index entries`, () => {
      const core = cores.get(rel) ?? '';
      const missing = ids.filter((id) => !core.includes(`\`${id}\``));
      expect(missing.length, `missing ids: ${missing.join(', ')}`).toBe(0);
    });
  }

  for (const rel of GENERATED_CORE_FILES) {
    it(`${rel} core inlines all ${COMMON_IDS.length} common examples`, () => {
      const core = cores.get(rel) ?? '';
      const missing = COMMON_IDS.filter((id) => !core.includes(`#### ${id}\n`));
      expect(
        missing.length,
        `missing example headers: ${missing.join(', ')}`
      ).toBe(0);
    });
  }

  it('each inlined common example is identical to its dgmo-content source (ADR-7/AC19)', () => {
    if (!exampleIndex) return; // dgmo-content not present (standalone checkout)
    const core = cores.get('.cursorrules') ?? '';
    for (const id of COMMON_IDS) {
      const source = resolveExample(id, exampleIndex);
      expect(source, `no example source for ${id}`).toBeTruthy();
      expect(
        core.includes(source as string),
        `${id} core example diverges from dgmo-content source`
      ).toBe(true);
    }
  });

  it('the anti-patterns + type-index are identical across all surfaces (single source)', () => {
    // Compare the core minus the per-surface depth pointer (the only allowed diff).
    const stripPointer = (s: string) =>
      s.replace(/\*\*Fetch more:\*\*[\s\S]*$/, '').trim();
    const norm = [...cores.values()].map(stripPointer);
    for (let i = 1; i < norm.length; i++) {
      expect(norm[i]).toBe(norm[0]);
    }
  });
});

describe('per-type TIPS blocks are well-formed (authoring-guidance gate, AC12)', () => {
  // Scan the RAW `<!-- TYPE:id -->` blocks (the 35 actual coverage units), NOT
  // the alias-folding chartTypes loop above (which would re-scan parent blocks
  // up to 8×). For every block that HAS a `<!-- TIPS start -->…<!-- TIPS end -->`
  // pair, assert the body is non-empty (after trim) and fence-free. TIPS ship to
  // every MCP client via the per-type slice, so a stray ```dgmo fence or an empty
  // block is a real regression. Blocks without TIPS are skipped — coverage is
  // intentionally partial (Decision 1 / F3). The one deterministic gate added by
  // this spec; NOT a revival of the eval-lane/scorer.
  const refMd = readRepoFile('docs/language-reference.md') ?? '';
  const markers = [...refMd.matchAll(/<!--\s*TYPE:([a-z0-9-]+)\s*-->/g)];

  for (let i = 0; i < markers.length; i++) {
    const id = markers[i][1];
    const start = (markers[i].index ?? 0) + markers[i][0].length;
    const rest = refMd.slice(start);
    const nextType = rest.search(/<!--\s*TYPE:[a-z0-9-]+\s*-->/);
    const nextH2 = rest.search(/^## /m);
    const ends = [nextType, nextH2].filter((n) => n !== -1);
    const blockEnd = ends.length ? start + Math.min(...ends) : refMd.length;
    const block = refMd.slice(start, blockEnd);

    const starts = (block.match(/<!--\s*TIPS start\s*-->/g) ?? []).length;
    const closes = (block.match(/<!--\s*TIPS end\s*-->/g) ?? []).length;
    if (starts === 0 && closes === 0) continue; // no tips — fine, partial coverage

    it(`${id} TIPS block is well-formed, non-empty, fence-free`, () => {
      expect(starts, `${id}: expected exactly one TIPS start`).toBe(1);
      expect(closes, `${id}: expected exactly one TIPS end`).toBe(1);
      const inner = block.match(
        /<!--\s*TIPS start\s*-->([\s\S]*?)<!--\s*TIPS end\s*-->/
      );
      expect(inner, `${id}: TIPS end must follow TIPS start`).toBeTruthy();
      const body = (inner?.[1] ?? '').trim();
      expect(body.length, `${id}: TIPS body is empty`).toBeGreaterThan(0);
      expect(
        /```/.test(body),
        `${id}: TIPS must not contain a \`\`\` code fence`
      ).toBe(false);
    });
  }
});

describe('no stale syntax in AI surfaces (denylist — locks in the de-stale sweep)', () => {
  for (const rel of DENYLIST_FILES) {
    const content = readRepoFile(rel);
    if (content == null) continue;
    for (const { name, re } of STALE_PATTERNS) {
      it(`${rel} has no ${name}`, () => {
        const lines = content.split('\n');
        const hits = lines
          .map((l, i) => ({ l, i: i + 1 }))
          .filter(({ l }) => re.test(l))
          .map(({ l, i }) => `  ${rel}:${i}  ${l.trim()}`);
        expect(hits.length, `stale match(es):\n${hits.join('\n')}`).toBe(0);
      });
    }
  }
});

describe('every diagram id a shipped doc hands out is one that could resolve', () => {
  // Guards the offline half of the question: is this id even the right shape,
  // and is it one we already know is gone? Whether a well-formed unknown id is
  // live needs the network, so it cannot live here — a pre-push gate must not
  // fail on somebody's wifi.
  let scanned = 0;

  for (const rel of PUBLISHED_ID_FILES) {
    const content = readRepoFile(rel);
    if (content == null) continue;

    const found = content.split('\n').flatMap((line, i) =>
      [...line.matchAll(PUBLISHED_ID_RE)].map((m) => ({
        id: m[0],
        line: i + 1,
      }))
    );
    scanned += found.length;

    it(`${rel} names only well-formed diagram ids`, () => {
      const bad = found
        .filter(({ id }) => !WELL_FORMED_ID_RE.test(id))
        .map(({ id, line }) => `  ${rel}:${line}  ${id}`);
      expect(
        bad.length,
        `not \`dgm_\` + a 26-character ULID, so it cannot resolve for a reader:\n${bad.join('\n')}`
      ).toBe(0);
    });

    it(`${rel} names no diagram we have stopped showing`, () => {
      const gone = found
        .filter(({ id }) => WITHDRAWN_IDS.has(id))
        .map(({ id, line }) => `  ${rel}:${line}  ${id}`);
      expect(
        gone.length,
        `withdrawn from the Cloud — a reader gets a tombstone:\n${gone.join('\n')}`
      ).toBe(0);
    });
  }

  // Never pass vacuously: if the extraction breaks, or both files lose their
  // examples, the two assertions above go green having checked nothing.
  it('found at least one diagram id to check', () => {
    expect(scanned).toBeGreaterThan(0);
  });
});

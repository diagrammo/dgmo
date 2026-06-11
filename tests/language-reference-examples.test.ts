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
import { chartTypes } from '@diagrammo/dgmo/advanced';

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
  const ids = chartTypes.map((c) => c.id);
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
    it(`${rel} core contains all 45 type-index entries`, () => {
      const core = cores.get(rel) ?? '';
      const missing = ids.filter((id) => !core.includes(`\`${id}\``));
      expect(missing.length, `missing ids: ${missing.join(', ')}`).toBe(0);
    });
  }

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

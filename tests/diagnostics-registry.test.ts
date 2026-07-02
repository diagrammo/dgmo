// ============================================================
// Diagnostic registry completeness / drift guard
// ============================================================
//
// The registry (`src/diagnostics-registry.ts`) is the single enumerable
// catalog of every coded diagnostic dgmo can emit. This test makes sure
// it stays complete: every `E_`/`W_`/`I_` code literal that appears
// anywhere in `src/**` must be declared in the registry. A new code
// therefore cannot be added to a parser without also being cataloged —
// which is what keeps the console error-review surface, the CLI
// `diagnostics` subcommand, MCP, and the language-spec catalog honest.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listDiagnosticCodes } from '../src/diagnostics-registry';

const SRC = join(process.cwd(), 'src');

/** All `.ts` files under src/ (recursive). */
function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...srcFiles(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Every quoted `E_`/`W_`/`I_` code literal used anywhere in src/. */
function codeLiteralsInSrc(): Map<string, string[]> {
  const re = /['"`]([EWI]_[A-Z0-9_]{2,})['"`]/g;
  const found = new Map<string, string[]>();
  for (const file of srcFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(re)) {
      const code = m[1]!;
      const arr = found.get(code) ?? [];
      arr.push(file);
      found.set(code, arr);
    }
  }
  return found;
}

describe('diagnostic registry', () => {
  const specs = listDiagnosticCodes();
  const registered = new Set(specs.map((s) => s.code));

  it('registers every coded diagnostic literal found in src/', () => {
    const literals = codeLiteralsInSrc();
    const missing: string[] = [];
    for (const [code, files] of literals) {
      if (!registered.has(code)) {
        const rel = files[0]!.replace(SRC, 'src');
        missing.push(`${code} (e.g. ${rel})`);
      }
    }
    expect(
      missing,
      `These diagnostic codes appear in src/ but are not in the registry ` +
        `(add a DiagnosticSpec in the owning chart's diagnostics.ts):\n  ` +
        missing.join('\n  ')
    ).toEqual([]);
  });

  it('has no duplicate codes', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const s of specs) {
      if (seen.has(s.code)) dupes.push(s.code);
      seen.add(s.code);
    }
    expect(dupes).toEqual([]);
  });

  it('every message builder tolerates being called with no params', () => {
    for (const s of specs) {
      const msg = typeof s.message === 'function' ? s.message({}) : s.message;
      expect(typeof msg, `${s.code} message`).toBe('string');
      expect(msg.length, `${s.code} message non-empty`).toBeGreaterThan(0);
    }
  });

  it('every spec carries the fields the catalog UI needs', () => {
    for (const s of specs) {
      expect(s.severity === 'error' || s.severity === 'warning').toBe(true);
      expect(typeof s.title).toBe('string');
      expect(s.title.length).toBeGreaterThan(0);
      // chartType is `string | null` — both are valid; just assert the field exists.
      expect('chartType' in s).toBe(true);
    }
  });

  // Informational only (does NOT fail the build): severity is authored to
  // match the parser's RUNTIME severity, which is the source of truth. A
  // handful of legacy codes carry an `E_` prefix but emit at `warning`
  // (or vice-versa) — a naming debt to reconcile if/when the codes are
  // ever renamed. Surfacing them here documents the debt.
  it('reports codes whose severity disagrees with their prefix', () => {
    const mismatches = specs
      .filter((s) => {
        const prefix = s.code[0];
        if (prefix === 'E') return s.severity !== 'error';
        if (prefix === 'W' || prefix === 'I') return s.severity !== 'warning';
        return false;
      })
      .map((s) => `${s.code} → ${s.severity}`);
    // Not an assertion failure — just visible in test output.
    if (mismatches.length > 0) {
      console.warn(
        `[diagnostics] ${mismatches.length} code(s) with prefix/severity ` +
          `mismatch (runtime severity wins):\n  ${mismatches.join('\n  ')}`
      );
    }
    expect(Array.isArray(mismatches)).toBe(true);
  });
});

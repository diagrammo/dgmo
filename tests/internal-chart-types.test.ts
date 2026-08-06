// The `internal` flag's specification.
//
// 🔴 This file IS the flag (F4). It is honoured at five unrelated edges, and
// without one test tying them together a later refactor drops one and the type
// reappears in the CLI or the completion popup with the suite still green.
//
// Two edges live in other repos and are asserted there:
//   · MCP `list_chart_types`      → dgmo-mcp/tests/tools.test.ts
//   · MCP suggester candidate pool → dgmo-mcp/tests/suggest.test.ts

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chartTypes } from '../src/chart-types';
import { getAllChartTypes, parseDgmo } from '../src/dgmo-router';
import { CHART_TYPES as COMPLETION_CHART_TYPES } from '../src/completion-registry';
import {
  INTERNAL_CHART_TYPE_IDS,
  withoutInternalChartTypes,
} from '../src/utils/offered-types';

const internalIds = INTERNAL_CHART_TYPE_IDS;

describe('internal chart types', () => {
  it('the derived set matches the flag on chartTypes', () => {
    expect([...internalIds].sort()).toEqual(
      chartTypes
        .filter((c) => c.internal)
        .map((c) => c.id)
        .sort()
    );
  });

  it('there is at least one, and live-link is it', () => {
    expect([...internalIds]).toContain('live-link');
  });

  it('AC10: none is offered in the completion popup', () => {
    const offered = new Set(COMPLETION_CHART_TYPES.map((c) => c.name));
    for (const id of internalIds) {
      expect(
        offered.has(id),
        `'${id}' is offered in the completion popup`
      ).toBe(false);
    }
  });

  it('AC12: every one is still in getAllChartTypes() — hidden from people, not the router', () => {
    const all = getAllChartTypes();
    for (const id of internalIds) expect(all).toContain(id);
    // And last, so `chartTypes.slice(0, 8)` — the window feeding
    // language-reference checks and the generated AI core — is unshifted.
    expect(all[all.length - 1]).toBe('live-link');
  });

  it('every one is routable through parseDgmo', () => {
    expect(parseDgmo('live-link dgm_7f2a91').chartType).toBe('live-link');
  });

  it('AC9: `dgmo types` filters through the shared cross-lookup', () => {
    // Asserted on the SOURCE, not on the binary. CI runs `pnpm test` before
    // `pnpm build` and `prebuild` does `rm -rf dist`, so a test gated on
    // `cli/dist/cli.cjs` never runs there — it passed locally only on a stale
    // build, which is the worst kind of green.
    expect(withoutInternalChartTypes(getAllChartTypes())).toEqual(
      getAllChartTypes().filter((id) => !internalIds.has(id))
    );
    for (const id of internalIds) {
      expect(withoutInternalChartTypes(getAllChartTypes())).not.toContain(id);
    }
    // And `cli.ts` really is the caller — a filter nothing uses is a decoration.
    const cliSource = readFileSync(
      join(__dirname, '..', 'src', 'cli.ts'),
      'utf8'
    );
    expect(cliSource).toContain(
      'withoutInternalChartTypes(getAllChartTypes())'
    );
  });

  it('AC9 end-to-end: the built CLI lists no internal type', () => {
    const cli = join(__dirname, '..', 'cli', 'dist', 'cli.cjs');
    if (!existsSync(cli)) {
      // A build artifact, and `pnpm test` does not produce one. The assertion
      // above is the one that always runs; this is the belt to its braces after
      // a local build.
      console.warn('cli/dist/cli.cjs absent — skipping the end-to-end check');
      return;
    }
    const plain = execFileSync('node', [cli, 'types'], { encoding: 'utf8' });
    const json = execFileSync('node', [cli, 'types', '--json'], {
      encoding: 'utf8',
    });
    const listed = new Set<string>(
      (JSON.parse(json) as { chartTypes: { id: string }[] }).chartTypes.map(
        (c) => c.id
      )
    );
    for (const id of internalIds) {
      expect(listed.has(id), `'${id}' is listed by 'dgmo types --json'`).toBe(
        false
      );
      expect(plain, `'${id}' is listed by 'dgmo types'`).not.toMatch(
        new RegExp(`^${id}\\b`, 'm')
      );
    }
  });
});

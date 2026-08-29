# `skipLibCheck: false` Spike

Story 105.NEW-SKIPLIB, spiked 2026-05-21 on top of the
`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` baseline.

## TL;DR

**Recommendation: keep `skipLibCheck: true` in dgmo.** The 6 errors
that surface are all in third-party `.d.ts` files (echarts, elkjs);
none of them indicate problems in dgmo's own code. Fixing them is
upstream work (or patch-package), not a dgmo PR.

## Counts

`tsc --noEmit` with `skipLibCheck: false` on top of every other
strictness flag we ship → **6 errors across 4 third-party files, 0 in
src/**.

| Code   | Count | Meaning                                                                                          |
| ------ | ----: | ------------------------------------------------------------------------------------------------ |
| TS2430 |     4 | Interface incorrectly extends interface (child re-declares a required field with `\| undefined`) |
| TS2536 |     1 | Type 'number' cannot be used to index a generic constraint                                       |
| TS1203 |     1 | Export assignment in an ESM-target module                                                        |

## The 6 errors

### echarts 6.0.0 (5 errors)

1. `index.d.ts:23` — `Export assignment cannot be used when targeting ECMAScript modules`. echarts' top-level index uses CJS-style `export =` instead of `export default`. This is echarts' packaging concern, not dgmo's.

2-3. `echarts.d.ts:5288` + `shared.d.ts:5289` — `GraphSeriesOption incorrectly extends SeriesOption$1<...>`. The child's `focus` field re-declares as `'adjacency' | DefaultEmphasisFocus | undefined`, parent's is `'adjacency' | DefaultEmphasisFocus`. Surfaces only under `exactOptionalPropertyTypes`. Real upstream bug.

4-5. `echarts.d.ts:5397` + `shared.d.ts:5398` — identical pattern for `ChordSeriesOption`.

### elkjs 0.11.1 (1 error)

6. `elk-api.d.ts:119` — `Type 'number' cannot be used to index type T["children"]`. ELK's type-def issue with the generic constraint on `LayoutOptions`. Upstream.

## Why this is a non-fix

- dgmo doesn't author any of these `.d.ts` files. They live in published npm packages.
- Workarounds inside dgmo would either pin to old versions, use patch-package, or scatter `@ts-ignore` over upstream code — all are worse than just leaving `skipLibCheck: true`.
- TypeScript's stance on `skipLibCheck` is essentially "this is what it's for" — third-party `.d.ts` files often lag the language and a strict consumer shouldn't crash on them.

## What this DOES tell us

The four `TS2430` errors in echarts are interesting: they're caused by the same `exactOptionalPropertyTypes` strictness we just turned on. Before eOPT, the union `'adjacency' | DefaultEmphasisFocus | undefined` would have matched `'adjacency' | DefaultEmphasisFocus`. Under eOPT they don't — TS treats `?: T` and `: T | undefined` as different. So our recent eOPT work pushed echarts' type defs into "incorrect extends" territory.

That's worth filing upstream — echarts could fix this by either dropping the `| undefined` re-declaration in `GraphSeriesOption.focus` / `ChordSeriesOption.focus`, or by declaring those slots optional (`focus?:`) to match the eOPT-implied shape.

## Verdict

- **Keep `skipLibCheck: true`** in `dgmo/tsconfig.json` (and in app's tsconfig, which has the same setup).
- File an issue on `apache/echarts` describing the eOPT extends conflict; reference this doc.
- Re-spike whenever bumping echarts / elkjs major to see if upstream fixed it.

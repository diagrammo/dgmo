# `noUncheckedIndexedAccess` Migration Notes

> **Status: Migration complete (2026-05-21).** Epic 106 closed. The flag is now in the main `tsconfig.json`; the parallel `tsconfig.strict.json` and `pnpm typecheck:strict` script have been removed. `pnpm typecheck` now enforces `noUncheckedIndexedAccess` across the whole codebase. The "How to migrate a folder" and "parallel-tsconfig pattern" sections below are kept as historical context for the patterns established — new code should compile clean under the flag from day one.

Working notes for Epic 106 — folder-by-folder migration of dgmo to compile cleanly under TypeScript's `noUncheckedIndexedAccess` flag.

## Why this flag

When `noUncheckedIndexedAccess: true`, TypeScript treats `arr[i]` as `T | undefined` instead of `T`. This catches a real bug class: assuming an index access returns a value when in fact the array could be empty, the key could be missing, or the bounds could be out.

In dgmo's parser/renderer-heavy codebase, this matters because:

- Parsers process untrusted input. "I know `lines[5]` is a string here" is wishful thinking until proven by a length check.
- Map lookups (`nodeMap.get(id)`, `groups[key]`) are intrinsically nullable.
- Several past dgmo bugs were "render did nothing" / "crash on edge input" cases that this flag would have caught at compile time.

`diagrammo-app` already has this flag enabled and compiles clean — proving the pattern is tractable.

## The parallel-tsconfig pattern

A flag flip from 0 → ~1,800 errors isn't a viable PR. Instead:

- `tsconfig.json` (main) — does NOT have `noUncheckedIndexedAccess`. The normal `pnpm typecheck` stays clean throughout the migration.
- `tsconfig.strict.json` (parallel) — extends the main, adds `noUncheckedIndexedAccess: true`, and uses `include` to restrict the strict check to migrated files only.
- `pnpm typecheck:strict` — runs the parallel config.
- CI runs `pnpm typecheck:strict` with `continue-on-error: true`. Informational, not blocking, until Story 106.18.

As a folder migrates, it gets added to `tsconfig.strict.json`'s `include`. When the last folder lands, the flag moves into the main `tsconfig.json` and this parallel config is deleted.

## How to migrate a folder

1. **Spike first** — add the folder to `tsconfig.strict.json`'s `include` array and run `pnpm typecheck:strict`. Count errors.
2. **If small (<50 errors)**, fix them all in one PR. Keep the diff focused — no refactors, no scope creep.
3. **If large (50+ errors)**, the folder might warrant its own story (see Epic 106 tier breakdown).
4. **For each error**, apply the appropriate pattern (below).
5. **Verify** with `pnpm typecheck:strict`, `pnpm test`, and visual smoke test for the affected chart type.
6. **Commit** referencing the Epic 106 story number.

## Common fix patterns

These are the patterns to reach for in order of preference. Match the pattern to the situation; don't reach for a more invasive one when a simpler one fits.

### Pattern 1: Default with `??`

When the missing case has a sensible default:

```typescript
// Before
const color = palette.colors[name];

// After
const color = palette.colors[name] ?? palette.colors.blue;
```

Use when there's a clear fallback. Don't invent a default just to silence the flag.

### Pattern 2: Length guard then index

When you've already checked that the index is valid:

```typescript
// Before
for (let i = 0; i < lines.length; i++) {
  process(lines[i]); // T | undefined under strict
}

// After
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line === undefined) continue; // unreachable but appeases TS
  process(line);
}
```

### Pattern 3: Destructure with default

```typescript
// Before
const first = tokens[0].name;

// After
const [first] = tokens;
if (!first) return;
first.name;
```

### Pattern 4: Map.get() with explicit narrow

```typescript
// Before
const node = nodeMap.get(id);
node.position = ...;  // crash if missing

// After
const node = nodeMap.get(id);
if (!node) throw new ParseError(`Unknown node: ${id}`);
node.position = ...;
```

Use `throw` only when the missing case represents a real bug (not a normal edge case).

### Pattern 5: Tuple-typed array access

When you have a fixed-length structure:

```typescript
// Before
type Point = [number, number];
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// a[0] and b[0] are number | undefined under strict

// After — assert the shape with `as const` if it's a real tuple
type Point = readonly [number, number];
// readonly tuples preserve their length info; index access stays as `number`
```

### Pattern 6: Non-null assertion (last resort)

```typescript
// Use sparingly — only when you can mathematically prove the index is valid
const first = nonEmptyArray[0]!;
```

Don't reach for `!` first. Most cases above are safer.

## Anti-patterns — DO NOT

- **Don't refactor surrounding code "while you're here."** Strictness fixes only. File a separate refactor PR if you see something.
- **Don't change behavior.** Adding `?? defaultValue` is only correct if the default doesn't introduce a new visible behavior. When in doubt, prefer `if (!x) return;` over `x ?? something`.
- **Don't add `as any` or `// @ts-ignore`.** If a fix needs that, file an issue and discuss.
- **Don't bulk-fix with sed/regex.** Each call site needs to be understood.

## Acceptance for each story

A folder is "done" when:

1. The folder is in `tsconfig.strict.json`'s `include`.
2. `pnpm typecheck:strict` runs clean.
3. `pnpm test` passes (no regressions).
4. Visual smoke test for any affected chart types passes.
5. `pnpm gallery:snapshot` (gallery diff) shows no unexpected drift. If there is intentional drift (rare for strictness fixes), `gallery:snapshot:update` first, then verify the diff is sane.
6. The published `dist/*.d.ts` shape (Story 106.2's `pnpm check:api`) shows no breaking changes to consumers.

## Initial include

The seed include is `src/fonts.ts` — a small file of font constants that already compiles clean under the strict flag. As stories land, add folders alphabetically (or in the Epic 106 execution order) to the `include` array.

## Tracking progress

Epic 106 (`docs/epics/epic-106-no-unchecked-indexed-access-dgmo.md`) tracks per-folder status. Update the relevant story's Status field when a folder lands.

Run `npx type-coverage --strict` periodically to track overall progress as a single % metric (Story 105.NEW-METRIC).

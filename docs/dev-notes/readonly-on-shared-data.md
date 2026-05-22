# `readonly` on shared / parsed data

Working notes for Epic 105, Story 105.18.

## Goal

Mark parser output, palette configs, and layout results as `readonly` so the parser → layout → renderer pipeline cannot accidentally mutate shared state. `readonly` is compile-time only (no runtime cost). It primarily documents intent and catches the class of bug where a downstream consumer mutates an input it doesn't own.

## What landed (2026-05-21)

**`src/palettes/types.ts`** — `PaletteColors` and `PaletteConfig` are fully `readonly` (including the nested `colors` map). Typecheck stays clean — palettes were already treated as immutable in practice. This is the safe POC.

## What didn't land — the cascade finding

A second POC on **`ParsedKanban`** (`src/kanban/types.ts`) was tried and reverted. Adding `readonly` to the kanban parser output surfaced **29 errors**:

- **21 in `src/kanban/parser.ts`** — the parser itself mutates `result.columns`, `column.cards`, `result.tagGroups` during construction (expected; the natural construction style is push-as-you-go).
- **7 in `src/kanban/renderer.ts`** — `readonly TagGroup[]` passed to functions that declare `TagGroup[]` (legend layout, drill helpers, etc.). These are *real* invariant leaks: those callees don't actually mutate, they just declared mutable inputs.
- **1 in `src/dgmo-router.ts`** — the `ParseFn` signature in the dispatcher requires a mutable return type.

**The cascade is the lesson.** Making a parser output `readonly` forces `readonly` through everything it touches:

```
ParsedKanban (readonly)
   └── tagGroups: readonly TagGroup[]
         └── consumed by legend-layout, drill-helpers, dispatcher (all need readonly param sigs)
```

Per-chart-type readonly is *not* tractable as isolated stories — the shared substrate (`TagGroup`, `LegendGroupData`, `DgmoError[]`, the dispatcher's `ParseFn`) has to go readonly *first*, then per-chart parser outputs follow easily.

## Recommended follow-up

A future Story (105.18b or similar) should approach this bottom-up:

1. **Shared utility types first** — `TagGroup` / `TagEntry` in `src/utils/tag-groups.ts`, `LegendGroupData` in `src/utils/legend-layout.ts`, `DgmoError[]` consumer signatures in `src/diagnostics.ts`.
2. **Dispatcher signature** — `ParseFn` in `src/dgmo-router.ts` to accept `Readonly<…>` returns.
3. **Per-chart parser outputs** — sweep through one chart-type folder at a time (kanban, class, ring, … in the Epic 106 order). Parser internals construct via a mutable local type, then return as `readonly` via a single cast or `as const` at the top-level return.
4. **Layout result types** — apply `readonly` to layout outputs; renderer consumes them.

Estimated scope: ~3-5 focused sessions if done bottom-up. Each chart type adds 10-30 mutation-site fixes; many resolve mechanically by switching `arr.push(x)` to `arr = [...arr, x]` or by introducing a `Writable<T>` helper for the parser-only mutable phase.

## Pattern: `Writable<T>` helper

For parsers that need to construct mutably then expose readonly, the standard escape hatch is:

```ts
type Writable<T> = { -readonly [K in keyof T]: T[K] };
```

Parser internals work against `Writable<ParsedKanban>`, then return the value typed as `ParsedKanban`. Single-line cast, no runtime cost, no behavior change. Place the helper in `src/utils/` once and import across parsers.

## Validation done

- `pnpm typecheck` clean after palette `readonly`.
- `pnpm test` — 5390 tests pass.
- `pnpm build` clean.
- `pnpm check:api` baseline matches (no public-type-shape leak from palette readonly modifiers — the consumer's view tightens but doesn't add or remove properties).

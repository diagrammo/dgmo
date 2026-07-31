# dgmo — @diagrammo/dgmo

Core library and CLI for the DGMO diagram markup language: parsing, layout, rendering, and the color/palette system. Published to npm as `@diagrammo/dgmo`, consumed by the desktop app, the web editor, Obsidian, the MCP server, and the doc-framework wrappers.

**`docs/dgmo-language-spec.md` in the workspace root is authoritative.** If it isn't in the spec, it isn't valid DGMO — verify against the spec and the parsers, never against fixtures or old examples.

## Commands

```bash
pnpm build            # tsup (ESM + CJS, lib + CLI)
pnpm dev              # tsup --watch  — only ONE may run; racing watchers tear dist/
pnpm test             # Vitest        (test:watch for watch mode)
pnpm typecheck        # tsc --noEmit
./test-cli.sh input.dgmo [args...]   # build + run the CLI in one step
```

```bash
dgmo diagram.dgmo                          # PNG (default)
dgmo diagram.dgmo -o output.svg            # format from extension
dgmo diagram.dgmo --theme dark --palette catppuccin
```

## Structure

One directory per chart type under `src/` (`sequence/`, `map/`, `sketch/`, `treemap/`, `swimlane/`, …) — `ls src/` is the current list, and it changes often enough that a copy here would lie. Each holds its own parser, layout and renderer.

Shared at the root of `src/`:

- `dgmo-router.ts` — dispatches on the first line, or infers from content when absent
- `render.ts` — unified `render()` entry · `cli.ts` → `dist/cli.cjs`
- `data-chart-parser.ts` + `charts-d3/` — the data-chart family (bar, line, pie, scatter, sankey, heatmap, funnel, radar, …), all D3
- `d3.ts` — older shared D3 helpers; newer chart types own their directory instead
- `*-registry.ts` — `chart-type-registry`, `completion-registry`, `diagnostics-registry`, `directives-registry`. **A new chart type or directive registers here**, and several consumers read these registries rather than hard-coding lists
- `palettes/` — one file per palette plus `color-utils.ts`; each palette ships light/dark/transparent themes
- `editor/` — CodeMirror grammar + highlight helpers · `completion.ts` — symbol extraction
- `diagnostics.ts` — `DgmoError`, severity, `suggest()`

## Adding or changing a chart type

Follow `docs/dev-notes/chart-type-checklist.md`. For syntax changes to an existing type, `docs/dev-notes/syntax-change-checklist.md` — it covers spec, parsers, tests, examples, grammars, docs, sync scripts and publishing, and skipping a step here is how the ecosystem drifts.

New chart types don't get `looksLike*` content-inference heuristics — declare the type.

## Output rules

These govern what users see, and are the ones most often broken:

- **No hex codes.** Colors come from the palette; blend with the `mix()` helper
- **Solid fill is never the default** — it's opt-in, and accent indicators need contrast when it's on
- **Never invent syntax**, never use mermaid-style arrows, never use `default` as a tag keyword
- **Never name a rendering library** (D3, ECharts) in user-facing text, docs or errors
- Text that can overflow gets a halo, not a clip

## Rendering constraints

- **resvg does not support CSS `color-mix()`** — use `mix()` in `palettes/color-utils.ts`, which pre-computes hex
- **resvg PNG background:** pass `paletteColors.bg` for light/dark; omit for transparent
- **Fonts:** all renderers import `FONT_FAMILY` from `fonts.ts` (Inter). The CLI feeds resvg the bundled TTFs in `fonts/`; the app and Obsidian load Inter via `@font-face`
- `render()` and the CLI export path must agree — they have diverged before, and the CLI is the one users file bugs about

## Sequence — the two ordering traps

- The parser matches sections **before** closing indent-based blocks. A new element type matched before block closing lands in the wrong container while a block is open — check `blockStack` and close first
- Only the wrapper `<g>` carries `data-line-number` / `data-section`; children must not. Section Y positions accumulate from content above, never anchor to messages below
- No cosmetic indentation; `A <- B` is normalized to `B -> A`; participant order is first-appearance

## Build output

tsup emits dual ESM/CJS: `dist/index.js` + `.d.ts`, `dist/index.cjs` + `.d.cts`, and `dist/cli.cjs`.

🔴 **Adding a subpath export to `package.json` breaks the app's `pnpm dev`** while the production build stays green — the app's dev-mode source alias must learn the new subpath. Update all three lists in `diagrammo-app/vite.base.config.ts`: the dist-entry list, the source alias map, and `optimizeDeps.include`.

## Testing

Vitest with jsdom. One test file per parser/renderer in `tests/`, fixtures in `tests/fixtures/`, snapshots in `tests/__snapshots__/`.

- Snapshots are timezone-sensitive — run with `TZ=UTC` to keep dates deterministic
- Never run a `pnpm dev` watcher concurrently with a build; the shared `dist/` gets torn

## Before committing

Build, run the suite, and **verify visually when the change affects rendering** — render a fixture at the affected palette/theme and look at it. Then say what changed and the exact command or file to re-render to confirm it.

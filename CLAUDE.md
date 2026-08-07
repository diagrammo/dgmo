# dgmo — @diagrammo/dgmo

Core library for the DGMO diagram markup language: parsing, layout, rendering, and the color/palette system. Published to npm as `@diagrammo/dgmo`, consumed by the desktop app, the web editor, Obsidian, the MCP server, and the doc-framework wrappers.

**This repo publishes TWO packages.** `@diagrammo/dgmo` is the library, from the repo root. `@diagrammo/dgmo-cli` is the `dgmo` command, from `cli/` — it carries the `bin`, `@resvg/resvg-js` and the AI editors' rules files, none of which the library has held since 2026-08-06. The source is still `src/cli.ts`; only the manifest and the build output live in `cli/`. Release it with `scripts/release.sh dgmo-cli X.Y.Z`, which tags `cli-vX.Y.Z` so it cannot collide with the library's `v` tags in this same repo.

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
- `render.ts` — unified `render()` entry · `cli.ts` → `cli/dist/cli.cjs` (a separate npm package; see the top of this file)
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
- **Tint is the default; full saturation is opt-in.** Decision #46 replaced the old `solid-fill` boolean with the mutually-exclusive `fill-*` family — `fill-tint` (the default spelled explicitly: 25% tint plus a solid intent-color outline), `fill-solid` (full intent saturation), `fill-outline` (no fill; the intent color rides the outline). Last one wins when several appear. Accent indicators need contrast under `fill-solid`. A chart whose fill **encodes data** ignores the family entirely: map choropleth regions, infra severity tints, gantt progress bars, tech-radar blips. Only `gantt/renderer.ts` still hardcodes `const fillMode = undefined` at renderer entry — infra and tech-radar pass `undefined` at the call site instead, so opting out is a call-site decision, not a renderer-entry one
- **Never invent syntax**, never use mermaid-style arrows, never use `default` as a tag keyword
- **Never name a rendering library** (D3, ECharts) in user-facing text, docs or errors
- Text that can overflow gets a halo, not a clip

## Rendering constraints

- **resvg does not support CSS `color-mix()`** — use `mix()` in `palettes/color-utils.ts`, which pre-computes hex
- **resvg PNG background:** pass `paletteColors.bg` for light/dark; omit for transparent
- **Fonts:** all renderers import `FONT_FAMILY` from `fonts.ts` (Inter). The CLI feeds resvg the bundled TTFs in `fonts/`; the app and Obsidian load Inter via `@font-face`
- `render()` and the CLI share one rendering core (`cli.ts` imports `render` and reimplements only the error-card policy), so they agree by construction — a difference between them means a stale `dist/` or a pinned module in a long-lived server, not a divergent code path. Verified 2026-07-31

## Sequence — the two ordering traps

- The parser matches sections **before** closing indent-based blocks. A new element type matched before block closing lands in the wrong container while a block is open — check `blockStack` and close first
- Only the wrapper `<g>` carries `data-line-number` / `data-section`; children must not. Section Y positions accumulate from content above, never anchor to messages below
- No cosmetic indentation; `A <- B` is normalized to `B -> A`; participant order is first-appearance

## Build output

tsup emits dual ESM/CJS: `dist/index.js` + `.d.ts`, `dist/index.cjs` + `.d.cts`. The CLI goes to **`cli/dist/cli.cjs`**, a different npm package.

🔴 **`cli/` is build output apart from `cli/package.json`.** A `stageCliAssets` step copies `fonts/`, `.cursorrules`, `.windsurfrules`, `SKILL.md`, `.claude/commands/` and `.github/copilot-instructions.md` into it, because `cli.ts` reads them from its own package root and npm's `files` cannot reach above a package directory. Everything staged is gitignored — never edit a file under `cli/` except the manifest, and never add one expecting it to survive `pnpm build`.

🔴 **The CLI bundle INLINES the library** (`noExternal` in the CLI's tsup block), so it does not depend on `@diagrammo/dgmo` at all. That is deliberate: `cli.ts` reaches five modules that are not public exports — `cli-banner`, `map/completion`, `org/resolver`, `pert/share-normalize`, `utils/offered-types` — so depending on the package would mean widening the public surface or routing them through the no-semver `/advanced` firehose. It also keeps `npx` and Homebrew installs self-contained with no runtime version skew. The cost is that a library change reaches CLI users only when `@diagrammo/dgmo-cli` is republished.

**The browser drop-ins are IIFE only, and they are a THIRD package.** `standalone/dist/auto.js` and `standalone/dist/element.js` are reached by `<script src>`, never by import — the `./auto` and `./element` subpath exports and their unminified `.mjs` twins were deleted on 2026-08-06 (6.7 MB with no importer anywhere). They still ship in an npm tarball, because jsDelivr and unpkg serve out of one and `dist/` is gitignored, so the `cdn.jsdelivr.net/gh/…` route 404s — but since 2026-08-07 that tarball is **`@diagrammo/dgmo-standalone`**, not the library. An IIFE cannot code-split, so each bundle carries the whole library and the two share 523 of their 524 modules; publishing the pair from the library made every npm consumer download 3.87 MB that no `exports` key could reach. Moving them took the library tarball from 10.0 MB unpacked to 5.84 MB.

🔴 **The standalone package's version is the LIBRARY's version, and nothing may let them drift.** `element.js` bakes `unpkg.com/@diagrammo/dgmo@<VERSION>/dist/map-data/` into itself — the basemaps deliberately stay in the library rather than being duplicated into a second tarball — so a standalone published at a version the library never published is a package whose maps 404. `scripts/release.sh dgmo` bumps both manifests in one commit, and `scripts/prepack-standalone.mjs` refuses to pack if they disagree. Do not give the standalone package its own release target.

🔴 **`standalone/` is build output apart from `standalone/package.json`**, exactly like `cli/`. Everything else there is gitignored.

🔴 **Adding a subpath export to `package.json` breaks the app's `pnpm dev`** while the production build stays green — the app's dev-mode source alias matches by prefix, so an unlisted subpath is rewritten to a path that cannot exist. Three lists in `diagrammo-app/vite.base.config.ts` must learn it; `diagrammo-app/CLAUDE.md` names them and is the file to follow, because it sits next to the code. Do not work from a list restated here — an earlier copy of this line named `optimizeDeps.include`, which is derived from one of the three rather than being one of them, so following it silently skipped the dist-ready gate.

## Testing

Vitest with jsdom. One test file per parser/renderer in `tests/`, fixtures in `tests/fixtures/`, snapshots in `tests/__snapshots__/`.

- Snapshots are timezone-sensitive — run with `TZ=UTC` to keep dates deterministic
- 🔴 **A test gated on `dist/` never runs in CI.** `.github/workflows/ci.yml` runs `pnpm test` **before** `pnpm build`, `pretest` is only `pnpm codegen`, and `prebuild` does `rm -rf dist` — so a `if (!existsSync(dist/...)) return` guard skips every time there, and passes locally only against a stale build. Assert against `src/` and keep the built-artifact check as a belt-and-braces extra, never as the only assertion
- Never run a `pnpm dev` watcher concurrently with a build; the shared `dist/` gets torn
- **Rebuild dgmo yourself after editing `src/`.** The app's `dev`/`prebuild`/`build:web`/`pretypecheck` hooks cover build, typecheck and dev-server *startup* — nothing rebuilds for `pnpm test`, for the other consumer repos, or for an edit made while a dev server is already running

## Before committing

Build and run the suite. When the change affects rendering, verify through the **snapshot suite** and `mcp__dgmo__validate_diagram` — 🔴 never produce an image to inspect it yourself. That includes `dgmo file.dgmo --json`, which reports structured output *and still writes a PNG*; it is not a validation command. To let the user see a change, hand them the `.dgmo` source and the app or online editor to open it in, then say what changed.

🔴 **A successful render is not proof a diagram is clean.** Rendering swallows *resolve* diagnostics — an unknown place name, an alias that never peeled — so a file can render happily and show red errors in the app. Only the validate path surfaces them; inspect `diagnostics`, never the exit code. Two traps behind that: a map `as <alias>` must be a single word of at most 12 characters (`AS_ALIAS_RE`), so "First Mate" silently fails to peel and leaves the name unresolvable — clock allows multi-word aliases and map does not — and city names need checking against the gazetteer before use ("New York" is "New York City"; Nassau, Tortuga and Reykjavik are absent, so use `poi <lat> <lon>`).

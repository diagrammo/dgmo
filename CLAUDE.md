# dgmo — @diagrammo/dgmo

Core library for the DGMO diagram markup language: parsing, layout, rendering, and the color/palette system. Published to npm as `@diagrammo/dgmo`, consumed by the desktop app, the web editor, Obsidian, the MCP server, and the doc-framework wrappers.

**This repo publishes THREE packages.** `@diagrammo/dgmo` is the library, from the repo root. `@diagrammo/dgmo-cli` is the `dgmo` command, from `cli/` — it carries the `bin`, `@resvg/resvg-js` and the AI editors' rules files, none of which the library has held since 2026-08-06. The source is still `src/cli.ts`; only the manifest and the build output live in `cli/`. Release it with `scripts/release.sh dgmo-cli X.Y.Z`, which tags `cli-vX.Y.Z` so it cannot collide with the library's `v` tags in this same repo, and dispatches the CLI's **own** workflow — `release-cli.yml`, new 2026-08-14; before that the CLI had no CI publish path at all and could only go out by hand. The two workflows refuse each other's tags: `release.yml` rejects a `cli-v*` tag and `release-cli.yml` rejects a bare `v*`. `@diagrammo/dgmo-standalone` is the pair of `<script src>` drop-ins, from `standalone/` since 2026-08-07 — it has **no release target of its own**, because its version must equal the library's; since 2026-08-14 it publishes from the library's own `release.yml` run, at the same `vX.Y.Z` tag. See *Build output*.

All three publish over **npm Trusted Publishing (OIDC)** from Actions — `npm publish --access public --provenance` under `permissions: id-token: write`, with no stored credential on the path. 🔴 **Each package needs its trusted publisher registered by a human at npmjs.com before that can work** (package → Settings → Trusted Publisher → GitHub Actions; organization `diagrammo`, repository `dgmo`, workflow filename `release.yml` or `release-cli.yml`, environment blank, allowed action `npm publish`), so an unregistered package fails to **authenticate** in the publish step; The runbook at `diagrammo-ecosystem-docs/src/content/docs/infrastructure/npm-trusted-publishers.md` (live at https://docs.diagrammo.app/infrastructure/npm-trusted-publishers/) lists all ten with their exact field values. 🔴 **`@diagrammo/dgmo` was ALREADY registered** — `diagrammo/dgmo` · `release.yml` · `npm publish`, observed in the npm UI 2026-08-14, predating that day's work. **All three were registered by 2026-08-14** and confirmed by the person who did it; the first release published this way anywhere in the workspace was `vitepress-dgmo` 0.6.5 on 2026-08-15, so the mechanism is proven even though these three have not used it yet. Registration cannot be read from a terminal, only from each package's settings page, and an empty `npm view <pkg> dist.attestations` does not answer it — it proves only that nothing has published from CI, which was true because releases were run locally. Check the page, not the registry.

**`docs/dgmo-language-spec.md` in the workspace root is authoritative.** If it isn't in the spec, it isn't valid DGMO — verify against the spec and the parsers, never against fixtures or old examples.

## Commands

```bash
pnpm build            # tsup (ESM + CJS, lib + CLI)
pnpm dev              # tsup --watch  — only ONE may run; racing watchers tear dist/
pnpm test             # Vitest        (test:watch for watch mode)
pnpm typecheck        # tsc --noEmit
pnpm check:all        # the FULL gate — 11 checks, incl. the ones above miss
./test-cli.sh input.dgmo [args...]   # build + run the CLI in one step
```

🔴 **`build` + `test` + `lint` + `typecheck` all passing is NOT the gate.**
`pnpm check:all` runs eleven checks and the four above are not among them —
dead code, spelling, duplication, import cycles, dependency ranges, security,
publishability, and **`check:api`**, which diffs the freshly built
`dist/*.d.ts` against the checked-in `api-baseline/` snapshot. That one exists
because dgmo's `.d.ts` files are consumed by seven downstream packages, so a
type that quietly leaves the public surface is a breaking change for them.

- Removing an exported type or an option from an exported signature **will**
  fail it. That is the tripwire working: re-baseline with
  `pnpm check:api:update` and say in the commit message why the surface moved.
- 🔴 **A red `check:api` may not be your change.** The baseline is only as
  fresh as the last person who re-baselined, so check what the diff actually
  contains before assuming ownership — found stale on 2026-08-24, carrying an
  unrelated diagnostics-field change from #378 that had landed weeks earlier.
- ✅ **`check:spelling` is GREEN again as of 2026-08-26.** It was red on six
  `autonumber` hits from 2026-08-24; they are gone. Keep the habit the old note
  taught, though — when `check:all` goes red, read *which* check failed before
  assuming it is your change, and run that one on its own.
- 🔴 **Pipe `check:all` and you will read the wrong exit code.** `pnpm check:all
  | tail` reports `tail`'s status, so a failed gate prints as success — prefix
  with `set -o pipefail`. It is also a per-repo script: running it from the
  workspace root runs the ROOT repo's checks, which are different ones and pass
  happily while dgmo's are failing.

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

## Sweeping `src/` — pass `-a` or the sweep lies

🔴 **`src/arc/renderer.ts`, `src/diagnostics.ts` and `src/pert/monte-carlo.ts` contain a byte that makes both plain `grep` and the shell's ugrep shim classify them as binary and drop every match — silently, with no error and no `Binary file matches` line.** `renderArcDiagram` is invisible to a sweep of this repo without `command grep -a`. Verified 2026-08-17, while censusing all 51 chart-type renderers; the arc renderer was initially reported as having none. This compounds the workspace-level shim trap (a root sweep skips all nested repos), so a sweep of `dgmo/src` needs **both** `command grep` and `-a`.

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
- **Crowding is the renderer's decision; the author is never asked.** Settled 2026-08-16 by the crowded-axis fix and true library-wide: there is no `interval:`-style axis option, no `hideOverlap` flag and no label-thinning directive anywhere in the language. `no-scale` on event-line is the only crowding-related directive that exists, and it picks a *layout model* (even spacing instead of a date axis) rather than tuning a density. A "show every 7th label" option would be the first of its kind — treat proposing one as a language change, not a renderer tweak
- 🔴 **An `<svg><title>` element IS a native tooltip** — OS-styled, a second late, unstyleable, absent on touch, exactly what the workspace ban on the DOM `title` **attribute** is about — and it silently becomes the element's **accessible name** as well, so it is doing two jobs and a screen reader reads whichever one you wrote for sighted hover. The ban was written for the attribute, which is why the element survived every previous sweep until 2026-08-17. Several renderers still carry one; `command grep -rna "append('title')" src/` is the census

## Rendering constraints

- **resvg does not support CSS `color-mix()`** — use `mix()` in `palettes/color-utils.ts`, which pre-computes hex
- **resvg DOES support `clipPath`** — it is not a browser-only construct, and the renderers use it widely, `boxes-and-lines`'s collapse bar and the goal track's `dgmo-goal-track-clip` among them, so a clip reaches PNG output unchanged. Verified 2026-08-17 by rasterising a rect half-covered by a `clipPath` through `@resvg/resvg-js` and reading the pixels back: the clipped half came out background, the other half the fill colour. *Text* that can overflow still gets a halo rather than a clip (Output rules) — that is a legibility choice, not a resvg limitation
- 🔴 **`computeTimeTicks` never measures pixels**, though its decimation comment says "so labels don't overlap". It takes `domainMin`, `domainMax` and the scale — no width, no font, no label metrics — and the ladder keys off `yearSpan` alone, so a 3000px axis and a 300px axis over the same range get **identical** ticks. Its one pixel constant is `collisionThreshold`, a fixed distance for dropping a standard tick that a boundary tick lands on, not a density control. `gantt/renderer.ts` and `timeline/renderer.ts` are the callers and share the blind spot; it lives in `src/utils/time-ticks.ts`, so a width-aware fix belongs there rather than in one renderer. Verified 2026-08-17
- **resvg PNG background:** pass `paletteColors.bg` for light/dark; omit for transparent
- **Fonts:** all renderers import `FONT_FAMILY` from `fonts.ts` (Inter). The CLI feeds resvg the bundled TTFs in `fonts/`; the app and Obsidian load Inter via `@font-face`
- 🔴 **A rasterising call site passes `loadSystemFonts: true`, always — never gate it on having found the bundled font.** It read `fontFiles.length === 0` at both sites until 2026-08-07: system fonts off *because* Inter was found. That makes the `system-ui, …, sans-serif` tail of `FONT_FAMILY` inert, and Inter has no CJK, Devanagari, Tamil, Arabic, Hebrew or Thai — upstream included — so a diagram in any of them drew **nothing at all**. Not a `.notdef` box, nothing, silently, exit code 0. A bar labelled 日本語 rasterised byte-identically to one labelled with an unassigned Private Use codepoint. Enabling fallback costs nothing for Latin: Inter is still loaded explicitly and named as `defaultFontFamily` and `sansSerifFamily`, and the Latin output is byte-identical across the change. Fixed in `@diagrammo/dgmo` 0.63.0, `@diagrammo/dgmo-cli` 0.63.0 and `@diagrammo/dgmo-mcp` 0.21.0.
- **Fallback cannot save a machine with no font for the script** — a bare CI container draws nothing and reports success — so both rasterising sites also warn, via `src/font-coverage.ts`, when the text carries characters the bundled font lacks. Coverage comes from `fonts/coverage.json`, generated by `scripts/build-fonts.mjs` by **reading back the TTF it just wrote**, never from the range tables that produced it: harfbuzz was asked for 1,815 codepoints and emitted 1,784, so the tables state an intention and only the bytes state the font. A new consumer of that file must be added to the staging step that ships it, or the warning silently never fires — `cli/fonts/` and `dgmo-mcp`'s `stage-assets.mjs` both carry it.
- 🔴 **`src/utils/inter-metrics.ts` is GENERATED — `prebuild` rewrites it wholesale, so a hand-written number there vanishes without a word.** Per-script width ratios for everything the generated table does not cover live in `src/utils/script-metrics.ts`, which is hand-written and beside it for exactly that reason. Of those ratios **only the full-width row is a fact** (Han, Kana and Hangul are one em by the writing system, and every font agrees); the rest are estimates that move with whichever face the machine falls back to, since dgmo does not choose it. A combining mark is charged **zero** because the ratios are per base glyph — change one without the other and a Devanagari word buys six widths for three clusters.
- ⚠️ **A font question is settled by rasterising and comparing pixels, not by reading the stack.** The declared family chain looked correct throughout; what was wrong was a flag three layers down. The cheap decisive test is to render the same chart with the text under test and with an unassigned Private Use codepoint — identical pixels mean the glyphs never drew.
- `render()` and the CLI share one rendering core (`cli.ts` imports `render` and reimplements only the error-card policy), so they agree by construction — a difference between them means a stale `dist/` or a pinned module in a long-lived server, not a divergent code path. Verified 2026-07-31

## Sequence — the two ordering traps

- The parser matches sections **before** closing indent-based blocks. A new element type matched before block closing lands in the wrong container while a block is open — check `blockStack` and close first
- Only the wrapper `<g>` carries `data-line-number` / `data-section`; children must not. Section Y positions accumulate from content above, never anchor to messages below
- No cosmetic indentation; `A <- B` is normalized to `B -> A`; participant order is first-appearance
- **Collapse — the two folds ask different questions, which is why one mark cannot serve both.** A collapsed **section** hides messages and keeps every column, so the open question is *who* took part: answered by one mark per participant from `summarizeSectionParticipation` (filled = it sent, ring = it only received, small hollow tick = absent, drawn rather than omitted). A collapsed **group** hides columns and keeps its messages, so the question is *which member* — and it is answered **nowhere on the canvas**: the toggle's `aria-label` (`groupToggleName`) carries the list, and expanding is one click. A mark on a group column would look like it carried identity and could not, and the 9px `collapsedGroupMemberLine` text that answered it until 2026-08-24 was deleted with #447 — it was the smallest type on the canvas, spent re-stating what collapsing had just been asked to hide, in a box that had to grow to hold it
- 🔴 **Collapse — the bottom bar is a CROSS-CHART mark, not sequence's own.** `COLLAPSE_BAR_HEIGHT` lives in `src/utils/visual-conventions.ts`, `renderCollapseBar` in `src/utils/card.ts` draws it, and infra, boxes-and-lines, org, sitemap, mindmap, pert, sketch, block and C4 all carry it — never restyle it here alone, and never hardcode the height (sequence did, at a matching 6, so a deliberate change to the constant silently skipped it until #447). In every renderer the bar takes **the card's own outline colour**. A tagged group satisfies that already, since its outline IS the tag colour. An untagged group is the ONE documented exception: its outline falls back to `palette.border`, too faint to read as a mark, so the bar takes `mix(palette.textMuted, themeBaseBg(palette, isDark), 55)` — **mixed into the ground, never an opacity**, or the lifeline shows through and dark theme has nowhere to go (it must lift off the ground there, not try to go darker than it)
- 🔴 **Collapse — a collapsed group's HEIGHT is conditional, and layout does not care.** It matches an expanded group's frame (`+ GROUP_PADDING_TOP/BOTTOM`) only when `hasExpandedGroup`; otherwise it is an ordinary participant's height, so the row keeps one top edge. Its lifeline start follows the same test. Toggling still moves nothing, because `groupOffset` and `messageStartOffset` reserve their padding from **`parsed.groups`**, not the projected view — a compact box just leaves the reserved strip above it empty. Don't "fix" that reservation to match the box (#447)
- **Collapse — a collapsed group's NAME is a participant label, not a group header** (`LABEL_FONT_SIZE`, weight 500). This reverses #242, which had pinned it to the expanded strip's 11px bold so the name would not change type under a reading gesture; the counter-argument that won is that it stops being a header at all and becomes the label of a box standing on the participant row (#447). `GROUP_LABEL_SIZE` is now the expanded strip's type only
- **Collapse — the section mark's entire grammar is positional.** It is drawn at `participantX.get(participant.id)` and means nothing on its own: the column header supplies the identity, the mark supplies only the verb. Move it off the participant's x and it says nothing
- 🔴 **Collapse — the band's full-width rect carries `pointer-events: none` deliberately.** It spans the whole diagram width (from `sectionLineX1 - 10`, `sectionLineX2 - sectionLineX1 + 20` wide) and would otherwise swallow clicks meant for the participants and lifelines drawn earlier. The toggle's hit area is the separate `section-label-hit` rect scoped to the label, and the marks get their own transparent `section-mark-hit` discs carrying `data-section-mark-line` (never `data-line-number` — a child with one resolves to plain line navigation before the click walk-up reaches the band's toggle, unfolding nothing). Anything added to that band needs its own hit area; do not make the band itself clickable. `src/sequence/renderer.ts`

## Build output

tsup emits dual ESM/CJS: `dist/index.js` + `.d.ts`, `dist/index.cjs` + `.d.cts`. The CLI goes to **`cli/dist/cli.cjs`**, a different npm package.

🔴 **`cli/` is build output apart from `cli/package.json`.** A `stageCliAssets` step copies `fonts/`, `.cursorrules`, `.windsurfrules`, `SKILL.md`, `.claude/commands/` and `.github/copilot-instructions.md` into it, because `cli.ts` reads them from its own package root and npm's `files` cannot reach above a package directory. Everything staged is gitignored — never edit a file under `cli/` except the manifest, and never add one expecting it to survive `pnpm build`.

🔴 **The CLI bundle INLINES the library** (`noExternal` in the CLI's tsup block), so it does not depend on `@diagrammo/dgmo` at all. That is deliberate: `cli.ts` reaches five modules that are not public exports — `cli-banner`, `map/completion`, `org/resolver`, `pert/share-normalize`, `utils/offered-types` — so depending on the package would mean widening the public surface or routing them through the no-semver `/advanced` firehose. It also keeps `npx` and Homebrew installs self-contained with no runtime version skew. The cost is that a library change reaches CLI users only when `@diagrammo/dgmo-cli` is republished.

**The browser drop-ins are IIFE only, and they are a THIRD package.** `standalone/dist/auto.js` and `standalone/dist/element.js` are reached by `<script src>`, never by import — the `./auto` and `./element` subpath exports and their unminified `.mjs` twins were deleted on 2026-08-06 (6.7 MB with no importer anywhere). They still ship in an npm tarball, because jsDelivr and unpkg serve out of one and `dist/` is gitignored, so the `cdn.jsdelivr.net/gh/…` route 404s — but since 2026-08-07 that tarball is **`@diagrammo/dgmo-standalone`**, not the library. An IIFE cannot code-split, so each bundle carries the whole library and the two share 523 of their 524 modules; publishing the pair from the library made every npm consumer download 3.87 MB that no `exports` key could reach. Moving them took the library tarball from 10.0 MB unpacked to 5.84 MB.

🔴 **The standalone package's version is the LIBRARY's version, and nothing may let them drift.** `element.js` bakes `unpkg.com/@diagrammo/dgmo@<VERSION>/dist/map-data/` into itself — the basemaps deliberately stay in the library rather than being duplicated into a second tarball — so a standalone published at a version the library never published is a package whose maps 404. `scripts/release.sh dgmo` bumps both manifests in one commit, and `scripts/prepack-standalone.mjs` refuses to pack if they disagree. `release.yml` publishes the two from **one run** and checks the tag against `standalone/package.json` as well as the root manifest before it does (2026-08-14), then verifies both packages on npm afterwards. Do not give the standalone package its own release target.

🔴 **`standalone/` is build output apart from `standalone/package.json` and `README.md`**, much like `cli/`. Everything else there is gitignored — including `standalone/LICENSE`, which the build copies out of the repo root beside `auto.css`, because npm cannot include a file above a package directory and a second committed copy would drift from the copyright holder. It shipped with no licence text at all until 2026-08-09 (issue 162); `prepack-standalone.mjs` now refuses to pack without it.

🔴 **Depend on a sibling `@diagrammo` package with `>=X <1`, never `^X`.** A caret on a `0.x` version locks the **minor**, so `^0.18.0` admits `0.18.x` and nothing after it — the range keeps resolving, npm keeps reporting success, and the dependency silently sits releases behind. It bit four times in two days: the marketing site pinned `^0.44` against dgmo 0.61, `dgmo-mcp` pinned `^0.59` against dgmo 0.62, this CLI pinned `^0.17` against `dgmo-mcp` 0.18, and then sat on `^0.18.0` through `dgmo-mcp` 0.19.0 and 0.20.x. **That last one shipped**, and the damage was not merely being behind: `dgmo-mcp` 0.18.0 still declared the library as a *runtime* dependency, so `brew install dgmo` pulled the whole library back into the tree — 73,668 KB installed instead of 67,348 KB, undoing the entire point of 0.20.0 inlining it. Fixed in `@diagrammo/dgmo-cli` 0.62.3.

`pnpm check:dep-ranges` (in `check:all`) is the guard: it asks the registry what each declared `@diagrammo` range can actually reach and fails when that is not what is published, naming the caret when it sees one. It passes quietly with no network, so it cannot fail a build for an unrelated reason. **A range is not evidence** — the previous fix here was verified by packing and installing, and this one has to be too: install the tarball, read the resolved version out of `node_modules`, and check whether `@diagrammo/dgmo` appears in the tree at all.

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

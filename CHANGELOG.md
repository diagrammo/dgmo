# Changelog

All notable changes to `@diagrammo/dgmo` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.47.0] - 2026-07-05

### Changed
- **Smaller bundles for hosts that import multiple entry points.** `index`, `block`, and `advanced` now share one code-split render pipeline (ESM) instead of each shipping a self-contained ~2.5 MB copy. A downstream bundler (esbuild / Rollup / Vite) that pulls more than one of these keeps a single copy of the pipeline — the Obsidian plugin's bundle drops from ~8.5 MB to ~4.0 MB (it imports all three). No API change; the CJS builds stay self-contained (esbuild can't code-split CJS, and `require` consumers don't bundle).

## [0.46.0] - 2026-07-05

### Changed
- **`/auto` and `<dgmo-diagram>` adopt the standard embed block (BL-114)** — both browser drop-ins now emit the canonical chrome from `@diagrammo/dgmo/block` instead of their bespoke source panel: `figure.dgmo` wrapper, hover-reveal wordless icon toolbar (`</>` view source · copy · open-in-editor) in a reserved footer row, source hidden behind a native `<details class="dgmo-source-wrap">`, and one shared frame around chart + code while the source is open. Copy still copies the raw DGMO source and the editor link keeps its UTM-tagged share URL. Errors now render as the standard `.dgmo--error` card (message + offending source, `role="alert"`) on both surfaces, replacing the old `.dgmo-error-banner`. The old chrome classes (`.dgmo-source-panel`, `.dgmo-source-toggle`, `.dgmo-source-body`, `.dgmo-source-actions`, `.dgmo-btn*`, `.dgmo-chevron`, `.dgmo-error-banner*`) are gone from both surfaces and from `dist/auto.css`, which now bundles `BLOCK_CSS` plus a `.dgmo-theme-dark`-scoped copy of its dark-mode rules.

### Fixed
- **Baked hover no longer fails on tag-group names with spaces or parentheses** (e.g. `Residents (millions)`). Legend markers now carry the same slug the marks use, and the hover injector re-slugs defensively, so `render()` no longer throws `Invalid selector` on such diagrams when a DOM is present.
- **Concurrent renders across two bundle copies no longer race on DOM globals.** Hosts that load both `@diagrammo/dgmo` and `@diagrammo/dgmo/block` (two self-contained bundles) could see one copy tear down `globalThis.document` mid-render of the other (`document is not defined`). The jsdom-globals ref-count is now shared across copies via a `Symbol.for` slot.

## [0.45.0] - 2026-07-05

### Added
- **Standard embed block (`@diagrammo/dgmo/block`)** — the one canonical "diagram + source chrome" every embed surface now shares (remark-dgmo and its five host wrappers first; `/auto`, `<dgmo-diagram>`, MCP reports, site, and Obsidian to follow). The diagram is the star: a slim wordless icon toolbar (`</>` view source · copy · open-in-editor) sits below the chart and only fades in while the pointer is over the diagram itself; source stays hidden behind a native `<details>` (zero-JS toggle); opening it draws one shared frame around chart + code so the source reads as part of the figure. Ships `renderDgmoBlock()`, `buildDgmoBlockHtml()`, `errorBlockHtml()`, `BLOCK_CSS`, and `dist/block.css` (also exported as `./block.css`).
- **`LIGHT_ROLE_STYLES`** in `@diagrammo/dgmo/highlight` — light-background companion to `NORD_ROLE_STYLES` for static source display, with a parity test tying both maps to the block stylesheet's `.dgmo-tok-*` rules.

## [0.44.1] - 2026-07-04

### Fixed
- **event-line / block**: removed the opaque full-canvas background rect. Both types now rely on the SVG's CSS `background` (and resvg's background option for PNG) like every other chart type, so transparent-theme and Obsidian embeds blend with the host instead of showing a dark box.

## [0.44.0] - 2026-07-04

### Added
- **`<dgmo-diagram>` web component** — render diagrams client-side in any HTML page (Hugo, Jekyll, MkDocs, plain HTML) via a `<script>` tag + custom element. New `./element` entry plus a self-registering `dist/element.js` bundle; map diagrams lazy-fetch their geo data so the base bundle stays lean.
- **Baked pure-CSS hover** — exported SVGs carry hover emphasis with zero JavaScript (`bakeHover` in `render()`), across the connection, tag-group, and cross-free chart families.
- **Portable view-state directives (BL-111)** — source-native markers reproduce a configured view anywhere the `.dgmo` travels: `collapsed: true` (mindmap / sequence / state / kanban / gantt / infra), `lane-by <group>` (timeline / gantt / kanban), `color-by-depth` (mindmap), `no-semantic-colors` (er), and honored `hide` (org / sitemap).
- **Treemap radial (sunburst) mode** — a bare `radial` flag renders the hierarchy as a multi-ring sunburst.
- **Multi-series radar** with legend-hover emphasis.
- Dual-axis line charts: hovering a y-axis label emphasizes its series.
- Enumerable diagnostic registry plus a `dgmo diagnostics` CLI command.

### Changed
- **BREAKING**: removed the `chord` chart-type keyword. Use `arc` with `layout chord` for circular / chord layouts.

### Fixed
- Swimlane: blocking boxes shifted out of back-edge corridors.
- Map: arrowheads tagged so legend hover keeps matching arrows lit.
- Arc / block: exported SVG sized to content instead of a fixed canvas.

## [0.43.0] - 2026-06-29

### Added

- **Rich date handling for timelines + event-lines** — BCE/CE years, sub-minute (seconds) precision, and formatted date subtitles, so historical and high-resolution timelines render to scale and read correctly.
- **Event-line `TBD` / future events** — a `TBD` date marks a not-yet-scheduled event; its position is inferred from source-order dated neighbors (interpolated into the gap with a "somewhere in here" whisker, or parked past the last dated event as an open-horizon dashed tail). Consecutive TBDs sharing a gap fan evenly.
- **Event-line** — the whole collapsed-era area is now clickable to expand; out-of-order event dates emit a warning.
- **Pie / line directives** — `hole` + center-total for pie; line fill.
- **Bar** — stack/group block headers; series on a bare bar is now rejected with clustered render wired in.
- **Arc / chord** unified behind a single layout directive (both keywords stay).
- **Solid-fill directive** honored across all fillable chart types.
- **Map** — route arcs bow outward from the route polygon.
- **CLI** — the installer now copies the sibling Claude Code slash commands (`/dgmo-diagram-this`, `/dgmo-document-project`, `/dgmo-codebase-report`), and ships a Codex skill variant of the codebase-report command.

### Changed

- **Chart-type consolidation (50 → 44)** — legacy chart-type aliases were de-surfaced and `bar-stacked` hard-removed as a distinct type; `area`, `doughnut`, `bar-stacked`, `multi-line`, `rasci`, and `daci` are no longer separate types (use the directive forms on their parent types). `language-reference.md` is now canonical-only (#23–28).
- **Event-line** — removed the spine date-tick ruler; crisper axis-break squiggle and cleaner TBD cues.

### Fixed

- **version-control** — prevent bottom clipping of diagonal commit labels.
- Consistent collapse bar across box chart types.
- **journey-map** — emotion-area framing + thought-bubble headroom.

### Removed

- Deprecated-syntax back-compat layer and legacy chart-type aliases (pre-1.0 cleanup, #28).

## [0.42.0] - 2026-06-26

### Added

- **D3 data-chart engine** — all data chart types (bar/line/pie/doughnut/area, sankey, chord, scatter, heatmap, funnel, radar, polar-area, function) now render through hand-built D3 renderers, replacing the previous ECharts engine. Full 15/15 coverage.
- **Dual y-axis line charts** — a grouped `series` block assigns series to a left or right axis, so two different scales share one line chart (§15.1.1).
- **Chart interaction model** — axis-projection hover (a crosshair that triggers across the whole plot, not just empty space), cursor→chart highlight, and on-axis values that read as emphasized ticks instead of tooltips; plus per-series tinted value labels and series-focus emphasis.

### Changed

- **Value→colour/size/width ramps are channel-named (decision #20) — BREAKING.** The ramp directive and its per-element key now share the *visual-channel* word. boxes-and-lines: `box-metric`/`value:` → **`heat`/`heat:`**. map: `region-metric` → **`region-heat`** (`heat:`), `poi-metric` → **`poi-size`** (`size:`), `flow-metric` → **`flow-width`** (`width:`); `no-region-value` → **`no-region-heat-value`**. Each map element accepts exactly one channel key — a wrong-channel key (e.g. `size:` on a region) is now a hard error. treemap (`heat`/`heat:`) is unchanged — it was the reference pattern. No migration: the old tokens are unrecognized.
- **Event-line** — legend mute-to-dots, collapsed-era centering + hover fix, date-in-card layout, focus interactions, and tag defaults.

### Removed

- **ECharts removed — D3 is the only data-chart engine — BREAKING.** The `--engine` CLI flag and the `engine` option are gone; charts that rendered via ECharts now use the D3 renderers above.

## [0.41.0] - 2026-06-25

### Changed

- **Event-line eras are now indentation containers** — member events indent beneath the `[Name]` bracket (the same nesting idiom as org / version-control), replacing the 0.39.0 flat run-delimiter form. An indent-0 event sits outside any era; a dedent to indent 0 ends the open era. Old flat sources still parse (their events read as era-less — valid, not an error). Reverses decision #19.2 (#21).

## [0.40.0] - 2026-06-25

### Added

- **Event-line + block gallery examples** — representative `.dgmo` fixtures now ship in the package, so `get_examples('event-line')` / `get_examples('block')` and few-shot tooling return real starters for these types.

### Changed

- **Event-line** — collapsed eras render better: the summary card anchors at the date-span midpoint with a bracket stretched across the full member range, an axis-break glyph marks the folded span on the spine, the member list no longer truncates, and event-line widths adapt to content.

## [0.39.0] - 2026-06-25

### Added

- **Event-line chart type** — an annotated narrative timeline: a horizontal spine of point events, each a dot with a date caption and a leader to an org-style card, auto-alternating above/below. Distinct from `timeline` (to-scale axis with eras/markers/ranges); event-line is point events with rich prose, optionally not to scale. Supports **eras** (`[Name]` run delimiters) that bracket a contiguous run of events; an era can **collapse** to a single summary card (bulleted member list, tag-colored) with an on-spine `⊓` bracket marking its span, and expand again live in the app. `no-scale`, `side above|below`, `no-box`, `no-legend` directives.
- **Version-control chart type** — a VCS-agnostic commit DAG drawn as parallel branch lanes (the git/Mercurial/SVN branch-and-merge picture) in a "metro map" visual. Keyword-less grammar (a bare top-level line is a branch, a bare indented line is a commit); only `merge` and `cherry-pick` are required verbs. At parity with Mermaid `gitGraph` and beyond (HEAD / remote-tracking / ahead-behind, `rebase`/`reset`/`revert`/squash, step notes).
- **Block chart type** — an author-controlled grid of rectangular blocks with nested, collapsible containers, for diagrams where the 2-D arrangement *is* the meaning (system/hardware/architecture layouts). Containment over edges; columns inferred from placement; `_` for empty cells.
- **Swimlane chart type** — cross-functional / BPMN-style swimlanes: lanes, `[Phase]` columns, and in-arrow labels.

### Changed

- **Treemap** — vertical labels for tall-narrow cells with descender-safe value spacing.

## [0.38.0] - 2026-06-24

### Added

- **Treemap chart type** — nested rectangles sized by value for hierarchies (budgets, disk usage, portfolios). Color by category (`tag`), by a value heatmap (`heat:` + a data-aware diverging/sequential ramp), or by branch; the desktop app adds a live tag/heat/branch switcher, drill-to-zoom that keeps the containing box for context, and a legend gradient-scrub hover. `depth N` and `no-*` opt-outs supported.

### Changed

- **Treemap drops `other-below`** — the small-leaf rollup into an "Other" bucket was removed; small children now render as their own cells (with a lower label-font floor so tight labels still fit). The directive is recognized but ignored with a warning so older sources don't break.

## [0.37.0] - 2026-06-23

### Changed

- **Simpler map route syntax** — route legs drop the `style:` header and use a glyph-only leg shape (e.g. `A ~> B`); silent-case handling is tightened so ambiguous routes no longer render unexpected connectors. Existing `style:`-header routes should migrate to the glyph form.
- **AI surfaces ask when the chart type is ambiguous** — the AI-core authoring guidance now instructs assistants to ask the user which chart type they want rather than guessing when the prompt is unclear.

### Added

- **Map edge value-on-hover** — hovering a weighted map edge shows its value via a native tooltip.

### Fixed

- **Map callout leaders route toward open water** instead of taking the shortest hop into crowded land, reducing label collisions.
- **Heavy map edge labels sit beside the stroke**, not on top of it, so thick connectors stay legible.
- **Infra parser** now handles quoted-name aliases, chart-type-keyword node names, and indented tags.

## [0.36.0] - 2026-06-23

### Changed

- **App-aware output for AI-generated diagrams** — the bundled `dgmo` skill now decides where a generated diagram goes based on whether the Diagrammo desktop app is installed (via the new `check_app_installed` MCP tool in `@diagrammo/dgmo-mcp` ≥0.4.0). With the app installed, the AI saves the `.dgmo` source and opens that file live in the app — in-app edits autosave back to it — instead of defaulting to an online share URL. Without the app, it falls back to the share URL. The `.dgmo` source is always saved, and a PNG/SVG is rendered only when explicitly requested.

## [0.35.0] - 2026-06-22

### Added

- **One-step AI setup — `dgmo install`** now sets up every AI assistant on your machine in a single command. With no target it auto-detects Claude Code, Codex, Claude Desktop, Cursor, Windsurf, and Copilot and configures each one non-interactively (no prompts). The CLI is the only binary you install: a new `dgmo mcp` subcommand provides the MCP server (so client configs point at `dgmo mcp` — there's no separate `dgmo-mcp` package to install). Cursor and Windsurf are wired as full MCP clients; flags `--scope user|project` and `--dry-run` are available.
- **Stays current** — `dgmo install` upgrades the MCP server to the latest; via Homebrew the server is bundled and upgrades together with `brew upgrade dgmo`. `DGMO_MCP_LATEST=1` makes `dgmo mcp` always fetch the newest server at launch.

## [0.34.0] - 2026-06-22

### Added

- **Legible boxes-and-lines edge labels, regardless of length or layout** — connector labels follow a priority ladder: (1) wrap long text onto up to 3 lines (hard-break + ellipsis bound the box), (2) if the box still overlaps a node, slide it along the line and then a small perpendicular offset into clear space while staying proximal, (3) as a last resort, re-run the layout reserving label space so a gap opens. Placement moved from the renderer into the layout (a new `label-placement` pass), and labels now paint in a dedicated layer above the nodes so a box can never clip them.

### Changed

- **Edge-label halo restyled** — borderless and semi-transparent, so the connector line stays faintly visible behind the label while the full-opacity text on top stays crisp.

## [0.33.0] - 2026-06-21

### Added

- **Multi-word quoted tag-group names** — `tag "Trust Zone" as tz` is now accepted. The display name is preserved for the legend label while a DOM-safe slug (`trust-zone`) is used wherever the name becomes a `data-tag-*` attribute, entity metadata key, or `active-tag` match target. Single-identifier names stay byte-identical. Threaded through every tag-group-consuming chart type.
- **Boxes-and-lines tier-band grouped layouts** — grouped diagrams resolve into ordered disjoint rank bands with peripheral back-edge routing, fixing the back-edge "balloon" and cross-tier collisions. Additive layout candidate gated on strict badness; no gallery drift.
- **Map place discoverability** — `searchMapLocations()` API and a `dgmo map search` CLI command resolve human place names (e.g. "New York") to paste-ready map tokens; map authoring tips steer flights toward IATA codes.
- **Journey-map persona richness** — persona accepts a §1.5 trailing-token color and supports bullets + inline markdown in the description.

### Fixed

- **sitemap** — sub-pages nested inside a container now raise an error instead of silently mis-nesting.

### Changed

- Expanded per-type authoring TIPS: boxes-and-lines categorical tag-group examples, richer journey-map / kanban / sitemap styling guidance, sequence section guidance.

## [0.32.1] - 2026-06-20

### Changed

- **Authoring TIPS quality pass** — rebalanced the per-type styling TIPS from syntax-restating toward communication/visual-quality guidance (the established house style), and refined them from a full no-tips-vs-tips A/B sweep across the renders. Notable fixes: slope no longer advises a recolor that collides with the auto-palette; pert drops a no-op `default-confidence` clause; arc/wordcloud name the real layout levers (`order appearance`, `size <min> <max>`); ring keeps values in the band label. Docs-only — no API or render-behavior change.

## [0.32.0] - 2026-06-20

### Added

- **Named-palette color enforcement** — diagram colors must now be one of the 11 named palette colors. Hex (`#e6194b`) and CSS color names (`crimson`) are rejected with a `Nearest: <name>` hint, so authoring tools fail fast instead of silently falling back. Wired through every chart parser.
- **Boxes-and-lines focus mode** — a 1-hop neighborhood transform that isolates a node and its immediate connections; opt-in layout-search progress hook.
- **Mindmap parent→child tag cascade** — a tag value on a branch flows to its sub-nodes.
- **Per-type authoring TIPS** — every one of the 35 chart types now carries a styling-tips block in the language reference (consumed by the MCP per-type guidance slice).
- **Richer map context labels** — country labels dodge collisions, respect proximity, and adapt to zoom.

### Fixed

- **Flowchart structural integrity** — a node carrying an unsupported trailing suffix (e.g. a tag-style `(Denied) s: Denied`) is salvaged with a warning instead of silently dropping the node *and* its edge; a leading-arrow continuation line (`(Start)` then `-> Next`) now attaches to the previous node instead of orphaning it.
- **function** — a curve whose name begins with `x` (e.g. `x / 2: x / 2`) no longer collides with the `x <min> to <max>` range keyword and gets silently dropped.
- **bar** — plain `bar` given multiple series now warns (use `bar-stacked` / `multi-line`) instead of silently rendering only the first series.
- Timeline horizontal fit, mindmap canvas fit, scatter legend spacing, org focus-icon contrast, sequence participant interleave, map antimeridian POI-frame clamp.

### Performance

- Map region rings/bbox caching; boxes-and-lines layout ~27% faster via identical-output scoring fixes + pre-score sort.

### Changed

- Internal parser refactors: shared `makeFail()` diagnostic accumulator, chart-type registry min-dimension formulas, theme-base-bg helper (arch-review stories 111.2–111.5).
- Documentation: timeline events documented date-first; flowchart node color is automatic-by-shape (no tags/metadata); RACI/sitemap/c4 example fixes; stale gallery fixtures repaired.

## [0.31.0] - 2026-06-18

### Added

- **CLI colorful ASCII banner** — `dgmo` prints a slate-palette-derived gradient logo.
- **`autoTagColorCycle` export** (`/advanced`) — the canonical categorical color
  order, so consumers can match the engine's auto color-pick.
- **Boxes-and-lines `layout` coordinate block + pinned-layout bypass** — supports
  the desktop canvas editor: explicit per-node coordinates are honored (and kept
  on-canvas), including when a flat group is collapsed.
- **Card convention module** (`utils/card.ts`, `utils/visual-conventions.ts`) —
  shared card-rendering primitive (Story 111.1), adopted by the sitemap renderer.
- **Journey-map persona `color:`** — same-line `persona Name color: <token>` form
  (pipes were removed in 0.18.0).

### Changed

- Unified auto color-pick order to an RGB-seeded max-contrast cycle.
- Sharpened `slope` and `map` chart-type descriptions for selection accuracy.

### Fixed

- **Multi-map pages** — SVG `<def>` ids are namespaced per render so multiple maps
  on one page no longer ghost each other's gradients/masks.

## [0.30.0] - 2026-06-15

This release **freezes the DGMO language and locks the public API** ahead of
1.0 — the deprecated-but-working syntax forms are removed and the unstable
`/internal` entry point is retired. It contains **breaking changes**; most are
graceful (the diagram still renders best-effort while emitting a structured
error), and `dgmo migrate` covers the data-row comma change.

### Removed (breaking)

- **`/internal` subpath entry point.** Long deprecated (its banner said
  "removed in 0.17.x"); import unstable symbols from `@diagrammo/dgmo/advanced`
  instead — it is symbol-identical and documented as a permanent no-semver
  surface.
- **Gantt legacy scheduling syntax** (`parallel`, positional/explicit-date
  duration forms) → `E_GANTT_LEGACY_REMOVED`. Use the v2 arrow scheduling
  syntax; `duration:` / `start:` are canonical and unchanged.
- **Comma-separated data-row values** → `E_DATA_COMMA_REMOVED`. Data rows are
  space-separated; thousands separators are dropped (use `1_000` underscore
  grouping if needed). Run `dgmo migrate` to convert existing diagrams.
- **Bare `description <text>`** (no colon) → `E_DESCRIPTION_BARE_REMOVED` across
  infra/c4/sitemap/mindmap/journey-map. Use `description: <text>`.
- **PERT `analysis` directive** → `E_PERT_ANALYSIS_REMOVED` (was already inert).
- **Timeline positional duration** (`30d`) → `E_TIMELINE_BARE_DURATION_REMOVED`;
  `duration:` is now the canonical form.
- **C4 bare same-line `description`/`tech` tail** → `E_C4_BARE_TAIL_REMOVED`.
  Previously the bare form was silently dropped (real data loss); it now errors
  and the colon form is required.

### Changed

- **Auto-assigned tag colors.** A bare, uncolored tag value now receives a
  deterministic categorical palette color via a per-group finalize pass;
  explicit colors always win and are never reused.
- **Public API surface locked.** `chartTypes`, `ChartTypeMeta`, and `MapData`
  are promoted to the stable root (`@diagrammo/dgmo`). `/advanced` is documented
  as the permanent no-semver firehose. API.md drift fixed (slate is the default
  palette; previously-missing root exports and the `./pert` subpath documented).

### Added

- **AI authoring-guidance layer** — `AI-CORE` styling guidance plus per-type
  authoring tips, delivered to the static surfaces and the MCP per-type slice.

### Performance

- **Map.** Memoize projected region geometry across recolor; bbox pre-filter in
  `fillAt` cuts `layoutMap` by ~36%.

### Fixed

- **Map framing.** Tuck Alaska/Hawaii insets under the coast (not the canvas
  floor) and enlarge them; tall-pane albers-usa framing sinks the insets and
  nudges CONUS up; region labels are cleaned-or-dropped instead of trailing
  spaghetti leaders.

### Tests

- Added parser unit tests for `arc`, `slope`, and `wordcloud`; fixed the
  coverage glob that tried to parse `src/map/data/README.md` as JS.

## [0.28.0] - 2026-06-10

### Changed

- **New boxes-and-lines layout engine.** Boxes-and-lines diagrams now lay out
  with a placement-search engine (multi-seed dagre placement scored on the
  rendered spline geometry — true crossings, line overlaps, and edges piercing
  node boxes) instead of the previous layered engine. Across the test corpus it
  roughly halves the combined badness (fewer line crossings and fewer lines
  stepping on each other), keeps groups as readable bands, and stays stable on
  edit and collapse (small change → small visual change). Cycle-closing edges
  route as smooth peripheral swoops. Parallel edges and node notes are fully
  supported. This changes the geometry of existing boxes-and-lines diagrams.

### Removed

- **Dropped the `elkjs` dependency** (~1.4 MB). It was only used by the
  boxes-and-lines layout, now superseded by the built-in engine — smaller
  install for every consumer and a lighter script-tag bundle.

### Fixed

- **Map context labels.** Wide-but-short countries (Canada along the top of a
  US frame) and tall-but-narrow ones (Chile) keep their labels instead of being
  dropped by the antimeridian smear guard; Russia anchors over visible western
  Russia on regional projections; ocean and major-sea names outrank big
  countries which outrank minor bays and straits, and a small label budget
  always reserves room for countries so water can't crowd them out; framed
  US-state views now label the focus state itself.

## [0.27.0] - 2026-06-08

### Added

- **Node notes across five chart types.** Flowchart, state, class, ER, and
  boxes-and-lines diagrams gain `note <id>` — a floating comment bubble tethered
  to a node, placed by a shared collision-aware layout (`utils/notes/`) that
  keeps notes clear of shapes and never moves the diagram's own geometry. Notes
  collapse to a small comment-bubble badge and expand on click; colour a note
  with a trailing colour word (`note A This is a warning red`). `no-notes` opts
  out. Org and sitemap were evaluated and excluded — their indentation grammar
  conflicts with the note syntax.
- **Map: region values on choropleths.** Regions can carry their own numeric
  `value`, rendering a true choropleth alongside POIs. Tiny or POI-blocked
  regions get a leader-lined callout — placed in a reserved column on either
  edge, fanned out radially, or revealed by a zoom-out reserve — with chips kept
  off the canvas edge and high-contrast leaders.
- **Map: IATA airport codes resolve as place identifiers.** `poi JFK`,
  `route JFK -> LAX` and any three-letter IATA code resolve to airport
  coordinates through the existing name-lookup path — no new syntax. Coverage is
  large international hubs + all US scheduled-commercial airports, shipped as a
  separate optional `airports.json` asset (OurAirports, public domain; ~38 KB
  gz, loaded only for map diagrams). Resolution is case-insensitive and **by
  code only**; airports are the lowest-precedence identifier, so a token that is
  both a city and a code resolves to the **city** (with a non-blocking shadow
  hint). Editor completion lists codes as a labeled group below cities. Unknown
  codes emit `E_MAP_UNKNOWN_AIRPORT_CODE` with an `as <CODE>` hint.
- **Map: tagged connector/leg colours.** A trailing tag on a connector or route
  leg colours the line (`A ~> B l: Cruise`); focusing a leg co-highlights its
  endpoint POIs and the matching legend line, without dimming the basemap.
- **Map: undirected + labeled-undirected connector tokens.**
- **Map: population-sized city dots** as a subtle default layer (`no-cities`
  opts out), and **footprint-scaled, faded orientation backdrop labels** for
  context.
- **Map: auto-zoom for compact US region maps** — North-up framing with
  full-name labels; conic equal-area projection with a data-centered fit for
  regional maps.
- **Metric: colour ramps anchor at the data minimum** rather than zero, so
  value ranges that don't start at 0 use the full ramp.

### Changed

- **Default palette is now Slate** (was Nord), part of the Epic 108 rebrand. The
  active palette is correctly threaded into named-colour resolution so themed
  colours track the selected palette everywhere.
- **Sequence: participant position override requires a colon** — `position: N`
  (was bare `position N`). Pre-1.0, this is a hard break with no compat shim.
- Region borders now stay legible on dark themes; value ramps and segment fills
  stay strictly on-palette (no invented hues); journey-map emotion faces align
  to the curve scale; the swimlane legend toggle has a larger hit area.

### Removed

- **Trimmed the palette registry to seven curated palettes.** Dropped Dracula,
  Monokai, One Dark, Solarized, Gruvbox, and Rosé Pine — each failed the
  categorical-distinctness bar a diagram palette must meet (a single hex reused
  across distinct slots, or collapsed hues, so multi-category diagrams render
  different categories with identical colours). `getPalette()` falls back to the
  default (`slate`) for any removed id, so saved preferences and share URLs
  degrade gracefully. The kept seven: atlas, blueprint, catppuccin, nord, slate,
  tidewater, tokyo-night.

### Performance

- **World-map SVG shrunk ~75% (4.5 MB → 1.2 MB)** via render-side coordinate
  rounding, screen-space vertex thinning, and `<use>`-deduplicated coastline
  water-lines — unblocking globe/world maps in static-site builds.

### Internal

- Shared glyph-table text measurement now backs chart-type text sizing; extracted
  shared helpers for arrowhead `<marker>`s, `fitDiagramToCanvas`, and legend
  geometry; general dedup across renderers. No intended user-visible change.

## [0.26.0] - 2026-06-04

### Changed

- **Editor completion now offers only parser-valid keywords per chart type.**
  Structural keywords are sourced from a single authoritative, parser-validated
  registry (`STRUCTURAL_KEYWORDS`), with `TAG_SUPPORTING_TYPES` derived from it.
  Fixes two keywords the popup offered that the parser rejects: `tag` on RACI
  (no tag-block support) and `no-descriptions` on cycle (a removed keyword). The
  completion-conformance suite now locks structural keywords and the spec §1.3
  tag-support list against the parsers so they can't drift again.

### Removed

- **`DiagramSymbols.keywords`** (from `@diagrammo/dgmo/advanced` and the
  deprecated `/internal`). The field carried per-extractor reserved-word lists
  that nothing consumed in production; structural-keyword completion is now
  driven by `STRUCTURAL_KEYWORDS`. Breaking for any direct consumer of the
  extractor symbol shape.

### Fixed

- **Export renders no longer leave a tall band of dead space** below short
  flowchart, state, and RACI diagrams. In export mode the canvas height is now
  fitted to the scaled content; the interactive preview keeps its fit-to-pane
  behaviour.

## [0.25.3] - 2026-06-04

### Fixed

- **Pyramid descriptions no longer clip at the right edge in embeds** (Obsidian,
  remark/markdown, web embeds). `normalizeSvgForEmbed`'s string bounding-box
  estimator assumed every `<text>` was `text-anchor="middle"`, so it
  under-measured the right extent of `start`-anchored text (e.g. pyramid
  right-column descriptions) by half the text width — collapsing the tight
  viewBox and clipping that text when scaled to fit. The estimator now honors
  each element's `text-anchor` (`start`/`middle`/`end`). Benefits any chart type
  with anchored text near a margin.

## [0.25.2] - 2026-06-04

### Fixed

- **Word clouds no longer collapse to their title in embeds** (Obsidian,
  remark/markdown, web embeds). Word-cloud words are positioned with
  `transform="translate()"` and have no `x`/`y` attributes, so
  `normalizeSvgForEmbed`'s string bounding-box estimator couldn't see them — it
  measured only the title and zoomed that fragment to fill the frame. Tightening
  is now rejected when the measured box covers less than half of the renderer's
  canvas (a sign content was missed), keeping the correct full-canvas viewBox.
  Extends the embed-clipping fix in 0.25.1.

## [0.25.1] - 2026-06-04

### Fixed

- **Embedded diagrams no longer clip in hosts** (Obsidian, remark/markdown, web
  embeds). `normalizeSvgForEmbed`'s content-tightening used a string bounding-box
  estimator that ignores `<g transform>` and misparses path arc commands, so it
  could compute a shifted, out-of-bounds box that overrode each renderer's
  already-correct viewBox and cut off the right/bottom of the diagram (ER tables,
  mindmap nodes, flowchart elements). Tightening is now only applied when the
  computed box sits within the renderer's canvas — a genuine sub-rectangle —
  otherwise the renderer's correct bounds are kept.

## [0.25.0] - 2026-06-04

### Fixed

- **Legend text vertical centering** now uses an explicit `dy` offset instead of
  `dominant-baseline`, which WebKit (WKWebView / Safari) rendered inconsistently.
  Legend labels are now vertically centered in the desktop app and Obsidian.

### Removed

- Removed 9 confirmed-dead internal exports (pre-1.0 cleanup). These were never
  part of the documented public API.

### Internal

- Added a LICENSE file and a `license` field to `package.json`.
- CI now runs the hygiene trio (dead-code, duplication, and dependency checks)
  on push/PR.

## [0.24.0] - 2026-06-03

### Added

- **`normalizeSvgForEmbed` / `getEmbedSvgViewBox`** — public helpers that tighten
  a rendered SVG's `viewBox` to its content so inline embeds (Obsidian, host
  integrations) take the diagram's intrinsic aspect ratio instead of the fixed
  1200×800 export canvas. Short diagrams no longer reserve a tall dead band.
- **WYSIWYG map export** — map PNG export honors the preview pane's aspect
  ratio, and the legend reserves a top band so it no longer covers land.
- **Boxes-and-lines `show-values`** — refined value card layout.

### Fixed

- **Timeline** — fixed row height so events never overlap on short surfaces.
- **Map** — POI-only frames no longer chase a tall container's far edge.

## [0.23.0] - 2026-06-03

### Added

- **Boxes-and-lines value ramp** — a box can carry numeric `value:` metadata;
  `box-metric <label> [color]` names the value-ramp dimension and sets its hue,
  and `show-values` prints each box's number. Mirrors map's `region-metric`.
- **Higher-resolution relief** — finer relief polygons and hachure on maps.
- Map Inspect outlining — every region path is stamped with `data-iso`.

### Fixed

- **World maps fill the canvas edge-to-edge** — the global stretch-fill no
  longer leaves a padded margin; the antimeridian sits on the canvas edge with
  no fake coastline ringing the cut, and the wrap-sliver a landmass leaves on the
  far edge (Russia's Chukotka beside Alaska) is dropped.
- Decorative map overlays (relief, water-lines, rivers) no longer intercept
  region hover in WebKit.
- Region hover label is anchored to the area-weighted centroid.
- Disputed territories are merged into their parent region to fill holes.
- Horizontal time-sort timelines size their SVG to the content height instead of
  leaving a large vertical gap below the chart.

## [0.22.0] - 2026-06-03

### Added

- **Content-aware export canvas** (`mapExportDimensions`) — map exports size the
  canvas to the content's own aspect ratio instead of a fixed box, so regional
  maps no longer letterbox.
- **Colorize** — region maps with no data auto-colour every region a distinct
  pastel (greedy 4-colouring so no neighbours share a hue); `no-colorize` opts
  out.
- **New palettes** — Atlas, Slate, Blueprint (cyanotype), and Tidewater
  (nautical).
- Relief is unconditional — only `no-relief` hides it; now also shown on the US
  national Albers view.
- Coastal ocean anchors and container-region labels so zoomed-in coastal frames
  still label the surrounding ocean and the parent region.
- POI-only maps fit-zoom to their containing region.
- Route legs and labels are click-to-line navigable.

### Changed

- Wider context pad for region/choropleth maps.
- Legend controls can be app-hosted (`controlsHost: 'app'`), letting the host UI
  own the colouring controls.
- Removed the Bold palette.

### Fixed

- Antimeridian-crossing landmasses (e.g. Russia) now render in regional views.
- Ocean reads clearly as water and neutral land reads as land (contrast tuning).
- Inset coastline water-lines clipped to their box, with a water moat around
  inset borders.
- Adjacent region/POI labels no longer overlap at small scales; label halo gated
  on overflow.

### Performance

- Coastline and mask geometry collapsed into compound paths for faster
  legend-hover recolours on heavy maps.

## [0.21.1] - 2026-06-02

### Added

- **Map direct colors** — color a map with the same trailing-token idiom used
  everywhere else in dgmo, no tag group required:
  - `poi Austin red` sets a POI's marker fill directly (wins over a tag color
    and the default orange).
  - `Texas red` (or `California blue value: 92`) paints a region a flat
    categorical highlight that ignores the active colouring dimension and adds
    no legend entry — the lightweight "make this one stand out" escape hatch.
  - `region-metric Sales ($M) blue` sets the choropleth ramp hue (was always
    red). A place literally named for a color keeps it via capitalization
    (`poi Orange`).

## [0.21.0] - 2026-06-01

### Changed

- **Map syntax — one `value:` keyword** (breaking) — the `map` chart type's three
  numeric channels collapse into a single `value:`, rendered per element: region
  shade, POI marker size, edge/route-leg thickness. Replaces `score:` (regions),
  `size:` (POIs), and `weight:` (edges).
- **Map routes — origin header + arrow legs** (breaking) — a route is now
  `route <origin> [style: arc]` followed by indented `[-label->] destination`
  legs, each an edge with its own in-arrow label, `value:` thickness, and arc
  shape. Replaces the bare-stop list. Fixes two latent bugs: named-stop metadata
  is no longer silently dropped, and a loop-closing leg no longer double-draws the
  origin marker.
- **Map legend labels** — `region-metric` / `poi-metric` / `flow-metric` replace
  `metric` / `size-metric` (one `value:` keyword now drives three element
  channels that often carry different quantities).
- **Map scope** — a bare US state postal code resolves to that state
  (`poi Portland OR` → Oregon; `CA` = California) and signals US scope.

### Removed

- **Map** — the `description:` and `date:` reserved keys (no v1 surface — they now
  raise an unknown-key error instead of silently no-opping) and the
  `active-tag score` token (the value ramp is the default; select it by its
  legend name).

## [0.20.3] - 2026-05-31

### Fixed

- **Map — Antarctica** — Antarctica is no longer drawn on the world basemap.
  The natural-earth world frame is clamped to ~-58°N and global views take a
  canvas-filling stretch path with no clip, so Antarctica's -90° geometry
  spilled out the bottom of the canvas as a distorted strip. It's now omitted
  by convention (matching standard data world maps) unless explicitly
  referenced as a region.

## [0.20.2] - 2026-05-31

### Fixed

- **Map rendering** — a batch of fixes that make regional and US-states
  views render with correct geographic context instead of a tiny,
  context-free landmass:
  - Basemap is now culled by projected canvas overlap rather than a
    lat/lon bounding box, so neighbouring land is included whenever it
    actually falls inside the viewport.
  - Projected geometry is clipped to the canvas, eliminating stray
    off-canvas paths.
  - Regional POI/route maps and `us-states` (albers-usa) views now draw
    neighbouring land (e.g. South America, northern Canada) for context.
  - Hub POI labels seat above/below when both flanks are blocked.

### Docs

- Corrected the active-tag default in the language reference and a stale
  tsup dev-reload comment.

## [0.20.1] - 2026-05-30

### Fixed

- Map data loader (`src/map/load-data.ts`) now imports Node builtins
  (`fs/promises`, `url`, `path`) lazily, inside the async load path,
  rather than at module top level. The static imports were hoisted into
  `dist/index.js` and broke browser bundlers (Obsidian's esbuild, the
  app's Vite/Rollup web build) that pull dgmo in. The loader is Node-only
  by contract — the web build injects `MapData` via DI and never calls
  it — so deferring the imports keeps the node code out of the eager
  browser chunk. Mirrors the existing `await import('jsdom')` seam.

## [0.20.0] - 2026-05-30

### Added: `map` chart type

DGMO now renders geographic maps. Plot points of interest, shade
regions, and draw weighted routes/links over a world or US base map.

- **Base maps**: equirectangular world (snapped to a full Greenwich
  frame, every continent in view) and a purpose-built US projection
  (Albers conic with custom Alaska/Hawaii insets). Land fills the
  canvas; oceans render blue, lakes blue, neighbouring land neutral.
- **Points of interest** with inline labels that flip left when they
  would run off-canvas; dense clusters break into callout columns.
- **Regions** shaded by a selectable colouring dimension — `score`
  (continuous ramp) or `tag` (categorical) — with a bivariate flip
  between the two.
- **Routes/links** drawn as weighted arrows between points.
- **Legend** with hover highlighting and a score-gradient scrubber;
  hovering dims non-matching regions to neutral land.
- Natural Earth 110m rivers overlaid on world maps; crisp 10m North
  America surroundings under the US view.
- `mapNeutralLandColor` exported for hosts that dim the base map.

### ⚠ BREAKING: `description`/`technology` keywords now required (C4 + infra)

Keywordless-prose promotion is gone. In C4 and infrastructure
diagrams, a bare line under a node is no longer silently promoted to
its description — you must use the `description` (and `technology`)
keyword explicitly. The deprecation message has been corrected to
point at the keyword form. (DD-1, DD-2)

```dgmo
# Before (0.19.x) — bare prose promoted to description
Service API
  Handles all the things

# After (0.20.0)
Service API
  description: Handles all the things
```

### Fixed

- Map: blue ocean on world maps (dropped antimeridian frame-fillers);
  region-label halos use the opposite colour of the text so they
  always read; clean red score ramp with no muddy brown over green
  land; POI markers default to orange rather than the blue accent.

## [0.18.1] - 2026-05-28

### Documentation

- Regenerated `docs/language-reference.md` to spec parity. Added five
  missing sections: §13A PERT, §18 Mindmap, §21 Cycle, §22 Journey
  Map, and §26 Authoring Rules. Renumbered Tech Radar, Pyramid, Ring,
  RACI, and Colon Usage Summary to match spec ordering; swapped
  Wireframe + Tech Radar to align with spec source order. The MCP
  `get_language_reference` tool now serves complete documentation for
  every chart type.
- Migrated residual pipe-metadata examples in `README.md` to §1.4
  same-line form. The org-chart sample and the "single-line with pipe
  delimiter" prose subsection had been left out of the 0.18.0 pipe
  retirement sweep.

## [0.18.0] - 2026-05-27

### ⚠ BREAKING: `|` retired as metadata delimiter — unified §1.4 grammar

DGMO's pipe operator no longer delimits metadata. The five different
pipe-positional shapes across 17 chart types collapse into a single
same-line key-value form:

```dgmo
# Before (0.17.x)
Redis | instances: 3, latency-ms: 5
30bd Database | t: Engineering, 80%
Wisdom | Personal growth, recognition
(Submit) | primary, destructive

# After (0.18.0)
Redis instances: 3, latency-ms: 5
30bd Database t: Engineering, progress: 80
Wisdom description: "Personal growth, recognition"
(Submit) primary destructive
```

Legacy `|`-bearing lines emit `E_PIPE_OPERATOR_REMOVED` (one per
offending line). Bare-positional shapes that don't translate to a
direct comma-separated key list get keyed names:
`E_GANTT_BARE_PERCENT_REMOVED`, `E_JOURNEY_BARE_SCORE_REMOVED`,
`E_PYRAMID_BARE_DESCRIPTION_REMOVED`, `E_RING_BARE_DESCRIPTION_REMOVED`.

The `|` character still parses literally inside wireframe dropdown
options `{A | B}`, arrow labels per §1.10 (`A -file|name-> B`), and
quoted strings (`"Order | Items"`). The migration tool preserves
all three.

#### Migrate with `dgmo migrate`

```bash
dgmo migrate path/to/dir --diff           # preview
dgmo migrate path/to/dir --apply          # write (.bak sidecars by default)
dgmo migrate docs/ --embedded --apply     # .md / .mdx with fenced ```dgmo
```

The tool is dry-run by default, idempotent on re-run, and atomic
per file in `--embedded` mode (a parse-error block aborts the whole
file — no partial writes).

See `docs/migration-pipe-retirement.md` in the workspace for the
full migration walkthrough including per-chart-type recipes.

### Added — wireframe trailing-keyword flag form (§19.5)

Wireframe elements now accept a space-separated trailing keyword
list drawn from the closed 16-flag enum:

```dgmo
(Submit) primary destructive   # new — flag list
[Email] required                # new — single flag
Dashboard active                # new — flag on bare-text
```

Case-sensitive — lowercase tokens from the enum get peeled as flags
from the right of the label; capitalized labels stay verbatim.
Spec §19.5 has the authoring guidance.

### Added — `dgmo migrate` CLI subcommand

Line-by-line migration tool with a per-line classifier that
preserves wireframe dropdown braces, arrow labels (§1.10), and
quoted-name `|` characters. Surface:

```
dgmo migrate <path> [--dry-run|--apply] [--diff]
                    [--backup|--no-backup] [--embedded]
```

Also exposed in the MCP server (`@diagrammo/dgmo-mcp` 0.2.0) as
`migrate_diagram(content: string)` so LLMs can offer in-place
migration on legacy content they encounter.

### Added — `deprecatedSyntax` highlight role

The editor surfaces legacy `|` characters in a strikethrough red
deprecated-syntax color so authors see the migration prompt
visually before the parser diagnostic fires. The lezer grammar
tokenizes `|` uniformly, so surviving valid pipes (in dropdowns,
arrow labels, quoted strings) also paint as deprecated — accepted
noise during the transition.

### Added — §1.4 same-line metadata autocomplete

The diagrammo-app editor autocomplete now fires on `, ` continuation
inside an already-keyed metadata region (`Foo k: v, _` → suggests
next key). Same key set as the legacy `|` trigger; both coexist
during the transition.

### Diagnostic codes added

- `E_PIPE_OPERATOR_REMOVED` (error)
- `E_GANTT_BARE_PERCENT_REMOVED` (error)
- `E_JOURNEY_BARE_SCORE_REMOVED` (error)
- `E_PYRAMID_BARE_DESCRIPTION_REMOVED` (error)
- `E_RING_BARE_DESCRIPTION_REMOVED` (error)
- `E_TAG_DECLARED_AFTER_CONTENT` (error)
- `W_EMPTY_METADATA_VALUE` (warning)
- `W_ATTRIBUTE_AT_PARENT_INDENT` (warning)

## [0.17.0] - 2026-05-21

### ⚠ BREAKING: Sequence participant types trimmed from 9 → 4 + default

The sequence diagram retains only the types whose shape carries semantic
weight at a glance:

| Kept type | Shape |
|-----------|-------|
| `actor` | Stick figure |
| `database` | Vertical cylinder |
| `cache` | Dashed vertical cylinder |
| `queue` | Horizontal pipe |
| _default_ | Plain rectangle (used when `is a` is omitted) |

The keywords `service`, `frontend`, `networking`, `gateway`, and `external`
were **removed** — using any of them in `is a X` is a hard parse error
(`E_PARTICIPANT_TYPE_REMOVED`), one diagnostic per offending line.

```dgmo
sequence
Auth is a service       // E_PARTICIPANT_TYPE_REMOVED — drop the override
WebApp is a frontend    // E_PARTICIPANT_TYPE_REMOVED
LB is a networking      // E_PARTICIPANT_TYPE_REMOVED
API is a gateway        // E_PARTICIPANT_TYPE_REMOVED
Stripe is an external   // E_PARTICIPANT_TYPE_REMOVED
```

**Inference also shrinks** — the rule table goes from 223 → 82 rules.
Names that previously inferred to a removed type — `AuthService`, `WebApp`,
`Cloudflare`, `API Gateway`, `Stripe`, `Webhook` — now fall through to
the default rectangle. That fall-through is the intended outcome of the
trim: the differentiation went away because the underlying distinction
didn't carry its weight.

**Renderer impact:** 5 D3 helpers deleted (`renderServiceParticipant`,
`renderFrontendParticipant`, `renderNetworkingParticipant`,
`renderExternalParticipant`, `renderGatewayParticipant`) plus their
shape-dispatch switch cases (~200 lines).

**Sequence-only scope** — `external` / `database` / `cache` / `queue`
remain valid in C4, infra, and org diagrams under their own taxonomies.

#### Known breakage surfaces

Pre-existing share URLs (`online.diagrammo.app`) and third-party MDX
content via `remark-dgmo` / `astro-dgmo` / `docusaurus-plugin-dgmo` /
`fumadocs-dgmo` will surface the parse error once those wrappers
upgrade to `^0.17.0`. Share URLs do not pin a dgmo version.

#### Migration

Drop the `is a {removed-type}` override — the participant renders as
the default rectangle:

```dgmo
// Before
Auth is a service
WebApp is a frontend

// After
Auth
WebApp
```

#### Public API

- `ParticipantType` union narrowed to `'default' | 'database' | 'actor' | 'queue' | 'cache'`. Re-exported via `@diagrammo/dgmo/advanced`. Consumers that read the literal string values must update.
- `RULE_COUNT` (`participant-inference`) drops to 82 (was 223).
- `NAME_DIAGNOSTIC_CODES.PARTICIPANT_TYPE_REMOVED` and `participantTypeRemovedMessage(type)` added to `@diagrammo/dgmo/advanced`.
- `SERVICE_BORDER_RADIUS` renderer constant removed (was unused outside the deleted `renderServiceParticipant`).

## [0.16.0] - 2026-05-20

### ⚠ BREAKING: Universal trailing-token color syntax

Color is now the **trailing whitespace-delimited token** of a label region
(case-sensitive lowercase, matching one of 11 palette names: `red, orange,
yellow, green, blue, purple, teal, cyan, gray, black, white`). The old
`Label(color)` parens form is gone — parens are now literal label text.

```dgmo
Done(green)             →  Done green
[Done](green)           →  [Done] green
Swordsmanship(red) as s →  Swordsmanship red as s
era 1718 -> 1720 Foo(red) → era 1718 -> 1720 Foo red
```

**The label region** is whatever the parser hands to the color rule after
stripping its own structural terminators (`as <alias>`, `| pipe`, numeric
values, date ranges, brackets, arrow constructs). This applies uniformly
across every chart type that carries color in label position.

**Capitalize to escape**: `Red`, `Yellow`, `Green` stay as literal labels
— useful for traffic-light tag groups that want the color word as the
name itself.

**The 11-name palette is now a frozen public contract.** Adding a 12th
color name in any future release is itself a breaking grammar change
requiring a major version bump, because any user diagram with the new
word as a label would silently change behavior.

#### Edge color removed (flowchart, state, sitemap)

Edges on these three chart types no longer have a color slot. `A -(red)-> B`
parses as a label `(red)`; `A -yes-> B` and `A -no-> B` no longer auto-color
the arrow. All edges render with the default theme color. To color a *node*,
use tags. Sankey/chord links are the one exception — they carry data, so a
trailing color word after the numeric flow value colors the link
(`Source -> Target 3000 red`).

The `inferArrowColor()` function (label-semantic `yes→green`, `no→red`,
`maybe→orange`) and `matchColorParens()` helper are both deleted; their
`@diagrammo/dgmo/advanced` re-exports are gone.

#### Cycle / pyramid / ring / RACI / boxes-and-lines: pipe-shortcut

These five chart types pair the universal trailing-token form with their
existing `| color: <name>` pipe-metadata long form. Both produce the same
AST; the trailing-token form is a shortcut when color is the sole metadata:

```dgmo
Spring green                       // shortcut
Spring | color: green              // long form (equivalent)
Spring | color: green, icon: ❄     // long form REQUIRED when other keys
```

#### Accepted tradeoffs

- **No typo diagnostics**: `Done grren` parses silently as a 2-word label
  with no color. Internal corpus has a near-miss smoke test; user content
  gets no help.
- **Case-sensitivity is the escape hatch**: only lowercase recognized.
- **Lezer grammar** drops the `ColorAnnotation` token; trailing color
  words now tokenize as plain `Identifier` nodes.

### Changed

- **Static exports hide collapsed tag-group pills and the gear/cog control.**
  When a diagram is exported (PNG / SVG / PDF) via the desktop or web app,
  the legend now shows only the active tag-group capsule centered above the
  diagram. Collapsed group pills, interactive toggles, and the cog disappear
  — they convey no meaning in a static image. Interactive previews and
  shared `online.diagrammo.app` views are unchanged. The dgmo CLI also
  preserves the full legend by default; pass `exportMode: true` to
  `renderForExport()` for static-export semantics.

### Breaking changes (Type API)

- `LegendMode` literal values changed from `'fixed' | 'inline'` to
  `'preview' | 'export'`. Re-exported via `@diagrammo/dgmo/advanced`.
  Audited workspace-internal consumers (`obsidian-dgmo`,
  `diagrammo_app_site`, `remark-dgmo`, `astro-dgmo`,
  `docusaurus-plugin-dgmo`, `fumadocs-dgmo`) — zero direct usages. External
  npm consumers that read `LegendMode` literal values directly will need
  to update.
- `matchColorParens()` and `inferArrowColor()` removed from
  `@diagrammo/dgmo/advanced`. External consumers that imported them must
  drop the calls — edges no longer carry color, and `(color)` parens are
  no longer recognized.
- `GraphEdge.color`, `SitemapEdge.color`, `LayoutEdge.color` (sitemap +
  graph) fields removed from public types.

## [0.8.23] - 2026-04-22

### Added

- Pyramid diagram type — stacked hierarchy with descriptions, auto-alternating columns when content overflows, per-layer colored accent bars, and `inverted` directive for funnel orientation. Source order reads apex-first (file top = visual top).

## [0.8.22] - 2026-04-21

### Added

- Journey-map diagram type with emotion curves, thought bubbles, score faces, and lucide icons
- Cycle diagram type with canvas-aware label fitting and circle-nodes option
- Tech-radar diagram type with interactive quadrant focus, ring hover, popovers, and multi-page PDF export
- Universal node descriptions for infra, sitemap, mindmap, C4, and boxes-and-lines
- Numeric separator support (commas and underscores) in all data charts
- Collapsible groups for state diagrams
- 2-level nested group support for boxes-and-lines
- Text wrapping for mindmap node labels
- Click-to-lock on journey-map y-axis score faces
- Ring section syntax and aliases for tech-radar

### Changed

- Remove `(color)` suffix from node labels and drop explicit `alias` keyword
- Smaller ECharts bundle via selective modular imports
- Remove branding feature (`injectBranding` and `--branding` CLI flag)
- Remove mermaid quadrant parser and theme bridge
- Enrich `render()` return type with diagnostics and common-mistake detection

### Fixed

- Sequence diagram conditional label spacing
- Kanban export columns now show counts, swimlanes do not
- B&L group-to-group shorthand edges and layout alignment
- Note bullet wrapping no longer splits prefix from content
- Sequence note-message collision in collapsed group views
- Funnel chart gap removal between levels
- Group label spacing, collapse, and edge curves in boxes-and-lines
- Color `mix()` calls corrected to use percent 0-100 instead of decimal 0-1

## [0.8.19] - 2026-04-10

### Added

- Wireframe diagram type with visual-mnemonic syntax, depth shading, and group label toggle
- Mindmap diagram type with two-sided horizontal tree layout and depth-colors
- Collapsible sequence diagram groups with legend controls
- CompactViewState and `vs=` URL encoding for view state sharing
- Sprint duration unit and timeline bands for Gantt charts
- Interactive view state threaded through all export paths
- Stroke halo on sequence message labels for legibility
- Export `mix()` from public API for app color blending

### Changed

- Hide inactive legend pills in exports
- Skip SVG title in live preview (rendered in HTML instead)

### Fixed

- Expand toggle on sequence participant wrapper
- Section positioning when collapse projection is active
- Legend capsule overflow when entries barely fit single row
- Collapsed sitemap containers rendering smaller than sibling page cards
- Wireframe depth shading contrast and fill colors

## [0.8.17] - 2026-04-08

### Added

- Kanban tag-group swimlanes
- Boxes-and-lines diagram type with groups, collapse/expand, shape-mode legend, and render mode override
- Group-to-group and node-to-group linking for sitemap and boxes-and-lines
- Lezer grammar for DGMO syntax highlighting (`@diagrammo/dgmo/editor`)
- Cross-platform DGMO syntax highlighting and CLI `cat` command
- Catch-all diagnostics for unrecognized lines across all parsers
- Spec conformance test suite
- ESLint, Prettier, cspell, and pre-commit hooks
- Share link payload now includes optional filename
- Line number tracking for else/else-if block dividers in sequence diagrams

### Changed

- Standardize directive naming and remove deprecated colons
- Remove colon syntax from quadrant directives/data and arc link weights
- Change flowchart default direction from LR to TB
- Default bar charts to vertical bars, add `orientation-horizontal`
- Restrict color suffixes to 11 named colors with inline diagnostics
- Share URL base changed to online.diagrammo.app
- Centralize legend rendering across all D3 chart types
- Heatmap labels moved to top, smart rotation on overlap
- Sankey node/link colors tinted for softer appearance
- Quadrant chart label collision avoidance
- Upgrade TypeScript to 6.0, dagre to 3.0, jsdom to 29

### Fixed

- ER indented relationship regex for double-dash unlabeled form
- Gantt freeze when typing partial start date
- Horizontal bar chart ordering and label layout
- Data row parser consuming label numbers as values
- ER relationship cardinality tokenization
- Symbol extractors handling multi-word arrow labels
- Legend positioning for kanban and timeline
- Pie/doughnut/polar-area radius to prevent label truncation

### Removed

- Blue emphasis effects (replaced with dim-only highlight approach)
- ECharts tooltips from all data charts
- Zoom/pan on chord diagrams

## [0.8.0] - 2026-03-27

### Added

- Gantt chart type with scheduler, dependency arrows, critical path, tag swimlanes, hover interactivity, markers, eras, and uncertainty fade
- Editor autocomplete with completion registry, chart types, and symbol extractors
- Scatter group emphasis and cursor-driven era highlighting
- Directed/undirected chord links
- Line number tracking for xlabel, ylabel, series, eras, markers, dependencies, and tags
- Prominent emphasis styling for line/area chart points
- Dracula and Monokai color palettes
- Interactive Type legend for class diagrams
- Interactive Status legend for initiative-status diagrams
- Collapsible tag lanes with `sort:tag` directive for Gantt

### Changed

- Centralize legend rendering with shared SVG generator
- Legends moved to top placement across all diagram types
- Remove colons from org `tags`/`import` and C4 `import` directives
- Migrate all docs, gallery fixtures, and test fixtures to colon-free DSL syntax
- Scale Gantt and timeline diagrams to fit the view area
- Make whitespace optional around all arrow operators
- Remove branding watermark from exports by default
- Enforce single pipe delimiter for metadata across all parsers

### Fixed

- Scatter label collision avoidance and legend centering
- Comma-grouped number false merge and timeline era/marker colon handling
- Infra playback control speed multiplier
- Timeline bar stroke fade on ambiguous-end events
- Bar chart x-axis label crowding on dense datasets

### Removed

- Framework name leakage (ECharts/D3) from public API

## [0.6.3] - 2026-03-21

### Added

- Claude Code skill integration (`--install-claude-code-integration`)
- Codex CLI integration (`--install-codex-integration`)
- Multi-diagram symbol extraction API for editor completions
- ER diagram semantic entity coloring and layout overhaul
- Claude Code `/dgmo` skill with editing, validation, and code-to-diagram

### Changed

- Muted fill + solid outline style for all filled chart types
- Standardize legend as fixed overlay across all diagram types
- Improved infra edge routing with port ordering and collision avoidance

### Fixed

- Space-containing participant names in sequence parser
- ER diagram render stagger (pre-compute layout dimensions)
- C4 fixed overlay legend, sitemap bottom legend, infra tag groups
- Line/area chart x-axis label crowding on dense datasets

## [0.5.5] - 2026-03-12

### Added

- Tag-based swimlanes for timeline diagrams
- Universal `[Group]` syntax and tag groups for ER/timeline
- SLO threshold system for infra diagrams
- Fan-out multiplier for infra diagram connections
- Eye icon visibility toggle for org chart legend
- Palette + theme encoding in share URLs
- Venn diagram DSL redesign with highlight behavior
- Infra multi-expand layout support

### Fixed

- Initiative-status back-edge arrowheads and Y-displaced edge crossings
- Resolver dropping header lines with trailing whitespace
- Collapsed group latency using critical-path instead of child sum
- Infra diagram group collision with post-layout separation pass

## [0.4.4] - 2026-03-08

### Added

- Infra diagram type with compute engine, collapse, SLO thresholds, and system-wide metrics
- Sitemap diagram type with fixed legend, eye icons, and tag hover
- State diagram type with indent-based source inference
- Tag system for sequence diagrams
- C4 architecture diagrams (context, container, component, deployment levels with drill-down)
- Initiative-status diagram type with grid layout, containment groups, and shape inference
- Kanban board diagram type with parser, renderer, and mutations
- Sankey diagram indentation-based syntax with color annotations
- Tag group block syntax (`tag:`)
- Share URL encoding with query param and hash fragment
- Collapsible groups persisted in share URLs

### Changed

- Sequence arrow syntax v2: labeled calls and return arrows
- Remove left-arrow support (only forward arrows allowed)
- Standardize `//` as the only comment syntax across all parsers
- Universal arrow syntax and symbolic-only ER cardinality

### Fixed

- Slope chart label overflow and collision resolution
- Bar chart x-axis label collisions and ylabel spacing
- Note overlapping return arrow in sequence diagrams
- Collapsed group uptime/latency mismatch with diagram defaults

## [0.2.24] - 2026-02-27

### Added

- Org chart with import resolution, tag metadata, and legend
- Class diagrams with inline extends/implements and UML 3-compartment layout
- Timeline diagrams with eras, markers, and uncertain end dates
- Flowchart rendering
- Multi-line indented value syntax for chart properties
- CamelCase-aware text fitting and Staff actor inference
- CLI `--json` and `--chart-types` flags
- DSL language reference documentation

## [0.2.0] - 2026-02-10

### Added

- Initial release of `@diagrammo/dgmo`
- Sequence diagram parser and renderer with collapsible sections
- Data chart support (bar, line, area, pie, doughnut, radar, polar-area, funnel, scatter, heatmap, wordcloud, slope, arc, venn, quadrant)
- CLI for rendering `.dgmo` files to SVG and PNG
- 10 color palettes (bold, catppuccin, dracula, gruvbox, monokai, nord, one-dark, rose-pine, solarized, tokyo-night)
- ECharts SSR rendering
- Homebrew tap support

[0.8.22]: https://github.com/diagrammo/dgmo/compare/v0.8.19...HEAD
[0.8.19]: https://github.com/diagrammo/dgmo/compare/v0.8.17...v0.8.19
[0.8.17]: https://github.com/diagrammo/dgmo/compare/v0.8.0...v0.8.17
[0.8.0]: https://github.com/diagrammo/dgmo/compare/v0.6.3...v0.8.0
[0.6.3]: https://github.com/diagrammo/dgmo/compare/v0.5.5...v0.6.3
[0.5.5]: https://github.com/diagrammo/dgmo/compare/v0.4.4...v0.5.5
[0.4.4]: https://github.com/diagrammo/dgmo/compare/v0.2.24...v0.4.4
[0.2.24]: https://github.com/diagrammo/dgmo/compare/v0.2.0...v0.2.24
[0.2.0]: https://github.com/diagrammo/dgmo/releases/tag/v0.2.0

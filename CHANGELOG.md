# Changelog

All notable changes to `@diagrammo/dgmo` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

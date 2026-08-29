# dgmo — Architecture Report

> Generated from a source-level walkthrough on 2026-06-28 (`@diagrammo/dgmo` v0.42.0).
> Diagrams are DGMO fences — open this file in the Diagrammo app or online.diagrammo.app
> to see them rendered; the raw source is readable as-is. Line references point at
> `src/` as of this commit.

## TL;DR

- **What it is:** The core library + CLI for the DGMO diagram markup language — it turns a text document into an SVG (and, in the CLI, a PNG).
- **Stack:** TypeScript, built dual ESM/CJS via tsup. D3 for rendering, jsdom for server-side DOM, `@resvg/resvg-js` for SVG→PNG. Zero published `@diagrammo/*` runtime deps — this is the bottom of the dependency graph.
- **Shape:** A **registry-driven dispatcher** wrapping ~60 self-contained chart types. One detection step picks a type; one registry binds each type to its parser; rendering fans out to three backends. Every chart type is an isolated `parser → (layout) → renderer` triplet under its own folder.
- **Read next:** the **Module map** for structure, then **Chart-type detection** for the one decision that drives everything.

## Module map

The library is a thin pipeline (`index → render → router → parsers → renderers`) plus a ring of support modules (palettes, diagnostics, completion, sharing). The `Render` layer is small on purpose — it detects, parses, and hands off; all the real work lives inside the per-type parser/renderer folders and the D3 backends.

```dgmo
boxes-and-lines dgmo — Module Map

tag Layer as l API blue, Routing orange, Parsing purple, Rendering green, Support teal

direction LR

Index l: API
  index.ts — public render / validate / palettes / share
  -calls-> Render
  -exposes-> Completion
  -exposes-> Sharing
CLI l: API
  cli.ts — file/stdin in, SVG or PNG out
  -calls-> Render
  -rasterizes via-> Resvg

Render l: Routing
  render.ts — entry; picks render category; manages jsdom
  -detect + parse-> Router
  -render-> D3
  -collects-> Diagnostics
Router l: Routing
  dgmo-router.ts — first-line + inference detection
  -dispatch table-> Registry
  -parse-> Parsers
Registry l: Routing
  chart-type-registry.ts — single source: category, parse, measure (+ chart-types.ts metadata)

Parsers l: Parsing
  per-type parser.ts (sequence, c4, er, ...)
D3 l: Rendering
  d3.ts — data-chart + visualization backends + export handlers
  -per-type renderer-> Renderers
  -colors-> Palettes
Renderers l: Rendering
  per-type renderer.ts + layout.ts emit SVG
  -colors-> Palettes

Palettes l: Support
  colors.ts + palettes/ — 11 names, 7 palettes, light/dark
Diagnostics l: Support
  diagnostics.ts — DgmoError, dedupe, did-you-mean
Completion l: Support
  completion.ts — editor / CLI / MCP autocomplete
Sharing l: Support
  sharing.ts — lz-string URL encode / decode
Resvg l: Support
  resvg-js — SVG to PNG with bundled Inter fonts
```

Things worth knowing from this map:

- **`chart-type-registry.ts` is a deliberate single source of truth** (Story 109.1). It binds each type's `category`, `parse`, and `measure` in one place; `dgmo-router.ts` and `dimensions.ts` _derive_ their tables from it instead of keeping parallel lists, and a test asserts the derived tables stay complete (`src/chart-type-registry.ts:1–28`). Metadata that the AI-selection engine reads (`description`, `fallback`) stays separate in `chart-types.ts` — dispatch vs. data are split on purpose.
- **The export-render dispatch is intentionally _not_ in the registry.** `renderForExport` and `DIAGRAM_EXPORT_HANDLERS` live in `d3.ts` so per-type renderers can stay lazily imported — pulling every renderer into the registry would bloat consumer bundles (`src/chart-type-registry.ts:21–25`).
- **`render()` is async and manages a jsdom lifecycle** on Node, ref-counted so it doesn't leak a `window` global into a host that does its own SSR after calling it (`src/render.ts:30–76`).

## Chart-type detection

The single most important control-flow decision: given raw text, which parser runs? `dgmo-router.ts` first trusts an explicit first-line type (`gantt`, `c4`, …); if there isn't one, it runs an ordered chain of `looksLikeX()` heuristics; if nothing matches, it falls back to the visualization parser rather than erroring out.

```dgmo
flowchart Chart-Type Detection (dgmo-router)

(content) -> /first non-comment line/ -> <explicit type?>
  -yes-> [parse via PARSER_BY_ID] -> (AST + diagnostics)
  -no-> <looksLikeX inference hit?>
    -yes-> [parse via PARSER_BY_ID]
    -no-> [parseVisualization fallback] -> (AST + diagnostics)
```

The inference order is significant — it runs `looksLikeSequence → Flowchart → ClassDiagram → ERDiagram → State → Sitemap → Org → C4 → Gantt → Pert` (`src/dgmo-router.ts:97–106`), most-specific first, so an ambiguous document resolves to the narrower type. Parser lookup itself is O(1) via `PARSER_BY_ID`, a Map derived from the registry (`src/dgmo-router.ts:168–176`). Diagnostics are de-duplicated before return so one bad line doesn't surface the same error repeatedly (`:194`).

## Render pipeline

Once a type is known, `render()` branches on its **render category** — one of `data-chart`, `visualization`, `diagram` (`src/chart-type-registry.ts:78`). Data charts take a direct D3 path; everything else parses through the router and renders via the per-type handler. Both paths return `{ svg, diagnostics }`.

```dgmo
sequence render() — Detect, Parse, Draw

Caller -render(content, opts)-> Render
note Render installs jsdom globals on Node, ref-counted
Render -getRenderCategory(type)-> Registry
Registry -category-> Render

if category is data-chart
  Render -renderDataChartD3()-> D3
  D3 -SVG-> Render
else
  note diagram or visualization path
  Render -parseDgmo(content)-> Router
  Router -parseFirstLine / looksLikeX-> Router
  Router -PARSER_BY_ID.parse-> Parser
  Parser -AST + diagnostics-> Render
  Render -renderForExport()-> D3
  D3 -dispatch per-type-> Renderer
  Renderer -SVG-> Render

Render -release jsdom, return {svg, diagnostics}-> Caller
```

`render.ts:114–225` is the whole story: data-chart types short-circuit to `renderDataChartD3()` (`:170`); diagrams and visualizations go through `renderForExport()` (`:181`), which is the `d3.ts` dispatcher that lazily imports the right per-type renderer. The CLI adds one final step the library doesn't: it pipes the returned SVG through resvg to produce a PNG, using the active palette's `bg` as the canvas background and the bundled Inter fonts (`src/cli.ts:207–221`).

## Anatomy of a chart type

The pattern to know if you're adding or modifying a type. A chart type is an isolated unit: a registry entry that binds it, a parser that produces a typed AST, an optional layout pass, a renderer that emits SVG, and a completion extractor for editor/MCP autocomplete.

```dgmo
boxes-and-lines Anatomy of a Chart Type

tag Step as s Declare orange, Parse purple, Render green, Assist teal

direction LR

Registry s: Declare
  chart-type-registry.ts entry binds id, category, parse, measure
  -routes to-> Parser
Parser s: Parse
  per-type parser.ts builds a typed AST plus diagnostics
  -feeds-> Layout
  -extractor in-> Completion
Layout s: Render
  per-type layout.ts computes positions (sometimes inline in renderer)
  -feeds-> Renderer
Renderer s: Render
  per-type renderer.ts emits SVG via D3
Completion s: Assist
  completion.ts surfaces autocomplete to editor and MCP
```

Concretely, `sequence/` ships `parser.ts` (`parseSequenceDgmo → ParsedSequenceDgmo`), a `renderer.ts`, plus helpers (`collapse.ts`, `tag-resolution.ts`, `participant-inference.ts`); `c4/` splits the work into `parser.ts`, a large `layout.ts` (containment hierarchy), `renderer.ts`, and `types.ts`. **To add a type you touch ~3–5 files:** register it in `chart-type-registry.ts`, add `parser.ts` + `renderer.ts` (+ `layout.ts` if positioning is non-trivial), add a `looksLikeX()` if you want inference, and register a completion extractor. The registry test will fail loudly if you register a type without wiring its derived tables — that's the guardrail.

## Color & palette system

Colors are a **closed set of 11 names** (red, orange, yellow, green, blue, purple, teal, cyan, gray, black, white) — `resolveColor(name, palette)` returns a hex or `null`; unknown names are a diagnostic, not a silent pass-through (`src/colors.ts:49–99`). A palette is 19 resolved colors per theme (surface/text hierarchy + semantic accents + the 11 named swatches), with `light` and `dark` variants; 7 ship (`atlas`, `blueprint`, `catppuccin`, `nord`, `slate`, `tidewater`, `tokyo-night`). Renderers never hardcode hex — they pull from the palette and blend via `mix()`/`tint()`/`shade()` in `palettes/color-utils.ts`, because **resvg doesn't support CSS `color-mix()`** so blends must be pre-computed to hex.

## Notes & gotchas

- **`render()` is async** — it dynamically imports renderers and manages jsdom; callers must `await`.
- **Two render targets, one renderer.** Browser surfaces and the CLI share the SVG output; only the CLI's resvg→PNG step has the `color-mix()` constraint, but the code targets it everywhere for parity.
- **Dispatch is data, not code.** Adding a branch to `dgmo-router.ts` is almost never right — add a registry entry and let the derived tables update. The four-sites-to-edit problem this replaced is documented at `chart-type-registry.ts:5–17`.
- **Share URLs are size-bounded.** `sharing.ts` lz-string-compresses the DSL + interactive view-state into a URL with an 8 KB ceiling; oversized diagrams return an error object rather than a broken link (`src/sharing.ts:97`).

---

_No ER diagram (the library has no persistent data model — its closest analogue, the chart-type registry, is covered above) and no infra diagram (it's a library: no deployment topology, no services). Diagramming either would mean inventing structure that isn't in the code._

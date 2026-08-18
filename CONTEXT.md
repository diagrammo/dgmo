# CONTEXT — dgmo

The domain glossary for the dgmo library + CLI. Names the **seams** that already exist so architecture work talks about *the chart-type registry* and *the render router*, not "the handler" or "the service."

Architecture vocabulary (module, interface, seam, depth, adapter, leverage, locality) is defined in the architecture skill's `LANGUAGE.md` and is **not** redefined here. This file names the domain nouns and where their seams live.

## What dgmo is

A library that turns **DGMO source text** (a line-oriented diagram language — see `docs/dgmo-language-spec.md` at the workspace root) into an **SVG**, plus a CLI that wraps it and can rasterize to PNG. ~45 chart types span three render families.

## Core domain terms

**DGMO source** — the input string. Line-oriented; first line (or content heuristics) selects the chart type. The authoritative grammar is `docs/dgmo-language-spec.md`, not any fixture.

**Chart type** — one diagram kind (`sequence`, `flowchart`, `boxes-and-lines`, `bar`, `map`, …). Each has an `id` and belongs to one **render family**.

**Render family / category** — which renderer a chart type dispatches to. Three values: `data-chart` (ECharts), `visualization` / `diagram` (D3 + jsdom). The category lives on the chart type's registry descriptor; the **render router** dispatches on it.

**Parsed model** — the read-only `Parsed*` value a parser produces (`ParsedSequenceDgmo`, `ParsedGraph`, `ParsedBoxesAndLines`, …). The seam between parsing and rendering: parsers write it, renderers read it, nothing mutates it across the line.

## The seams (interface lives here ↓)

**Chart-type registry** — `src/chart-type-registry.ts`. `CHART_TYPE_REGISTRY: ChartTypeDescriptor[]` + derived `REGISTRY_BY_ID`. The single source of truth: each chart type declares `{ id, category, parse }` once; every other table (`chartTypes`, the export-handler map) is cross-checked against it by `chart-type-registry.test.ts`. **This is the deepest seam in the codebase — adding a chart type means adding a descriptor.** See ADR-0001.

**Render router** — `src/render.ts` (public `render()`) → `src/dgmo-router.ts` (`parseDgmo`, `getRenderCategory`). Parses, looks up the category, dispatches to one of the family renderers. See ADR-0005 for the category split.

**Family renderers** — the three export entry points:
- `src/d3.ts` — `renderForExport()`, dispatching on `DIAGRAM_EXPORT_HANDLERS` (~32 diagram/visualization handlers). Needs a DOM; callers acquire/release jsdom around it.
- `src/echarts.ts` — `renderExtendedChartForExport()`, for `data-chart` types.
- `src/chart.ts` — `parseChart()`, the shared parser for the standard ECharts types (bar/line/pie/area/…).

**Per-type parser/renderer pair** — most chart types live in their own folder (`src/sequence/`, `src/graph/`, `src/boxes-and-lines/`, …) as `parser.ts` (→ parsed model) + `renderer.ts` (parsed model → `SVGSVGElement`). The intended shape is **parse → model → render**; whether layout is embedded in the renderer or pre-computed in a `layout.ts` is currently per-type, not a shared seam (a known friction point).

**Layout** — `src/boxes-and-lines/layout.ts` and `src/graph/layout.ts` position nodes/edges before rendering. The b&l engine is home-grown (dagre placement-search), not a general library. See ADR-0003.

**Public API** — `src/index.ts`. The frozen, semver-stable surface (`render`, `validate`, `getPalette`, `chartTypes`, sharing + embed helpers). `@diagrammo/dgmo/advanced` is the explicit unstable escape hatch for low-level parsers/renderers. See ADR-0002.

**CLI** — `src/cli.ts`. Wraps the public API; adds PNG rasterization (Resvg), `share`, `types`, `install`, `mcp`. Calls into `dgmo-router` + palette registry, not into per-type internals.

## Cross-cutting modules (shared by every chart type)

- **Palettes** — `src/palettes/` (registry + 7 palettes + `color-utils.ts`). `getPalette(id)` → `PaletteConfig` with `light`/`dark` `PaletteColors`. Renderers compute fills via `mix()`, `shapeFill()`, `contrastText()`.
- **Colors** — `src/colors.ts`. The *closed* set of recognized color names + name→hex resolution + diagnostics on invalid names.
- **Diagnostics** — `src/diagnostics.ts`. `DgmoError { line, message, severity, code? }`, the `makeFail`/`dedupeDiagnostics`/`suggest` helpers, and the stable diagnostic-code sets the MCP server + editor depend on.
- **Tag groups** — `src/utils/tag-groups.ts`. The interactive-legend / swimlane feature; parsed per chart type, validated + auto-colored centrally.
- **Legend** — `src/utils/legend-*.ts`. `renderIntegratedLegend()` draws a legend from tag groups.
- **Text measurement** — `src/utils/text-measure.ts`. Canonical measurer (`measureText`, `truncateText`).
- **Label layout** — `src/label-layout.ts`. Geometry primitives for leader-line / label collision avoidance.
- **Fonts** — `src/fonts.ts`. `FONT_FAMILY` constant; bundled Inter for CLI rasterization.

## Where dgmo's responsibility ends

- **Chart-type *selection*** (natural-language prompt → suggested chart type) lives in **dgmo-mcp**, not dgmo. dgmo only exposes the registry it scores against. See ADR-0004.
- **Interactivity** (hover, pan/zoom, click-sync) is added by host apps over the exported SVG, not by dgmo.

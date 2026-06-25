# ADR-0005 — Render-family dispatch by category, jsdom only for the D3 family

**Status:** Accepted

## Context

dgmo's ~45 chart types are rendered by two very different engines: ECharts (data charts) and D3 + manual SVG (diagrams + visualizations). ECharts can produce SVG without a DOM; the D3/manual renderers need a DOM, which in Node means acquiring a jsdom instance — an expensive resource that must be released.

## Decision

Each chart type's registry descriptor carries a `category`: `data-chart`, `visualization`, or `diagram`. `render()` (`src/render.ts`) looks up the category via `getRenderCategory()` and dispatches:

- `data-chart` → `renderExtendedChartForExport()` (`echarts.ts`) — no DOM.
- `visualization` / `diagram` / unknown → acquire jsdom, `renderForExport()` (`d3.ts`), release jsdom.

jsdom is acquired **only** for the D3 family, around the single render call.

## Consequences

- The category is the dispatch key; it lives on the registry descriptor (see ADR-0001), so the two facts stay together.
- Don't scatter jsdom acquisition into per-type renderers — it belongs at the router, scoped to the D3 family.
- A new chart type must pick a category; an unknown/missing category falls through to the jsdom path.

# ADR-0001 — Chart-type registry is the single source of truth

**Status:** Accepted

## Context

dgmo has ~45 chart types. Each needs to be known to several subsystems: the parser dispatch, the export-handler map, the public `chartTypes` list, and the CLI `types` command. If each subsystem kept its own list, adding a chart type would mean editing N places and the lists would drift.

## Decision

`src/chart-type-registry.ts` holds `CHART_TYPE_REGISTRY` — one `ChartTypeDescriptor` per chart type (`{ id, category, parse }`) — and the derived `REGISTRY_BY_ID` map. Every other table derives from it or is cross-checked against it by `chart-type-registry.test.ts` (registry ↔ `chartTypes` ↔ `DIAGRAM_EXPORT_HANDLERS` must stay in sync, enforced as a test).

The descriptor also carried a sizing pair, `measure?` / `minDims?`, relocated in from `src/dimensions.ts`. That module was deleted 2026-08-04 and was their only production caller, so both fields and the 38 formulas behind them were removed 2026-08-17 (issue 14) — git history holds them if a caller ever appears.

Adding a chart type = add a descriptor + its parser/renderer pair; the test fails until the wiring is complete.

## Consequences

- The registry is the deepest seam in the codebase: high leverage, strong locality for "what chart types exist."
- The cross-check test is load-bearing — do not weaken it to make a partial chart type pass.
- A future review may legitimately propose _deepening_ the descriptor (e.g. folding the export handler or an `isExtended` flag into it so the four-place sync for ECharts "extended" types collapses). That deepens this seam; it does not contradict this ADR.

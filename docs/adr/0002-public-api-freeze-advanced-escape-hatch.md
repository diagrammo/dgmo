# ADR-0002 — Frozen public API in index.ts, unstable surface behind /advanced

**Status:** Accepted

## Context

dgmo is consumed by many repos (the desktop app, MCP server, Obsidian plugin, remark/astro/docusaurus/fumadocs wrappers, the marketing site). They need a stable interface. But internal tooling (the app's editor, the MCP slicer, evals) needs low-level parsers and renderers that change every minor release.

## Decision

`src/index.ts` is the **frozen, semver-stable** interface: `render`, `validate`, `getPalette`, `palettes`, `themes`, sharing + embed helpers, `chartTypes`, and a fixed set of type exports. (`getMinDimensions` was listed here until 2026-08-17; it left the public surface when `src/dimensions.ts` was deleted on 2026-08-04.)

`@diagrammo/dgmo/advanced` is the **explicit unstable** surface: low-level parsers (`parseFlowchart`, `parseChart`, …), D3 renderers, and shared internals. Breaking changes there are permitted per-minor and don't require a major bump.

Import internals via `/advanced`, never `/internal` (a recurring mistake — `/internal` is not the escape hatch).

## Consequences

- Leverage: one small frozen interface pays back across the whole ecosystem.
- Anything promoted from `/advanced` to `index.ts` is a semver commitment — promote deliberately (e.g. `chartTypes` was promoted at 1.0).
- A review proposing to "expose X for testing" should prefer an internal seam over widening the public interface.

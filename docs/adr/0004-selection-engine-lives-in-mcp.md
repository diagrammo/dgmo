# ADR-0004 — Chart-type selection lives in dgmo-mcp, not dgmo

**Status:** Accepted

## Context

Natural-language chart-type *selection* (prompt → suggested chart type, the hybrid scorer + triggers vocabulary) originally lived in dgmo. It improved rapidly and on a different cadence than the rendering library, and is only needed by AI-facing consumers.

## Decision

The selection engine was relocated dgmo → **dgmo-mcp** (`src/suggest/`, exported as `@diagrammo/dgmo-mcp/suggest`). dgmo keeps only the **registry** (chart-type ids + metadata + descriptions) that the scorer reads. Improving suggestion quality is now a dgmo-mcp-only release.

## Consequences

- dgmo's interface shrinks: it renders, it does not guess intent.
- Locality: all selection tuning (triggers.json, synonyms, scorer, harnesses, evals) concentrates in dgmo-mcp.
- Do **not** propose moving selection/scoring logic back into dgmo, or adding NL-intent code to dgmo. dgmo's job ends at "given a chart type, parse + render it."

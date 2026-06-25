# ADR-0003 — Home-grown boxes-and-lines layout, not a general layout library

**Status:** Accepted

## Context

Boxes-and-lines (and graph-based diagrams generally) need automatic node placement. elkjs was trialled as the layout engine. It was measured against a home-grown dagre-placement-search engine across a benchmark corpus.

## Decision

elkjs was **dropped** (shipped 2026-06-10, dgmo 0.28.0). The sole b&l engine is the home-grown dagre placement-search with flat layered + grouped tier-banded candidates (`src/boxes-and-lines/layout.ts`). A group-aware fully-clustered engine was also built, measured, and rejected as NO-GO — dagre's compound layout already enforces contiguity, so clustering added no structural lever; the winning lever was tier *ordering*, captured in `layout-grouped.ts`.

## Consequences

- Benchmark badness X+O+P = 23 (home-grown) vs 53 (ELK); the home-grown engine wins on the corpus.
- Do **not** re-propose adopting a general layout library (elkjs, etc.) for b&l without new benchmark evidence beating the current scores.
- Residual quality issues (e.g. the marketplace graph) need obstacle/port routing, **not** more clustering — that frontier is closed.
- Layout perf is dagre-bound (~96%); scoring micro-opts have been tried and have ~4% headroom — see BL-102. Don't re-attempt scoring micro-optimization.

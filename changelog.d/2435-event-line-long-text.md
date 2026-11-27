### Fixed

- A word longer than its line in a description body now breaks across lines (at `_`, `-` or camelCase first, else between characters) instead of running out of its card. This is the shared wrapper, so it applies to event-line, boxes-and-lines, countdown, pyramid, cycle, ring, sequence and diagram notes (diagrammo/diagrammo#2435).
- **event-line**: a description is capped at `DESC_MAX_LINES` lines per card, the last ending in `…` with the full text kept in `data-full-text`; a chart title wider than the canvas is cut with `…` instead of running off the edge (diagrammo/diagrammo#2435).

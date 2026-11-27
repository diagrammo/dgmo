### Fixed

- **sankey** — a crowded column now fits the canvas. Node gaps shrink until bars average 8px and names shrink to the smallest readable size (11px); only past both does the drawing grow taller, so no node, name or the title is laid out off the canvas (#2462).

### Added

- **sankey** — a column holds at most `MAX_SANKEY_NODES_PER_COLUMN` (50) nodes. Past it the first 50 are drawn and the error `E_SANKEY_TOO_MANY_NODES` on the first link over the limit names the count and suggests grouping small targets (#2462).

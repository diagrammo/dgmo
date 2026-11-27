### Fixed

- Scatter: a long point name no longer runs off the canvas or over the axis. It moves to the side of its point with room, wraps to two lines no wider than 30% of the plot, then ends in `…`; a cut name keeps its full text in `data-full-text` (diagrammo/diagrammo#2464).
- Scatter: a long x-axis title wraps to two lines within the plot's width, then ends in `…`, and the bottom margin grows to hold the second line.

### Fixed

- polar-area: a long wedge label no longer runs off the canvas. The ring shrinks first, down to a minimum radius, until every label fits on one line beside it; then a label wraps at word boundaries onto up to three lines, its value line kept whole; then it ends in `…` and keeps its full text in `data-full-text`. Labels crowded together on one side move apart, away from the ring, and a moved label gets a leader line back to its wedge (diagrammo/diagrammo#2458).

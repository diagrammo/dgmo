### Fixed

- Calendar: a long title, tag value or summary no longer widens the canvas, so the whole chart no longer shrinks. The canvas takes the grid's width; the title wraps to at most three lines and the summary to two, then each ends in `…`; a legend value wider than the grid is cut with `…`. A cut title or summary keeps its full text in `data-full-text` (#2427).

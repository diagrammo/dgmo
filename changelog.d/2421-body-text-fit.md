### Fixed

- Body chart: a long title, part name or note no longer runs off the canvas. The title wraps to two lines, names to two and notes to three, then cut with `…`; a cut piece keeps its full text in `data-full-text`. The label column grows to hold wrapped notes (#2421).
- Legends (every chart): a group name wider than half the legend is cut with `…`, and an export key's entry wider than a whole row is cut to the row instead of running to its natural width. A legend moved onto an inset drawing is held inside the canvas (#2421).

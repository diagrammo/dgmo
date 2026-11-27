### Fixed

- A quadrant chart with very long axis labels, quadrant names or point names
  keeps every label on the canvas and apart. Axis labels shrink, then wrap to
  two lines along their axis; quadrant names wrap to at most three lines and
  point names to two. Past those limits the text ends in `…` and the full
  words stay in the label's `data-full-text`. A point name with no free spot
  for two lines drops to one, and the last resort places a label where it
  overlaps least rather than anywhere.

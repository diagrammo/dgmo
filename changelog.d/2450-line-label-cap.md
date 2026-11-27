### Fixed

- Line charts cap their x-axis names the way bar charts do: long names no
  longer run diagonally across most of the drawing and squeeze the plot into a
  corner (#2450). Names over the cap wrap to two lines, flat or rotated, and
  only what still does not fit ends in `…`.
- The same two-line wrap applies to every chart that caps rotated category
  names: bar charts on a long vertical axis and box plots' group names. Short
  names draw exactly as before.
- A cut category name keeps its whole text in `data-full-text` instead of an
  `<svg><title>` tooltip.

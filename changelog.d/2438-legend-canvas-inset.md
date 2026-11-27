### Fixed

- A legend no longer runs into or off the right edge of the canvas. Rows wrap,
  and a long entry is cut with `…`, to the canvas less the frame's inset on
  both sides, and the frame never moves a legend past that inset edge. Seen on
  function, radar, scatter and treemap charts; the fix is in the shared legend,
  so every chart with a top legend gets it. A legend beside an inline title
  keeps its width.

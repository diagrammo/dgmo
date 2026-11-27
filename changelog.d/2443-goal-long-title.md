### Fixed

- A goal's title and its readout no longer overprint or run off the canvas. The
  readout is measured first and its band name is cut with `…` to half the row;
  the title wraps in the room left (up to three lines, then `…`) and the bar
  moves down. When both are long, the readout takes its own line under the
  title. The same fit applies to the bullet rows, the thermometer and gauge
  faces, and their grids. A cut title or band name keeps its full text in
  `data-full-text`.

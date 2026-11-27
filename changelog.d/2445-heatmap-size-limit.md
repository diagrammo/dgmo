### Fixed

- Heatmap: a heatmap draws at most 50 rows and 50 columns (`HEATMAP_MAX_ROWS`, `HEATMAP_MAX_COLS`); past either, the first ones are drawn and one error names the counts. Row and rotated column names thin to every k-th one instead of overprinting, and hovering a cell bolds its row and column names (showing a thinned or cut name in full), fades the others and draws a faint crosshair along its row and column.

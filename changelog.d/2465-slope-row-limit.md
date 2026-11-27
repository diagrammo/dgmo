### Changed

- slope: a chart draws at most `MAX_SLOPE_ROWS` rows (`src/slope/limits.ts`), the most whose end labels all stack inside the plot at the readable floor. Past it, the first that many are drawn and the error `E_SLOPE_TOO_MANY_ROWS` names the count, on the first row left out, and suggests marking a few rows with `highlight` or using a line chart. The end-label font now steps down no further than the shared readable floor (`MIN_READABLE_TYPE_PX`) instead of 7px. 300 rows no longer tangle into an unreadable mass with labels past the canvas edges (diagrammo/diagrammo#2465).

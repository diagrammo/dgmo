### Changed

- boxplot: a chart draws at most `BOXPLOT_MAX_GROUPS` groups. Past it, the first that many are drawn and the error `E_BOXPLOT_TOO_MANY_GROUPS` names the count, on the first group left out (diagrammo/diagrammo#2424).
- boxplot: crowded group names rotate and thin through the shared category-label planner instead of overprinting; `n` lines move to the hover when they do not fit. Hovering a box, its whiskers or an outlier prints the group's full name on the axis (diagrammo/diagrammo#2424).

### Changed

- dot: a chart draws at most `DOT_MAX_ROWS` rows. Past it, the first that many are drawn and the error `E_DOT_TOO_MANY_ROWS` names the count, on the first row left out (diagrammo/diagrammo#2432).
- dot: crowded row names drop to one line, then thin, instead of overprinting; `gap` values move to the hover when rows are thinner than a line. Hovering a row's dots, connector or name bolds the name, prints its values and fades the other rows (diagrammo/diagrammo#2432).

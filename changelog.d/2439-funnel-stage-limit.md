### Changed

- funnel: a chart draws at most `FUNNEL_MAX_STAGES` stages. Past it, the first that many are drawn and the error `E_FUNNEL_TOO_MANY_STAGES` names the count, on the first stage left out. Side labels never overlap: when bands are thinner than a label line, a column spreads out and joins each label to its band with a leader line. Hovering a stage lights its name, value and percentage, and hovering any of those lights its stage (diagrammo/diagrammo#2439).

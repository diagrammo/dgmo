### Fixed

- funnel: the chart no longer lies about small and zero stages. A stage's width is proportional to its value with no 14% floor; a zero stage has zero width, and a non-zero stage too thin to see is a 1–4px hairline that still keeps its order. A conversion of 0 after 0 shows `—`, never `NaN%`; an exact 0% shows `0%`; `<1%` is only for a share strictly between 0 and 1%. A non-zero value is never printed as `0` (diagrammo/diagrammo#2440).

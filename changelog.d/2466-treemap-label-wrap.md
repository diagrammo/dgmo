### Fixed

- Treemap: a long leaf name wraps to fill its cell at the largest size that fits, from a 10px floor up to 72px, instead of one tiny line cut with `…`. A name turns vertical only when the wrapped horizontal name cannot fit at the floor. Only the last line is cut, and a cut name keeps its full text in `data-full-text` (diagrammo/diagrammo#2466).

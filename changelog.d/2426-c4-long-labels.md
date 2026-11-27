### Fixed

- C4: a long element name wraps inside its card (at most 3 lines, then `…`) and the card grows to hold it; a long relationship label wraps to 200px (at most 3 lines, then `…`) on a knockout that fits it; a long title wraps to 2 lines, then `…`. Cut text keeps its full words in `data-full-text`. Short labels draw as before (diagrammo/diagrammo#2426).

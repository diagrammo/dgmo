### Fixed

- funnel: a long stage name no longer pushes the bands off the canvas. The name column and the value/percent column are each capped at `LABEL_COLUMN_MAX_SHARE` of the width; a label past the cap wraps (three lines for names, two on the right), then ends in `…`, and keeps its full text in `data-full-text`. The plot never gets narrower than a fixed minimum or centred outside the canvas; a canvas too narrow for it shows a short message instead of drawing nothing (diagrammo/diagrammo#2441).

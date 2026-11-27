### Fixed

- Boxes-and-lines: a long group name no longer runs outside its group box and off the canvas. It wraps to the box's width (up to three lines), and only the last line is cut with `…`. The group's contents move down to make room for the extra lines. The full name stays in the group's hover title and `data-full-text`. Short names draw exactly as before (diagrammo/diagrammo#2423).

### Fixed

- Cycle: long text stays inside its shape. A step name too wide for the widest box (or a circle) wraps to at most `STEP_LABEL_MAX_LINES` lines and the header strip grows to hold them; a description stops at `DESC_MAX_LINES` lines; the `center` text wraps inside the ring's clearance at its smallest font. The last line that cannot fit ends in `…`, and a cut step or centre text keeps its full words in `data-full-text` for hover and screen readers. Short names draw exactly as before.

### Changed

- `CycleLayoutNode` gains `labelLines`, the step name as drawn.

### Fixed

- A goal with many measures no longer cuts off the rows past the pane's
  bottom without a word. On screen the drawn goal scales to fit both the width
  and the height of the preview; an export stays fitted to its content.

### Changed

- A goal draws at most 20 bar measures, or 8 thermometer or gauge measures
  (`GOAL_MAX_MEASURES`, `GOAL_MAX_CELLS`). Past the limit, the first that many
  are drawn and an error names the count.

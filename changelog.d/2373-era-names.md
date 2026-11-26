### Added

- `era` ends may name an element instead of a date, and the band follows it. In gantt an end names a task or a `[Group]` (`era Design -> Build Crunch orange`); in timeline it names an event or a `[Lane]`. A named start takes the element's start and a named end its end; ends may mix with dates and `+offsets` (diagrammo/diagrammo#2373, diagrammo/diagrammo#2405).

### Fixed

- gantt: a malformed `era` line says what an era takes, instead of reporting it as a task missing a duration.
- gantt: an impossible date (`2026-02-30`) in an era, marker or holiday is an error instead of rolling into the next month.
- gantt: a lone color word after an era's dates (`era 2026-01-30 -> 2026-02-20 blue`) colors the band instead of becoming its label.
- gantt: a task-named era that ends before it starts warns instead of silently drawing nothing.

### Fixed

- **raci**: a matrix wider or taller than the canvas now scales to fit both ways instead of cutting off the right columns and the bottom rows, and the marker legend moves to its own row when it would not fit beside the title. A matrix draws at most `MAX_RACI_ROLES` (16) roles and `MAX_RACI_TASKS` (40) tasks; past either, the first that many are drawn and an error (`E_RACI_TOO_MANY_ROLES`, `E_RACI_TOO_MANY_TASKS`) on the first role or task left out names the limit and suggests splitting the matrix by phase (diagrammo/diagrammo#2460).

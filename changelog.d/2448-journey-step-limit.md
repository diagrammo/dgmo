### Added

- Journey map: a step limit (`JOURNEY_MAX_STEPS`, counted across all phases). Past it the map draws the first steps in source order, a phase cut mid-way keeps its header, and an error (`E_JOURNEY_TOO_MANY_STEPS`) names the count on the first step not drawn.

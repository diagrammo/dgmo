### Changed

- Cycle: a cycle draws at most `CYCLE_MAX_STEPS` steps (the ring filled at the 15° least arc a step keeps). Past it nothing is drawn, and the error `E_CYCLE_TOO_MANY_STEPS` on the first step past the limit names the count. A cycle cut short would not close, so no partial ring is drawn.

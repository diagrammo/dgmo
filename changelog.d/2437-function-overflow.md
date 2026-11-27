### Fixed

- **function**: a function whose values grow past `FUNCTION_MAX_ABS_Y` (1e15) on the x range, such as `exp(1000*x)` on `0..10`, now raises an error (`E_FUNCTION_OVERFLOW`) on its line and is not drawn; the other functions still plot. With none left, the chart shows the error. A large but legal range prints compact tick labels (`10T`) instead of digits wider than the canvas (diagrammo/diagrammo#2437).

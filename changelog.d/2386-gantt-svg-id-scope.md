### Fixed

- Gantt: two copies of the same chart on one page (a light and a dark render, two embeds) no longer paint with each other's gradients and clip paths. Every `id` a gantt defines now carries a per-render scope, so an uncertain task's fade always uses its own theme's colours.

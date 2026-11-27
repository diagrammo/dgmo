### Fixed

- **sankey** — hovering or selecting a node now lights its flow closure (every flow into and out of it, and the path upstream and downstream, the same set `highlight <node>` lights) and dims every other node and flow. Exported SVGs bake the same hover as CSS, with no script (#2463).

### Fixed

- **infra**: an infra diagram draws at most `INFRA_MAX_NODES` (100) nodes, counting entry points and forward-referenced stubs. Past it nothing is drawn and one error (`E_INFRA_TOO_MANY_NODES`) on the first node past the limit names the count; a diagram with nodes dropped would misstate the system and its computed load. Before, a 200-node chain drew as one invisible hairline (diagrammo/diagrammo#2446).
- **infra**: a long thin layout (a chain longer than 4,000 px and at least 4× longer than it is deep) now wraps into bands like lines of text, so a 100-node chain draws about 3,300 × 2,000 px instead of 29,000 × 200. A wrap never splits a group; edges between bands route through the gap. Shorter layouts are unchanged (diagrammo/diagrammo#2446).

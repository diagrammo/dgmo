### Fixed

- **mindmap**: a mindmap draws at most `MAX_MINDMAP_NODES` (100) nodes, the title root included. Past it the first 100 nodes in source order are drawn, and one error (`E_MINDMAP_TOO_MANY_NODES`) on the first node not drawn names the count and suggests collapsing branches or splitting the map. Before, 3,900 nodes scaled the map down to one hairline (diagrammo/diagrammo#2454).

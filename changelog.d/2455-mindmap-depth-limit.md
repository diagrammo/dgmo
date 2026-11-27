### Fixed

- **mindmap**: a mindmap nests at most `MAX_MINDMAP_DEPTH` (12) levels, the root as level 1. Deeper lines and their descriptions are left out, so the map draws down to the limit, and one error (`E_MINDMAP_TOO_DEEP`) on the first line too deep names the limit and suggests flattening the branch or splitting the map. Before, a 60-level chain drew as one unreadable strip (diagrammo/diagrammo#2455).

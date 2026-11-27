### Fixed

- Cycle: the whole drawing stays on the canvas. The renderer measures what it drew (ring, arrowheads, nodes, step numbers, edge labels) and lays the ring out again in a smaller box while any of it leaves the canvas, so uneven span weights with a tag legend and `autonumber` no longer run the ring off the bottom. The edge-label fit no longer grows the ring.

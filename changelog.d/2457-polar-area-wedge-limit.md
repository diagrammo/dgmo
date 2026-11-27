### Changed

- polar-area: a chart draws at most `MAX_POLAR_AREA_WEDGES` wedges. Past it, the first that many are drawn and the error `E_POLAR_AREA_TOO_MANY_WEDGES` names the count, on the first wedge left out, and suggests a bar chart for a long category list. 200 wedges no longer overprint every label in one unreadable ring (diagrammo/diagrammo#2457).

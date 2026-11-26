### Security

- `encodeDiagramUrl` (and so `dgmo share`, the MCP `share_diagram` tool, embed toolbar links and error-card links) now carries the diagram in the URL fragment only. Links used to repeat it in the query string, which the browser sends to `online.diagrammo.app` on every open — against the promise that nothing is uploaded (diagrammo/diagrammo#2363). `decodeDiagramUrl` still reads `?dgmo=` links made before this.

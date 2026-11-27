### Changed

- `dgmo put`, the MCP `put_space_diagram` tool and `scripts/space-put.sh` no longer list the whole space before each write: the folder path goes to the Cloud, which resolves it. A write in a large space read ~1,190 database rows first; a 975-file agent batch spent the Cloud's whole daily read budget (diagrammo/diagrammo#2414). `dgmo get --id` reads the folder list only. Every space call now names itself as `x-diagrammo-client: dgmo/<version>`.

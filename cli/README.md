# @diagrammo/dgmo-cli

The `dgmo` command — render [DGMO](https://diagrammo.app) diagrams to PNG or SVG from your terminal, and wire the DGMO MCP server into AI editors.

```bash
brew install diagrammo/dgmo/dgmo     # macOS
npm install -g @diagrammo/dgmo-cli   # anywhere
npx @diagrammo/dgmo-cli diagram.dgmo # no install
```

## Rendering

```bash
dgmo diagram.dgmo                          # PNG (the default)
dgmo diagram.dgmo -o output.svg            # format follows the extension
cat diagram.dgmo | dgmo > out.png          # stdin
dgmo diagram.dgmo --theme dark --palette catppuccin
dgmo share diagram.dgmo                    # shareable link, copied to the clipboard
```

## AI editors

```bash
dgmo install                # auto-detects what you have, no prompts
dgmo install claude-code    # or name one
```

Detects Claude Code, Codex, Claude Desktop, Cursor, Windsurf and Copilot, and points each at the DGMO MCP server. `dgmo mcp` runs that server directly.

## Also

```bash
dgmo types          # the chart types, and what each is for
dgmo diagnostics    # every diagnostic code the parser can emit
```

## Which package is which

| Package | What it is |
|---|---|
| **`@diagrammo/dgmo-cli`** | this — the `dgmo` command |
| [`@diagrammo/dgmo`](https://www.npmjs.com/package/@diagrammo/dgmo) | the library: `render()`, the parsers, the palettes |
| [`@diagrammo/dgmo-mcp`](https://www.npmjs.com/package/@diagrammo/dgmo-mcp) | the MCP server, installed with this package |

The command lived inside `@diagrammo/dgmo` until 0.61.0. It moved out so that a documentation build calling `render()` stops installing a command-line program and a native rasterizer it never reaches.

Full language reference and docs: **[diagrammo.app](https://diagrammo.app)**.

## License

MIT

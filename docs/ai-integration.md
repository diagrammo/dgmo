# DGMO AI Integration Guide

Use AI coding tools to generate `.dgmo` diagrams. This guide covers Claude Code, Copilot, Cursor, Windsurf, and any tool with an MCP client.

---

## MCP Server (recommended for Claude)

`@diagrammo/dgmo-mcp` provides an MCP server that gives Claude the ability to render, share, and look up DGMO diagrams directly — no file management needed.

**5 tools:** `render_diagram`, `share_diagram`, `open_in_app`, `list_chart_types`, `get_language_reference`

Add to `~/.claude/settings.json` (global) or `.claude/settings.local.json` (project):

```json
{
  "mcpServers": {
    "dgmo": {
      "command": "npx",
      "args": ["-y", "@diagrammo/dgmo-mcp"]
    }
  }
}
```

See `dgmo-mcp/README.md` for full configuration options.

---

## Claude Code — Skill (slash command)

Installs a `/dgmo` slash command that gives Claude full dgmo context — all chart types, CLI flags, workflow, and tips.

```bash
dgmo --install-claude-skill
```

This copies a skill file into `~/.claude/commands/`, making `/dgmo` available in every Claude Code session.

---

## Claude Code — CLAUDE.md snippet

To teach Claude about DGMO in a specific project without the global skill, add this to your `CLAUDE.md`:

```markdown
## DGMO Diagrams

When the user asks for a diagram, generate a `.dgmo` file.

Quick reference:
- Sequence: `A -message-> B` or `A <-response- B`
- Flowchart: `(Start) -> [Process] -> <Decision?> -yes-> (End)`
- Bar chart: `chart: bar` then `Label: value` lines
- ER diagram: `chart: er` then table definitions and `table1 1--* table2` relationships
- Org chart: `chart: org` then indented hierarchy

Full reference: `node_modules/@diagrammo/dgmo/docs/language-reference.md`

Render with: `dgmo file.dgmo` (PNG) or `dgmo file.dgmo -o url` (shareable link).
```

---

## Other AI Tools — Prompt Files

DGMO ships context files for popular AI coding tools, included in the npm package and auto-loaded when present in a project root.

| File | Tool | How it works |
|------|------|-------------|
| `.github/copilot-instructions.md` | GitHub Copilot | Auto-loaded in repos with this file |
| `.cursorrules` | Cursor | Auto-loaded when present in project root |
| `.windsurfrules` | Windsurf | Auto-loaded when present in project root |

Copy the relevant file into your project root:

```bash
# From node_modules (if installed as a dependency)
cp node_modules/@diagrammo/dgmo/.cursorrules .
cp node_modules/@diagrammo/dgmo/.windsurfrules .
mkdir -p .github && cp node_modules/@diagrammo/dgmo/.github/copilot-instructions.md .github/

# From global npm install
cp $(npm root -g)/@diagrammo/dgmo/.cursorrules .
```

Each file contains a condensed DGMO syntax reference with examples, all chart types listed, rendering commands, and common mistakes to avoid.

---

## Rendering commands

```bash
dgmo diagram.dgmo                # PNG output
dgmo diagram.dgmo -o output.svg  # SVG output
dgmo diagram.dgmo -o url         # Shareable diagrammo.app URL
dgmo diagram.dgmo -o url --copy  # URL copied to clipboard
dgmo --chart-types               # List all supported chart types
dgmo --chart-types --json        # Machine-readable chart type list
```

---

## Supported chart types

Run `dgmo --chart-types` for the full list, or see `docs/language-reference.md`.

33 types: bar, line, area, multi-line, pie, doughnut, radar, polar-area, bar-stacked, scatter, sankey, chord, function, heatmap, funnel, slope, wordcloud, arc, timeline, venn, quadrant, sequence, flowchart, state, class, er, org, kanban, c4, sitemap, infra, gantt, boxes-and-lines.

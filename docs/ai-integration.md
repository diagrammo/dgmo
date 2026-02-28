# DGMO AI Integration Guide

Use AI coding tools to generate `.dgmo` diagrams. This guide covers Claude Code, Copilot, Cursor, and other AI tools.

## MCP Server

`@diagrammo/dgmo-mcp` provides an MCP server that exposes DGMO rendering, sharing, and documentation tools. Works with Claude Desktop, Claude Code, and any MCP-compatible client.

5 tools: `render_diagram`, `share_diagram`, `open_in_app`, `list_chart_types`, `get_language_reference`.

Setup (Claude Code — add to `.claude/settings.local.json`):

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

## Claude Code — Skills

Copy the `.claude/skills/dgmo-*` directories from this repo into your project's `.claude/skills/` directory. This gives you four slash commands:

| Command | What it does |
|---------|-------------|
| `/dgmo-generate <description>` | Picks the best diagram type automatically |
| `/dgmo-sequence <flow>` | Generates a sequence diagram |
| `/dgmo-flowchart <process>` | Generates a flowchart |
| `/dgmo-chart <data description>` | Generates a data chart |

### Setup

```bash
# Copy skills into your project
cp -r node_modules/@diagrammo/dgmo/.claude/skills/dgmo-* .claude/skills/

# Or if dgmo is installed globally
cp -r $(npm root -g)/@diagrammo/dgmo/.claude/skills/dgmo-* .claude/skills/
```

### Usage examples

```
/dgmo-generate an ER diagram for a blog with users, posts, and comments
/dgmo-sequence the OAuth2 authorization code flow
/dgmo-flowchart CI/CD pipeline with build, test, and deploy stages
/dgmo-chart quarterly revenue: Q1 100, Q2 120, Q3 110, Q4 130
```

## Claude Code — CLAUDE.md snippet

Add this to your project's `CLAUDE.md` to teach Claude about DGMO without installing skills:

```markdown
## DGMO Diagrams

When the user asks for a diagram, generate a `.dgmo` file. DGMO is a text-based diagram language.

Quick reference:
- Sequence: `A -> B: message` or `A -message-> B`
- Flowchart: `(Start) -> [Process] -> <Decision?> -yes-> (End)`
- Bar chart: `chart: bar` then `Label: value` lines
- ER diagram: `chart: er` then table definitions and `table1 1--* table2` relationships
- Org chart: `chart: org` then indented hierarchy

Full reference: see `node_modules/@diagrammo/dgmo/docs/language-reference.md`

Render with: `dgmo file.dgmo -o output.svg` or `dgmo file.dgmo -o url` for shareable link.
```

## Other AI Tools — Prompt Files

DGMO ships prompt files for popular AI coding tools. These are included in the npm package:

| File | Tool | How it works |
|------|------|-------------|
| `.github/copilot-instructions.md` | GitHub Copilot | Auto-loaded in repos with this file |
| `.cursorrules` | Cursor | Auto-loaded when present in project root |
| `.windsurfrules` | Windsurf | Auto-loaded when present in project root |

### Setup

Copy the relevant file into your project root:

```bash
# From node_modules
cp node_modules/@diagrammo/dgmo/.cursorrules .
cp node_modules/@diagrammo/dgmo/.windsurfrules .
mkdir -p .github && cp node_modules/@diagrammo/dgmo/.github/copilot-instructions.md .github/

# Or from global install
cp $(npm root -g)/@diagrammo/dgmo/.cursorrules .
```

Each file contains a condensed DGMO syntax reference with examples for the most common diagram types, all 29 chart types listed, rendering commands, and common mistakes to avoid.

## Rendering

If the `dgmo` CLI is installed, diagrams can be rendered:

```bash
# Install
npm install -g @diagrammo/dgmo   # or: brew install diagrammo/dgmo/dgmo

# Render
dgmo diagram.dgmo                # PNG output
dgmo diagram.dgmo -o output.svg  # SVG output
dgmo diagram.dgmo -o url         # Shareable URL

# AI-friendly JSON output
dgmo diagram.dgmo -o output.svg --json
dgmo --chart-types --json         # List all chart types
```

## Supported chart types

Run `dgmo --chart-types` for the full list, or see `docs/language-reference.md`.

29 types: bar, line, area, pie, doughnut, radar, polar-area, bar-stacked, scatter, sankey, chord, function, heatmap, funnel, slope, wordcloud, arc, timeline, venn, quadrant, sequence, flowchart, class, er, org, kanban, c4, initiative-status.

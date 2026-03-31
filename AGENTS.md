# DGMO Diagram Language — Codex Integration

Use dgmo tools to create, render, and share diagrams. dgmo is a text-based diagram markup language that renders to SVG/PNG.

## Quick setup

If the MCP server is not yet configured:

```bash
dgmo --install-codex-integration
```

This installs the MCP server and writes the dgmo config to `.codex/config.toml`. Restart Codex to activate.

## MCP Tools

When the `dgmo` MCP server is configured, use these tools directly:
- `preview_diagram` — renders diagram(s) and opens a live HTML preview in the browser (default for showing diagrams)
- `render_diagram` — renders to PNG or SVG, returns file path
- `share_diagram` — creates a shareable diagrammo.app URL
- `open_in_app` — opens diagram in Diagrammo desktop app (macOS)
- `list_chart_types` — lists all 34 supported chart types with descriptions
- `get_language_reference` — fetches full syntax for any chart type (call this before generating an unfamiliar chart type)
- `generate_report` — renders multiple diagrams into an HTML report with table of contents

## When to use dgmo

- Architecture diagrams, sequence diagrams, flowcharts
- Data charts (bar, line, pie, scatter, heatmap, etc.)
- ER diagrams, class diagrams, org charts
- Project roadmaps, kanban boards, timelines

## Quick syntax reference

### Sequence diagram
```
sequence Auth Flow

User -Login-> API
API -Find user-> DB
DB -user-> API
  if valid
    API -200 OK-> User
  else
    API -401-> User
```

### Flowchart
```
flowchart Process

(Start) -> <Valid?>
  -yes-> [Process] -> (Done)
  -no-> /Get Input/ -> <Valid?>
```

### Bar chart
```
bar Revenue
series USD

North 850
South 620
East 1100
```

### ER diagram
```
er Schema

users
  id: int [pk]
  email: varchar [unique]

posts
  id: int [pk]
  user_id: int [fk]

users 1--* posts : writes
```

### Org chart
```
org

CEO
  VP Engineering
    Team Lead A
    Team Lead B
  VP Marketing
```

### Infra chart
```
infra
direction LR

edge
  rps: 10000
  -> CDN

CDN
  cache-hit: 80%
  -> LB

LB
  -> API | split: 70%
  -> Web | split: 30%

API
  instances: 3
  max-rps: 500
  latency-ms: 45
```

## All 34 chart types

bar, line, multi-line, area, pie, doughnut, radar, polar-area, bar-stacked, scatter, sankey, chord, function, heatmap, funnel, slope, wordcloud, arc, timeline, venn, quadrant, sequence, flowchart, state, class, er, org, kanban, c4, initiative-status, sitemap, infra, gantt, boxes-and-lines

### Boxes and lines
```
boxes-and-lines Architecture

tag Team t Backend(blue), Frontend(green)
active-tag Team
direction LR

API Gateway | t: Backend
  -routes-> AuthService
  -queries-> DB

AuthService | t: Backend
DB | t: Backend

[Cloud]
  API Gateway
  AuthService
```

## Common patterns

- `type` — chart type as first line, optionally followed by title: `bar Revenue`
- `// comment` — only `//` comments (not `#`)
- `(colorname)` — inline colors: `Label(red) 100`
- `series A(red), B(blue)` — multi-series with colors

## Rendering via CLI

```bash
dgmo file.dgmo -o output.svg       # SVG
dgmo file.dgmo -o url              # shareable link
dgmo file.dgmo --json              # structured JSON output
```

## Mistakes to avoid

- Don't use `#` for comments — use `//`
- Don't use `end` to close sequence blocks — indentation closes them
- Don't use hex colors in section headers — use named colors
- Don't forget chart type on the first line when content is ambiguous
- Sequence arrows: `->` (sync), `~>` (async) — always left-to-right

Full reference: call `get_language_reference` MCP tool or visit diagrammo.app/docs

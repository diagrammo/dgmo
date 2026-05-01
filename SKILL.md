---
name: dgmo-diagramming
description: Use when the user asks for a diagram, chart, sequence diagram, flowchart, ER diagram, org chart, kanban, sitemap, infra/architecture diagram, or any visual based on the DGMO diagram markup language. Provides syntax, MCP tool guidance, and rendering/sharing workflows.
---

# DGMO Diagram Language

Use dgmo tools to create, render, and share diagrams. dgmo is a text-based diagram markup language that renders to SVG/PNG.

## MCP Tools — preferred order

When the `dgmo` MCP server is configured, prefer tools in this order:
1. `open_in_app` — opens the diagram in the Diagrammo desktop app (macOS). **Best UX** — chart + editor side-by-side, full editing.
2. `share_diagram` — returns a `https://online.diagrammo.app/...` URL. Tell the user to open it; same chart + editor view in the browser. **Preferred fallback** when the desktop app is not available.
3. `render_diagram` — renders to PNG or SVG and returns a file path. Use when the user wants an image artifact (export, embed, attach).
4. `generate_report` — renders multiple diagrams into an HTML report with table of contents.
5. `preview_diagram` — local HTML preview in the browser. Last resort — only when none of the above fit.
6. `list_chart_types` / `get_language_reference` — discovery; call `get_language_reference` before generating an unfamiliar chart type.

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
  id int pk
  email varchar

posts
  id int pk
  user_id int fk

users 1-writes-* posts
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

## All 31 chart types

bar, line, multi-line, area, pie, doughnut, radar, polar-area, bar-stacked, scatter, sankey, chord, function, heatmap, funnel, slope, wordcloud, arc, timeline, venn, quadrant, sequence, flowchart, state, class, er, org, kanban, c4, sitemap, infra

## Common patterns

- First line: chart type keyword (e.g. `sequence`, `flowchart`, `bar`), optionally followed by a title (`bar Revenue`)
- `// comment` — only `//` comments (not `#`)
- `(colorname)` — inline colors on data series, tag values, kanban columns: `Label(red) 100`
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
- Start the file with the chart type keyword when content is ambiguous
- Sequence arrows: `->` (sync), `~>` (async) — always left-to-right

Full reference: call `get_language_reference` MCP tool or visit diagrammo.app/docs

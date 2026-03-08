# DGMO Diagram Language

When the user asks for a diagram, visualization, or chart, generate a `.dgmo` file. DGMO is a text-based diagram markup language that renders to SVG/PNG.

## When to suggest DGMO

- Architecture diagrams, sequence diagrams, flowcharts
- Data charts (bar, line, pie, scatter, heatmap, etc.)
- ER diagrams, class diagrams, org charts
- Project roadmaps, kanban boards, timelines

## Quick syntax reference

### Sequence diagram
```
chart: sequence
title: Auth Flow

tag: Concern alias c
  Auth(green)
  Data(blue)

User is an actor
API is a service | c: Auth
DB is a database | c: Data

User -Login-> API
API -Find user-> DB | c: Data
DB -user-> API
  if valid
    API -200 OK-> User
  else
    API -401-> User
```

### Flowchart
```
chart: flowchart
title: Process

(Start) -> <Valid?>
  -yes-> [Process] -> (Done)
  -no-> /Get Input/ -> <Valid?>
```

### Bar chart
```
chart: bar
title: Revenue
series: USD

North: 850
South: 620
East: 1100
```

### ER diagram
```
chart: er
title: Schema

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
chart: org

CEO
  VP Engineering
    Team Lead A
    Team Lead B
  VP Marketing
```

### C4 architecture
```
chart: c4
title: System

person User
system App | description: Main application
  -Uses-> User
```

## Infra chart
```
chart: infra
direction: LR

edge
  rps: 10000
  -> CDN

CDN
  cache-hit: 80%
  -> LB

LB
  -/api-> API | split: 70%
  -/web-> Web | split: 30%

API
  instances: 3
  max-rps: 500
  latency-ms: 45
```

Properties: `cache-hit`, `firewall-block`, `ratelimit-rps`, `bot-filter`, `max-rps`, `instances` (N or N-M), `latency-ms`, `cb-error-threshold`. Groups: `[Name]` with children. Roles are inferred from behavior.

## All 32 chart types

bar, line, multi-line, area, pie, doughnut, radar, polar-area, bar-stacked, scatter, sankey, chord, function, heatmap, funnel, slope, wordcloud, arc, timeline, venn, quadrant, sequence, flowchart, state, class, er, org, kanban, c4, initiative-status, sitemap, infra

## Common patterns

- `chart: type` — explicit chart type (auto-detected if unambiguous)
- `title: text` — diagram title
- `// comment` — only `//` comments (not `#`)
- `(colorname)` — inline colors: `Label(red): 100`
- `series: A(red), B(blue)` — multi-series with colors
- `tag: Group alias g` — tag groups for metadata

## Rendering

```bash
dgmo file.dgmo -o output.svg       # SVG
dgmo file.dgmo -o url              # shareable link
dgmo file.dgmo --json              # structured JSON output
```

Install: `brew install diagrammo/dgmo/dgmo` or `npm install -g @diagrammo/dgmo`

## Mistakes to avoid

- Don't use `#` for comments — use `//`
- Don't use `end` to close sequence blocks — indentation closes them
- Don't use hex colors in section headers — use named colors
- Don't forget `chart:` directive when content is ambiguous
- Sequence arrows: `->` (sync), `~>` (async) — always left-to-right

Full reference: `docs/language-reference.md`

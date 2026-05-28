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
sequence Auth Flow

tag Concern as c
  Auth green
  Data blue

User -Login-> API c: Auth
API -Find user-> DB c: Data
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
  id int [pk]
  email varchar [unique]

posts
  id int [pk]
  user_id int [fk]

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

### C4 architecture
```
c4 System

Web App is a container description: SPA, tech: React
  -Uses-> API
User is a person
  -Browses-> Web App
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
  -/api-> API split: 70%
  -/web-> Web split: 30%

API
  instances: 3
  max-rps: 500
  latency-ms: 45
```

Properties (colon required): `cache-hit`, `firewall-block`, `ratelimit-rps`, `max-rps`, `instances` (N or N-M), `latency-ms`, `cb-error-threshold`. Groups: `[Name]` with children. Roles are inferred from behavior.

### Boxes and lines
```
boxes-and-lines Architecture
tag Team as t
  Backend blue
  Frontend green
active-tag Team
direction LR

API Gateway t: Backend
  -routes-> AuthService
  -queries-> DB

[Cloud]
  API Gateway
  AuthService
```

Nodes: implicit from edges or explicit with same-line metadata (`Name key: value`). Edges: `A -label-> B`. Groups: `[Name]` with indented children (max 2 levels). Tags: `tag Name as alias` with indented values, `active-tag`, `hide`. Options: `direction LR|TB`.

## All chart types

Diagrams: sequence, flowchart, state, class, er, org, kanban, c4, sitemap, infra, gantt, boxes-and-lines, mindmap, wireframe, journey-map, raci, rasci, daci, pert

Visualizations: pyramid, ring, cycle, quadrant, venn, slope, wordcloud, arc, timeline, tech-radar

Data charts: bar, line, multi-line, area, pie, doughnut, radar, polar-area, bar-stacked, scatter, sankey, chord, function, heatmap

The canonical, ordered list lives in `src/chart-types.ts`.

## Common patterns

- `TYPE Title` — first line declares chart type and optional title (no colon)
- `directive value` — directives are space-separated (no colon)
- `// comment` — only `//` comments (not `#`)
- Colors trail the label: `Label red`, `Done green` (no parens, lowercase only)
- `series Cloud blue, Legacy red` — multi-series with space-separated trailing color
- `tag Group as g` with indented values — universal tag declaration

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
- Don't use hex colors — use named colors from the palette (red, orange, yellow, green, blue, purple, teal, cyan, gray, black, white)
- Don't use colons in chart type, title, directives, or data rows — use spaces
- Don't use `|` to delimit metadata — it was removed in 0.18.0; use same-line `key: value` per the universal metadata grammar
- Don't use `tag Name alias` or bare `tag Name x` — use `tag Name as alias`
- Sequence arrows: `->` (sync), `~>` (async) — always left-to-right; no leftward `<-` or `<~`

Full reference: `docs/language-reference.md`

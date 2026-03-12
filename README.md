# @diagrammo/dgmo

A diagram markup language — parser, config builder, renderer, and color system.

Write plain-text `.dgmo` files and render them as charts, diagrams, and visualizations. Supports 26 chart types — data charts, structural diagrams, and sequence diagrams. Ships as both a library and a standalone CLI.

## Install

### As a library

```bash
npm install @diagrammo/dgmo
# or
pnpm add @diagrammo/dgmo
```

### As a CLI

```bash
# via Homebrew (macOS)
brew tap diagrammo/dgmo
brew install dgmo

# or run directly via npx
npx @diagrammo/dgmo diagram.dgmo
```

## CLI usage

```bash
# First time with no args? Creates a sample.dgmo to get you started
dgmo

# Render to PNG (default)
dgmo diagram.dgmo              # → diagram.png

# Render to SVG
dgmo diagram.dgmo -o output.svg

# Explicit PNG
dgmo diagram.dgmo -o output.png

# Pipe from stdin
cat diagram.dgmo | dgmo -o out.png
cat diagram.dgmo | dgmo > out.png    # PNG to stdout

# With theme and palette options
dgmo diagram.dgmo --theme dark --palette catppuccin
```

**Options:**

| Flag | Values | Default |
|------|--------|---------|
| `--theme` | `light`, `dark`, `transparent` | `light` |
| `--palette` | `nord`, `solarized`, `catppuccin`, `rose-pine`, `gruvbox`, `tokyo-night`, `one-dark`, `bold` | `nord` |
| `-o` | Output file path (`.svg` extension → SVG, otherwise PNG) | `<input>.png` |

## Supported chart types

| Type | Description |
|------|-------------|
| `arc` | Arc/network diagrams |
| `area` | Filled area charts |
| `bar` | Vertical/horizontal bar charts |
| `bar-stacked` | Stacked bar charts |
| `chord` | Circular relationship diagrams |
| `class` | UML class diagrams with inheritance, composition, and visibility |
| `doughnut` | Doughnut charts |
| `er` | Entity-relationship diagrams with crow's foot notation |
| `flowchart` | Directed graph flowcharts with branching and 6 node shapes |
| `function` | Mathematical function plots |
| `funnel` | Conversion funnels |
| `heatmap` | Matrix heatmaps |
| `line` | Line charts with crosshair |
| `multi-line` | Multi-series line charts |
| `org` | Org charts with hierarchy, team containers, and tag group color-coding |
| `pie` | Pie charts with connector labels |
| `polar-area` | Polar area charts |
| `quadrant` | 2D quadrant scatter |
| `radar` | Radar/spider charts |
| `sankey` | Flow diagrams |
| `scatter` | XY scatter with categories and sizing |
| `sequence` | Sequence diagrams with type inference |
| `slope` | Before/after comparison |
| `timeline` | Timelines with eras and markers |
| `venn` | Set intersection diagrams |
| `wordcloud` | Weighted text clouds |

## How it works

Every `.dgmo` file is plain text with a `chart: <type>` header followed by metadata and data. The library parses each chart type and gives you either:

- A **config object** you render yourself
- A **rendered SVG** directly

```
parse → build config → render
```

All parsers are pure functions with no DOM dependency. The CLI sets up jsdom internally for headless rendering.

## Usage

### Standard charts (bar, line, pie, radar, etc.)

```typescript
import { parseChart, buildEChartsOptionFromChart, getPalette } from '@diagrammo/dgmo';
import * as echarts from 'echarts';

const colors = getPalette('nord').light;

const content = `
chart: bar
title: Revenue by Quarter
xlabel: Quarter
ylabel: Revenue ($M)

Q1: 12
Q2: 19
Q3: 15
Q4: 22
`;

const parsed = parseChart(content, colors);
const option = buildEChartsOptionFromChart(parsed, colors, false);
echarts.init(container).setOption(option);
```

### ECharts (scatter, sankey, heatmap, etc.)

```typescript
import { parseEChart, buildEChartsOption, getPalette } from '@diagrammo/dgmo';
import * as echarts from 'echarts';

const colors = getPalette('nord').light;

const content = `
chart: sankey
title: Energy Flow

Coal (orange)
  Electricity: 50
Gas (blue)
  Electricity: 30
Electricity -> Industry: 45
Electricity -> Homes: 35
`;

const parsed = parseEChart(content);
const option = buildEChartsOption(parsed, colors, false);
echarts.init(container).setOption(option);
```

### D3 (slope, timeline, wordcloud, etc.)

```typescript
import { parseD3, renderTimeline, getPalette } from '@diagrammo/dgmo';

const colors = getPalette('nord').light;

const content = `
chart: timeline
title: Project Milestones

2024-01: Kickoff
2024-03 -> 2024-06: Development
2024-07: Launch
`;

const parsed = parseD3(content, colors);
renderTimeline(container, parsed, colors, false);
```

### Sequence diagrams

Sequence diagrams use a minimal DSL. Participants are inferred from messages — no declaration blocks needed. Types (service, database, actor, queue, etc.) are inferred from naming conventions.

```typescript
import { parseSequenceDgmo, renderSequenceDiagram, getPalette } from '@diagrammo/dgmo';

const colors = getPalette('nord').light;

const content = `
title: Login Flow

User -login(email, pass)-> AuthService
  AuthService -findByEmail(email)-> UserDB
  AuthService <-user- UserDB
User <-token- AuthService
`;

const parsed = parseSequenceDgmo(content);
renderSequenceDiagram(container, parsed, colors, false, (lineNum) => {
  // clicked a message — jump to that line in the editor
});
```

**Sequence syntax:**

- `A -message-> B` — synchronous call
- `A -> B` — unlabeled synchronous call
- `A ~message~> B` — async/fire-and-forget call
- `A ~> B` — unlabeled async call
- `A <-message- B` — synchronous return (dashed arrow, from B to A)
- `A <- B` — unlabeled return
- `A <~message~ B` — async return
- `if condition` / `else` / `end` — conditional blocks
- `loop condition` / `end` — loop blocks
- `parallel` / `else` / `end` — concurrent branches
- `== Section ==` — horizontal dividers (collapsible in the desktop app)
- `[GroupName]` — participant grouping
- `Name is a database` — explicit type declaration
- `Name position 0` — explicit ordering
- `activations: off` — disable activation bars
- `tag: Name` + `Value(color)` entries — color-coded metadata dimensions with interactive legend
- `| key: value` — attach tag metadata to participants, messages, or groups

**Participant type inference** — 104 rules map names to shapes automatically:

| Pattern | Inferred type | Shape |
|---------|--------------|-------|
| User, Admin, Alice, Bob | actor | stick figure |
| DB, Postgres, Mongo, Redis (store) | database | cylinder |
| Redis, Memcache (cache) | cache | dashed cylinder |
| Queue, Kafka, SQS, EventBus | queue | horizontal cylinder |
| Gateway, Proxy, LB, CDN | networking | shield |
| App, Browser, Dashboard, CLI | frontend | rounded rect |
| Service, API, Lambda, Fn | service | pill shape |
| External, ThirdParty, Vendor | external | dashed square |

### Flowcharts

Flowcharts use a concise syntax with 6 node shapes: `(terminal)`, `[process]`, `<decision>`, `/io/`, `{preparation}`, and `[[subroutine]]`. Edges support labels and branching.

```typescript
import { parseFlowchart, layoutGraph, renderFlowchart, getPalette } from '@diagrammo/dgmo';

const colors = getPalette('nord').dark;

const content = `
chart: flowchart
title: Decision Flow

(Start) -> /Get Input/ -> <Valid?>
  -yes-> [Process Data] -> (Done)
  -no-> [Show Error] -> /Get Input/
`;

const parsed = parseFlowchart(content, colors);
const layout = layoutGraph(parsed);
renderFlowchart(container, parsed, layout, colors, true);
```

### ER diagrams

ER diagrams use a table-and-column syntax with constraint annotations and cardinality relationships. Crow's foot notation is the default, with an optional `notation: labels` mode.

```typescript
import { parseERDiagram, layoutERDiagram, renderERDiagram, getPalette } from '@diagrammo/dgmo';

const colors = getPalette('nord').light;

const content = `
chart: er
title: Blog Platform

users
  id: int [pk]
  name: varchar
  email: varchar [unique]

posts
  id: int [pk]
  author_id: int [fk]
  title: varchar

users 1--* posts: writes
`;

const parsed = parseERDiagram(content, colors);
const layout = layoutERDiagram(parsed);
renderERDiagram(container, parsed, layout, colors, false);
```

**ER diagram syntax:**

- `chart: er` — chart type header
- `title: Text` — optional title
- `notation: labels` — use text labels instead of crow's foot markers
- Table declaration: unindented name (e.g. `users`, `order_items`)
- Column: indented `name: type [constraints]`
- Constraints: `[pk]`, `[fk]`, `[unique]`, `[nullable]`, or combined `[pk, unique]`
- Relationships with cardinality: `table1 1--* table2: label`
  - Symbolic: `1--*`, `1-*`, `?--1`, `*--*`
  - Keyword: `one-to-many`, `many-to-one`, `one-to-one`
  - Natural: `one to many`, `1 to many`
- Colors: `table_name (color)` for explicit color

### Org charts

Org charts use indentation to define hierarchy, with metadata on nodes, team containers, and tag groups for color-coding.

```typescript
import { parseOrg, renderOrg, getPalette } from '@diagrammo/dgmo';

const colors = getPalette('nord').light;

const content = `
chart: org
title: Engineering

tag: Location
  NY(blue)
  SF(green)

Alex Chen
  role: CTO
  location: NY

  [Platform Team]
    goal: Core infrastructure

    Alice Park | role: Senior Engineer, location: NY
    Bob Torres | role: Junior Engineer, location: SF
`;

const parsed = parseOrg(content, colors);
renderOrg(container, parsed, colors, false);
```

**Org chart syntax:**

- `chart: org` — chart type header (required)
- `title: Text` — optional title
- Indentation defines parent-child hierarchy (2 or 4 spaces, consistent within file)
- Multiple root nodes supported (e.g., co-CEOs at top level)

**Node metadata:**

```
Jane Smith
  role: CEO
  location: NY
```

Or single-line with pipe delimiter:

```
Jane Smith | role: CEO, location: NY
```

**Team containers** — grouping constructs rendered as labeled boxes:

```
[Platform Team]
  goal: Core infrastructure
  charter: Developer experience

  Alice Park
    role: Senior Engineer
```

Containers can nest and carry their own metadata (key: value pairs). Children are bare labels (no colon).

**Tag groups** — define color coding for metadata values. Must appear before org content:

```
tag: Location alias l
  NY(blue)
  SF(green)
  Remote(purple) default
```

- `tag: GroupName` starts a tag group; `alias` provides a shorthand for metadata keys
- `Value(color)` maps a metadata value to a color
- `default` marks the fallback value for nodes without that metadata
- Nodes whose metadata matches a tag group value get color-coded automatically
- `##` syntax is deprecated but still accepted — use `tag:` for new diagrams

**Options:**

| Option | Description |
|--------|-------------|
| `title: Text` | Chart title |
| `sub-node-label: Text` | Label for child count badges (e.g., "Crew", "Reports") |
| `show-sub-node-count: yes` | Show descendant count on nodes |

**Comments:**

```
// This is a comment
```

### Routing

If you don't know the chart type ahead of time, use the router:

```typescript
import { parseDgmoChartType, getDgmoFramework } from '@diagrammo/dgmo';

const chartType = parseDgmoChartType(content); // e.g. 'bar'
const framework = getDgmoFramework(chartType);  // 'echart' | 'd3' | 'mermaid'
```

Content with `->` arrows and no `chart:` header is automatically detected as a sequence diagram.

## .dgmo file format

Plain text. Lines starting with `#` or `//` are comments. Empty lines are ignored.

```
chart: <type>
title: Optional Title
xlabel: X Axis
ylabel: Y Axis
series: Series1, Series2
orientation: horizontal

# Multi-line values (alternative to comma-separated)
series:
  Series1
  Series2

# Data section
Label: value
Label (color): value
Label: value1, value2

# Connections (sankey, chord, arc)
Source -> Target: weight
Source (color) -> Target (color): weight (linkcolor)

# Indentation syntax (sankey)
Source (color)
  Target (color): weight (linkcolor)

# Groups
## Category Name
  Item1: value
  Item2: value
```

Colors can be specified inline as named colors (`red`, `blue`, `teal`, etc.) or hex values (`#ff6b6b`). They resolve against the active palette.

## Palettes

Eight built-in palettes, each with light and dark variants:

- `nordPalette` — cool, muted Scandinavian tones (default)
- `solarizedPalette` — warm/cool Solarized
- `catppuccinPalette` — modern pastels
- `rosePinePalette` — soft mauve and rose
- `gruvboxPalette` — retro groove
- `tokyoNightPalette` — Tokyo night
- `oneDarkPalette` — Atom One Dark inspired
- `boldPalette` — high-contrast

```typescript
import { getPalette, getAvailablePalettes, registerPalette } from '@diagrammo/dgmo';

// Use a built-in palette
const palette = getPalette('nord');
const colors = palette.light; // or palette.dark

// List available palettes
const all = getAvailablePalettes(); // [{ id, name }, ...]

// Register a custom palette
registerPalette({
  id: 'custom',
  name: 'My Theme',
  light: { bg: '#fff', surface: '#f5f5f5', /* ... */ },
  dark:  { bg: '#1a1a1a', surface: '#2a2a2a', /* ... */ },
});
```

### Color utilities

```typescript
import { hexToHSL, hslToHex, mute, tint, shade, contrastText } from '@diagrammo/dgmo';

hexToHSL('#5e81ac')          // { h: 213, s: 32, l: 52 }
mute('#5e81ac')              // desaturated + darkened hex
tint('#5e81ac', 0.3)         // blended toward white
contrastText('#2e3440', '#eceff4', '#2e3440') // WCAG-compliant pick
```

### Mermaid theming

Generate Mermaid-compatible CSS variables from any palette:

```typescript
import { buildMermaidThemeVars, buildThemeCSS } from '@diagrammo/dgmo';

const vars = buildMermaidThemeVars(palette.light); // ~121 CSS custom properties
const css = buildThemeCSS(palette.light);          // complete CSS string
```

## Server-side / headless export

Render any chart to an SVG string without a visible DOM:

```typescript
import { renderD3ForExport, renderEChartsForExport } from '@diagrammo/dgmo';

// D3 and sequence charts
const svg = await renderD3ForExport(content, 'light');

// ECharts charts
const svg = await renderEChartsForExport(content, 'light');
```

Both accept an optional third argument for a custom `PaletteColors` object (defaults to Nord).

## API overview

### Router

| Export | Description |
|--------|-------------|
| `parseDgmoChartType(content)` | Extract chart type from content (infers `sequence` from arrow syntax) |
| `getDgmoFramework(type)` | Map chart type → `'echart'` \| `'d3'` \| `'mermaid'` |
| `DGMO_CHART_TYPE_MAP` | Full type-to-framework registry |

### Parsers

| Export | Description |
|--------|-------------|
| `parseChart(content, colors)` | Parse standard chart types (bar, line, pie, radar, etc.) |
| `parseEChart(content)` | Parse ECharts-specific types (scatter, sankey, heatmap, etc.) |
| `parseD3(content, colors)` | Parse D3 chart types (slope, arc, timeline, etc.) |
| `parseSequenceDgmo(content)` | Parse sequence diagrams |
| `parseFlowchart(content, colors)` | Parse flowchart diagrams |
| `parseClassDiagram(content, colors)` | Parse class diagrams |
| `parseERDiagram(content, colors)` | Parse ER diagrams |
| `parseOrg(content, colors)` | Parse org chart diagrams |
| `parseQuadrant(content)` | Parse quadrant charts |

### Config builders

| Export | Description |
|--------|-------------|
| `buildEChartsOptionFromChart(parsed, colors, dark)` | ECharts option from `parseChart` result |
| `buildEChartsOption(parsed, colors, dark)` | ECharts option from `parseEChart` result |
| `buildMermaidQuadrant(parsed, colors)` | Mermaid quadrantChart syntax string |

### Renderers

| Export | Description |
|--------|-------------|
| `renderSlopeChart(el, parsed, colors, dark)` | Slope chart SVG |
| `renderArcDiagram(el, parsed, colors, dark)` | Arc diagram SVG |
| `renderTimeline(el, parsed, colors, dark)` | Timeline SVG |
| `renderWordCloud(el, parsed, colors, dark)` | Word cloud SVG |
| `renderVenn(el, parsed, colors, dark)` | Venn diagram SVG |
| `renderQuadrant(el, parsed, colors, dark)` | Quadrant chart SVG |
| `renderFlowchart(el, parsed, layout, colors, dark)` | Flowchart SVG |
| `renderClassDiagram(el, parsed, layout, colors, dark)` | Class diagram SVG |
| `renderERDiagram(el, parsed, layout, colors, dark)` | ER diagram SVG |
| `renderOrg(el, parsed, colors, dark)` | Org chart SVG |
| `layoutClassDiagram(parsed)` | Compute class diagram node positions |
| `layoutERDiagram(parsed)` | Compute ER diagram node positions |
| `layoutGraph(parsed)` | Compute flowchart node positions |
| `renderSequenceDiagram(el, parsed, colors, dark, onClick)` | Sequence diagram SVG |
| `renderD3ForExport(content, theme, palette?)` | Any D3/sequence chart → SVG string |
| `renderEChartsForExport(content, theme, palette?)` | Any ECharts chart → SVG string |

### Sequence internals

| Export | Description |
|--------|-------------|
| `buildRenderSequence(parsed)` | Ordered render steps from parsed diagram |
| `computeActivations(steps, participants)` | Activation bar positions |
| `applyPositionOverrides(participants, parsed)` | Apply `Name position N` overrides |
| `applyGroupOrdering(participants, groups)` | Reorder participants by group |
| `groupMessagesBySection(elements)` | Group elements into collapsible sections |
| `inferParticipantType(name)` | Infer participant type from name |

### Palette & color

| Export | Description |
|--------|-------------|
| `getPalette(id)` | Get palette by ID (falls back to Nord) |
| `getAvailablePalettes()` | List registered palettes `[{ id, name }]` |
| `registerPalette(config)` | Register a custom palette |
| `resolveColor(name, colors)` | Resolve color name or hex against a palette |
| `hexToHSL(hex)` / `hslToHex(h,s,l)` | Color conversion |
| `mute(hex)` / `tint(hex, amount)` / `shade(hex, base, amount)` | Color manipulation |
| `contrastText(bg, light, dark)` | WCAG contrast text picker |
| `buildMermaidThemeVars(colors)` | Mermaid CSS variables |
| `buildThemeCSS(colors)` | Complete Mermaid theme CSS |

## Development

### Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)

### Setup

```bash
pnpm install
pnpm build        # tsup → dist/ (ESM + CJS + CLI)
```

### Commands

```bash
pnpm build            # Production build (lib + CLI)
pnpm dev              # Watch mode (rebuild on save)
pnpm test             # Run tests (Vitest)
pnpm test:watch       # Tests in watch mode
pnpm typecheck        # TypeScript type checking
```

### Quick CLI testing

```bash
./test-cli.sh input.dgmo [args...]    # Builds and runs in one step
```

### Project structure

```
src/
├── index.ts                  # Public API exports
├── cli.ts                    # CLI entry point → dist/cli.cjs
├── dgmo-router.ts            # Chart type → framework dispatcher
├── chart.ts                  # Standard chart parser (bar, line, pie, etc.)
├── echarts.ts                # ECharts parser, config builder, SSR export
├── d3.ts                     # D3 parsers + renderers (slope, arc, timeline, wordcloud, venn, quadrant)
├── class/                    # Class diagram parser, layout engine, and renderer
├── er/                       # ER diagram parser, layout engine, and renderer
├── graph/                    # Flowchart parser, layout engine, and renderer
├── org/                      # Org chart parser, layout engine, and renderer
├── dgmo-mermaid.ts           # Quadrant parser + Mermaid syntax builder
├── colors.ts                 # Named color map, resolve helper
├── fonts.ts                  # Font family constants (Helvetica for resvg)
├── sequence/
│   ├── parser.ts             # Sequence diagram DSL parser
│   ├── renderer.ts           # SVG renderer (D3-based)
│   └── participant-inference.ts  # 104-rule name → type engine
└── palettes/
    ├── types.ts              # PaletteConfig, PaletteColors types
    ├── registry.ts           # getPalette, registerPalette
    ├── color-utils.ts        # HSL conversions, mix(), mute(), tint()
    ├── mermaid-bridge.ts     # Mermaid CSS variable builder
    ├── nord.ts               # Nord palette
    ├── solarized.ts          # Solarized palette
    ├── catppuccin.ts         # Catppuccin palette
    ├── rose-pine.ts          # Rose Pine palette
    ├── gruvbox.ts            # Gruvbox palette
    ├── tokyo-night.ts        # Tokyo Night palette
    ├── one-dark.ts           # One Dark palette
    └── bold.ts               # Bold palette
```

### Build output

tsup produces:
- `dist/index.js` + `dist/index.d.ts` (ESM)
- `dist/index.cjs` + `dist/index.d.cts` (CJS)
- `dist/cli.cjs` (CLI binary — bundles everything except `@resvg/resvg-js`)

### Testing

Tests live in `tests/` and use Vitest with jsdom:

```bash
pnpm test                 # Run all tests
pnpm test -- --reporter verbose   # Verbose output
```

## Releasing

### npm publish

1. Bump version in `package.json`
2. Build and test:
   ```bash
   pnpm build && pnpm test
   ```
3. Publish:
   ```bash
   npm publish
   ```
4. After publishing, update downstream consumers:
   - **homebrew-dgmo**: Update `Formula/dgmo.rb` with new tarball URL and sha256
   - **obsidian-dgmo**: Update `@diagrammo/dgmo` version in `package.json`
   - **diagrammo-app**: Update submodule ref (`git submodule update --remote`)

### Generating the sha256 for Homebrew

```bash
VERSION=0.2.7  # new version
curl -sL "https://registry.npmjs.org/@diagrammo/dgmo/-/dgmo-${VERSION}.tgz" | shasum -a 256
```

## Gallery

The gallery renders every fixture in `gallery/fixtures/` across all palettes, themes, and formats, producing a filterable HTML page.

```bash
pnpm gallery              # Build CLI + render all combinations
```

Output lands in `gallery/output/` (gitignored):

- `gallery/output/renders/` — individual SVG and PNG files
- `gallery/output/index.html` — filterable gallery page (open in a browser)

### Filter options

```bash
pnpm gallery -- --chart bar
pnpm gallery -- --palette nord
pnpm gallery -- --theme dark
pnpm gallery -- --format svg
pnpm gallery -- --chart sequence --palette catppuccin --theme light --format png
pnpm gallery -- --concurrency 4    # defaults to CPU count
```

### Adding fixtures

Drop a new `.dgmo` file into `gallery/fixtures/` and re-run `pnpm gallery`.

## License

MIT

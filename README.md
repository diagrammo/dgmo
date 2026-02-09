# @diagrammo/dgmo

A unified diagram markup language — parser, config builder, renderer, and color system.

Write simple, readable `.dgmo` text files and render them as charts, diagrams, and visualizations using Chart.js, ECharts, D3, or Mermaid.

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

| Option | Values | Default |
|---|---|---|
| `--theme` | `light`, `dark`, `transparent` | `light` |
| `--palette` | `nord`, `solarized`, `catppuccin`, `rose-pine`, `gruvbox`, `tokyo-night`, `one-dark`, `bold` | `nord` |

## How it works

Every `.dgmo` file is plain text with a `chart: <type>` header followed by metadata and data. The library routes each chart type to the right framework and gives you either:

- A **framework config object** you render yourself (Chart.js, ECharts, Mermaid)
- A **rendered SVG** via D3 or the built-in sequence renderer

```
parse → build config → render
```

All parsers are pure functions with no DOM dependency. Renderers that produce SVG accept a container element.

## Supported chart types

| Type | Framework | Description |
|------|-----------|-------------|
| `bar` | Chart.js | Vertical/horizontal bar charts |
| `bar-stacked` | Chart.js | Stacked bar charts |
| `line` | Chart.js | Line charts with crosshair |
| `area` | Chart.js | Filled area charts |
| `pie` | Chart.js | Pie charts with connector labels |
| `doughnut` | Chart.js | Doughnut charts |
| `radar` | Chart.js | Radar/spider charts |
| `polar-area` | Chart.js | Polar area charts |
| `scatter` | ECharts | XY scatter with categories and sizing |
| `sankey` | ECharts | Flow diagrams |
| `chord` | ECharts | Circular relationship diagrams |
| `function` | ECharts | Mathematical function plots |
| `heatmap` | ECharts | Matrix heatmaps |
| `funnel` | ECharts | Conversion funnels |
| `slope` | D3 | Before/after comparison |
| `wordcloud` | D3 | Weighted text clouds |
| `arc` | D3 | Arc/network diagrams |
| `timeline` | D3 | Timelines with eras and markers |
| `venn` | D3 | Set intersection diagrams |
| `quadrant` | D3/Mermaid | 2D quadrant scatter |
| `sequence` | D3 | Sequence diagrams with type inference |

## Usage

### Chart.js (bar, line, pie, radar, etc.)

```typescript
import { parseChartJs, buildChartJsConfig } from '@diagrammo/dgmo';
import { Chart } from 'chart.js/auto';

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

const parsed = parseChartJs(content, palette.light);
const config = buildChartJsConfig(parsed, palette.light, false);
new Chart(canvas, config);
```

### ECharts (scatter, sankey, heatmap, etc.)

```typescript
import { parseEChart, buildEChartsOption } from '@diagrammo/dgmo';
import * as echarts from 'echarts';

const content = `
chart: sankey
title: Energy Flow

Coal -> Electricity: 50
Gas -> Electricity: 30
Electricity -> Industry: 45
Electricity -> Homes: 35
`;

const parsed = parseEChart(content);
const option = buildEChartsOption(parsed, palette.light, false);
echarts.init(container).setOption(option);
```

### D3 (slope, timeline, wordcloud, etc.)

```typescript
import { parseD3, renderTimeline } from '@diagrammo/dgmo';

const content = `
chart: timeline
title: Project Milestones

2024-01: Kickoff
2024-03 -> 2024-06: Development
2024-07: Launch
`;

const parsed = parseD3(content, palette.light);
renderTimeline(container, parsed, palette.light, false);
```

### Sequence diagrams

Sequence diagrams use a minimal DSL. Participants are inferred from messages — no declaration blocks needed. Types (service, database, actor, queue, etc.) are inferred from naming conventions.

```typescript
import { parseSequenceDgmo, renderSequenceDiagram } from '@diagrammo/dgmo';

const content = `
title: Login Flow

User -> AuthService: login(email, pass)
AuthService -> UserDB: findByEmail(email)
UserDB -> AuthService: <- user
AuthService -> User: <- token
`;

const parsed = parseSequenceDgmo(content);
renderSequenceDiagram(container, parsed, palette.light, false, (lineNum) => {
  // clicked a message — jump to that line in the editor
});
```

**Sequence syntax highlights:**

- `A -> B: message` — synchronous call
- `A ~> B: message` — async/fire-and-forget
- `A -> B: method(): returnValue` — call with return
- `if` / `else` / `end` — conditional blocks
- `loop` / `end` — loop blocks
- `parallel` / `else` / `end` — concurrent branches
- `== Section ==` — horizontal dividers
- `## GroupName(color)` — participant grouping
- `Name is a database` — explicit type declaration
- `Name position 0` — explicit ordering

**Participant type inference** — 162 rules map names to shapes automatically:

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

### Routing

If you don't know the chart type ahead of time, use the router:

```typescript
import { parseDgmoChartType, getDgmoFramework } from '@diagrammo/dgmo';

const chartType = parseDgmoChartType(content); // e.g. 'bar'
const framework = getDgmoFramework(chartType);  // e.g. 'chartjs'
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

# Data section
Label: value
Label (color): value
Label: value1, value2

# Connections (sankey, chord, arc)
Source -> Target: weight

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
  light: { bg: '#fff', surface: '#f5f5f5', /* ... 17 more fields */ },
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

## SVG export

Render any D3-based chart to an SVG string (no visible DOM needed):

```typescript
import { renderD3ForExport } from '@diagrammo/dgmo';

const svgString = await renderD3ForExport(content, 'light');
```

## API overview

### Router

| Export | Description |
|--------|-------------|
| `parseDgmoChartType(content)` | Extract chart type from content |
| `getDgmoFramework(type)` | Map chart type to framework |
| `DGMO_CHART_TYPE_MAP` | Full type-to-framework registry |

### Parsers

| Export | Description |
|--------|-------------|
| `parseChartJs(content, colors)` | Parse Chart.js chart types |
| `parseEChart(content)` | Parse ECharts chart types |
| `parseD3(content, colors)` | Parse D3 chart types |
| `parseSequenceDgmo(content)` | Parse sequence diagrams |
| `parseQuadrant(content)` | Parse quadrant charts |

### Config builders

| Export | Description |
|--------|-------------|
| `buildChartJsConfig(parsed, colors, dark)` | Chart.js configuration object |
| `buildEChartsOption(parsed, colors, dark)` | ECharts option object |
| `buildMermaidQuadrant(parsed, colors)` | Mermaid quadrant syntax string |

### D3 renderers

| Export | Description |
|--------|-------------|
| `renderSlopeChart(el, parsed, colors, dark)` | Slope chart SVG |
| `renderArcDiagram(el, parsed, colors, dark)` | Arc diagram SVG |
| `renderTimeline(el, parsed, colors, dark)` | Timeline SVG |
| `renderWordCloud(el, parsed, colors, dark)` | Word cloud SVG |
| `renderVenn(el, parsed, colors, dark)` | Venn diagram SVG |
| `renderQuadrant(el, parsed, colors, dark)` | Quadrant chart SVG |
| `renderD3ForExport(content, theme)` | Any D3 chart as SVG string |

### Sequence renderer

| Export | Description |
|--------|-------------|
| `renderSequenceDiagram(el, parsed, colors, dark, onClick)` | Sequence diagram SVG |
| `buildRenderSequence(parsed)` | Ordered render steps |
| `computeActivations(steps, participants)` | Activation bar positions |

### Palette & color

| Export | Description |
|--------|-------------|
| `getPalette(id)` | Get palette by ID (falls back to Nord) |
| `getAvailablePalettes()` | List registered palettes |
| `registerPalette(config)` | Register a custom palette |
| `resolveColor(name, colors)` | Resolve color name or hex |
| `hexToHSL(hex)` / `hslToHex(h,s,l)` | Color conversion |
| `mute(hex)` / `tint(hex, amount)` / `shade(hex, base, amount)` | Color manipulation |
| `contrastText(bg, light, dark)` | WCAG contrast text picker |
| `buildMermaidThemeVars(colors)` | Mermaid CSS variables |
| `buildThemeCSS(colors)` | Mermaid theme CSS string |

## License

MIT

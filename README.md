# @diagrammo/dgmo

A diagram markup language — parser, config builder, renderer, and color system.

Write plain-text `.dgmo` files and render them as charts, diagrams, and visualizations. Supports 40+ chart types — data charts, structural diagrams, sequence diagrams, RACI matrices, and more. Ships as both a library and a standalone CLI.

## Language Reference

Full syntax documentation for every chart type, directive, and option:

- **Online:** [diagrammo.app/reference](https://diagrammo.app/reference)
- **Local:** [`docs/language-reference.md`](docs/language-reference.md)

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

### Data Charts

| Type | Description |
|------|-------------|
| `bar` | Vertical/horizontal bar charts |
| `line` | Line charts with crosshair |
| `area` | Filled area charts |
| `pie` | Pie charts with connector labels |
| `doughnut` | Doughnut charts |
| `radar` | Radar/spider charts |
| `polar-area` | Polar area charts |
| `bar-stacked` | Stacked bar charts |
| `multi-line` | Multi-series line charts |
| `scatter` | XY scatter with categories and sizing |
| `heatmap` | Matrix heatmaps |
| `funnel` | Conversion funnels |
| `sankey` | Flow diagrams |
| `chord` | Circular relationship diagrams |

### Visualizations

| Type | Description |
|------|-------------|
| `slope` | Before/after comparison |
| `wordcloud` | Weighted text clouds |
| `arc` | Arc/network diagrams |
| `timeline` | Timelines with eras and markers |
| `venn` | Set intersection diagrams |
| `quadrant` | 2D quadrant scatter |
| `tech-radar` | Technology adoption radar (ThoughtWorks style) |

### Structural Diagrams

| Type | Description |
|------|-------------|
| `sequence` | Sequence diagrams with type inference |
| `flowchart` | Directed graph flowcharts with branching and 6 node shapes |
| `class` | UML class diagrams with inheritance, composition, and visibility |
| `er` | Entity-relationship diagrams with crow's foot notation |
| `org` | Org charts with hierarchy, team containers, and tag group color-coding |
| `c4` | C4 architecture diagrams (context, containers, components, deployment) |
| `state` | State machine diagrams |
| `infra` | Infrastructure capacity and latency diagrams |
| `kanban` | Kanban boards |
| `sitemap` | Site structure and navigation maps |

### Other

| Type | Description |
|------|-------------|
| `function` | Mathematical function plots |

## How it works

Every `.dgmo` file is plain text with a `<type>` header line (optionally followed by a title) and then metadata and data. The library parses each chart type and gives you either:

- A **config object** you render yourself
- A **rendered SVG** directly

```
parse → build config → render
```

All parsers are pure functions with no DOM dependency. The CLI sets up jsdom internally for headless rendering.

## Usage

### Data charts — standard (bar, line, pie, radar, etc.)

```typescript
import { parseChart, buildSimpleChartOption, getPalette } from '@diagrammo/dgmo';
import * as echarts from 'echarts';

const colors = getPalette('nord').light;

const content = `
bar Revenue by Quarter
x-label Quarter
y-label Revenue ($M)

Q1 12
Q2 19
Q3 15
Q4 22
`;

const parsed = parseChart(content, colors);
const option = buildSimpleChartOption(parsed, colors, false);
echarts.init(container).setOption(option);
```

### Data charts — extended (scatter, sankey, heatmap, etc.)

```typescript
import { parseExtendedChart, buildExtendedChartOption, getPalette } from '@diagrammo/dgmo';
import * as echarts from 'echarts';

const colors = getPalette('nord').light;

const content = `
sankey Energy Flow

Coal orange
  Electricity 50
Gas blue
  Electricity 30
Electricity -> Industry 45
Electricity -> Homes 35
`;

const parsed = parseExtendedChart(content);
const option = buildExtendedChartOption(parsed, colors, false);
echarts.init(container).setOption(option);
```

### Visualizations (slope, timeline, wordcloud, etc.)

```typescript
import { parseVisualization, renderTimeline, getPalette } from '@diagrammo/dgmo';

const colors = getPalette('nord').light;

const content = `
timeline Project Milestones

2024-01 Kickoff
2024-03 -> 2024-06 Development
2024-07 Launch
`;

const parsed = parseVisualization(content, colors);
renderTimeline(container, parsed, colors, false);
```

### Sequence diagrams

Sequence diagrams use a minimal DSL. Participants are inferred from messages — no declaration blocks needed. Types (service, database, actor, queue, etc.) are inferred from naming conventions.

```typescript
import { parseSequenceDgmo, renderSequenceDiagram, getPalette } from '@diagrammo/dgmo';

const colors = getPalette('nord').light;

const content = `
sequence Login Flow

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
- `activations off` — disable activation bars
- `tag Name` + `Value(color)` entries — color-coded metadata dimensions with interactive legend
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
flowchart Decision Flow

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
er Blog Platform

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

- `er` — chart type (first line), optionally followed by title: `er Blog Platform`
- `notation labels` — use text labels instead of crow's foot markers
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
org Engineering

tag Location
  NY blue
  SF green

Alex Chen
  role: CTO
  location: NY

  [Platform Team]
    goal: Core infrastructure

    Alice Park role: Senior Engineer, location: NY
    Bob Torres role: Junior Engineer, location: SF
`;

const parsed = parseOrg(content, colors);
renderOrg(container, parsed, colors, false);
```

**Org chart syntax:**

- `org` — chart type (first line), optionally followed by title: `org Engineering`
- Indentation defines parent-child hierarchy (2 or 4 spaces, consistent within file)
- Multiple root nodes supported (e.g., co-CEOs at top level)

**Node metadata:**

```
Jane Smith
  role: CEO
  location: NY
```

Or single-line with same-line metadata:

```
Jane Smith role: CEO, location: NY
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
tag Location as l
  NY blue
  SF green
  Remote purple default
```

- `tag GroupName` starts a tag group; `as <alias>` provides a shorthand for metadata keys
- `Value color` maps a metadata value to a color (trailing-token form per spec §1.5)
- `default` marks the fallback value for nodes without that metadata
- Nodes whose metadata matches a tag group value get color-coded automatically
- `##` syntax is deprecated but still accepted — use `tag` for new diagrams

**Options:**

| Option | Description |
|--------|-------------|
| `org Title Text` | Chart title (on first line after chart type) |
| `sub-node-label Text` | Label for child count badges (e.g., "Crew", "Reports") |
| `show-sub-node-count` | Show descendant count on nodes |

**Comments:**

```
// This is a comment
```

### Routing

If you don't know the chart type ahead of time, use the router:

```typescript
import { parseDgmoChartType, getRenderCategory, isExtendedChartType, parseChart, parseExtendedChart } from '@diagrammo/dgmo';

const chartType = parseDgmoChartType(content); // e.g. 'bar'
const category = getRenderCategory(chartType); // 'data-chart' | 'visualization' | 'diagram' | null

// Dispatch within data-chart: standard vs extended parser
if (isExtendedChartType(chartType)) {
  const parsed = parseExtendedChart(content); // scatter, sankey, heatmap, funnel, chord, function
} else {
  const parsed = parseChart(content);          // bar, line, pie, etc.
}
```

Content with `->` arrows and no chart type header is automatically detected as a sequence diagram.

## .dgmo file format

Plain text. Lines starting with `#` or `//` are comments. Empty lines are ignored.

```
<type> Optional Title
x-label X Axis
y-label Y Axis
series Series1, Series2
orientation horizontal

# Multi-line values (alternative to comma-separated)
series
  Series1
  Series2

# Data section
Label value
Label (color) value
Label value1, value2

# Connections (sankey, chord, arc)
Source -> Target weight
Source (color) -> Target (color) weight (linkcolor)

# Indentation syntax (sankey)
Source (color)
  Target (color) weight (linkcolor)

# Groups
## Category Name
  Item1 value
  Item2 value
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

## HTML embed (auto-render)

Drop a `<script>` tag on any static HTML page and any `<pre class="dgmo">` block becomes a rendered diagram on load.

### 60-second quickstart

```html
<!doctype html>
<html>
<head>
  <!-- Add `integrity="sha384-…"` for SRI; the published value for each
       release is in the GitHub release notes (or run `pnpm sri` after
       building from source). -->
  <script
    src="https://cdn.jsdelivr.net/npm/@diagrammo/dgmo@^0.8/dist/auto.js"
    crossorigin="anonymous"></script>
</head>
<body>
  <pre class="dgmo">sequence Boarding the Marauder

Quartermaster -Hoist colors-> Crew
Crew -Aye, captain-> Bosun
Bosun -Heading 270-> Helm
Helm -On course-> Quartermaster
</pre>
</body>
</html>
```

The bundle exposes `window.dgmo` and self-runs on `DOMContentLoaded`. Each match is replaced with a `<div class="dgmo-rendered">` containing the SVG plus a collapsible source panel with **Copy** and **Open in editor** buttons.

Selectors matched: `.dgmo`, `.language-dgmo` (covers Prism/highlight.js fenced ` ```dgmo ` blocks). Already-rendered nodes are tagged `data-dgmo-processed="true"` so re-runs are idempotent.

### Configuration

Configure via JSON on the bundle's own `<script>` tag — no inline JS, CSP-friendly:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@diagrammo/dgmo@^0.8/dist/auto.js"
  data-config='{"theme":"auto","palette":"nord","showSource":true,"showEditorLink":true}'
></script>
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `theme` | `'auto' \| 'light' \| 'dark' \| 'transparent'` | `'auto'` | `'auto'` reads `prefers-color-scheme`, `<html data-theme>`, and `<html class="dark">`; re-renders live when the system preference flips |
| `palette` | palette id (string) | `'nord'` | Any registered palette: `bold`, `catppuccin`, `dracula`, `gruvbox`, `monokai`, `nord`, `one-dark`, `rose-pine`, `solarized`, `tokyo-night` |
| `showSource` | `boolean` | `true` | Show the collapsible "DGMO source" panel under each diagram |
| `showEditorLink` | `boolean` | `true` | Include the "Open in editor" button (set `false` for air-gapped intranets) |

Per-element override: `<pre class="dgmo" data-show-source="false">` hides only that diagram's source panel.

Opt out of auto-bootstrap with `data-auto="false"` and call `dgmo.run()` manually after framework hydration:

```js
window.dgmo.initialize({ theme: 'dark' });
window.dgmo.run(); // or: window.dgmo.run({ nodes: [el1, el2] });
```

### Framework recipes

<details>
<summary><strong>Astro</strong></summary>

Use `client:load` only if you need SPA hydration. For static pages the script tag is enough.

```astro
---
// src/pages/index.astro
---
<script src="https://cdn.jsdelivr.net/npm/@diagrammo/dgmo@^0.8/dist/auto.js" is:inline></script>
<pre class="dgmo">pie Languages
TypeScript: 58
Rust: 21</pre>
```

For islands/dynamic content set `data-auto="false"` and run from `onMount`.
</details>

<details>
<summary><strong>Docusaurus / MDX</strong></summary>

Add the script via the `scripts` field in `docusaurus.config.js`:

```js
module.exports = {
  scripts: [{
    src: 'https://cdn.jsdelivr.net/npm/@diagrammo/dgmo@^0.8/dist/auto.js',
    'data-config': '{"theme":"auto"}',
    async: false,
  }],
};
```

If you use Prism, ensure it loads **after** the dgmo bundle, or set `data-auto="false"` and trigger `dgmo.run()` from a Docusaurus client module.
</details>

<details>
<summary><strong>MkDocs</strong></summary>

In `mkdocs.yml`:

```yaml
extra_javascript:
  - https://cdn.jsdelivr.net/npm/@diagrammo/dgmo@^0.8/dist/auto.js
```

Markdown fences `` ```dgmo `` rendered by Pygments produce `<pre><code class="language-dgmo">…</code></pre>` — the auto bundle replaces the entire `<pre>`, leaving no empty shell.
</details>

<details>
<summary><strong>Hugo</strong></summary>

Add a partial at `layouts/partials/dgmo.html`:

```html
<script src="https://cdn.jsdelivr.net/npm/@diagrammo/dgmo@^0.8/dist/auto.js"></script>
```

Include it from your base template's `<head>`. Hugo's chroma highlighter emits `<pre><code class="language-dgmo">…</code></pre>` which the bundle picks up automatically.
</details>

### Self-hosting

Drop `dist/auto.js` (and optionally `dist/auto.css`) on any web server or intranet CDN — there are zero outbound runtime fetches. The only outbound link is the **Open in editor** button to `online.diagrammo.app`, suppressible with:

```html
<script src="/static/auto.js" data-config='{"showEditorLink":false}'></script>
```

Air-gapped and outbound-blocked environments work without modification.

### Bundle size

The IIFE bundle ships every chart-type renderer for one-tag-and-done convenience, so the artifact is currently ~1.6 MB gzipped. If size matters more than coverage, two options:

1. **Use the npm-direct ESM/CJS exports** (`@diagrammo/dgmo/auto`) and tree-shake — your bundler drops chart types you don't reference.
2. **Subset import** — if you only need a handful of chart types, import the parser/renderer pieces directly from `@diagrammo/dgmo` and skip the auto facade.

Per-chart-type lazy-loading inside the IIFE is on the roadmap and tracked in the spec under ADR-2 plan B.

### Security & CSP

Recommended Content-Security-Policy snippet:

```
script-src 'self' https://cdn.jsdelivr.net;
style-src  'self' 'unsafe-inline';
connect-src 'self';
```

The bundle makes no `fetch`/XHR calls. The injected `<style>` block requires `'unsafe-inline'` in `style-src`; for strict CSP, link the parallel `dist/auto.css` artifact and the bundle skips inline injection.

`window.dgmo` and `window.diagrammo` are defined with `Object.defineProperty(..., { writable: false, configurable: false })` so a later-loaded script cannot intercept the API.

### SemVer policy

Within a major version, the following surface is stable for embedders:

- `window.dgmo` API (`initialize`, `run`, `version`)
- DOM contract (selector, wrapper class names, `data-dgmo-processed` flag)
- CSS class prefix `dgmo-`
- Error-banner shape (HTML class names + text format — locked so AI tools can screen-scrape it)
- Default values (`theme: 'auto'`, `palette: 'nord'`, `showSource: true`, `showEditorLink: true`)
- UTM parameter shape on the editor link

Any breaking change is a major-version bump. Pin `^0.8` (or whatever the current major is) in your CDN URL to opt out of breaking changes.

## Server-side / headless export

Render any chart to an SVG string without a visible DOM:

```typescript
import { renderForExport, renderExtendedChartForExport } from '@diagrammo/dgmo';

// Diagrams, visualizations, and sequence charts
const svg = await renderForExport(content, 'light');

// Data charts (bar, line, scatter, sankey, etc.)
const svg = await renderExtendedChartForExport(content, 'light');
```

Both accept an optional third argument for a custom `PaletteColors` object (defaults to Nord).

## API tiers

`@diagrammo/dgmo` ships three import paths with different stability contracts:

| Path | Surface | SemVer contract |
|------|---------|-----------------|
| `@diagrammo/dgmo` | `render`, `validate`, `encodeDiagramUrl`, `decodeDiagramUrl`, `palettes`, `getPalette`, `themes`, plus the `RenderOptions`, `RenderResult`, `CompactViewState`, `PaletteConfig`, `PaletteColors`, `Theme`, `DgmoError` types | **Stable.** Breaking changes only in major versions. Pin `^0.x` (or `^1.x` once we hit 1.0). |
| `@diagrammo/dgmo/highlight` | `highlightDgmo`, `NORD_ROLE_STYLES` and other role-style sets | **Stable.** Same policy as root. |
| `@diagrammo/dgmo/editor` | CodeMirror grammar + language support | **Stable.** Same policy as root. |
| `@diagrammo/dgmo/advanced` | Parsers (`parseChart`, `parseVisualization`, `parseSequenceDgmo`, …), layout helpers, config builders, low-level renderers, palette-color utilities, sequence internals — see the table below | **Reduced semver.** Symbols may be renamed, signatures may change, or exports may be removed in **minor** versions. Patch versions only fix bugs. Pin `~0.x.y` if you depend on `/advanced`. |

The `@diagrammo/dgmo/internal` subpath was renamed to `/advanced` in 0.15.x and exists as a re-export alias for one minor version. It will be removed in 0.17.x — update your imports to `/advanced` before then.

## /advanced exports

### Router

| Export | Description |
|--------|-------------|
| `parseDgmoChartType(content)` | Extract chart type from content (infers `sequence` from arrow syntax) |
| `getRenderCategory(type)` | Map chart type → `'data-chart'` \| `'visualization'` \| `'diagram'` \| `null` |
| `isExtendedChartType(type)` | Returns `true` for extended data-chart types (scatter, sankey, chord, function, heatmap, funnel) |
| `RenderCategory` | Type alias for `'data-chart' \| 'visualization' \| 'diagram'` |

### Parsers

| Export | Description |
|--------|-------------|
| `parseChart(content, colors)` | Parse standard data-chart types (bar, line, pie, radar, etc.) |
| `parseExtendedChart(content)` | Parse extended data-chart types (scatter, sankey, heatmap, etc.) |
| `parseVisualization(content, colors)` | Parse visualization types (slope, arc, timeline, etc.) |
| `parseSequenceDgmo(content)` | Parse sequence diagrams |
| `parseFlowchart(content, colors)` | Parse flowchart diagrams |
| `parseClassDiagram(content, colors)` | Parse class diagrams |
| `parseERDiagram(content, colors)` | Parse ER diagrams |
| `parseOrg(content, colors)` | Parse org chart diagrams |
| `parseQuadrant(content)` | Parse quadrant charts |

### Config builders

| Export | Description |
|--------|-------------|
| `buildSimpleChartOption(parsed, colors, dark)` | ECharts option from `parseChart` result (bar, line, pie, etc.) |
| `buildExtendedChartOption(parsed, colors, dark)` | ECharts option from `parseExtendedChart` result (scatter, sankey, etc.) |
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
| `renderForExport(content, theme, palette?)` | Any diagram or visualization → SVG string |
| `renderExtendedChartForExport(content, theme, palette?)` | Any data-chart → SVG string |

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

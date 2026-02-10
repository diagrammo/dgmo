# @diagrammo/dgmo — Public API

## Design Decisions

### Flat exports (not namespaced)

All functions are exported flat from the package root. This is the modern npm convention — it enables tree-shaking, simpler imports, and works well with TypeScript auto-import.

```ts
// Recommended
import { parseChart, buildEChartsOptionFromChart } from '@diagrammo/dgmo';

// NOT: dgmo.parse.chartjs() or dgmo.chartjs.parse()
```

### Palette system is optional

Parsers accept an optional `palette` parameter. When omitted, they fall back to the built-in Nord palette for color resolution. Renderers and config builders require palette and `isDark` explicitly — no implicit theming.

### D3/Sequence renderers mutate a container element

The D3 and sequence renderers follow a `render(container, parsed, palette, isDark)` pattern — they append SVG content into a provided `HTMLDivElement`. This is the natural D3 pattern and works well for browser-based consumers.

For headless/SSR use cases, `renderD3ForExport()` creates a temporary offscreen container and returns an SVG string.

### Config builders return plain objects

`buildEChartsOptionFromChart()` and `buildEChartsOption()` return framework config objects. The consumer brings their own ECharts runtime — the library has zero runtime dependency on those frameworks.

---

## API Reference

### Routing

Determine which framework handles a given `.dgmo` file.

| Function              | Signature                                      | Description                               |
| --------------------- | ---------------------------------------------- | ----------------------------------------- |
| `parseDgmoChartType`  | `(content: string) => string \| null`          | Extract `chart:` type from file content   |
| `getDgmoFramework`    | `(chartType: string) => DgmoFramework \| null` | Map chart type to its rendering framework |
| `DGMO_CHART_TYPE_MAP` | `Record<string, DgmoFramework>`                | Complete chart-type-to-framework mapping  |

```ts
import { parseDgmoChartType, getDgmoFramework } from '@diagrammo/dgmo';

const chartType = parseDgmoChartType(fileContent); // "bar"
const framework = getDgmoFramework(chartType); // "echart"
```

**Types**: `DgmoFramework = 'echart' | 'd3' | 'mermaid'`

---

### Parsers

All parsers take a `.dgmo` text string and return a structured parsed object. Parsing is pure — no DOM, no side effects.

#### Standard Charts

| Function     | Signature                                                   |
| ------------ | ----------------------------------------------------------- |
| `parseChart` | `(content: string, palette?: PaletteColors) => ParsedChart` |

```ts
import { parseChart, nordPalette } from '@diagrammo/dgmo';

const parsed = parseChart(fileContent, nordPalette.light);
if (parsed.error) console.error(parsed.error);
// parsed.type — "bar" | "line" | "pie" | "doughnut" | "radar" | "polar"
// parsed.data — array of { label, values, lineNumber }
```

**Types**: `ParsedChart`, `ChartType`, `ChartDataPoint`

#### ECharts

| Function      | Signature                                                    |
| ------------- | ------------------------------------------------------------ |
| `parseEChart` | `(content: string, palette?: PaletteColors) => ParsedEChart` |

```ts
import { parseEChart } from '@diagrammo/dgmo';

const parsed = parseEChart(fileContent);
// parsed.type — "funnel" | "scatter" | "sankey" | "heatmap" | "function" | "chord"
// parsed.data, parsed.scatterPoints, parsed.links, etc.
```

**Types**: `ParsedEChart`, `EChartsChartType`

#### D3

| Function  | Signature                                                |
| --------- | -------------------------------------------------------- |
| `parseD3` | `(content: string, palette?: PaletteColors) => ParsedD3` |

```ts
import { parseD3 } from '@diagrammo/dgmo';

const parsed = parseD3(fileContent);
// parsed.type — "slope" | "arc" | "timeline" | "wordcloud" | "venn" | "quadrant"
```

**Types**: `ParsedD3`, `D3ChartType`, `ArcLink`, `ArcNodeGroup`

#### Sequence Diagram

| Function            | Signature                                      |
| ------------------- | ---------------------------------------------- |
| `parseSequenceDgmo` | `(content: string) => ParsedSequenceDgmo`      |
| `looksLikeSequence` | `(content: string) => boolean`                 |
| `isSequenceBlock`   | `(el: SequenceElement) => el is SequenceBlock` |

```ts
import { parseSequenceDgmo } from '@diagrammo/dgmo';

const parsed = parseSequenceDgmo(fileContent);
// parsed.participants, parsed.messages, parsed.blocks, parsed.sections, parsed.groups
```

**Types**: `ParsedSequenceDgmo`, `SequenceParticipant`, `SequenceMessage`, `SequenceBlock`, `SequenceSection`, `SequenceGroup`, `SequenceElement`, `ParticipantType`

#### Quadrant (Mermaid bridge)

| Function        | Signature                             |
| --------------- | ------------------------------------- |
| `parseQuadrant` | `(content: string) => ParsedQuadrant` |

**Types**: `ParsedQuadrant`

---

### Config Builders

Produce framework-specific configuration objects from parsed data. The consumer provides the rendering runtime (ECharts, Mermaid).

| Function               | Signature                                                                                                         | Output                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `buildEChartsOptionFromChart` | `(parsed: ParsedChart, palette: PaletteColors, isDark: boolean) => EChartsOption`                                 | ECharts option for standard chart types |
| `buildEChartsOption`          | `(parsed: ParsedEChart, palette: PaletteColors, isDark: boolean) => EChartsOption`                                | ECharts option object                   |
| `buildMermaidQuadrant`        | `(parsed: ParsedQuadrant, options?: { isDark?: boolean; textColor?: string; mutedTextColor?: string }) => string` | Mermaid syntax string                   |

```ts
import { parseChart, buildEChartsOptionFromChart, getPalette } from '@diagrammo/dgmo';
import * as echarts from 'echarts';

const parsed = parseChart(content, nordPalette.light);
const option = buildEChartsOptionFromChart(parsed, nordPalette.light, false);

// Consumer provides ECharts runtime
echarts.init(containerElement).setOption(option);
```

---

### Renderers

Render parsed data to SVG. D3 and sequence renderers operate on a DOM container element.

#### D3 Chart Renderers

All share the same signature pattern:

```ts
(container: HTMLDivElement, parsed: ParsedD3, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void) => void
```

| Function           | Chart Type                                 |
| ------------------ | ------------------------------------------ |
| `renderSlopeChart` | Slope chart (before/after comparisons)     |
| `renderArcDiagram` | Arc diagram (network relationships)        |
| `renderTimeline`   | Timeline (Gantt-style date ranges)         |
| `renderWordCloud`  | Word cloud (weighted text)                 |
| `renderVenn`       | Venn diagram (set intersections)           |
| `renderQuadrant`   | Quadrant chart (2D scatter with quadrants) |

```ts
import { parseD3, renderSlopeChart, nordPalette } from '@diagrammo/dgmo';

const parsed = parseD3(content, nordPalette.light);
const container = document.getElementById('chart') as HTMLDivElement;

renderSlopeChart(container, parsed, nordPalette.light, false, (line) => {
  console.log('Clicked element from line', line);
});
```

#### Sequence Diagram Renderer

| Function                | Signature                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderSequenceDiagram` | `(container: HTMLDivElement, parsed: ParsedSequenceDgmo, palette: PaletteColors, isDark: boolean, onNavigateToLine?: (line: number) => void) => void` |

```ts
import {
  parseSequenceDgmo,
  renderSequenceDiagram,
  nordPalette,
} from '@diagrammo/dgmo';

const parsed = parseSequenceDgmo(content);
renderSequenceDiagram(container, parsed, nordPalette.light, false);
```

#### Export Renderer (SVG string output)

| Function            | Signature                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `renderD3ForExport` | `(content: string, theme: 'light' \| 'dark' \| 'transparent', palette?: PaletteColors) => Promise<string>` |

Returns a complete SVG string. Works for all D3 chart types including sequence diagrams. Creates a temporary offscreen container internally.

```ts
import { renderD3ForExport } from '@diagrammo/dgmo';

const svgString = await renderD3ForExport(content, 'light');
// Use in Node.js (with jsdom), SSR, or for file export
```

#### Sequence Renderer Internals

Lower-level functions for custom sequence rendering pipelines:

| Function                 | Signature                                                                                 | Description                                         |
| ------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `buildRenderSequence`    | `(messages: SequenceMessage[]) => RenderStep[]`                                           | Build ordered render sequence with inferred returns |
| `computeActivations`     | `(steps: RenderStep[]) => Activation[]`                                                   | Compute activation bar positions                    |
| `applyPositionOverrides` | `(participants: SequenceParticipant[]) => SequenceParticipant[]`                          | Apply explicit position overrides                   |
| `applyGroupOrdering`     | `(participants: SequenceParticipant[], groups: SequenceGroup[]) => SequenceParticipant[]` | Reorder participants by group membership            |

**Types**: `RenderStep`, `Activation`

---

### Palette System

#### Palette Registry

| Function               | Signature                          | Description                            |
| ---------------------- | ---------------------------------- | -------------------------------------- |
| `getPalette`           | `(id: string) => PaletteConfig`    | Get palette by ID (falls back to Nord) |
| `getAvailablePalettes` | `() => PaletteConfig[]`            | List all registered palettes           |
| `registerPalette`      | `(palette: PaletteConfig) => void` | Register a custom palette              |

```ts
import {
  getPalette,
  registerPalette,
  type PaletteConfig,
} from '@diagrammo/dgmo';

const nord = getPalette('nord');
const lightColors = nord.light; // PaletteColors for light mode
const darkColors = nord.dark; // PaletteColors for dark mode

// Register a custom palette
registerPalette({
  id: 'my-theme',
  name: 'My Theme',
  light: { bg: '#ffffff', surface: '#f5f5f5' /* ... all 19 fields */ },
  dark: { bg: '#1a1a1a', surface: '#2a2a2a' /* ... all 19 fields */ },
});
```

#### Built-in Palettes

8 built-in palettes, each a `PaletteConfig` with `.light` and `.dark` variants:

| Export              | ID              |
| ------------------- | --------------- |
| `nordPalette`       | `"nord"`        |
| `solarizedPalette`  | `"solarized"`   |
| `catppuccinPalette` | `"catppuccin"`  |
| `rosePinePalette`   | `"rose-pine"`   |
| `gruvboxPalette`    | `"gruvbox"`     |
| `tokyoNightPalette` | `"tokyo-night"` |
| `oneDarkPalette`    | `"one-dark"`    |
| `boldPalette`       | `"bold"`        |

#### Types

```ts
interface PaletteConfig {
  id: string;
  name: string;
  light: PaletteColors;
  dark: PaletteColors;
}

interface PaletteColors {
  bg: string; // Page background
  surface: string; // Card/panel background
  border: string; // Border color
  text: string; // Primary text
  textMuted: string; // Secondary text
  primary: string; // Accent / links
  // Chart series colors (8 named slots):
  red: string;
  orange: string;
  yellow: string;
  green: string;
  cyan: string;
  blue: string;
  purple: string;
  pink: string;
  // Semantic:
  success: string;
  warning: string;
  error: string;
  info: string;
}
```

---

### Color Utilities

| Function          | Signature                                                     | Description                              |
| ----------------- | ------------------------------------------------------------- | ---------------------------------------- |
| `resolveColor`    | `(color: string, palette?) => string`                         | Resolve color name or hex to CSS color   |
| `getSeriesColors` | `(palette: PaletteColors) => string[]`                        | Get 8-color series rotation from palette |
| `contrastText`    | `(bg: string, lightText: string, darkText: string) => string` | Pick contrast text color (WCAG)          |
| `hexToHSL`        | `(hex: string) => { h, s, l }`                                | Hex to HSL object                        |
| `hslToHex`        | `(h, s, l) => string`                                         | HSL values to hex string                 |
| `hexToHSLString`  | `(hex: string) => string`                                     | Hex to `"H S% L%"` CSS string            |
| `mute`            | `(hex: string) => string`                                     | Desaturated/darkened variant             |
| `tint`            | `(hex: string, amount: number) => string`                     | Blend toward white                       |
| `shade`           | `(hex: string, base: string, amount: number) => string`       | Blend toward dark base                   |
| `isValidHex`      | `(value: string) => boolean`                                  | Validate hex format                      |

#### Mermaid Theme Bridge

| Function                | Signature                                                            | Description                                        |
| ----------------------- | -------------------------------------------------------------------- | -------------------------------------------------- |
| `buildMermaidThemeVars` | `(colors: PaletteColors, isDark: boolean) => Record<string, string>` | Generate ~121 Mermaid theme variables from palette |
| `buildThemeCSS`         | `(palette: PaletteColors, isDark: boolean) => string`                | Generate CSS overrides for Mermaid SVGs            |

---

## Typical Usage Patterns

### Parse + Render a chart (browser)

```ts
import {
  parseDgmoChartType,
  getDgmoFramework,
  parseD3,
  renderSlopeChart,
  getPalette,
} from '@diagrammo/dgmo';

const content = `chart: slope
period: Before, After
Alice: 3, 7
Bob: 8, 4`;

const palette = getPalette('nord');
const colors = palette.light;
const chartType = parseDgmoChartType(content); // "slope"
const framework = getDgmoFramework(chartType); // "d3"

const parsed = parseD3(content, colors);
const container = document.getElementById('chart') as HTMLDivElement;
renderSlopeChart(container, parsed, colors, false);
```

### Parse + Build config for standard charts

```ts
import { parseChart, buildEChartsOptionFromChart, getPalette } from '@diagrammo/dgmo';
import * as echarts from 'echarts';

const content = `chart: bar
title: Sales
Q1: 100
Q2: 150
Q3: 200`;

const { light } = getPalette('catppuccin');
const parsed = parseChart(content, light);
const option = buildEChartsOptionFromChart(parsed, light, false);

echarts.init(document.getElementById('chart')).setOption(option);
```

### Export to SVG string

```ts
import { renderD3ForExport } from '@diagrammo/dgmo';

const svg = await renderD3ForExport(dgmoContent, 'dark');
fs.writeFileSync('output.svg', svg);
```

### Custom palette

```ts
import {
  registerPalette,
  getPalette,
  parseChart,
  buildEChartsOptionFromChart,
} from '@diagrammo/dgmo';

registerPalette({
  id: 'corporate',
  name: 'Corporate',
  light: {
    bg: '#ffffff',
    surface: '#f8f9fa',
    border: '#dee2e6',
    text: '#212529',
    textMuted: '#6c757d',
    primary: '#0d6efd',
    red: '#dc3545',
    orange: '#fd7e14',
    yellow: '#ffc107',
    green: '#198754',
    cyan: '#0dcaf0',
    blue: '#0d6efd',
    purple: '#6f42c1',
    pink: '#d63384',
    success: '#198754',
    warning: '#ffc107',
    error: '#dc3545',
    info: '#0dcaf0',
  },
  dark: {
    /* ... */
  },
});

const palette = getPalette('corporate');
```

---

## API Tiers

### Primary (stable, documented)

Core parse/render/build functions — these are the main library API:

- `parseDgmoChartType`, `getDgmoFramework`
- `parseChart`, `parseEChart`, `parseD3`, `parseSequenceDgmo`, `parseQuadrant`
- `buildEChartsOptionFromChart`, `buildEChartsOption`, `buildMermaidQuadrant`
- `renderSlopeChart`, `renderArcDiagram`, `renderTimeline`, `renderWordCloud`, `renderVenn`, `renderQuadrant`
- `renderSequenceDiagram`, `renderD3ForExport`
- `getPalette`, `getAvailablePalettes`, `registerPalette`
- All `PaletteConfig` definitions

### Secondary (stable, less common)

Useful for advanced consumers:

- `buildRenderSequence`, `computeActivations`, `applyPositionOverrides`, `applyGroupOrdering`
- `resolveColor`, `getSeriesColors`, `contrastText`
- `buildMermaidThemeVars`, `buildThemeCSS`
- Color utilities: `hexToHSL`, `hslToHex`, `mute`, `tint`, `shade`
- `looksLikeSequence`, `isSequenceBlock`, `inferParticipantType`

### Internal (exported for testing, may change)

- `DGMO_CHART_TYPE_MAP`, `RULE_COUNT`
- `orderArcNodes`, `parseTimelineDate`, `addDurationToDate`, `computeTimeTicks`, `formatDateLabel`
- `colorNames`, `nord`, `seriesColors`, `isValidHex`, `hexToHSLString`

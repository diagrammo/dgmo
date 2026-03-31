# Story 48.4: Flowchart SVG Renderer

Status: review

## Story

As a developer building structural diagram support for dgmo,
I want an SVG renderer that takes a laid-out flowchart graph and produces clean, palette-themed SVG output,
so that flowcharts render beautifully across all themes and are compatible with both browser display and resvg PNG export.

## Acceptance Criteria

1. All 6 shape types render with correct geometry
2. Edges render as SVG paths with arrowheads
3. Edge labels render at midpoint of edge
4. Node labels centered and legible
5. Palette colors applied consistently (light, dark, transparent themes)
6. Group boxes render around member nodes with label
7. Title renders above the diagram
8. SVG valid and renders in browsers
9. SVG compatible with resvg PNG rendering (no CSS `color-mix()`, no external fonts)
10. Renders correctly with all 8 palettes x 3 themes
11. Handles large diagrams (20+ nodes) without overlap
12. Edge colors and node colors apply when specified
13. `pnpm build && pnpm typecheck` passes
14. No regression on existing chart types

## Tasks / Subtasks

- [x] Task 1: Create `src/graph/flowchart-renderer.ts` with function signature (AC: 13)
  - [x] 1.1: Define `FlowchartRenderOptions` interface: `exportWidth?`, `exportHeight?`
  - [x] 1.2: Create `renderFlowchart(container: HTMLDivElement, graph: ParsedGraph, layout: LayoutResult, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions): void`
  - [x] 1.3: Import `d3-selection` for SVG DOM construction
  - [x] 1.4: Import `FONT_FAMILY` from `../fonts`
  - [x] 1.5: Import `getSeriesColors`, `mix` from `../palettes`
  - [x] 1.6: Import `LayoutResult`, `LayoutNode`, `LayoutEdge`, `LayoutGroup` from `./layout`
  - [x] 1.7: Import `ParsedGraph` from `./types`

- [x] Task 2: Implement SVG setup and canvas (AC: 5, 7, 8, 9)
  - [x] 2.1: Clear existing content: `d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove()`
  - [x] 2.2: Compute dimensions from `exportDims` or container dimensions
  - [x] 2.3: Create SVG element with `width`, `height`, `background` from palette
  - [x] 2.4: Set `font-family` to `FONT_FAMILY` on SVG root
  - [x] 2.5: Add padding/margin around diagram content
  - [x] 2.6: Compute scale factor if diagram is larger than viewport: fit diagram within available space
  - [x] 2.7: Render title above diagram if `graph.title` is set

- [x] Task 3: Define SVG arrowhead marker (AC: 2)
  - [x] 3.1: Create `<defs>` section with `<marker>` element for arrowhead
  - [x] 3.2: Define default arrowhead marker: triangle pointing right, filled with palette text color
  - [x] 3.3: For colored edges, create additional markers with matching fill colors
  - [x] 3.4: Markers sized appropriately: `markerWidth: 10`, `markerHeight: 7`, `refX: 10`, `refY: 3.5`

- [x] Task 4: Render group boxes (AC: 6)
  - [x] 4.1: For each `LayoutGroup` in layout result, render a background rectangle
  - [x] 4.2: Apply group color as fill with low opacity (e.g., 10-15% opacity) or use `mix()` with background
  - [x] 4.3: Render group label at top of the group box (above member nodes)
  - [x] 4.4: Add border/stroke using group color at higher opacity
  - [x] 4.5: Add padding around group bounding box (8-12px)
  - [x] 4.6: Render groups BEFORE nodes and edges (z-order: groups behind everything)

- [x] Task 5: Render node shapes (AC: 1, 4, 12)
  - [x] 5.1: Implement `renderTerminal(g, node)` — rounded rectangle (`rx: height/2`) or stadium shape
  - [x] 5.2: Implement `renderProcess(g, node)` — standard rectangle with small corner radius (`rx: 3`)
  - [x] 5.3: Implement `renderDecision(g, node)` — diamond (rotated square via SVG `<polygon>` with 4 points)
  - [x] 5.4: Implement `renderIO(g, node)` — parallelogram via SVG `<polygon>` (4 points with skew offset ~15px)
  - [x] 5.5: Implement `renderSubroutine(g, node)` — rectangle with inner double-border lines (two vertical lines near left/right edges)
  - [x] 5.6: Implement `renderDocument(g, node)` — rectangle top + sides, wavy bottom via SVG `<path>` with cubic bezier curve
  - [x] 5.7: Apply node fill color: use node-specific color if set, otherwise derive from palette (e.g., `mix(palette.primary, palette.bg, 85)` for light fill)
  - [x] 5.8: Apply node stroke: palette border color or node color at full opacity
  - [x] 5.9: Render node label centered in shape: `<text>` with `text-anchor: middle`, `dominant-baseline: central`
  - [x] 5.10: Apply text color from palette
  - [x] 5.11: Add `data-line-number` attribute on node `<g>` wrapper for editor sync
  - [x] 5.12: Add click handler calling `onClickItem(lineNumber)` if provided

- [x] Task 6: Render edges (AC: 2, 3, 12)
  - [x] 6.1: For each `LayoutEdge`, construct SVG `<path>` from waypoints array
  - [x] 6.2: Use smooth curves between waypoints: `d3-shape`'s `line().curve(curveBasis)` or manual cubic bezier
  - [x] 6.3: Apply edge stroke color: edge-specific color if set, otherwise palette border/muted color
  - [x] 6.4: Apply `marker-end` referencing the arrowhead marker (use color-specific marker if edge has custom color)
  - [x] 6.5: Set stroke width (1.5-2px) and fill none
  - [x] 6.6: Render edge label if present: position at midpoint of edge path
  - [x] 6.7: Edge label styling: small font, background rect for legibility (palette bg with slight opacity), text color from palette
  - [x] 6.8: Add `data-line-number` attribute on edge `<g>` wrapper

- [x] Task 7: Implement viewport fitting (AC: 11)
  - [x] 7.1: Compare layout dimensions (`layout.width`, `layout.height`) with available SVG dimensions
  - [x] 7.2: If layout exceeds viewport, compute scale factor: `min(viewportWidth / layoutWidth, viewportHeight / layoutHeight)`
  - [x] 7.3: Apply `transform: scale(factor)` on main `<g>` group, with centering translation
  - [x] 7.4: Ensure minimum node size remains legible after scaling
  - [x] 7.5: For export, use layout dimensions directly (no scaling needed — SVG viewBox handles it)

- [x] Task 8: Create convenience export function (AC: 13)
  - [x] 8.1: Create `renderFlowchartForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette?: PaletteColors): string`
  - [x] 8.2: Chain: `parseFlowchart()` → `layoutGraph()` → `renderFlowchart()` → extract SVG string
  - [x] 8.3: Handle errors from parser: return empty string if `error` is set
  - [x] 8.4: Set SVG `xmlns` attribute for standalone SVG compatibility
  - [x] 8.5: Apply background color based on theme (transparent = no background)

- [x] Task 9: Export from `src/index.ts` (AC: 13)
  - [x] 9.1: Export `renderFlowchart` function and `FlowchartRenderOptions` type

- [x] Task 10: Write tests in `tests/flowchart-renderer.test.ts` (AC: 1–12)
  - [x] 10.1: Set up jsdom environment for D3 rendering (follow `cli-render.test.ts` pattern)
  - [x] 10.2: Test simple 3-node graph renders SVG with expected element count
  - [x] 10.3: Test terminal shape: verify `<rect>` with large `rx` (rounded) present
  - [x] 10.4: Test process shape: verify `<rect>` present
  - [x] 10.5: Test decision shape: verify `<polygon>` with 4 points (diamond) present
  - [x] 10.6: Test I/O shape: verify `<polygon>` (parallelogram) present
  - [x] 10.7: Test subroutine shape: verify double-border visual (inner lines or nested rects)
  - [x] 10.8: Test document shape: verify `<path>` with wavy bottom curve
  - [x] 10.9: Test edge rendering: verify `<path>` elements with `marker-end`
  - [x] 10.10: Test edge label rendering: verify `<text>` at edge midpoint
  - [x] 10.11: Test group box rendering: verify background `<rect>` and label
  - [x] 10.12: Test palette application: verify `background` style, text `fill`, node `stroke`
  - [x] 10.13: Test title rendering: verify title `<text>` element
  - [x] 10.14: Test node colors override palette defaults
  - [x] 10.15: Test edge colors override palette defaults
  - [x] 10.16: Test `data-line-number` attributes present on node and edge groups
  - [x] 10.17: Run `pnpm test` — all tests pass

- [x] Task 11: Final verification (AC: 13, 14)
  - [x] 11.1: Run `pnpm build && pnpm typecheck && pnpm test`

## Dev Notes

### Renderer Pattern

The renderer follows the same pattern as all D3 renderers in `src/d3.ts`:

```typescript
export function renderFlowchart(
  container: HTMLDivElement,
  graph: ParsedGraph,
  layout: LayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  // 1. Clear existing content
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  // 2. Compute dimensions
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  // 3. Theme colors
  const textColor = palette.text;
  const bgColor = palette.bg;

  // 4. Create SVG
  const svg = d3Selection.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('background', bgColor)
    .style('font-family', FONT_FAMILY);

  // 5. Define arrowhead markers in <defs>
  // 6. Render groups (background layer)
  // 7. Render edges (middle layer)
  // 8. Render nodes (top layer)
  // 9. Render title
}
```

### Shape SVG Geometry

**Terminal (stadium):**
```svg
<rect x="..." y="..." width="..." height="..." rx="25" ry="25" />
```
`rx = height / 2` for full stadium shape.

**Process (rectangle):**
```svg
<rect x="..." y="..." width="..." height="..." rx="3" ry="3" />
```

**Decision (diamond):**
```svg
<polygon points="cx,top topRight,cy cx,bottom bottomLeft,cy" />
```
4 points forming a diamond. Center at `(node.x, node.y)`, with points at top/right/bottom/left.

**I/O (parallelogram):**
```svg
<polygon points="left+skew,top right+skew,top right-skew,bottom left-skew,bottom" />
```
Skew offset ~15px.

**Subroutine (double-bordered):**
```svg
<rect ... />  <!-- outer rectangle -->
<line x1="left+8" y1="top" x2="left+8" y2="bottom" />  <!-- left inner border -->
<line x1="right-8" y1="top" x2="right-8" y2="bottom" /> <!-- right inner border -->
```

**Document (wavy bottom):**
```svg
<path d="M left,top L right,top L right,bottom-10 C ... wavy bezier ... L left,bottom-10 Z" />
```
Top and sides are straight lines; bottom is a sine-wave-like cubic bezier curve.

### Node Fill Strategy

Nodes need visible fill to be readable. Strategy:
- **Default fill:** Very light tint of palette primary — `mix(palette.primary, palette.bg, 85)` (85% background)
- **Custom color fill:** Light tint of the custom color — `mix(nodeColor, palette.bg, 75)`
- **Stroke:** Palette border color (default) or custom color at full strength
- **Text:** Always palette text color for legibility

### Edge Path Construction

Dagre provides waypoints as `{x, y}[]`. Convert to SVG path:

```typescript
import * as d3Shape from 'd3-shape';

const lineGenerator = d3Shape.line<{x: number; y: number}>()
  .x(d => d.x)
  .y(d => d.y)
  .curve(d3Shape.curveBasis); // smooth curves

const pathD = lineGenerator(edge.points);
```

### Edge Label Positioning

Place label at the midpoint of the edge path:

```typescript
const midIdx = Math.floor(points.length / 2);
const labelX = points[midIdx].x;
const labelY = points[midIdx].y;
```

Add a small background rect behind the label text for legibility.

### resvg Constraints

- **No CSS `color-mix()`** — use `mix()` from `src/palettes/color-utils.ts` for pre-computed hex colors
- **No external fonts** — `FONT_FAMILY` ('Helvetica') is a system font, works in resvg
- **No CSS variables** — all styles must be inline
- **SVG must be self-contained** — no external references

### Codebase Patterns

- **D3 selection for SVG:** `d3Selection.select(container).append('svg')...`
- **Export dimensions:** `D3ExportDimensions` type from `src/d3.ts` — `{ width: number; height: number }`
- **Tooltip preservation:** `.selectAll(':not([data-d3-tooltip])').remove()` — preserve tooltips during re-renders
- **Line number tracking:** `data-line-number` attribute on interactive `<g>` elements
- **Click handlers:** `onClickItem?.(node.lineNumber)` on node click
- **File location:** `src/graph/flowchart-renderer.ts`
- **Test file:** `tests/flowchart-renderer.test.ts`

### D3 Imports Needed

```typescript
import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import { getSeriesColors } from '../palettes';
import { mix } from '../palettes/color-utils';
```

### References

- [Source: docs/epics/epic-48.structural-diagrams-flowchart.md#Story 48.4]
- [Source: src/d3.ts — renderArcDiagram, renderSlopeChart, renderD3ForExport patterns]
- [Source: src/sequence/renderer.ts — complex SVG rendering, data attributes, mix() usage]
- [Source: src/palettes/types.ts — PaletteColors interface]
- [Source: src/palettes/color-utils.ts — mix() function]
- [Source: src/fonts.ts — FONT_FAMILY constant]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

No significant issues. One test adjustment needed: jsdom normalizes hex colors to rgb format in `.style.background`, so palette background verification uses RGB channel value check instead of exact hex match.

### Completion Notes List

- Created `src/graph/flowchart-renderer.ts` with `renderFlowchart()` and `renderFlowchartForExport()` functions
- All 6 shape types render with correct SVG geometry:
  - Terminal: stadium shape (rounded rect, `rx = height/2`)
  - Process: rectangle with small corner radius (`rx: 3`)
  - Decision: diamond (`<polygon>` with 4 points)
  - I/O: parallelogram (`<polygon>` with 15px skew)
  - Subroutine: rectangle with inner double-border lines (left + right `<line>`)
  - Document: `<path>` with straight top/sides and wavy bottom (cubic bezier)
- Edges rendered as smooth curves via `d3-shape` `curveBasis` line generator
- Edge labels positioned at midpoint with background rect for legibility
- Arrowhead markers defined in `<defs>` — default marker + per-color custom markers for colored edges
- Group boxes rendered as background `<rect>` with label text, behind all nodes/edges
- Title rendered above diagram when `graph.title` is set
- Palette theming applied: background, text fills, node fills (mixed with palette), strokes
- Node/edge colors override palette defaults when specified
- `data-line-number` attributes on node and edge `<g>` wrappers for editor sync
- Click handler support via `onClickItem` callback
- Viewport fitting: scales diagram to fit container while maintaining legibility
- `renderFlowchartForExport()` convenience function: chains parse → layout → render → extract SVG string
- resvg-compatible: all inline styles, no CSS variables, no color-mix(), system font (Helvetica fallback)
- Created `tests/flowchart-renderer.test.ts` with 21 tests covering all ACs
- Exported `renderFlowchart` and `renderFlowchartForExport` from `src/index.ts`
- `pnpm build` — clean
- `pnpm typecheck` — clean
- `pnpm test` — 256 tests pass, 0 regressions

### File List

- `src/graph/flowchart-renderer.ts` — NEW — Flowchart SVG renderer + export convenience function
- `src/index.ts` — MODIFIED — added renderFlowchart/renderFlowchartForExport exports
- `tests/flowchart-renderer.test.ts` — NEW — 21 renderer tests

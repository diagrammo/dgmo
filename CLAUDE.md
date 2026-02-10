# dgmo — @diagrammo/dgmo

Core library and CLI for the DGMO diagram markup language. Handles parsing, rendering, and color/palette system. Published to npm as `@diagrammo/dgmo`.

## Commands

```bash
pnpm build            # tsup (ESM + CJS, lib + CLI)
pnpm dev              # tsup --watch
pnpm test             # Vitest (run once)
pnpm test:watch       # Vitest (watch mode)
pnpm typecheck        # tsc --noEmit
```

**Quick CLI testing:** `./test-cli.sh input.dgmo [args...]` — builds and runs in one step.

## CLI Usage

```bash
dgmo diagram.dgmo                              # PNG output (default)
dgmo diagram.dgmo -o output.svg                # SVG (format from extension)
dgmo diagram.dgmo --theme dark --palette catppuccin
```

Entry point: `src/cli.ts` → built to `dist/cli.cjs`.

## Project Structure

```
src/
├── index.ts                    # Public API exports
├── cli.ts                      # CLI entry point
├── chart.ts                    # Chart type routing
├── dgmo-router.ts              # Framework dispatcher (sequence, D3, ECharts)
├── dgmo-mermaid.ts             # Mermaid quadrant parser/builder
├── fonts.ts                    # FONT_FAMILY, DEFAULT_FONT_NAME ('Helvetica')
├── colors.ts                   # Color utilities
├── d3.ts                       # D3 renderers (slope, arc, timeline, wordcloud, venn, quadrant)
├── echarts.ts                  # ECharts parser and renderer
├── sequence/
│   ├── parser.ts               # Sequence diagram parser
│   ├── renderer.ts             # SVG renderer (D3-based)
│   └── participant-inference.ts
└── palettes/
    ├── index.ts                # Registry + exports
    ├── types.ts                # PaletteConfig, PaletteColors
    ├── color-utils.ts          # HSL conversions, color mixing
    ├── mermaid-bridge.ts       # Mermaid theme builder
    ├── registry.ts             # Palette registry
    └── [palette].ts            # nord, solarized, catppuccin, rose-pine, gruvbox, tokyo-night, one-dark, bold
```

## Architecture

### Diagram Routing

`dgmo-router.ts` dispatches based on content:
- Sequence diagrams → `sequence/parser.ts` + `sequence/renderer.ts`
- D3 chart types (slope, arc, timeline, wordcloud, venn, quadrant) → `d3.ts`
- ECharts chart types (sankey, chord, scatter, heatmap, etc.) → `echarts.ts`
- Mermaid-backed types → `dgmo-mermaid.ts`

### Sequence Parser

Processes lines top-to-bottom. Key ordering constraint: section matching happens BEFORE indent-based block closing. If adding new element types matched before block closing, they'll get pushed into the wrong container if a block is open. Always close blocks first (check `blockStack`) before pushing to `currentContainer()`.

`ParsedSequenceDgmo` has an `options` field (`Record<string, string>`) for diagram-level options like `activations: off`. When adding function-level `options` parameters, rename to avoid shadowing.

### Sequence Renderer

SVG renderer using D3. Key concepts:
- Section Y positions are computed from cumulative content above — not anchored to messages below
- Collapsible sections use `data-section-toggle` attribute on wrapper `<g>` elements
- Only the `<g>` wrapper carries `data-line-number`/`data-section` — children must NOT have them
- Unlabeled return arrows are filtered out to reduce vertical noise

### Color System

8 palettes, each with light/dark/transparent themes. `color-utils.ts` provides HSL conversion and a `mix()` helper for blending colors.

## Constraints

- **resvg does NOT support CSS `color-mix()`** — use the `mix()` helper in `color-utils.ts` instead (pre-computes hex colors)
- **resvg PNG background:** pass `paletteColors.bg` as `background` option for light/dark themes; omit for transparent
- **Font standardization:** `fonts.ts` exports `FONT_FAMILY` and `DEFAULT_FONT_NAME` ('Helvetica'). All renderers import `FONT_FAMILY`. resvg configured with Helvetica as system font (no bundling needed).

## Build Output

tsup produces dual ESM/CJS:
- `dist/index.js` + `dist/index.d.ts` (ESM)
- `dist/index.cjs` + `dist/index.d.cts` (CJS)
- `dist/cli.cjs` (CLI binary)

## Testing

- **Framework:** Vitest with jsdom environment
- **Tests:** `tests/cli-render.test.ts`, `tests/chart-echarts.test.ts`, `tests/echarts-ssr.test.ts`

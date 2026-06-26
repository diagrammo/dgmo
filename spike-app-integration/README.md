# App integration — D3 data-chart preview (spike)

Wires the hand-built D3 chart engine into the desktop app's live preview as a
**flag-gated, default-off** alternative to `EChartsPreview`. Zero behavior change
until the flag is on.

## What's already done (dgmo, spike branch `spike/d3-data-charts`)

- `render(content, { engine: 'd3' })` — routes the 15 data-chart types through
  the hand-built renderers; unsupported → ECharts fallback.
- `mountD3DataChart(container, content, opts)` — framework-agnostic controller
  (render → inject SVG → attach interactions → `update()` / `destroy()`).
  **Unit-tested**: `tests/charts-d3-mount.test.ts` (4/4).
- `attachDataChartInteractions(svg, opts)` — crosshair + hover-emphasis +
  click-to-line, all families.
- All exported from `@diagrammo/dgmo`.

## Prerequisite (one step, not yet done — needs your call)

The app's `packages/dgmo` symlink points at the **main** dgmo checkout. For the
app to import `mountD3DataChart`, the spike branch must land in dgmo and be built:

```bash
# in dgmo/ (after reviewing/merging spike/d3-data-charts)
pnpm --filter @diagrammo/dgmo build
```

The dgmo changes are additive + opt-in + default-off + fully tested (815 + 4),
with no change to the default ECharts path — a low-risk merge.

## App changes (2 files)

1. Copy `D3ChartPreview.tsx` → `src/features/preview/components/`.

2. Patch `src/features/preview/components/DgmoPreview.tsx` — the
   `category === 'data-chart'` branch (currently ~line 115):

```tsx
const D3ChartPreview = lazy(() =>
  import('./D3ChartPreview').then((m) => ({ default: m.D3ChartPreview }))
);
// ...
if (category === 'data-chart') {
  // DGMO_ is the app's Vite env prefix; or read a preferences-store toggle.
  const useD3 = import.meta.env.DGMO_D3_CHARTS === '1';
  const ChartPreview = useD3 ? D3ChartPreview : EChartsPreview;
  return (
    <Suspense fallback={null}>
      <ChartPreview
        content={content}
        isDark={isDark}
        filePath={filePath}
        {...(onNavigateToLine !== undefined && { onNavigateToLine })}
        {...(currentLine !== undefined && { currentLine })}
      />
    </Suspense>
  );
}
```

## Run it

```bash
DGMO_D3_CHARTS=1 pnpm tauri dev   # D3 engine
pnpm tauri dev                    # ECharts (default, unchanged)
```

## Not yet ported (tracked, out of spike scope)

- **Export**: PNG works via the app's existing `renderedSvgString` →
  `svgStringToPngBlob` fallback (D3 emits a static SVG). The interactive-HTML
  export (serializes ECharts `getOption`) has no D3 equivalent yet.
- **Cursor→chart highlight** (`useEChartsCursorHighlight`, editor cursor drives
  chart emphasis): the reverse direction. The markup (`data-line-number`) is
  present; a small effect can map current line → `.dgmo-emph` like the generic
  diagram adapters do.
- **Scatter greedy-label collision** (spike uses simple above-point labels).
- **Presentation-nav** `data-navigable-lines` attribute.

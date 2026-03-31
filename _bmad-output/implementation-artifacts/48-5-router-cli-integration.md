# Story 48.5: Router + CLI Integration

Status: review

## Story

As a developer building structural diagram support for dgmo,
I want `chart: flowchart` in a `.dgmo` file to route through the dgmo pipeline and render to PNG/SVG via the CLI,
so that users can create flowcharts using the same workflow as all other dgmo chart types.

## Acceptance Criteria

1. `chart: flowchart` routes to D3 framework in `getDgmoFramework()`
2. CLI renders flowchart `.dgmo` files to PNG (default output)
3. CLI renders flowchart `.dgmo` files to SVG (via `-o output.svg`)
4. Theme and palette flags work: `--theme dark --palette catppuccin`
5. No regression on existing 22 chart types
6. `pnpm build && pnpm typecheck` passes
7. Flowchart export uses correct dimensions (same as other D3 types)
8. Error handling: parser errors surface as empty output (not crashes)

## Tasks / Subtasks

- [x] Task 1: Add flowchart to chart type map in `src/dgmo-router.ts` (AC: 1)
  - [x] 1.1: Add `flowchart: 'd3'` entry to `DGMO_CHART_TYPE_MAP`
  - [x] 1.2: Update chart type count in any comments or documentation that reference the total (22 → 23)

- [x] Task 2: Wire flowchart into `renderD3ForExport` in `src/d3.ts` (AC: 2, 3, 4, 7, 8)
  - [x] 2.1: Add `'flowchart'` to the `D3ChartType` union type (or handle it separately if not a D3 type)
  - [x] 2.2: In `renderD3ForExport()`, add a branch for flowchart chart type:
    ```
    if (chartType === 'flowchart') {
      const parsed = parseFlowchart(content, effectivePalette);
      if (parsed.error) return '';
      const layout = layoutGraph(parsed);
      renderFlowchart(container, parsed, layout, effectivePalette, isDark, undefined, dims);
    }
    ```
  - [x] 2.3: Import `parseFlowchart` from `./graph/flowchart-parser`
  - [x] 2.4: Import `layoutGraph` from `./graph/layout`
  - [x] 2.5: Import `renderFlowchart` from `./graph/flowchart-renderer`
  - [x] 2.6: Ensure flowchart branch runs before the generic D3 parsing fallback
  - [x] 2.7: Handle case where `parseD3()` encounters flowchart content — it should not error or interfere

- [x] Task 3: Verify CLI routing works end-to-end (AC: 2, 3, 4)
  - [x] 3.1: Verify `parseDgmoChartType()` correctly extracts `flowchart` from `chart: flowchart` header
  - [x] 3.2: Verify `getDgmoFramework('flowchart')` returns `'d3'`
  - [x] 3.3: Verify CLI renders a flowchart `.dgmo` to PNG (test with `./test-cli.sh`)
  - [x] 3.4: Verify CLI renders a flowchart `.dgmo` to SVG with `-o output.svg`
  - [x] 3.5: Verify `--theme dark`, `--theme transparent`, `--palette catppuccin` flags work

- [x] Task 4: Handle flowchart detection without explicit chart header (AC: 1)
  - [x] 4.1: Consider adding `looksLikeFlowchart()` check in `parseDgmoChartType()` as a fallback (similar to `looksLikeSequence()`)
  - [x] 4.2: If implemented, ensure it doesn't conflict with sequence detection — sequence takes priority since it's older
  - [x] 4.3: Optional: may defer auto-detection to a later story and require explicit `chart: flowchart`

- [x] Task 5: Update public API exports in `src/index.ts` (AC: 6)
  - [x] 5.1: Ensure all flowchart-related exports are present (parser, renderer, layout — should already be done in stories 48.1–48.4)
  - [x] 5.2: Verify the complete export list includes graph types, layout types, parseFlowchart, renderFlowchart, layoutGraph

- [x] Task 6: Write integration tests in `tests/flowchart-integration.test.ts` (AC: 1–5, 7, 8)
  - [x] 6.1: Test `parseDgmoChartType()` returns `'flowchart'` for `chart: flowchart` content
  - [x] 6.2: Test `getDgmoFramework('flowchart')` returns `'d3'`
  - [x] 6.3: Test `renderD3ForExport()` with flowchart content produces non-empty SVG string
  - [x] 6.4: Test `renderD3ForExport()` with flowchart content and dark theme produces SVG with dark background
  - [x] 6.5: Test `renderD3ForExport()` with flowchart content and transparent theme produces SVG without background
  - [x] 6.6: Test `renderD3ForExport()` with malformed flowchart content returns empty string (not crash)
  - [x] 6.7: Test that all existing chart types still route correctly (regression guard)
  - [x] 6.8: Run `pnpm test` — all tests pass (including existing tests)

- [x] Task 7: Final verification (AC: 5, 6)
  - [x] 7.1: Run `pnpm build && pnpm typecheck && pnpm test`
  - [x] 7.2: Manually test with `./test-cli.sh` using a sample flowchart file
  - [x] 7.3: Verify existing chart types render correctly (spot-check 3-4 types)

## Dev Notes

### Router Integration Point

The router in `src/dgmo-router.ts` uses a simple lookup map:

```typescript
export const DGMO_CHART_TYPE_MAP: Record<string, DgmoFramework> = {
  // ... existing 22 entries ...
  flowchart: 'd3',  // ← add this
};
```

`parseDgmoChartType(content)` already handles extracting `chart: flowchart` — no changes needed in that function.

### renderD3ForExport Integration

The key integration point is `renderD3ForExport()` in `src/d3.ts`. Currently it:
1. Parses content with `parseD3()` to get chart type
2. Falls back to sequence detection
3. Dispatches to specific renderer based on `parsed.type`

For flowchart, insert BEFORE the `parseD3()` call since flowcharts don't use the D3 parser:

```typescript
export async function renderD3ForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette?: PaletteColors
): Promise<string> {
  const effectivePalette = palette ?? getPalette('nord')[theme === 'dark' ? 'dark' : 'light'];
  const isDark = theme === 'dark';

  // Check for flowchart BEFORE parsing as D3
  const chartType = parseDgmoChartType(content);
  if (chartType === 'flowchart') {
    const { parseFlowchart } = await import('./graph/flowchart-parser');
    const { layoutGraph } = await import('./graph/layout');
    const { renderFlowchart } = await import('./graph/flowchart-renderer');

    const parsed = parseFlowchart(content, effectivePalette);
    if (parsed.error) return '';

    const layout = layoutGraph(parsed);
    // ... create container, render, extract SVG
  }

  // Existing D3/sequence parsing below...
}
```

Using dynamic `import()` keeps the flowchart code lazy-loaded, matching the pattern used for sequence diagrams.

### CLI Flow (No Changes Needed)

The CLI in `src/cli.ts` already routes based on `getDgmoFramework()`:

```typescript
if (framework === 'd3' || framework === null) {
  setupDom();
  svg = await renderD3ForExport(content, opts.theme, paletteColors);
}
```

Since `flowchart: 'd3'` routes to the D3 framework, the CLI will automatically call `renderD3ForExport()` which handles the dispatch internally. **No changes to `cli.ts` needed.**

### parseDgmoChartType — Already Works

The existing `parseDgmoChartType()` function extracts any `chart: <type>` value and returns it lowercase. It will return `'flowchart'` for `chart: flowchart` without any modifications.

### Auto-Detection Consideration

Currently `looksLikeSequence()` is checked as a fallback when no explicit `chart:` header is found. A similar `looksLikeFlowchart()` could be added, but this risks false positives since both flowcharts and sequence diagrams use `->` arrows. Recommendation: **require explicit `chart: flowchart`** for the initial release; auto-detection can be added later with careful disambiguation.

### Existing Test Patterns

Integration tests follow `tests/cli-render.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseDgmoChartType, getDgmoFramework } from '../src/dgmo-router';

describe('flowchart routing', () => {
  it('parseDgmoChartType returns flowchart', () => {
    expect(parseDgmoChartType('chart: flowchart\n(Start) -> (End)')).toBe('flowchart');
  });

  it('getDgmoFramework returns d3', () => {
    expect(getDgmoFramework('flowchart')).toBe('d3');
  });
});
```

### Regression Guard

The most important aspect of this story is **no regression on existing types**. The test should verify that adding flowchart doesn't break any existing routing:

```typescript
it('existing chart types still route correctly', () => {
  expect(getDgmoFramework('bar')).toBe('echart');
  expect(getDgmoFramework('sequence')).toBe('d3');
  expect(getDgmoFramework('sankey')).toBe('echart');
  // ... spot-check representative types
});
```

### References

- [Source: docs/epics/epic-48.structural-diagrams-flowchart.md#Story 48.5]
- [Source: src/dgmo-router.ts — DGMO_CHART_TYPE_MAP, parseDgmoChartType, getDgmoFramework]
- [Source: src/d3.ts — renderD3ForExport dispatcher]
- [Source: src/cli.ts — CLI entry point routing]
- [Source: src/index.ts — public API exports]
- [Source: tests/cli-render.test.ts — integration test patterns]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Auto-detection: `looksLikeSequence()` fires before `looksLikeFlowchart()` for content with `->` arrows since both use `->`. Sequence takes priority per design. Flowchart auto-detection only triggers for content that has shape delimiters near arrows AND doesn't match sequence's `ARROW_PATTERN` first. In practice, explicit `chart: flowchart` is recommended for reliable routing.

### Completion Notes List

- Added `flowchart: 'd3'` to `DGMO_CHART_TYPE_MAP` in `src/dgmo-router.ts` (23 chart types total)
- Added `looksLikeFlowchart()` import and fallback detection in `parseDgmoChartType()` (after sequence, which takes priority)
- Wired flowchart into `renderD3ForExport()` in `src/d3.ts` — intercepts `chart: flowchart` BEFORE `parseD3()` call, uses dynamic imports for lazy loading
- Flowchart export pipeline: `parseFlowchart()` → `layoutGraph()` → `renderFlowchart()` → extract SVG
- Error handling: parser errors return empty string (no crashes)
- Theme support: light, dark, transparent all work
- No changes needed in `src/cli.ts` — CLI routes via `getDgmoFramework('flowchart') → 'd3'` automatically
- All existing exports already present from stories 48.1–48.4
- Updated README chart type count: 22 → 23
- Added flowchart to D3_INPUTS and D3_TYPES in `tests/cli-render.test.ts`
- Created `tests/flowchart-integration.test.ts` with 12 tests: routing, detection, export, regression guards
- `pnpm build` — clean
- `pnpm typecheck` — clean
- `pnpm test` — 270 tests pass, 0 regressions

### File List

- `src/dgmo-router.ts` — MODIFIED — added flowchart to chart type map + auto-detection
- `src/d3.ts` — MODIFIED — added flowchart branch in renderD3ForExport
- `README.md` — MODIFIED — chart type count 22 → 23
- `tests/cli-render.test.ts` — MODIFIED — added flowchart to D3 test inputs
- `tests/flowchart-integration.test.ts` — NEW — 12 integration tests

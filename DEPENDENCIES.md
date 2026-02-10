# @diagrammo/dgmo — Dependency Strategy

## Principle

**Bundle everything.** `npm install @diagrammo/dgmo` should be all a consumer needs. No peer dependencies, no extra installs, no dependency management. This follows the pattern used by [Recharts](https://www.npmjs.com/package/recharts), [Nivo](https://www.npmjs.com/package/@nivo/core), and other self-contained charting libraries.

Tree-shaking via `"sideEffects": false` ensures consumers only pay for what they use — importing only `parseD3` won't pull in echarts.

## Summary

| Package                     | Category | Strategy       | Rationale                                         |
| --------------------------- | -------- | -------------- | ------------------------------------------------- |
| `d3-scale`                  | Runtime  | **dependency** | D3 renderer implementation detail                 |
| `d3-selection`              | Runtime  | **dependency** | D3 + sequence renderer implementation detail      |
| `d3-shape`                  | Runtime  | **dependency** | D3 renderer implementation detail                 |
| `d3-array`                  | Runtime  | **dependency** | D3 renderer implementation detail                 |
| `d3-cloud`                  | Runtime  | **dependency** | Wordcloud renderer implementation detail          |
| `echarts`                   | Runtime  | **dependency** | Option builder types + consumer rendering runtime |

## `package.json`

```json
{
  "sideEffects": false,
  "dependencies": {
    "d3-array": "^3.2.4",
    "d3-cloud": "^1.2.7",
    "d3-scale": "^4.0.2",
    "d3-selection": "^3.0.0",
    "d3-shape": "^3.2.0",
    "echarts": "^5.6.0"
  },
  "devDependencies": {
    "@types/d3-array": "^3.2.1",
    "@types/d3-cloud": "^1.2.9",
    "@types/d3-scale": "^4.0.8",
    "@types/d3-selection": "^3.0.11",
    "@types/d3-shape": "^3.1.7",
    "typescript": "^5.7.3"
  }
}
```

---

## Detailed Analysis

### D3 Modules → bundled

**Imports**: `import * as d3Scale from 'd3-scale'` (runtime value imports)

**Files**: `d3.ts`, `sequence/renderer.ts`

These are small (~15KB gzipped total), pure-function modules with no global state. They're internal implementation details — consumers never interact with d3 directly. This is the standard approach (Recharts, Nivo both bundle d3 modules as regular dependencies).

### echarts → bundled

**Import**: `import type { EChartsOption } from 'echarts'` (currently type-only in library)

**File**: `echarts.ts`

echarts (~1MB minified, ~300KB gzipped) is the largest dependency. Bundling it means zero friction for consumers. Tree-shaking ensures it's only included when ECharts chart types are actually used.

---

## Consumer Experience

### Obsidian plugin author

```bash
npm install @diagrammo/dgmo
```

That's it. Their esbuild config bundles everything. They import what they need:

```ts
import { parseD3, renderSlopeChart, getPalette } from '@diagrammo/dgmo';
```

If they only use D3 charts, echarts is tree-shaken away.

### React app developer

```bash
npm install @diagrammo/dgmo
```

Same experience.

### Node.js / SSR

```bash
npm install @diagrammo/dgmo
```

Parsers work in any environment. Renderers that produce SVG strings (`renderD3ForExport`) work with jsdom. DOM-based renderers need a browser environment.

---

## Trade-offs

### Install size

Adding echarts as a dependency increases `node_modules` by ~1.5MB. This is a one-time install cost and is standard for charting libraries. The alternative (peer deps) trades install size for developer friction — a bad trade for a library meant to be easy to use.

### Bundle size

With `"sideEffects": false`, modern bundlers (esbuild, rollup, webpack) tree-shake unused code paths:

| Consumer imports only...                                         | echarts included? |
| ---------------------------------------------------------------- | ----------------- |
| D3 charts (`parseD3`, `renderSlopeChart`)                        | No                |
| Sequence diagrams (`parseSequenceDgmo`, `renderSequenceDiagram`) | No                |
| ECharts charts (`parseEChart`, `buildEChartsOption`)             | Yes               |
| Everything                                                       | Yes               |

### Why not peer deps?

Peer deps are for frameworks the consumer already has (React, Angular). echarts is an implementation detail of specific chart types — the consumer shouldn't need to know or care which rendering library is used under the hood. Bundling follows the same pattern as Recharts (bundles d3 + victory-vendor) and Nivo (bundles d3 modules).

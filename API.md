# @diagrammo/dgmo — Public API

This is the frozen, stable surface (root entry). Everything else is reachable
via `@diagrammo/dgmo/advanced` (the permanent **no-semver** firehose — use at
your own risk; it may change in any release) or via the stable subpaths:
`@diagrammo/dgmo/editor`, `/highlight`, `/auto`. The legacy `/internal` alias
was removed at 1.0 — use `/advanced`.

```bash
npm install @diagrammo/dgmo
```

## Quickstart

```ts
import { render } from '@diagrammo/dgmo';

const { svg } = await render(`pie Languages
TypeScript 45
Python 30
Rust 25`);

document.getElementById('chart').innerHTML = svg;
```

Three lines. Defaults to Slate palette, light theme. Renders an inline error
SVG on bad input so the user sees what's wrong without you writing
fallback UI.

## API Reference

### `render(text, options?)`

Render DGMO source to SVG.

```ts
function render(
  text: string,
  options?: {
    theme?: Theme;           // 'light' | 'dark' | 'transparent'  (default 'light')
    palette?: PaletteConfig; // see `palettes` namespace          (default palettes.slate)
    onError?: 'svg' | 'silent' | 'throw'; // (default 'svg')
  }
): Promise<{ svg: string; diagnostics: DgmoError[] }>;
```

**`onError` modes:**
- `'svg'` (default) — on parse errors, render an inline error SVG listing the
  first few diagnostics. The user sees what's broken without your code
  inspecting `diagnostics`.
- `'silent'` — return empty `svg` plus the diagnostics. Caller handles UI.
- `'throw'` — throw an `Error` carrying the formatted diagnostics.

```ts
import { render, palettes, themes } from '@diagrammo/dgmo';

const { svg } = await render(text, {
  palette: palettes.catppuccin,
  theme: themes.dark,
});
```

### `validate(text)`

Fast-path syntax check without rendering. Use in editor diagnostics, lint
hooks, or anywhere you need to know "is this valid DGMO?" without paying
for layout + SVG generation.

```ts
function validate(text: string): {
  chartType: string | null;
  diagnostics: DgmoError[];
};
```

### `formatDgmoError(err)`

Format a `DgmoError` into a display string (`"Line N: message"`).

```ts
function formatDgmoError(err: DgmoError): string;
```

### `encodeDiagramUrl(text, options?)`

Compress DGMO source into a shareable URL. Returns `null` if the
compressed payload exceeds the 8 KB URL limit.

```ts
function encodeDiagramUrl(
  text: string,
  options?: {
    baseUrl?: string;        // default: 'https://online.diagrammo.app'
    palette?: PaletteConfig;
    theme?: Theme;
    filename?: string;
  }
): string | null;
```

```ts
import { encodeDiagramUrl, palettes } from '@diagrammo/dgmo';

const url = encodeDiagramUrl(text, { palette: palettes.tokyoNight });
if (!url) console.warn('Diagram too long to share');
```

### `decodeDiagramUrl(url)`

Decode a share URL back to DGMO source plus optional palette/theme. Returns
`null` if the URL has no valid DGMO payload.

```ts
function decodeDiagramUrl(url: string): {
  text: string;
  palette?: PaletteConfig;
  theme?: Theme;
  filename?: string;
} | null;
```

```ts
const decoded = decodeDiagramUrl(window.location.search);
if (decoded) {
  const { svg } = await render(decoded.text, {
    palette: decoded.palette,
    theme: decoded.theme,
  });
  el.innerHTML = svg;
}
```

### `palettes`

Namespace containing all 7 built-in palettes, keyed by camelCase id. Each
value is a `PaletteConfig`.

```ts
palettes.nord
palettes.atlas
palettes.blueprint
palettes.slate
palettes.tidewater
palettes.catppuccin
palettes.tokyoNight
```

Each palette's `.id` field is the canonical kebab-case string used by
share URLs and the CLI `--palette` flag (`'tokyo-night'`, `'catppuccin'`,
etc.). Use `Object.values(palettes)` to iterate.

Custom palettes are not supported on the public surface — use
`/advanced`'s `registerPalette` if you genuinely need to add one and accept
the no-semver contract.

### `themes`

Namespace for the three render modes. The underlying type is a string
literal union, so passing `'dark'` directly also works.

```ts
themes.light
themes.dark        // dark background, light text
themes.transparent // no background — for embedding in colored containers
```

### Types

```ts
type Theme = 'light' | 'dark' | 'transparent';

interface PaletteConfig {
  id: string;
  name: string;
  light: PaletteColors;
  dark: PaletteColors;
}

interface PaletteColors {
  // 10 semantic UI colors + 11 named accent colors. See palettes/types.ts
  // for the full shape.
}

type DgmoSeverity = 'error' | 'warning';

interface DgmoError {
  line: number;
  message: string;
  severity: DgmoSeverity;
}
```

### Additional stable root exports

These are also exported from the root (stable, semver-tracked):

- `resolvePaletteOrFallback(name?)` — resolve a palette by id, falling back to the default (slate). The shared resolve·fallback seam used by the wrappers.
- `getMinDimensions(text)` — minimum render dimensions for a diagram (sizing hint).
- `normalizeSvgForEmbed(svg)` / `getEmbedSvgViewBox(svg)` — prepare a rendered SVG for embedding (viewBox normalization).
- `completeMapPlaces(...)` / `completeMapRegions(...)` — dependency-injected map autocompletion (caller supplies the `Gazetteer`).
- `chartTypes` (+ `ChartTypeMeta`) — the chart-type registry (promoted to root at 1.0).
- `MapData` (type) — the map DI-asset shape, for the browser-render path (promoted to root at 1.0).

## Subpaths

### `@diagrammo/dgmo/editor` (stable)

CodeMirror 6 extension for editing DGMO with syntax highlighting,
autocomplete, and inline diagnostics. For anyone building a DGMO editor.

```ts
import { EditorView, basicSetup } from 'codemirror';
import { dgmoExtension } from '@diagrammo/dgmo/editor';

new EditorView({
  doc: 'gantt Roadmap\n...',
  extensions: [basicSetup, dgmoExtension()],
  parent: document.getElementById('editor'),
});
```

### `@diagrammo/dgmo/highlight` (stable)

Tokenizer for rendering DGMO code as styled HTML. Used for docs sites,
code blocks, and anywhere you want pre-rendered syntax highlighting.

```ts
import { highlightDgmo, NORD_ROLE_STYLES } from '@diagrammo/dgmo/highlight';

const tokens = highlightDgmo('gantt Roadmap\n...');
// Apply NORD_ROLE_STYLES to each token's role, or supply your own
// role-to-CSS mapping.
```

### `@diagrammo/dgmo/auto` (stable)

Drop-in IIFE bundle for static HTML pages. Add a single `<script>` tag and
any `.dgmo` / `.language-dgmo` element on the page auto-renders. No build
pipeline required.

```html
<script src="https://unpkg.com/@diagrammo/dgmo/dist/auto.js"></script>

<pre class="language-dgmo">
gantt Roadmap
start-date 2026-01-01
Design 45d
  -> Build 30d
</pre>
```

Configuration via `<script data-config='{...}'>` or `window.dgmo.initialize(...)`.

### `@diagrammo/dgmo/pert` (stable, narrow)

A tree-shaken entry exposing only the PERT Monte-Carlo core, for bundling into
a Web Worker without pulling the full library. Most consumers don't need it.

### `@diagrammo/dgmo/advanced` (unstable — NOT public API)

> The legacy `@diagrammo/dgmo/internal` alias for this subpath is removed at 1.0 — import from `/advanced`.


> **These exports are not part of the public API.** They will be renamed,
> removed, or behave differently in any release — including patch versions.
> There is no migration path or deprecation period.
>
> Use only if the documented public API cannot meet your needs and you accept
> this contract. Most consumers should never need to import from this path.
> If you find yourself reaching here, please open an issue describing your
> use case — we may be able to promote it to the public surface.

The subpath exposes implementation details: per-chart-type parsers
(`parseGantt`, `parseSequenceDgmo`, ...), layout engines (`layoutOrg`,
`layoutInfra`, ...), individual renderers, view-state encoding
(`CompactViewState`, rich `encodeDiagramUrl`/`decodeDiagramUrl`),
collapse/focus mutations, completion-registry constants, chart-type
scoring (`suggestChartTypes`), legend helpers, color utilities, the map
DI render + content-aware export sizing (`renderMapForExport`,
`mapExportDimensions`, `mapContentAspect`), and the sequence renderer's
internals.

## Usage patterns

### Astro / Next.js server components (SSR)

```astro
---
import { render, palettes } from '@diagrammo/dgmo';

const source = `sequence
A -hello-> B
B -reply-> A`;

const { svg } = await render(source, { palette: palettes.tokyoNight });
---

<div set:html={svg} />
```

### React server component

```tsx
import { render, palettes } from '@diagrammo/dgmo';

export async function Diagram({ text }: { text: string }) {
  const { svg } = await render(text, { palette: palettes.catppuccin });
  return <div dangerouslySetInnerHTML={{ __html: svg }} />;
}
```

### Vanilla JS

```html
<script type="module">
  import { render } from 'https://esm.sh/@diagrammo/dgmo';

  const { svg } = await render(`bar Sales
Q1 100
Q2 150
Q3 200`);

  document.getElementById('chart').innerHTML = svg;
</script>
```

### Building a palette picker

```ts
import { palettes } from '@diagrammo/dgmo';

const options = Object.values(palettes).sort((a, b) =>
  a.name.localeCompare(b.name)
);
// → [{ id: 'atlas', name: 'Atlas', ... }, { id: 'blueprint', name: 'Blueprint', ... }, ...]
```

### Custom error handling

```ts
const { svg, diagnostics } = await render(text, { onError: 'silent' });

if (diagnostics.length > 0) {
  // Your custom fallback UI
  showErrorBanner(diagnostics.map(formatDgmoError));
} else {
  el.innerHTML = svg;
}
```

## Versioning

@diagrammo/dgmo follows semver on the public root export surface and the
three stable subpaths (`/editor`, `/highlight`, `/auto`). Breaking changes
to these require a major version bump.

`@diagrammo/dgmo/advanced` does NOT follow semver. Treat it as
implementation detail.

## Language reference

For DGMO syntax (the markup language itself, separate from this JavaScript
API), see <https://diagrammo.app/docs/language-reference>.

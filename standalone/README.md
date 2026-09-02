# @diagrammo/dgmo-standalone

**Diagrams in a plain web page. One `<script>` tag, no build step.**

Write a diagram as text, get an SVG. No npm install, no bundler, no framework —
paste a script tag into a page you already have.

```html
<script src="https://cdn.jsdelivr.net/npm/@diagrammo/dgmo-standalone/dist/element.js"></script>

<dgmo-diagram palette="slate"
  >pie Crew Rations Salt Pork: 34 Hardtack: 28 Rum: 17 Limes: 21</dgmo-diagram
>
```

That is the whole install.

## Two ways in

**`element.js`** gives you a `<dgmo-diagram>` element to write in your own
markup — use it when you control the HTML.

**`auto.js`** scans the page for `<pre class="dgmo">` blocks and draws them —
use it when you _don't_ control the HTML, which is the usual case with markdown,
a CMS, or a static-site generator emitting ` ```dgmo ` fences.

```html
<script src="https://cdn.jsdelivr.net/npm/@diagrammo/dgmo-standalone/dist/auto.js"></script>

<pre class="dgmo">
bar Ship Stores

Salt Pork 34
Hardtack 28
Rum 17</pre
>
```

Load one or the other, not both — each carries a complete copy of the renderer.

Optional styling for the auto-scanner lives at `dist/auto.css`; the element
brings its own.

## Pinning a version

The examples above float to the latest release, which is fine for a demo and a
poor idea for a page you will not revisit. Pin it:

```html
<!-- replace VERSION with the number shown at the top of this npm page -->
<script src="https://cdn.jsdelivr.net/npm/@diagrammo/dgmo-standalone@VERSION/dist/element.js"></script>
```

unpkg works the same way — swap the host for `unpkg.com/`.

## What you get

50+ chart types from one text format: flowcharts, sequence diagrams,
timelines, org charts, gantt, maps, and the usual bar/line/pie family. The
renderer infers the chart type from what you wrote, so there is one syntax to
learn rather than one per chart.

Themes and palettes are attributes — `palette="slate"`, `theme="dark"`. Maps
fetch their basemaps on demand from `@diagrammo/dgmo` on the same CDN, so a page
with no map downloads no map data.

## Watching a diagram somebody showed you

If someone published a diagram at Diagrammo — _showed it on the web_ — you can
watch it from any page, and every reader gets the version its author has now:

```html
<script src="https://cdn.jsdelivr.net/npm/@diagrammo/dgmo-standalone/dist/element.js"></script>

<dgmo-diagram watch="https://online.diagrammo.app/d/dgm_7f2a91"></dgmo-diagram>
```

Paste the share link you were sent, or just the id at the end of it. The
diagram is fetched when the page loads — there is no polling, so a page left
open shows what it fetched on arrival until it is reloaded.

If your page sends a `Content-Security-Policy` header, it needs
`connect-src https://api.diagrammo.app` or the browser will block the request.
That case is not silent: the element draws a card naming the diagram and says
what went wrong, as it does when a diagram is missing or its author has stopped
showing it.

## When you want a different package

This one exists for the no-build case. Reach for a sibling instead when:

- **You are using npm and a bundler** → [`@diagrammo/dgmo`](https://www.npmjs.com/package/@diagrammo/dgmo), the library. It does not contain these two files, deliberately: they are a complete renderer twice over, and shipping them to every `npm install` meant 39% of the tarball for something no `import` could reach.
- **You are rendering markdown at build time** → [`remark-dgmo`](https://www.npmjs.com/package/remark-dgmo) and its wrappers for Astro, Docusaurus, Fumadocs, Nextra and VitePress. They draw the SVG during the build, so the reader downloads a picture and no renderer at all.
- **You want it on the command line** → [`@diagrammo/dgmo-cli`](https://www.npmjs.com/package/@diagrammo/dgmo-cli), or `brew install dgmo`.

## Links

- **Language reference and gallery** — <https://diagrammo.app>
- **Try it in the browser** — <https://online.diagrammo.app>
- **Issues** — <https://github.com/diagrammo/dgmo/issues>

MIT licensed — the full text is in `LICENSE`, in this package. Labels are drawn
in [Inter](https://rsms.me/inter/) when your page already provides it, falling
back to the system interface font; no font files are bundled.

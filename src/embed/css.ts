/**
 * Canonical stylesheet for the standard DGMO embed block (BL-114).
 *
 * Shipped two ways: `dist/block.css` (extracted at build time by
 * tsup.config.ts, same regex mechanism as auto.css) for `<link>`/import
 * consumers, and the `BLOCK_CSS` string export for embedders that inject a
 * `<style>` tag.
 *
 * Dark mode keys off `[data-theme="dark"]`. Hosts with a different signal
 * (`html.dark`, `body.theme-dark`) rewrite the selector at their build step —
 * fumadocs-dgmo/nextra-dgmo's build-css.mjs is the reference adapter.
 *
 * The `.dgmo-tok-*` role colors mirror LIGHT_ROLE_STYLES (light) and
 * NORD_ROLE_STYLES (dark) from editor/highlight-api.ts. A parity test
 * (tests/block.test.ts) guards against drift — update both when either
 * changes.
 *
 * IMPORTANT: keep this a single pure template literal — the build extracts it
 * with a regex, so no interpolation or computed values.
 */
export const BLOCK_CSS: string = `
/* @diagrammo/dgmo block — standard embed chrome.
 * Override the [data-theme="dark"] selectors if your site uses .dark or
 * another color-mode convention. */

/* === Color-mode visibility (dual-render) === */
.dgmo-dark {
  display: none;
}
[data-theme="dark"] .dgmo-light {
  display: none;
}
[data-theme="dark"] .dgmo-dark {
  display: block;
}

/* === Diagram sizing ===
 * SVGs are emitted with viewBox only (no fixed width/height). Force them to
 * fill their wrapper so light and dark variants render at identical sizes. */
.dgmo-light > svg,
.dgmo-dark > svg,
.dgmo-svg > svg {
  display: block;
  width: 100%;
  height: auto;
  max-width: 100%;
}

/* === Toolbar ===
 * The diagram is the star: the toolbar is a slim reserved row below the SVG
 * (height always in flow — no layout shift) that stays fully transparent
 * until the block is hovered or focused, or the source panel is open. It is
 * the <summary> of the source <details>, so toggling works without any JS.
 * No text labels, no disclosure triangle — three wordless icon buttons. */
.dgmo-source-wrap {
  margin: 0;
}
.dgmo-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.25em;
  min-height: 1.9em;
  padding: 0.15em 0;
  opacity: 0;
  transition: opacity 0.15s ease;
  cursor: pointer;
  list-style: none;
  user-select: none;
  color: rgba(127, 127, 127, 0.9);
}
.dgmo-toolbar::-webkit-details-marker {
  display: none;
}
/* Reveal is keyed to the diagram IMAGE (the svg wrappers), not the whole
 * figure — hovering the open code panel keeps the page quiet. The toolbar's
 * own :hover keeps it alive while the pointer travels down from the image
 * (they're adjacent, so there's no dead gap). focus-within covers keyboard
 * and touch-tap. */
.dgmo-light:hover ~ .dgmo-source-wrap > .dgmo-toolbar,
.dgmo-dark:hover ~ .dgmo-source-wrap > .dgmo-toolbar,
.dgmo-svg:hover ~ .dgmo-source-wrap > .dgmo-toolbar,
.dgmo-toolbar:hover,
.dgmo:focus-within .dgmo-toolbar {
  opacity: 1;
}
/* Touch devices have no hover: keep the icons faintly visible so the
 * affordance is discoverable at all. */
@media (hover: none) {
  .dgmo-toolbar {
    opacity: 0.5;
  }
}

.dgmo-toggle,
.dgmo-toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.9em;
  height: 1.9em;
  border-radius: 0.35em;
  background: none;
  border: 0;
  padding: 0;
  color: inherit;
  cursor: pointer;
  opacity: 0.75;
  transition:
    opacity 0.15s ease,
    background-color 0.15s ease;
}
.dgmo-toggle:hover,
.dgmo-toolbar-btn:hover {
  opacity: 1;
  background: rgba(127, 127, 127, 0.12);
}
.dgmo-toggle svg,
.dgmo-toolbar-btn svg {
  width: 1em;
  height: 1em;
}
/* Active state while the source panel is open. */
.dgmo-source-wrap[open] > .dgmo-toolbar .dgmo-toggle {
  opacity: 1;
  background: rgba(127, 127, 127, 0.15);
}
.dgmo-copy--success {
  color: #5cba7a;
  opacity: 1;
}

/* === Frame the whole block ===
 * When the source panel is open, diagram + toolbar + code get one shared
 * border so the code visibly belongs to the chart above it. The frame box
 * (border + padding) is RESERVED at all times — with the border transparent
 * while closed — so opening the panel only paints the border in. It never
 * reflows the diagram or shifts the toolbar: the SVG box and toolbar position
 * are identical open vs closed. */
.dgmo:has(> .dgmo-source-wrap) {
  border: 1px solid transparent;
  border-radius: 0.6em;
  padding: 0.75em 0.75em 0.5em;
}
.dgmo:has(> .dgmo-source-wrap[open]) {
  border-color: rgba(127, 127, 127, 0.3);
}

/* === Source panel (hidden until toggled) === */
.dgmo-source-inner {
  border-top: 1px solid rgba(127, 127, 127, 0.25);
  background: rgba(127, 127, 127, 0.06);
  overflow: hidden;
  margin: 0 -0.75em -0.5em;
  border-radius: 0 0 0.6em 0.6em;
}
.dgmo-pre {
  white-space: pre;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
  line-height: 1.5;
  margin: 0;
  padding: 1em;
}
.dgmo-code {
  display: block;
}

/* === Error card === */
.dgmo--error {
  border: 1px solid rgba(220, 80, 80, 0.5);
  border-radius: 0.5em;
  padding: 0.75em 1em;
}
.dgmo--error pre {
  white-space: pre;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
  margin: 0.5em 0 0;
}

/* === Source highlight roles ===
 * Light values mirror LIGHT_ROLE_STYLES; dark overrides mirror
 * NORD_ROLE_STYLES. Guarded by the parity test in tests/block.test.ts. */
.dgmo-tok-keyword {
  color: #3b6ea5;
  font-weight: bold;
}
.dgmo-tok-controlKeyword {
  color: #7d5ba6;
  font-weight: bold;
}
.dgmo-tok-definitionKeyword {
  color: #2f5a86;
  font-weight: bold;
}
.dgmo-tok-modifier {
  color: #7d5ba6;
}
.dgmo-tok-chartType {
  color: #b8691f;
  font-weight: bold;
}
.dgmo-tok-operator {
  color: #c0504d;
  font-weight: bold;
}
.dgmo-tok-number {
  color: #7d5ba6;
}
.dgmo-tok-comment {
  color: #677483;
  font-style: italic;
}
.dgmo-tok-heading {
  color: #b8691f;
  font-weight: bold;
}
.dgmo-tok-bracket {
  color: #5b6672;
}
.dgmo-tok-separator {
  color: #2d7268;
}
.dgmo-tok-deprecatedSyntax {
  color: #c0504d;
  text-decoration: line-through;
}
.dgmo-tok-url {
  color: #3b6ea5;
  text-decoration: underline;
}
.dgmo-tok-colorAnnotation {
  color: #b8691f;
  font-style: italic;
}
.dgmo-tok-punctuation {
  color: #677483;
}
.dgmo-tok-propertyName {
  color: #2d7268;
}
.dgmo-tok-string {
  color: #3f7a3b;
}
.dgmo-tok-noteContent {
  color: #677483;
  font-style: italic;
}

[data-theme="dark"] .dgmo-tok-keyword {
  color: #81a1c1;
  font-weight: bold;
}
[data-theme="dark"] .dgmo-tok-controlKeyword {
  color: #b48ead;
  font-weight: bold;
}
[data-theme="dark"] .dgmo-tok-definitionKeyword {
  color: #5e81ac;
  font-weight: bold;
}
[data-theme="dark"] .dgmo-tok-modifier {
  color: #b48ead;
}
[data-theme="dark"] .dgmo-tok-chartType {
  color: #d08770;
  font-weight: bold;
}
[data-theme="dark"] .dgmo-tok-operator {
  color: #bf616a;
  font-weight: bold;
}
[data-theme="dark"] .dgmo-tok-number {
  color: #b48ead;
}
[data-theme="dark"] .dgmo-tok-comment {
  color: #616e88;
  font-style: italic;
}
[data-theme="dark"] .dgmo-tok-heading {
  color: #d08770;
  font-weight: bold;
}
[data-theme="dark"] .dgmo-tok-bracket {
  color: #5e81ac;
}
[data-theme="dark"] .dgmo-tok-separator {
  color: #88c0d0;
}
[data-theme="dark"] .dgmo-tok-deprecatedSyntax {
  color: #bf616a;
  text-decoration: line-through;
}
[data-theme="dark"] .dgmo-tok-url {
  color: #88c0d0;
  text-decoration: underline;
}
[data-theme="dark"] .dgmo-tok-colorAnnotation {
  color: #d08770;
  font-style: italic;
}
[data-theme="dark"] .dgmo-tok-punctuation {
  color: #616e88;
}
[data-theme="dark"] .dgmo-tok-propertyName {
  color: #88c0d0;
}
[data-theme="dark"] .dgmo-tok-string {
  color: #a3be8c;
}
[data-theme="dark"] .dgmo-tok-noteContent {
  color: #616e88;
  font-style: italic;
}
`;

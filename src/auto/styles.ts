/**
 * Static CSS for `@diagrammo/dgmo/auto`.
 *
 * The string is a literal — no template interpolation of user-supplied
 * values. Theme/palette differences are applied via class hooks
 * (`.dgmo-theme-light`, `.dgmo-theme-dark`) on the rendered wrapper, so
 * a malicious theme name can never be smuggled into the stylesheet text.
 *
 * All selectors are prefixed `.dgmo-` to avoid collisions with embedder
 * styles. Class names are part of the SemVer-stable surface — see
 * "SemVer policy" in the README HTML section.
 */
export const CSS: string = `
/* anti-flash: hide source elements until either render swaps them out
   or the error path explicitly un-hides them */
pre.dgmo, code.language-dgmo, pre > code.language-dgmo,
.dgmo:not(svg *):not(.dgmo-rendered):not(.dgmo-rendered *) {
  visibility: hidden;
}
.dgmo-rendered, .dgmo-rendered *,
.dgmo-error-banner, .dgmo-error-banner * {
  visibility: visible !important;
}

.dgmo-rendered {
  display: block;
  position: relative;
  margin: 1em 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    Oxygen, Ubuntu, Cantarell, sans-serif;
  font-size: 14px;
  line-height: 1.4;
  color-scheme: light dark;
}
.dgmo-rendered svg {
  display: block;
  max-width: 100%;
  height: auto;
}

.dgmo-source-panel {
  margin-top: 4px;
  position: relative;
}

.dgmo-source-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  /* Visual size is small; the 28px hit area + padding still meets
     the 44 × 44 minimum touch target across most stylesheets, and
     we widen padding on coarse pointers below. */
  min-height: 28px;
  padding: 4px 6px;
  background: transparent;
  border: 0;
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-align: left;
  cursor: pointer;
  color: inherit;
  opacity: 0.45;
  border-radius: 3px;
  transition: opacity 120ms ease, background 120ms ease;
}
.dgmo-source-toggle:hover {
  opacity: 0.85;
  background: rgba(127, 127, 127, 0.08);
}
.dgmo-source-toggle:focus-visible {
  opacity: 1;
  outline: 2px solid currentColor;
  outline-offset: 1px;
}
.dgmo-source-toggle[aria-expanded="true"] {
  opacity: 0.7;
}
.dgmo-source-toggle .dgmo-chevron {
  display: inline-block;
  width: 8px;
  height: 8px;
  font-size: 8px;
  line-height: 1;
  transition: transform 150ms ease-out;
}
.dgmo-source-toggle[aria-expanded="true"] .dgmo-chevron {
  transform: rotate(90deg);
}
@media (pointer: coarse) {
  /* Larger hit area on touch devices without making the visible
     toggle bigger on the desktop. */
  .dgmo-source-toggle {
    min-height: 44px;
    padding: 12px 10px;
  }
}

.dgmo-source-body {
  overflow: hidden;
  max-height: 0;
  transition: max-height 150ms ease-out;
  position: relative;
}
.dgmo-source-body.dgmo-open {
  max-height: 60vh;
  overflow: auto;
  margin-top: 2px;
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.04);
}
.dgmo-rendered.dgmo-theme-dark .dgmo-source-body.dgmo-open {
  background: rgba(255, 255, 255, 0.03);
}
.dgmo-source-pre {
  margin: 0;
  /* Right padding leaves room for the floating action icons. */
  padding: 10px 56px 10px 14px;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre;
  overflow: auto;
  background: transparent;
  color: inherit;
}

.dgmo-source-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 2px;
  /* Inherit visibility:hidden when collapsed; pointer-events:none keeps
     them off the tab order until the panel opens. */
  pointer-events: none;
}
.dgmo-source-body.dgmo-open .dgmo-source-actions {
  pointer-events: auto;
}
.dgmo-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  background: transparent;
  color: inherit;
  border: 0;
  border-radius: 3px;
  cursor: pointer;
  text-decoration: none;
  opacity: 0.4;
  transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
}
.dgmo-btn:hover {
  opacity: 1;
  background: rgba(127, 127, 127, 0.15);
}
.dgmo-btn:focus-visible {
  opacity: 1;
  outline: 2px solid currentColor;
  outline-offset: 1px;
}
.dgmo-btn[aria-disabled="true"] {
  opacity: 0.25;
  cursor: not-allowed;
}
.dgmo-btn[aria-disabled="true"]:hover {
  background: transparent;
}
.dgmo-btn-copied {
  opacity: 1 !important;
  color: rgb(120, 200, 120);
}
.dgmo-btn svg {
  width: 14px;
  height: 14px;
  display: block;
}

.dgmo-error-banner {
  display: block;
  margin: 0.5em 0;
  padding: 10px 14px;
  border-left: 4px solid #c44;
  background: rgba(204, 68, 68, 0.08);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color: inherit;
  border-radius: 0 4px 4px 0;
}
.dgmo-error-banner-title {
  font-weight: 600;
  margin-bottom: 2px;
}
.dgmo-error-banner-loc {
  opacity: 0.7;
  font-size: 12px;
  font-family: ui-monospace, monospace;
}

/* Token roles — fallback colors used when theme classes don't override */
.dgmo-source-pre .dgmo-tok-keyword { color: #5e81ac; font-weight: 600; }
.dgmo-source-pre .dgmo-tok-controlKeyword { color: #b48ead; font-weight: 600; }
.dgmo-source-pre .dgmo-tok-definitionKeyword { color: #5e81ac; font-weight: 600; }
.dgmo-source-pre .dgmo-tok-modifier { color: #b48ead; }
.dgmo-source-pre .dgmo-tok-chartType { color: #d08770; font-weight: 600; }
.dgmo-source-pre .dgmo-tok-operator { color: #bf616a; font-weight: 600; }
.dgmo-source-pre .dgmo-tok-number { color: #b48ead; }
.dgmo-source-pre .dgmo-tok-comment { color: #6c7a96; font-style: italic; }
.dgmo-source-pre .dgmo-tok-heading { color: #d08770; font-weight: 600; }
.dgmo-source-pre .dgmo-tok-bracket { color: #5e81ac; }
.dgmo-source-pre .dgmo-tok-separator { color: #88c0d0; }
.dgmo-source-pre .dgmo-tok-url { color: #88c0d0; text-decoration: underline; }
.dgmo-source-pre .dgmo-tok-colorAnnotation { color: #d08770; font-style: italic; }
.dgmo-source-pre .dgmo-tok-punctuation { color: #6c7a96; }
.dgmo-source-pre .dgmo-tok-noteContent { color: #6c7a96; font-style: italic; }

.dgmo-rendered.dgmo-theme-dark .dgmo-source-pre .dgmo-tok-keyword,
.dgmo-rendered.dgmo-theme-dark .dgmo-source-pre .dgmo-tok-definitionKeyword { color: #81a1c1; }
.dgmo-rendered.dgmo-theme-dark .dgmo-source-pre .dgmo-tok-comment,
.dgmo-rendered.dgmo-theme-dark .dgmo-source-pre .dgmo-tok-noteContent,
.dgmo-rendered.dgmo-theme-dark .dgmo-source-pre .dgmo-tok-punctuation { color: #616e88; }
`;

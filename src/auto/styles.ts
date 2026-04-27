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
  margin-top: 8px;
  border: 1px solid rgba(127, 127, 127, 0.2);
  border-radius: 6px;
  overflow: hidden;
  background: rgba(127, 127, 127, 0.04);
}
.dgmo-rendered.dgmo-theme-dark .dgmo-source-panel {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
}

.dgmo-source-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 10px 14px;
  background: transparent;
  border: 0;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: inherit;
}
.dgmo-source-toggle:hover {
  background: rgba(127, 127, 127, 0.08);
}
.dgmo-source-toggle:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: -2px;
}
.dgmo-source-toggle .dgmo-chevron {
  display: inline-block;
  width: 12px;
  height: 12px;
  transition: transform 150ms ease-out;
}
.dgmo-source-toggle[aria-expanded="true"] .dgmo-chevron {
  transform: rotate(90deg);
}

.dgmo-source-body {
  overflow: hidden;
  max-height: 0;
  transition: max-height 150ms ease-out;
}
.dgmo-source-body.dgmo-open {
  max-height: 60vh;
  overflow: auto;
}
.dgmo-source-pre {
  margin: 0;
  padding: 12px 14px;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.45;
  white-space: pre;
  overflow: auto;
  background: rgba(0, 0, 0, 0.04);
  color: inherit;
}
.dgmo-rendered.dgmo-theme-dark .dgmo-source-pre {
  background: rgba(0, 0, 0, 0.25);
}

.dgmo-source-actions {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid rgba(127, 127, 127, 0.15);
}
.dgmo-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 6px 12px;
  font: inherit;
  font-size: 13px;
  background: rgba(127, 127, 127, 0.1);
  color: inherit;
  border: 1px solid rgba(127, 127, 127, 0.2);
  border-radius: 4px;
  cursor: pointer;
  text-decoration: none;
  transition: background 150ms ease;
}
.dgmo-btn:hover {
  background: rgba(127, 127, 127, 0.2);
}
.dgmo-btn[disabled],
.dgmo-btn[aria-disabled="true"] {
  opacity: 0.55;
  cursor: not-allowed;
}
.dgmo-btn-copied {
  background: rgba(120, 200, 120, 0.25) !important;
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

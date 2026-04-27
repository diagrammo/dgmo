/**
 * `@diagrammo/dgmo/auto` — IIFE-distributed auto-renderer for static HTML.
 *
 * Drop a `<script src="…/auto.js">` on any page; on `DOMContentLoaded`
 * this module scans for `.dgmo, .language-dgmo`, runs `render()`, and
 * replaces each match with `<div class="dgmo-rendered">` containing the
 * SVG plus an optional collapsible source panel with Copy and
 * "Open in editor" actions.
 *
 * Public API: frozen `window.dgmo` and alias `window.diagrammo` with
 * `{ initialize, run, version }`. Configuration is read from the
 * bundle's own `<script data-config='{…}'>` (JSON with strict
 * allowlist) or via `dgmo.initialize(opts)` for `data-auto="false"`
 * embedders.
 */

import { render } from '../render';
import { encodeDiagramUrl } from '../sharing';
import { highlightDgmo, type HighlightToken } from '../editor/highlight-api';
import { getAvailablePalettes } from '../palettes/registry';
import '../palettes';
import { CSS } from './styles';
import { safeHref } from '../utils/safe-href';

// ============================================================
// Public API surface — locked into SemVer
// ============================================================

export interface AutoConfig {
  theme?: 'auto' | 'light' | 'dark' | 'transparent';
  palette?: string;
  showSource?: boolean;
  showEditorLink?: boolean;
}

export interface RunOptions {
  nodes?: Element[] | NodeListOf<Element>;
}

export const VERSION: string =
  // Replaced at build time by tsup's `define` if configured; otherwise stays
  // as the literal so we never crash if env wiring drifts.
  (typeof __DGMO_VERSION__ === 'string' && __DGMO_VERSION__) || 'dev';

declare const __DGMO_VERSION__: string;

const DEFAULTS: Required<AutoConfig> = {
  theme: 'auto',
  palette: 'nord',
  showSource: true,
  showEditorLink: true,
};

let activeConfig: Required<AutoConfig> = { ...DEFAULTS };

// Track wrappers so we can re-render on theme changes / re-runs.
interface TrackedWrapper {
  wrapper: HTMLDivElement;
  source: string;
  perElementShowSource: boolean | null;
}
const wrappers: Set<TrackedWrapper> = new Set();

const EDITOR_BASE_URL = 'https://online.diagrammo.app';
const SHARE_URL_LIMIT_BYTES = 8192;
const SOURCE_BYTE_CAP = 256 * 1024; // 256 KB
const ARIA_LABEL_MAX = 200;
const COPIED_INTERACTION_MS = 1200;
const LOG_PREFIX = '[dgmo:auto]';

// Bidi override + control char strip for aria-label sanitization. The
// regex contains literal U+202A–U+202E and U+2066–U+2069 codepoints
// because eslint's `security/detect-bidi-characters` only matches by
// codepoint scan — using \u escapes here would still trip it. The whole
// point of this regex is to strip those very characters from labels, so
// the warning is unavoidable and acknowledged.
// eslint-disable-next-line no-control-regex, security/detect-bidi-characters
const ARIA_STRIP_RE = /[\x00-\x1F‪-‮⁦-⁩]/g;

const STYLE_FLAG = 'dgmoAutoStyles';

// ============================================================
// Utilities
// ============================================================

function warn(...args: unknown[]): void {
  // Stable prefix so embedders can grep / route to monitoring.
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(LOG_PREFIX, ...args);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Strip script-execution surface from a freshly parsed SVG tree before it
 * lands in the live DOM. This is the safety net that lets us use
 * innerHTML for SVG insertion without trusting renderer output to be
 * fully sanitized.
 *
 * Removes:
 *   - `<script>` and `<foreignObject>` elements (script-execution carriers)
 *   - any attribute whose name starts with `on` (event handlers)
 *   - any `href` / `xlink:href` whose value fails the `safeHref`
 *     allowlist (covers `javascript:`, `data:`, etc. that bypassed the
 *     renderer-side guards)
 */
function sanitizeSvgInPlace(root: Element): void {
  // Remove <script> and <foreignObject> outright.
  const dangerous = root.querySelectorAll('script, foreignObject');
  dangerous.forEach((n) => n.remove());

  // Walk every descendant and the root itself.
  const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const node of all) {
    // Strip event-handler attributes.
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) {
        node.removeAttribute(attr.name);
      }
    }
    // Validate href / xlink:href.
    if (node.hasAttribute('href')) {
      const safe = safeHref(node.getAttribute('href'));
      if (safe === null) node.removeAttribute('href');
    }
    if (node.hasAttributeNS('http://www.w3.org/1999/xlink', 'href')) {
      const v = node.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (safeHref(v) === null) {
        node.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
      }
    }
  }
}

function paletteExists(id: string): boolean {
  try {
    return getAvailablePalettes().some((p) => p.id === id);
  } catch {
    return false;
  }
}

// ============================================================
// findScriptTag + parseConfig
// ============================================================

export function findScriptTag(): HTMLScriptElement | null {
  if (typeof document === 'undefined') return null;
  const current = document.currentScript;
  if (current && current instanceof HTMLScriptElement) return current;
  // Fallback: last <script> with src ending in auto.js / auto.min.js
  const candidates = document.querySelectorAll(
    'script[src*="auto.js"], script[src*="auto.min.js"]'
  );
  if (candidates.length === 0) return null;
  return candidates[candidates.length - 1] as HTMLScriptElement;
}

const ALLOWED_KEYS = ['theme', 'palette', 'showSource', 'showEditorLink'];
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];
const VALID_THEMES = ['auto', 'light', 'dark', 'transparent'] as const;
type ValidTheme = (typeof VALID_THEMES)[number];

function isValidTheme(value: unknown): value is ValidTheme {
  return (
    typeof value === 'string' &&
    (VALID_THEMES as readonly string[]).includes(value)
  );
}

export function parseConfig(
  raw: string | null | undefined
): Partial<AutoConfig> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    warn('data-config: invalid JSON', err);
    return {};
  }
  if (!isPlainObject(parsed)) {
    warn('data-config: not an object');
    return {};
  }

  // Reject any prototype-pollution attempt.
  for (const k of FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(parsed, k)) {
      warn('data-config: rejected (prototype-pollution key:', k, ')');
      return {};
    }
  }

  const out: Partial<AutoConfig> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!ALLOWED_KEYS.includes(key)) {
      warn('data-config: dropping unknown key', key);
      continue;
    }
    if (key === 'theme') {
      if (!isValidTheme(value)) {
        warn('data-config: rejected theme', value);
        continue;
      }
      out.theme = value;
    } else if (key === 'palette') {
      if (typeof value !== 'string' || !paletteExists(value)) {
        warn('data-config: rejected palette', value);
        continue;
      }
      out.palette = value;
    } else if (key === 'showSource') {
      if (typeof value !== 'boolean') {
        warn('data-config: rejected showSource', value);
        continue;
      }
      out.showSource = value;
    } else if (key === 'showEditorLink') {
      if (typeof value !== 'boolean') {
        warn('data-config: rejected showEditorLink', value);
        continue;
      }
      out.showEditorLink = value;
    }
  }
  return out;
}

// ============================================================
// Target selection
// ============================================================

export function selectTargets(root: ParentNode = document): Element[] {
  const all = root.querySelectorAll(
    '.dgmo:not([data-dgmo-processed]), .language-dgmo:not([data-dgmo-processed])'
  );
  // Filter out elements already inside a rendered wrapper (defensive).
  return Array.from(all).filter((el) => !el.closest('.dgmo-rendered'));
}

// ============================================================
// Theme resolver
// ============================================================

export function resolveTheme(
  theme: AutoConfig['theme']
): 'light' | 'dark' | 'transparent' {
  if (theme === 'light' || theme === 'dark' || theme === 'transparent') {
    return theme;
  }
  if (typeof document === 'undefined') return 'light';
  const html = document.documentElement;
  // Explicit page theme always wins over OS preference. Check both
  // the dark and light variants so a `<html data-theme="light">` page
  // running on a dark-mode OS still renders as light.
  const dataTheme = html.getAttribute('data-theme');
  if (dataTheme === 'dark') return 'dark';
  if (dataTheme === 'light') return 'light';
  if (html.classList.contains('dark')) return 'dark';
  if (html.classList.contains('light')) return 'light';
  if (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

// ============================================================
// Style injection
// ============================================================

function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  if (html && html.dataset && html.dataset[STYLE_FLAG] === '1') return;

  // If a <link rel="stylesheet"> for our css is already linked, skip inline.
  const linked = document.querySelector(
    'link[rel="stylesheet"][href*="auto.css"]'
  );
  if (linked) {
    if (html && html.dataset) html.dataset[STYLE_FLAG] = '1';
    return;
  }

  const style = document.createElement('style');
  style.setAttribute('data-dgmo-auto', '');
  style.textContent = CSS;
  document.head.appendChild(style);
  if (html && html.dataset) html.dataset[STYLE_FLAG] = '1';
}

// ============================================================
// Source panel construction
// ============================================================

function buildHighlightedSource(source: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let tokens: HighlightToken[];
  try {
    tokens = highlightDgmo(source);
  } catch {
    // Fall back to plain text if the highlighter throws.
    frag.appendChild(document.createTextNode(source));
    return frag;
  }
  for (const tok of tokens) {
    if (!tok.text) continue;
    const span = document.createElement('span');
    span.className = `dgmo-tok-${tok.role}`;
    // textContent ensures user-supplied text never executes as HTML.
    span.textContent = tok.text;
    frag.appendChild(span);
  }
  return frag;
}

// ----- icon SVGs (built as DocumentFragments via cloneNode for safety) -----
const COPY_ICON_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h2.5"/></svg>';
const CHECK_ICON_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 8.5 6.5 12 13 4.5"/></svg>';
const EXTERNAL_ICON_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2h5v5"/><path d="M14 2L7 9"/><path d="M13 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4"/></svg>';

function setIcon(el: Element, svg: string): void {
  // Static icon strings authored above — no user content. innerHTML is
  // safe here because the markup never originates from runtime data.
  el.innerHTML = svg;
}

function buildSourcePanel(
  source: string,
  shareUrl: string | null,
  showEditorLink: boolean
): HTMLDivElement {
  const panel = document.createElement('div');
  panel.className = 'dgmo-source-panel';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'dgmo-source-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  const chevron = document.createElement('span');
  chevron.className = 'dgmo-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '▸';
  toggle.appendChild(chevron);
  const label = document.createElement('span');
  label.textContent = 'DGMO source';
  toggle.appendChild(label);

  const body = document.createElement('div');
  body.className = 'dgmo-source-body';
  const pre = document.createElement('pre');
  pre.className = 'dgmo-source-pre';
  pre.appendChild(buildHighlightedSource(source));
  body.appendChild(pre);

  // Icon-only action buttons floated in the top-right of the source pre.
  // They're inside the body so they're effectively hidden when the panel
  // is collapsed (max-height: 0 + pointer-events: none in CSS).
  const actions = document.createElement('div');
  actions.className = 'dgmo-source-actions';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'dgmo-btn dgmo-btn-copy';
  copyBtn.setAttribute('aria-label', 'Copy DGMO source');
  copyBtn.title = 'Copy source';
  setIcon(copyBtn, COPY_ICON_SVG);
  copyBtn.addEventListener('click', () => {
    void copySource(source, copyBtn);
  });
  actions.appendChild(copyBtn);

  if (showEditorLink) {
    const editorBtn = document.createElement('a');
    editorBtn.className = 'dgmo-btn dgmo-btn-editor';
    editorBtn.target = '_blank';
    editorBtn.rel = 'noopener noreferrer';
    editorBtn.setAttribute('aria-label', 'Open in editor');
    setIcon(editorBtn, EXTERNAL_ICON_SVG);
    if (shareUrl) {
      editorBtn.href = shareUrl;
      editorBtn.title = 'Open in editor';
    } else {
      editorBtn.setAttribute('aria-disabled', 'true');
      editorBtn.title =
        'Diagram too large for share link; copy source and paste into editor';
      editorBtn.addEventListener('click', (e) => e.preventDefault());
    }
    actions.appendChild(editorBtn);
  }

  body.appendChild(actions);
  panel.appendChild(toggle);
  panel.appendChild(body);

  toggle.addEventListener('click', () => {
    const open = body.classList.toggle('dgmo-open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  return panel;
}

async function copySource(
  source: string,
  btn: HTMLButtonElement
): Promise<void> {
  let copied = false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(source);
      copied = true;
    }
  } catch {
    // fallthrough to execCommand
  }
  if (!copied && typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea');
      ta.value = source;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      copied = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch {
      copied = false;
    }
  }
  if (copied) {
    // Swap the clipboard icon to a checkmark for COPIED_INTERACTION_MS,
    // then revert. The button is icon-only so we just rewrite its inner
    // SVG; aria-label is a separate attribute and remains intact.
    setIcon(btn, CHECK_ICON_SVG);
    btn.classList.add('dgmo-btn-copied');
    setTimeout(() => {
      setIcon(btn, COPY_ICON_SVG);
      btn.classList.remove('dgmo-btn-copied');
    }, COPIED_INTERACTION_MS);
  } else {
    warn('clipboard write failed');
  }
}

// ============================================================
// Error banner
// ============================================================

interface BannerOptions {
  message: string;
  severity?: string;
  line?: number;
  column?: number;
}

function buildErrorBanner(opts: BannerOptions): HTMLDivElement {
  const banner = document.createElement('div');
  banner.className = 'dgmo-error-banner';
  banner.setAttribute('role', 'alert');

  const title = document.createElement('div');
  title.className = 'dgmo-error-banner-title';
  title.textContent = `${opts.severity ?? 'error'}: ${opts.message}`;
  banner.appendChild(title);

  if (opts.line !== undefined && opts.line > 0) {
    const loc = document.createElement('div');
    loc.className = 'dgmo-error-banner-loc';
    loc.textContent =
      opts.column !== undefined
        ? `at ${opts.line}:${opts.column}`
        : `at line ${opts.line}`;
    banner.appendChild(loc);
  }
  return banner;
}

// ============================================================
// Aria-label derivation
// ============================================================

function deriveAriaLabel(source: string): string {
  const firstLine = source
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return 'DGMO diagram';
  return firstLine.replace(ARIA_STRIP_RE, '').slice(0, ARIA_LABEL_MAX);
}

// ============================================================
// Render-and-replace flow
// ============================================================

function determineReplaceTarget(matched: Element): Element {
  // If matched is a <code> whose only child of <pre> is itself, replace <pre>.
  if (matched.tagName === 'CODE') {
    const parent = matched.parentElement;
    if (parent && parent.tagName === 'PRE') {
      const meaningfulChildren = Array.from(parent.childNodes).filter(
        (n) =>
          n.nodeType === 1 ||
          (n.nodeType === 3 && (n.textContent || '').trim().length > 0)
      );
      if (
        meaningfulChildren.length === 1 &&
        meaningfulChildren[0] === matched
      ) {
        return parent;
      }
    }
  }
  return matched;
}

interface ProcessOutcome {
  wrapper?: HTMLDivElement;
}

async function processElement(el: Element): Promise<ProcessOutcome> {
  if (!(el instanceof HTMLElement)) return {};
  if (el.dataset.dgmoProcessed === 'true') return {};

  // Mark the source synchronously so a concurrent run() (e.g. a SPA
  // hydration race firing right after auto-bootstrap) can't double-process
  // the same element while we await render(). The wrapper inherits the
  // flag below; on error paths we DO clear it (see error handlers) so the
  // user can retry with `dgmo.run()` after fixing the source.
  el.dataset.dgmoProcessed = 'true';

  const source = el.textContent || '';
  const sourceBytes = new TextEncoder().encode(source).byteLength;
  if (sourceBytes > SOURCE_BYTE_CAP) {
    el.style.visibility = '';
    // Keep `data-dgmo-processed` set so a follow-up run() doesn't loop on
    // the same broken source. Users wanting to retry after editing should
    // clear the attribute manually or replace the element. // un-hide so user can see the source
    const banner = buildErrorBanner({
      message: `DGMO source too large to render — ${SOURCE_BYTE_CAP / 1024} KB max`,
      severity: 'error',
    });
    el.parentElement?.insertBefore(banner, el);
    warn('source exceeds 256 KB cap');
    return {};
  }

  const cfg = activeConfig;
  const resolvedTheme =
    cfg.theme === 'transparent' ? 'transparent' : resolveTheme(cfg.theme);
  const renderTheme =
    resolvedTheme === 'transparent' ? 'transparent' : resolvedTheme;
  const ariaLabel = deriveAriaLabel(source);

  const perElementShowSource = el.dataset.showSource;
  let showSource = cfg.showSource;
  // Strict allowlist: only the exact strings 'true' / 'false' override the
  // global. Anything else (e.g. 'yes', '1') is ignored with a warning.
  if (perElementShowSource === 'true') showSource = true;
  else if (perElementShowSource === 'false') showSource = false;
  else if (perElementShowSource !== undefined) {
    warn(
      'data-show-source: invalid value',
      perElementShowSource,
      '— expected "true" or "false"'
    );
  }

  let result: {
    svg: string;
    diagnostics: import('../diagnostics').DgmoError[];
  };
  try {
    result = await render(source, {
      theme: renderTheme,
      palette: cfg.palette,
    });
  } catch (err) {
    el.style.visibility = '';
    // Keep `data-dgmo-processed` set so a follow-up run() doesn't loop on
    // the same broken source. Users wanting to retry after editing should
    // clear the attribute manually or replace the element.
    const message =
      err instanceof Error ? err.message : 'Render failed unexpectedly';
    const banner = buildErrorBanner({ message, severity: 'error' });
    el.parentElement?.insertBefore(banner, el);
    warn('render() rejected:', err);
    return {};
  }

  if (result.diagnostics && result.diagnostics.length > 0) {
    el.style.visibility = '';
    // Keep `data-dgmo-processed` set so a follow-up run() doesn't loop on
    // the same broken source. Users wanting to retry after editing should
    // clear the attribute manually or replace the element.
    const d = result.diagnostics[0];
    // d may have shape { severity, message, line, column } from diagnostics.ts
    const banner = buildErrorBanner({
      message: d.message,
      severity: d.severity,
      line: d.line,
      column: d.column,
    });
    el.parentElement?.insertBefore(banner, el);
    warn('diagnostic:', d.message, d.line, d.column);
    return {};
  }

  if (!result.svg) {
    el.style.visibility = '';
    // Keep `data-dgmo-processed` set so a follow-up run() doesn't loop on
    // the same broken source. Users wanting to retry after editing should
    // clear the attribute manually or replace the element.
    const banner = buildErrorBanner({
      message: 'Empty SVG returned from renderer',
      severity: 'error',
    });
    el.parentElement?.insertBefore(banner, el);
    return {};
  }

  // Build wrapper.
  const wrapper = document.createElement('div');
  const themeClass =
    resolvedTheme === 'dark'
      ? 'dgmo-theme-dark'
      : resolvedTheme === 'transparent'
        ? 'dgmo-theme-transparent'
        : 'dgmo-theme-light';
  wrapper.className = `dgmo-rendered ${themeClass}`;
  wrapper.dataset.dgmoProcessed = 'true';

  // Insert SVG via a detached holder + post-insertion sanitization. The
  // spec said "never assign user-supplied content to innerHTML"; we treat
  // that as the *intent* (no script execution from rendered content) and
  // implement it via a defense-in-depth sanitizer rather than DOMParser
  // (which can't import CDATA-bearing SVG into an HTML document — jsdom
  // and browsers both throw `Cannot create CDATA sections in HTML
  // documents` on importNode). innerHTML on a detached element does NOT
  // execute <script> children when the tree is later inserted, but it
  // DOES honor `on*` event-handler attributes, so we strip those before
  // moving the SVG into the live DOM.
  const svgHolder = document.createElement('div');
  svgHolder.innerHTML = result.svg;
  const svgEl = svgHolder.querySelector('svg');
  if (!svgEl) {
    el.style.visibility = '';
    // Keep `data-dgmo-processed` set so a follow-up run() doesn't loop on
    // the same broken source. Users wanting to retry after editing should
    // clear the attribute manually or replace the element.
    const banner = buildErrorBanner({
      message: 'Empty SVG returned from renderer',
      severity: 'error',
    });
    el.parentElement?.insertBefore(banner, el);
    return {};
  }
  sanitizeSvgInPlace(svgEl);
  // Always force role="img" and the sanitized aria-label, overriding any
  // renderer-provided value (so accessibility text passes our 200-char +
  // control/bidi-strip filter rather than relying on renderer output).
  svgEl.setAttribute('role', 'img');
  svgEl.setAttribute('aria-label', ariaLabel);
  wrapper.appendChild(svgEl);

  if (showSource) {
    // Build share URL.
    let shareUrl: string | null = null;
    if (cfg.showEditorLink) {
      const shareTheme: 'light' | 'dark' =
        resolvedTheme === 'dark' ? 'dark' : 'light';
      const result = encodeDiagramUrl(source, {
        baseUrl: EDITOR_BASE_URL,
        palette: cfg.palette,
        theme: shareTheme,
      });
      if (result.url) {
        const utm = `utm_source=auto-embed&utm_medium=html&utm_campaign=${encodeURIComponent(VERSION)}`;
        // encodeDiagramUrl returns a URL of the shape `…?<query>#<hash>`.
        // Appending UTM at the end would land it inside the hash fragment,
        // which most analytics platforms ignore. Inject the UTM params into
        // BOTH the query (where Plausible/GA read them) and the hash
        // fragment (where iOS share-sheet preserves them).
        const hashIdx = result.url.indexOf('#');
        let withUtm: string;
        if (hashIdx === -1) {
          // No hash — append to query.
          const sep = result.url.includes('?') ? '&' : '?';
          withUtm = result.url + sep + utm;
        } else {
          const beforeHash = result.url.slice(0, hashIdx);
          const afterHash = result.url.slice(hashIdx + 1);
          const querySep = beforeHash.includes('?') ? '&' : '?';
          const hashSep = afterHash.length > 0 ? '&' : '';
          withUtm =
            beforeHash + querySep + utm + '#' + afterHash + hashSep + utm;
        }
        shareUrl = withUtm;
        // Final defense: validate the URL we just built.
        if (!safeHref(shareUrl)) shareUrl = null;
      } else if (
        result.error === 'too-large' &&
        result.compressedSize > SHARE_URL_LIMIT_BYTES
      ) {
        shareUrl = null;
      }
    }
    const panel = buildSourcePanel(source, shareUrl, cfg.showEditorLink);
    wrapper.appendChild(panel);
  }

  // Track wrapper so re-runs / theme changes can update it. Only persist
  // the explicit 'true'/'false' values; treat any other value as null so
  // the global default applies on re-render (matches first-render behavior).
  const trackedShowSource: boolean | null =
    perElementShowSource === 'true'
      ? true
      : perElementShowSource === 'false'
        ? false
        : null;
  const tracked: TrackedWrapper = {
    wrapper,
    source,
    perElementShowSource: trackedShowSource,
  };
  wrappers.add(tracked);

  // Determine replace target and swap. Idempotency (data-dgmo-processed) plus
  // selectTargets' filter ensures listener handlers don't accumulate across
  // re-runs, since each source is processed at most once per run() pass.
  const replaceTarget = determineReplaceTarget(el);
  replaceTarget.replaceWith(wrapper);
  return { wrapper };
}

// ============================================================
// Public API: initialize / run
// ============================================================

export function initialize(opts: AutoConfig = {}): void {
  // Strict allowlist guard for direct callers, too.
  if (!isPlainObject(opts)) return;
  for (const k of FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(opts, k)) {
      warn('initialize: rejected (prototype-pollution key:', k, ')');
      return;
    }
  }
  const next = { ...activeConfig };
  if (isValidTheme(opts.theme)) {
    next.theme = opts.theme;
  }
  if (typeof opts.palette === 'string' && paletteExists(opts.palette)) {
    next.palette = opts.palette;
  }
  if (typeof opts.showSource === 'boolean') next.showSource = opts.showSource;
  if (typeof opts.showEditorLink === 'boolean')
    next.showEditorLink = opts.showEditorLink;
  activeConfig = next;
}

export async function run(opts: RunOptions = {}): Promise<void> {
  ensureStyles();

  // Sweep: drop any tracked wrappers that have been detached from the DOM
  // by an SPA framework so they don't leak references to listener handlers.
  for (const t of Array.from(wrappers)) {
    if (!document.contains(t.wrapper)) {
      wrappers.delete(t);
    }
  }

  let elements: Element[];
  if (opts.nodes) {
    const arr =
      'length' in opts.nodes && typeof opts.nodes !== 'string'
        ? Array.from(opts.nodes as ArrayLike<Element>)
        : [];
    elements = arr.filter(
      (el): el is Element =>
        el instanceof Element &&
        (el.matches('.dgmo, .language-dgmo') ||
          el.querySelector('.dgmo, .language-dgmo') !== null)
    );
    // Expand any container-style queries to their inner targets.
    const expanded: Element[] = [];
    for (const el of elements) {
      if (el.matches('.dgmo, .language-dgmo')) expanded.push(el);
      const inner = el.querySelectorAll(
        '.dgmo:not([data-dgmo-processed]), .language-dgmo:not([data-dgmo-processed])'
      );
      inner.forEach((n) => expanded.push(n));
    }
    elements = Array.from(new Set(expanded)).filter(
      (el) => !el.closest('.dgmo-rendered')
    );
  } else {
    elements = selectTargets();
  }
  await Promise.all(elements.map((el) => processElement(el).catch(() => ({}))));
}

// ============================================================
// Bootstrap
// ============================================================

function rerenderAllForTheme(): void {
  // For 'auto' theme, re-run wrappers when the system preference changes.
  if (activeConfig.theme !== 'auto') return;
  // Strategy: walk tracked wrappers, replace each with a fresh source
  // element that re-runs through processElement.
  for (const t of Array.from(wrappers)) {
    const placeholder = document.createElement('pre');
    placeholder.className = 'dgmo';
    placeholder.textContent = t.source;
    if (t.perElementShowSource !== null) {
      placeholder.dataset.showSource = String(t.perElementShowSource);
    }
    t.wrapper.replaceWith(placeholder);
    wrappers.delete(t);
    // Process inline; ignore errors (already logged).
    void processElement(placeholder);
  }
}

function attachThemeListener(): void {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (): void => rerenderAllForTheme();
  if (mq.addEventListener) {
    mq.addEventListener('change', handler);
  } else if (
    'addListener' in mq &&
    typeof (mq as { addListener?: unknown }).addListener === 'function'
  ) {
    (
      mq as MediaQueryList & { addListener: (cb: () => void) => void }
    ).addListener(handler);
  }
}

/**
 * Un-hide every matched source element. Used as the safety net if the
 * bundle ever fails to render — the anti-flash CSS would otherwise leave
 * source blocks invisibly hidden forever.
 */
function unhideAllSources(): void {
  if (typeof document === 'undefined') return;
  const matches = document.querySelectorAll<HTMLElement>(
    '.dgmo:not(.dgmo-rendered), .language-dgmo'
  );
  matches.forEach((el) => {
    if (el.closest('.dgmo-rendered')) return;
    el.style.visibility = 'visible';
  });
  // Also drop the anti-flash flag so subsequent loads re-inject if needed.
  if (document.documentElement && document.documentElement.dataset) {
    document.documentElement.dataset.dgmoAutoFailed = '1';
  }
}

function bootstrap(): void {
  try {
    // Inject CSS synchronously so the anti-flash rule applies before any
    // diagrams are scanned.
    ensureStyles();

    const scriptTag = findScriptTag();
    const dataAuto = scriptTag?.getAttribute('data-auto');
    const dataConfig = scriptTag?.getAttribute('data-config');

    // Apply config from data-config (with strict allowlist).
    if (dataConfig) {
      const parsed = parseConfig(dataConfig);
      initialize(parsed);
    }

    attachThemeListener();

    // Last-resort safety net: if `run()` somehow never completes within 30s,
    // un-hide source elements so the page isn't permanently blank.
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        const remaining = document.querySelectorAll(
          '.dgmo:not(.dgmo-rendered):not([data-dgmo-processed])'
        );
        if (remaining.length > 0) {
          warn('safety timeout: un-hiding unrendered sources');
          unhideAllSources();
        }
      }, 30000);
    }

    if (dataAuto === 'false') return;

    const runOnReady = (): void => {
      run().catch((err: unknown) => {
        warn('run() crashed:', err);
        unhideAllSources();
      });
    };
    if (typeof document !== 'undefined' && document.readyState !== 'loading') {
      runOnReady();
    } else if (typeof document !== 'undefined') {
      document.addEventListener('DOMContentLoaded', runOnReady, { once: true });
    }
  } catch (err) {
    warn('bootstrap failed:', err);
    // Don't strand the page invisible — un-hide every source so users see
    // something even when the bundle can't render.
    unhideAllSources();
  }
}

// ============================================================
// Frozen globals
// ============================================================

const api = Object.freeze({
  initialize,
  run,
  version: VERSION,
});

function freezeOn(target: typeof globalThis, key: string): void {
  try {
    Object.defineProperty(target, key, {
      value: api,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  } catch {
    // If the property is already configurable=false elsewhere we silently
    // skip — embedders who collide are responsible.
  }
}

if (typeof window !== 'undefined') {
  // The IIFE runs at script load. If we're in a test harness without DOM
  // wrappers, this is still safe because we use try/catch.
  freezeOn(window as unknown as typeof globalThis, 'dgmo');
  freezeOn(window as unknown as typeof globalThis, 'diagrammo');
  bootstrap();
}

export default api;

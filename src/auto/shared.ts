/**
 * Shared browser-embed helpers for the `@diagrammo/dgmo` client-side
 * drop-ins (`./auto` script-tag renderer and `./element` custom element).
 *
 * These are the SVG sanitizer, theme resolver, source panel (with Copy +
 * "Open in editor"), error banner, aria-label derivation, style injection,
 * and share-URL builder — factored out of `auto/index.ts` so the two entries
 * share one implementation rather than diverging copies. The `auto` entry's
 * public `window.dgmo` surface is unaffected; it imports from here.
 */

import { encodeDiagramUrl } from '../sharing';
import { highlightDgmo, type HighlightToken } from '../editor/highlight-api';
import { CSS } from './styles';
import { safeHref } from '../utils/safe-href';

declare const __DGMO_VERSION__: string;

export const VERSION: string =
  // Replaced at build time by tsup's `define`; otherwise stays as the literal
  // so we never crash if env wiring drifts.
  (typeof __DGMO_VERSION__ === 'string' && __DGMO_VERSION__) || 'dev';

/** Default hosted editor used by "Open in editor" share links. */
export const EDITOR_BASE_URL = 'https://online.diagrammo.app';

const ARIA_LABEL_MAX = 200;
const COPIED_INTERACTION_MS = 1200;
const LOG_PREFIX = '[dgmo]';

// Bidi override + control char strip for aria-label sanitization. The regex
// contains literal U+202A–U+202E and U+2066–U+2069 codepoints because eslint's
// `security/detect-bidi-characters` only matches by codepoint scan. The whole
// point of this regex is to strip those very characters from labels.
// eslint-disable-next-line no-control-regex, security/detect-bidi-characters
const ARIA_STRIP_RE = /[\x00-\x1F‪-‮⁦-⁩]/g;

const STYLE_FLAG = 'dgmoAutoStyles';

export function sharedWarn(...args: unknown[]): void {
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(LOG_PREFIX, ...args);
  }
}

// ============================================================
// SVG sanitizer
// ============================================================

/**
 * Strip script-execution surface from a freshly parsed SVG tree before it
 * lands in the live DOM. This is the safety net that lets us use innerHTML
 * for SVG insertion without trusting renderer output to be fully sanitized.
 *
 * Removes `<script>`/`<foreignObject>`, any `on*` event-handler attribute,
 * and any `href`/`xlink:href` failing the `safeHref` allowlist.
 */
export function sanitizeSvgInPlace(root: Element): void {
  const dangerous = root.querySelectorAll('script, foreignObject');
  dangerous.forEach((n) => n.remove());

  const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const node of all) {
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) {
        node.removeAttribute(attr.name);
      }
    }
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

// ============================================================
// Theme resolver
// ============================================================

export type ThemePreference = 'auto' | 'light' | 'dark' | 'transparent';

export function resolveTheme(
  theme: ThemePreference | undefined
): 'light' | 'dark' | 'transparent' {
  if (theme === 'light' || theme === 'dark' || theme === 'transparent') {
    return theme;
  }
  if (typeof document === 'undefined') return 'light';
  const html = document.documentElement;
  // Explicit page theme always wins over OS preference.
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

export function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  if (html?.dataset?.[STYLE_FLAG] === '1') return;

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
// Aria-label derivation
// ============================================================

export function deriveAriaLabel(source: string): string {
  const firstLine = source
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return 'DGMO diagram';
  return firstLine.replace(ARIA_STRIP_RE, '').slice(0, ARIA_LABEL_MAX);
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
    frag.appendChild(document.createTextNode(source));
    return frag;
  }
  for (const tok of tokens) {
    if (!tok.text) continue;
    const span = document.createElement('span');
    span.className = `dgmo-tok-${tok.role}`;
    span.textContent = tok.text;
    frag.appendChild(span);
  }
  return frag;
}

// ----- icon SVGs (static author-controlled markup) -----
const COPY_ICON_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h2.5"/></svg>';
const CHECK_ICON_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 8.5 6.5 12 13 4.5"/></svg>';
const EXTERNAL_ICON_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2h5v5"/><path d="M14 2L7 9"/><path d="M13 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4"/></svg>';

function setIcon(el: Element, svg: string): void {
  // Static icon strings authored above — no user content.
  el.innerHTML = svg;
}

export function buildSourcePanel(
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
    setIcon(btn, CHECK_ICON_SVG);
    btn.classList.add('dgmo-btn-copied');
    setTimeout(() => {
      setIcon(btn, COPY_ICON_SVG);
      btn.classList.remove('dgmo-btn-copied');
    }, COPIED_INTERACTION_MS);
  } else {
    sharedWarn('clipboard write failed');
  }
}

// ============================================================
// Error banner
// ============================================================

export interface BannerOptions {
  message: string;
  severity?: string;
  line?: number;
  column?: number;
}

export function buildErrorBanner(opts: BannerOptions): HTMLDivElement {
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
// Share URL builder ("Open in editor")
// ============================================================

export function buildShareUrl(
  source: string,
  opts: {
    palette: string;
    theme: 'light' | 'dark';
    editorBase: string;
    campaign: string;
    utmSource: string;
  }
): string | null {
  const result = encodeDiagramUrl(source, {
    baseUrl: opts.editorBase,
    palette: opts.palette,
    theme: opts.theme,
  });
  // `too-large` (or any encode failure) → no link; caller shows disabled btn.
  if (!result.url) return null;
  const utm = `utm_source=${encodeURIComponent(opts.utmSource)}&utm_medium=html&utm_campaign=${encodeURIComponent(opts.campaign)}`;
  // encodeDiagramUrl returns `…?<query>#<hash>`. Inject UTM into BOTH the
  // query (where analytics read them) and the hash (where iOS share-sheet
  // preserves them).
  const hashIdx = result.url.indexOf('#');
  let withUtm: string;
  if (hashIdx === -1) {
    const sep = result.url.includes('?') ? '&' : '?';
    withUtm = result.url + sep + utm;
  } else {
    const beforeHash = result.url.slice(0, hashIdx);
    const afterHash = result.url.slice(hashIdx + 1);
    const querySep = beforeHash.includes('?') ? '&' : '?';
    const hashSep = afterHash.length > 0 ? '&' : '';
    withUtm = beforeHash + querySep + utm + '#' + afterHash + hashSep + utm;
  }
  return safeHref(withUtm) ? withUtm : null;
}

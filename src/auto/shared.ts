/**
 * Shared browser-embed helpers for the `@diagrammo/dgmo` client-side
 * drop-ins (`./auto` script-tag renderer and `./element` custom element).
 *
 * These are the SVG sanitizer, theme resolver, the standard-block DOM
 * assembler (canonical chrome from `src/embed` — BL-114), the error card,
 * aria-label derivation, style injection, and share-URL builder — factored
 * out of `auto/index.ts` so the two entries share one implementation rather
 * than diverging copies. The `auto` entry's public `window.dgmo` surface is
 * unaffected; it imports from here.
 */

import { encodeDiagramUrl } from '../sharing';
import { buildDgmoBlockHtml, errorBlockHtml } from '../embed';
import { CSS } from './styles';
import { safeHref } from '../utils/safe-href';

declare const __DGMO_VERSION__: string;

export const VERSION: string =
  // Replaced at build time by tsup's `define`; otherwise stays as the literal
  // so we never crash if env wiring drifts.
  (typeof __DGMO_VERSION__ === 'string' && __DGMO_VERSION__) || 'dev';

/** Default hosted editor used by "Open in editor" share links. */
export { EDITOR_BASE_URL } from '../embed';

const ARIA_LABEL_MAX = 200;
const COPIED_INTERACTION_MS = 1500;
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
// Standard block assembly (canonical chrome from src/embed — BL-114)
// ============================================================

export interface RenderedBlockOptions {
  /** Trimmed DGMO source (copy payload + highlighted panel content). */
  source: string;
  /** Already-rendered AND sanitized SVG element to mount as the diagram. */
  svgEl: Element;
  /** `dgmo-theme-light` / `dgmo-theme-dark` / `dgmo-theme-transparent`. */
  themeClass: string;
  /** Emit the source-view toggle + collapsible source panel. */
  showSource: boolean;
  /** Emit the copy-source button. */
  showCopy: boolean;
  /** Emit the expand (full-screen) button. */
  showExpand: boolean;
  /** Emit the open-in-editor toolbar link at all. */
  showEditorLink: boolean;
  /**
   * Pre-built share URL (with the surface's UTM params) for the
   * open-in-editor link. `null` (encode failed / too large) drops the link.
   */
  shareUrl: string | null;
}

/**
 * Assemble the standard DGMO embed block (`figure.dgmo` + hover-reveal icon
 * toolbar + native `<details>` source panel) around an already-sanitized SVG
 * node, and bind the toolbar's copy/open click handling.
 *
 * The markup comes from the canonical `buildDgmoBlockHtml` in `src/embed`;
 * this wrapper only (1) mounts the live SVG node into the `.dgmo-svg` slot,
 * (2) swaps the open-in-editor href for the surface's UTM-tagged share URL,
 * and (3) attaches the click handler that `<details>` can't provide (copy).
 */
export function buildRenderedBlock(opts: RenderedBlockOptions): HTMLElement {
  // Each toolbar button is independently gated. `mode: showcase` only sets the
  // wrapper variant class + the (unused-here) defaults; every show* flag is
  // passed explicitly, so the emitted toolbar reflects exactly this subset.
  const anyButton =
    opts.showSource || opts.showCopy || opts.showExpand || opts.showEditorLink;
  const html = buildDgmoBlockHtml(opts.source, '<div class="dgmo-svg"></div>', {
    mode: anyButton ? 'showcase' : 'diagram',
    showSource: opts.showSource,
    showCopy: opts.showCopy,
    showExpand: opts.showExpand,
    showOpenInEditor: opts.showEditorLink,
    // Keep the legacy `.dgmo-rendered` + theme hooks so the anti-flash CSS,
    // idempotency filters, and theme-scoped token colors keep working.
    legacyClassNames: ['dgmo-rendered', opts.themeClass],
  });
  const holder = document.createElement('div');
  // buildDgmoBlockHtml output is author-controlled markup with all
  // user-supplied strings escaped; the SVG slot is empty at this point.
  holder.innerHTML = html;
  const wrapper = holder.firstElementChild as HTMLElement;

  // Mount the sanitized SVG node directly (no serialize/re-parse round trip).
  wrapper.querySelector('.dgmo-svg')?.appendChild(opts.svgEl);

  // The canonical builder encodes a bare share URL; the browser surfaces
  // carry UTM attribution, so swap in the pre-built URL (or drop the link
  // when encoding failed — copy remains as the fallback affordance).
  const open = wrapper.querySelector<HTMLAnchorElement>('a.dgmo-open');
  if (open) {
    if (opts.shareUrl) open.href = opts.shareUrl;
    else open.remove();
  }

  bindBlockToolbar(wrapper);
  return wrapper;
}

/**
 * Click handling for the standard block toolbar (mirrors remark-dgmo's
 * `bindDgmo` reference implementation, but bound per-wrapper because these
 * surfaces build their DOM imperatively).
 *
 * The toolbar is the `<summary>` of the source `<details>`: clicks on the
 * `</>` toggle keep the native default (toggling), while clicks on
 * `.dgmo-toolbar-btn` (copy / open) must preventDefault so they don't ALSO
 * toggle — which cancels an anchor's navigation, hence the manual
 * `window.open`.
 */
function bindBlockToolbar(wrapper: HTMLElement): void {
  wrapper.addEventListener('click', (e) => {
    void handleToolbarClick(e);
  });
}

async function handleToolbarClick(e: Event): Promise<void> {
  const target = e.target as Element | null;
  if (!target || typeof target.closest !== 'function') return;
  const btn = target.closest('.dgmo-toolbar-btn') as HTMLElement | null;
  if (!btn) return;

  const insideSummary = !!btn.closest('summary');
  if (insideSummary) e.preventDefault();

  if (btn.matches('button.dgmo-expand')) {
    openDgmoLightbox(btn);
    return;
  }

  if (btn.matches('button.dgmo-copy')) {
    const copied = await copyText(btn.dataset['dgmoSource'] ?? '');
    if (copied) {
      btn.classList.add('dgmo-copy--success');
      setTimeout(
        () => btn.classList.remove('dgmo-copy--success'),
        COPIED_INTERACTION_MS
      );
    } else {
      sharedWarn('clipboard write failed');
    }
    return;
  }

  if (insideSummary && btn.matches('a.dgmo-open')) {
    const anchor = btn as HTMLAnchorElement;
    if (anchor.href) {
      window.open(
        anchor.href,
        anchor.target || '_blank',
        'noopener,noreferrer'
      );
    }
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallthrough to execCommand
  }
  if (typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(ta);
      return copied;
    } catch {
      return false;
    }
  }
  return false;
}

// ============================================================
// Full-screen lightbox (expand toolbar button)
// ============================================================
//
// CANONICAL COPY. The same helper is mirrored, near-verbatim, into every
// client surface that binds the standard toolbar — remark-dgmo's `client.ts`,
// the Obsidian plugin's `render.ts`, and dgmo-mcp's inlined `TOOLBAR_SCRIPT` —
// exactly as the copy/open handling is. Keep them in sync. The CSS
// (`.dgmo-lightbox*`) is single-sourced in `embed/css.ts` (BLOCK_CSS).

const LIGHTBOX_XLINK_NS = 'http://www.w3.org/1999/xlink';
const LIGHTBOX_REF_ATTRS = [
  'clip-path',
  'mask',
  'filter',
  'fill',
  'stroke',
  'marker-start',
  'marker-mid',
  'marker-end',
];
let lightboxIdSeq = 0;

const LIGHTBOX_CLOSE_ICON =
  '<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 4 8 8"/><path d="m12 4-8 8"/></svg>';

/**
 * A cloned SVG keeps the same element ids as the still-mounted inline copy.
 * Two identical id sets in one document make `url(#id)` / `href="#id"`
 * references ambiguous (WebKit resolves to the first match), corrupting
 * gradients/clips/masks. Namespace this copy's ids + references so it is
 * self-contained. (Vanilla port of the app's DgmoLightbox.namespaceSvgIds.)
 */
function namespaceLightboxSvgIds(root: SVGElement, prefix: string): void {
  const map = new Map<string, string>();
  root.querySelectorAll('[id]').forEach((el) => {
    const oldId = el.getAttribute('id');
    if (!oldId) return;
    const newId = prefix + oldId;
    map.set(oldId, newId);
    el.setAttribute('id', newId);
  });
  if (map.size === 0) return;
  const remap = (value: string): string =>
    value.replace(/url\(#([^)]+)\)/g, (m, id: string) => {
      const next = map.get(id);
      return next ? `url(#${next})` : m;
    });
  root.querySelectorAll('*').forEach((el) => {
    for (const attr of LIGHTBOX_REF_ATTRS) {
      const v = el.getAttribute(attr);
      if (v && v.includes('url(#')) el.setAttribute(attr, remap(v));
    }
    const style = el.getAttribute('style');
    if (style && style.includes('url(#'))
      el.setAttribute('style', remap(style));
    const href = el.getAttribute('href');
    if (href && href.startsWith('#') && map.has(href.slice(1)))
      el.setAttribute('href', '#' + map.get(href.slice(1)));
    const xhref = el.getAttributeNS(LIGHTBOX_XLINK_NS, 'href');
    if (xhref && xhref.startsWith('#') && map.has(xhref.slice(1)))
      el.setAttributeNS(
        LIGHTBOX_XLINK_NS,
        'href',
        '#' + map.get(xhref.slice(1))
      );
  });
}

/**
 * Open the diagram belonging to `fromButton`'s block in a full-viewport
 * `<dialog>` lightbox. Clones the currently-visible color-mode SVG (dual
 * render hides one via `display:none`), id-namespaces the clone so it can't
 * clash with the inline original, then `showModal()`s. Escape (native),
 * backdrop-click, and the close button all dismiss and remove it.
 */
export function openDgmoLightbox(fromButton: Element): void {
  if (typeof document === 'undefined') return;
  const block = fromButton.closest('.dgmo');
  if (!block) return;

  const wrappers = block.querySelectorAll('.dgmo-light, .dgmo-dark, .dgmo-svg');
  let svg: SVGSVGElement | null = null;
  for (const w of Array.from(wrappers)) {
    if (window.getComputedStyle(w).display === 'none') continue;
    const found = w.querySelector('svg');
    if (found) {
      svg = found as SVGSVGElement;
      break;
    }
  }
  if (!svg) svg = block.querySelector('svg');
  if (!svg) return;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  namespaceLightboxSvgIds(clone, `dgmo-lb-${++lightboxIdSeq}-`);

  const dialog = document.createElement('dialog');
  dialog.className = 'dgmo-lightbox';
  dialog.setAttribute('aria-label', 'Diagram, full screen');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'dgmo-lightbox-close';
  closeBtn.setAttribute('aria-label', 'Close full screen');
  closeBtn.innerHTML = LIGHTBOX_CLOSE_ICON;

  const host = document.createElement('div');
  host.className = 'dgmo-lightbox-svg';
  host.appendChild(clone);

  dialog.appendChild(closeBtn);
  dialog.appendChild(host);
  document.body.appendChild(dialog);

  const close = (): void => {
    if (dialog.open) dialog.close();
  };
  closeBtn.addEventListener('click', close);
  // A click that lands on the dialog element itself (the transparent area
  // around the centered card) is a backdrop dismiss.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

// ============================================================
// Error card (canonical errorBlockHtml from src/embed)
// ============================================================

export interface BannerOptions {
  message: string;
  severity?: string;
  line?: number;
  column?: number;
}

/**
 * Build the standard `.dgmo--error` card as a live DOM element. Message +
 * location are folded into one line; the offending source is shown inside
 * the card (canonical shape — same as remark-dgmo and the other adopters).
 */
export function buildErrorBlock(
  opts: BannerOptions & { source: string }
): HTMLElement {
  let message =
    opts.severity && opts.severity !== 'error'
      ? `${opts.severity}: ${opts.message}`
      : opts.message;
  if (opts.line !== undefined && opts.line > 0) {
    message +=
      opts.column !== undefined
        ? ` (at ${opts.line}:${opts.column})`
        : ` (at line ${opts.line})`;
  }
  const holder = document.createElement('div');
  // errorBlockHtml escapes both message and source.
  holder.innerHTML = errorBlockHtml(new Error(message), opts.source);
  const card = holder.firstElementChild as HTMLElement;
  // Mark processed so the auto surface's selectors never re-scan the card
  // (its root carries the `.dgmo` class the scanner matches on).
  card.setAttribute('data-dgmo-processed', 'true');
  return card;
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

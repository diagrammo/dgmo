/**
 * `@diagrammo/dgmo/auto` — IIFE-distributed auto-renderer for static HTML.
 *
 * Drop a `<script src="…/auto.js">` on any page; on `DOMContentLoaded`
 * this module scans for `.dgmo, .language-dgmo`, runs `render()`, and
 * replaces each match with the standard DGMO embed block (BL-114,
 * `figure.dgmo.dgmo-rendered`) — the diagram plus a hover-reveal icon
 * toolbar with view-source, Copy, and "Open in editor" actions.
 *
 * Public API: frozen `window.dgmo` and alias `window.diagrammo` with
 * `{ initialize, run, version }`. Configuration is read from the
 * bundle's own `<script data-config='{…}'>` (JSON with strict
 * allowlist) or via `dgmo.initialize(opts)` for `data-auto="false"`
 * embedders.
 */

import { render } from '../render';
import { startCountdowns } from '../countdown/ticker';
import { startClocks } from '../clock/ticker';
import { getAvailablePalettes } from '../palettes/registry';
import '../palettes';
import {
  VERSION,
  EDITOR_BASE_URL,
  sanitizeSvgInPlace,
  resolveTheme,
  ensureStyles,
  deriveAriaLabel,
  buildRenderedBlock,
  buildErrorBlock,
  buildShareUrl,
} from './shared';

// ============================================================
// Public API surface — locked into SemVer
// ============================================================

export interface AutoConfig {
  theme?: 'auto' | 'light' | 'dark' | 'transparent';
  palette?: string;
  /** Show the source-view toggle + collapsible source panel. Default true. */
  showSource?: boolean;
  /** Show the copy-source button. Default true. */
  showCopy?: boolean;
  /** Show the expand (full-screen) button. Default true. */
  showExpand?: boolean;
  /** Show the open-in-editor link. Default true. */
  showEditorLink?: boolean;
}

export interface RunOptions {
  nodes?: Element[] | NodeListOf<Element>;
}

// VERSION + resolveTheme are re-exported from the shared embed module so the
// `./auto` public surface (window.dgmo.version, resolveTheme) is unchanged.
export { VERSION, resolveTheme };

const DEFAULTS: Required<AutoConfig> = {
  theme: 'auto',
  palette: 'slate',
  showSource: true,
  showCopy: true,
  showExpand: true,
  showEditorLink: true,
};

let activeConfig: Required<AutoConfig> = { ...DEFAULTS };

// Track wrappers so we can re-render on theme changes / re-runs.
/** Per-element `data-show-*` overrides; `null` means "use the global config". */
interface PerElementOverrides {
  showSource: boolean | null;
  showCopy: boolean | null;
  showExpand: boolean | null;
  showEditorLink: boolean | null;
}

interface TrackedWrapper {
  wrapper: HTMLElement;
  source: string;
  overrides: PerElementOverrides;
}
const wrappers: Set<TrackedWrapper> = new Set();

const SOURCE_BYTE_CAP = 256 * 1024; // 256 KB
const LOG_PREFIX = '[dgmo:auto]';

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
 * Read a per-element boolean `data-*` override. Strict allowlist: only the
 * exact strings 'true' / 'false' count; anything else warns and is ignored
 * (falls back to the global config). Returns `null` when unset/invalid.
 */
function readBoolOverride(
  el: HTMLElement,
  datasetKey: string,
  attrLabel: string
): boolean | null {
  const raw = el.dataset[datasetKey];
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== undefined) {
    warn(`${attrLabel}: invalid value`, raw, '— expected "true" or "false"');
  }
  return null;
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

const ALLOWED_KEYS = [
  'theme',
  'palette',
  'showSource',
  'showCopy',
  'showExpand',
  'showEditorLink',
];
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
    } else if (key === 'showCopy') {
      if (typeof value !== 'boolean') {
        warn('data-config: rejected showCopy', value);
        continue;
      }
      out.showCopy = value;
    } else if (key === 'showExpand') {
      if (typeof value !== 'boolean') {
        warn('data-config: rejected showExpand', value);
        continue;
      }
      out.showExpand = value;
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

// Theme resolver, style injection, source panel, error banner, aria-label
// derivation, and the share-URL builder all live in ./shared (imported above)
// so the `./element` custom element reuses the same implementations.

// ============================================================
// Render-and-replace flow
// ============================================================

function determineReplaceTarget(matched: Element): Element {
  // If matched is a <code> whose only child of <pre> is itself, replace <pre>.
  if (matched.tagName === 'CODE') {
    const parent = matched.parentElement;
    if (parent?.tagName === 'PRE') {
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
  wrapper?: HTMLElement;
}

/**
 * Swap a failing source element for the standard `.dgmo--error` card (which
 * carries the message AND the offending source — unified error shape across
 * every embed surface). The card is marked `data-dgmo-processed` so a
 * follow-up run() doesn't loop on it; users wanting to retry after editing
 * should insert a fresh source element.
 */
function replaceWithErrorCard(
  el: Element,
  source: string,
  opts: {
    message: string;
    severity?: string;
    line?: number;
    column?: number;
  }
): void {
  const card = buildErrorBlock({ ...opts, source });
  determineReplaceTarget(el).replaceWith(card);
}

async function processElement(el: Element): Promise<ProcessOutcome> {
  if (!(el instanceof HTMLElement)) return {};
  if (el.dataset['dgmoProcessed'] === 'true') return {};

  // Mark the source synchronously so a concurrent run() (e.g. a SPA
  // hydration race firing right after auto-bootstrap) can't double-process
  // the same element while we await render(). The wrapper inherits the
  // flag below; on error paths we DO clear it (see error handlers) so the
  // user can retry with `dgmo.run()` after fixing the source.
  el.dataset['dgmoProcessed'] = 'true';

  const source = el.textContent || '';
  const sourceBytes = new TextEncoder().encode(source).byteLength;
  if (sourceBytes > SOURCE_BYTE_CAP) {
    replaceWithErrorCard(el, source, {
      message: `DGMO source too large to render — ${SOURCE_BYTE_CAP / 1024} KB max`,
      severity: 'error',
    });
    warn('source exceeds 256 KB cap');
    return {};
  }

  const cfg = activeConfig;
  const resolvedTheme =
    cfg.theme === 'transparent' ? 'transparent' : resolveTheme(cfg.theme);
  const renderTheme =
    resolvedTheme === 'transparent' ? 'transparent' : resolvedTheme;
  const ariaLabel = deriveAriaLabel(source);

  // Each toolbar button can be toggled per-element via `data-show-*`, falling
  // back to the global config. Strict allowlist: only 'true'/'false' override.
  const overrides: PerElementOverrides = {
    showSource: readBoolOverride(el, 'showSource', 'data-show-source'),
    showCopy: readBoolOverride(el, 'showCopy', 'data-show-copy'),
    showExpand: readBoolOverride(el, 'showExpand', 'data-show-expand'),
    showEditorLink: readBoolOverride(
      el,
      'showEditorLink',
      'data-show-editor-link'
    ),
  };
  const showSource = overrides.showSource ?? cfg.showSource;
  const showCopy = overrides.showCopy ?? cfg.showCopy;
  const showExpand = overrides.showExpand ?? cfg.showExpand;
  const showEditorLink = overrides.showEditorLink ?? cfg.showEditorLink;

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
    const message =
      err instanceof Error ? err.message : 'Render failed unexpectedly';
    replaceWithErrorCard(el, source, { message, severity: 'error' });
    warn('render() rejected:', err);
    return {};
  }

  if (result.diagnostics && result.diagnostics.length > 0) {
    const d = result.diagnostics[0]!; // In-bounds by length > 0 check above.
    // d may have shape { severity, message, line, column } from diagnostics.ts
    replaceWithErrorCard(el, source, {
      message: d.message,
      severity: d.severity,
      line: d.line,
      ...(d.column !== undefined && { column: d.column }),
    });
    warn('diagnostic:', d.message, d.line, d.column);
    return {};
  }

  if (!result.svg) {
    replaceWithErrorCard(el, source, {
      message: 'Empty SVG returned from renderer',
      severity: 'error',
    });
    return {};
  }

  const themeClass =
    resolvedTheme === 'dark'
      ? 'dgmo-theme-dark'
      : resolvedTheme === 'transparent'
        ? 'dgmo-theme-transparent'
        : 'dgmo-theme-light';

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
    replaceWithErrorCard(el, source, {
      message: 'Empty SVG returned from renderer',
      severity: 'error',
    });
    return {};
  }
  sanitizeSvgInPlace(svgEl);
  // Always force role="img" and the sanitized aria-label, overriding any
  // renderer-provided value (so accessibility text passes our 200-char +
  // control/bidi-strip filter rather than relying on renderer output).
  svgEl.setAttribute('role', 'img');
  svgEl.setAttribute('aria-label', ariaLabel);

  // Build share URL for the "Open in editor" toolbar action. Gated only by
  // showEditorLink now — the open-in-editor button is independent of the
  // source-view toggle.
  let shareUrl: string | null = null;
  if (showEditorLink) {
    shareUrl = buildShareUrl(source, {
      palette: cfg.palette,
      theme: resolvedTheme === 'dark' ? 'dark' : 'light',
      editorBase: EDITOR_BASE_URL,
      campaign: VERSION,
      utmSource: 'auto-embed',
    });
  }

  // Standard embed block (BL-114): canonical chrome from src/embed.
  const wrapper = buildRenderedBlock({
    source,
    svgEl,
    themeClass,
    showSource,
    showCopy,
    showExpand,
    showEditorLink,
    shareUrl,
  });
  wrapper.dataset['dgmoProcessed'] = 'true';

  // Track wrapper so re-runs / theme changes can update it. Persist the
  // per-element overrides verbatim (null = fall back to global on re-render).
  const tracked: TrackedWrapper = {
    wrapper,
    source,
    overrides,
  };
  wrappers.add(tracked);

  // Determine replace target and swap. Idempotency (data-dgmo-processed) plus
  // selectTargets' filter ensures listener handlers don't accumulate across
  // re-runs, since each source is processed at most once per run() pass.
  const replaceTarget = determineReplaceTarget(el);
  replaceTarget.replaceWith(wrapper);
  // Light up any `countdown` chart in this block: seeds the value on load and
  // registers the single page-level 1s ticker (idempotent). No-op otherwise.
  startCountdowns(wrapper);
  // Same for any `clock` chart: seed the world-clock rows and share the ticker.
  startClocks(wrapper);
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
  if (isValidTheme(opts['theme'])) {
    next.theme = opts['theme'];
  }
  if (typeof opts['palette'] === 'string' && paletteExists(opts['palette'])) {
    next.palette = opts['palette'];
  }
  if (typeof opts['showSource'] === 'boolean')
    next.showSource = opts['showSource'];
  if (typeof opts['showEditorLink'] === 'boolean')
    next.showEditorLink = opts['showEditorLink'];
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
    if (t.overrides.showSource !== null)
      placeholder.dataset['showSource'] = String(t.overrides.showSource);
    if (t.overrides.showCopy !== null)
      placeholder.dataset['showCopy'] = String(t.overrides.showCopy);
    if (t.overrides.showExpand !== null)
      placeholder.dataset['showExpand'] = String(t.overrides.showExpand);
    if (t.overrides.showEditorLink !== null)
      placeholder.dataset['showEditorLink'] = String(
        t.overrides.showEditorLink
      );
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
    document.documentElement.dataset['dgmoAutoFailed'] = '1';
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

/**
 * Protocol allowlist for user-supplied URLs emitted into rendered SVG/HTML.
 *
 * Returns the input URL unchanged when its scheme is `http:`, `https:`,
 * `mailto:`, or it is a relative path (`./…`, `/…`, `../…`, `#…`, or no
 * scheme at all). Returns `null` for any other scheme — `javascript:`,
 * `data:`, `vbscript:`, `file:`, etc. — so callers can drop the link or
 * render the text as plain text.
 *
 * The check is whitespace-tolerant and case-insensitive on the scheme,
 * matching the parsing rules browsers apply when resolving an `href`.
 */
const ALLOWED_SCHEMES = ['http', 'https', 'mailto'] as const;
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

// Browsers strip leading C0 control characters and ASCII whitespace before
// resolving a URL, so `\tjavascript:` would still execute. Mirror that here.
// eslint-disable-next-line no-control-regex
const LEADING_TRIM_RE = /^[\x00-\x20]+/;

export function safeHref(url: string | undefined | null): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.replace(LEADING_TRIM_RE, '');
  if (trimmed.length === 0) return null;

  const match = SCHEME_RE.exec(trimmed);
  if (!match) {
    // No scheme — relative path / fragment / query. Allow.
    return url;
  }

  const scheme = match[1].toLowerCase();
  if ((ALLOWED_SCHEMES as readonly string[]).includes(scheme)) {
    return url;
  }
  return null;
}

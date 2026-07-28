// SVG serialization (story 8.11 — cloud security audit follow-up).
//
// Renderers build a live DOM tree and hand back `svgEl.outerHTML`. That is the
// HTML serializer, which escapes `&` and `"` inside attribute values but
// deliberately leaves `<` and `>` alone — correct for HTML, where a quoted
// attribute value ends at its closing quote and angle brackets inside it are
// just characters.
//
// It stops being correct the moment the same bytes are served as XML. A user
// label like `A</text><script>…` lands verbatim in `data-name` /
// `data-emph-key` / `data-participant-id`, and while an HTML parser treats it as
// inert text (the audit confirmed there is no XSS here — quotes ARE escaped, so
// nothing escapes the attribute), an XML parser rejects the document outright.
// Anywhere a `.svg` is served as `image/svg+xml` or loaded through `<img>` —
// the R2 render cache, wrapper embeds, the planned `/r/:id.svg` endpoints — an
// unlucky label silently breaks the whole diagram.
//
// So this is a well-formedness fix, not an injection fix. The distinction
// matters for how far it needs to go: escaping the two characters is enough,
// and rewriting or stripping the label would corrupt tooltips and break the
// hover-matching that pairs `data-emph-key` with its legend entry.

/**
 * Escape raw `<` / `>` inside attribute values of an already-serialized SVG
 * string, leaving element markup and text content untouched.
 *
 * Safe to scan with a regex precisely because the HTML serializer has already
 * run: every attribute value is double-quoted and every `"` inside one is
 * already `&quot;`, so `"[^"]*"` cannot run past the end of a value.
 */
export function escapeAttributeAngleBrackets(svg: string): string {
  return svg.replace(
    // ` name="value"` / ` xlink:href="value"` — attribute names in SVG may carry
    // a namespace prefix, a dot, or a dash.
    /(\s[\w:.-]+=")([^"]*)"/g,
    (match, prefix: string, value: string) => {
      if (!value.includes('<') && !value.includes('>')) return match; // fast path
      return `${prefix}${value.replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`;
    }
  );
}

/**
 * Serialize an SVG element to the string every renderer returns.
 *
 * The single place `outerHTML` is turned into shipped bytes, so the
 * well-formedness guarantee holds for every chart type rather than the ones
 * somebody remembered.
 */
export function serializeSvg(svgEl: Element): string {
  return escapeAttributeAngleBrackets(svgEl.outerHTML);
}

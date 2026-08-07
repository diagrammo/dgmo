// SVG serialization (story 8.11 — cloud security audit follow-up).
//
// Renderers build a live DOM tree and hand back `svgEl.outerHTML`. That is the
// HTML serializer, which escapes `&` and `"` inside attribute values but
// deliberately leaves `<` and `>` alone — correct for HTML, where a quoted
// attribute value ends at its closing quote and angle brackets inside it are
// just characters.
//
// "Escapes `&`" describes jsdom and every browser. It is not something the DOM
// gives you: measured on 2026-08-07, at least one other implementation returns
// a bare `&` in an attribute value, which produces exactly the malformed
// document this file exists to prevent. So the `&` is escaped here too rather
// than assumed, and the pass is written to be a no-op on already-escaped
// output — see BARE_AMPERSAND.
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
 * A `&` that does not already open a character reference.
 *
 * This lookahead is the whole reason the ampersand pass is safe to run on
 * output that was already escaped. jsdom and the browser turn a literal `&`
 * into `&amp;` themselves, so on their output every `&` is followed by
 * `amp;`/`lt;`/`#39;` and is skipped — the pass is a no-op and nothing
 * double-escapes into `&amp;amp;`. Only a raw `&` left behind by an
 * implementation that does not escape gets rewritten.
 *
 * The one thing it cannot see: a label whose literal text IS `&amp;`. From the
 * serialized string alone that is indistinguishable from an already-escaped
 * `&`, so it stays as-is and renders as `&`. Escaping it correctly would mean
 * inspecting attribute values on the live DOM instead of the output, i.e.
 * writing a serializer, which is a much larger change than this corner
 * deserves.
 */
const BARE_AMPERSAND = /&(?![a-zA-Z][a-zA-Z0-9]*;|#\d+;|#[xX][0-9a-fA-F]+;)/g;

/**
 * Escape raw `<`, `>` and unescaped `&` inside attribute values of an
 * already-serialized SVG string, leaving element markup and text content
 * untouched.
 *
 * Safe to scan with a regex precisely because the HTML serializer has already
 * run: every attribute value is double-quoted and every `"` inside one is
 * already `&quot;`, so `"[^"]*"` cannot run past the end of a value.
 *
 * The `&` case does not arise under jsdom or in a browser — both escape it, as
 * the note at the top of this file says. It arises under a DOM implementation
 * that follows HTML serialization rules less completely, where a label like
 * `Sailing & Rigging` reaches `data-node-path` as a bare `&` and an XML parser
 * rejects the whole document with `malformed entity reference`. Same class of
 * bug as the angle brackets, same fix, and it costs nothing to be defensive
 * about it here rather than to depend on the serializer's good behaviour.
 */
export function escapeAttributeMarkupChars(svg: string): string {
  return svg.replace(
    // ` name="value"` / ` xlink:href="value"` — attribute names in SVG may carry
    // a namespace prefix, a dot, or a dash.
    /(\s[\w:.-]+=")([^"]*)"/g,
    (match, prefix: string, value: string) => {
      // fast path
      if (
        !value.includes('<') &&
        !value.includes('>') &&
        !value.includes('&')
      ) {
        return match;
      }
      // Ampersands first, so the `&` in a `&lt;` this pass just produced is
      // never a candidate for escaping.
      return `${prefix}${value
        .replace(BARE_AMPERSAND, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}"`;
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
  return escapeAttributeMarkupChars(svgEl.outerHTML);
}

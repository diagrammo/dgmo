// ============================================================
// Inline Markdown — shared parsing + SVG rendering for text fields
// ============================================================

import * as d3Selection from 'd3-selection';
import type { PaletteColors } from '../palettes';
import { safeHref } from './safe-href';

export interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
}

export function parseInlineMarkdown(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const regex =
    /\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|`(.+?)`|\[(.+?)\]\((.+?)\)|(https?:\/\/[^\s)>\]]+|www\.[^\s)>\]]+)|([^*_`[]+?(?=https?:\/\/|www\.|$)|[^*_`[]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1])
      spans.push({ text: match[1], bold: true }); // **bold**
    else if (match[2])
      spans.push({ text: match[2], bold: true }); // __bold__
    else if (match[3])
      spans.push({ text: match[3], italic: true }); // *italic*
    else if (match[4])
      spans.push({ text: match[4], italic: true }); // _italic_
    else if (match[5])
      spans.push({ text: match[5], code: true }); // `code`
    else if (match[6])
      spans.push({ text: match[6], href: match[7] }); // [text](url)
    else if (match[8]) {
      // bare URL
      const url = match[8];
      const href = url.startsWith('www.') ? `https://${url}` : url;
      spans.push({ text: url, href });
    } else if (match[9]) spans.push({ text: match[9] }); // plain text
  }
  return spans;
}

const BARE_URL_MAX_DISPLAY = 35;

export function truncateBareUrl(url: string): string {
  const stripped = url.replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (stripped.length <= BARE_URL_MAX_DISPLAY) return stripped;
  return stripped.slice(0, BARE_URL_MAX_DISPLAY - 1) + '\u2026';
}

export function renderInlineText(
  textEl: d3Selection.Selection<SVGTextElement, unknown, null, undefined>,
  text: string,
  palette: PaletteColors,
  fontSize?: number
): void {
  const spans = parseInlineMarkdown(text);
  for (const span of spans) {
    if (span.href) {
      // Bare URLs (text === href or href with https:// prepended) get truncated display;
      // markdown links [text](url) keep their user-chosen text as-is.
      const isBareUrl =
        span.text === span.href || `https://${span.text}` === span.href;
      const display = isBareUrl ? truncateBareUrl(span.text) : span.text;
      const safe = safeHref(span.href);
      if (safe !== null) {
        const a = textEl.append('a').attr('href', safe);
        a.append('tspan')
          .text(display)
          .attr('fill', palette.primary)
          .style('text-decoration', 'underline');
      } else {
        // Disallowed protocol — render as inert text, no anchor.
        textEl
          .append('tspan')
          .text(display)
          .attr('fill', palette.primary)
          .style('text-decoration', 'underline');
      }
    } else {
      const tspan = textEl.append('tspan').text(span.text);
      if (span.bold) tspan.attr('font-weight', 'bold');
      if (span.italic) tspan.attr('font-style', 'italic');
      if (span.code) {
        tspan.attr('font-family', 'monospace');
        if (fontSize) tspan.attr('font-size', fontSize - 1);
      }
    }
  }
}

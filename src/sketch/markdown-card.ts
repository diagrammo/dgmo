// ============================================================
// Sketch markdown-card renderer (resvg-safe)
// ============================================================
//
// A pure-SVG renderer for a small markdown subset drawn INSIDE sketch
// cards. It emits only <text>/<tspan>/<line> elements — NO foreignObject,
// NO CSS, NO HTML — so resvg (the PNG/SVG export path) renders it faithfully.
// Bold uses the `font-weight="bold"` attribute (Inter Bold is bundled); link
// underlines are drawn as explicit <line>s rather than text-decoration, which
// resvg does not honor reliably.
//
// Supported subset (see spec §31 sketch cards):
//   - 2-space / tab leading indent → indent levels (12px each)
//   - `- ` / `* ` bullets with hanging indent
//   - **bold** inline runs
//   - [label](url) links (url stashed on data-href for app click handling)
//   - word-wrap to a pixel width

import type { D3Sel } from '../utils/legend-types';
import { measureText } from '../utils/text-measure';

export interface MarkdownBlockOptions {
  width: number; // available text width in px (wrap boundary)
  fontSize: number; // base font size px
  lineHeight: number; // px advance per rendered line
  color: string; // normal text fill
  linkColor: string; // link text fill
  maxLines?: number; // optional clamp; truncate last shown line with an ellipsis
  /** Suppress the clamp ellipsis (caller draws its own overflow marker). */
  noEllipsis?: boolean;
}

const INDENT_PX = 12;
const BULLET_HANG_PX = 12;
const ELLIPSIS = '…';
const BULLET = '•';

/** An inline styled segment produced by parsing one logical line. */
interface Segment {
  text: string;
  bold: boolean;
  href?: string;
}

/** A single visual (post-wrap) line: its segments + the x where text starts. */
interface VisualLine {
  segments: Segment[];
  x: number; // x offset of the first glyph
  bulletX?: number; // if set, draw a bullet marker here
}

/** Measure a segment's rendered width in the face it is drawn in. */
function segWidth(
  seg: { text: string; bold: boolean },
  fontSize: number
): number {
  // A bold run used to be the regular width scaled by a flat 1.06 guess, from
  // before the width model carried Inter Bold's own advances (issue 167).
  return measureText(seg.text, fontSize, { bold: seg.bold });
}

/**
 * Parse inline `**bold**` and `[label](url)` markup into styled segments.
 * Everything else is plain text. Brackets/parens/asterisks are consumed.
 */
function parseInline(text: string): Segment[] {
  const segments: Segment[] = [];
  // Alternation: bold | link | plain-run (stop before ** or [).
  const regex = /\*\*(.+?)\*\*|\[([^\]]*)\]\(([^)]*)\)|((?:(?!\*\*|\[).)+)/gs;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m[1] !== undefined) {
      segments.push({ text: m[1], bold: true });
    } else if (m[2] !== undefined) {
      segments.push({ text: m[2], bold: false, ...(m[3] && { href: m[3] }) });
    } else if (m[4] !== undefined) {
      segments.push({ text: m[4], bold: false });
    }
  }
  return segments;
}

/**
 * Tokenize inline segments into (whitespace-delimited) words, each word being
 * a list of sub-segments so a single word can carry mixed styling. This lets
 * word-wrap operate on words while preserving bold/link runs.
 */
interface WordPiece {
  text: string;
  bold: boolean;
  href?: string;
}
type Word = WordPiece[];

function segmentsToWords(segments: Segment[]): Word[] {
  const words: Word[] = [];
  let current: Word = [];
  for (const seg of segments) {
    // Split on whitespace but keep track of gaps between words.
    const parts = seg.text.split(/(\s+)/);
    for (const part of parts) {
      if (part === '') continue;
      if (/^\s+$/.test(part)) {
        // Whitespace ends the current word.
        if (current.length > 0) {
          words.push(current);
          current = [];
        }
      } else {
        current.push({
          text: part,
          bold: seg.bold,
          ...(seg.href !== undefined && { href: seg.href }),
        });
      }
    }
  }
  if (current.length > 0) words.push(current);
  return words;
}

function wordWidth(word: Word, fontSize: number): number {
  let w = 0;
  for (const piece of word) w += segWidth(piece, fontSize);
  return w;
}

/** Merge adjacent pieces that share bold+href into single segments. */
function coalesce(pieces: WordPiece[]): Segment[] {
  const out: Segment[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last?.bold === p.bold && last.href === p.href) {
      last.text += p.text;
    } else {
      out.push({
        text: p.text,
        bold: p.bold,
        ...(p.href !== undefined && { href: p.href }),
      });
    }
  }
  return out;
}

/**
 * Word-wrap a logical line's segments into visual lines within `avail` px.
 * `textX` is where glyphs start; wrapped continuation lines reuse `textX`
 * (the hanging indent for bullets is baked into `textX`).
 */
function wrapSegments(
  segments: Segment[],
  fontSize: number,
  avail: number,
  textX: number,
  bulletX: number | undefined
): VisualLine[] {
  const words = segmentsToWords(segments);
  if (words.length === 0) {
    return [
      { segments: [], x: textX, ...(bulletX !== undefined && { bulletX }) },
    ];
  }
  const spaceW = measureText(' ', fontSize);
  const lines: VisualLine[] = [];
  let currentPieces: WordPiece[] = [];
  let currentW = 0;
  let first = true;

  const flush = () => {
    lines.push({
      segments: coalesce(currentPieces),
      x: textX,
      // only the FIRST visual line of a bullet carries the marker
      ...(first && bulletX !== undefined && { bulletX }),
    });
    first = false;
    currentPieces = [];
    currentW = 0;
  };

  for (const word of words) {
    const ww = wordWidth(word, fontSize);
    const addW = currentPieces.length === 0 ? ww : spaceW + ww;
    if (currentPieces.length > 0 && currentW + addW > avail) {
      flush();
      currentPieces.push(...word);
      currentW = ww;
    } else {
      if (currentPieces.length > 0) {
        currentPieces.push({ text: ' ', bold: false });
        currentW += spaceW;
      }
      currentPieces.push(...word);
      currentW += ww;
    }
  }
  flush();
  return lines;
}

/**
 * Parse one logical (newline-delimited) source line into its indent level,
 * bullet flag, and inline content.
 */
function parseLogicalLine(raw: string): {
  level: number;
  bullet: boolean;
  content: string;
} {
  // Count leading indent: each tab or each 2 spaces = one level.
  let i = 0;
  let level = 0;
  let spaceRun = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\t') {
      level += 1;
      i += 1;
      spaceRun = 0;
    } else if (ch === ' ') {
      spaceRun += 1;
      i += 1;
      if (spaceRun === 2) {
        level += 1;
        spaceRun = 0;
      }
    } else {
      break;
    }
  }
  let content = raw.slice(i);
  let bullet = false;
  if (content.startsWith('- ') || content.startsWith('* ')) {
    bullet = true;
    content = content.slice(2);
  }
  return { level, bullet, content };
}

export interface MarkdownBlockResult {
  /** Total height used (px). */
  height: number;
  /** Visual lines actually drawn (after the maxLines clamp). */
  shown: number;
  /** Visual lines the text wanted before clamping. */
  total: number;
}

/**
 * Draw markdown into `container` (an SVG <g>), positioned from local (0,0)
 * with the FIRST baseline at y = fontSize.
 */
export function drawMarkdownBlock(
  container: D3Sel,
  text: string,
  opts: MarkdownBlockOptions
): MarkdownBlockResult {
  const { width, fontSize, lineHeight, color, linkColor, maxLines } = opts;

  // 1. Build the full list of visual lines across all logical lines.
  const visualLines: VisualLine[] = [];
  for (const raw of text.split('\n')) {
    const { level, bullet, content } = parseLogicalLine(raw);
    const indentX = level * INDENT_PX;
    const textX = bullet ? indentX + BULLET_HANG_PX : indentX;
    const avail = Math.max(1, width - textX);
    const segments = parseInline(content);
    const wrapped = wrapSegments(
      segments,
      fontSize,
      avail,
      textX,
      bullet ? indentX : undefined
    );
    visualLines.push(...wrapped);
  }

  // 2. Apply the maxLines clamp (ellipsize the last shown line).
  let shown = visualLines;
  let clamped = false;
  if (maxLines !== undefined && visualLines.length > maxLines) {
    shown = visualLines.slice(0, maxLines);
    clamped = true;
  }

  // 3. Emit each visual line as one <text> with <tspan> children.
  for (let li = 0; li < shown.length; li++) {
    const line = shown[li]!;
    const y = fontSize + li * lineHeight;
    const isLast = li === shown.length - 1;

    // Bullet marker (its own <text> at the indent x).
    if (line.bulletX !== undefined) {
      container
        .append('text')
        .attr('x', line.bulletX)
        .attr('y', y)
        .attr('fill', color)
        .attr('font-size', fontSize)
        .text(BULLET);
    }

    const textEl = container
      .append('text')
      .attr('x', line.x)
      .attr('y', y)
      .attr('font-size', fontSize);

    // Track cumulative x so link underlines land under the right run.
    let cursorX = line.x;
    const segs = line.segments.slice();
    // Append an ellipsis to the final clamped line.
    if (clamped && isLast && !opts.noEllipsis) {
      segs.push({ text: ELLIPSIS, bold: false });
    }

    for (const seg of segs) {
      const tspan = textEl
        .append('tspan')
        .attr('x', cursorX)
        .attr('fill', seg.href !== undefined ? linkColor : color)
        .text(seg.text);
      if (seg.bold) tspan.attr('font-weight', 'bold');
      const w = segWidth(seg, fontSize);
      if (seg.href !== undefined) {
        tspan.attr('data-href', seg.href);
        // Explicit underline (resvg-safe), under this run only.
        container
          .append('line')
          .attr('x1', cursorX)
          .attr('y1', y + 1.5)
          .attr('x2', cursorX + w)
          .attr('y2', y + 1.5)
          .attr('stroke', linkColor)
          .attr('stroke-width', 1);
      }
      cursorX += w;
    }
  }

  // 4. Total height: one lineHeight per visual line.
  return {
    height: shown.length * lineHeight,
    shown: shown.length,
    total: visualLines.length,
  };
}

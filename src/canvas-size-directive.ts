// ============================================================
// The `size` and `aspect` lines — a diagram carries its own canvas (#1966)
// ============================================================
//
//   size 1200x675     the canvas, the same as `--width 1200 --height 675`
//   aspect 16:9       the height from the width — the caller's, or the
//                     1200px export width when the caller gives none
//
// Both are reserved on EVERY chart type. `render()` and `parseDgmo()` lift
// them out before any chart parser sees them, as they lift `palette`: each
// lifted line becomes an empty `//` comment, so every later line keeps its
// number. A caller's width or height beats the file's, one dimension at a
// time, so a CLI `--width` overrides only the width.
//
// The one clash: wordcloud's own `size <min> <max>` (the word-size range).
// On a wordcloud a `size` line is the canvas only when it is `<W>x<H>`;
// any other `size` line is left for the wordcloud parser.

import { makeDgmoError, type DgmoError } from './diagnostics';
import { EXPORT_WIDTH } from './utils/d3-helpers';

export interface CanvasSizeDirective {
  /** The source with every lifted `size` / `aspect` line turned into `//`. */
  content: string;
  /** `size WxH` — both dimensions, in canvas px. */
  size?: { width: number; height: number };
  /** `aspect W:H` — the ratio of width to height. */
  aspect?: { width: number; height: number };
  diagnostics: DgmoError[];
}

const LINE_RE = /^(size|aspect)(?:\s+(.*?))?(?<!\s)\s*$/;
const SIZE_RE = /^(\d+)x(\d+)$/;
const ASPECT_RE = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;

const bad = (line: number, message: string): DgmoError =>
  makeDgmoError(line, message, 'error', 'E_CANVAS_SIZE_INVALID');

/**
 * Lift the file's `size` and `aspect` lines. `chartType` is the detected
 * chart type, or null; it decides only the wordcloud exception.
 */
export function extractCanvasSizeDirective(
  content: string,
  chartType: string | null
): CanvasSizeDirective {
  if (!/^(?:size|aspect)\b/m.test(content)) return { content, diagnostics: [] };

  const lines = content.split('\n');
  const diagnostics: DgmoError[] = [];
  let size: CanvasSizeDirective['size'];
  let aspect: CanvasSizeDirective['aspect'];
  let firstLine: number | undefined;

  for (let i = 0; i < lines.length; i++) {
    const match = LINE_RE.exec(lines[i]!.replace(/\r$/, ''));
    if (!match) continue;
    const keyword = match[1]!;
    const value = match[2] ?? '';
    const lineNumber = i + 1;

    if (keyword === 'size') {
      const m = SIZE_RE.exec(value);
      // wordcloud keeps `size <min> <max>`; only `WxH` is the canvas there.
      if (!m && chartType === 'wordcloud') continue;
      lines[i] = '//';
      if (!m) {
        diagnostics.push(
          bad(
            lineNumber,
            `"size" takes a width and a height in px, like "size 1200x675".`
          )
        );
        continue;
      }
      const width = Number(m[1]);
      const height = Number(m[2]);
      if (width <= 0 || height <= 0) {
        diagnostics.push(
          bad(lineNumber, `"size ${value}" needs a width and height above 0.`)
        );
        continue;
      }
      if (firstLine !== undefined) {
        diagnostics.push(
          bad(
            lineNumber,
            `The canvas is already set on line ${firstLine} — keep one "size" or "aspect" line.`
          )
        );
        continue;
      }
      firstLine = lineNumber;
      size = { width, height };
      continue;
    }

    lines[i] = '//';
    const m = ASPECT_RE.exec(value);
    if (!m) {
      diagnostics.push(
        bad(
          lineNumber,
          `"aspect" takes a width-to-height ratio, like "aspect 16:9".`
        )
      );
      continue;
    }
    const width = Number(m[1]);
    const height = Number(m[2]);
    if (!(width > 0) || !(height > 0)) {
      diagnostics.push(
        bad(lineNumber, `"aspect ${value}" needs both sides above 0.`)
      );
      continue;
    }
    if (firstLine !== undefined) {
      diagnostics.push(
        bad(
          lineNumber,
          `The canvas is already set on line ${firstLine} — keep one "size" or "aspect" line.`
        )
      );
      continue;
    }
    firstLine = lineNumber;
    aspect = { width, height };
  }

  return {
    content: lines.join('\n'),
    ...(size && { size }),
    ...(aspect && { aspect }),
    diagnostics,
  };
}

/**
 * The canvas to draw onto: the caller's width and height first, one
 * dimension at a time, then the file's `size` or `aspect`. An `aspect`
 * sets the height from the width — the caller's, or `EXPORT_WIDTH`.
 */
export function resolveCanvasSize(
  directive: Pick<CanvasSizeDirective, 'size' | 'aspect'>,
  asked: { width?: number | undefined; height?: number | undefined }
): { width?: number; height?: number } {
  let width = asked.width ?? directive.size?.width;
  let height = asked.height ?? directive.size?.height;
  if (directive.aspect && asked.height === undefined) {
    width ??= EXPORT_WIDTH;
    height = Math.round(
      (width * directive.aspect.height) / directive.aspect.width
    );
  }
  return {
    ...(width !== undefined && { width }),
    ...(height !== undefined && { height }),
  };
}

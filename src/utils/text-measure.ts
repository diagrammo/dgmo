// ============================================================
// Shared text measurement
// ============================================================
// One source of truth for "how wide is this string?" Before this
// module, ~30 renderers/layouts each carried their own char-width
// estimate (7.5px, 7px, 0.6·fontSize, 0.58, 0.55 …). The drift meant
// the same label measured differently per chart type — a label could
// fit inside an org node but overflow an infra node. All sizing,
// wrapping, and truncation now route through the per-glyph table here.

// Helvetica character width ratios (fraction of fontSize). Replaces the
// naive `chars * 0.6 * fontSize` estimate with per-character widths.
// prettier-ignore
const CHAR_W: Record<string, number> = {
  ' ':.28,'!': .28,'"': .36,'#': .56,'$': .56,'%': .89,'&': .67,"'":.19,
  '(':.33,')':.33,'*': .39,'+':.58,',':.28,'-':.33,'.':.28,'/':.28,
  '0':.56,'1':.56,'2':.56,'3':.56,'4':.56,'5':.56,'6':.56,'7':.56,'8':.56,'9':.56,
  ':':.28,';':.28,'<':.58,'=':.58,'>':.58,'?':.56,'@':1.02,
  A:.67,B:.67,C:.72,D:.72,E:.67,F:.61,G:.78,H:.72,I:.28,J:.50,K:.67,L:.56,M:.83,
  N:.72,O:.78,P:.67,Q:.78,R:.72,S:.67,T:.61,U:.72,V:.67,W:.94,X:.67,Y:.67,Z:.61,
  a:.56,b:.56,c:.50,d:.56,e:.56,f:.28,g:.56,h:.56,i:.22,j:.22,k:.50,l:.22,m:.83,
  n:.56,o:.56,p:.56,q:.56,r:.33,s:.50,t:.28,u:.56,v:.50,w:.72,x:.50,y:.50,z:.50,
};
const DEFAULT_W = 0.56;

/**
 * Average glyph-width ratio (fraction of fontSize). Only for the rare
 * call site that needs a single scalar (e.g. estimating a max char count
 * up front). Prefer {@link measureText} / {@link wrapTextToWidth} —
 * they account for actual glyph widths.
 */
export const CHAR_WIDTH_RATIO = DEFAULT_W;

/** Estimate rendered text width using Helvetica proportional character widths. */
export function measureText(text: string, fontSize: number): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    // charAt returns '' for out-of-bounds, never undefined.
    w += (CHAR_W[text.charAt(i)] ?? DEFAULT_W) * fontSize;
  }
  return w;
}

/**
 * Truncate text with a trailing ellipsis to fit within maxWidth.
 * Returns the original text if it already fits, or '' if even the
 * ellipsis alone won't fit.
 */
export function truncateText(
  text: string,
  fontSize: number,
  maxWidth: number
): string {
  if (measureText(text, fontSize) <= maxWidth) return text;
  const ellipsis = '…';
  const ellipsisW = measureText(ellipsis, fontSize);
  if (ellipsisW > maxWidth) return '';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(text.slice(0, mid), fontSize) + ellipsisW <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo === 0 ? ellipsis : text.slice(0, lo) + ellipsis;
}

/**
 * Greedy word-wrap to a pixel width using accurate glyph measurement.
 *
 * - Splits on whitespace; a word that alone exceeds `maxWidth` is kept
 *   whole unless `hardBreak` is set, in which case it is broken at the
 *   character boundary that fits.
 * - Returns at least one line (`['']` for empty input).
 */
export function wrapTextToWidth(
  text: string,
  fontSize: number,
  maxWidth: number,
  opts?: { hardBreak?: boolean }
): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];
  const hardBreak = opts?.hardBreak ?? false;
  const lines: string[] = [];
  let current = '';
  const pushWord = (word: string) => {
    const test = current ? `${current} ${word}` : word;
    if (measureText(test, fontSize) <= maxWidth || !current) {
      current = test;
    } else {
      lines.push(current);
      current = word;
    }
  };
  for (const word of words) {
    if (hardBreak && measureText(word, fontSize) > maxWidth) {
      // Break the over-long word into width-fitting chunks.
      if (current) {
        lines.push(current);
        current = '';
      }
      let chunk = '';
      for (const ch of word) {
        if (chunk && measureText(chunk + ch, fontSize) > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      current = chunk;
      continue;
    }
    pushWord(word);
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

// ── Sketch text-fit chain (spec §31.2: shrink → smart-wrap → ellipsis) ──

/**
 * Split a word at smart boundaries — dashes (kept on the left piece) and
 * camelCase transitions — so over-long tokens wrap inside a fixed footprint
 * before falling back to a hard character break.
 */
export function splitWordSmart(word: string): string[] {
  const pieces: string[] = [];
  // Dash boundaries first: "well-known" → "well-", "known".
  for (const dashPiece of word.split(/(?<=-)/)) {
    // camelCase boundaries: "PlankScheduler" → "Plank", "Scheduler".
    const camel = dashPiece.split(/(?<=[a-z0-9])(?=[A-Z])/);
    pieces.push(...camel);
  }
  return pieces.filter((p) => p.length > 0);
}

export interface FitTextOptions {
  readonly maxWidth: number;
  readonly maxLines: number;
  /** preferred font size; the chain may shrink ONE step below it */
  readonly fontSize: number;
}

export interface FitTextResult {
  readonly lines: readonly string[];
  readonly fontSize: number;
}

/**
 * Fit text into a fixed box: try the base font size on one line, shrink one
 * step, then smart-wrap (space / dash / camelCase) at the shrunk size, and
 * finally ellipsize the last line. The box NEVER grows.
 */
export function fitTextToBox(
  text: string,
  { maxWidth, maxLines, fontSize }: FitTextOptions
): FitTextResult {
  const trimmed = text.trim();
  if (measureText(trimmed, fontSize) <= maxWidth) {
    return { lines: [trimmed], fontSize };
  }
  const shrunk = fontSize - 1;
  if (measureText(trimmed, shrunk) <= maxWidth) {
    return { lines: [trimmed], fontSize: shrunk };
  }

  // Smart-wrap at the shrunk size: greedy fill over smart-split tokens.
  const tokens = trimmed.split(/\s+/).flatMap(splitWordSmart);
  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    const joiner = current === '' || current.endsWith('-') ? '' : ' ';
    const candidate = current + joiner + token;
    if (current !== '' && measureText(candidate, shrunk) > maxWidth) {
      lines.push(current);
      current = token;
    } else {
      current = candidate;
    }
  }
  if (current !== '') lines.push(current);

  if (lines.length <= maxLines) {
    return { lines, fontSize: shrunk };
  }
  const kept = lines.slice(0, maxLines);
  const rest = lines.slice(maxLines - 1).join(' ');
  kept[maxLines - 1] = truncateText(rest, shrunk, maxWidth) || '…';
  return { lines: kept, fontSize: shrunk };
}

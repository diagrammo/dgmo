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

// The width model is a pure left-to-right fold over per-char ratios, and the
// same (text, fontSize) pairs recur heavily across layouts (dagre node sizing
// can run ~89 layouts per render). Memoize whole-string results; capped so
// unbounded distinct labels can't grow the map forever.
const MEASURE_CACHE = new Map<string, number>();
const MEASURE_CACHE_MAX = 10000;

/**
 * Extend a running width `acc` with `text`'s characters, in the same
 * left-to-right fold order `measureText` uses. Continuing the fold this way is
 * bit-identical to measuring the concatenated string whole (per-char additive
 * model, no kerning), which lets wrap/truncate accumulate widths incrementally
 * instead of re-measuring growing strings.
 */
function extendWidth(acc: number, text: string, fontSize: number): number {
  let w = acc;
  for (let i = 0; i < text.length; i++) {
    // charAt returns '' for out-of-bounds, never undefined.
    w += (CHAR_W[text.charAt(i)] ?? DEFAULT_W) * fontSize;
  }
  return w;
}

/** Estimate rendered text width using Helvetica proportional character widths. */
export function measureText(text: string, fontSize: number): number {
  const key = `${fontSize}|${text}`;
  const cached = MEASURE_CACHE.get(key);
  if (cached !== undefined) return cached;
  const w = extendWidth(0, text, fontSize);
  if (MEASURE_CACHE.size >= MEASURE_CACHE_MAX) MEASURE_CACHE.clear();
  MEASURE_CACHE.set(key, w);
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
  // Cumulative prefix widths, computed once: prefix[i] equals
  // measureText(text.slice(0, i), fontSize) exactly (same fold order), so the
  // bisection below never re-measures slices.
  const prefix: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    prefix.push(extendWidth(prefix[i]!, text.charAt(i), fontSize));
  }
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (prefix[mid]! + ellipsisW <= maxWidth) {
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
  const spaceW = (CHAR_W[' '] ?? DEFAULT_W) * fontSize;
  const lines: string[] = [];
  let current = '';
  // Running width of `current`, extended incrementally instead of re-measuring
  // the growing line per word (O(n²) → O(n)). Continuing the char fold gives
  // bit-identical widths to measuring the joined string whole.
  let currentW = 0;
  const pushWord = (word: string) => {
    const testW = extendWidth(current ? currentW + spaceW : 0, word, fontSize);
    if (testW <= maxWidth || !current) {
      current = current ? `${current} ${word}` : word;
      currentW = testW;
    } else {
      lines.push(current);
      current = word;
      currentW = extendWidth(0, word, fontSize);
    }
  };
  for (const word of words) {
    if (hardBreak && measureText(word, fontSize) > maxWidth) {
      // Break the over-long word into width-fitting chunks.
      if (current) {
        lines.push(current);
        current = '';
        currentW = 0;
      }
      let chunk = '';
      let chunkW = 0;
      for (const ch of word) {
        const candW = extendWidth(chunkW, ch, fontSize);
        if (chunk && candW > maxWidth) {
          lines.push(chunk);
          chunk = ch;
          chunkW = extendWidth(0, ch, fontSize);
        } else {
          chunk += ch;
          chunkW = candW;
        }
      }
      current = chunk;
      currentW = chunkW;
      continue;
    }
    pushWord(word);
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

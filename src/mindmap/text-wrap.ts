// ============================================================
// Mindmap Text Wrapping
// ============================================================
//
// Shared logic for wrapping node labels and descriptions into
// multiple lines. Used by both layout (for sizing) and renderer
// (for drawing). Ensures both agree on line breaks and font size.

import { preprocessDescriptionLine } from '../utils/description-helpers';

const CHAR_WIDTH_RATIO = 0.58; // avg char width / fontSize for Helvetica
const H_PAD = 16; // 8px padding each side
const MAX_LABEL_LINES = 3;
const MAX_DESC_LINES = 2;

/** Split text into tokens, keeping hyphens attached to the left word. */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // Split on spaces, and after hyphens (keep hyphen with left token)
  const parts = text.split(/(\s+)/);
  for (const part of parts) {
    if (/^\s+$/.test(part)) continue; // skip whitespace tokens
    // Further split on hyphens: "well-known" → ["well-", "known"]
    const hyphenParts = part.split(/(?<=-)(?=\S)/);
    tokens.push(...hyphenParts);
  }
  return tokens;
}

/**
 * Wrap text into lines that fit within maxWidth at the given fontSize.
 * Returns null if the text doesn't fit within maxLines.
 */
function tryWrap(
  tokens: string[],
  maxWidth: number,
  fontSize: number,
  maxLines: number
): string[] | null {
  const availWidth = maxWidth - H_PAD;
  const charWidth = fontSize * CHAR_WIDTH_RATIO;
  const maxChars = Math.max(1, Math.floor(availWidth / charWidth));

  const lines: string[] = [];
  let currentLine = '';

  for (const token of tokens) {
    // After a hyphen-ending token, don't add a space
    const sep = currentLine && !currentLine.endsWith('-') ? ' ' : '';
    const candidate = currentLine + sep + token;

    if (candidate.length <= maxChars) {
      currentLine = candidate;
    } else if (!currentLine) {
      // Single token exceeds line — force it onto this line (will be truncated later if needed)
      currentLine = token;
    } else {
      // Push current line, start new one
      lines.push(currentLine);
      if (lines.length >= maxLines) {
        // Can't fit — return null to signal overflow
        return null;
      }
      currentLine = token;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }

  if (lines.length > maxLines) return null;
  return lines;
}

/** Truncate the last line of a lines array with ellipsis to fit maxChars. */
function truncateLastLine(
  lines: string[],
  maxWidth: number,
  fontSize: number
): string[] {
  const availWidth = maxWidth - H_PAD;
  const charWidth = fontSize * CHAR_WIDTH_RATIO;
  const maxChars = Math.max(1, Math.floor(availWidth / charWidth));

  const result = [...lines];
  const last = result[result.length - 1];
  if (last.length > maxChars) {
    result[result.length - 1] = last.substring(0, maxChars - 1) + '\u2026';
  }
  return result;
}

interface WrapResult {
  lines: string[];
  fontSize: number;
}

/**
 * Wrap text to fit within a node of the given maxWidth.
 * Tries wrapping at baseFontSize first. If text doesn't fit within
 * maxLines, reduces font size by 1px at a time down to minFontSize.
 * As a last resort, truncates the final line with ellipsis.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  baseFontSize: number,
  minFontSize: number,
  maxLines: number = MAX_LABEL_LINES
): WrapResult {
  if (!text) return { lines: [''], fontSize: baseFontSize };

  const tokens = tokenize(text);

  // Try at each font size from base down to min
  for (let fs = baseFontSize; fs >= minFontSize; fs--) {
    const lines = tryWrap(tokens, maxWidth, fs, maxLines);
    if (lines) {
      // Ensure each line fits (truncate overly long single tokens)
      return { lines: truncateLastLine(lines, maxWidth, fs), fontSize: fs };
    }
  }

  // Last resort: wrap at minFontSize with unlimited lines, then take first maxLines
  const allLines = tryWrap(tokens, maxWidth, minFontSize, 999) ?? [text];
  const capped = allLines.slice(0, maxLines);
  const truncated = truncateLastLine(capped, maxWidth, minFontSize);
  // If we dropped lines, append ellipsis to indicate overflow
  if (allLines.length > maxLines) {
    const last = truncated[truncated.length - 1];
    if (!last.endsWith('\u2026')) {
      const availWidth = maxWidth - H_PAD;
      const charWidth = minFontSize * CHAR_WIDTH_RATIO;
      const maxChars = Math.max(1, Math.floor(availWidth / charWidth));
      if (last.length >= maxChars - 1) {
        truncated[truncated.length - 1] =
          last.substring(0, maxChars - 1) + '\u2026';
      } else {
        truncated[truncated.length - 1] = last + '\u2026';
      }
    }
  }
  return {
    lines: truncated,
    fontSize: minFontSize,
  };
}

// ============================================================
// Compute full node text layout (shared between layout + renderer)
// ============================================================

const ROOT_FONT_SIZE = 17;
const MIN_FONT_SIZE = 9;
const FONT_STEP = 3;
const DESC_FONT_SIZE = 10;

function labelFontSize(depth: number): number {
  return Math.max(MIN_FONT_SIZE, ROOT_FONT_SIZE - depth * FONT_STEP);
}

interface NodeTextLayout {
  labelLines: string[];
  labelFontSize: number;
  descLines: string[];
  descFontSize: number;
}

/**
 * Compute wrapped text layout for a mindmap node.
 * Called by both layout (for height) and renderer (for drawing).
 */
export function computeNodeText(
  label: string,
  description: string[] | undefined,
  depth: number,
  nodeWidth: number,
  hideDescriptions: boolean
): NodeTextLayout {
  const baseFontSize = labelFontSize(depth);
  const labelResult = wrapText(
    label,
    nodeWidth,
    baseFontSize,
    MIN_FONT_SIZE,
    MAX_LABEL_LINES
  );

  const descLines: string[] = [];
  let descFontSize = DESC_FONT_SIZE;
  if (!hideDescriptions && description && description.length > 0) {
    // Wrap each description line independently so bullets and line breaks are preserved.
    // Cap total output lines at MAX_DESC_LINES across all input lines.
    let remaining = MAX_DESC_LINES;
    for (const rawLine of description) {
      if (remaining <= 0) break;
      const line = preprocessDescriptionLine(rawLine);
      const lineResult = wrapText(
        line,
        nodeWidth,
        DESC_FONT_SIZE,
        DESC_FONT_SIZE,
        remaining
      );
      descLines.push(...lineResult.lines);
      remaining -= lineResult.lines.length;
      descFontSize = lineResult.fontSize;
    }
  }

  return {
    labelLines: labelResult.lines,
    labelFontSize: labelResult.fontSize,
    descLines,
    descFontSize,
  };
}

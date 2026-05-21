/**
 * Standalone DGMO syntax highlighter — no CodeMirror dependency.
 *
 * Exports:
 *   - `highlightDgmo(source)` → `HighlightToken[]` (consumer-agnostic)
 *   - `NORD_ROLE_STYLES` — inline style objects keyed by role (for React/Astro)
 *   - `ROLE_TO_ANSI` — ANSI escape codes keyed by role (for CLI)
 *
 * Uses the raw Lezer parser directly — keyword specialization is wired into
 * the grammar, so `parser.parse()` runs it automatically.
 *
 * @module @diagrammo/dgmo/highlight
 */

import { parser } from './dgmo.grammar.js';

// ============================================================
// Types
// ============================================================

export interface HighlightToken {
  text: string;
  role: string;
}

// ============================================================
// NODE_TO_ROLE — keep in sync with highlight.ts
// ============================================================

const NODE_TO_ROLE: Record<string, string> = {
  Comment: 'comment',
  ChartType: 'chartType',
  TagKeyword: 'definitionKeyword',
  DirectiveKeyword: 'keyword',
  ControlKeyword: 'controlKeyword',
  ModifierKeyword: 'modifier',
  SyncArrow: 'operator',
  AsyncArrow: 'operator',
  Dash: 'operator',
  Tilde: 'operator',
  Star: 'operator',
  Question: 'operator',
  Duration: 'number',
  DateLiteral: 'number',
  Number: 'number',
  Percentage: 'number',
  SectionMarker: 'heading',
  Url: 'url',
  OpenBracket: 'bracket',
  CloseBracket: 'bracket',
  OpenParen: 'bracket',
  CloseParen: 'bracket',
  OpenAngle: 'bracket',
  CloseAngle: 'bracket',
  Pipe: 'separator',
  Colon: 'separator',
  Plus: 'separator',
  Comma: 'punctuation',
  Punct: 'punctuation',
  Identifier: 'default',
};

// ============================================================
// Entity detection — keep in sync with entity-highlight.ts
// ============================================================

/** Tokens that have grammar-level styling which should be overridden in labels. */
const OVERRIDE_IN_LABEL = new Set([
  'ChartType',
  'TagKeyword',
  'DirectiveKeyword',
  'ControlKeyword',
  'ModifierKeyword',
  'Number',
  'Percentage',
  'Duration',
  'DateLiteral',
]);

/** Lines starting with these are keyword-led — not entity declarations. */
const KEYWORD_STARTS = new Set([
  'TagKeyword',
  'DirectiveKeyword',
  'ControlKeyword',
  'ModifierKeyword',
  'SectionMarker',
  'Comment',
  'Duration',
  'DateLiteral',
]);

// ============================================================
// Core: highlightDgmo()
// ============================================================

/**
 * Tokenize DGMO source into annotated highlight spans.
 *
 * Guarantees lossless round-trip:
 *   `highlightDgmo(src).map(t => t.text).join('') === src`
 */
export function highlightDgmo(source: string): HighlightToken[] {
  const tree = parser.parse(source);
  const tokens: HighlightToken[] = [];

  // Phase 1: Walk tree cursor, collect leaf tokens with gap filling
  let pos = 0;
  const cursor = tree.cursor();

  // Descend to leaves, process them, then advance via next() or parent+next()
  function descend(): void {
    for (;;) {
      // Try to go deeper
      if (cursor.firstChild()) continue;

      // At a leaf — emit it
      emitLeaf();

      // Try to advance to next sibling or ascend
      while (!cursor.nextSibling()) {
        if (!cursor.parent()) return; // back at root — done
      }

      // Now at next sibling — loop will try to descend into it
    }
  }

  function emitLeaf(): void {
    const from = cursor.from;
    const to = cursor.to;

    // Fill gap before this node
    if (from > pos) {
      tokens.push({ text: source.slice(pos, from), role: 'default' });
    }

    // Emit this leaf node
    if (to > from) {
      const role = NODE_TO_ROLE[cursor.name] ?? 'default';
      tokens.push({ text: source.slice(from, to), role });
    }

    pos = to;
  }

  descend();

  // Fill trailing gap
  if (pos < source.length) {
    tokens.push({ text: source.slice(pos, source.length), role: 'default' });
  }

  // Phase 2: Post-process — entity detection (label override only)
  applyLabelOverrides(tokens);

  // Phase 3: Post-process — note content detection
  applyNoteContent(tokens);

  return tokens;
}

// ============================================================
// Post-processing: label overrides
// ============================================================

interface LineTokenRef {
  /** Index into the flat token array. */
  idx: number;
  /** Grammar node name (looked up from role + NODE_TO_ROLE reverse). */
  nodeName: string;
}

/**
 * Override keyword/number tokens in message-label positions to `default` role.
 *
 * A "label" is the span between the first Dash/Tilde and the last arrow on a
 * content line. Tokens in OVERRIDE_IN_LABEL within that zone get their role
 * set to `default` so they render as plain text.
 *
 * Also handles ChartType tokens on non-first content lines — they become
 * `default` in labels.
 */
function applyLabelOverrides(tokens: HighlightToken[]): void {
  // Build reverse map: role → possible node names (for override detection)
  const ROLE_TO_NODES: Record<string, string[]> = {};
  for (const [node, role] of Object.entries(NODE_TO_ROLE)) {
    (ROLE_TO_NODES[role] ??= []).push(node);
  }

  // Split tokens into lines
  const lines: LineTokenRef[][] = [[]];
  for (let i = 0; i < tokens.length; i++) {
    // In-bounds by loop guard.
    const t = tokens[i]!;
    // lines is initialized to `[[]]`, so always at least 1 element.
    const currentLine = lines[lines.length - 1]!;
    const role = t.role;

    // Determine which node name this token likely had
    let nodeName = '';
    for (const [node, r] of Object.entries(NODE_TO_ROLE)) {
      if (r === role) {
        nodeName = node;
        break;
      }
    }
    // For roles mapping to multiple nodes, refine
    if (role === 'operator') {
      const text = t.text;
      if (text === '->' || text.endsWith('->')) nodeName = 'SyncArrow';
      else if (text === '~>' || text.endsWith('~>')) nodeName = 'AsyncArrow';
      else if (text === '-') nodeName = 'Dash';
      else if (text === '~') nodeName = 'Tilde';
      else if (text === '*') nodeName = 'Star';
      else if (text === '?') nodeName = 'Question';
    } else if (role === 'number') {
      const text = t.text;
      if (/^\d+[smhd]$/i.test(text)) nodeName = 'Duration';
      else if (/^\d{4}-\d{2}-\d{2}/.test(text)) nodeName = 'DateLiteral';
      else if (text.endsWith('%')) nodeName = 'Percentage';
      else nodeName = 'Number';
    } else if (role === 'bracket') {
      const text = t.text;
      if (text === '[') nodeName = 'OpenBracket';
      else if (text === ']') nodeName = 'CloseBracket';
      else if (text === '(') nodeName = 'OpenParen';
      else if (text === ')') nodeName = 'CloseParen';
      else if (text === '<') nodeName = 'OpenAngle';
      else if (text === '>') nodeName = 'CloseAngle';
    } else if (role === 'separator') {
      if (t.text === '|') nodeName = 'Pipe';
      else if (t.text === ':') nodeName = 'Colon';
      else if (t.text === '+') nodeName = 'Plus';
    } else if (role === 'punctuation') {
      if (t.text === ',') nodeName = 'Comma';
      else nodeName = 'Punct';
    }

    currentLine.push({ idx: i, nodeName });

    // Check if token text ends with newline — start a new line
    if (t.text.includes('\n')) {
      lines.push([]);
    }
  }

  // Track first content line (for ChartType handling)
  let seenFirstContent = false;

  for (const line of lines) {
    // Skip empty lines and whitespace-only
    // ref.idx is always a valid index into tokens (built from the same array).
    const nonWs = line.filter((ref) => tokens[ref.idx]!.text.trim().length > 0);
    if (nonWs.length === 0) continue;

    const firstTok = nonWs[0]!;

    // Skip keyword-led lines
    if (KEYWORD_STARTS.has(firstTok.nodeName)) continue;

    // First-line chart type — skip
    if (firstTok.nodeName === 'ChartType' && !seenFirstContent) {
      seenFirstContent = true;
      continue;
    }
    seenFirstContent = true;

    // Find structural boundaries within this line
    let firstDashTildeIdx = -1;
    let lastArrowIdx = -1;

    for (let li = 0; li < nonWs.length; li++) {
      const ref = nonWs[li]!;
      if (
        (ref.nodeName === 'Dash' || ref.nodeName === 'Tilde') &&
        firstDashTildeIdx < 0
      ) {
        firstDashTildeIdx = li;
      }
      if (ref.nodeName === 'SyncArrow' || ref.nodeName === 'AsyncArrow') {
        lastArrowIdx = li;
      }
    }

    const hasArrow = firstDashTildeIdx >= 0 && lastArrowIdx > firstDashTildeIdx;

    if (!hasArrow) continue;

    // Override tokens in label zone (between first dash/tilde and last arrow)
    for (let li = firstDashTildeIdx + 1; li < lastArrowIdx; li++) {
      const ref = nonWs[li]!;
      if (OVERRIDE_IN_LABEL.has(ref.nodeName)) {
        tokens[ref.idx]!.role = 'default';
      }
      // ChartType in label also overridden
      if (ref.nodeName === 'ChartType') {
        tokens[ref.idx]!.role = 'default';
      }
    }
  }
}

// ============================================================
// Post-processing: note content detection
// ============================================================

const NOTE_HEAD_RE = /^note(\s|$)/i;

/**
 * Detect `note` keyword lines and mark indented followers as `noteContent`.
 */
function applyNoteContent(tokens: HighlightToken[]): void {
  // Reconstruct lines from token text
  const fullText = tokens.map((t) => t.text).join('');
  const lines = fullText.split('\n');

  let inNote = false;
  let noteIndent = 0;
  let charOffset = 0;

  for (const lineText of lines) {
    const lineStart = charOffset;
    const lineEnd = charOffset + lineText.length;
    const trimmed = lineText.trimStart();
    const indent = lineText.length - trimmed.length;

    if (NOTE_HEAD_RE.test(trimmed)) {
      inNote = true;
      noteIndent = indent;
    } else if (inNote) {
      if (trimmed.length === 0) {
        // Blank line — stays in note block
      } else if (indent > noteIndent) {
        // Mark all tokens within this line range as noteContent
        markTokensInRange(tokens, lineStart, lineEnd, 'noteContent');
      } else {
        inNote = false;
      }
    }

    charOffset = lineEnd + 1; // +1 for the \n
  }
}

/**
 * Set the role of all tokens overlapping [from, to) to the given role.
 */
function markTokensInRange(
  tokens: HighlightToken[],
  from: number,
  to: number,
  role: string
): void {
  let pos = 0;
  for (const token of tokens) {
    const tokenEnd = pos + token.text.length;
    // Token overlaps range and is not just whitespace
    if (tokenEnd > from && pos < to && token.text.trim().length > 0) {
      token.role = role;
    }
    pos = tokenEnd;
  }
}

// ============================================================
// NORD_ROLE_STYLES — hardcoded Nord dark palette for static contexts
// ============================================================

export const NORD_ROLE_STYLES: Record<string, Record<string, string>> = {
  keyword: { color: '#81A1C1', fontWeight: 'bold' }, // nord9
  controlKeyword: { color: '#B48EAD', fontWeight: 'bold' }, // nord15
  definitionKeyword: { color: '#5E81AC', fontWeight: 'bold' }, // nord10
  modifier: { color: '#B48EAD' }, // nord15
  chartType: { color: '#D08770', fontWeight: 'bold' }, // nord12
  operator: { color: '#BF616A', fontWeight: 'bold' }, // nord11
  number: { color: '#B48EAD' }, // nord15
  comment: { color: '#616E88', fontStyle: 'italic' },
  heading: { color: '#D08770', fontWeight: 'bold' }, // nord12
  bracket: { color: '#5E81AC' }, // nord10
  separator: { color: '#88C0D0' }, // nord8
  url: { color: '#88C0D0', textDecoration: 'underline' }, // nord8
  colorAnnotation: { color: '#D08770', fontStyle: 'italic' }, // nord12
  punctuation: { color: '#616E88' },
  noteContent: { color: '#616E88', fontStyle: 'italic' },
  default: {},
};

// ============================================================
// ROLE_TO_ANSI — ANSI escape codes for CLI output
// ============================================================

export const ROLE_TO_ANSI: Record<string, string> = {
  comment: '\x1b[3;90m', // italic dim
  keyword: '\x1b[1;34m', // bold blue
  controlKeyword: '\x1b[1;35m', // bold magenta
  definitionKeyword: '\x1b[1;34m', // bold blue
  modifier: '\x1b[35m', // magenta
  chartType: '\x1b[1;33m', // bold yellow
  operator: '\x1b[1;31m', // bold red
  number: '\x1b[35m', // magenta
  heading: '\x1b[1;33m', // bold yellow
  bracket: '\x1b[34m', // blue
  separator: '\x1b[36m', // cyan
  url: '\x1b[4;36m', // underline cyan
  colorAnnotation: '\x1b[3;33m', // italic yellow
  punctuation: '\x1b[90m', // dim
  noteContent: '\x1b[3;90m', // italic dim
};

const ANSI_RESET = '\x1b[0m';

/**
 * Render highlighted tokens to an ANSI string for terminal display.
 */
export function renderAnsi(
  tokens: HighlightToken[],
  useColor: boolean
): string {
  if (!useColor) {
    return tokens.map((t) => t.text).join('');
  }

  let out = '';
  let inStyled = false;

  for (const token of tokens) {
    const ansi = ROLE_TO_ANSI[token.role];
    if (ansi) {
      if (inStyled) out += ANSI_RESET;
      out += ansi + token.text;
      inStyled = true;
    } else {
      if (inStyled) {
        out += ANSI_RESET;
        inStyled = false;
      }
      out += token.text;
    }
  }

  // Final reset to prevent terminal style leakage
  out += ANSI_RESET;
  return out;
}

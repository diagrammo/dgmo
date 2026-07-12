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
import { REGISTRY_COLON_KEY_TOKENS } from '../directives-registry';
import { monthIndex, weekdayIndex } from '../countdown/resolve';

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

// Exported so the both-path anti-drift guard (tests/highlight-roles.test.ts)
// can assert every emitted role has a render style (no orphan roles).
export const NODE_TO_ROLE: Record<string, string> = {
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
  // `|` is no longer DGMO's metadata delimiter as of 0.18.0 (§1.4).
  // Highlight legacy pipes in a deprecated-syntax color so authors
  // see the migration prompt visually before the parser diagnostic
  // fires. The lezer grammar still tokenizes `|` uniformly (it's a
  // valid character inside arrow labels and wireframe dropdowns), so
  // this paints surviving pipes too — acceptable noise for the
  // signal value during the 0.17.x → 0.18.0 transition.
  Pipe: 'deprecatedSyntax',
  Colon: 'separator',
  Plus: 'separator',
  Comma: 'punctuation',
  Punct: 'punctuation',
  QuotedString: 'string',
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
// Tokens that mark an arrow-label zone as text (vs a numeric offset/lag like
// `--1w->`). An offset is only Number/Duration; anything word-shaped — a plain
// Identifier or a keyword-class token — means the zone is a written label and
// its keyword tokens should demote to default.
const LABEL_WORD_NODES = new Set([
  'Identifier',
  'ChartType',
  'TagKeyword',
  'DirectiveKeyword',
  'ControlKeyword',
  'ModifierKeyword',
]);

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

  // Phase 2: Post-process — attribute key detection
  applyAttributeKeys(tokens);

  // Phase 3: Post-process — entity detection (label override only)
  applyLabelOverrides(tokens);

  // Phase 4: Post-process — note content detection
  applyNoteContent(tokens);

  // Phase 5: Post-process — countdown recurrence line (context-aware; no-op
  // for non-countdown docs).
  applyRecurringLine(tokens);

  return tokens;
}

// ============================================================
// Post-processing: attribute key detection
// ============================================================

/**
 * Colon `key: value` attribute keys that highlight as `propertyName`. This is
 * the single source of truth for attribute-key highlighting — the standalone
 * `applyAttributeKeys()` pass below and the desktop app's attribute-key
 * ViewPlugin both consume it, so the two render paths can't drift.
 */
export const ATTRIBUTE_KEYS = new Set([
  'emotion',
  'role',
  'icon',
  'location',
  'email',
  'phone',
  'type',
  'domain',
  'assignee',
  'due',
  'status',
  'progress',
  'offset',
  'confidence',
  'width',
  'fanout',
  'description',
  'score',
  'pain',
  'opportunity',
  'thought',
  'collapsed',
  'tech',
  'span',
  'split',
  // Map (§24B) + boxes-and-lines per-element numeric channel keys (decision #20):
  // `heat:` (region/box colour ramp), `size:` (POI marker), `width:` (edge stroke).
  // `width` is already listed above (shared with cycle); `size`/`heat` added here.
  // `value` is retained (legacy/no-op colon key) so any stray `value:` still reads
  // as a property rather than an error highlight.
  'size',
  'value',
  'label',
  'style',
  // Sketch (§31): shape morph + half-slot coordinate keys
  'shape',
  'at',
  // Treemap + boxes-and-lines + map colour-by-value channel key
  'heat',
  // Infra node behavior + edge colon-keys (§4) come from the single-source
  // directives registry — the parser accepts them only as `key: value` node
  // properties, so they render as `propertyName`. The dual-use top-level SLO
  // options stay bare in DIRECTIVE_KEYWORDS (see keywords.ts).
  ...REGISTRY_COLON_KEY_TOKENS,
]);

/**
 * Reclassify Identifier tokens as 'propertyName' when they are known
 * attribute keys followed (optionally with whitespace) by a colon.
 * This provides context-aware highlighting without grammar-level changes.
 */
function applyAttributeKeys(tokens: HighlightToken[]): void {
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i]!;
    if (t.role !== 'default') continue;
    if (!ATTRIBUTE_KEYS.has(t.text)) continue;

    // Look ahead past whitespace for a colon
    let j = i + 1;
    while (
      j < tokens.length &&
      tokens[j]!.role === 'default' &&
      tokens[j]!.text.trim() === ''
    ) {
      j++;
    }
    if (
      j < tokens.length &&
      tokens[j]!.text === ':' &&
      tokens[j]!.role === 'separator'
    ) {
      t.role = 'propertyName';
    }
  }
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
      if (t.text === ':') nodeName = 'Colon';
      else if (t.text === '+') nodeName = 'Plus';
    } else if (role === 'deprecatedSyntax') {
      if (t.text === '|') nodeName = 'Pipe';
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

    // If the label zone has no word tokens, it's an offset/lag pattern
    // (e.g. --1w->, just Number/Duration), not a text label — keep grammar
    // styling. A "word" is an Identifier OR any keyword-class token: a label
    // made entirely of keyword words (`-start now->`) is still text and must
    // demote, whereas an offset never contains a keyword.
    let labelHasWord = false;
    for (let li = firstDashTildeIdx + 1; li < lastArrowIdx; li++) {
      if (LABEL_WORD_NODES.has(nonWs[li]!.nodeName)) {
        labelHasWord = true;
        break;
      }
    }
    if (!labelHasWord) continue;

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
// Post-processing: countdown recurrence line
// ============================================================
//
// The recurrence line `every <cadence> [on …] [at …] [from …]` (and its
// standalone slot lines) is a fixed-slot grammar the flat Lezer tokenizer can't
// see — the whole line renders generically. This context-aware pass lights up
// the sub-keywords + closed instant vocab WITHOUT teaching them to the
// context-free specializer (which would leak `on`/`at`/`from` into every prose
// label in every chart). Gated on the countdown chart type + the leader word,
// so it only fires on real recurrence lines. Shared with the desktop editor's
// ViewPlugin via `classifyRecurrenceLine` so the two render paths can't drift.

/** A role override for one token span on a recurrence line. */
export interface RecurrenceSpan {
  /** Char offset of the token within the line. */
  start: number;
  /** Char offset (exclusive) of the token end within the line. */
  end: number;
  role: 'keyword' | 'modifier';
}

/** Line leaders that open a recurrence line or a standalone slot line. */
const RECUR_LEADERS = new Set([
  'every',
  'on',
  'at',
  'from',
  'on-day',
  'since-label',
]);
/** Connector sub-keywords inside `every …`. */
const RECUR_CONNECTORS = new Set(['on', 'at', 'from']);
/** Cadence unit words (only keyword-worthy in the cadence slot of `every`). */
const RECUR_CADENCE_WORDS = new Set([
  'year',
  'month',
  'week',
  'day',
  'days',
  'weeks',
  'months',
]);

/** `3rd` / `21st` / `last` — the ordinal position of an `on <nth> <weekday>`. */
function isRecurOrdinal(token: string): boolean {
  return /^(?:\d+(?:st|nd|rd|th)|last)$/i.test(token);
}

/**
 * Classify the significant tokens on a countdown recurrence line. Returns the
 * spans to re-role: sub-keywords (`every`/`on`/`at`/`from` + cadence units) →
 * `keyword`, closed instant vocab (month/weekday names, ordinals) → `modifier`.
 * Numeric tokens (day, `HH:MM`, dates) already tokenize as numbers, so they are
 * left alone. Returns `[]` for any non-recurrence line.
 */
export function classifyRecurrenceLine(line: string): RecurrenceSpan[] {
  const spans: RecurrenceSpan[] = [];
  const toks: Array<{ t: string; s: number; e: number }> = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    toks.push({ t: m[0], s: m.index, e: m.index + m[0].length });
  }
  if (toks.length === 0) return spans;

  const lead = toks[0]!.t.toLowerCase();
  if (!RECUR_LEADERS.has(lead)) return spans;
  const everyLine = lead === 'every';
  let seenConnector = false;

  for (let i = 0; i < toks.length; i++) {
    const { t, s, e } = toks[i]!;
    const low = t.toLowerCase();
    if (i === 0) {
      spans.push({ start: s, end: e, role: 'keyword' }); // the leader
      continue;
    }
    if (RECUR_CONNECTORS.has(low)) {
      spans.push({ start: s, end: e, role: 'keyword' });
      seenConnector = true;
      continue;
    }
    // Cadence unit words are keywords only in `every`'s cadence slot (before the
    // first connector) — checked before the weekday match so `month`/`week`
    // don't collide with weekdayIndex's 3-letter prefix ('mon' → Monday).
    if (everyLine && !seenConnector && RECUR_CADENCE_WORDS.has(low)) {
      spans.push({ start: s, end: e, role: 'keyword' });
      continue;
    }
    if (
      isRecurOrdinal(low) ||
      monthIndex(t) !== null ||
      weekdayIndex(t) !== null
    ) {
      spans.push({ start: s, end: e, role: 'modifier' });
    }
  }
  return spans;
}

/**
 * Re-role recurrence sub-keywords / instant vocab when the document is a
 * countdown. No-op for every other chart type (so `on`/`at`/`from` never leak
 * into prose elsewhere).
 */
function applyRecurringLine(tokens: HighlightToken[]): void {
  const fullText = tokens.map((t) => t.text).join('');
  const lines = fullText.split('\n');
  const firstContent = lines.find((l) => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith('//');
  });
  if (firstContent?.trim().split(/\s+/)[0]!.toLowerCase() !== 'countdown') {
    return;
  }

  let offset = 0;
  for (const lineText of lines) {
    // Recurrence leaders sit at column 0; an indented line is note-block body
    // (or ignored content) and must keep its existing role.
    if (!/^\s/.test(lineText)) {
      for (const sp of classifyRecurrenceLine(lineText)) {
        markTokensInRange(tokens, offset + sp.start, offset + sp.end, sp.role);
      }
    }
    offset += lineText.length + 1; // +1 for the \n
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
  // Red-orange with strikethrough so legacy `|` reads as
  // "remove this." Distinct from `operator` which is bold red.
  deprecatedSyntax: { color: '#BF616A', textDecoration: 'line-through' }, // nord11
  url: { color: '#88C0D0', textDecoration: 'underline' }, // nord8
  colorAnnotation: { color: '#D08770', fontStyle: 'italic' }, // nord12
  punctuation: { color: '#616E88' },
  propertyName: { color: '#88C0D0' }, // nord8
  string: { color: '#A3BE8C' }, // nord14
  noteContent: { color: '#616E88', fontStyle: 'italic' },
  default: {},
};

// ============================================================
// LIGHT_ROLE_STYLES — slate-light companion to NORD_ROLE_STYLES
// ============================================================

/**
 * Light-background counterpart of NORD_ROLE_STYLES for static contexts
 * (marketing site, light-mode source panels). Same role keys — a parity test
 * (tests/block.test.ts) guards the two maps and the `.dgmo-tok-*` rules in
 * block/css.ts against drift. Colors are darker AA-targeting tones tuned for
 * a light code panel (bg ~#f3f5f8). Moved here from the site repo's
 * hand-maintained mirror (BL-114).
 */
export const LIGHT_ROLE_STYLES: Record<string, Record<string, string>> = {
  keyword: { color: '#3b6ea5', fontWeight: 'bold' }, // slate blue
  controlKeyword: { color: '#7d5ba6', fontWeight: 'bold' }, // purple
  definitionKeyword: { color: '#2f5a86', fontWeight: 'bold' }, // deep blue
  modifier: { color: '#7d5ba6' },
  chartType: { color: '#b8691f', fontWeight: 'bold' }, // amber
  operator: { color: '#c0504d', fontWeight: 'bold' }, // red
  number: { color: '#7d5ba6' },
  comment: { color: '#677483', fontStyle: 'italic' }, // muted gray
  heading: { color: '#b8691f', fontWeight: 'bold' },
  bracket: { color: '#5b6672' },
  separator: { color: '#2d7268' }, // deep teal
  deprecatedSyntax: { color: '#c0504d', textDecoration: 'line-through' },
  url: { color: '#3b6ea5', textDecoration: 'underline' },
  colorAnnotation: { color: '#b8691f', fontStyle: 'italic' },
  punctuation: { color: '#677483' },
  propertyName: { color: '#2d7268' },
  string: { color: '#3f7a3b' }, // forest green
  noteContent: { color: '#677483', fontStyle: 'italic' },
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
  deprecatedSyntax: '\x1b[9;31m', // strikethrough red
  url: '\x1b[4;36m', // underline cyan
  colorAnnotation: '\x1b[3;33m', // italic yellow
  punctuation: '\x1b[90m', // dim
  propertyName: '\x1b[36m', // cyan
  string: '\x1b[32m', // green
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

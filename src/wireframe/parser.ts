// ============================================================
// Wireframe Diagram Parser
// ============================================================

import type { DgmoError } from '../diagnostics';
import {
  formatDgmoError,
  makeDgmoError,
  METADATA_DIAGNOSTIC_CODES,
  pipeOperatorRemovedMessage,
} from '../diagnostics';

/**
 * Check whether all `|` characters on a line are inside `{...}` brace
 * regions (wireframe dropdowns). Used to determine whether a line's
 * pipe usage is purely the legitimate `{Option A | Option B}` form.
 */
function hasPipeOnlyInsideBraces(line: string): boolean {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === '|' && depth === 0) return false;
  }
  return true;
}
import type { TagGroup } from '../utils/tag-groups';
import type { Writable } from '../utils/brand';
import {
  isTagBlockHeading,
  matchTagBlockHeading,
  emitTagLegacyDiagnostic,
  validateTagGroupNames,
  stripDefaultModifier,
} from '../utils/tag-groups';
import {
  measureIndent,
  extractColor,
  parseFirstLine,
  OPTION_NOCOLON_RE,
  tryParseSharedOption,
} from '../utils/parsing';
import type {
  WireframeElement,
  WireframeElementType,
  WireframeFormFactor,
  ParsedWireframe,
} from './types';

// ============================================================
// Internal mutable view of WireframeElement for parser construction.
// Strips readonly from optional array fields that Writable<T> can't reach
// through `T | undefined` unions.
// ============================================================

type MutableWireframeElement = Omit<
  Writable<WireframeElement>,
  'options' | 'tableHeaders' | 'tableData' | 'inlineElements'
> & {
  options?: string[];
  tableHeaders?: string[];
  tableData?: string[][];
  inlineElements?: WireframeElement[];
};

// ============================================================
// Constants
// ============================================================

/** Known wireframe option keys (header-phase options before content) */
const KNOWN_OPTIONS = new Set(['palette', 'theme', 'active-tag']);

/** Keywords that only make sense on groups — force group interpretation (EC1) */
const GROUP_ONLY_METADATA = new Set(['horizontal', 'scrollable', 'collapsed']);

/** Recognized state keywords for pipe metadata */
const STATE_KEYWORDS = new Set([
  'disabled',
  'active',
  'selected',
  'empty',
  'ghost',
  'destructive',
  'success',
  'warning',
  'info',
  'scrollable',
  'collapsed',
  'toggle',
  'password',
  'textarea',
  'horizontal',
  'primary',
]);

/** Element keywords — matched when sole content or followed by recognized params */
const ELEMENT_KEYWORDS: Record<
  string,
  { block: boolean; params?: Set<string> }
> = {
  nav: { block: true },
  tabs: { block: true },
  table: { block: true },
  image: { block: false, params: new Set(['round', 'wide']) },
  modal: { block: true },
  skeleton: { block: true },
  alert: { block: true },
  progress: { block: false },
  chart: { block: false, params: new Set(['line', 'bar', 'pie']) },
};

// ============================================================
// Regexes
// ============================================================

/** Group/input: `[content]` with optional trailing meta (legacy `|` or §1.4 keywords) */
const BRACKET_RE = /^\[([^\]]*)\](.*)$/;

/** Button: `(label)` with optional trailing meta (legacy `|` or §1.4 keywords) */
const BUTTON_RE = /^\(([^)]+)\)(.*)$/;

/** Dropdown: `{opt1 | opt2 | ...}` with optional trailing meta (legacy `|` or §1.4 keywords) */
const DROPDOWN_RE = /^\{([^}]+)\}(.*)$/;

/** Checkbox checked: `<x>` or `< x >` (whitespace-tolerant, EC6) */
const CHECKBOX_CHECKED_RE = /^<\s*x\s*>$/i;

/** Checkbox unchecked: `< >` or `<>` (whitespace-tolerant, EC6) */
const CHECKBOX_UNCHECKED_RE = /^<\s*>$/;

/** Radio selected: `(*) Label` */
const RADIO_SELECTED_RE = /^\(\*\)\s+(.+)$/;

/** Radio unselected: `( ) Label` */
const RADIO_UNSELECTED_RE = /^\(\s*\)\s+(.+)$/;

/** Heading: `# text` or `## text` */
const HEADING_RE = /^(#{1,2})\s+(.+)$/;

/** Divider: `---` (3+ dashes) */
const DIVIDER_RE = /^-{3,}$/;

/** List item: `- text` (anchored to start of segment, F38 fix) */
const LIST_ITEM_RE = /^-\s+(.+)$/;

/** Table skeleton shorthand: `table RxC` */
const TABLE_SKELETON_RE = /^table\s+(\d+)x(\d+)$/i;

// ============================================================
// Helpers
// ============================================================

/** Generate a deterministic ID from line number and indent. */
function genId(lineNumber: number, indent: number, suffix = ''): string {
  return `wf-${lineNumber}-${indent}${suffix ? '-' + suffix : ''}`;
}

/** @deprecated No-op — IDs are now deterministic from line/indent. Kept for test compat. */
export function resetWireframeIds(): void {
  // no-op
}

function makeElement(
  type: WireframeElementType,
  label: string,
  lineNumber: number,
  indent: number
): MutableWireframeElement {
  return {
    id: genId(lineNumber, indent),
    type,
    label,
    children: [],
    metadata: {},
    states: [],
    annotations: [],
    lineNumber,
    indent,
    isContainer: false,
    orientation: 'vertical',
    isSkeleton: false,
  };
}

/**
 * Peel the trailing run of state-keyword tokens from a label
 * (the §1.4 / §19.5 wireframe form). Lowercase-only tokens drawn
 * from the closed `STATE_KEYWORDS` enum are stripped from the
 * right of the label; peeling stops at the first non-enum token.
 *
 * `Submit primary destructive`   → label="Submit",     states=["primary","destructive"]
 * `Dashboard active`             → label="Dashboard",  states=["active"]
 * `Active items active`          → label="Active items", states=["active"]
 * `Toggle me`                    → label="Toggle me",  states=[]   (no trailing enum token)
 *
 * Case-sensitive match (lowercase enum) — authors capitalize their
 * labels to disambiguate (spec §19.5).
 */
function peelTrailingFlags(label: string): {
  label: string;
  states: string[];
} {
  const tokens = label.split(/\s+/).filter(Boolean);
  const states: string[] = [];
  while (tokens.length > 0) {
    const last = tokens[tokens.length - 1]!;
    // Only lowercase tokens count — `Active` (capitalized) stays in
    // the label, `active` is a flag.
    if (last !== last.toLowerCase()) break;
    if (!STATE_KEYWORDS.has(last)) break;
    states.unshift(last);
    tokens.pop();
  }
  return { label: tokens.join(' '), states };
}

/**
 * Parse pipe metadata flags/annotations from the text after `|`.
 * Returns states array + annotations array + metadata record.
 */
function parseWireframeMetadata(raw: string): {
  states: string[];
  annotations: string[];
  metadata: Record<string, string>;
} {
  const states: string[] = [];
  const annotations: string[] = [];
  const metadata: Record<string, string> = {};

  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (STATE_KEYWORDS.has(lower)) {
      states.push(lower);
    } else if (part.includes(':')) {
      const [key, ...rest] = part.split(':');
      // In-bounds: split(':') on string containing ':' returns at least 2 elements.
      metadata[key!.trim()] = rest.join(':').trim();
    } else {
      annotations.push(part);
    }
  }
  return { states, annotations, metadata };
}

/**
 * Apply the trailing meta region of a structural element (the
 * content captured after `]`, `)`, or `}` by BRACKET_RE / BUTTON_RE
 * / DROPDOWN_RE). Accepts both:
 *   - legacy: ` | flag1, flag2`     (leading `|`, comma-separated)
 *   - new (§19.5): ` flag1 flag2`   (space-separated keyword list)
 * No-ops when the tail is empty.
 */
function applyTrailingMeta(
  el: MutableWireframeElement,
  rawTail: string | undefined
): void {
  if (!rawTail) return;
  const trimmed = rawTail.trim();
  if (!trimmed) return;
  if (trimmed.startsWith('|')) {
    applyMetadata(el, trimmed.substring(1).trim());
    return;
  }
  // §1.4 / §19.5 trailing-keyword form: every token must be a
  // recognized state-keyword (lowercase). Non-enum tokens fall
  // through to applyMetadata so existing semantics (annotations,
  // `key: value`) still work for content that happens to land here.
  const tokens = trimmed.split(/\s+/);
  if (tokens.every((t) => t === t.toLowerCase() && STATE_KEYWORDS.has(t))) {
    applyMetadata(el, tokens.join(', '));
    return;
  }
  applyMetadata(el, trimmed);
}

/**
 * Apply parsed metadata to an element.
 */
function applyMetadata(
  el: MutableWireframeElement,
  metaStr: string | undefined
): void {
  if (!metaStr) return;
  const { states, annotations, metadata } = parseWireframeMetadata(metaStr);
  el.states.push(...states);
  el.annotations.push(...annotations);
  Object.assign(el.metadata, metadata);

  // Field variants
  if (el.type === 'textInput') {
    if (states.includes('password')) el.fieldVariant = 'password';
    if (states.includes('textarea')) el.fieldVariant = 'textarea';
  }

  // Group-only metadata forces container (EC1)
  for (const s of states) {
    if (GROUP_ONLY_METADATA.has(s)) {
      el.isContainer = true;
      if (s === 'horizontal') el.orientation = 'horizontal';
    }
  }
}

/**
 * Detect if a segment is a keyword element.
 * Returns { keyword, params } or null.
 * F9: keyword matched only when sole content or followed by recognized param.
 */
function matchKeyword(segment: string): {
  keyword: string;
  type: WireframeElementType;
  param?: string;
} | null {
  const words = segment.split(/\s+/);
  // In-bounds: split always returns at least one element.
  const first = words[0]!.toLowerCase();
  const kw = ELEMENT_KEYWORDS[first];
  if (!kw) return null;

  // Sole content — just the keyword
  if (words.length === 1) {
    return { keyword: first, type: first as WireframeElementType };
  }

  const rest = words.slice(1).join(' ');

  // `modal Title` — modal always takes the rest as title
  if (first === 'modal') {
    return { keyword: first, type: 'modal', param: rest };
  }

  // `progress 60` — takes a number
  if (first === 'progress') {
    const num = parseInt(rest, 10);
    if (!isNaN(num)) {
      return { keyword: first, type: 'progress', param: rest };
    }
    return null; // `progress bar` → bare text
  }

  // `table 5x4` — skeleton shorthand
  if (first === 'table') {
    if (TABLE_SKELETON_RE.test(segment)) {
      return { keyword: first, type: 'table', param: rest };
    }
    // `table` followed by content → still a table block
    return { keyword: first, type: 'table' };
  }

  // Keywords with recognized param sets
  if (kw.params) {
    if (kw.params.has(rest.toLowerCase())) {
      return {
        keyword: first,
        type: first as WireframeElementType,
        param: rest.toLowerCase(),
      };
    }
    // Unrecognized trailing words → bare text (F9)
    return null;
  }

  // Block keywords with unrecognized trailing → bare text
  return null;
}

/**
 * Parse a single segment (after multi-element line splitting) into an element.
 */
function parseSegment(
  segment: string,
  lineNumber: number,
  indent: number,
  diagnostics: DgmoError[]
): MutableWireframeElement | null {
  const trimmed = segment.trim();
  if (!trimmed) return null;

  // Heading: `# text` or `## text`
  const headingMatch = trimmed.match(HEADING_RE);
  if (headingMatch) {
    // In-bounds: HEADING_RE has 2 capture groups; matched groups are defined.
    const level = headingMatch[1]!.length as 1 | 2;
    const el = makeElement(
      'heading',
      headingMatch[2]!.trim(),
      lineNumber,
      indent
    );
    el.headingLevel = level;
    return el;
  }

  // Divider: `---`
  if (DIVIDER_RE.test(trimmed)) {
    return makeElement('divider', '', lineNumber, indent);
  }

  // Checkbox checked: `<x>` (EC6 — strict pattern)
  if (CHECKBOX_CHECKED_RE.test(trimmed)) {
    const el = makeElement('checkbox', '', lineNumber, indent);
    el.checked = true;
    return el;
  }

  // Checkbox unchecked: `< >`
  if (CHECKBOX_UNCHECKED_RE.test(trimmed)) {
    const el = makeElement('checkbox', '', lineNumber, indent);
    el.checked = false;
    return el;
  }

  // Radio selected: `(*) Label`
  const radioSelMatch = trimmed.match(RADIO_SELECTED_RE);
  if (radioSelMatch) {
    const el = makeElement(
      'radio',
      // In-bounds: regex has one capture group; matched group is defined.
      radioSelMatch[1]!.trim(),
      lineNumber,
      indent
    );
    el.selected = true;
    return el;
  }

  // Radio unselected: `( ) Label`
  const radioUnselMatch = trimmed.match(RADIO_UNSELECTED_RE);
  if (radioUnselMatch) {
    const el = makeElement(
      'radio',
      // In-bounds: regex has one capture group; matched group is defined.
      radioUnselMatch[1]!.trim(),
      lineNumber,
      indent
    );
    el.selected = false;
    return el;
  }

  // Checkbox with label: `<x> Label` or `< > Label`
  const checkLabelMatch = trimmed.match(/^(<\s*x?\s*>)\s+(.+)$/i);
  if (checkLabelMatch) {
    // In-bounds: regex has 2 capture groups; matched groups are defined.
    const isChecked = /x/i.test(checkLabelMatch[1]!);
    const labelPart = checkLabelMatch[2]!;
    // Legacy `| meta` first, then §1.4 trailing-keyword peel on the
    // remaining label region.
    const pipeSplit = labelPart.split(/\s*\|\s*/);
    const baseLabel = pipeSplit[0]!.trim();
    const peeled = peelTrailingFlags(baseLabel);
    const el = makeElement('checkbox', peeled.label, lineNumber, indent);
    el.checked = isChecked;
    if (peeled.states.length > 0) {
      applyMetadata(el, peeled.states.join(', '));
    }
    if (pipeSplit.length > 1) {
      applyMetadata(el, pipeSplit.slice(1).join(', '));
    }
    return el;
  }

  // Dropdown: `{opt1 | opt2 | opt3}` (optional trailing metadata after closing brace)
  const dropdownMatch = trimmed.match(DROPDOWN_RE);
  if (dropdownMatch) {
    // In-bounds: DROPDOWN_RE has 2 capture groups; first is required by match.
    const options = dropdownMatch[1]!
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    const el = makeElement('dropdown', options[0] || '', lineNumber, indent);
    el.options = options;
    applyTrailingMeta(el, dropdownMatch[2]);
    return el;
  }

  // Parens with pipes — likely meant dropdown (AC25) — check before button match
  const parenPipeMatch = trimmed.match(/^\(([^)]*\|[^)]*)\)\s*$/);
  if (parenPipeMatch) {
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        // In-bounds: regex has one capture group; matched group is defined.
        `Did you mean a dropdown? Use braces: {${parenPipeMatch[1]!}} instead of (${parenPipeMatch[1]!})`,
        'warning'
      )
    );
    const options = parenPipeMatch[1]!
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    const el = makeElement('dropdown', options[0] || '', lineNumber, indent);
    el.options = options;
    return el;
  }

  // Button: `(label)` (must come after radio/checkbox checks)
  const buttonMatch = trimmed.match(BUTTON_RE);
  if (buttonMatch) {
    // In-bounds: BUTTON_RE has 2 capture groups; first is required by match.
    const el = makeElement(
      'button',
      buttonMatch[1]!.trim(),
      lineNumber,
      indent
    );
    applyTrailingMeta(el, buttonMatch[2]);
    return el;
  }

  // Group/Input: `[content]`
  const bracketMatch = trimmed.match(BRACKET_RE);
  if (bracketMatch) {
    // Will be disambiguated as group vs input later (by children or EC1 metadata)
    // In-bounds: BRACKET_RE has 2 capture groups; first is required by match.
    const el = makeElement(
      'group',
      bracketMatch[1]!.trim(),
      lineNumber,
      indent
    );
    applyTrailingMeta(el, bracketMatch[2]);
    // If no group-forcing metadata applied, default to textInput — will be
    // overridden to 'group' if children are added during indent-stack processing
    if (!el.isContainer) {
      el.type = 'textInput';
      // Apply field variants now that type is set
      if (el.states.includes('password')) el.fieldVariant = 'password';
      if (el.states.includes('textarea')) el.fieldVariant = 'textarea';
    }
    return el;
  }

  // List item: `- text` (F38: anchored to segment start)
  const listMatch = trimmed.match(LIST_ITEM_RE);
  if (listMatch) {
    // In-bounds: LIST_ITEM_RE has one capture group; matched group is defined.
    return makeElement('listItem', listMatch[1]!.trim(), lineNumber, indent);
  }

  // Keyword elements
  const kwMatch = matchKeyword(trimmed);
  if (kwMatch) {
    const el = makeElement(
      kwMatch.type,
      kwMatch.param || '',
      lineNumber,
      indent
    );
    if (kwMatch.type === 'image') {
      el.imageHint = (kwMatch.param as 'round' | 'wide') || 'default';
    } else if (kwMatch.type === 'progress') {
      const val = parseInt(kwMatch.param || '0', 10);
      el.progressValue = Math.max(0, Math.min(100, isNaN(val) ? 0 : val));
    } else if (kwMatch.type === 'chart') {
      el.chartHint = (kwMatch.param as 'line' | 'bar' | 'pie') || 'line';
    } else if (kwMatch.type === 'table') {
      // Check for skeleton shorthand
      const skelMatch = `table ${kwMatch.param || ''}`.match(TABLE_SKELETON_RE);
      if (skelMatch) {
        // In-bounds: TABLE_SKELETON_RE has 2 capture groups; matched groups are defined.
        el.tableRows = parseInt(skelMatch[1]!, 10);
        el.tableCols = parseInt(skelMatch[2]!, 10);
      }
    }
    // Block keywords become containers
    if (ELEMENT_KEYWORDS[kwMatch.keyword]?.block) {
      el.isContainer = true;
    }
    return el;
  }

  // Unmatched opening brackets (before pipe split, which would interfere)
  if (/^\[[^\]]*$/.test(trimmed)) {
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        `Unmatched '[' — auto-closing bracket`,
        'warning'
      )
    );
    const label = trimmed.substring(1).trim();
    return makeElement('textInput', label, lineNumber, indent);
  }
  if (/^\([^)]*$/.test(trimmed) && !trimmed.match(/^\(\s*\*?\s*\)/)) {
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        `Unmatched '(' — auto-closing bracket`,
        'warning'
      )
    );
    const label = trimmed.substring(1).trim();
    return makeElement('button', label, lineNumber, indent);
  }
  if (/^\{[^}]*$/.test(trimmed)) {
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        `Unmatched '{' — auto-closing bracket`,
        'warning'
      )
    );
    const rawContent = trimmed.substring(1).trim();
    const options = rawContent
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    const el = makeElement('dropdown', options[0] || '', lineNumber, indent);
    el.options = options;
    return el;
  }

  // Bare text — optional legacy `| meta` form first, otherwise
  // peel the §1.4 / §19.5 trailing-keyword form.
  const pipeParts = trimmed.split(/\s*\|\s*/);
  let textContent: string;
  let states: string[];
  let metaStr: string | undefined;
  if (pipeParts.length > 1) {
    // Legacy `text | meta` form. The pipe diagnostic still fires
    // from the top-of-loop check; we keep extracting for back-compat.
    textContent = pipeParts[0]!.trim();
    metaStr = pipeParts.slice(1).join(', ');
    states = parseWireframeMetadata(metaStr).states;
  } else {
    // §1.4 / §19.5 trailing-keyword peel.
    const peeled = peelTrailingFlags(trimmed);
    textContent = peeled.label;
    states = peeled.states;
    metaStr = states.length > 0 ? states.join(', ') : undefined;
  }

  // Bare text + semantic state = inline alert (F22)
  const semanticStates = ['warning', 'destructive', 'success', 'info'];
  const hasSemantic = states.some((s) => semanticStates.includes(s));
  if (hasSemantic) {
    const el = makeElement('alert', textContent, lineNumber, indent);
    el.states = states;
    return el;
  }

  if (metaStr) {
    const el = makeElement('text', textContent, lineNumber, indent);
    applyMetadata(el, metaStr);
    return el;
  }

  return makeElement('text', trimmed, lineNumber, indent);
}

/**
 * Split a line into segments on 2+ space boundaries (multi-element line rule).
 * Single space is same element.
 */
function splitLineSegments(line: string): string[] {
  return line.split(/\s{2,}/).filter(Boolean);
}

// ============================================================
// Main Parser
// ============================================================

export function parseWireframe(content: string): ParsedWireframe {
  resetWireframeIds();

  const diagnostics: DgmoError[] = [];
  const lines = content.split('\n');

  let title: string | null = null;
  let titleLineNumber: number | null = null;
  let formFactor: WireframeFormFactor = 'desktop';
  const roots: MutableWireframeElement[] = [];
  const modals: MutableWireframeElement[] = [];
  const tagGroups: TagGroup[] = [];
  const options: Record<string, string> = {};

  // Parsing state
  let phase: 'header' | 'tags' | 'content' = 'header';
  let currentTagGroup: Writable<TagGroup> | null = null;

  function pushWarning(line: number, msg: string): void {
    diagnostics.push(makeDgmoError(line, msg, 'warning'));
  }

  function makeTagGroup(
    trimmed: string,
    lineNumber: number
  ): Writable<TagGroup> | null {
    const match = matchTagBlockHeading(trimmed);
    if (!match) return null;
    emitTagLegacyDiagnostic(match, lineNumber, diagnostics);
    return {
      name: match.name,
      ...(match.alias !== undefined && { alias: match.alias }),
      entries: [],
      lineNumber,
    };
  }

  // Indent stack for hierarchy
  const indentStack: { node: MutableWireframeElement; indent: number }[] = [];

  function findParent(indent: number): MutableWireframeElement | null {
    // Pop nodes at same or deeper indent
    while (
      indentStack.length > 0 &&
      // In-bounds by length-check guard above.
      indentStack[indentStack.length - 1]!.indent >= indent
    ) {
      const popped = indentStack.pop()!;
      // When a node had children pushed to it, mark as container
      if (popped.node.children.length > 0 && !popped.node.isContainer) {
        popped.node.isContainer = true;
        // If it was textInput (from bracket detection), upgrade to group
        if (popped.node.type === 'textInput') {
          popped.node.type = 'group';
        }
      }
    }
    return indentStack.length > 0
      ? // In-bounds by length-check.
        indentStack[indentStack.length - 1]!.node
      : null;
  }

  function pushElement(el: MutableWireframeElement): void {
    // Modal elements go to separate array
    if (el.type === 'modal') {
      modals.push(el);
      indentStack.push({ node: el, indent: el.indent });
      return;
    }

    // Find parent based on indent
    findParent(el.indent);

    if (indentStack.length === 0) {
      roots.push(el);
    } else {
      // In-bounds by length-check above.
      const parent = indentStack[indentStack.length - 1]!.node;
      parent.children.push(el);
      // Propagate skeleton flag
      if (parent.type === 'skeleton' || parent.isSkeleton) {
        el.isSkeleton = true;
      }
    }

    // Push onto stack if it could be a container
    if (
      el.isContainer ||
      el.type === 'group' ||
      el.type === 'textInput' || // might become group if children follow
      el.type === 'nav' ||
      el.type === 'tabs' ||
      el.type === 'table' ||
      el.type === 'skeleton' ||
      el.type === 'alert'
    ) {
      indentStack.push({ node: el, indent: el.indent });
    }
  }

  function pushInlineRow(
    segments: string[],
    lineNumber: number,
    indent: number,
    diags: DgmoError[]
  ): void {
    const children: MutableWireframeElement[] = [];
    let lastEl: MutableWireframeElement | null = null;
    for (const seg of segments) {
      // EC5: segment starting with `|` attaches to previous element
      if (seg.startsWith('|') && lastEl) {
        applyMetadata(lastEl, seg.substring(1).trim());
        continue;
      }
      const el = parseSegment(seg, lineNumber, indent, diags);
      if (el) {
        children.push(el);
        lastEl = el;
      }
    }
    if (children.length === 0) return;
    if (children.length === 1) {
      // In-bounds by length-check above.
      pushElement(children[0]!);
      return;
    }
    // Wrap in a horizontal inline row
    const wrapper = makeElement('group', '', lineNumber, indent);
    wrapper.id = genId(lineNumber, indent, 'row');
    wrapper.isContainer = true;
    wrapper.orientation = 'horizontal';
    wrapper.children = children;
    const wrapperMetadata: Record<string, string> = { _inlineRow: 'true' };
    wrapper.metadata = wrapperMetadata;
    pushElement(wrapper);
  }

  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const line = lines[i]!;
    const lineNumber = i + 1;
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('//')) continue;

    // §1.4 legacy `|` detection — emit once per line. The `|` inside
    // `{Option A | Option B}` dropdown braces stays valid; emit only
    // when `|` appears outside any `{...}` region.
    if (trimmed.includes('|') && !hasPipeOnlyInsideBraces(trimmed)) {
      diagnostics.push(
        makeDgmoError(
          lineNumber,
          pipeOperatorRemovedMessage(),
          'error',
          METADATA_DIAGNOSTIC_CODES.PIPE_OPERATOR_REMOVED
        )
      );
    }

    const indent = measureIndent(line);

    // ── Header phase ──────────────────────────────────────
    if (phase === 'header') {
      // First line: chart type declaration
      const firstLineResult = parseFirstLine(trimmed);
      if (firstLineResult?.chartType === 'wireframe') {
        title = firstLineResult.title || null;
        titleLineNumber = lineNumber;
        continue;
      }

      // Options: `mobile`, `palette xxx`, `theme xxx`
      if (trimmed === 'mobile') {
        formFactor = 'mobile';
        continue;
      }

      if (tryParseSharedOption(trimmed, options)) {
        continue;
      }

      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      // In-bounds: OPTION_NOCOLON_RE has 2 capture groups; first is required by match.
      if (optMatch && KNOWN_OPTIONS.has(optMatch[1]!.toLowerCase())) {
        options[optMatch[1]!] = optMatch[2] || '';
        continue;
      }

      // Tag group heading
      if (isTagBlockHeading(trimmed)) {
        const tg = makeTagGroup(trimmed, lineNumber);
        if (tg) {
          currentTagGroup = tg;
          tagGroups.push(tg);
          phase = 'tags';
          continue;
        }
      }

      // Not a header line — switch to content phase
      phase = 'content';
      // Fall through to content parsing
    }

    // ── Tag group entries ─────────────────────────────────
    if (phase === 'tags') {
      // Tag group heading
      if (isTagBlockHeading(trimmed)) {
        const tg = makeTagGroup(trimmed, lineNumber);
        if (tg) {
          currentTagGroup = tg;
          tagGroups.push(tg);
          continue;
        }
      }

      // Indented tag entry: `Value color` or `Value color default`
      if (indent > 0 && currentTagGroup) {
        const { text: cleanEntry, isDefault } = stripDefaultModifier(trimmed);
        const { label, color } = extractColor(cleanEntry);
        if (color) {
          currentTagGroup.entries.push({
            value: label,
            color,
            lineNumber,
          });
          if (isDefault) {
            currentTagGroup.defaultValue = label;
          } else if (currentTagGroup.entries.length === 1) {
            currentTagGroup.defaultValue = label;
          }
        } else {
          pushWarning(
            lineNumber,
            `Expected 'Value color' in tag group '${currentTagGroup.name}'`
          );
        }
        continue;
      }

      // Non-indented, non-tag-heading → switch to content
      phase = 'content';
      currentTagGroup = null;
      // Fall through
    }

    // ── Content phase ─────────────────────────────────────
    if (phase !== 'content') {
      phase = 'content';
    }

    // Options can appear in content phase too (e.g., `mobile` anywhere)
    if (indent === 0 && trimmed === 'mobile') {
      formFactor = 'mobile';
      continue;
    }
    if (indent === 0) {
      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (
        optMatch &&
        !trimmed.startsWith('#') &&
        !trimmed.startsWith('[') &&
        !trimmed.startsWith('(')
      ) {
        // Only treat as option if it looks like one (palette, theme, active-tag, etc.)
        // In-bounds: OPTION_NOCOLON_RE has 2 capture groups; first is required by match.
        const key = optMatch[1]!;
        if (['palette', 'theme', 'active-tag'].includes(key)) {
          options[key] = optMatch[2] || '';
          continue;
        }
      }
    }

    // Tag group entries can appear in content phase too
    if (isTagBlockHeading(trimmed)) {
      const tg = makeTagGroup(trimmed, lineNumber);
      if (tg) {
        currentTagGroup = tg;
        tagGroups.push(tg);
        phase = 'tags';
        continue;
      }
    }

    // Table data rows (comma-separated, indented under a table element)
    if (indentStack.length > 0) {
      // In-bounds by length-check above.
      const topNode = indentStack[indentStack.length - 1]!.node;
      if (topNode.type === 'table' && indent > topNode.indent) {
        // Parse as table row
        const cells = parseTableRow(trimmed);
        if (!topNode.tableHeaders) {
          // First indented row = header row if it's a comma-separated line
          if (trimmed.includes(',')) {
            topNode.tableHeaders = cells;
          } else {
            // Single value — treat as header
            topNode.tableHeaders = cells;
          }
        } else {
          if (!topNode.tableData) topNode.tableData = [];
          topNode.tableData.push(cells);
        }
        continue;
      }
    }

    // Multi-element line splitting
    const segments = splitLineSegments(trimmed);

    if (segments.length === 1) {
      // Single element
      // In-bounds by length-check above.
      const el = parseSegment(segments[0]!, lineNumber, indent, diagnostics);
      if (el) pushElement(el);
    } else if (segments.length === 2) {
      // Check for orphaned pipe metadata (EC5): second segment starts with `|`
      // In-bounds by length-check above.
      if (segments[1]!.startsWith('|')) {
        const el = parseSegment(segments[0]!, lineNumber, indent, diagnostics);
        if (el) {
          applyMetadata(el, segments[1]!.substring(1).trim());
          pushElement(el);
        }
      } else {
        // Check for label-field pairing (ADR-9):
        // First is bare text AND second contains bracket-mnemonic element
        // In-bounds by length-check above.
        const firstIsBare = isBareText(segments[0]!);
        const secondIsElement = hasBracketMnemonic(segments[1]!);

        if (firstIsBare && secondIsElement) {
          // Label-for-element pairing
          const fieldEl = parseSegment(
            segments[1]!,
            lineNumber,
            indent,
            diagnostics
          );
          if (fieldEl) {
            const labelEl = makeElement(
              'text',
              segments[0]!.trim(),
              lineNumber,
              indent
            );
            labelEl.id = genId(lineNumber, indent, 'lbl');
            labelEl.labelFor = fieldEl;
            // Wrap in inline container
            const wrapper = makeElement('group', '', lineNumber, indent);
            wrapper.id = genId(lineNumber, indent, 'lf');
            wrapper.isContainer = true;
            wrapper.orientation = 'horizontal';
            wrapper.children.push(labelEl, fieldEl);
            const wrapperMetadata: Record<string, string> = {
              _labelField: 'true',
            };
            wrapper.metadata = wrapperMetadata;
            pushElement(wrapper);
          }
        } else {
          // Two inline items — wrap in horizontal row
          pushInlineRow(segments, lineNumber, indent, diagnostics);
        }
      }
    } else {
      // 3+ segments = inline items, no label pairing — wrap in horizontal row
      pushInlineRow(segments, lineNumber, indent, diagnostics);
    }
  }

  // Final cleanup: pop remaining indent stack to finalize container detection
  while (indentStack.length > 0) {
    const popped = indentStack.pop()!;
    if (popped.node.children.length > 0 && !popped.node.isContainer) {
      popped.node.isContainer = true;
      if (popped.node.type === 'textInput') {
        popped.node.type = 'group';
      }
    }
  }

  // Validate tag groups
  validateTagGroupNames(tagGroups, pushWarning, (line, msg) => {
    diagnostics.push(makeDgmoError(line, msg));
  });

  const error = diagnostics.find((d) => d.severity === 'error')
    ? formatDgmoError(diagnostics.find((d) => d.severity === 'error')!)
    : null;

  return {
    title,
    titleLineNumber,
    formFactor,
    roots,
    modals,
    tagGroups,
    options,
    diagnostics,
    error,
  };
}

// ============================================================
// Table row parsing (bracket-depth tracking, F7)
// ============================================================

function parseTableRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let depth = 0;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (ch === '[' || ch === '{' || ch === '(' || ch === '<') depth++;
    if (ch === ']' || ch === '}' || ch === ')' || ch === '>')
      depth = Math.max(0, depth - 1);

    if (ch === ',' && depth === 0) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    cells.push(current.trim());
  }

  return cells;
}

// ============================================================
// Helpers for multi-element line disambiguation
// ============================================================

function isBareText(segment: string): boolean {
  const s = segment.trim();
  if (!s) return false;
  // Not bare text if it starts with a bracket mnemonic character
  if (/^[[\]({<#-]/.test(s)) return false;
  // Not bare text if it's a keyword
  if (matchKeyword(s)) return false;
  return true;
}

function hasBracketMnemonic(segment: string): boolean {
  const s = segment.trim();
  return (
    /^\[/.test(s) || /^\(/.test(s) || /^\{/.test(s) || /^<\s*x?\s*>/i.test(s)
  );
}

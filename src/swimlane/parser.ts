// ============================================================
// Swimlane Diagram — Parser
// ============================================================
//
// Grammar (syntax source of truth: `docs/swimlane-syntax.html`):
//   swimlane [Title]
//   direction LR|TB                 // optional, default LR
//   lane <Name> [color]             // row declarations (order + color)
//   tag <Name> as <a> …             // optional tag groups (§1.5)
//   [Phase]                         // optional phase columns (3-deep)
//     <Lane ref>                    //   bare line matching a declared lane
//       <node>                      //     bare task / <gateway> / (terminal) / [[subprocess]]
//   <Lane ref>                      // 2-deep (no phases): lane ▸ node
//     <node>
//   A -label-> B -> C               // flow block (last); in-arrow labels;
//   <Source>                        //   a bare source header groups indented
//     -label-> Target               //   arrows beneath it
//
// Detection is via `ALL_CHART_TYPES` (utils/parsing.ts), matched by
// `parseFirstLine` — NOT the registry. Lanes are pre-declared with the `lane`
// keyword, which lets the main pass disambiguate a lane-context line (matches a
// declared lane) from a node declaration (anything else) from a flow
// source-group header (bare, indent-0, not a lane).

import {
  makeDgmoError,
  type DgmoError,
  type DgmoSeverity,
} from '../diagnostics';
import { measureIndent, extractColor, parseFirstLine } from '../utils/parsing';
import {
  matchTagBlockHeading,
  emitTagLegacyDiagnostic,
  stripDefaultModifier,
  finalizeAutoTagColors,
  AUTO_TAG_COLOR_SENTINEL,
  tagAttrKey,
  type TagGroup,
} from '../utils/tag-groups';
import type { Writable } from '../utils/brand';
import type { PaletteColors } from '../palettes';
import type {
  ParsedSwimlane,
  SwimDirection,
  SwimEdge,
  SwimEvent,
  SwimLane,
  SwimNode,
  SwimPhase,
  SwimShape,
} from './types';

/** Stable diagnostic codes — free-form `code` strings, no registration (F16). */
export const SWIMLANE_DIAGNOSTIC_CODES = {
  DUPLICATE_NODE: 'E_SWIMLANE_DUPLICATE_NODE',
  UNKNOWN_NODE: 'E_SWIMLANE_UNKNOWN_NODE',
  UNKNOWN_LANE: 'E_SWIMLANE_UNKNOWN_LANE',
  NO_LANES: 'E_SWIMLANE_NO_LANES',
  UNSUPPORTED: 'E_SWIMLANE_UNSUPPORTED',
} as const;

/** Collapse internal whitespace + lowercase for a lookup key. */
function normKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

interface NodeTokenResult {
  shape: SwimShape;
  event: SwimEvent;
  label: string;
  /** Set when the token is a deferred/fast-follow construct (UNSUPPORTED). */
  unsupported?: string;
}

/**
 * Parse a node token (shape + event + label) from a structural / flow
 * reference. Delimiters are optional sugar — `Validate` ≡ `<Validate>`.
 */
function parseNodeToken(raw: string): NodeTokenResult {
  const t = raw.trim();

  // Gateways: <…>, <+ …>, and the fast-follow <o …> / <* …>.
  if (t.startsWith('<') && t.endsWith('>') && t.length >= 2) {
    const inner = t.slice(1, -1).trim();
    if (inner.startsWith('+')) {
      return {
        shape: 'parallel',
        event: 'none',
        label: inner.slice(1).trim(),
      };
    }
    if (inner.startsWith('o ') || inner === 'o') {
      return {
        shape: 'exclusive',
        event: 'none',
        label: inner.replace(/^o\s*/, '').trim(),
        unsupported: 'inclusive gateway (<o …>) is fast-follow',
      };
    }
    if (inner.startsWith('* ') || inner === '*') {
      return {
        shape: 'exclusive',
        event: 'none',
        label: inner.replace(/^\*\s*/, '').trim(),
        unsupported: 'event-based gateway (<* …>) is fast-follow',
      };
    }
    return { shape: 'exclusive', event: 'none', label: inner };
  }

  // Subprocess: [[ … ]] (check before single-bracket / phase forms).
  if (t.startsWith('[[') && t.endsWith(']]') && t.length >= 4) {
    return { shape: 'subprocess', event: 'none', label: t.slice(2, -2).trim() };
  }

  // Terminal: ( … ) with optional `!` error prefix + optional trailing type
  // word (`(Paid) success`). The trailing word lives OUTSIDE the parens.
  if (t.startsWith('(')) {
    const close = t.indexOf(')');
    if (close > 0) {
      let inner = t.slice(1, close).trim();
      let event: SwimEvent = 'none';
      let unsupported: string | undefined;
      if (inner.startsWith('!')) {
        event = 'error';
        inner = inner.slice(1).trim();
      }
      const trailing = t
        .slice(close + 1)
        .trim()
        .toLowerCase();
      if (trailing) {
        if (trailing === 'success') event = 'success';
        else if (trailing === 'terminate') event = 'terminate';
        else if (trailing === 'error') event = 'error';
        else if (trailing === 'timer')
          unsupported = 'timer events are fast-follow';
        else if (trailing === 'message')
          unsupported = 'message events are fast-follow';
        else if (trailing === 'signal')
          unsupported = 'signal events are fast-follow';
      }
      return {
        shape: 'terminal',
        event,
        label: inner,
        ...(unsupported !== undefined && { unsupported }),
      };
    }
  }

  // Bare task (delimiters were optional in a flow reference, so a bare
  // `Validate` still resolves by name to its declared shape downstream).
  return { shape: 'task', event: 'none', label: t };
}

/**
 * Arrow token: a plain `->`, or a labeled `-label->` whose leading `-` sits at a
 * token boundary (start-of-line or after whitespace). The boundary requirement
 * keeps a hyphen *inside* a node name (`Read-Write -> Done`) from being mistaken
 * for the start of a label — only a boundary-flanked `-…->` splits as a labeled
 * arrow, so a bare ` -> ` (no label chars before the `->`) falls through to the
 * plain alternative. The label itself may contain spaces (`-no ack->`); it just
 * can't contain `>`. The labeled alternative is tried first so `-changes->` wins
 * over the bare `->` nested inside it.
 */
const ARROW_RE = /(?:^|\s)-([^>]+?)->|->/g;

interface ChainPart {
  text: string;
  /** Label of the arrow that FOLLOWS this part (undefined for the last). */
  labelAfter?: string;
}

/** Split a flow line into node references + in-arrow labels. */
function splitChain(line: string): ChainPart[] {
  const parts: ChainPart[] = [];
  ARROW_RE.lastIndex = 0;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  const rawLabels: (string | undefined)[] = [];
  const segments: string[] = [];
  while ((m = ARROW_RE.exec(line)) !== null) {
    segments.push(line.slice(lastIndex, m.index));
    let lbl = m[1]?.trim();
    if (lbl === '') lbl = undefined; // `-->` (empty in-arrow label) → no label
    rawLabels.push(lbl);
    lastIndex = m.index + m[0].length;
  }
  segments.push(line.slice(lastIndex));
  for (let i = 0; i < segments.length; i++) {
    parts.push({
      text: segments[i]!.trim(),
      ...(rawLabels[i] !== undefined && { labelAfter: rawLabels[i]! }),
    });
  }
  return parts;
}

/** Split a node declaration line into its token region + `key: value` meta. */
function splitNodeMeta(line: string): {
  token: string;
  meta: Record<string, string>;
} {
  // First `<ident>:` occurrence (with optional space) marks the meta region.
  const m = line.match(/(^|\s)([A-Za-z][\w-]*)\s*:/);
  if (m?.index === undefined) {
    return { token: line.trim(), meta: {} };
  }
  const cut = m.index + (m[1] ? m[1].length : 0);
  const token = line.slice(0, cut).trim();
  const region = line.slice(cut);
  const meta: Record<string, string> = {};
  for (const pair of region.split(',')) {
    const idx = pair.indexOf(':');
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim().toLowerCase();
    const value = pair.slice(idx + 1).trim();
    if (!key) continue;
    meta[key] = value;
  }
  return { token, meta };
}

export function parseSwimlane(
  content: string,
  palette?: PaletteColors
): ParsedSwimlane {
  const diagnostics: DgmoError[] = [];
  const lanes: SwimLane[] = [];
  const phases: SwimPhase[] = [];
  const nodes: SwimNode[] = [];
  const edges: SwimEdge[] = [];
  const tagGroups: Writable<TagGroup>[] = [];

  const laneByKey = new Map<string, SwimLane>();
  const phaseByKey = new Map<string, SwimPhase>();
  const nodeByKey = new Map<string, SwimNode>();
  const metaAliasMap = new Map<string, string>();
  const options: Record<string, string> = {};
  let direction: SwimDirection = 'LR';

  const push = (
    line: number,
    message: string,
    code: string,
    severity: DgmoSeverity = 'error'
  ): void => {
    diagnostics.push(makeDgmoError(line, message, severity, code));
  };

  const rawLines = content.split('\n');

  // ── First line: chart type + title ──────────────────────────
  let title: string | undefined;
  let titleLineNumber: number | undefined;
  let startIdx = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const t = rawLines[i]!.trim();
    if (!t || t.startsWith('//')) continue;
    const fl = parseFirstLine(rawLines[i]!);
    if (fl?.chartType === 'swimlane') {
      title = fl.title;
      titleLineNumber = i + 1;
    }
    startIdx = i + 1;
    break;
  }

  // ── Pass 1: lanes / tag groups / options (top-level declarations) ──
  // Done first so the main pass can disambiguate lane-context lines.
  let currentTagGroup: Writable<TagGroup> | null = null;
  let sawContent = false;
  for (let i = startIdx; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const lineNum = i + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const indent = measureIndent(raw);

    // Tag group heading.
    const tagMatch = matchTagBlockHeading(trimmed);
    if (tagMatch && indent === 0) {
      emitTagLegacyDiagnostic(tagMatch, lineNum, diagnostics);
      const newGroup: Writable<TagGroup> = {
        name: tagMatch.name,
        ...(tagMatch.alias !== undefined && { alias: tagMatch.alias }),
        entries: [],
        lineNumber: lineNum,
      };
      currentTagGroup = newGroup;
      if (tagMatch.alias) {
        metaAliasMap.set(normKey(tagMatch.alias), tagAttrKey(tagMatch.name));
      }
      metaAliasMap.set(normKey(tagMatch.name), tagAttrKey(tagMatch.name));
      if (tagMatch.inlineValues) {
        for (const rawVal of tagMatch.inlineValues) {
          const { text, isDefault } = stripDefaultModifier(rawVal);
          const { label, color } = extractColor(
            text,
            palette,
            diagnostics,
            lineNum
          );
          newGroup.entries.push({
            value: label,
            color: color ?? AUTO_TAG_COLOR_SENTINEL,
            lineNumber: lineNum,
          });
          if (isDefault) newGroup.defaultValue = label;
        }
        if (!newGroup.defaultValue && newGroup.entries.length > 0) {
          newGroup.defaultValue = newGroup.entries[0]!.value;
        }
      }
      tagGroups.push(newGroup);
      continue;
    }
    // Tag entries (indented under a heading, before any content).
    if (currentTagGroup && indent > 0 && !sawContent) {
      const { text, isDefault } = stripDefaultModifier(trimmed);
      const { label, color } = extractColor(
        text,
        palette,
        diagnostics,
        lineNum
      );
      currentTagGroup.entries.push({
        value: label,
        color: color ?? AUTO_TAG_COLOR_SENTINEL,
        lineNumber: lineNum,
      });
      if (isDefault || currentTagGroup.entries.length === 1) {
        currentTagGroup.defaultValue = label;
      }
      continue;
    }
    if (indent === 0) currentTagGroup = null;

    // `direction LR|TB`.
    if (indent === 0 && /^direction\s+/i.test(trimmed)) {
      const val = trimmed
        .replace(/^direction\s+/i, '')
        .trim()
        .toUpperCase();
      if (val === 'LR' || val === 'TB') {
        direction = val;
        options['direction'] = val;
      }
      continue;
    }

    // `lane <Name> [color]`.
    if (indent === 0 && /^lane\s+/i.test(trimmed)) {
      const rest = trimmed.replace(/^lane\s+/i, '').trim();
      const { label, color } = extractColor(
        rest,
        palette,
        diagnostics,
        lineNum
      );
      const key = normKey(label);
      if (laneByKey.has(key)) continue; // ignore re-declaration
      const lane: SwimLane = {
        id: label,
        label,
        ...(color !== undefined && { color }),
        lineNumber: lineNum,
      };
      lanes.push(lane);
      laneByKey.set(key, lane);
      continue;
    }

    // Anything else at indent 0 that is not a phase/flow marks content start
    // (so trailing tag entries don't leak). Phases and content handled in pass 2.
    if (indent === 0 && !trimmed.startsWith('tag ')) sawContent = true;
  }

  // Lane colors: resolve raw names — keep raw name in the model; the renderer
  // resolves to hex. (extractColor already stored a hex; but we stored the raw
  // word above via extractColor's label/color — color IS a resolved hex string.)

  // ── Pass 2: phases, lane context, nodes, flow ───────────────
  let currentPhase: SwimPhase | null = null;
  let currentLane: SwimLane | null = null;
  let laneIndent = -1; // indent at which the current lane context was opened
  let currentFlowSource: string | null = null;

  const declareNode = (
    token: string,
    meta: Record<string, string>,
    lineNum: number
  ): void => {
    const parsed = parseNodeToken(token);
    if (parsed.unsupported) {
      push(lineNum, parsed.unsupported, SWIMLANE_DIAGNOSTIC_CODES.UNSUPPORTED);
      return;
    }
    if (!parsed.label) return;
    if (!currentLane) {
      push(
        lineNum,
        `Node '${parsed.label}' is not inside a lane — declare a lane first`,
        SWIMLANE_DIAGNOSTIC_CODES.UNKNOWN_LANE
      );
      return;
    }
    // Strip the same-line trailing color token BEFORE computing the identity
    // key — the flow block references the node by its clean name (`resolveRef`
    // keys off the post-color label), so dedup + lookup must use `cleanLabel`
    // too, else a colored node is unreferenceable and duplicates slip the gate.
    const { label: cleanLabel, color } = extractColor(
      parsed.label,
      palette,
      diagnostics,
      lineNum
    );
    const key = normKey(cleanLabel);
    if (nodeByKey.has(key)) {
      push(
        lineNum,
        `Duplicate node name '${cleanLabel}'`,
        SWIMLANE_DIAGNOSTIC_CODES.DUPLICATE_NODE
      );
      return;
    }
    // Tag-meta: reject the deferred reserved keys.
    const tags: Record<string, string> = {};
    for (const [k, v] of Object.entries(meta)) {
      if (k === 'note') {
        push(
          lineNum,
          'notes are deferred past v1',
          SWIMLANE_DIAGNOSTIC_CODES.UNSUPPORTED
        );
        continue;
      }
      if (k === 'data') {
        push(
          lineNum,
          'data objects are deferred past v1',
          SWIMLANE_DIAGNOSTIC_CODES.UNSUPPORTED
        );
        continue;
      }
      if (k === 'timer' || k === 'message' || k === 'signal') {
        push(
          lineNum,
          `${k} events are fast-follow`,
          SWIMLANE_DIAGNOSTIC_CODES.UNSUPPORTED
        );
        continue;
      }
      const canonical = metaAliasMap.get(k) ?? k;
      tags[canonical] = v;
    }
    const node: SwimNode = {
      id: cleanLabel,
      label: cleanLabel,
      shape: parsed.shape,
      event: parsed.event,
      lane: currentLane.id,
      ...(currentPhase && { phase: currentPhase.id }),
      ...(color !== undefined && { color }),
      tags,
      lineNumber: lineNum,
    };
    nodes.push(node);
    nodeByKey.set(key, node);
  };

  const resolveRef = (token: string, lineNum: number): string | null => {
    const parsed = parseNodeToken(token);
    if (parsed.unsupported) {
      push(lineNum, parsed.unsupported, SWIMLANE_DIAGNOSTIC_CODES.UNSUPPORTED);
      return null;
    }
    const { label } = extractColor(parsed.label, palette);
    const key = normKey(label);
    const node = nodeByKey.get(key);
    if (!node) {
      push(
        lineNum,
        `Edge references unknown node '${parsed.label}'`,
        SWIMLANE_DIAGNOSTIC_CODES.UNKNOWN_NODE
      );
      return null;
    }
    return node.id;
  };

  const addChain = (line: string, lineNum: number): void => {
    if (line.includes('~>')) {
      push(
        lineNum,
        'message flow (~>) is fast-follow',
        SWIMLANE_DIAGNOSTIC_CODES.UNSUPPORTED
      );
      return;
    }
    const parts = splitChain(line);
    if (parts.length < 2) return;
    // A leading empty part means the chain starts with `-label->`, so its source
    // is the group header (`currentFlowSource`). Every indented arrow under one
    // header fans out from the SAME header — we never chain off a prior line's
    // tail — so the group source is read but not reassigned here.
    const resolved: (string | null)[] = [];
    for (let p = 0; p < parts.length; p++) {
      const text = parts[p]!.text;
      if (p === 0 && text === '') {
        resolved.push(currentFlowSource);
        continue;
      }
      resolved.push(resolveRef(text, lineNum));
    }
    for (let p = 0; p < parts.length - 1; p++) {
      const src = resolved[p];
      const tgt = resolved[p + 1];
      const label = parts[p]!.labelAfter;
      if (!src || !tgt) continue;
      edges.push({
        source: src,
        target: tgt,
        ...(label !== undefined && { label }),
        lineNumber: lineNum,
      });
    }
  };

  let inTagBlock = false; // skip a `tag` heading's indented entries (pass-1 owns them)
  for (let i = startIdx; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const lineNum = i + 1;
    let trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    // Strip trailing inline comments.
    const cIdx = trimmed.indexOf('//');
    if (cIdx > 0) trimmed = trimmed.slice(0, cIdx).trim();
    if (!trimmed) continue;
    const indent = measureIndent(raw);

    // Skip the declarations pass-1 already consumed.
    if (indent === 0 && /^(lane|direction|tag)\s+/i.test(trimmed)) {
      inTagBlock = /^tag\s+/i.test(trimmed);
      continue;
    }
    // Indented tag entries (already consumed in pass 1).
    if (matchTagBlockHeading(trimmed) && indent === 0) {
      inTagBlock = true;
      continue;
    }
    if (indent === 0) inTagBlock = false;
    if (inTagBlock && indent > 0) continue;

    // `[Phase]` header (bracketed, not `[[subprocess]]`).
    if (
      indent === 0 &&
      trimmed.startsWith('[') &&
      trimmed.endsWith(']') &&
      !trimmed.startsWith('[[')
    ) {
      const label = trimmed.slice(1, -1).trim();
      if (lanes.length === 0) {
        push(
          lineNum,
          `Phase '${label}' declared but no lanes exist`,
          SWIMLANE_DIAGNOSTIC_CODES.NO_LANES
        );
      }
      const key = normKey(label);
      let phase = phaseByKey.get(key);
      if (!phase) {
        phase = { id: label, label, lineNumber: lineNum };
        phases.push(phase);
        phaseByKey.set(key, phase);
      }
      currentPhase = phase;
      currentLane = null;
      laneIndent = -1;
      currentFlowSource = null;
      continue;
    }

    // Flow edge (contains an arrow). Node names can't contain `->`, so a bare
    // `->`/`~>` presence unambiguously marks a flow line.
    if (trimmed.includes('->') || trimmed.includes('~>')) {
      addChain(trimmed, lineNum);
      continue;
    }

    // A bare line matching a declared lane opens that lane's context — but ONLY
    // at the lane indent level (or shallower). A line DEEPER than the current
    // lane is a node even when it shares a lane's name (lanes and nodes are
    // separate namespaces; the indent disambiguates 3-deep phase ▸ lane ▸ node).
    const laneRef = laneByKey.get(normKey(trimmed));
    if (laneRef && (laneIndent < 0 || indent <= laneIndent)) {
      currentLane = laneRef;
      laneIndent = indent;
      currentFlowSource = null;
      continue;
    }

    // A bare indent-0 line that is NOT a lane → flow source-group header.
    if (indent === 0) {
      const ref = resolveRef(trimmed, lineNum);
      if (ref) currentFlowSource = ref;
      continue;
    }

    // Indented bare line → node declaration under the current lane.
    const { token, meta } = splitNodeMeta(trimmed);
    declareNode(token, meta, lineNum);
  }

  finalizeAutoTagColors(tagGroups, palette);

  // Per-element diagnostics (duplicate/unknown/unsupported) are non-fatal — the
  // rest of the diagram still renders best-effort. `error` stays null so the
  // export guard only bails on a genuinely empty diagram (nodes.length === 0).
  return {
    ...(title !== undefined && { title }),
    ...(titleLineNumber !== undefined && { titleLineNumber }),
    direction,
    lanes,
    phases,
    nodes,
    edges,
    tagGroups,
    options,
    diagnostics,
    error: null,
  };
}

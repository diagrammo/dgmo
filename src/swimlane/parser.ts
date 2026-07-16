// ============================================================
// Swimlane Diagram — Parser
// ============================================================
//
// Grammar (spec §27 — "lane blocks own their edges"):
//   swimlane [Title]
//   direction LR|TB                 // optional, default LR
//   tag <Name> as <a> …             // optional tag groups (§1.5)
//   lane <Name> [color]             // declares a lane AND opens its block
//     <node>                        //   bare task / <gateway> / (terminal) / [[subprocess]]
//     A -label-> B                  //   edges are inline — no separate flow block
//     <Source>                      //   a bare node header groups the indented
//       -label-> Target             //   arrows beneath it (fan)
//   [Phase]                         // optional phase columns (3-deep):
//     lane <Name> [color]           //   [Phase] ▸ lane ▸ nodes
//       <node>
//
// A node is OWNED by the lane where it is a line-head (bare node or arrow
// source); elsewhere the same name is a reference, resolved after the whole
// diagram is read (forward references are fine). References are lane-scoped —
// resolve own-lane-first, then global-unique, then ambiguous; a `Lane.Node`
// qualifier picks one lane. An unresolved reference auto-creates a leaf ONLY
// when delimited (terminal/gateway/subprocess); an unresolved bare task is an
// UNKNOWN_NODE error (typo protection).
//
// Two passes: a scan collects node declarations + raw edges, then a resolve
// pass wires the edges (so edges may point at not-yet-declared nodes).
// Detection is via `ALL_CHART_TYPES` (utils/parsing.ts) / `parseFirstLine`.

import { emit, type DgmoError } from '../diagnostics';
import { SWIMLANE_DX } from './diagnostics';
import {
  measureIndent,
  extractColor,
  parseFirstLine,
  FILL_FAMILY_TOKENS,
} from '../utils/parsing';
import {
  matchTagBlockHeading,
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
  const metaAliasMap = new Map<string, string>();
  const options: Record<string, string> = {};
  let direction: SwimDirection = 'LR';

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

    // `solid-fill` bare directive (full-saturation node fills).
    if (indent === 0 && FILL_FAMILY_TOKENS.has(trimmed.toLowerCase())) {
      for (const t of FILL_FAMILY_TOKENS) delete options[t];
      if (trimmed.toLowerCase() !== 'fill-tint')
        options[trimmed.toLowerCase()] = 'on';
      continue;
    }

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

    // `lane <Name> [color]` — at ANY indent. In Candidate-A a lane header both
    // declares the lane AND opens its block; under a `[Phase]` the header is
    // indented, so we can't gate on indent 0. Declaration order (first
    // appearance) fixes lane order; re-declarations are ignored below.
    if (/^lane\s+/i.test(trimmed)) {
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

  // ── Pass 2 (Candidate A) ────────────────────────────────────
  //
  // Two sub-passes so edges may forward-reference nodes and so a node can be
  // declared by the arrow line that first mentions it (no separate flow block):
  //
  //   scan   — walk lines top-to-bottom. A `lane` header (or a bare line
  //            matching a lane) opens a lane block; indented lines beneath it
  //            declare nodes AND their outgoing edges inline. Arrow HEADS
  //            declare their node in the current lane; arrow TARGETS are only
  //            references, collected raw. Back-compat: an arrow at indent 0
  //            (old flow block) declares nothing and resolves strictly.
  //   resolve — with every explicit node now known, resolve each raw edge's
  //            source + target. A bare reference looks in its own lane first,
  //            then across all lanes (unique → resolve, many → ambiguous). A
  //            `Lane.Node` qualifier targets one lane. A target that resolves
  //            nowhere is implicitly declared in the referencing lane (a leaf),
  //            unless the edge was authored at indent 0 (then it is UNKNOWN).
  //
  // Node identity is lane-scoped: two lanes may each hold a `Review`. The
  // emitted `id` is the label when globally unique, else lane-suffixed, so the
  // layout/renderer (which key purely off unique ids) stay untouched.

  interface Draft {
    id: string; // assigned after resolve
    label: string;
    laneId: string;
    phaseId?: string;
    shape: SwimShape;
    event: SwimEvent;
    color?: string;
    tags: Record<string, string>;
    lineNumber: number;
    /** A pure declaration line (bare node or `lane`-scoped head) claimed it. */
    hasBareDecl: boolean;
  }
  interface RawEdge {
    srcText: string | null; // null → dropped (no fan source in scope)
    tgtText: string;
    label?: string;
    laneId: string | null; // lane context at author time
    phaseId?: string; // phase context at author time (for implicit leaves)
    inLane: boolean; // authored inside a lane block (indent > lane indent)
    lineNumber: number;
  }

  const drafts: Draft[] = [];
  const draftByKey = new Map<string, Draft>(); // `${laneId}\x00${normLabel}`
  const draftsByLabel = new Map<string, Draft[]>(); // normLabel → drafts
  const rawEdges: RawEdge[] = [];
  const laneKey = (laneId: string, label: string): string =>
    `${normKey(laneId)}\x00${normKey(label)}`;

  /** Split a leading `Lane.` qualifier off a bare (undelimited) token. */
  const splitQualifier = (token: string): { laneId?: string; rest: string } => {
    const t = token.trim();
    if (/^[<([]/.test(t)) return { rest: t }; // shape-delimited → never qualified
    const dot = t.indexOf('.');
    if (dot > 0) {
      const lane = laneByKey.get(normKey(t.slice(0, dot)));
      if (lane) return { laneId: lane.id, rest: t.slice(dot + 1).trim() };
    }
    return { rest: t };
  };

  /** Apply same-line `key: value` tag metadata to a draft (rejecting reserved keys). */
  const applyMeta = (
    draft: Draft,
    meta: Record<string, string>,
    lineNum: number
  ): void => {
    for (const [k, v] of Object.entries(meta)) {
      if (k === 'note') {
        diagnostics.push(
          emit(SWIMLANE_DX.UNSUPPORTED, lineNum, {
            reason: 'notes are deferred past v1',
          })
        );
        continue;
      }
      if (k === 'data') {
        diagnostics.push(
          emit(SWIMLANE_DX.UNSUPPORTED, lineNum, {
            reason: 'data objects are deferred past v1',
          })
        );
        continue;
      }
      if (k === 'timer' || k === 'message' || k === 'signal') {
        diagnostics.push(
          emit(SWIMLANE_DX.UNSUPPORTED, lineNum, {
            reason: `${k} events are fast-follow`,
          })
        );
        continue;
      }
      const canonical = metaAliasMap.get(k) ?? k;
      draft.tags[canonical] = v;
    }
  };

  const registerDraft = (draft: Draft): void => {
    draftByKey.set(laneKey(draft.laneId, draft.label), draft);
    const nk = normKey(draft.label);
    (draftsByLabel.get(nk) ?? draftsByLabel.set(nk, []).get(nk)!).push(draft);
    drafts.push(draft);
  };

  /** Merge a fresh appearance into an existing draft (shape/event/color upgrades). */
  const mergeDraft = (
    draft: Draft,
    parsed: NodeTokenResult,
    color: string | undefined
  ): void => {
    if (draft.shape === 'task' && parsed.shape !== 'task')
      draft.shape = parsed.shape;
    if (draft.event === 'none' && parsed.event !== 'none')
      draft.event = parsed.event;
    if (draft.color === undefined && color !== undefined) draft.color = color;
  };

  /**
   * Declare (or merge) a node from a line-head / bare token in `laneId`.
   * `bare` marks a pure declaration line so a second one flags a duplicate.
   */
  const declareInLane = (
    rawText: string,
    laneId: string,
    phaseId: string | undefined,
    bare: boolean,
    lineNum: number
  ): Draft | null => {
    const { token, meta } = splitNodeMeta(rawText);
    const { rest } = splitQualifier(token); // a head qualifier only strips the label
    const parsed = parseNodeToken(rest);
    if (parsed.unsupported) {
      diagnostics.push(
        emit(SWIMLANE_DX.UNSUPPORTED, lineNum, { reason: parsed.unsupported })
      );
      return null;
    }
    if (!parsed.label) return null;
    const { label: cleanLabel, color } = extractColor(
      parsed.label,
      palette,
      diagnostics,
      lineNum
    );
    const key = laneKey(laneId, cleanLabel);
    const existing = draftByKey.get(key);
    if (existing) {
      if (bare && existing.hasBareDecl) {
        diagnostics.push(
          emit(SWIMLANE_DX.DUPLICATE_NODE, lineNum, { name: cleanLabel })
        );
        return existing;
      }
      mergeDraft(existing, parsed, color);
      if (bare) existing.hasBareDecl = true;
      if (existing.phaseId === undefined && phaseId !== undefined)
        existing.phaseId = phaseId;
      applyMeta(existing, meta, lineNum);
      return existing;
    }
    const draft: Draft = {
      id: cleanLabel,
      label: cleanLabel,
      laneId,
      ...(phaseId !== undefined && { phaseId }),
      shape: parsed.shape,
      event: parsed.event,
      ...(color !== undefined && { color }),
      tags: {},
      lineNumber: lineNum,
      hasBareDecl: bare,
    };
    applyMeta(draft, meta, lineNum);
    registerDraft(draft);
    return draft;
  };

  /**
   * Resolve an edge endpoint (source or target) to a draft. Bare refs resolve
   * lane-first → global-unique → ambiguous; `Lane.Node` targets one lane. An
   * unresolved reference is materialized as a leaf node ONLY when it is
   * **delimited** — a terminal `(…)`, gateway `<…>`, or subprocess `[[…]]`,
   * i.e. an intentional endpoint. An unresolved **bare task** is an
   * `E_SWIMLANE_UNKNOWN_NODE` error, so a typo'd target name is caught instead
   * of silently spawning a phantom node.
   */
  const resolveEndpoint = (
    rawText: string,
    laneId: string | null,
    phaseId: string | undefined,
    lineNum: number
  ): Draft | null => {
    const { token, meta } = splitNodeMeta(rawText);
    const { laneId: qLane, rest } = splitQualifier(token);
    const parsed = parseNodeToken(rest);
    if (parsed.unsupported) {
      diagnostics.push(
        emit(SWIMLANE_DX.UNSUPPORTED, lineNum, { reason: parsed.unsupported })
      );
      return null;
    }
    const { label: cleanLabel } = extractColor(parsed.label, palette);
    const nk = normKey(cleanLabel);
    // Only a delimited endpoint (terminal/gateway/subprocess) may auto-create.
    const delimited = parsed.shape !== 'task';

    const finish = (d: Draft): Draft => {
      applyMeta(d, meta, lineNum);
      return d;
    };
    const implicit = (owner: string): Draft => {
      const draft: Draft = {
        id: cleanLabel,
        label: cleanLabel,
        laneId: owner,
        ...(phaseId !== undefined && { phaseId }),
        shape: parsed.shape,
        event: parsed.event,
        tags: {},
        lineNumber: lineNum,
        hasBareDecl: false,
      };
      applyMeta(draft, meta, lineNum);
      registerDraft(draft);
      return draft;
    };

    // Qualified `Lane.Node` → that lane exactly.
    if (qLane) {
      const hit = draftByKey.get(laneKey(qLane, cleanLabel));
      if (hit) return finish(hit);
      if (delimited) return implicit(qLane);
      diagnostics.push(
        emit(SWIMLANE_DX.UNKNOWN_NODE, lineNum, {
          node: `${qLane}.${cleanLabel}`,
        })
      );
      return null;
    }

    // Bare: prefer the current lane, then a global-unique match.
    if (laneId) {
      const own = draftByKey.get(laneKey(laneId, cleanLabel));
      if (own) return finish(own);
    }
    const cands = draftsByLabel.get(nk) ?? [];
    if (cands.length === 1) return finish(cands[0]!);
    if (cands.length > 1) {
      diagnostics.push(
        emit(SWIMLANE_DX.AMBIGUOUS_NODE, lineNum, {
          node: cleanLabel,
          lanes: cands.map((c) => c.laneId).join(', '),
        })
      );
      return finish(cands[0]!);
    }
    if (delimited && laneId) return implicit(laneId);
    diagnostics.push(
      emit(SWIMLANE_DX.UNKNOWN_NODE, lineNum, { node: parsed.label })
    );
    return null;
  };

  // ── scan ──
  let currentPhase: SwimPhase | null = null;
  let currentLane: SwimLane | null = null;
  let laneIndent = -1; // indent at which the current lane block was opened
  let flowSource: string | null = null; // last bare/header token (fan source)
  let inTagBlock = false;

  const openLane = (lane: SwimLane, indent: number, phased: boolean): void => {
    currentLane = lane;
    laneIndent = indent;
    if (!phased) currentPhase = null;
    flowSource = null;
  };

  for (let i = startIdx; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const lineNum = i + 1;
    let trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const cIdx = trimmed.indexOf('//');
    if (cIdx > 0) trimmed = trimmed.slice(0, cIdx).trim();
    if (!trimmed) continue;
    const indent = measureIndent(raw);

    // `direction` / `tag` were consumed in pass 1.
    if (indent === 0 && /^direction\s+/i.test(trimmed)) continue;
    if (indent === 0 && FILL_FAMILY_TOKENS.has(trimmed.toLowerCase())) continue;
    if (matchTagBlockHeading(trimmed) && indent === 0) {
      inTagBlock = true;
      continue;
    }
    if (indent === 0) inTagBlock = false;
    if (inTagBlock && indent > 0) continue;

    // `lane <Name> [color]` opens (or re-opens) that lane's block. Indented
    // under a `[Phase]` it keeps the current phase; at indent 0 it clears it.
    if (/^lane\s+/i.test(trimmed)) {
      const rest = trimmed.replace(/^lane\s+/i, '').trim();
      const { label } = extractColor(rest, palette);
      const lane = laneByKey.get(normKey(label));
      if (lane) openLane(lane, indent, indent > 0);
      continue;
    }

    // `[Phase]` header (bracketed, not `[[subprocess]]`).
    if (
      indent === 0 &&
      trimmed.startsWith('[') &&
      trimmed.endsWith(']') &&
      !trimmed.startsWith('[[')
    ) {
      const label = trimmed.slice(1, -1).trim();
      if (lanes.length === 0) {
        diagnostics.push(emit(SWIMLANE_DX.NO_LANES, lineNum, { phase: label }));
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
      flowSource = null;
      continue;
    }

    const cl = currentLane as SwimLane | null;
    const cp = currentPhase as SwimPhase | null;
    const laneCtx = cl?.id ?? null;
    const phaseCtx = cp?.id;
    const inLane = cl !== null && indent > laneIndent;

    // Flow edge (contains an arrow). A node name can't hold `->`/`~>`.
    if (trimmed.includes('->') || trimmed.includes('~>')) {
      if (trimmed.includes('~>')) {
        diagnostics.push(
          emit(SWIMLANE_DX.UNSUPPORTED, lineNum, {
            reason: 'message flow (~>) is fast-follow',
          })
        );
        continue;
      }
      const parts = splitChain(trimmed);
      if (parts.length < 2) continue;
      // The head declares its node (inside a lane block only); a leading empty
      // head means the chain fans from the current header (`flowSource`).
      let headText: string | null;
      if (parts[0]!.text === '') {
        headText = flowSource;
      } else {
        headText = parts[0]!.text;
        if (inLane) declareInLane(headText, laneCtx!, phaseCtx, false, lineNum);
      }
      for (let p = 0; p < parts.length - 1; p++) {
        const srcText = p === 0 ? headText : parts[p]!.text;
        rawEdges.push({
          srcText,
          tgtText: parts[p + 1]!.text,
          ...(parts[p]!.labelAfter !== undefined && {
            label: parts[p]!.labelAfter,
          }),
          laneId: laneCtx,
          ...(phaseCtx !== undefined && { phaseId: phaseCtx }),
          inLane,
          lineNumber: lineNum,
        });
      }
      continue;
    }

    // A bare line matching a declared lane (at/above the lane indent) opens it.
    const laneRef = laneByKey.get(normKey(trimmed));
    if (laneRef && (laneIndent < 0 || indent <= laneIndent)) {
      openLane(laneRef, indent, currentPhase !== null && indent > 0);
      continue;
    }

    // A bare node line inside a lane block → declaration; it also becomes the
    // fan source for any `-label->` lines that follow.
    if (inLane) {
      declareInLane(trimmed, laneCtx!, phaseCtx, true, lineNum);
      flowSource = trimmed;
      continue;
    }

    // A bare line with no lane in scope → node outside a lane (error), unless it
    // is a back-compat flow source-group header (indent 0) referencing a node.
    if (indent === 0) {
      flowSource = trimmed; // resolved lazily as an edge source below
      continue;
    }
    const { token } = splitNodeMeta(trimmed);
    const nodeLabel = parseNodeToken(splitQualifier(token).rest).label;
    diagnostics.push(
      emit(SWIMLANE_DX.UNKNOWN_LANE, lineNum, { node: nodeLabel })
    );
  }

  // ── resolve (into draft pairs; ids are finalized below) ──
  const resolvedPairs: Array<{
    s: Draft;
    t: Draft;
    label?: string;
    lineNumber: number;
  }> = [];
  for (const e of rawEdges) {
    if (e.srcText === null) continue;
    const s = resolveEndpoint(e.srcText, e.laneId, e.phaseId, e.lineNumber);
    const t = resolveEndpoint(e.tgtText, e.laneId, e.phaseId, e.lineNumber);
    if (!s || !t) continue;
    resolvedPairs.push({
      s,
      t,
      ...(e.label !== undefined && { label: e.label }),
      lineNumber: e.lineNumber,
    });
  }

  // ── assign unique ids + emit nodes ──
  // id = label when the label is globally unique; else lane-suffixed so the
  // layout/renderer (keyed on id) never sees a collision.
  const labelCounts = new Map<string, number>();
  for (const d of drafts)
    labelCounts.set(
      normKey(d.label),
      (labelCounts.get(normKey(d.label)) ?? 0) + 1
    );
  const usedIds = new Set<string>();
  for (const d of drafts) {
    let id = d.label;
    if ((labelCounts.get(normKey(d.label)) ?? 0) > 1)
      id = `${d.label}␟${d.laneId}`;
    while (usedIds.has(id)) id = `${id}␟`;
    usedIds.add(id);
    d.id = id;
    nodes.push({
      id,
      label: d.label,
      shape: d.shape,
      event: d.event,
      lane: d.laneId,
      ...(d.phaseId !== undefined && { phase: d.phaseId }),
      ...(d.color !== undefined && { color: d.color }),
      tags: d.tags,
      lineNumber: d.lineNumber,
    });
  }
  // Build edges now that draft ids are final.
  for (const p of resolvedPairs) {
    if (p.s.id === p.t.id) continue; // self-loop → nothing to route
    edges.push({
      source: p.s.id,
      target: p.t.id,
      ...(p.label !== undefined && { label: p.label }),
      lineNumber: p.lineNumber,
    });
  }

  finalizeAutoTagColors(tagGroups, palette);

  // Per-element diagnostics (duplicate/unknown/unsupported/ambiguous) are
  // non-fatal — the rest of the diagram still renders best-effort. `error`
  // stays null so the export guard only bails on a genuinely empty diagram.
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

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
//   pool <Name>                     // BPMN pools (#1874): pool ▸ lane ▸ nodes;
//     lane <Name> [color]           //   a pool with no lanes is an outside
//       A ~> B                      //   party. `~>` (message flow) runs
//                                   //   between pools only.
//
// BPMN extras on a node line: `type:` (task marker), `store:` / `data:` /
// `note:` (attachments; `note:` runs to the end of the line), an event line
// indented under a task (a boundary event), and `<+> as name` (an unlabelled
// gateway other lines can point at).
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
import { withPaletteLifted } from '../palettes/directive';
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
import type { ChartFrame } from '../utils/chart-frame-parse';
import {
  parseChartFrameLine,
  takeFootnoteBlock,
} from '../utils/chart-frame-parse';
import { SWIM_TASK_TYPES } from './types';
import type {
  ParsedSwimlane,
  SwimArtifact,
  SwimDirection,
  SwimEdge,
  SwimEvent,
  SwimLane,
  SwimMessage,
  SwimNode,
  SwimPhase,
  SwimPool,
  SwimShape,
  SwimTaskType,
} from './types';

/** Collapse internal whitespace + lowercase for a lookup key. */
function normKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

interface NodeTokenResult {
  shape: SwimShape;
  event: SwimEvent;
  label: string;
  /** `as name` on a gateway (§2A): the name other lines point at. */
  alias?: string;
  /** Set when the token is a construct left out for now (UNSUPPORTED). */
  unsupported?: string;
}

/** Event trailing words that are BPMN but left out for now (#1874). */
const UNSUPPORTED_EVENT_WORDS = new Set([
  'escalation',
  'compensation',
  'conditional',
  'cancel',
  'link',
]);

/** Gateway with an `as name` alias: `<+> as join`, `<o Checks?> as checks`. */
const GATEWAY_ALIAS_RE = /^(<.*>)\s+as\s+([^<>()]+)$/i;

/**
 * Parse a node token (shape + event + label) from a structural / flow
 * reference. Delimiters are optional sugar — `Validate` ≡ `<Validate>`.
 */
function parseNodeToken(raw: string): NodeTokenResult {
  let t = raw.trim();

  // Gateways: <…>, <+ …>, <o …>, <* …> — each with an optional `as name`.
  let alias: string | undefined;
  const am = t.startsWith('<') ? t.match(GATEWAY_ALIAS_RE) : null;
  if (am) {
    t = am[1]!.trim();
    alias = am[2]!.trim();
  }
  if (t.startsWith('<') && t.endsWith('>') && t.length >= 2) {
    const inner = t.slice(1, -1).trim();
    const withAlias = (r: NodeTokenResult): NodeTokenResult =>
      alias !== undefined ? { ...r, alias } : r;
    if (inner.startsWith('+')) {
      return withAlias({
        shape: 'parallel',
        event: 'none',
        label: inner.slice(1).trim(),
      });
    }
    if (inner.startsWith('o ') || inner === 'o') {
      return withAlias({
        shape: 'inclusive',
        event: 'none',
        label: inner.replace(/^o\s*/, '').trim(),
      });
    }
    if (inner.startsWith('*')) {
      return withAlias({
        shape: 'event-based',
        event: 'none',
        label: inner.replace(/^\*\s*/, '').trim(),
      });
    }
    return withAlias({ shape: 'exclusive', event: 'none', label: inner });
  }

  // Subprocess: [[ … ]] (check before single-bracket / phase forms).
  if (t.startsWith('[[') && t.endsWith(']]') && t.length >= 4) {
    return { shape: 'subprocess', event: 'none', label: t.slice(2, -2).trim() };
  }

  // Event: ( … ) with optional `!` error prefix + optional trailing type
  // word (`(Paid) success`, `(5 days) timer`). The word lives OUTSIDE the parens.
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
        if (
          trailing === 'success' ||
          trailing === 'terminate' ||
          trailing === 'error' ||
          trailing === 'message' ||
          trailing === 'timer' ||
          trailing === 'signal'
        )
          event = trailing;
        else if (UNSUPPORTED_EVENT_WORDS.has(trailing))
          unsupported = `${trailing} events are not supported — use message, timer, signal, error or terminate`;
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

/** The name a token is looked up by: its label, else its `as` alias. */
const tokenName = (p: NodeTokenResult): string => p.label || (p.alias ?? '');

const isGatewayShape = (s: SwimShape): boolean =>
  s === 'exclusive' ||
  s === 'parallel' ||
  s === 'inclusive' ||
  s === 'event-based';

const ARROW_SPACE = /\s/;
interface ArrowMatch {
  index: number;
  text: string;
  label?: string;
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
 *
 * `nextArrow` is that pattern, `(?:^|\s)-([^>]+?)->|->|~>`, as a scan: at or after `from`: `(?:^|\s)-([^>]+?)->` first, then
 * A label can only end at the first
 * `>` after its dash, so that `>` is found once and reused; the regex form
 * rescanned to the end of the line from every ` -` start.
 */
function nextArrow(line: string, from: number): ArrowMatch | null {
  let gt = -2; // cached first `>` at or after the label start; -1 = none
  for (let s = from; s < line.length; s++) {
    const dash =
      s === 0 && line[0] === '-' ? 0 : ARROW_SPACE.test(line[s]!) ? s + 1 : -1;
    if (dash >= 0 && line[dash] === '-') {
      const b = dash + 1;
      if (gt === -2 || (gt >= 0 && gt < b)) gt = line.indexOf('>', b);
      if (gt >= b + 2 && line[gt - 1] === '-')
        return {
          index: s,
          text: line.slice(s, gt + 1),
          label: line.slice(b, gt - 1),
        };
    }
    if (line.startsWith('->', s) || line.startsWith('~>', s))
      return { index: s, text: line.slice(s, s + 2) };
  }
  return null;
}

/** Lanes a diagnostic names for an ambiguous node; the rest are counted. */
const AMBIGUOUS_LANES_SHOWN = 10;

interface ChainPart {
  text: string;
  /** Label of the arrow that FOLLOWS this part (undefined for the last). */
  labelAfter?: string;
  /** True when the arrow that FOLLOWS this part is message flow (`~>`). */
  messageAfter?: boolean;
}

/** Split a flow line into node references + in-arrow labels. */
function splitChain(line: string): ChainPart[] {
  const parts: ChainPart[] = [];
  let lastIndex = 0;
  let m: ArrowMatch | null;
  const rawLabels: (string | undefined)[] = [];
  const rawMessage: boolean[] = [];
  const segments: string[] = [];
  while ((m = nextArrow(line, lastIndex)) !== null) {
    segments.push(line.slice(lastIndex, m.index));
    let lbl = m.label?.trim();
    if (lbl === '') lbl = undefined; // `-->` (empty in-arrow label) → no label
    rawLabels.push(lbl);
    rawMessage.push(m.text === '~>');
    lastIndex = m.index + m.text.length;
  }
  segments.push(line.slice(lastIndex));
  for (let i = 0; i < segments.length; i++) {
    parts.push({
      text: segments[i]!.trim(),
      ...(rawLabels[i] !== undefined && { labelAfter: rawLabels[i]! }),
      ...(rawMessage[i] && { messageAfter: true }),
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
  let region = line.slice(cut);
  const meta: Record<string, string> = {};
  // `note:` is free text, commas included, so it runs to the end of the line.
  const nm = region.match(/(?:^|,)\s*note\s*:/i);
  if (nm?.index !== undefined) {
    meta['note'] = region.slice(nm.index + nm[0].length).trim();
    region = region.slice(0, nm.index);
  }
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
  return withPaletteLifted(content, (lifted) =>
    parseSwimlaneRaw(lifted, palette)
  );
}

function parseSwimlaneRaw(
  content: string,
  palette?: PaletteColors
): ParsedSwimlane {
  const diagnostics: DgmoError[] = [];
  const lanes: SwimLane[] = [];
  const pools: Writable<SwimPool>[] = [];
  const messages: SwimMessage[] = [];
  const phases: SwimPhase[] = [];
  const nodes: SwimNode[] = [];
  const edges: SwimEdge[] = [];
  const tagGroups: Writable<TagGroup>[] = [];

  const laneByKey = new Map<string, SwimLane>();
  const poolByKey = new Map<string, Writable<SwimPool>>();
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
  let pass1Pool: Writable<SwimPool> | null = null;
  const lanesOutsidePools: SwimLane[] = [];
  // Chart frame lines (#1827) are read here and skipped by the later passes.
  const frameHolder: { frame?: ChartFrame } = {};
  const frameLines = new Set<number>();
  // The footnote block and its markdown body (#2093), before any line is read.
  takeFootnoteBlock(frameHolder, rawLines, diagnostics);
  for (let i = startIdx; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const lineNum = i + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (parseChartFrameLine(frameHolder, raw, lineNum, diagnostics)) {
      frameLines.add(lineNum);
      currentTagGroup = null;
      continue;
    }
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

    // Layout direction — canonical booleans `direction-lr` / `direction-tb`
    // (§1.9, last one wins); key+value `direction LR|TB` accepted legacy.
    const dirBool = indent === 0 ? trimmed.match(/^direction-(lr|tb)$/i) : null;
    if (dirBool) {
      direction = dirBool[1]!.toUpperCase() as SwimDirection;
      options['direction'] = direction;
      continue;
    }
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
    // `pool <Name>` at indent 0 opens a pool; its lanes indent under it.
    if (indent === 0 && /^pool\s+/i.test(trimmed)) {
      const label = trimmed.replace(/^pool\s+/i, '').trim();
      const key = normKey(label);
      let pool = poolByKey.get(key);
      if (!pool) {
        pool = { id: label, label, lanes: [], lineNumber: lineNum };
        pools.push(pool);
        poolByKey.set(key, pool);
      }
      pass1Pool = pool;
      sawContent = true;
      continue;
    }
    if (indent === 0 && trimmed.startsWith('[')) pass1Pool = null;

    if (/^lane\s+/i.test(trimmed)) {
      const rest = trimmed.replace(/^lane\s+/i, '').trim();
      const { label, color } = extractColor(
        rest,
        palette,
        diagnostics,
        lineNum
      );
      if (indent === 0) pass1Pool = null;
      const key = normKey(label);
      if (laneByKey.has(key)) continue; // ignore re-declaration
      const lane: SwimLane = {
        id: label,
        label,
        ...(color !== undefined && { color }),
        ...(pass1Pool && { pool: pass1Pool.id }),
        lineNumber: lineNum,
      };
      if (pass1Pool) pass1Pool.lanes.push(lane.id);
      else lanesOutsidePools.push(lane);
      lanes.push(lane);
      laneByKey.set(key, lane);
      continue;
    }

    // Anything else at indent 0 that is not a phase/flow marks content start
    // (so trailing tag entries don't leak). Phases and content handled in pass 2.
    if (indent === 0 && !trimmed.startsWith('tag ')) sawContent = true;
  }
  if (pools.length > 0) {
    for (const lane of lanesOutsidePools)
      diagnostics.push(
        emit(SWIMLANE_DX.LANE_OUTSIDE_POOL, lane.lineNumber, {
          lane: lane.label,
        })
      );
  }
  const laneById = new Map(lanes.map((l) => [l.id, l]));

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
    /** '' for an unlabelled gateway (`<+> as join`): named, but drawn bare. */
    display?: string;
    taskType?: SwimTaskType;
    boundaryOf?: Draft;
    artifacts: SwimArtifact[];
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
  interface RawMessage {
    /** Source text, or the pool itself when written under a lane-less pool. */
    src: string | SwimPool;
    tgtText: string;
    laneId: string | null;
    phaseId?: string;
    lineNumber: number;
  }

  const drafts: Draft[] = [];
  const draftByKey = new Map<string, Draft>(); // `${laneId}\x00${normLabel}`
  const draftsByLabel = new Map<string, Draft[]>(); // normLabel → drafts
  const rawEdges: RawEdge[] = [];
  const rawMessages: RawMessage[] = [];
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

  /** Artifact kind+label keys per draft, so the same-line dedupe is O(1). */
  const artifactKeys = new WeakMap<Draft, Set<string>>();

  /** Apply same-line `key: value` tag metadata to a draft (rejecting reserved keys). */
  const applyMeta = (
    draft: Draft,
    meta: Record<string, string>,
    lineNum: number
  ): void => {
    for (const [k, v] of Object.entries(meta)) {
      if (k === 'type') {
        const t = v.trim().toLowerCase();
        if ((SWIM_TASK_TYPES as readonly string[]).includes(t))
          draft.taskType = t as SwimTaskType;
        else
          diagnostics.push(
            emit(SWIMLANE_DX.UNKNOWN_TASK_TYPE, lineNum, { value: v.trim() })
          );
        continue;
      }
      if (k === 'store' || k === 'data' || k === 'note') {
        const label = v.trim();
        if (!label) continue;
        const kind = k;
        // A header line's meta is read twice (declaration + fan source).
        let seen = artifactKeys.get(draft);
        if (!seen) {
          seen = new Set(draft.artifacts.map((a) => `${a.kind}\0${a.label}`));
          artifactKeys.set(draft, seen);
        }
        if (!seen.has(`${kind}\0${label}`)) {
          seen.add(`${kind}\0${label}`);
          draft.artifacts.push({ kind, label });
        }
        continue;
      }
      if (k === 'timer' || k === 'message' || k === 'signal') {
        diagnostics.push(
          emit(SWIMLANE_DX.UNSUPPORTED, lineNum, {
            reason: `${k}: is not a key — write the trigger as a trailing word on an event, as in (5 days) ${k}`,
          })
        );
        continue;
      }
      const canonical = metaAliasMap.get(k) ?? k;
      draft.tags[canonical] = v;
    }
  };

  const indexName = (draft: Draft, name: string): void => {
    const key = laneKey(draft.laneId, name);
    if (draftByKey.has(key)) return;
    draftByKey.set(key, draft);
    const nk = normKey(name);
    (draftsByLabel.get(nk) ?? draftsByLabel.set(nk, []).get(nk)!).push(draft);
  };
  const registerDraft = (draft: Draft, alias?: string): void => {
    indexName(draft, draft.label);
    if (alias && normKey(alias) !== normKey(draft.label))
      indexName(draft, alias);
    drafts.push(draft);
  };
  /** An unnamed gateway (`<+>` with no `as`) cannot be pointed at. */
  const unnamedGateway = (
    parsed: NodeTokenResult,
    raw: string,
    lineNum: number
  ): boolean => {
    if (tokenName(parsed) || !isGatewayShape(parsed.shape)) return false;
    diagnostics.push(
      emit(SWIMLANE_DX.UNNAMED_GATEWAY, lineNum, { token: raw.trim() })
    );
    return true;
  };

  /** Merge a fresh appearance into an existing draft (shape/event/color upgrades). */
  const mergeDraft = (
    draft: Draft,
    parsed: NodeTokenResult,
    color: string | undefined
  ): void => {
    if (draft.shape === 'task' && parsed.shape !== 'task') {
      draft.shape = parsed.shape;
      // `merge` declared by a line-head, then pointed at as `<> as merge`.
      if (!parsed.label && parsed.alias) draft.display = '';
    }
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
    if (unnamedGateway(parsed, rest, lineNum)) return null;
    if (!tokenName(parsed)) return null;
    const { label: cleanLabel, color } = extractColor(
      tokenName(parsed),
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
      ...(!parsed.label && parsed.alias && { display: '' }),
      artifacts: [],
    };
    applyMeta(draft, meta, lineNum);
    registerDraft(draft, parsed.label ? parsed.alias : undefined);
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
    if (unnamedGateway(parsed, rest, lineNum)) return null;
    const { label: cleanLabel } = extractColor(tokenName(parsed), palette);
    const nk = normKey(cleanLabel);
    // Only a delimited endpoint (terminal/gateway/subprocess) may auto-create.
    const delimited = parsed.shape !== 'task';

    const finish = (d: Draft): Draft => {
      // A delimited reference can name what a line-head declared bare.
      if (delimited) mergeDraft(d, parsed, undefined);
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
        ...(!parsed.label && parsed.alias && { display: '' }),
        artifacts: [],
      };
      applyMeta(draft, meta, lineNum);
      registerDraft(draft, parsed.label ? parsed.alias : undefined);
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
          lanes:
            cands
              .slice(0, AMBIGUOUS_LANES_SHOWN)
              .map((c) => c.laneId)
              .join(', ') +
            (cands.length > AMBIGUOUS_LANES_SHOWN
              ? ` and ${cands.length - AMBIGUOUS_LANES_SHOWN} more`
              : ''),
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
  let currentPool: SwimPool | null = null;
  let laneIndent = -1; // indent at which the current lane block was opened
  let flowSource: string | null = null; // last bare/header token (fan source)
  // The task a boundary event attaches to: the last bare task line, while
  // lines stay indented beneath it.
  let host: { draft: Draft; indent: number } | null = null;
  let inTagBlock = false;
  let warnedPoolPhase = false;

  const openLane = (lane: SwimLane, indent: number, phased: boolean): void => {
    currentLane = lane;
    laneIndent = indent;
    if (!phased) currentPhase = null;
    if (indent === 0) currentPool = null;
    flowSource = null;
    host = null;
  };
  /** True when the token opens an event — `(…)`, ahead of any meta. */
  const isEventToken = (text: string): boolean =>
    splitNodeMeta(text).token.startsWith('(');

  for (let i = startIdx; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const lineNum = i + 1;
    let trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (frameLines.has(lineNum)) continue;
    const cIdx = trimmed.indexOf('//');
    if (cIdx > 0) trimmed = trimmed.slice(0, cIdx).trim();
    if (!trimmed) continue;
    const indent = measureIndent(raw);

    // `direction` (key+value or boolean) / `tag` were consumed in pass 1.
    if (indent === 0 && /^direction(?:\s+|-(?:lr|tb)$)/i.test(trimmed))
      continue;
    if (indent === 0 && FILL_FAMILY_TOKENS.has(trimmed.toLowerCase())) continue;
    if (matchTagBlockHeading(trimmed) && indent === 0) {
      inTagBlock = true;
      continue;
    }
    if (indent === 0) inTagBlock = false;
    if (inTagBlock && indent > 0) continue;
    if (host && indent <= host.indent) host = null;

    // `pool <Name>` opens a pool (declared in pass 1).
    if (indent === 0 && /^pool\s+/i.test(trimmed)) {
      currentPool =
        poolByKey.get(normKey(trimmed.replace(/^pool\s+/i, ''))) ?? null;
      currentLane = null;
      currentPhase = null;
      laneIndent = -1;
      flowSource = null;
      host = null;
      continue;
    }

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
      currentLane = null;
      currentPool = null;
      laneIndent = -1;
      flowSource = null;
      host = null;
      // Pools with phase columns would be four levels deep — left out for now.
      if (pools.length > 0) {
        if (!warnedPoolPhase)
          diagnostics.push(
            emit(SWIMLANE_DX.UNSUPPORTED, lineNum, {
              reason:
                'pools and [Phase] columns together are not supported yet — remove the [Phase] lines or the pool lines',
            })
          );
        warnedPoolPhase = true;
        currentPhase = null;
        continue;
      }
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
      continue;
    }

    const cl = currentLane as SwimLane | null;
    const cp = currentPhase;
    const laneCtx = cl?.id ?? null;
    const phaseCtx = cp?.id;
    const inLane = cl !== null && indent > laneIndent;
    const pool = currentPool;
    // A line directly under a `pool` header, outside any of its lanes.
    const inPoolBody = pool !== null && indent > 0 && !inLane;

    if (inPoolBody) {
      const parts =
        trimmed.includes('->') || trimmed.includes('~>')
          ? splitChain(trimmed)
          : null;
      // `~> Target` under a pool: the pool itself sends.
      if (
        parts?.length === 2 &&
        parts[0]!.text === '' &&
        parts[0]!.messageAfter
      ) {
        rawMessages.push({
          src: pool,
          tgtText: parts[1]!.text,
          laneId: null,
          lineNumber: lineNum,
        });
        continue;
      }
      if (pool.lanes.length === 0) {
        const head = parts ? parts[0]!.text || parts[1]!.text : trimmed;
        const { token } = splitNodeMeta(head);
        diagnostics.push(
          emit(SWIMLANE_DX.COLLAPSED_POOL, lineNum, {
            pool: pool.label,
            node: parseNodeToken(splitQualifier(token).rest).label || head,
          })
        );
        continue;
      }
      // A pool with lanes: a node line outside them falls through to the
      // node-outside-a-lane error below.
    }

    // Flow edge (contains an arrow). A node name can't hold `->`/`~>`.
    if (trimmed.includes('->') || trimmed.includes('~>')) {
      const parts = splitChain(trimmed);
      if (parts.length < 2) continue;
      // The head declares its node (inside a lane block only); a leading empty
      // head means the chain fans from the current header (`flowSource`).
      let headText: string | null;
      if (parts[0]!.text === '') {
        headText = flowSource;
      } else {
        headText = parts[0]!.text;
        if (inLane) {
          const d = declareInLane(headText, laneCtx!, phaseCtx, false, lineNum);
          // An event indented under a task is a boundary event on it.
          if (d && host && indent > host.indent && isEventToken(headText))
            d.boundaryOf = host.draft;
        }
      }
      for (let p = 0; p < parts.length - 1; p++) {
        const srcText = p === 0 ? headText : parts[p]!.text;
        if (parts[p]!.messageAfter) {
          if (srcText !== null)
            rawMessages.push({
              src: srcText,
              tgtText: parts[p + 1]!.text,
              laneId: laneCtx,
              ...(phaseCtx !== undefined && { phaseId: phaseCtx }),
              lineNumber: lineNum,
            });
          continue;
        }
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
      const boundary = host !== null && indent > host.indent;
      const d = declareInLane(trimmed, laneCtx!, phaseCtx, true, lineNum);
      if (boundary && d && isEventToken(trimmed)) {
        d.boundaryOf = host!.draft;
      } else if (d && (d.shape === 'task' || d.shape === 'subprocess')) {
        host = { draft: d, indent };
      }
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

  // ── resolve message flows (`~>`) ──
  // An end is a whole pool when it names a lane-less pool (or names a pool
  // and no node); otherwise it resolves like any edge endpoint.
  type MsgEnd = { pool: SwimPool } | { draft: Draft };
  const lookupDraft = (text: string, laneId: string | null): Draft | null => {
    const { token } = splitNodeMeta(text);
    const { laneId: qLane, rest } = splitQualifier(token);
    const parsed = parseNodeToken(rest);
    const name = normKey(extractColor(tokenName(parsed), palette).label);
    if (qLane) return draftByKey.get(`${normKey(qLane)}\x00${name}`) ?? null;
    if (laneId) {
      const own = draftByKey.get(`${normKey(laneId)}\x00${name}`);
      if (own) return own;
    }
    const cands = draftsByLabel.get(name) ?? [];
    return cands.length === 1 ? cands[0]! : null;
  };
  const resolveMsgEnd = (
    text: string,
    laneId: string | null,
    phaseId: string | undefined,
    lineNum: number
  ): MsgEnd | null => {
    const pool = poolByKey.get(normKey(splitNodeMeta(text).token));
    if (pool?.lanes.length === 0) return { pool };
    const hit = lookupDraft(text, laneId);
    if (hit) return { draft: hit };
    if (pool) return { pool };
    const d = resolveEndpoint(text, laneId, phaseId, lineNum);
    return d ? { draft: d } : null;
  };
  const poolOfEnd = (end: MsgEnd): string | undefined =>
    'pool' in end ? end.pool.id : laneById.get(end.draft.laneId)?.pool;
  const nameOfEnd = (end: MsgEnd): string =>
    'pool' in end ? end.pool.label : end.draft.label;
  const resolvedMessages: Array<{
    s: MsgEnd;
    t: MsgEnd;
    lineNumber: number;
  }> = [];
  for (const m of rawMessages) {
    const s =
      typeof m.src === 'string'
        ? resolveMsgEnd(m.src, m.laneId, m.phaseId, m.lineNumber)
        : { pool: m.src };
    const t = resolveMsgEnd(m.tgtText, m.laneId, m.phaseId, m.lineNumber);
    if (!s || !t) continue;
    const sp = poolOfEnd(s);
    const tp = poolOfEnd(t);
    if (sp === undefined || tp === undefined || sp === tp) {
      diagnostics.push(
        emit(SWIMLANE_DX.MESSAGE_SAME_POOL, m.lineNumber, {
          source: nameOfEnd(s),
          target: nameOfEnd(t),
          ...(sp !== undefined && sp === tp && { pool: sp }),
        })
      );
      continue;
    }
    resolvedMessages.push({ s, t, lineNumber: m.lineNumber });
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
  }
  for (const d of drafts) {
    // A boundary event's host must be a task; anything else is a plain event.
    const hostDraft =
      d.boundaryOf &&
      d.shape === 'terminal' &&
      (d.boundaryOf.shape === 'task' || d.boundaryOf.shape === 'subprocess') &&
      d.boundaryOf.boundaryOf === undefined
        ? d.boundaryOf
        : undefined;
    nodes.push({
      id: d.id,
      label: d.display ?? d.label,
      shape: d.shape,
      event: d.event,
      lane: d.laneId,
      ...(d.phaseId !== undefined && { phase: d.phaseId }),
      ...(d.color !== undefined && { color: d.color }),
      tags: d.tags,
      ...(d.taskType !== undefined &&
        (d.shape === 'task' || d.shape === 'subprocess') && {
          taskType: d.taskType,
        }),
      ...(hostDraft && { boundaryOf: hostDraft.id }),
      ...(d.artifacts.length > 0 && { artifacts: d.artifacts }),
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

  for (const m of resolvedMessages) {
    const source = 'pool' in m.s ? m.s.pool.id : m.s.draft.id;
    const target = 'pool' in m.t ? m.t.pool.id : m.t.draft.id;
    messages.push({
      source,
      target,
      sourceIsPool: 'pool' in m.s,
      targetIsPool: 'pool' in m.t,
      lineNumber: m.lineNumber,
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
    pools,
    messages,
    phases,
    nodes,
    edges,
    tagGroups,
    options,
    diagnostics,
    ...(frameHolder.frame && { frame: frameHolder.frame }),
    error: null,
  };
}

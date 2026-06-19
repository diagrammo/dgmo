// ============================================================
// Boxes and Lines Diagram — Parser
// ============================================================

import {
  makeDgmoError,
  METADATA_DIAGNOSTIC_CODES,
  pipeOperatorRemovedMessage,
  suggest,
} from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import { parseInArrowLabel } from '../utils/arrows';
import { normalizeName } from '../utils/name-normalize';
import type { ParsedBoxesAndLines, BLNode, BLEdge, BLGroup } from './types';
import {
  matchTagBlockHeading,
  emitTagLegacyDiagnostic,
  injectDefaultTagMetadata,
  validateTagValues,
  validateTagGroupNames,
  stripDefaultModifier,
  finalizeAutoTagColors,
  AUTO_TAG_COLOR_SENTINEL,
} from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import type { Writable } from '../utils/brand';
import {
  extractColor,
  parseFirstLine,
  OPTION_NOCOLON_RE,
  peelRampColors,
  splitNameAndMeta,
  tryParseSharedOption,
  warnUnknownMetaKeys,
} from '../utils/parsing';
import {
  BOXES_AND_LINES_REGISTRY,
  withTagAliases,
} from '../utils/reserved-key-registry';
import { tryCollectNote, resolveNotes, type DiagramNote } from '../utils/notes';
import type { PaletteColors } from '../palettes';

const MAX_GROUP_DEPTH = 2;

/** Boxes-and-lines requires explicit first line — no heuristic detection. */
export function looksLikeBoxesAndLines(_content: string): boolean {
  return false;
}

/** Measure leading whitespace (tabs = 4 spaces) */
function measureIndent(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === ' ') count++;
    else if (ch === '\t') count += 4;
    else break;
  }
  return count;
}

/**
 * Parse the trailing meta segment of a structural line — accepts both
 * the legacy `| key: value, …` and the new §1.4 same-line `key: value, …`
 * forms (a leading `|` is tolerated and stripped). Extracts
 * `description` separately so callers can hang it on the node body.
 */
function parseTailMeta(
  rawTail: string,
  metaAliasMap: Map<string, string>
): { metadata: Record<string, string>; description?: string[] } {
  let segment = rawTail.trim();
  if (segment.startsWith('|')) segment = segment.substring(1).trim();
  if (!segment) return { metadata: {} };

  const metadata: Record<string, string> = {};
  let description: string[] | undefined;

  for (const item of segment.split(',')) {
    const trimmed = item.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx >= 0) {
      const rawKey = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const value = trimmed.slice(colonIdx + 1).trim();
      if (rawKey === 'description') {
        description = [value];
      } else {
        const resolvedKey = metaAliasMap.get(rawKey) ?? rawKey;
        metadata[resolvedKey] = value;
      }
    }
    // Bare words are ignored (no status system)
  }

  return { metadata, ...(description !== undefined && { description }) };
}

/** Convert group label to internal ID */
function groupId(label: string): string {
  return `__group_${label}`;
}

// Local mutable shapes — element-level metadata/description need to be
// mutated during parse (cascading group metadata, description collection).
// These widen the readonly fields to writable; assignment back into the
// readonly-typed ParsedBoxesAndLines is covariant on Record → Readonly<Record>.
type MutBLNode = Omit<Writable<BLNode>, 'metadata' | 'description'> & {
  metadata: Record<string, string>;
  description?: string[];
};
type MutBLEdge = Omit<Writable<BLEdge>, 'metadata'> & {
  metadata: Record<string, string>;
};
type MutBLGroup = Omit<Writable<BLGroup>, 'metadata' | 'children'> & {
  metadata: Record<string, string>;
  children: string[];
};

export function parseBoxesAndLines(
  content: string,
  palette?: PaletteColors
): ParsedBoxesAndLines {
  const options: Record<string, string> = {};
  const notes: DiagramNote[] = [];
  const initialHiddenTagValues = new Map<string, Set<string>>();
  const nodes: MutBLNode[] = [];
  const edges: MutBLEdge[] = [];
  const groups: MutBLGroup[] = [];
  // Trailing `layout` block (Canvas Editor spike): node-id → absolute {x,y}.
  const nodePositions = new Map<string, { x: number; y: number }>();
  const result: Writable<ParsedBoxesAndLines> = {
    type: 'boxes-and-lines',
    title: null,
    titleLineNumber: null,
    nodes,
    edges,
    groups,
    tagGroups: [],
    options,
    initialHiddenTagValues,
    direction: 'LR',
    diagnostics: [],
    error: null,
  };

  const lines = content.split('\n');
  const nodeLabels = new Set<string>();
  const groupLabels = new Set<string>();
  let lastNodeLabel: string | null = null;
  let lastSourceIsGroup = false;
  let lastNodeIndent = 0;

  // Description collection state
  let descState: {
    nodeLabel: string;
    indent: number;
    lines: string[];
    edgeSeen: boolean;
  } | null = null;

  function flushDescription() {
    if (descState && descState.lines.length > 0) {
      const node = nodes.find((n) => n.label === descState!.nodeLabel);
      if (node) {
        const existing = node.description ?? [];
        node.description = [...existing, ...descState!.lines];
      }
    }
    descState = null;
  }

  // Group stack for nesting
  interface GroupState {
    group: MutBLGroup;
    indent: number;
    depth: number;
  }
  const groupStack: GroupState[] = [];

  // Tag block state
  let contentStarted = false;
  // `layout` coordinate-block state (Canvas Editor spike). Unlike tag blocks,
  // this is a TRAILING appendix — it may appear after diagram content.
  let inLayoutBlock = false;
  const LAYOUT_ENTRY_RE =
    /^(.+?):\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;
  let currentTagGroup: Writable<TagGroup> | null = null;
  // metaAliasMap: tag-group metadata-key aliases (per A1).
  const metaAliasMap = new Map<string, string>();
  // nameAliasMap: TD-18 entity-name aliases (`a` → `<canonical id>`). Per C8.
  const nameAliasMap = new Map<string, string>();
  function peelAlias(label: string): { label: string; alias?: string } {
    const trimmed = label.trim();
    const m = trimmed.match(/^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/);
    if (!m) return { label: trimmed };
    // Regex capture groups present after successful match.
    return { label: m[1]!.trim(), alias: m[2]! };
  }
  const pushWarning = (lineNumber: number, message: string) => {
    result.diagnostics.push(makeDgmoError(lineNumber, message, 'warning'));
  };

  /** Get the innermost active group, if any */
  function currentGroupState(): GroupState | null {
    // In-bounds by length guard.
    return groupStack.length > 0 ? groupStack[groupStack.length - 1]! : null;
  }

  /** Close groups that are at or deeper than a given indent level */
  function closeGroupsToIndent(indent: number) {
    while (
      groupStack.length > 0 &&
      // In-bounds by length guard.
      groupStack[groupStack.length - 1]!.indent >= indent
    ) {
      const gs = groupStack.pop()!;
      result.groups.push(gs.group);
    }
  }

  /** Ensure a node exists (implicit creation) */
  function ensureNode(label: string, lineNum: number) {
    const key = normalizeName(label);
    if (!nodeLabels.has(key)) {
      result.nodes.push({
        label,
        lineNumber: lineNum,
        metadata: {},
      });
      nodeLabels.add(key);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    // In-bounds by loop guard.
    const raw = lines[i]!;
    const trimmed = raw.trim();
    const indent = measureIndent(raw);

    // Skip blanks and comments
    if (!trimmed || trimmed.startsWith('//')) continue;

    // §1.4 legacy `|` detection — emit once per line. In-arrow `|`
    // per §1.10 stays valid; emit only for `|` outside arrow-label
    // regions.
    if (
      trimmed.includes('|') &&
      !/-\S*\|\S*->/.test(trimmed) &&
      !/~\S*\|\S*~>/.test(trimmed)
    ) {
      result.diagnostics.push(
        makeDgmoError(
          lineNum,
          pipeOperatorRemovedMessage(),
          'error',
          METADATA_DIAGNOSTIC_CODES.PIPE_OPERATOR_REMOVED
        )
      );
    }

    // First line: `boxes-and-lines [Title]`
    const firstLineResult = parseFirstLine(trimmed);
    if (firstLineResult && !contentStarted && i < 5) {
      if (firstLineResult.chartType !== 'boxes-and-lines') {
        const diag = makeDgmoError(
          lineNum,
          `Expected chart type "boxes-and-lines", got "${firstLineResult.chartType}"`
        );
        result.diagnostics.push(diag);
        result.error = diag.message;
        return result;
      }
      if (firstLineResult.title) {
        result.title = firstLineResult.title;
        result.titleLineNumber = lineNum;
      }
      continue;
    }

    // Directives (non-indented, before or during content)
    if (indent === 0) {
      // direction TB / direction LR
      const dirMatch = trimmed.match(/^direction\s+(TB|LR)$/i);
      if (dirMatch) {
        // Regex capture group present after successful match.
        result.direction = dirMatch[1]!.toUpperCase() as 'LR' | 'TB';
        continue;
      }

      // hide directive: `hide team:Backend, team:Frontend`
      const hideMatch = trimmed.match(/^hide\s+(.+)/i);
      if (hideMatch && !trimmed.match(/^hide\s*\|/)) {
        // Regex capture group present after successful match.
        const pairs = hideMatch[1]!.split(',');
        for (const pair of pairs) {
          const colonIdx = pair.indexOf(':');
          if (colonIdx > 0) {
            const groupKey = pair.substring(0, colonIdx).trim().toLowerCase();
            const value = pair
              .substring(colonIdx + 1)
              .trim()
              .toLowerCase();
            if (groupKey && value) {
              if (!initialHiddenTagValues.has(groupKey)) {
                initialHiddenTagValues.set(groupKey, new Set());
              }
              initialHiddenTagValues.get(groupKey)!.add(value);
            }
          }
        }
        continue;
      }

      // box-metric / show-values directives — pre-content only (like
      // active-tag). Explicit regex branches: a bare flag and a
      // `key value` form won't both match the active-tag OPTION codepath.
      if (!contentStarted) {
        const metricMatch = trimmed.match(/^box-metric\s+(.+)$/i);
        if (metricMatch) {
          // Regex capture group present after successful match.
          const { label, low, high } = peelRampColors(metricMatch[1]!.trim());
          result.boxMetric = label;
          if (high !== undefined) result.boxMetricColor = high;
          if (low !== undefined) result.boxMetricLowColor = low;
          continue;
        }
        if (/^show-values$/i.test(trimmed)) {
          result.showValues = true;
          continue;
        }
      }

      // active-tag directive
      if (!contentStarted) {
        const optMatch = trimmed.match(OPTION_NOCOLON_RE);
        if (optMatch) {
          // Regex capture groups present after successful match.
          const key = optMatch[1]!.toLowerCase();
          const value = optMatch[2]!.trim();
          if (key === 'active-tag') {
            options[key] = value;
            continue;
          }
        }
        if (tryParseSharedOption(trimmed, options)) {
          continue;
        }
      }
    }

    // Note annotation (top-level): `note <Box> [inline body]` + an optional
    // indented body. Checked before tag/group/node/edge matching so a note is
    // never mistaken for a box; gated to indent 0. `note -> X` is excluded.
    if (indent === 0) {
      const noteResult = tryCollectNote(
        lines,
        i,
        indent,
        palette,
        result.diagnostics
      );
      if (noteResult) {
        if (noteResult.note) notes.push(noteResult.note);
        i = noteResult.lastIndex;
        continue;
      }
    }

    // Tag group heading — must be checked BEFORE group/node/edge matching
    const tagBlockMatch = matchTagBlockHeading(trimmed);
    if (tagBlockMatch && indent === 0) {
      emitTagLegacyDiagnostic(tagBlockMatch, lineNum, result.diagnostics);
      if (contentStarted) {
        result.diagnostics.push(
          makeDgmoError(
            lineNum,
            'Tag groups must appear before diagram content',
            'error'
          )
        );
        continue;
      }
      const newTagGroup: Writable<TagGroup> = {
        name: tagBlockMatch.name,
        ...(tagBlockMatch.alias !== undefined && {
          alias: tagBlockMatch.alias,
        }),
        entries: [],
        lineNumber: lineNum,
      };
      currentTagGroup = newTagGroup;
      if (tagBlockMatch.alias) {
        metaAliasMap.set(
          normalizeName(tagBlockMatch.alias),
          tagBlockMatch.name.toLowerCase()
        );
      }
      metaAliasMap.set(
        normalizeName(tagBlockMatch.name),
        tagBlockMatch.name.toLowerCase()
      );
      if (tagBlockMatch.inlineValues) {
        for (const rawVal of tagBlockMatch.inlineValues) {
          const { text: cleanVal, isDefault } = stripDefaultModifier(rawVal);
          const { label, color } = extractColor(
            cleanVal,
            palette,
            result.diagnostics,
            lineNum
          );
          newTagGroup.entries.push({
            value: label,
            color: color ?? AUTO_TAG_COLOR_SENTINEL,
            lineNumber: lineNum,
          });
          if (isDefault) newTagGroup.defaultValue = label;
        }
        if (!newTagGroup.defaultValue && newTagGroup.entries.length > 0) {
          // In-bounds by length guard.
          newTagGroup.defaultValue = newTagGroup.entries[0]!.value;
        }
      }
      result.tagGroups.push(newTagGroup);
      continue;
    }

    // Tag group entries (indented under tag heading)
    if (currentTagGroup && !contentStarted && indent > 0) {
      const { text: cleanEntry, isDefault } = stripDefaultModifier(trimmed);
      const { label, color } = extractColor(
        cleanEntry,
        palette,
        result.diagnostics,
        lineNum
      );
      currentTagGroup.entries.push({
        value: label,
        color: color ?? AUTO_TAG_COLOR_SENTINEL,
        lineNumber: lineNum,
      });
      if (isDefault) {
        currentTagGroup.defaultValue = label;
      } else if (currentTagGroup.entries.length === 1) {
        currentTagGroup.defaultValue = label;
      }
      continue;
    }

    // Non-indented line closes tag group
    if (currentTagGroup && indent === 0) {
      currentTagGroup = null;
    }

    // `layout` coordinate block (Canvas Editor spike). A bare `layout` heading
    // at indent 0 opens the block; indented `<node-id>: <x>, <y>` entries map a
    // node to an absolute position. Any non-indented line closes it. Quarantined
    // before group/node/edge matching so the entries don't parse as nodes.
    if (!inLayoutBlock && indent === 0 && trimmed === 'layout') {
      // Disambiguate from a node legitimately NAMED `layout`: only treat this as
      // the coordinate appendix when the next non-blank line is an indented
      // `<id>: <x>, <y>` entry. Otherwise fall through and parse `layout` as a
      // normal node (no silent data loss).
      let isBlock = false;
      for (let j = i + 1; j < lines.length; j++) {
        const peek = lines[j]!;
        if (!peek.trim()) continue;
        isBlock = measureIndent(peek) > 0 && LAYOUT_ENTRY_RE.test(peek.trim());
        break;
      }
      if (isBlock) {
        flushDescription();
        closeGroupsToIndent(0);
        inLayoutBlock = true;
        continue;
      }
    }
    if (inLayoutBlock) {
      if (indent > 0) {
        const lm = trimmed.match(LAYOUT_ENTRY_RE);
        if (lm) {
          nodePositions.set(lm[1]!.trim(), {
            x: Number(lm[2]),
            y: Number(lm[3]),
          });
        } else {
          result.diagnostics.push(
            makeDgmoError(
              lineNum,
              `Invalid layout entry "${trimmed}" — expected "<node-id>: <x>, <y>"`,
              'warning'
            )
          );
        }
        continue;
      }
      // indent 0 → block ends; fall through to process this line normally.
      inLayoutBlock = false;
    }

    // Description collection: indented non-edge lines under a node
    if (descState !== null) {
      if (indent > descState.indent) {
        // Check if this is an edge line
        if (trimmed.includes('->') || trimmed.includes('<->')) {
          descState.edgeSeen = true;
          // Fall through to normal edge processing
        } else if (descState.edgeSeen) {
          // Text after edges — emit warning
          result.diagnostics.push(
            makeDgmoError(
              lineNum,
              `Move description lines above edges for '${descState.nodeLabel}' — descriptions must come before -> lines`,
              'warning'
            )
          );
          continue;
        } else if (
          /^-\s*\w/.test(trimmed) &&
          !trimmed.startsWith('- ') &&
          !trimmed.includes('->') &&
          !trimmed.includes('<->')
        ) {
          // Looks like a malformed edge (e.g. "-Target" but not "- list item")
          result.diagnostics.push(
            makeDgmoError(
              lineNum,
              `Looks like an incomplete edge — did you mean "-> ${trimmed.slice(1).trim()}"?`,
              'warning'
            )
          );
          descState.lines.push(trimmed);
          continue;
        } else {
          // Collect as description
          descState.lines.push(trimmed);
          continue;
        }
      } else {
        // Indent decreased — flush description
        flushDescription();
      }
    }

    // Close groups that are no longer scoped by indent
    if (indent === 0) {
      closeGroupsToIndent(0);
    } else if (groupStack.length > 0) {
      // Close groups deeper than current indent
      closeGroupsToIndent(indent);
    }

    // Group-to-group edge: [Group A] -> [Group B] or [Group A] <-> [Group B]
    const groupEdgeMatch = trimmed.match(
      /^\[(.+?)\]\s*(<->|->)\s*\[(.+?)\](.*)$/
    );
    if (groupEdgeMatch) {
      contentStarted = true;
      currentTagGroup = null;
      const sourceLabel = groupEdgeMatch[1];
      const arrow = groupEdgeMatch[2];
      const targetLabel = groupEdgeMatch[3];
      const rawTail = groupEdgeMatch[4] ?? '';

      const edgeMeta = parseTailMeta(rawTail, metaAliasMap).metadata;

      result.edges.push({
        // Regex capture groups present after successful match.
        source: groupId(sourceLabel!),
        target: groupId(targetLabel!),
        bidirectional: arrow === '<->',
        lineNumber: lineNum,
        metadata: edgeMeta,
      });
      continue;
    }

    // Labeled group-to-group edge: [Group A] -label-> [Group B]
    const labeledGroupEdgeMatch = trimmed.match(
      /^\[(.+?)\]\s*(?:<-(.+)->|-(.+)->)\s*\[(.+?)\](.*)$/
    );
    if (labeledGroupEdgeMatch) {
      contentStarted = true;
      currentTagGroup = null;
      const sourceLabel = labeledGroupEdgeMatch[1];
      const biLabel = labeledGroupEdgeMatch[2];
      const uniLabel = labeledGroupEdgeMatch[3];
      const targetLabel = labeledGroupEdgeMatch[4];
      const rawTail = labeledGroupEdgeMatch[5] ?? '';

      const edgeMeta = parseTailMeta(rawTail, metaAliasMap).metadata;

      const labeledEdgeLabel = (biLabel ?? uniLabel)?.trim();
      result.edges.push({
        // Regex capture groups present after successful match.
        source: groupId(sourceLabel!),
        target: groupId(targetLabel!),
        ...(labeledEdgeLabel !== undefined && { label: labeledEdgeLabel }),
        bidirectional: !!biLabel,
        lineNumber: lineNum,
        metadata: edgeMeta,
      });
      continue;
    }

    // Group header: [Group Name] or [Group Name] | metadata
    const groupMatch = trimmed.match(/^\[(.+?)\](.*)$/);
    if (groupMatch && !trimmed.includes('->') && !trimmed.includes('<->')) {
      contentStarted = true;
      currentTagGroup = null;
      flushDescription();
      // TD-18: peel optional `as <alias>` from the group label.
      // Regex capture group present after successful match.
      const groupPeeled = peelAlias(groupMatch[1]!);
      const label = groupPeeled.label;
      if (groupPeeled.alias)
        nameAliasMap.set(groupPeeled.alias, groupId(label));

      // Check nesting depth
      const currentDepth = groupStack.length + 1;
      if (currentDepth > MAX_GROUP_DEPTH) {
        result.diagnostics.push(
          makeDgmoError(
            lineNum,
            `Group nesting exceeds maximum depth of ${MAX_GROUP_DEPTH}`,
            'warning'
          )
        );
        continue;
      }

      const groupMeta = parseTailMeta(
        groupMatch[2] ?? '',
        metaAliasMap
      ).metadata;

      const parentGs = currentGroupState();
      const group: MutBLGroup = {
        label,
        children: [],
        lineNumber: lineNum,
        metadata: groupMeta,
        ...(parentGs ? { parentGroup: parentGs.group.label } : {}),
      };

      // Add nested group as child of parent group
      if (parentGs && indent > parentGs.indent) {
        parentGs.group.children.push(label);
      }

      groupLabels.add(normalizeName(label));
      groupStack.push({ group, indent, depth: currentDepth });
      lastNodeLabel = label;
      lastSourceIsGroup = true;
      continue;
    }

    // Edge detection: contains `->` or `<->`
    if (trimmed.includes('->') || trimmed.includes('<->')) {
      contentStarted = true;
      currentTagGroup = null;
      let edgeText = trimmed;

      // Indented shorthand: `-> Target` or `-label-> Target`
      if (trimmed.startsWith('->') || /^-[^>].*->/.test(trimmed)) {
        // If the edge is at group-child indent level, use the containing group
        // UNLESS lastNodeLabel is a plain node (not a group) — then the edge
        // is indented under that node and should source from it.
        const gs = currentGroupState();
        const inGroup = gs && indent > gs.indent;
        // Edge is deeper than the last node → indented under that node, use it
        const indentedUnderNode =
          lastNodeLabel && !lastSourceIsGroup && indent > lastNodeIndent;
        if (inGroup && !indentedUnderNode) {
          const sourcePrefix = `[${gs.group.label}]`;
          edgeText = `${sourcePrefix} ${trimmed}`;
        } else if (lastNodeLabel) {
          const sourcePrefix = lastSourceIsGroup
            ? `[${lastNodeLabel}]`
            : lastNodeLabel;
          edgeText = `${sourcePrefix} ${trimmed}`;
        } else {
          result.diagnostics.push(
            makeDgmoError(
              lineNum,
              'Indented edge has no preceding node to use as source',
              'warning'
            )
          );
          continue;
        }
      }

      const edge = parseEdgeLine(
        edgeText,
        lineNum,
        metaAliasMap,
        result.diagnostics,
        nameAliasMap
      );
      if (edge) {
        result.edges.push(edge);
        // Add to current group if indented
        // (edges don't become group children, but their nodes might)
      }
      continue;
    }

    // Node: everything else
    contentStarted = true;
    currentTagGroup = null;
    flushDescription(); // Flush any pending description from previous node
    const node = parseNodeLine(
      trimmed,
      lineNum,
      metaAliasMap,
      result.diagnostics,
      nameAliasMap
    );
    if (!node) {
      result.diagnostics.push(
        makeDgmoError(lineNum, `Unexpected line: '${trimmed}'.`, 'warning')
      );
      continue;
    }
    lastNodeLabel = node.label;
    lastSourceIsGroup = false;
    lastNodeIndent = indent;

    const gs = currentGroupState();
    const isGroupChild = gs && indent > gs.indent;

    const key = normalizeName(node.label);
    if (nodeLabels.has(key)) {
      // Already declared — if inside a group, just add as child (no duplicate)
      if (isGroupChild) {
        gs.group.children.push(node.label);
        continue;
      }
      result.diagnostics.push(
        makeDgmoError(lineNum, `Duplicate node "${node.label}"`, 'warning')
      );
    } else {
      nodeLabels.add(key);
    }

    // Cascade group metadata into node (group provides defaults, node overrides)
    if (isGroupChild) {
      for (const [key, val] of Object.entries(gs.group.metadata)) {
        if (!(key in node.metadata)) {
          node.metadata[key] = val;
        }
      }
      gs.group.children.push(node.label);
    }

    result.nodes.push(node);
    descState = { nodeLabel: node.label, indent, lines: [], edgeSeen: false };
  }

  // Flush any remaining description
  flushDescription();

  // Close any remaining groups
  while (groupStack.length > 0) {
    const gs = groupStack.pop()!;
    result.groups.push(gs.group);
  }

  // Validate group references and implicitly create node endpoints
  const validEdges: BLEdge[] = [];
  for (const edge of result.edges) {
    let valid = true;

    // Check group references exist
    const allGroups = Array.from(groupLabels);
    if (edge.source.startsWith('__group_')) {
      const label = edge.source.slice('__group_'.length);
      const found = groupLabels.has(normalizeName(label));
      if (!found) {
        let msg = `Group '[${label}]' not found`;
        const hint = suggest(normalizeName(label), allGroups);
        if (hint) msg += `. ${hint}`;
        result.diagnostics.push(makeDgmoError(edge.lineNumber, msg));
        valid = false;
      }
    } else {
      ensureNode(edge.source, edge.lineNumber);
    }

    if (edge.target.startsWith('__group_')) {
      const label = edge.target.slice('__group_'.length);
      const found = groupLabels.has(normalizeName(label));
      if (!found) {
        let msg = `Group '[${label}]' not found`;
        const hint = suggest(normalizeName(label), allGroups);
        if (hint) msg += `. ${hint}`;
        result.diagnostics.push(makeDgmoError(edge.lineNumber, msg));
        valid = false;
      }
    } else {
      ensureNode(edge.target, edge.lineNumber);
    }

    if (valid) {
      validEdges.push(edge);
    }
  }
  result.edges = validEdges;

  // Resolve note refs against box labels (forward refs OK). The id→note
  // binding is recomputed in layout; this pass surfaces diagnostics.
  if (notes.length > 0) {
    result.notes = notes;
    resolveNotes(
      notes,
      result.nodes.map((n) => ({ id: n.label, label: n.label })),
      result.diagnostics
    );
  }

  // Assign palette colors to bare (colorless) tag values. Boxes-and-lines
  // resolves explicit tag colors against the Nord defaults (no palette is
  // passed to extractColor above), so auto colors match for consistency.
  finalizeAutoTagColors(result.tagGroups as Writable<TagGroup>[]);

  // Attach parsed `layout` positions. Validate coverage: unknown ids warn; a
  // PARTIAL block (some nodes unpositioned) is honored by neither pin nor seed —
  // the layout engine ignores it and auto-lays-out (Decision 3, AC12), so emit a
  // single diagnostic naming the gap.
  if (nodePositions.size > 0) {
    const nodeLabelSet = new Set(result.nodes.map((n) => n.label));
    for (const id of nodePositions.keys()) {
      if (!nodeLabelSet.has(id)) {
        pushWarning(0, `layout entry for unknown node "${id}" (ignored)`);
      }
    }
    const unpositioned = result.nodes
      .filter((n) => !nodePositions.has(n.label))
      .map((n) => n.label);
    if (unpositioned.length > 0) {
      pushWarning(
        0,
        `layout block is partial — ${unpositioned.length} node(s) without coordinates ` +
          `(${unpositioned.slice(0, 5).join(', ')}${unpositioned.length > 5 ? '…' : ''}); ` +
          `ignoring the block and auto-laying-out`
      );
    }
    result.nodePositions = nodePositions;
  }

  // Post-parse: inject default tag metadata and validate tag values
  if (result.tagGroups.length > 0) {
    injectDefaultTagMetadata(result.nodes, result.tagGroups);
    validateTagValues(result.nodes, result.tagGroups, pushWarning, suggest);
    validateTagGroupNames(result.tagGroups, pushWarning, (line, msg) => {
      const diag = makeDgmoError(line, msg);
      result.diagnostics.push(diag);
      if (!result.error) result.error = diag.message;
    });
  }

  return result;
}

// ============================================================
// Line parsers
// ============================================================

/**
 * Parse a node line. Supports both the new §1.4 same-line form
 * (`Label key: value, key2: value2`) and the legacy pipe form
 * (`Label | key: value, ...`); the top-of-loop pipe diagnostic
 * already fires for the latter.
 */
function parseNodeLine(
  trimmed: string,
  lineNum: number,
  metaAliasMap: Map<string, string>,
  diagnostics: DgmoError[],
  nameAliasMap?: Map<string, string>
): MutBLNode | null {
  // Strip any unsafe `|` so the name region stays clean — the
  // legacy diagnostic is emitted by the per-line top-of-loop check.
  // Anything left of a `|` is part of the label; anything to the
  // right is comma-separated metadata.
  let working = trimmed;
  const pipeIdx = working.indexOf('|');
  let legacyMetaTail = '';
  if (pipeIdx >= 0) {
    legacyMetaTail = working.substring(pipeIdx + 1).trim();
    working = working.substring(0, pipeIdx).trim();
  }

  const registry = withTagAliases(
    BOXES_AND_LINES_REGISTRY,
    new Set(metaAliasMap.keys())
  );
  const split = splitNameAndMeta(
    working,
    registry,
    metaAliasMap,
    undefined,
    diagnostics,
    lineNum
  );
  warnUnknownMetaKeys(
    split.meta,
    registry,
    (msg) => diagnostics.push(makeDgmoError(lineNum, msg, 'warning')),
    split.name
  );

  let label = split.name;
  const metadata: Record<string, string> = { ...split.meta };
  let description: string[] | undefined;
  // §1.5 trailing-token color sits in the label slot for nodes
  // that don't store color separately — re-attach so the literal
  // label text matches author intent.
  if (split.color !== undefined) {
    label = `${label} ${split.color}`;
  }

  // Fold any legacy `| k: v` tail (back-compat).
  if (legacyMetaTail) {
    const tailParsed = parseTailMeta(legacyMetaTail, metaAliasMap);
    Object.assign(metadata, tailParsed.metadata);
    if (tailParsed.description) description = tailParsed.description;
  }
  // Promote a `description` key out of metadata for the new path.
  if (metadata['description'] !== undefined) {
    description = [metadata['description']];
    delete metadata['description'];
  }

  // Lift `value: X` out of metadata into a typed numeric field (mirror of the
  // map parser). Validate finite-numeric; delete from metadata so it never
  // becomes a `data-tag-value` attribute.
  let value: number | undefined;
  if (metadata['value'] !== undefined) {
    const raw = metadata['value'];
    const num = Number(raw);
    if (Number.isFinite(num)) {
      value = num;
    } else {
      diagnostics.push(
        makeDgmoError(lineNum, `value must be a number (got "${raw}")`, 'error')
      );
    }
    delete metadata['value'];
  }

  // TD-18 alias is now peeled by splitNameAndMeta — re-register if set.
  if (split.alias) {
    nameAliasMap?.set(normalizeName(split.alias), label);
  }

  if (!label) return null;

  return {
    label,
    lineNumber: lineNum,
    metadata,
    ...(description !== undefined && { description }),
    ...(value !== undefined && { value }),
  };
}

/**
 * Split the right-hand side of an edge (`Target | meta` legacy, or
 * `Target k: v` new) into a clean target name + parsed metadata.
 * For new syntax, the metadata cut is at the first reserved key
 * (via splitNameAndMeta + BOXES_AND_LINES_REGISTRY). For legacy,
 * the literal `|` still wins.
 *
 * `[Group]` bracket targets are preserved verbatim — the bracket
 * literal is the target name, not a structural sigil to peel.
 */
function splitTargetAndMeta(
  rest: string,
  metaAliasMap: Map<string, string>
): { target: string; metadata: Record<string, string> } {
  const pipeIdx = rest.indexOf('|');
  if (pipeIdx >= 0) {
    const tail = rest.slice(pipeIdx + 1).trim();
    const target = rest.slice(0, pipeIdx).trim();
    return {
      target,
      metadata: parseTailMeta(tail, metaAliasMap).metadata,
    };
  }
  // §1.4 same-line: cut at the first reserved-key colon. If the
  // target is wrapped in `[brackets]` (group endpoint), keep the
  // bracketed form intact.
  const registry = withTagAliases(
    BOXES_AND_LINES_REGISTRY,
    new Set(metaAliasMap.keys())
  );
  const split = splitNameAndMeta(rest, registry, metaAliasMap);
  let target = split.name;
  if (split.color !== undefined) {
    // Colors as trailing tokens stay on the target literal for
    // identifier-style endpoints; reattach.
    target = `${target} ${split.color}`;
  }
  return { target, metadata: split.meta };
}

/**
 * Convert `[Group Name]` to `__group_Group Name`, resolve TD-18 alias
 * literals to their canonical name, otherwise return as-is.
 */
function resolveEndpoint(
  name: string,
  nameAliasMap?: Map<string, string>
): string {
  const m = name.match(/^\[(.+)\]$/);
  // Regex capture group present after successful match.
  if (m) return groupId(m[1]!.trim());
  if (nameAliasMap) {
    const aliased = nameAliasMap.get(name.trim());
    if (aliased !== undefined) return aliased;
  }
  return name;
}

/**
 * Parse an edge line. Supports:
 * - `Source -> Target`
 * - `Source -> Target | key: value`
 * - `Source -label-> Target`
 * - `Source <-> Target`
 * - `Source <-label-> Target`
 * - `Source -label-> Target | key: value`
 *
 * `[Group Name]` in source or target position is resolved to `__group_Group Name`.
 */
function parseEdgeLine(
  trimmed: string,
  lineNum: number,
  metaAliasMap: Map<string, string>,
  diagnostics: DgmoError[],
  nameAliasMap?: Map<string, string>
): BLEdge | null {
  const edgeRegistry = withTagAliases(
    BOXES_AND_LINES_REGISTRY,
    new Set(metaAliasMap.keys())
  );
  // Check for bidirectional labeled: `Source <-label-> Target`
  const biLabeledMatch = trimmed.match(/^(.+?)\s*<-(.+)->\s*(.+)$/);
  if (biLabeledMatch) {
    // Regex capture groups present after successful match.
    const rawSource = biLabeledMatch[1]!.trim();
    const source = resolveEndpoint(rawSource, nameAliasMap);
    const labelResult = parseInArrowLabel(biLabeledMatch[2]!, lineNum);
    diagnostics.push(...labelResult.diagnostics);
    const label = labelResult.label;
    let rest = biLabeledMatch[3]!.trim();

    const { target: biTarget, metadata } = splitTargetAndMeta(
      rest,
      metaAliasMap
    );
    warnUnknownMetaKeys(metadata, edgeRegistry, (msg) =>
      diagnostics.push(makeDgmoError(lineNum, msg, 'warning'))
    );
    rest = biTarget;

    if (!source || !rest) {
      diagnostics.push(
        makeDgmoError(lineNum, 'Edge is missing source or target')
      );
      return null;
    }

    if (rawSource.endsWith(':') || rest.endsWith(':')) {
      diagnostics.push(
        makeDgmoError(
          lineNum,
          `Trailing colon is not valid — write '${rawSource.replace(/:$/, '')} <-> ${rest.replace(/:$/, '')}' instead`
        )
      );
      return null;
    }

    return {
      source,
      target: resolveEndpoint(rest, nameAliasMap),
      ...(label !== undefined && { label }),
      bidirectional: true,
      lineNumber: lineNum,
      metadata,
    };
  }

  // Check for bidirectional plain: `Source <-> Target`
  const biIdx = trimmed.indexOf('<->');
  if (biIdx >= 0) {
    const rawSource = trimmed.slice(0, biIdx).trim();
    const source = resolveEndpoint(rawSource, nameAliasMap);
    let rest = trimmed.slice(biIdx + 3).trim();

    const { target: plainTarget, metadata } = splitTargetAndMeta(
      rest,
      metaAliasMap
    );
    warnUnknownMetaKeys(metadata, edgeRegistry, (msg) =>
      diagnostics.push(makeDgmoError(lineNum, msg, 'warning'))
    );
    rest = plainTarget;

    if (!source || !rest) {
      diagnostics.push(
        makeDgmoError(lineNum, 'Edge is missing source or target')
      );
      return null;
    }

    if (rawSource.endsWith(':') || rest.endsWith(':')) {
      diagnostics.push(
        makeDgmoError(
          lineNum,
          `Trailing colon is not valid — write '${rawSource.replace(/:$/, '')} <-> ${rest.replace(/:$/, '')}' instead`
        )
      );
      return null;
    }

    return {
      source,
      target: resolveEndpoint(rest, nameAliasMap),
      bidirectional: true,
      lineNumber: lineNum,
      metadata,
    };
  }

  // Check for labeled arrow: `Source -label-> Target` (label lazy → split
  // at the first arrow, consistent with the other parsers).
  const labeledMatch = trimmed.match(/^(.+?)\s+-(.+?)->\s*(.+)$/);
  if (labeledMatch) {
    // Regex capture groups present after successful match.
    const rawSource = labeledMatch[1]!.trim();
    const source = resolveEndpoint(rawSource, nameAliasMap);
    const labelResult = parseInArrowLabel(labeledMatch[2]!, lineNum);
    diagnostics.push(...labelResult.diagnostics);
    const label = labelResult.label;
    let rest = labeledMatch[3]!.trim();

    if (label) {
      const { target: labeledTarget, metadata } = splitTargetAndMeta(
        rest,
        metaAliasMap
      );
      warnUnknownMetaKeys(metadata, edgeRegistry, (msg) =>
        diagnostics.push(makeDgmoError(lineNum, msg, 'warning'))
      );
      rest = labeledTarget;

      if (!source || !rest) {
        diagnostics.push(
          makeDgmoError(lineNum, 'Edge is missing source or target')
        );
        return null;
      }

      if (rawSource.endsWith(':') || rest.endsWith(':')) {
        diagnostics.push(
          makeDgmoError(
            lineNum,
            `Trailing colon is not valid — write '${rawSource.replace(/:$/, '')} -> ${rest.replace(/:$/, '')}' instead`
          )
        );
        return null;
      }

      return {
        source,
        target: resolveEndpoint(rest, nameAliasMap),
        label,
        bidirectional: false,
        lineNumber: lineNum,
        metadata,
      };
    }
  }

  // Plain arrow: `Source -> Target`
  const arrowIdx = trimmed.indexOf('->');
  if (arrowIdx < 0) return null;

  const rawSource = trimmed.slice(0, arrowIdx).trim();
  const source = resolveEndpoint(rawSource, nameAliasMap);
  let rest = trimmed.slice(arrowIdx + 2).trim();

  if (!source || !rest) {
    diagnostics.push(
      makeDgmoError(lineNum, 'Edge is missing source or target')
    );
    return null;
  }

  const { target: plainTarget, metadata } = splitTargetAndMeta(
    rest,
    metaAliasMap
  );
  warnUnknownMetaKeys(metadata, edgeRegistry, (msg) =>
    diagnostics.push(makeDgmoError(lineNum, msg, 'warning'))
  );
  rest = plainTarget;

  if (!rest) {
    diagnostics.push(makeDgmoError(lineNum, 'Edge is missing target'));
    return null;
  }

  if (rawSource.endsWith(':') || rest.endsWith(':')) {
    diagnostics.push(
      makeDgmoError(
        lineNum,
        `Trailing colon is not valid — write '${rawSource.replace(/:$/, '')} -> ${rest.replace(/:$/, '')}' instead`
      )
    );
    return null;
  }

  return {
    source,
    target: resolveEndpoint(rest, nameAliasMap),
    bidirectional: false,
    lineNumber: lineNum,
    metadata,
  };
}

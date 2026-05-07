// ============================================================
// Boxes and Lines Diagram — Parser
// ============================================================

import { makeDgmoError, suggest } from '../diagnostics';
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
} from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import {
  extractColor,
  parseFirstLine,
  OPTION_NOCOLON_RE,
  tryParseSharedOption,
} from '../utils/parsing';

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
 * Parse pipe metadata segment: `key: value, key2: value2`
 * Returns resolved metadata record. Extracts `description` separately.
 */
function parsePipeMetadata(
  segment: string,
  metaAliasMap: Map<string, string>
): { metadata: Record<string, string>; description?: string[] } {
  const metadata: Record<string, string> = {};
  let description: string[] | undefined;

  const items = segment.split(',');
  for (const item of items) {
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

  return { metadata, description };
}

/** Convert group label to internal ID */
function groupId(label: string): string {
  return `__group_${label}`;
}

export function parseBoxesAndLines(content: string): ParsedBoxesAndLines {
  const result: ParsedBoxesAndLines = {
    type: 'boxes-and-lines',
    title: null,
    titleLineNumber: null,
    nodes: [],
    edges: [],
    groups: [],
    tagGroups: [],
    options: {},
    initialHiddenTagValues: new Map(),
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
      const node = result.nodes.find((n) => n.label === descState!.nodeLabel);
      if (node) {
        const existing = node.description ?? [];
        node.description = [...existing, ...descState!.lines];
      }
    }
    descState = null;
  }

  // Group stack for nesting
  interface GroupState {
    group: BLGroup;
    indent: number;
    depth: number;
  }
  const groupStack: GroupState[] = [];

  // Tag block state
  let contentStarted = false;
  let currentTagGroup: TagGroup | null = null;
  // metaAliasMap: tag-group metadata-key aliases (per A1).
  const metaAliasMap = new Map<string, string>();
  // nameAliasMap: TD-18 entity-name aliases (`a` → `<canonical id>`). Per C8.
  const nameAliasMap = new Map<string, string>();
  function peelAlias(label: string): { label: string; alias?: string } {
    const trimmed = label.trim();
    const m = trimmed.match(/^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/);
    if (!m) return { label: trimmed };
    return { label: m[1].trim(), alias: m[2] };
  }
  const pushWarning = (lineNumber: number, message: string) => {
    result.diagnostics.push(makeDgmoError(lineNumber, message, 'warning'));
  };

  /** Get the innermost active group, if any */
  function currentGroupState(): GroupState | null {
    return groupStack.length > 0 ? groupStack[groupStack.length - 1] : null;
  }

  /** Close groups that are at or deeper than a given indent level */
  function closeGroupsToIndent(indent: number) {
    while (
      groupStack.length > 0 &&
      groupStack[groupStack.length - 1].indent >= indent
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
    const raw = lines[i];
    const trimmed = raw.trim();
    const indent = measureIndent(raw);

    // Skip blanks and comments
    if (!trimmed || trimmed.startsWith('//')) continue;

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
        result.direction = dirMatch[1].toUpperCase() as 'LR' | 'TB';
        continue;
      }

      // hide directive: `hide team:Backend, team:Frontend`
      const hideMatch = trimmed.match(/^hide\s+(.+)/i);
      if (hideMatch && !trimmed.match(/^hide\s*\|/)) {
        const pairs = hideMatch[1].split(',');
        for (const pair of pairs) {
          const colonIdx = pair.indexOf(':');
          if (colonIdx > 0) {
            const groupKey = pair.substring(0, colonIdx).trim().toLowerCase();
            const value = pair
              .substring(colonIdx + 1)
              .trim()
              .toLowerCase();
            if (groupKey && value) {
              if (!result.initialHiddenTagValues.has(groupKey)) {
                result.initialHiddenTagValues.set(groupKey, new Set());
              }
              result.initialHiddenTagValues.get(groupKey)!.add(value);
            }
          }
        }
        continue;
      }

      // active-tag directive
      if (!contentStarted) {
        const optMatch = trimmed.match(OPTION_NOCOLON_RE);
        if (optMatch) {
          const key = optMatch[1].toLowerCase();
          const value = optMatch[2].trim();
          if (key === 'active-tag') {
            result.options[key] = value;
            continue;
          }
        }
        if (tryParseSharedOption(trimmed, result.options)) {
          continue;
        }
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
      currentTagGroup = {
        name: tagBlockMatch.name,
        alias: tagBlockMatch.alias,
        entries: [],
        lineNumber: lineNum,
      };
      if (tagBlockMatch.alias) {
        metaAliasMap.set(
          normalizeName(tagBlockMatch.alias),
          tagBlockMatch.name.toLowerCase()
        );
      }
      if (tagBlockMatch.inlineValues) {
        for (const rawVal of tagBlockMatch.inlineValues) {
          const { text: cleanVal, isDefault } = stripDefaultModifier(rawVal);
          const { label, color } = extractColor(cleanVal);
          currentTagGroup.entries.push({
            value: label,
            color: color ?? '',
            lineNumber: lineNum,
          });
          if (isDefault) currentTagGroup.defaultValue = label;
        }
        if (
          !currentTagGroup.defaultValue &&
          currentTagGroup.entries.length > 0
        ) {
          currentTagGroup.defaultValue = currentTagGroup.entries[0].value;
        }
      }
      result.tagGroups.push(currentTagGroup);
      continue;
    }

    // Tag group entries (indented under tag heading)
    if (currentTagGroup && !contentStarted && indent > 0) {
      const { text: cleanEntry, isDefault } = stripDefaultModifier(trimmed);
      const { label, color } = extractColor(cleanEntry);
      currentTagGroup.entries.push({
        value: label,
        color: color ?? '',
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
      /^\[(.+?)\]\s*(<->|->)\s*\[(.+?)\]\s*(?:\|\s*(.+))?$/
    );
    if (groupEdgeMatch) {
      contentStarted = true;
      currentTagGroup = null;
      const sourceLabel = groupEdgeMatch[1];
      const arrow = groupEdgeMatch[2];
      const targetLabel = groupEdgeMatch[3];
      const metaSeg = groupEdgeMatch[4];

      let edgeMeta: Record<string, string> = {};
      if (metaSeg) {
        const parsed = parsePipeMetadata(metaSeg, metaAliasMap);
        edgeMeta = parsed.metadata;
      }

      result.edges.push({
        source: groupId(sourceLabel),
        target: groupId(targetLabel),
        label: undefined,
        bidirectional: arrow === '<->',
        lineNumber: lineNum,
        metadata: edgeMeta,
      });
      continue;
    }

    // Labeled group-to-group edge: [Group A] -label-> [Group B]
    const labeledGroupEdgeMatch = trimmed.match(
      /^\[(.+?)\]\s*(?:<-(.+)->|-(.+)->)\s*\[(.+?)\]\s*(?:\|\s*(.+))?$/
    );
    if (labeledGroupEdgeMatch) {
      contentStarted = true;
      currentTagGroup = null;
      const sourceLabel = labeledGroupEdgeMatch[1];
      const biLabel = labeledGroupEdgeMatch[2];
      const uniLabel = labeledGroupEdgeMatch[3];
      const targetLabel = labeledGroupEdgeMatch[4];
      const metaSeg = labeledGroupEdgeMatch[5];

      let edgeMeta: Record<string, string> = {};
      if (metaSeg) {
        const parsed = parsePipeMetadata(metaSeg, metaAliasMap);
        edgeMeta = parsed.metadata;
      }

      result.edges.push({
        source: groupId(sourceLabel),
        target: groupId(targetLabel),
        label: (biLabel ?? uniLabel)?.trim(),
        bidirectional: !!biLabel,
        lineNumber: lineNum,
        metadata: edgeMeta,
      });
      continue;
    }

    // Group header: [Group Name] or [Group Name] | metadata
    const groupMatch = trimmed.match(/^\[(.+?)\]\s*(?:\|\s*(.+))?$/);
    if (groupMatch && !trimmed.includes('->') && !trimmed.includes('<->')) {
      contentStarted = true;
      currentTagGroup = null;
      flushDescription();
      // TD-18: peel optional `as <alias>` from the group label.
      const groupPeeled = peelAlias(groupMatch[1]);
      const label = groupPeeled.label;
      if (groupPeeled.alias)
        nameAliasMap.set(normalizeName(groupPeeled.alias), groupId(label));

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

      const groupMeta: Record<string, string> = {};
      if (groupMatch[2]) {
        const items = groupMatch[2].split(',');
        for (const item of items) {
          const ci = item.indexOf(':');
          if (ci >= 0) {
            const rawKey = item.slice(0, ci).trim().toLowerCase();
            const value = item.slice(ci + 1).trim();
            const resolvedKey = metaAliasMap.get(rawKey) ?? rawKey;
            groupMeta[resolvedKey] = value;
          }
        }
      }

      const parentGs = currentGroupState();
      const group: BLGroup = {
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
    if (edge.source.startsWith('__group_')) {
      const label = edge.source.slice('__group_'.length);
      const found = groupLabels.has(normalizeName(label));
      if (!found) {
        result.diagnostics.push(
          makeDgmoError(edge.lineNumber, `Group '[${label}]' not found`)
        );
        valid = false;
      }
    } else {
      ensureNode(edge.source, edge.lineNumber);
    }

    if (edge.target.startsWith('__group_')) {
      const label = edge.target.slice('__group_'.length);
      const found = groupLabels.has(normalizeName(label));
      if (!found) {
        result.diagnostics.push(
          makeDgmoError(edge.lineNumber, `Group '[${label}]' not found`)
        );
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
 * Parse a node line. Supports:
 * - `Label`
 * - `Label | key: value, key2: value2`
 */
function parseNodeLine(
  trimmed: string,
  lineNum: number,
  metaAliasMap: Map<string, string>,
  _diagnostics: DgmoError[],
  nameAliasMap?: Map<string, string>
): BLNode | null {
  let metadata: Record<string, string> = {};
  let description: string[] | undefined;

  // Split on pipe for metadata
  const pipeIdx = trimmed.indexOf('|');
  let label: string;

  if (pipeIdx >= 0) {
    label = trimmed.slice(0, pipeIdx).trim();
    const metaSegment = trimmed.slice(pipeIdx + 1).trim();
    const parsed = parsePipeMetadata(metaSegment, metaAliasMap);
    metadata = parsed.metadata;
    description = parsed.description;
  } else {
    label = trimmed;
  }

  // TD-18: peel optional `as <alias>` from label.
  const asMatch = label.match(/^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/);
  if (asMatch) {
    label = asMatch[1].trim();
    nameAliasMap?.set(normalizeName(asMatch[2]), label);
  }

  if (!label) return null;

  return {
    label,
    lineNumber: lineNum,
    metadata,
    description,
  };
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
  if (m) return groupId(m[1].trim());
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
  // Check for bidirectional labeled: `Source <-label-> Target`
  const biLabeledMatch = trimmed.match(/^(.+?)\s*<-(.+)->\s*(.+)$/);
  if (biLabeledMatch) {
    const source = resolveEndpoint(biLabeledMatch[1].trim(), nameAliasMap);
    const labelResult = parseInArrowLabel(biLabeledMatch[2], lineNum);
    diagnostics.push(...labelResult.diagnostics);
    const label = labelResult.label;
    let rest = biLabeledMatch[3].trim();

    let metadata: Record<string, string> = {};
    const pipeIdx = rest.indexOf('|');
    if (pipeIdx >= 0) {
      const parsed = parsePipeMetadata(
        rest.slice(pipeIdx + 1).trim(),
        metaAliasMap
      );
      metadata = parsed.metadata;
      rest = rest.slice(0, pipeIdx).trim();
    }

    if (!source || !rest) {
      diagnostics.push(
        makeDgmoError(lineNum, 'Edge is missing source or target')
      );
      return null;
    }

    return {
      source,
      target: resolveEndpoint(rest, nameAliasMap),
      label,
      bidirectional: true,
      lineNumber: lineNum,
      metadata,
    };
  }

  // Check for bidirectional plain: `Source <-> Target`
  const biIdx = trimmed.indexOf('<->');
  if (biIdx >= 0) {
    const source = resolveEndpoint(
      trimmed.slice(0, biIdx).trim(),
      nameAliasMap
    );
    let rest = trimmed.slice(biIdx + 3).trim();

    let metadata: Record<string, string> = {};
    const pipeIdx = rest.indexOf('|');
    if (pipeIdx >= 0) {
      const parsed = parsePipeMetadata(
        rest.slice(pipeIdx + 1).trim(),
        metaAliasMap
      );
      metadata = parsed.metadata;
      rest = rest.slice(0, pipeIdx).trim();
    }

    if (!source || !rest) {
      diagnostics.push(
        makeDgmoError(lineNum, 'Edge is missing source or target')
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

  // Check for labeled arrow: `Source -label-> Target`
  const labeledMatch = trimmed.match(/^(.+?)\s+-(.+)->\s*(.+)$/);
  if (labeledMatch) {
    const source = resolveEndpoint(labeledMatch[1].trim(), nameAliasMap);
    const labelResult = parseInArrowLabel(labeledMatch[2], lineNum);
    diagnostics.push(...labelResult.diagnostics);
    const label = labelResult.label;
    let rest = labeledMatch[3].trim();

    if (label) {
      let metadata: Record<string, string> = {};
      const pipeIdx = rest.indexOf('|');
      if (pipeIdx >= 0) {
        const parsed = parsePipeMetadata(
          rest.slice(pipeIdx + 1).trim(),
          metaAliasMap
        );
        metadata = parsed.metadata;
        rest = rest.slice(0, pipeIdx).trim();
      }

      if (!source || !rest) {
        diagnostics.push(
          makeDgmoError(lineNum, 'Edge is missing source or target')
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

  const source = resolveEndpoint(
    trimmed.slice(0, arrowIdx).trim(),
    nameAliasMap
  );
  let rest = trimmed.slice(arrowIdx + 2).trim();

  if (!source || !rest) {
    diagnostics.push(
      makeDgmoError(lineNum, 'Edge is missing source or target')
    );
    return null;
  }

  let metadata: Record<string, string> = {};
  const pipeIdx = rest.indexOf('|');
  if (pipeIdx >= 0) {
    const parsed = parsePipeMetadata(
      rest.slice(pipeIdx + 1).trim(),
      metaAliasMap
    );
    metadata = parsed.metadata;
    rest = rest.slice(0, pipeIdx).trim();
  }

  if (!rest) {
    diagnostics.push(makeDgmoError(lineNum, 'Edge is missing target'));
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

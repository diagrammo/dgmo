// ============================================================
// Boxes and Lines Diagram — Parser
// ============================================================

import { makeDgmoError, suggest } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import type {
  ParsedBoxesAndLines,
  BLNode,
  BLEdge,
  BLGroup,
  BLRenderMode,
} from './types';
import { inferParticipantType } from '../sequence/participant-inference';
import type { ParticipantType } from '../sequence/parser';
import {
  matchTagBlockHeading,
  injectDefaultTagMetadata,
  validateTagValues,
} from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import {
  extractColor,
  parseFirstLine,
  OPTION_NOCOLON_RE,
} from '../utils/parsing';

// Valid participant types for explicit override
const VALID_TYPES: ReadonlySet<string> = new Set([
  'service',
  'database',
  'actor',
  'queue',
  'cache',
  'gateway',
  'external',
  'networking',
  'frontend',
  'default',
]);

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
  aliasMap: Map<string, string>
): { metadata: Record<string, string>; description?: string } {
  const metadata: Record<string, string> = {};
  let description: string | undefined;

  const items = segment.split(',');
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx >= 0) {
      const rawKey = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const value = trimmed.slice(colonIdx + 1).trim();
      if (rawKey === 'description') {
        description = value;
      } else {
        const resolvedKey = aliasMap.get(rawKey) ?? rawKey;
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
    renderMode: 'rectangles',
    direction: 'LR',
    diagnostics: [],
    error: null,
  };

  const lines = content.split('\n');
  const nodeLabels = new Set<string>();
  const groupLabels = new Set<string>();
  let lastNodeLabel: string | null = null;

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
  const aliasMap = new Map<string, string>();

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
    if (!nodeLabels.has(label)) {
      result.nodes.push({
        label,
        shape: inferParticipantType(label),
        lineNumber: lineNum,
        metadata: {},
      });
      nodeLabels.add(label);
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

      // mode shapes / mode rectangles
      const modeMatch = trimmed.match(/^mode\s+(shapes|rectangles)$/i);
      if (modeMatch) {
        result.renderMode = modeMatch[1].toLowerCase() as BLRenderMode;
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
      }
    }

    // Tag group heading — must be checked BEFORE group/node/edge matching
    const tagBlockMatch = matchTagBlockHeading(trimmed);
    if (tagBlockMatch && indent === 0) {
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
        aliasMap.set(
          tagBlockMatch.alias.toLowerCase(),
          tagBlockMatch.name.toLowerCase()
        );
      }
      if (tagBlockMatch.inlineValues) {
        for (const rawVal of tagBlockMatch.inlineValues) {
          const { label, color } = extractColor(rawVal);
          currentTagGroup.entries.push({
            value: label,
            color: color ?? '',
            lineNumber: lineNum,
          });
        }
        if (currentTagGroup.entries.length > 0) {
          currentTagGroup.defaultValue = currentTagGroup.entries[0].value;
        }
      }
      result.tagGroups.push(currentTagGroup);
      continue;
    }

    // Tag group entries (indented under tag heading)
    if (currentTagGroup && !contentStarted && indent > 0) {
      const { label, color } = extractColor(trimmed);
      currentTagGroup.entries.push({
        value: label,
        color: color ?? '',
        lineNumber: lineNum,
      });
      if (currentTagGroup.entries.length === 1) {
        currentTagGroup.defaultValue = label;
      }
      continue;
    }

    // Non-indented line closes tag group
    if (currentTagGroup && indent === 0) {
      currentTagGroup = null; // eslint-disable-line no-useless-assignment
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
        const parsed = parsePipeMetadata(metaSeg, aliasMap);
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
        const parsed = parsePipeMetadata(metaSeg, aliasMap);
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
      const label = groupMatch[1];

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
            const resolvedKey = aliasMap.get(rawKey) ?? rawKey;
            groupMeta[resolvedKey] = value;
          }
        }
      }

      const parentState = currentGroupState();
      const group: BLGroup = {
        label,
        children: [],
        parentGroup: parentState?.group.label,
        lineNumber: lineNum,
        metadata: groupMeta,
      };

      // Add this group as a child of the parent group
      if (parentState) {
        parentState.group.children.push(groupId(label));
      }

      groupLabels.add(label);
      groupStack.push({ group, indent, depth: currentDepth });
      continue;
    }

    // Edge detection: contains `->` or `<->`
    if (trimmed.includes('->') || trimmed.includes('<->')) {
      contentStarted = true;
      currentTagGroup = null;
      let edgeText = trimmed;

      // Indented shorthand: `-> Target` or `-label-> Target`
      if (trimmed.startsWith('->') || /^-[^>].*->/.test(trimmed)) {
        if (!lastNodeLabel) {
          result.diagnostics.push(
            makeDgmoError(
              lineNum,
              'Indented edge has no preceding node to use as source',
              'warning'
            )
          );
          continue;
        }
        edgeText = `${lastNodeLabel} ${trimmed}`;
      }

      const edge = parseEdgeLine(
        edgeText,
        lineNum,
        aliasMap,
        result.diagnostics
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
    const node = parseNodeLine(trimmed, lineNum, aliasMap, result.diagnostics);
    if (!node) {
      result.diagnostics.push(
        makeDgmoError(lineNum, `Unexpected line: '${trimmed}'.`, 'warning')
      );
      continue;
    }
    lastNodeLabel = node.label;

    const gs = currentGroupState();
    const isGroupChild = gs && indent > gs.indent;

    if (nodeLabels.has(node.label)) {
      // Already declared — if inside a group, just add as child (no duplicate)
      if (isGroupChild) {
        gs.group.children.push(node.label);
        continue;
      }
      result.diagnostics.push(
        makeDgmoError(lineNum, `Duplicate node "${node.label}"`, 'warning')
      );
    } else {
      nodeLabels.add(node.label);
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
  }

  // Close any remaining groups
  while (groupStack.length > 0) {
    const gs = groupStack.pop()!;
    result.groups.push(gs.group);
  }

  // Implicit node creation for edge endpoints
  for (const edge of result.edges) {
    // Skip group references
    if (!edge.source.startsWith('__group_')) {
      ensureNode(edge.source, edge.lineNumber);
    }
    if (!edge.target.startsWith('__group_')) {
      ensureNode(edge.target, edge.lineNumber);
    }
  }

  // Post-parse: inject default tag metadata and validate tag values
  if (result.tagGroups.length > 0) {
    injectDefaultTagMetadata(result.nodes, result.tagGroups);
    validateTagValues(result.nodes, result.tagGroups, pushWarning, suggest);
  }

  return result;
}

// ============================================================
// Line parsers
// ============================================================

/**
 * Parse a node line. Supports:
 * - `Label`
 * - `Label [type]`
 * - `Label | key: value, key2: value2`
 * - `Label [type] | key: value`
 */
function parseNodeLine(
  trimmed: string,
  lineNum: number,
  aliasMap: Map<string, string>,
  _diagnostics: DgmoError[]
): BLNode | null {
  let label: string;
  let shapeOverride: ParticipantType | undefined;
  let metadata: Record<string, string> = {};
  let description: string | undefined;

  // Split on pipe for metadata
  const pipeIdx = trimmed.indexOf('|');
  let nameSection: string;

  if (pipeIdx >= 0) {
    nameSection = trimmed.slice(0, pipeIdx).trim();
    const metaSegment = trimmed.slice(pipeIdx + 1).trim();
    const parsed = parsePipeMetadata(metaSegment, aliasMap);
    metadata = parsed.metadata;
    description = parsed.description;
  } else {
    nameSection = trimmed;
  }

  if (!nameSection) return null;

  // Check for explicit type override: `Label [type]`
  const typeMatch = nameSection.match(/^(.+?)\s+\[(\w+)\]$/);
  if (typeMatch) {
    label = typeMatch[1].trim();
    const requestedType = typeMatch[2].toLowerCase();
    if (VALID_TYPES.has(requestedType)) {
      shapeOverride = requestedType as ParticipantType;
    }
  } else {
    label = nameSection;
  }

  if (!label) return null;

  return {
    label,
    shape: inferParticipantType(label),
    shapeOverride,
    lineNumber: lineNum,
    metadata,
    description,
  };
}

/**
 * Parse an edge line. Supports:
 * - `Source -> Target`
 * - `Source -> Target | key: value`
 * - `Source -label-> Target`
 * - `Source <-> Target`
 * - `Source <-label-> Target`
 * - `Source -label-> Target | key: value`
 */
function parseEdgeLine(
  trimmed: string,
  lineNum: number,
  aliasMap: Map<string, string>,
  diagnostics: DgmoError[]
): BLEdge | null {
  // Check for bidirectional labeled: `Source <-label-> Target`
  const biLabeledMatch = trimmed.match(/^(.+?)\s*<-(.+)->\s*(.+)$/);
  if (biLabeledMatch) {
    const source = biLabeledMatch[1].trim();
    const label = biLabeledMatch[2].trim();
    let rest = biLabeledMatch[3].trim();

    let metadata: Record<string, string> = {};
    const pipeIdx = rest.indexOf('|');
    if (pipeIdx >= 0) {
      const parsed = parsePipeMetadata(
        rest.slice(pipeIdx + 1).trim(),
        aliasMap
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
      target: rest,
      label: label || undefined,
      bidirectional: true,
      lineNumber: lineNum,
      metadata,
    };
  }

  // Check for bidirectional plain: `Source <-> Target`
  const biIdx = trimmed.indexOf('<->');
  if (biIdx >= 0) {
    const source = trimmed.slice(0, biIdx).trim();
    let rest = trimmed.slice(biIdx + 3).trim();

    let metadata: Record<string, string> = {};
    const pipeIdx = rest.indexOf('|');
    if (pipeIdx >= 0) {
      const parsed = parsePipeMetadata(
        rest.slice(pipeIdx + 1).trim(),
        aliasMap
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
      target: rest,
      bidirectional: true,
      lineNumber: lineNum,
      metadata,
    };
  }

  // Check for labeled arrow: `Source -label-> Target`
  const labeledMatch = trimmed.match(/^(.+?)\s+-(.+)->\s*(.+)$/);
  if (labeledMatch) {
    const source = labeledMatch[1].trim();
    const label = labeledMatch[2].trim();
    let rest = labeledMatch[3].trim();

    if (label) {
      let metadata: Record<string, string> = {};
      const pipeIdx = rest.indexOf('|');
      if (pipeIdx >= 0) {
        const parsed = parsePipeMetadata(
          rest.slice(pipeIdx + 1).trim(),
          aliasMap
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
        target: rest,
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

  const source = trimmed.slice(0, arrowIdx).trim();
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
    const parsed = parsePipeMetadata(rest.slice(pipeIdx + 1).trim(), aliasMap);
    metadata = parsed.metadata;
    rest = rest.slice(0, pipeIdx).trim();
  }

  if (!rest) {
    diagnostics.push(makeDgmoError(lineNum, 'Edge is missing target'));
    return null;
  }

  return {
    source,
    target: rest,
    bidirectional: false,
    lineNumber: lineNum,
    metadata,
  };
}

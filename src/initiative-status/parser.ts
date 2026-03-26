// ============================================================
// Initiative Status Diagram — Parser
// ============================================================

import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import type {
  ParsedInitiativeStatus,
  ISNode,
  ISEdge,
  ISGroup,
  InitiativeStatus,
} from './types';
import { VALID_STATUSES, STATUS_ALIASES } from './types';
import { inferParticipantType } from '../sequence/participant-inference';
import { matchTagBlockHeading, injectDefaultTagMetadata, validateTagValues } from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import { extractColor } from '../utils/parsing';

// ============================================================
// Heuristic — does this content look like an initiative-status diagram?
// ============================================================

/**
 * Returns true if the content looks like an initiative-status diagram.
 * Detects `->` arrows combined with `| done/wip/todo/na` status markers.
 */
export function looksLikeInitiativeStatus(content: string): boolean {
  const lines = content.split('\n');
  let hasArrow = false;
  let hasStatus = false;
  let hasIndentedArrow = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (trimmed.match(/^chart\s*:/i)) continue;
    if (trimmed.match(/^title\s*:/i)) continue;
    if (trimmed.includes('->')) hasArrow = true;
    if (/\|\s*(done|doing|wip|blocked|paused|waiting|todo|na)\s*$/i.test(trimmed)) hasStatus = true;
    // Indented arrow is a strong signal — only initiative-status uses this
    const isIndented = line.length > 0 && line !== trimmed && /^\s/.test(line);
    if (isIndented && (trimmed.startsWith('->') || /^-[^>].*->/.test(trimmed))) hasIndentedArrow = true;
    if (hasArrow && hasStatus) return true;
  }
  return hasIndentedArrow;
}

// ============================================================
// Metadata parser — splits comma-delimited segment into status + tags
// ============================================================

/**
 * Parse the metadata segment after a `|` pipe into a status keyword
 * and key:value tag pairs. Does NOT use parsePipeMetadata() from
 * parsing.ts — that utility drops bare words (no colon), making it
 * incompatible with status keyword extraction.
 *
 * @param segment The raw text after `|` — e.g. `"wip, p: Build, t: Backend"`
 * @param aliasMap Maps lowercase aliases to lowercase group names
 * @param lineNum Line number for diagnostic reporting
 * @param diagnostics Array to push warnings into
 */
export function parseNodeMetadata(
  segment: string,
  aliasMap: Map<string, string>,
  lineNum?: number,
  diagnostics?: DgmoError[]
): { status: InitiativeStatus; metadata: Record<string, string>; hadStatusWord: boolean } {
  const metadata: Record<string, string> = {};
  let status: InitiativeStatus = null;
  let hadStatusWord = false;

  const items = segment.split(',');
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx >= 0) {
      // key: value pair
      const rawKey = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const value = trimmed.slice(colonIdx + 1).trim();

      // Handle explicit `status: keyword` form
      if (rawKey === 'status') {
        hadStatusWord = true;
        const lower = value.toLowerCase();
        const canonical = STATUS_ALIASES[lower] ?? lower;
        if (VALID_STATUSES.includes(canonical)) {
          status = canonical as InitiativeStatus;
        } else if (lineNum !== undefined && diagnostics) {
          const allKnown = [...VALID_STATUSES, ...Object.keys(STATUS_ALIASES)];
          const hint = suggest(lower, allKnown);
          const msg = `Unknown status "${value}"${hint ? `. ${hint}` : ''}`;
          diagnostics.push(makeDgmoError(lineNum, msg, 'warning'));
        }
      } else {
        // Resolve alias to group name
        const resolvedKey = aliasMap.get(rawKey) ?? rawKey;
        metadata[resolvedKey] = value;
      }
    } else {
      // Bare word — check if it's a status keyword (or alias)
      hadStatusWord = true;
      const lower = trimmed.toLowerCase();
      const canonical = STATUS_ALIASES[lower] ?? lower;
      if (VALID_STATUSES.includes(canonical)) {
        status = canonical as InitiativeStatus;
      } else if (lineNum !== undefined && diagnostics) {
        // Unknown bare word — likely a status typo, emit warning
        const allKnown = [...VALID_STATUSES, ...Object.keys(STATUS_ALIASES)];
        const hint = suggest(lower, allKnown);
        const msg = `Unknown status "${trimmed}"${hint ? `. ${hint}` : ''}`;
        diagnostics.push(makeDgmoError(lineNum, msg, 'warning'));
      }
    }
  }

  return { status, metadata, hadStatusWord };
}

// ============================================================
// Parser
// ============================================================

function parseStatus(raw: string, line: number, diagnostics: DgmoError[]): InitiativeStatus {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return 'na';
  const canonical = STATUS_ALIASES[trimmed] ?? trimmed;
  if (VALID_STATUSES.includes(canonical)) return canonical as InitiativeStatus;

  // Unknown status — emit warning with suggestion
  const allKnown = [...VALID_STATUSES, ...Object.keys(STATUS_ALIASES)];
  const hint = suggest(trimmed, allKnown);
  const msg = `Unknown status "${raw.trim()}"${hint ? `. ${hint}` : ''}`;
  diagnostics.push(makeDgmoError(line, msg, 'warning'));
  return null;
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

export function parseInitiativeStatus(content: string): ParsedInitiativeStatus {
  const result: ParsedInitiativeStatus = {
    type: 'initiative-status',
    title: null,
    titleLineNumber: null,
    nodes: [],
    edges: [],
    groups: [],
    tagGroups: [],
    options: {},
    initialHiddenTagValues: new Map(),
    diagnostics: [],
    error: null,
  };

  const lines = content.split('\n');
  const nodeLabels = new Set<string>();
  let currentGroup: ISGroup | null = null;
  let lastNodeLabel: string | null = null;

  // Tag block state
  let contentStarted = false;
  let currentTagGroup: TagGroup | null = null;
  const aliasMap = new Map<string, string>(); // lowercase alias → lowercase group name

  const pushWarning = (lineNumber: number, message: string) => {
    result.diagnostics.push(makeDgmoError(lineNumber, message, 'warning'));
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1; // 1-based
    const raw = lines[i];
    const trimmed = raw.trim();

    // Skip blanks and comments
    if (!trimmed || trimmed.startsWith('//')) continue;

    // chart: header
    const chartMatch = trimmed.match(/^chart\s*:\s*(.+)/i);
    if (chartMatch) {
      const chartType = chartMatch[1].trim().toLowerCase();
      if (chartType !== 'initiative-status') {
        const diag = makeDgmoError(lineNum, `Expected chart type "initiative-status", got "${chartType}"`);
        result.diagnostics.push(diag);
        result.error = formatDgmoError(diag);
        return result;
      }
      continue;
    }

    // title: header
    const titleMatch = trimmed.match(/^title\s*:\s*(.+)/i);
    if (titleMatch) {
      result.title = titleMatch[1].trim();
      result.titleLineNumber = lineNum;
      continue;
    }

    // hide: directive — parse before tag blocks and content
    const hideMatch = trimmed.match(/^hide\s*:\s*(.+)/i);
    if (hideMatch) {
      const pairs = hideMatch[1].split(',');
      for (const pair of pairs) {
        const colonIdx = pair.indexOf(':');
        if (colonIdx >= 0) {
          const groupKey = pair.slice(0, colonIdx).trim().toLowerCase();
          const value = pair.slice(colonIdx + 1).trim().toLowerCase();
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

    // Tag group heading — must be checked BEFORE group/node/edge matching
    const tagBlockMatch = matchTagBlockHeading(trimmed);
    if (tagBlockMatch) {
      if (contentStarted) {
        result.diagnostics.push(
          makeDgmoError(lineNum, 'Tag groups must appear before diagram content', 'error')
        );
        continue;
      }
      if (tagBlockMatch.deprecated) {
        result.diagnostics.push(
          makeDgmoError(lineNum, `'## ${tagBlockMatch.name}' is no longer supported — use 'tag: ${tagBlockMatch.name}' instead`)
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
        aliasMap.set(tagBlockMatch.alias.toLowerCase(), tagBlockMatch.name.toLowerCase());
      }
      result.tagGroups.push(currentTagGroup);
      continue;
    }

    // Tag group entries (indented Value(color) [default] under tag heading)
    if (currentTagGroup && !contentStarted) {
      const indent = measureIndent(raw);
      if (indent > 0) {
        const isDefault = /\bdefault\s*$/i.test(trimmed);
        const entryText = isDefault
          ? trimmed.replace(/\s+default\s*$/i, '').trim()
          : trimmed;
        const { label, color } = extractColor(entryText);
        if (isDefault) {
          currentTagGroup.defaultValue = label;
        }
        currentTagGroup.entries.push({
          value: label,
          color: color ?? '',
          lineNumber: lineNum,
        });
        continue;
      }
      // Non-indented line after tag group — close and fall through
      currentTagGroup = null;
    }

    // Group header: [Group Name] or [Group Name] | metadata
    const groupMatch = trimmed.match(/^\[(.+?)\]\s*(?:\|\s*(.+))?$/);
    if (groupMatch) {
      contentStarted = true;
      currentTagGroup = null;
      // Close previous group
      if (currentGroup) {
        result.groups.push(currentGroup);
      }
      const groupMeta: Record<string, string> = {};
      if (groupMatch[2]) {
        // Parse pipe metadata for group (only key:value pairs, no status)
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
      currentGroup = {
        label: groupMatch[1],
        nodeLabels: [],
        lineNumber: lineNum,
        metadata: Object.keys(groupMeta).length > 0 ? groupMeta : undefined,
      };
      continue;
    }

    // Non-indented line closes the current group
    const isIndented = raw.length > 0 && raw !== trimmed && /^\s/.test(raw);
    if (!isIndented && currentGroup) {
      result.groups.push(currentGroup);
      currentGroup = null;
    }

    // Edge: contains `->` or labeled form `-label->`
    if (trimmed.includes('->')) {
      contentStarted = true;
      currentTagGroup = null;
      let edgeText = trimmed;
      // Indented `-> Target` or `-label-> Target` shorthand
      if (trimmed.startsWith('->') || /^-[^>].*->/.test(trimmed)) {
        if (!lastNodeLabel) {
          result.diagnostics.push(
            makeDgmoError(lineNum, 'Indented edge has no preceding node to use as source', 'warning')
          );
          continue;
        }
        edgeText = `${lastNodeLabel} ${trimmed}`;
      }
      const edge = parseEdgeLine(edgeText, lineNum, aliasMap, result.diagnostics);
      if (edge) result.edges.push(edge);
      continue;
    }

    // Node: everything else
    contentStarted = true;
    currentTagGroup = null;
    const node = parseNodeLine(trimmed, lineNum, aliasMap, result.diagnostics);
    if (node) {
      lastNodeLabel = node.label;
      if (nodeLabels.has(node.label)) {
        result.diagnostics.push(
          makeDgmoError(lineNum, `Duplicate node "${node.label}"`, 'warning')
        );
      } else {
        nodeLabels.add(node.label);
      }
      // Cascade group metadata into node (group provides defaults, node overrides)
      if (currentGroup && isIndented && currentGroup.metadata) {
        for (const [key, val] of Object.entries(currentGroup.metadata)) {
          if (!(key in node.metadata)) {
            node.metadata[key] = val;
          }
        }
      }
      result.nodes.push(node);
      // Add to current group if indented
      if (currentGroup && isIndented) {
        currentGroup.nodeLabels.push(node.label);
      }
    }
  }

  // Close any trailing group
  if (currentGroup) {
    result.groups.push(currentGroup);
  }

  // Validate edges reference declared nodes
  for (const edge of result.edges) {
    if (!nodeLabels.has(edge.source)) {
      result.diagnostics.push(
        makeDgmoError(edge.lineNumber, `Edge source "${edge.source}" is not a declared node`, 'warning')
      );
      // Auto-create an implicit node
      if (!result.nodes.some((n) => n.label === edge.source)) {
        result.nodes.push({ label: edge.source, status: 'na', shape: inferParticipantType(edge.source), lineNumber: edge.lineNumber, metadata: {} });
        nodeLabels.add(edge.source);
      }
    }
    if (!nodeLabels.has(edge.target)) {
      result.diagnostics.push(
        makeDgmoError(edge.lineNumber, `Edge target "${edge.target}" is not a declared node`, 'warning')
      );
      if (!result.nodes.some((n) => n.label === edge.target)) {
        result.nodes.push({ label: edge.target, status: 'na', shape: inferParticipantType(edge.target), lineNumber: edge.lineNumber, metadata: {} });
        nodeLabels.add(edge.target);
      }
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

function parseNodeLine(
  trimmed: string,
  lineNum: number,
  aliasMap: Map<string, string>,
  diagnostics: DgmoError[]
): ISNode | null {
  // Format: <label> | <status>, <key: value>, ...
  // or just: <label>
  const pipeIdx = trimmed.indexOf('|');
  if (pipeIdx >= 0) {
    const label = trimmed.slice(0, pipeIdx).trim();
    const metaSegment = trimmed.slice(pipeIdx + 1).trim();
    if (!label) return null;
    const { status, metadata, hadStatusWord } = parseNodeMetadata(metaSegment, aliasMap, lineNum, diagnostics);
    return {
      label,
      // Unknown status bare word → keep null; no bare word at all → default 'na'
      status: hadStatusWord ? status : (status ?? 'na'),
      shape: inferParticipantType(label),
      lineNumber: lineNum,
      metadata,
    };
  }
  return { label: trimmed, status: 'na', shape: inferParticipantType(trimmed), lineNumber: lineNum, metadata: {} };
}

function parseEdgeLine(
  trimmed: string,
  lineNum: number,
  aliasMap: Map<string, string>,
  diagnostics: DgmoError[]
): ISEdge | null {
  // Format: <source> -> <target>: <label> | <status>, <key: value>, ...
  // or:     <source> -> <target> | <status>
  // or:     <source> -> <target>: <label>
  // or:     <source> -> <target>
  // or:     <source> -<label>-> <target> [| <status>]

  // Check for labeled arrow form: SOURCE -LABEL-> TARGET [| status]
  const labeledMatch = trimmed.match(/^(\S+)\s+-(.+)->\s*(.+)$/);
  if (labeledMatch) {
    const source = labeledMatch[1];
    const label = labeledMatch[2].trim();
    let targetRest = labeledMatch[3].trim();

    if (label) {
      let status: InitiativeStatus = 'na';
      let metadata: Record<string, string> = {};
      const pipeIdx = targetRest.indexOf('|');
      if (pipeIdx >= 0) {
        const metaSegment = targetRest.slice(pipeIdx + 1).trim();
        const parsed = parseNodeMetadata(metaSegment, aliasMap, lineNum, diagnostics);
        status = parsed.hadStatusWord ? (parsed.status ?? null) : (parsed.status ?? 'na');
        metadata = parsed.metadata;
        targetRest = targetRest.slice(0, pipeIdx).trim();
      }

      const target = targetRest.trim();
      if (!target) {
        diagnostics.push(makeDgmoError(lineNum, 'Edge is missing target'));
        return null;
      }

      return { source, target, label, status, lineNumber: lineNum, metadata };
    }
    // Empty label — fall through to plain arrow parsing
  }

  const arrowIdx = trimmed.indexOf('->');
  if (arrowIdx < 0) return null;

  const source = trimmed.slice(0, arrowIdx).trim();
  let rest = trimmed.slice(arrowIdx + 2).trim();

  if (!source || !rest) {
    diagnostics.push(makeDgmoError(lineNum, 'Edge is missing source or target'));
    return null;
  }

  // Extract metadata from end (after |)
  let status: InitiativeStatus = 'na';
  let metadata: Record<string, string> = {};
  const pipeIdx = rest.indexOf('|');
  if (pipeIdx >= 0) {
    const metaSegment = rest.slice(pipeIdx + 1).trim();
    const parsed = parseNodeMetadata(metaSegment, aliasMap, lineNum, diagnostics);
    status = parsed.hadStatusWord ? (parsed.status ?? null) : (parsed.status ?? 'na');
    metadata = parsed.metadata;
    rest = rest.slice(0, pipeIdx).trim();
  }

  // Extract target and optional label (target: label)
  let target: string;
  let label: string | undefined;
  const colonIdx = rest.indexOf(':');
  if (colonIdx >= 0) {
    target = rest.slice(0, colonIdx).trim();
    label = rest.slice(colonIdx + 1).trim() || undefined;
  } else {
    target = rest.trim();
  }

  if (!target) {
    diagnostics.push(makeDgmoError(lineNum, 'Edge is missing target'));
    return null;
  }

  return { source, target, label, status, lineNumber: lineNum, metadata };
}

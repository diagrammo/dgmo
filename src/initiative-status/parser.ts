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
import { VALID_STATUSES } from './types';
import { inferParticipantType } from '../sequence/participant-inference';

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
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    if (trimmed.match(/^chart\s*:/i)) continue;
    if (trimmed.match(/^title\s*:/i)) continue;
    if (trimmed.includes('->')) hasArrow = true;
    if (/\|\s*(done|wip|todo|na)\s*$/i.test(trimmed)) hasStatus = true;
    // Indented arrow is a strong signal — only initiative-status uses this
    const isIndented = line.length > 0 && line !== trimmed && /^\s/.test(line);
    if (isIndented && trimmed.startsWith('->')) hasIndentedArrow = true;
    if (hasArrow && hasStatus) return true;
  }
  return hasIndentedArrow;
}

// ============================================================
// Parser
// ============================================================

function parseStatus(raw: string, line: number, diagnostics: DgmoError[]): InitiativeStatus {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return 'na';
  if (VALID_STATUSES.includes(trimmed)) return trimmed as InitiativeStatus;

  // Unknown status — emit warning with suggestion
  const hint = suggest(trimmed, VALID_STATUSES);
  const msg = `Unknown status "${raw.trim()}"${hint ? `. ${hint}` : ''}`;
  diagnostics.push(makeDgmoError(line, msg, 'warning'));
  return null;
}

export function parseInitiativeStatus(content: string): ParsedInitiativeStatus {
  const result: ParsedInitiativeStatus = {
    type: 'initiative-status',
    title: null,
    titleLineNumber: null,
    nodes: [],
    edges: [],
    groups: [],
    options: {},
    diagnostics: [],
    error: undefined,
  };

  const lines = content.split('\n');
  const nodeLabels = new Set<string>();
  let currentGroup: ISGroup | null = null;
  let lastNodeLabel: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1; // 1-based
    const raw = lines[i];
    const trimmed = raw.trim();

    // Skip blanks and comments
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

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

    // Group header: [Group Name]
    const groupMatch = trimmed.match(/^\[(.+)\]\s*$/);
    if (groupMatch) {
      // Close previous group
      if (currentGroup) {
        result.groups.push(currentGroup);
      }
      currentGroup = { label: groupMatch[1], nodeLabels: [], lineNumber: lineNum };
      continue;
    }

    // Non-indented line closes the current group
    const isIndented = raw.length > 0 && raw !== trimmed && /^\s/.test(raw);
    if (!isIndented && currentGroup) {
      result.groups.push(currentGroup);
      currentGroup = null;
    }

    // Edge: contains `->`
    if (trimmed.includes('->')) {
      let edgeText = trimmed;
      // Indented `-> Target` shorthand — prepend the last node label as source
      if (trimmed.startsWith('->')) {
        if (!lastNodeLabel) {
          result.diagnostics.push(
            makeDgmoError(lineNum, 'Indented edge has no preceding node to use as source', 'warning')
          );
          continue;
        }
        edgeText = `${lastNodeLabel} ${trimmed}`;
      }
      const edge = parseEdgeLine(edgeText, lineNum, result.diagnostics);
      if (edge) result.edges.push(edge);
      continue;
    }

    // Node: everything else
    const node = parseNodeLine(trimmed, lineNum, result.diagnostics);
    if (node) {
      lastNodeLabel = node.label;
      if (nodeLabels.has(node.label)) {
        result.diagnostics.push(
          makeDgmoError(lineNum, `Duplicate node "${node.label}"`, 'warning')
        );
      } else {
        nodeLabels.add(node.label);
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
        result.nodes.push({ label: edge.source, status: 'na', shape: inferParticipantType(edge.source), lineNumber: edge.lineNumber });
        nodeLabels.add(edge.source);
      }
    }
    if (!nodeLabels.has(edge.target)) {
      result.diagnostics.push(
        makeDgmoError(edge.lineNumber, `Edge target "${edge.target}" is not a declared node`, 'warning')
      );
      if (!result.nodes.some((n) => n.label === edge.target)) {
        result.nodes.push({ label: edge.target, status: 'na', shape: inferParticipantType(edge.target), lineNumber: edge.lineNumber });
        nodeLabels.add(edge.target);
      }
    }
  }

  return result;
}

// ============================================================
// Line parsers
// ============================================================

function parseNodeLine(
  trimmed: string,
  lineNum: number,
  diagnostics: DgmoError[]
): ISNode | null {
  // Format: <label> | <status>
  // or just: <label>
  const pipeIdx = trimmed.lastIndexOf('|');
  if (pipeIdx >= 0) {
    const label = trimmed.slice(0, pipeIdx).trim();
    const statusRaw = trimmed.slice(pipeIdx + 1).trim();
    if (!label) return null;
    const status = parseStatus(statusRaw, lineNum, diagnostics);
    return { label, status, shape: inferParticipantType(label), lineNumber: lineNum };
  }
  return { label: trimmed, status: 'na', shape: inferParticipantType(trimmed), lineNumber: lineNum };
}

function parseEdgeLine(
  trimmed: string,
  lineNum: number,
  diagnostics: DgmoError[]
): ISEdge | null {
  // Format: <source> -> <target>: <label> | <status>
  // or:     <source> -> <target> | <status>
  // or:     <source> -> <target>: <label>
  // or:     <source> -> <target>

  const arrowIdx = trimmed.indexOf('->');
  if (arrowIdx < 0) return null;

  const source = trimmed.slice(0, arrowIdx).trim();
  let rest = trimmed.slice(arrowIdx + 2).trim();

  if (!source || !rest) {
    diagnostics.push(makeDgmoError(lineNum, 'Edge is missing source or target'));
    return null;
  }

  // Extract status from end (after last |)
  let status: InitiativeStatus = 'na';
  const lastPipe = rest.lastIndexOf('|');
  if (lastPipe >= 0) {
    const statusRaw = rest.slice(lastPipe + 1).trim();
    status = parseStatus(statusRaw, lineNum, diagnostics);
    rest = rest.slice(0, lastPipe).trim();
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

  return { source, target, label, status, lineNumber: lineNum };
}

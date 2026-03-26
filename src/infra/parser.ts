// ============================================================
// Infra Chart Parser
// ============================================================
//
// Parses `infra [Title]` syntax into a structured InfraModel.
// Handles: chart metadata, component blocks with indented properties
// and connections, [Group] / # Group containers, tag groups, pipe metadata.

import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import { measureIndent, normalizeDirection, parseFirstLine, GROUP_HASH_RE, OPTION_NOCOLON_RE } from '../utils/parsing';
import { matchTagBlockHeading } from '../utils/tag-groups';
import type {
  ParsedInfra,
  InfraNode,
  InfraGroup,
  InfraTagGroup,
} from './types';
import { INFRA_BEHAVIOR_KEYS, EDGE_ONLY_KEYS } from './types';

// ============================================================
// Regex patterns
// ============================================================

// Connection: -label-> Target  or  -> Target  (with optional | split: N%  or pipe metadata)
const CONNECTION_RE =
  /^-(?:([^-].*?))?->\s*(.+?)(?:(?:\s*\|\s*|\s+)split\s*:?\s*(\d+)%)?\s*$/;

// Simple connection shorthand: -> Target (no label, no dash prefix needed for edge)
const SIMPLE_CONNECTION_RE =
  /^->\s*(.+?)(?:(?:\s*\|\s*|\s+)split\s*:?\s*(\d+)%)?\s*$/;

// Async connection: ~label~> Target  or  ~> Target  (with optional | split: N%  or pipe metadata)
const ASYNC_CONNECTION_RE =
  /^~(?:([^~].*?))?~>\s*(.+?)(?:(?:\s*\|\s*|\s+)split\s*:?\s*(\d+)%)?\s*$/;

// Async simple connection shorthand: ~> Target
const ASYNC_SIMPLE_CONNECTION_RE =
  /^~>\s*(.+?)(?:(?:\s*\|\s*|\s+)split\s*:?\s*(\d+)%)?\s*$/;

// Deprecated xN fanout suffix (e.g. "x5" at end of line)
const DEPRECATED_FANOUT_RE = /\bx(\d+)\s*$/;

// "is a" type declaration: NodeName is a <type>
const IS_A_RE = /^(.+?)\s+is\s+an?\s+(database|cache|queue|service|gateway|storage|function|network)\s*$/i;

// Valid node types for "is a" declarations
const VALID_NODE_TYPES = new Set(['database', 'cache', 'queue', 'service', 'gateway', 'storage', 'function', 'network']);

// Group declaration: [Group Name] with optional pipe metadata
const GROUP_RE = /^\[([^\]]+)\]\s*(?:\|\s*(.+))?$/;

// Tag value: Name  or  Name(color)
// Note: `default` keyword removed — first value is the default.
const TAG_VALUE_RE = /^(\w[\w\s]*?)(?:\(([^)]+)\))?\s*$/;

// Component line: ComponentName  or  ComponentName | t: Backend | env: Prod
// Allows hyphens in names (e.g. api-gateway, my-service-v2) — but not at the start.
const COMPONENT_RE = /^([a-zA-Z_][\w-]*)(.*)$/;

// Pipe metadata: | key: value  or  | k1: v1, k2: v2  (comma-separated)
const PIPE_META_RE = /[|,]\s*(\w+)\s*:\s*([^|,]+)/g;

// Property: key value (space-separated, no colon)
const PROPERTY_RE = /^([\w-]+)\s+(.+)$/;

// Percentage value: 80% or 99.99%
const PERCENT_RE = /^([\d.]+)%$/;

// Range value: N-M (for instances)
const RANGE_RE = /^(\d+)-(\d+)$/;

// Node names that act as the traffic entry point (edge node)
const EDGE_NODE_NAMES = new Set(['edge', 'internet']);

// Known top-level option keys (space-separated, no colon)
const TOP_LEVEL_OPTIONS = new Set([
  'slo-availability', 'slo-p90-latency-ms', 'slo-warning-margin',
  'default-latency-ms', 'default-uptime', 'default-rps',
]);

// ============================================================
// Helpers
// ============================================================

function nodeId(name: string): string {
  return name.trim();
}

function groupId(name: string): string {
  return `[${name.trim()}]`;
}

function parsePropertyValue(raw: string): string | number {
  const pct = raw.match(PERCENT_RE);
  if (pct) return parseFloat(pct[1]);

  const num = parseFloat(raw);
  if (!isNaN(num) && String(num) === raw.trim()) return num;

  return raw.trim();
}

function extractPipeMetadata(
  rest: string,
): { tags: Record<string, string>; clean: string } {
  const tags: Record<string, string> = {};
  let clean = rest;
  let match: RegExpExecArray | null;
  const re = new RegExp(PIPE_META_RE.source, 'g');
  while ((match = re.exec(rest)) !== null) {
    tags[match[1].trim()] = match[2].trim();
    clean = clean.replace(match[0], '');
  }
  return { tags, clean: clean.trim() };
}

// ============================================================
// Parser
// ============================================================

export function parseInfra(content: string): ParsedInfra {
  const lines = content.split('\n');
  const result: ParsedInfra = {
    type: 'infra',
    title: null,
    titleLineNumber: null,
    direction: 'LR',
    nodes: [],
    edges: [],
    groups: [],
    tagGroups: [],
    options: {},
    diagnostics: [],
    error: null,
  };

  const nodeMap = new Map<string, InfraNode>();

  const setError = (line: number, message: string) => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    if (!result.error) result.error = formatDgmoError(diag);
  };

  const warn = (line: number, message: string) => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  // Track parser state
  let currentNode: InfraNode | null = null;
  let currentGroup: InfraGroup | null = null;
  let currentTagGroup: InfraTagGroup | null = null;
  let baseIndent = 0; // indent of the current component line

  function finishCurrentNode() {
    if (currentNode && !nodeMap.has(currentNode.id)) {
      // Validate mutual exclusion: concurrency vs instances/max-rps
      const keys = new Set(currentNode.properties.map((p) => p.key));
      if (keys.has('concurrency') && (keys.has('instances') || keys.has('max-rps'))) {
        const conflicting = [keys.has('instances') ? 'instances' : '', keys.has('max-rps') ? 'max-rps' : '']
          .filter(Boolean)
          .join(', ');
        warn(
          currentNode.lineNumber,
          `'concurrency' (serverless) is mutually exclusive with ${conflicting}. Serverless nodes scale via concurrency, not instances.`,
        );
      }
      // Validate mutual exclusion: buffer (queue) vs max-rps (service)
      if (keys.has('buffer') && keys.has('max-rps')) {
        warn(
          currentNode.lineNumber,
          `'buffer' (queue) and 'max-rps' (service) represent different capacity models. A queue buffers messages; a service processes them.`,
        );
      }
      nodeMap.set(currentNode.id, currentNode);
      result.nodes.push(currentNode);
    }
    currentNode = null;
  }

  function finishCurrentTagGroup() {
    if (currentTagGroup) {
      result.tagGroups.push(currentTagGroup);
    }
    currentTagGroup = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNumber = i + 1;
    const trimmed = raw.trim();
    const indent = measureIndent(raw);

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Skip markdown section headers
    if (/^#{2,}\s+/.test(trimmed)) continue;

    // ---- Top-level metadata (no indent) ----
    if (indent === 0) {
      // Close any open blocks
      if (indent === 0 && currentNode && !trimmed.startsWith('-')) {
        finishCurrentNode();
      }

      // First line: `infra [Title]` or legacy `chart: infra`
      const firstLineResult = parseFirstLine(trimmed);
      if (firstLineResult) {
        if (firstLineResult.chartType !== 'infra') {
          setError(lineNumber, `Expected chart type 'infra', got '${firstLineResult.chartType}'`);
        }
        if (firstLineResult.title) {
          result.title = firstLineResult.title;
          result.titleLineNumber = lineNumber;
        }
        continue;
      }

      // direction LR | TB  (also accepts orientation as alias)
      // Supports both `direction LR` (new) and `direction: LR` (legacy)
      if (/^(?:direction|orientation)\s/i.test(trimmed)) {
        const raw = trimmed.replace(/^(?:direction|orientation)\s+/i, '').trim();
        const dir = normalizeDirection(raw);
        if (dir) {
          result.direction = dir;
        } else {
          warn(lineNumber, `Unknown direction '${raw}'. Expected 'LR', 'TB', 'horizontal', or 'vertical'.`);
        }
        continue;
      }

      // animate (default ON) / no-animate
      if (trimmed === 'animate') {
        result.options.animate = 'on';
        continue;
      }
      if (trimmed === 'no-animate') {
        result.options.animate = 'off';
        continue;
      }

      // Top-level options: `key value` (space-separated, no colon)
      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch && TOP_LEVEL_OPTIONS.has(optMatch[1].toLowerCase())) {
        result.options[optMatch[1].toLowerCase()] = optMatch[2].trim();
        continue;
      }

      // scenario: Name — no longer supported
      if (/^scenario\s*:/i.test(trimmed)) {
        setError(lineNumber, `'scenario:' syntax is no longer supported`);
        // Skip indented block
        let si = i + 1;
        while (si < lines.length) {
          const sLine = lines[si];
          const sTrimmed = sLine.trim();
          if (!sTrimmed || sTrimmed.startsWith('#')) { si++; continue; }
          const sIndent = sLine.length - sLine.trimStart().length;
          if (sIndent === 0) break;
          si++;
        }
        i = si - 1;
        continue;
      }

      // Tag group: `tag Name [alias]` (via shared matchTagBlockHeading)
      const tagMatch = matchTagBlockHeading(trimmed);
      if (tagMatch) {
        finishCurrentNode();
        finishCurrentTagGroup();
        currentTagGroup = {
          name: tagMatch.name,
          alias: tagMatch.alias ?? null,
          values: [],
          lineNumber,
        };
        continue;
      }

      // # GroupName (alternate group notation)
      const hashGroupMatch = trimmed.match(GROUP_HASH_RE);
      if (hashGroupMatch) {
        finishCurrentNode();
        finishCurrentTagGroup();
        const gLabel = hashGroupMatch[1].trim();
        const gId = groupId(gLabel);
        currentGroup = {
          id: gId,
          label: gLabel,
          metadata: undefined,
          lineNumber,
        };
        result.groups.push(currentGroup);
        continue;
      }

      // [Group Name] or [Group Name] | t: Engineering
      const groupMatch = trimmed.match(GROUP_RE);
      if (groupMatch) {
        finishCurrentNode();
        finishCurrentTagGroup();
        const gLabel = groupMatch[1].trim();
        const gId = groupId(gLabel);
        const groupMeta = groupMatch[2] ? extractPipeMetadata('|' + groupMatch[2]).tags : undefined;
        currentGroup = {
          id: gId,
          label: gLabel,
          metadata: groupMeta && Object.keys(groupMeta).length > 0 ? groupMeta : undefined,
          lineNumber,
        };
        result.groups.push(currentGroup);
        continue;
      }

      // "is a" type declaration: NodeName is a <type>
      const isaMatch = trimmed.match(IS_A_RE);
      if (isaMatch) {
        finishCurrentNode();
        finishCurrentTagGroup();

        const name = isaMatch[1].trim();
        const nType = isaMatch[2].toLowerCase();
        const id = nodeId(name);
        const isEdge = EDGE_NODE_NAMES.has(id.toLowerCase());

        currentNode = {
          id,
          label: name,
          properties: [],
          groupId: null,
          tags: {},
          isEdge,
          nodeType: nType,
          lineNumber,
        };
        currentGroup = null;
        baseIndent = 0;
        continue;
      }

      // Component at top level (no indent)
      const compMatch = trimmed.match(COMPONENT_RE);
      if (compMatch) {
        finishCurrentNode();
        finishCurrentTagGroup();

        const name = compMatch[1];
        const rest = compMatch[2] || '';
        const { tags } = extractPipeMetadata(rest);
        const id = nodeId(name);
        const isEdge = EDGE_NODE_NAMES.has(id.toLowerCase());

        currentNode = {
          id,
          label: name,
          properties: [],
          groupId: null,
          tags,
          isEdge,
          lineNumber,
        };
        currentGroup = null;
        baseIndent = 0;
        continue;
      }
    }

    // ---- Indented lines ----

    // Tag value inside tag group — first value is the default
    if (currentTagGroup && indent > 0) {
      const tvMatch = trimmed.match(TAG_VALUE_RE);
      if (tvMatch) {
        const valueName = tvMatch[1].trim();
        currentTagGroup.values.push({
          name: valueName,
          color: tvMatch[2]?.trim(),
        });
        // First value is the default
        if (currentTagGroup.values.length === 1) {
          currentTagGroup.defaultValue = valueName;
        }
        continue;
      }
    }

    // Inside a [Group] but no current node — group properties or component declaration
    if (currentGroup && !currentNode && indent > 0) {
      // Group-level properties (instances, collapsed)
      const propMatch = trimmed.match(PROPERTY_RE);
      if (propMatch) {
        const key = propMatch[1].toLowerCase();
        const val = propMatch[2].trim();
        if (key === 'instances') {
          const rangeM = val.match(RANGE_RE);
          if (rangeM) {
            currentGroup.instances = val;
          } else {
            const num = parseInt(val, 10);
            if (!isNaN(num)) currentGroup.instances = num;
          }
          continue;
        }
        if (key === 'collapsed') {
          currentGroup.collapsed = val.toLowerCase() === 'true';
          continue;
        }
      }

      // "is a" type declaration inside group
      const isaMatchG = trimmed.match(IS_A_RE);
      if (isaMatchG) {
        finishCurrentTagGroup();
        const name = isaMatchG[1].trim();
        const nType = isaMatchG[2].toLowerCase();
        const id = nodeId(name);
        // Cascade group metadata into node tags (node-level overrides later)
        const tags: Record<string, string> = currentGroup.metadata ? { ...currentGroup.metadata } : {};

        currentNode = {
          id,
          label: name,
          properties: [],
          groupId: currentGroup.id,
          tags,
          isEdge: false,
          nodeType: nType,
          lineNumber,
        };
        baseIndent = indent;
        continue;
      }

      const compMatch = trimmed.match(COMPONENT_RE);
      if (compMatch) {
        finishCurrentTagGroup();
        const name = compMatch[1];
        const rest = compMatch[2] || '';
        const { tags: nodeTags } = extractPipeMetadata(rest);
        const id = nodeId(name);
        // Cascade group metadata into node tags; node-level metadata overrides
        const tags: Record<string, string> = currentGroup.metadata
          ? { ...currentGroup.metadata, ...nodeTags }
          : nodeTags;

        currentNode = {
          id,
          label: name,
          properties: [],
          groupId: currentGroup.id,
          tags,
          isEdge: false,
          lineNumber,
        };
        baseIndent = indent;
        continue;
      }
    }

    // Inside a component block — properties and connections
    if (currentNode && indent > baseIndent) {
      // Detect deprecated xN fanout syntax
      const deprecatedFanout = trimmed.match(DEPRECATED_FANOUT_RE);
      if (deprecatedFanout && (trimmed.startsWith('->') || trimmed.startsWith('-') || trimmed.startsWith('~'))) {
        const n = deprecatedFanout[1];
        setError(lineNumber, `'x${n}' fanout syntax is no longer supported — use '| fanout: ${n}' instead`);
        continue;
      }

      // Async simple connection: ~> Target
      const asyncSimpleConn = trimmed.match(ASYNC_SIMPLE_CONNECTION_RE);
      if (asyncSimpleConn) {
        const targetRaw = asyncSimpleConn[1].trim();
        const splitStr = asyncSimpleConn[2];
        const pipeMeta = extractPipeMetadata(targetRaw);
        const targetName = pipeMeta.clean || targetRaw;
        const split = splitStr ? parseFloat(splitStr)
          : pipeMeta.tags.split ? parseFloat(pipeMeta.tags.split) : null;
        const fanoutRaw = pipeMeta.tags.fanout ? parseInt(pipeMeta.tags.fanout, 10) : null;
        if (fanoutRaw !== null && fanoutRaw < 1) {
          warn(lineNumber, `Fan-out multiplier must be at least 1 (got fanout: ${fanoutRaw}). Ignoring.`);
        }
        const fanout = fanoutRaw !== null && fanoutRaw >= 1 ? fanoutRaw : null;
        result.edges.push({
          sourceId: currentNode.id,
          targetId: nodeId(targetName),
          label: '',
          async: true,
          split,
          fanout,
          lineNumber,
        });
        continue;
      }

      // Async labeled connection: ~label~> Target
      const asyncConnMatch = trimmed.match(ASYNC_CONNECTION_RE);
      if (asyncConnMatch) {
        const label = asyncConnMatch[1]?.trim() || '';
        const targetRaw = asyncConnMatch[2].trim();
        const splitStr = asyncConnMatch[3];
        const pipeMeta = extractPipeMetadata(targetRaw);
        const targetName = pipeMeta.clean || targetRaw;
        const split = splitStr ? parseFloat(splitStr)
          : pipeMeta.tags.split ? parseFloat(pipeMeta.tags.split) : null;
        const fanoutRaw = pipeMeta.tags.fanout ? parseInt(pipeMeta.tags.fanout, 10) : null;
        if (fanoutRaw !== null && fanoutRaw < 1) {
          warn(lineNumber, `Fan-out multiplier must be at least 1 (got fanout: ${fanoutRaw}). Ignoring.`);
        }
        const fanout = fanoutRaw !== null && fanoutRaw >= 1 ? fanoutRaw : null;

        let targetId: string;
        const targetGroupMatch = targetName.match(/^\[([^\]]+)\]/);
        if (targetGroupMatch) {
          targetId = groupId(targetGroupMatch[1]);
        } else {
          targetId = nodeId(targetName);
        }

        result.edges.push({
          sourceId: currentNode.id,
          targetId,
          label,
          async: true,
          split,
          fanout,
          lineNumber,
        });
        continue;
      }

      // Simple connection: -> Target  or  -> Target | fanout: 5
      const simpleConn = trimmed.match(SIMPLE_CONNECTION_RE);
      if (simpleConn) {
        const targetRaw = simpleConn[1].trim();
        const splitStr = simpleConn[2];
        // Parse pipe metadata for fanout/split (and clean target name)
        const pipeMeta = extractPipeMetadata(targetRaw);
        const targetName = pipeMeta.clean || targetRaw;
        const split = splitStr ? parseFloat(splitStr)
          : pipeMeta.tags.split ? parseFloat(pipeMeta.tags.split) : null;
        const fanoutRaw = pipeMeta.tags.fanout ? parseInt(pipeMeta.tags.fanout, 10) : null;
        if (fanoutRaw !== null && fanoutRaw < 1) {
          warn(lineNumber, `Fan-out multiplier must be at least 1 (got fanout: ${fanoutRaw}). Ignoring.`);
        }
        const fanout = fanoutRaw !== null && fanoutRaw >= 1 ? fanoutRaw : null;
        result.edges.push({
          sourceId: currentNode.id,
          targetId: nodeId(targetName),
          label: '',
          async: false,
          split,
          fanout,
          lineNumber,
        });
        continue;
      }

      // Labeled connection: -label-> Target | split: N%, fanout: 3
      const connMatch = trimmed.match(CONNECTION_RE);
      if (connMatch) {
        const label = connMatch[1]?.trim() || '';
        const targetRaw = connMatch[2].trim();
        const splitStr = connMatch[3];
        // Parse pipe metadata for fanout/split (and clean target name)
        const pipeMeta = extractPipeMetadata(targetRaw);
        const targetName = pipeMeta.clean || targetRaw;
        const split = splitStr ? parseFloat(splitStr)
          : pipeMeta.tags.split ? parseFloat(pipeMeta.tags.split) : null;
        const fanoutRaw = pipeMeta.tags.fanout ? parseInt(pipeMeta.tags.fanout, 10) : null;
        if (fanoutRaw !== null && fanoutRaw < 1) {
          warn(lineNumber, `Fan-out multiplier must be at least 1 (got fanout: ${fanoutRaw}). Ignoring.`);
        }
        const fanout = fanoutRaw !== null && fanoutRaw >= 1 ? fanoutRaw : null;

        // Target might be a group ref like [API Pods]
        let targetId: string;
        const targetGroupMatch = targetName.match(/^\[([^\]]+)\]/);
        if (targetGroupMatch) {
          targetId = groupId(targetGroupMatch[1]);
        } else {
          targetId = nodeId(targetName);
        }

        result.edges.push({
          sourceId: currentNode.id,
          targetId,
          label,
          async: false,
          split,
          fanout,
          lineNumber,
        });
        continue;
      }

      // Empty description (no value) — silently skip rather than emitting "Unexpected line"
      if (/^description\s*:?\s*$/i.test(trimmed)) continue;

      // Property: key: value
      const propMatch = trimmed.match(PROPERTY_RE);
      if (propMatch) {
        const key = propMatch[1].toLowerCase();
        const rawVal = propMatch[2].trim();

        // description is display metadata, not a behavior key; silently ignored on edge nodes.
        // Single-line only — no length enforcement, but keep it short for legibility.
        if (key === 'description' && currentNode) {
          if (!currentNode.isEdge) currentNode.description = rawVal;
          continue;
        }

        // Validate property key
        if (!INFRA_BEHAVIOR_KEYS.has(key) && !EDGE_ONLY_KEYS.has(key)) {
          const allKeys = [...INFRA_BEHAVIOR_KEYS, ...EDGE_ONLY_KEYS];
          let msg = `Unknown property '${key}'.`;
          const hint = suggest(key, allKeys);
          if (hint) msg += ` ${hint}`;
          warn(lineNumber, msg);
        }

        // Validate edge-only keys
        if (EDGE_ONLY_KEYS.has(key) && !currentNode.isEdge) {
          warn(lineNumber, `Property '${key}' is only valid on the entry point (Edge/Internet).`);
        }

        const value = parsePropertyValue(rawVal);
        currentNode.properties.push({ key, value, lineNumber });
        continue;
      }

      // Unknown indented line
      warn(lineNumber, `Unexpected line inside component '${currentNode.label}'.`);
      continue;
    }

    // Component inside group (same indent as group children)
    if (currentGroup && indent > 0) {
      finishCurrentNode();

      // "is a" type declaration inside group
      const isaMatchG2 = trimmed.match(IS_A_RE);
      if (isaMatchG2) {
        const name = isaMatchG2[1].trim();
        const nType = isaMatchG2[2].toLowerCase();
        const id = nodeId(name);
        const tags: Record<string, string> = currentGroup.metadata ? { ...currentGroup.metadata } : {};

        currentNode = {
          id,
          label: name,
          properties: [],
          groupId: currentGroup.id,
          tags,
          isEdge: false,
          nodeType: nType,
          lineNumber,
        };
        baseIndent = indent;
        continue;
      }

      const compMatch = trimmed.match(COMPONENT_RE);
      if (compMatch) {
        const name = compMatch[1];
        const rest = compMatch[2] || '';
        const { tags: nodeTags } = extractPipeMetadata(rest);
        const id = nodeId(name);
        const tags: Record<string, string> = currentGroup.metadata
          ? { ...currentGroup.metadata, ...nodeTags }
          : nodeTags;

        currentNode = {
          id,
          label: name,
          properties: [],
          groupId: currentGroup.id,
          tags,
          isEdge: false,
          lineNumber,
        };
        baseIndent = indent;
        continue;
      }
    }

    // If we reach here and indent is 0, try as a top-level component
    if (indent === 0) {
      const compMatch = trimmed.match(COMPONENT_RE);
      if (compMatch) {
        finishCurrentNode();
        finishCurrentTagGroup();
        currentGroup = null;

        const name = compMatch[1];
        const rest = compMatch[2] || '';
        const { tags } = extractPipeMetadata(rest);
        const id = nodeId(name);

        currentNode = {
          id,
          label: name,
          properties: [],
          groupId: null,
          tags,
          isEdge: EDGE_NODE_NAMES.has(id.toLowerCase()),
          lineNumber,
        };
        baseIndent = 0;
        continue;
      }
    }
  }

  // Flush last open blocks
  finishCurrentNode();
  finishCurrentTagGroup();

  // Ensure referenced targets exist (create stub nodes for forward references)
  for (const edge of result.edges) {
    if (!nodeMap.has(edge.targetId)) {
      // Check if target is a group
      const isGroup = result.groups.some((g) => g.id === edge.targetId);
      if (!isGroup) {
        // Create a stub node for forward-referenced targets
        const stub: InfraNode = {
          id: edge.targetId,
          label: edge.targetId,
          properties: [],
          groupId: null,
          tags: {},
          isEdge: false,
          lineNumber: edge.lineNumber,
        };
        nodeMap.set(stub.id, stub);
        result.nodes.push(stub);
      }
    }
  }

  // Inject default tag values into nodes that don't have one
  for (const tg of result.tagGroups) {
    if (!tg.defaultValue) continue;
    const key = (tg.alias ?? tg.name).toLowerCase();
    for (const node of result.nodes) {
      if (node.isEdge) continue;
      if (!(key in node.tags)) {
        node.tags[key] = tg.defaultValue;
      }
    }
  }

  return result;
}

// ============================================================
// Symbol extraction (for completion API)
// ============================================================

import type { DiagramSymbols } from '../completion';

/**
 * Extract component names (entities) from infra document text.
 * Used by the dgmo completion API for ghost hints and popup completions.
 */
export function extractSymbols(docText: string): DiagramSymbols {
  const entities: string[] = [];
  let inMetadata = true;
  let inTagGroup = false;
  for (const rawLine of docText.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const indented = /^\s/.test(rawLine);

    // Metadata phase: skip until first non-metadata root-level line.
    // Metadata includes: `infra [Title]`, `chart: type`, `direction X`, `slo-*`, etc.
    if (inMetadata) {
      if (!indented) {
        // Recognize new-style bare options (`key value`) and old-style (`key: value`)
        const firstLine = parseFirstLine(line);
        if (firstLine) continue; // chart type line
        if (/^(?:direction|orientation|animate|no-animate|slo-|default-)/i.test(line)) continue;
        if (/^[a-z-]+\s*:/i.test(line)) continue; // legacy colon options
        inMetadata = false;
      } else {
        continue;
      }
    }

    if (!indented) {
      // Root-level: tag group declaration, group header, or component
      if (/^tag\s/i.test(line)) { inTagGroup = true; continue; }
      if (/^tag\s*:/i.test(line)) { inTagGroup = true; continue; } // legacy
      inTagGroup = false;
      if (/^\[/.test(line)) continue; // [Group] header
      if (/^#\s/.test(line)) continue; // # Group header
      const m = COMPONENT_RE.exec(line);
      if (m && !entities.includes(m[1]!)) entities.push(m[1]!);
    } else {
      // Indented: skip tag values, connections, and properties; extract grouped components
      if (inTagGroup) continue;
      if (/^->/.test(line)) continue; // simple connection
      if (/^~>/.test(line)) continue; // async simple connection
      if (/^-[^>]+-?>/.test(line)) continue; // labeled connection
      if (/^~[^~]+~>/.test(line)) continue; // async labeled connection
      if (/^\w[\w-]*\s*:/.test(line)) continue; // property (key: value) legacy
      // New-style property: first token is a known behavior/property key
      const firstToken = line.split(/\s/)[0].toLowerCase();
      if ((INFRA_BEHAVIOR_KEYS.has(firstToken) || EDGE_ONLY_KEYS.has(firstToken) || firstToken === 'description' || firstToken === 'instances' || firstToken === 'collapsed') && /\s/.test(line)) continue;
      const m = COMPONENT_RE.exec(line);
      if (m && !entities.includes(m[1]!)) entities.push(m[1]!);
    }
  }
  return { kind: 'infra', entities, keywords: [] };
}

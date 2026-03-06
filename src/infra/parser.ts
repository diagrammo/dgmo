// ============================================================
// Infra Chart Parser
// ============================================================
//
// Parses `chart: infra` syntax into a structured InfraModel.
// Handles: chart metadata, component blocks with indented properties
// and connections, [Group] containers, tag groups, pipe metadata.

import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import { measureIndent } from '../utils/parsing';
import type {
  ParsedInfra,
  InfraNode,
  InfraEdge,
  InfraGroup,
  InfraTagGroup,
  InfraTagValue,
  InfraProperty,
} from './types';
import { INFRA_BEHAVIOR_KEYS, EDGE_ONLY_KEYS } from './types';

// ============================================================
// Regex patterns
// ============================================================

// Connection: -label-> Target  or  -> Target  (with optional | split: N%)
const CONNECTION_RE =
  /^-(?:([^-].*?))?->\s+(.+?)(?:(?:\s*\|\s*|\s+)split\s*:?\s*(\d+)%)?\s*$/;

// Simple connection shorthand: -> Target (no label, no dash prefix needed for edge)
const SIMPLE_CONNECTION_RE =
  /^->\s+(.+?)(?:(?:\s*\|\s*|\s+)split\s*:?\s*(\d+)%)?\s*$/;

// Group declaration: [Group Name]
const GROUP_RE = /^\[([^\]]+)\]$/;

// Tag group declaration: tag: Name alias x
const TAG_GROUP_RE = /^tag\s*:\s*(\w[\w\s]*?)(?:\s+alias\s+(\w+))?\s*$/;

// Tag value: Name  or  Name(color)  or  Name(color) default
const TAG_VALUE_RE = /^(\w[\w\s]*?)(?:\(([^)]+)\))?(\s+default)?\s*$/;

// Component line: ComponentName  or  ComponentName | t: Backend | env: Prod
const COMPONENT_RE = /^([a-zA-Z_][\w]*)(.*)$/;

// Pipe metadata: | key: value
const PIPE_META_RE = /\|\s*(\w+)\s*:\s*([^|]+)/g;

// Property: key: value
const PROPERTY_RE = /^([\w-]+)\s*:\s*(.+)$/;

// Percentage value: 80% or 99.99%
const PERCENT_RE = /^([\d.]+)%$/;

// Range value: N-M (for instances)
const RANGE_RE = /^(\d+)-(\d+)$/;

// Node names that act as the traffic entry point (edge node)
const EDGE_NODE_NAMES = new Set(['edge', 'internet']);

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
    scenarios: [],
    options: {},
    diagnostics: [],
    error: null,
  };

  const nodeMap = new Map<string, InfraNode>();
  const edgeNodeId = 'edge';

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

      // chart: infra
      if (/^chart\s*:/i.test(trimmed)) {
        const val = trimmed.replace(/^chart\s*:\s*/i, '').trim().toLowerCase();
        if (val !== 'infra') {
          setError(lineNumber, `Expected chart type 'infra', got '${val}'`);
        }
        continue;
      }

      // title: ...
      if (/^title\s*:/i.test(trimmed)) {
        result.title = trimmed.replace(/^title\s*:\s*/i, '').trim();
        result.titleLineNumber = lineNumber;
        continue;
      }

      // direction: LR | TB
      if (/^direction\s*:/i.test(trimmed)) {
        const dir = trimmed.replace(/^direction\s*:\s*/i, '').trim().toUpperCase();
        if (dir === 'LR' || dir === 'TB') {
          result.direction = dir;
        } else {
          warn(lineNumber, `Unknown direction '${dir}'. Expected 'LR' or 'TB'.`);
        }
        continue;
      }

      // animate: on | off
      if (/^animate\s*:/i.test(trimmed)) {
        result.options.animate = trimmed.replace(/^animate\s*:\s*/i, '').trim().toLowerCase();
        continue;
      }

      // default-latency-ms: <number>
      if (/^default-latency-ms\s*:/i.test(trimmed)) {
        result.options['default-latency-ms'] = trimmed.replace(/^default-latency-ms\s*:\s*/i, '').trim();
        continue;
      }

      // default-uptime: <number>
      if (/^default-uptime\s*:/i.test(trimmed)) {
        result.options['default-uptime'] = trimmed.replace(/^default-uptime\s*:\s*/i, '').trim();
        continue;
      }

      // scenario: Name
      if (/^scenario\s*:/i.test(trimmed)) {
        finishCurrentNode();
        finishCurrentTagGroup();
        currentGroup = null;
        const scenarioName = trimmed.replace(/^scenario\s*:\s*/i, '').trim();
        const scenario: import('./types').InfraScenario = {
          name: scenarioName,
          overrides: {},
          lineNumber,
        };
        // Parse indented block for scenario overrides
        let scenarioNodeId: string | null = null;
        let si = i + 1;
        while (si < lines.length) {
          const sLine = lines[si];
          const sTrimmed = sLine.trim();
          if (!sTrimmed || sTrimmed.startsWith('#')) { si++; continue; }
          const sIndent = sLine.length - sLine.trimStart().length;
          if (sIndent === 0) break; // back to top level

          if (sIndent <= 2) {
            // Node reference (e.g., "  edge" or "  API")
            scenarioNodeId = nodeId(sTrimmed.replace(/\|.*$/, '').trim());
            if (!scenario.overrides[scenarioNodeId]) {
              scenario.overrides[scenarioNodeId] = {};
            }
          } else if (scenarioNodeId) {
            // Property override (e.g., "    rps: 10000")
            const pm = sTrimmed.match(PROPERTY_RE);
            if (pm) {
              const key = pm[1].toLowerCase();
              const val = parsePropertyValue(pm[2].trim());
              scenario.overrides[scenarioNodeId][key] = val;
            }
          }
          si++;
        }
        i = si - 1; // advance past scenario block
        result.scenarios.push(scenario);
        continue;
      }

      // tag: GroupName alias x
      const tagMatch = trimmed.match(TAG_GROUP_RE);
      if (tagMatch) {
        finishCurrentNode();
        finishCurrentTagGroup();
        currentTagGroup = {
          name: tagMatch[1].trim(),
          alias: tagMatch[2] ?? null,
          values: [],
          lineNumber,
        };
        continue;
      }

      // [Group Name]
      const groupMatch = trimmed.match(GROUP_RE);
      if (groupMatch) {
        finishCurrentNode();
        finishCurrentTagGroup();
        const gLabel = groupMatch[1].trim();
        const gId = groupId(gLabel);
        currentGroup = { id: gId, label: gLabel, lineNumber };
        result.groups.push(currentGroup);
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

    // Tag value inside tag group
    if (currentTagGroup && indent > 0) {
      const tvMatch = trimmed.match(TAG_VALUE_RE);
      if (tvMatch) {
        const valueName = tvMatch[1].trim();
        currentTagGroup.values.push({
          name: valueName,
          color: tvMatch[2]?.trim(),
        });
        if (tvMatch[3]) {
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

      const compMatch = trimmed.match(COMPONENT_RE);
      if (compMatch) {
        finishCurrentTagGroup();
        const name = compMatch[1];
        const rest = compMatch[2] || '';
        const { tags } = extractPipeMetadata(rest);
        const id = nodeId(name);

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
      // Simple connection: -> Target
      const simpleConn = trimmed.match(SIMPLE_CONNECTION_RE);
      if (simpleConn) {
        const targetName = simpleConn[1].trim();
        const splitStr = simpleConn[2];
        const split = splitStr ? parseFloat(splitStr) : null;
        result.edges.push({
          sourceId: currentNode.id,
          targetId: nodeId(targetName),
          label: '',
          split,
          lineNumber,
        });
        continue;
      }

      // Labeled connection: -label-> Target | split: N%
      const connMatch = trimmed.match(CONNECTION_RE);
      if (connMatch) {
        const label = connMatch[1]?.trim() || '';
        const targetName = connMatch[2].trim();
        const splitStr = connMatch[3];
        const split = splitStr ? parseFloat(splitStr) : null;

        // Target might be a group ref like [API Pods]
        let targetId: string;
        const targetGroupMatch = targetName.match(GROUP_RE);
        if (targetGroupMatch) {
          targetId = groupId(targetGroupMatch[1]);
        } else {
          targetId = nodeId(targetName);
        }

        result.edges.push({
          sourceId: currentNode.id,
          targetId,
          label,
          split,
          lineNumber,
        });
        continue;
      }

      // Property: key: value
      const propMatch = trimmed.match(PROPERTY_RE);
      if (propMatch) {
        const key = propMatch[1].toLowerCase();
        const rawVal = propMatch[2].trim();

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
      const compMatch = trimmed.match(COMPONENT_RE);
      if (compMatch) {
        const name = compMatch[1];
        const rest = compMatch[2] || '';
        const { tags } = extractPipeMetadata(rest);
        const id = nodeId(name);

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

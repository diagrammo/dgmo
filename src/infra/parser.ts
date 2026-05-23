// ============================================================
// Infra Chart Parser
// ============================================================
//
// Parses `infra [Title]` syntax into a structured InfraModel.
// Handles: chart metadata, component blocks with indented properties
// and connections, [Group] containers, tag groups, pipe metadata.

import {
  formatDgmoError,
  makeDgmoError,
  METADATA_DIAGNOSTIC_CODES,
  NAME_DIAGNOSTIC_CODES,
  nameMergedMessage,
  pipeOperatorRemovedMessage,
  suggest,
} from '../diagnostics';
import { tryStripDescriptionKeyword } from '../utils/description-helpers';
import { parseInArrowLabel } from '../utils/arrows';
import {
  measureIndent,
  parseFirstLine,
  OPTION_NOCOLON_RE,
  tryParseSharedOption,
} from '../utils/parsing';
import { isRecognizedColorName } from '../colors';
import { normalizeName, displayName } from '../utils/name-normalize';
import {
  matchTagBlockHeading,
  emitTagLegacyDiagnostic,
  stripDefaultModifier,
  validateTagGroupNames,
} from '../utils/tag-groups';
import type {
  ParsedInfra,
  InfraNode,
  InfraGroup,
  InfraTagGroup,
} from './types';
import { INFRA_BEHAVIOR_KEYS, EDGE_ONLY_KEYS } from './types';
import type { Writable } from '../utils/brand';

// ============================================================
// Regex patterns
// ============================================================

// Connection: -label-> Target  or  -> Target  (pipe metadata handled by extractPipeMetadata)
const CONNECTION_RE = /^-(?:([^-].*?))?->\s*(.+?)\s*$/;

// Simple connection shorthand: -> Target (no label, no dash prefix needed for edge)
const SIMPLE_CONNECTION_RE = /^->\s*(.+?)\s*$/;

// Async connection: ~label~> Target  or  ~> Target
const ASYNC_CONNECTION_RE = /^~(?:([^~].*?))?~>\s*(.+?)\s*$/;

// Async simple connection shorthand: ~> Target
const ASYNC_SIMPLE_CONNECTION_RE = /^~>\s*(.+?)\s*$/;

// Deprecated xN fanout suffix (e.g. "x5" at end of line)
const DEPRECATED_FANOUT_RE = /\bx(\d+)\s*$/;

// Group declaration: [Group Name] with optional `as <alias>` and optional
// metadata (legacy `| ...` or new same-line `key: value` per §1.4).
// Capture order: 1=label, 2=alias, 3=metadata tail.
const GROUP_RE =
  /^\[([^\]]+)\]\s*(?:as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*)?((?:\|.*)|(?:[a-zA-Z_]\w*\s*:.*))?$/;

// Tag value: `Name` or `Name color` (trailing-token color form). Color is
// extracted via the shared `extractColor` helper at use-site (see
// `dgmo/src/utils/parsing.ts:extractColor`), not via this regex. This regex
// just confirms the line shape is a valid tag value (no reserved sigils).
const TAG_VALUE_RE = /^(\w[\w\s]+?)\s*$/;

// Component line. Accepts either a quoted name ("name with | : reserved chars")
// or a bare name (multi-word allowed; must start with letter/underscore so digit-
// only or sigil-led lines fall through to other branches). Pipe metadata follows
// after a `|` separator.
//
// Captures:
//   1: quoted-name content (without the surrounding quotes), or undefined
//   2: bare-name (trimmed at the call site), or undefined
//   3: metadata block — legacy `| ...` form OR new same-line
//      `<word>: <value>...` form (§1.4), or undefined
const COMPONENT_RE =
  /^(?:"([^"]+)"|([a-zA-Z_][\w -]*?))\s*((?:\|.*)|(?:[a-zA-Z_]\w*\s*:.*))?$/;

// Legacy pipe metadata: | key: value  or  | k1: v1, k2: v2  (comma-separated).
// Kept for transitional back-compat extraction; new same-line metadata
// (§1.4) is preferred and extracted via SAMELINE_META_RE below.
const PIPE_META_RE = /[|,]\s*(\w+)\s*:\s*([^|,]+)/g;
// Same-line metadata (post-0.18.0 §1.4): `k: v, k2: v2` after any name
// region — matches a colon-bearing key-value, comma-separated.
const SAMELINE_META_RE = /(?:^|[\s,])(\w+)\s*:\s*([^,]+?)(?=\s*,|\s*$)/g;

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
  'slo-availability',
  'slo-p90-latency-ms',
  'slo-warning-margin',
  'default-latency-ms',
  'default-uptime',
  'default-rps',
  'active-tag',
]);

// ============================================================
// Helpers
// ============================================================

function nodeId(name: string): string {
  return normalizeName(name);
}

function groupId(name: string): string {
  return `[${normalizeName(name)}]`;
}

function parsePropertyValue(raw: string): string | number {
  const pct = raw.match(PERCENT_RE);
  // Capture group 1 in-bounds after successful match.
  if (pct) return parseFloat(pct[1]!);

  const num = parseFloat(raw);
  if (!isNaN(num) && String(num) === raw.trim()) return num;

  return raw.trim();
}

function extractPipeMetadata(rest: string): {
  tags: Record<string, string>;
  clean: string;
  hadPipe: boolean;
} {
  const tags: Record<string, string> = {};
  let clean = rest;
  let match: RegExpExecArray | null;
  const hadPipe = rest.includes('|');
  if (hadPipe) {
    PIPE_META_RE.lastIndex = 0;
    while ((match = PIPE_META_RE.exec(rest)) !== null) {
      tags[match[1]!.trim()] = match[2]!.trim();
      clean = clean.replace(match[0], '');
    }
    return { tags, clean: clean.trim(), hadPipe: true };
  }
  // §1.4 same-line metadata: no pipe, but `key: value, key2: value2`
  // may follow the name. Extract from right-to-left so the leftmost
  // name region is preserved as `clean`.
  SAMELINE_META_RE.lastIndex = 0;
  let firstMatchIdx = -1;
  while ((match = SAMELINE_META_RE.exec(rest)) !== null) {
    tags[match[1]!.trim()] = match[2]!.trim();
    if (firstMatchIdx === -1) firstMatchIdx = match.index;
  }
  if (firstMatchIdx >= 0) {
    clean = rest.substring(0, firstMatchIdx).trim();
  }
  return { tags, clean: clean.trim(), hadPipe: false };
}

// Detect unparsed pipe metadata left in a target name after extractPipeMetadata.
// Common case: `split 100%` without a colon isn't picked up by PIPE_META_RE.
const UNPARSED_SPLIT_RE = /\bsplit\s+(\d+)%/;

function warnUnparsedPipeMeta(
  targetName: string,
  lineNumber: number,
  warnFn: (line: number, message: string) => void
): void {
  if (!targetName.includes('|')) return;
  const splitMatch = targetName.match(UNPARSED_SPLIT_RE);
  if (splitMatch) {
    warnFn(
      lineNumber,
      `'split ${splitMatch[1]}%' needs a colon — use 'split: ${splitMatch[1]}%'`
    );
  } else {
    warnFn(
      lineNumber,
      `Unparsed pipe metadata in target — pipe values use 'key: value' syntax`
    );
  }
}

// ============================================================
// Parser
// ============================================================

export function parseInfra(content: string): ParsedInfra {
  const lines = content.split('\n');
  const options: Record<string, string> = {};
  const result: Writable<ParsedInfra> = {
    type: 'infra',
    title: null,
    titleLineNumber: null,
    direction: 'LR',
    nodes: [],
    edges: [],
    groups: [],
    tagGroups: [],
    options,
    diagnostics: [],
    error: null,
  };

  const nodeMap = new Map<string, Writable<InfraNode>>();
  // Sidecar mutable tag-records, keyed by node id. The same Record object is
  // also referenced from `node.tags`; mutating it here updates both views.
  const nodeMutableTags = new Map<string, Record<string, string>>();

  // Push a description line onto a node. Manages the underlying mutable
  // array and assigns it back so `node.description` stays in sync.
  function pushDescription(node: Writable<InfraNode>, text: string): void {
    const existing = (node.description as string[] | undefined) ?? [];
    existing.push(text);
    node.description = existing;
  }

  // Per-parse alias literal → canonical node id (TD-18). Per C8.
  const nameAliasMap = new Map<string, string>();
  function peelAlias(label: string): { label: string; alias?: string } {
    const trimmed = label.trim();
    const m = trimmed.match(/^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/);
    if (!m) return { label: trimmed };
    // Capture groups 1 & 2 in-bounds after successful match.
    return { label: m[1]!.trim(), ...(m[2] !== undefined && { alias: m[2] }) };
  }

  // Infra nodes have no "is a <type>" declaration — capability comes from
  // properties (cache-hit, buffer, drain-rate, …). Strip the suffix if a
  // user wrote it (likely copying from sequence/c4 syntax) and warn.
  const IS_A_SUFFIX = /^(.*?)\s+is\s+an?\s+[A-Za-z][\w-]*\s*$/i;
  function peelInfraDecorations(
    rawName: string,
    lineNumber: number
  ): { label: string; alias?: string } {
    const peeled = peelAlias(rawName);
    const m = peeled.label.match(IS_A_SUFFIX);
    if (!m) return peeled;
    warn(
      lineNumber,
      `Infra nodes don't use 'is a <type>' — types are inferred from properties (cache-hit, buffer, drain-rate, …). Drop the 'is a' suffix.`
    );
    // Capture group 1 in-bounds after successful match.
    return {
      label: m[1]!.trim(),
      ...(peeled.alias !== undefined && { alias: peeled.alias }),
    };
  }
  /**
   * Resolve a connection-target token. If the token exactly matches a
   * declared alias, return the bound canonical id. Otherwise fall
   * through to the normal `nodeId()` hash.
   */
  function resolveTargetId(rawName: string): string {
    const aliasResolved = nameAliasMap.get(rawName.trim());
    if (aliasResolved !== undefined) return aliasResolved;
    return nodeId(rawName);
  }

  // Tracks first-seen display form for each normalized edge-target id.
  // Used to give forward-reference stubs a readable label (e.g. 'CDN'
  // instead of the lowercased internal 'cdn').
  const targetDisplays = new Map<string, string>();
  const rememberTargetDisplay = (key: string, display: string): void => {
    if (!targetDisplays.has(key)) targetDisplays.set(key, display.trim());
  };

  const setError = (line: number, message: string) => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    if (!result.error) result.error = formatDgmoError(diag);
  };

  const warn = (line: number, message: string) => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  // Track parser state
  let currentNode: Writable<InfraNode> | null = null;
  let currentGroup: Writable<InfraGroup> | null = null;
  let currentTagGroup: Writable<InfraTagGroup> | null = null;
  let baseIndent = 0; // indent of the current component line

  function finishCurrentNode() {
    if (!currentNode) return;
    const key = currentNode.id;
    const existing = nodeMap.get(key);
    if (existing) {
      const incomingDisplay = displayName(currentNode.label);
      const existingDisplay = displayName(existing.label);
      if (incomingDisplay !== existingDisplay) {
        result.diagnostics.push(
          makeDgmoError(
            currentNode.lineNumber,
            nameMergedMessage({
              incomingDisplay,
              incomingLine: currentNode.lineNumber,
              existingDisplay,
              existingLine: existing.lineNumber,
            }),
            'warning',
            NAME_DIAGNOSTIC_CODES.NAME_MERGED
          )
        );
      }
      currentNode = null;
      return;
    }
    // Validate mutual exclusion: concurrency vs instances/max-rps
    const keys = new Set(currentNode.properties.map((p) => p.key));
    if (
      keys.has('concurrency') &&
      (keys.has('instances') || keys.has('max-rps'))
    ) {
      const conflicting = [
        keys.has('instances') ? 'instances' : '',
        keys.has('max-rps') ? 'max-rps' : '',
      ]
        .filter(Boolean)
        .join(', ');
      warn(
        currentNode.lineNumber,
        `'concurrency' (serverless) is mutually exclusive with ${conflicting}. Serverless nodes scale via concurrency, not instances.`
      );
    }
    // Validate mutual exclusion: buffer (queue) vs max-rps (service)
    if (keys.has('buffer') && keys.has('max-rps')) {
      warn(
        currentNode.lineNumber,
        `'buffer' (queue) and 'max-rps' (service) represent different capacity models. A queue buffers messages; a service processes them.`
      );
    }
    nodeMap.set(key, currentNode);
    result.nodes.push(currentNode);
    currentNode = null;
  }

  function finishCurrentTagGroup() {
    if (currentTagGroup) {
      result.tagGroups.push(currentTagGroup);
    }
    currentTagGroup = null;
  }

  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const raw = lines[i]!;
    const lineNumber = i + 1;
    const trimmed = raw.trim();
    const indent = measureIndent(raw);

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Skip markdown section headers
    if (/^#{2,}\s+/.test(trimmed)) continue;

    // §1.4 legacy `|` detection — fires once per line. The `|` in
    // arrow labels (per §1.10) is allowed inside `-...->` regions;
    // a simple heuristic: skip if the only `|` is inside a `-|->`-shaped
    // sequence. Otherwise emit the error and continue (legacy data
    // still extracts via extractPipeMetadata for transition).
    if (trimmed.includes('|') && !/-\S*\|\S*->/.test(trimmed)) {
      result.diagnostics.push(
        makeDgmoError(
          lineNumber,
          pipeOperatorRemovedMessage(),
          'error',
          METADATA_DIAGNOSTIC_CODES.PIPE_OPERATOR_REMOVED
        )
      );
    }

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
          setError(
            lineNumber,
            `Expected chart type 'infra', got '${firstLineResult.chartType}'`
          );
        }
        if (firstLineResult.title) {
          result.title = firstLineResult.title;
          result.titleLineNumber = lineNumber;
        }
        continue;
      }

      // direction-tb — bare boolean to switch to top-to-bottom (default is LR)
      if (/^direction-tb$/i.test(trimmed)) {
        result.direction = 'TB';
        continue;
      }

      // animate (default ON) / no-animate
      if (trimmed === 'animate') {
        options['animate'] = 'on';
        continue;
      }
      if (trimmed === 'no-animate') {
        options['animate'] = 'off';
        continue;
      }

      if (tryParseSharedOption(trimmed, options)) {
        continue;
      }

      // Top-level options: `key value` (space-separated, no colon)
      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      // Capture groups 1 & 2 in-bounds after successful match.
      if (optMatch && TOP_LEVEL_OPTIONS.has(optMatch[1]!.toLowerCase())) {
        options[optMatch[1]!.toLowerCase()] = optMatch[2]!.trim();
        continue;
      }

      // Tag group: `tag Name as <alias>` (via shared matchTagBlockHeading)
      const tagMatch = matchTagBlockHeading(trimmed);
      if (tagMatch) {
        emitTagLegacyDiagnostic(tagMatch, lineNumber, result.diagnostics);
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

      // [Group Name] [as <alias>] [| t: Engineering] — TD-18 native `as` postfix
      const groupMatch = trimmed.match(GROUP_RE);
      if (groupMatch) {
        finishCurrentNode();
        finishCurrentTagGroup();
        // Capture group 1 in-bounds after successful match.
        const gLabel = groupMatch[1]!.trim();
        const groupAlias = groupMatch[2];
        const gId = groupId(gLabel);
        if (groupAlias) nameAliasMap.set(groupAlias, gId);
        const groupMeta = groupMatch[3]
          ? extractPipeMetadata(groupMatch[3]).tags
          : undefined;
        const hasMeta = groupMeta && Object.keys(groupMeta).length > 0;
        const newGroup: Writable<InfraGroup> = {
          id: gId,
          label: gLabel,
          ...(hasMeta && { metadata: groupMeta }),
          lineNumber,
        };
        currentGroup = newGroup;
        result.groups.push(newGroup);
        continue;
      }

      // Component at top level (no indent) — supports `as` postfix
      const compMatch = trimmed.match(COMPONENT_RE);
      if (compMatch) {
        finishCurrentNode();
        finishCurrentTagGroup();

        const rawName = (compMatch[1] ?? compMatch[2] ?? '').trim();
        const peeled = peelInfraDecorations(rawName, lineNumber);
        const name = peeled.label;
        const rest = compMatch[3] || '';
        const { tags } = extractPipeMetadata(rest);
        const id = nodeId(name);
        if (peeled.alias) nameAliasMap.set(peeled.alias, id);
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
        nodeMutableTags.set(id, tags);
        currentGroup = null;
        baseIndent = 0;
        continue;
      }
    }

    // ---- Indented lines ----

    // Tag value inside tag group — first value is the default unless another is marked `default`
    if (currentTagGroup && indent > 0) {
      const { text: cleanEntry, isDefault } = stripDefaultModifier(trimmed);
      // Trailing-token color (universal rule, §1.5): peel off a lowercase
      // recognized color word from the end of the line. Downstream stores
      // the raw color NAME (not the palette hex) so the renderer can resolve
      // against whichever theme/palette is active at render time.
      const lastSpaceIdx = cleanEntry.lastIndexOf(' ');
      let valueName = cleanEntry;
      let rawColor: string | undefined;
      if (lastSpaceIdx > 0) {
        const trailing = cleanEntry.substring(lastSpaceIdx + 1);
        if (isRecognizedColorName(trailing)) {
          rawColor = trailing;
          valueName = cleanEntry.substring(0, lastSpaceIdx).trimEnd();
        }
      }
      const tvMatch = valueName.match(TAG_VALUE_RE);
      if (tvMatch || /^\w+$/.test(valueName)) {
        currentTagGroup.values.push({
          name: valueName,
          ...(rawColor !== undefined && { color: rawColor }),
        });
        if (isDefault) {
          currentTagGroup.defaultValue = valueName;
        } else if (currentTagGroup.values.length === 1) {
          currentTagGroup.defaultValue = valueName;
        }
        continue;
      }
      warn(
        lineNumber,
        `Invalid tag value '${trimmed}' in tag group '${currentTagGroup.name}'.`
      );
      continue;
    }

    // Inside a [Group] but no current node — group properties or component declaration
    if (currentGroup && !currentNode && indent > 0) {
      // Group-level properties (instances, collapsed)
      const propMatch = trimmed.match(PROPERTY_RE);
      if (propMatch) {
        // Capture groups 1 & 2 in-bounds after successful match.
        const key = propMatch[1]!.toLowerCase();
        const val = propMatch[2]!.trim();
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
        // Fall through to component matching — could be a component name
        // that happens to match PROPERTY_RE (e.g., "MyService v2")
      }

      const compMatch = trimmed.match(COMPONENT_RE);
      if (compMatch) {
        finishCurrentTagGroup();
        const rawName = (compMatch[1] ?? compMatch[2] ?? '').trim();
        const peeled = peelInfraDecorations(rawName, lineNumber);
        const name = peeled.label;
        const rest = compMatch[3] || '';
        const { tags: nodeTags } = extractPipeMetadata(rest);
        const id = nodeId(name);
        if (peeled.alias) nameAliasMap.set(peeled.alias, id);
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
        nodeMutableTags.set(id, tags);
        baseIndent = indent;
        continue;
      }
    }

    // Inside a component block — properties and connections
    if (currentNode && indent > baseIndent) {
      // Detect deprecated xN fanout syntax
      const deprecatedFanout = trimmed.match(DEPRECATED_FANOUT_RE);
      if (
        deprecatedFanout &&
        (trimmed.startsWith('->') ||
          trimmed.startsWith('-') ||
          trimmed.startsWith('~'))
      ) {
        const n = deprecatedFanout[1];
        setError(
          lineNumber,
          `'x${n}' fanout syntax is no longer supported — use '| fanout: ${n}' instead`
        );
        continue;
      }

      // Async simple connection: ~> Target
      const asyncSimpleConn = trimmed.match(ASYNC_SIMPLE_CONNECTION_RE);
      if (asyncSimpleConn) {
        // Capture group 1 in-bounds after successful match.
        const targetRaw = asyncSimpleConn[1]!.trim();
        const pipeMeta = extractPipeMetadata(targetRaw);
        const targetName = pipeMeta.clean || targetRaw;
        warnUnparsedPipeMeta(targetName, lineNumber, warn);
        const split = pipeMeta.tags['split']
          ? parseFloat(pipeMeta.tags['split'])
          : null;
        const fanoutRaw = pipeMeta.tags['fanout']
          ? parseInt(pipeMeta.tags['fanout'], 10)
          : null;
        if (fanoutRaw !== null && fanoutRaw < 1) {
          warn(
            lineNumber,
            `Fan-out multiplier must be at least 1 (got fanout: ${fanoutRaw}). Ignoring.`
          );
        }
        const fanout = fanoutRaw !== null && fanoutRaw >= 1 ? fanoutRaw : null;
        const targetIdAsync = resolveTargetId(targetName);
        rememberTargetDisplay(targetIdAsync, targetName);
        result.edges.push({
          sourceId: currentNode.id,
          targetId: targetIdAsync,
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
        const rawLabel = asyncConnMatch[1] ?? '';
        const labelResult = parseInArrowLabel(rawLabel, lineNumber);
        result.diagnostics.push(...labelResult.diagnostics);
        const label = labelResult.label ?? '';
        // Capture group 2 in-bounds after successful match.
        const targetRaw = asyncConnMatch[2]!.trim();
        const pipeMeta = extractPipeMetadata(targetRaw);
        const targetName = pipeMeta.clean || targetRaw;
        warnUnparsedPipeMeta(targetName, lineNumber, warn);
        const split = pipeMeta.tags['split']
          ? parseFloat(pipeMeta.tags['split'])
          : null;
        const fanoutRaw = pipeMeta.tags['fanout']
          ? parseInt(pipeMeta.tags['fanout'], 10)
          : null;
        if (fanoutRaw !== null && fanoutRaw < 1) {
          warn(
            lineNumber,
            `Fan-out multiplier must be at least 1 (got fanout: ${fanoutRaw}). Ignoring.`
          );
        }
        const fanout = fanoutRaw !== null && fanoutRaw >= 1 ? fanoutRaw : null;

        let targetId: string;
        const targetGroupMatch = targetName.match(/^\[([^\]]+)\]/);
        if (targetGroupMatch) {
          // Capture group 1 in-bounds after successful match.
          targetId = groupId(targetGroupMatch[1]!);
          rememberTargetDisplay(targetId, `[${targetGroupMatch[1]}]`);
        } else {
          targetId = resolveTargetId(targetName);
          rememberTargetDisplay(targetId, targetName);
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
        // Capture group 1 in-bounds after successful match.
        const targetRaw = simpleConn[1]!.trim();
        const pipeMeta = extractPipeMetadata(targetRaw);
        const targetName = pipeMeta.clean || targetRaw;
        warnUnparsedPipeMeta(targetName, lineNumber, warn);
        const split = pipeMeta.tags['split']
          ? parseFloat(pipeMeta.tags['split'])
          : null;
        const fanoutRaw = pipeMeta.tags['fanout']
          ? parseInt(pipeMeta.tags['fanout'], 10)
          : null;
        if (fanoutRaw !== null && fanoutRaw < 1) {
          warn(
            lineNumber,
            `Fan-out multiplier must be at least 1 (got fanout: ${fanoutRaw}). Ignoring.`
          );
        }
        const fanout = fanoutRaw !== null && fanoutRaw >= 1 ? fanoutRaw : null;
        const targetIdSimple = resolveTargetId(targetName);
        rememberTargetDisplay(targetIdSimple, targetName);
        result.edges.push({
          sourceId: currentNode.id,
          targetId: targetIdSimple,
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
        const rawLabel = connMatch[1] ?? '';
        const labelResult = parseInArrowLabel(rawLabel, lineNumber);
        result.diagnostics.push(...labelResult.diagnostics);
        const label = labelResult.label ?? '';
        // Capture group 2 in-bounds after successful match.
        const targetRaw = connMatch[2]!.trim();
        const pipeMeta = extractPipeMetadata(targetRaw);
        const targetName = pipeMeta.clean || targetRaw;
        warnUnparsedPipeMeta(targetName, lineNumber, warn);
        const split = pipeMeta.tags['split']
          ? parseFloat(pipeMeta.tags['split'])
          : null;
        const fanoutRaw = pipeMeta.tags['fanout']
          ? parseInt(pipeMeta.tags['fanout'], 10)
          : null;
        if (fanoutRaw !== null && fanoutRaw < 1) {
          warn(
            lineNumber,
            `Fan-out multiplier must be at least 1 (got fanout: ${fanoutRaw}). Ignoring.`
          );
        }
        const fanout = fanoutRaw !== null && fanoutRaw >= 1 ? fanoutRaw : null;

        // Target might be a group ref like [API Pods] or an alias literal.
        let targetId: string;
        const targetGroupMatch = targetName.match(/^\[([^\]]+)\]/);
        if (targetGroupMatch) {
          // Capture group 1 in-bounds after successful match.
          targetId = groupId(targetGroupMatch[1]!);
          rememberTargetDisplay(targetId, `[${targetGroupMatch[1]}]`);
        } else {
          targetId = resolveTargetId(targetName);
          rememberTargetDisplay(targetId, targetName);
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
        // Capture groups 1 & 2 in-bounds after successful match.
        const key = propMatch[1]!.toLowerCase();
        const rawVal = propMatch[2]!.trim();

        // description is display metadata, not a behavior key; silently ignored on edge nodes.
        // Single-line only — no length enforcement, but keep it short for legibility.
        if (key === 'description' && currentNode) {
          if (!currentNode.isEdge) {
            pushDescription(currentNode, rawVal);
          }
          continue;
        }

        // Unknown keys: decide between property typo warning vs description collection.
        // Heuristic: if the key looks like a plausible property (alphanumeric-hyphen, close
        // match to a known key, or the value looks numeric/percentage), warn as typo.
        // Otherwise treat the whole line as description text.
        if (!INFRA_BEHAVIOR_KEYS.has(key) && !EDGE_ONLY_KEYS.has(key)) {
          const allKeys = [...INFRA_BEHAVIOR_KEYS, ...EDGE_ONLY_KEYS];
          const hint = suggest(key, allKeys);
          const valueLooksNumeric = /^[\d.]+%?$/.test(rawVal);
          if (hint || valueLooksNumeric) {
            // Likely a typo — warn
            let msg = `Unknown property '${key}'.`;
            if (hint) msg += ` ${hint}`;
            warn(lineNumber, msg);
          } else if (!currentNode.isEdge) {
            // Likely prose — collect as description
            pushDescription(currentNode, trimmed);
            continue;
          }
          continue;
        }

        // Validate edge-only keys
        if (EDGE_ONLY_KEYS.has(key) && !currentNode.isEdge) {
          warn(
            lineNumber,
            `Property '${key}' is only valid on the entry point (Edge/Internet).`
          );
        }

        const value = parsePropertyValue(rawVal);
        currentNode.properties.push({ key, value, lineNumber });
        continue;
      }

      // Unknown indented line — try as keywordless description
      if (!currentNode.isEdge) {
        const descResult = tryStripDescriptionKeyword(trimmed);
        const descText = descResult.isKeyword ? descResult.text : trimmed;
        pushDescription(currentNode, descText);
        continue;
      }
      warn(
        lineNumber,
        `Unexpected line inside component '${currentNode.label}'.`
      );
      continue;
    }

    // Component inside group (same indent as group children)
    if (currentGroup && indent > 0) {
      finishCurrentNode();

      const compMatch = trimmed.match(COMPONENT_RE);
      if (compMatch) {
        const rawName = (compMatch[1] ?? compMatch[2] ?? '').trim();
        const peeled = peelInfraDecorations(rawName, lineNumber);
        const name = peeled.label;
        const rest = compMatch[3] || '';
        const { tags: nodeTags } = extractPipeMetadata(rest);
        const id = nodeId(name);
        if (peeled.alias) nameAliasMap.set(peeled.alias, id);
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
        nodeMutableTags.set(id, tags);
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

        const rawName = (compMatch[1] ?? compMatch[2] ?? '').trim();
        const peeled = peelInfraDecorations(rawName, lineNumber);
        const name = peeled.label;
        const rest = compMatch[3] || '';
        const { tags } = extractPipeMetadata(rest);
        const id = nodeId(name);
        if (peeled.alias) nameAliasMap.set(peeled.alias, id);

        currentNode = {
          id,
          label: name,
          properties: [],
          groupId: null,
          tags,
          isEdge: EDGE_NODE_NAMES.has(id.toLowerCase()),
          lineNumber,
        };
        nodeMutableTags.set(id, tags);
        baseIndent = 0;
        continue;
      }
    }

    // Catch-all: nothing matched this line
    warn(lineNumber, `Unexpected line: '${trimmed}'.`);
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
        // Create a stub node for forward-referenced targets. Display label
        // recovers the user's first-seen casing so the rendered SVG shows
        // 'CDN' instead of the lowercased internal id.
        const stubDisplay = targetDisplays.get(edge.targetId) ?? edge.targetId;
        const stubTags: Record<string, string> = {};
        const stub: Writable<InfraNode> = {
          id: edge.targetId,
          label: stubDisplay,
          properties: [],
          groupId: null,
          tags: stubTags,
          isEdge: false,
          lineNumber: edge.lineNumber,
        };
        // stub.id is edge.targetId, already-normalized via nodeId() at edge construction
        // eslint-disable-next-line name-normalize/required-at-insertion
        nodeMap.set(stub.id, stub);
        result.nodes.push(stub);
        nodeMutableTags.set(stub.id, stubTags);
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
        const tags = nodeMutableTags.get(node.id);
        if (tags) tags[key] = tg.defaultValue;
      }
    }
  }

  validateTagGroupNames(result.tagGroups, warn, setError);

  return result;
}

// ============================================================
// Symbol extraction (for completion API)
// ============================================================

import type { DiagramSymbols } from '../completion-types';

/**
 * Extract component names (entities) from infra document text.
 * Used by the dgmo completion API for ghost hints and popup completions.
 */
/** Strip ` as <alias>` and ` is a/an <type>` decorations from a node name
 *  so completion suggests the bare identifier the user will reference. */
function stripNodeDecorations(name: string): string {
  let s = name.trim();
  const aliasMatch = s.match(/^(.*?)\s+as\s+[A-Za-z][A-Za-z0-9_]{0,11}\s*$/);
  // Capture group 1 in-bounds after successful match.
  if (aliasMatch) s = aliasMatch[1]!.trim();
  const isAMatch = s.match(/^(.*?)\s+is\s+an?\s+[A-Za-z][\w-]*\s*$/i);
  // Capture group 1 in-bounds after successful match.
  if (isAMatch) s = isAMatch[1]!.trim();
  return s;
}

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
        if (/^(?:direction-tb|animate|no-animate|slo-|default-)/i.test(line))
          continue;
        if (/^[a-z-]+\s*:/i.test(line)) continue; // legacy colon options
        inMetadata = false;
      } else {
        continue;
      }
    }

    if (!indented) {
      // Root-level: tag group declaration, group header, or component
      if (/^tag\s/i.test(line)) {
        inTagGroup = true;
        continue;
      }
      if (/^tag\s*:/i.test(line)) {
        inTagGroup = true;
        continue;
      } // legacy
      inTagGroup = false;
      if (/^\[/.test(line)) continue; // [Group] header
      const m = COMPONENT_RE.exec(line);
      if (m) {
        const name = stripNodeDecorations((m[1] ?? m[2] ?? '').trim());
        if (name && !entities.includes(name)) entities.push(name);
      }
    } else {
      // Indented: skip tag values, connections, and properties; extract grouped components
      if (inTagGroup) continue;
      if (/^->/.test(line)) continue; // simple connection
      if (/^~>/.test(line)) continue; // async simple connection
      if (/^-[^>]+-?>/.test(line)) continue; // labeled connection
      if (/^~[^~]+~>/.test(line)) continue; // async labeled connection
      if (/^\w[\w-]*\s*:/.test(line)) continue; // property (key: value) legacy
      // New-style property: first token is a known behavior/property key
      // String.split always returns at least one element; line.length > 0 here.
      const firstToken = line.split(/\s/)[0]!.toLowerCase();
      if (
        (INFRA_BEHAVIOR_KEYS.has(firstToken) ||
          EDGE_ONLY_KEYS.has(firstToken) ||
          firstToken === 'description' ||
          firstToken === 'instances' ||
          firstToken === 'collapsed') &&
        /\s/.test(line)
      )
        continue;
      const m = COMPONENT_RE.exec(line);
      if (m) {
        const name = stripNodeDecorations((m[1] ?? m[2] ?? '').trim());
        if (name && !entities.includes(name)) entities.push(name);
      }
    }
  }
  return { kind: 'infra', entities, keywords: [] };
}

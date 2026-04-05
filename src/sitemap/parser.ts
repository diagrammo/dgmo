// ============================================================
// Sitemap Diagram Parser
// ============================================================

import type { PaletteColors } from '../palettes';
import { resolveColor } from '../colors';
import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';
import {
  isTagBlockHeading,
  matchTagBlockHeading,
  validateTagValues,
  validateTagGroupNames,
  stripDefaultModifier,
} from '../utils/tag-groups';
import {
  measureIndent,
  extractColor,
  parsePipeMetadata,
  inferArrowColor,
  MULTIPLE_PIPE_ERROR,
  parseFirstLine,
  OPTION_NOCOLON_RE,
  ALL_CHART_TYPES,
} from '../utils/parsing';
import type { SitemapNode, ParsedSitemap } from './types';

// ============================================================
// Regexes
// ============================================================

const CONTAINER_RE = /^\[([^\]]+)\]\s*(?:\|\s*(.+))?$/;
/** Metadata on content nodes: `key: value` (colon-separated, used in content phase) */
const METADATA_RE = /^([^:]+):\s*(.+)$/;

/**
 * Arrow line: `-label->`, `-(color)->`, `-label(color)->`, `->` followed by target label.
 * Captures: [1] label, [2] color, [3] target
 */
const ARROW_RE = /^-([^(>][^(>]*?)?\s*(?:\(([^)]+)\))?\s*->\s*(.+)$/;
const BARE_ARROW_RE = /^->\s*(.+)$/;

// ============================================================
// Helpers
// ============================================================

function parseArrowLine(
  trimmed: string,
  palette?: PaletteColors
): {
  label?: string;
  color?: string;
  target: string;
  targetIsGroup: boolean;
} | null {
  // Bare arrow: -> Target
  const bareMatch = trimmed.match(BARE_ARROW_RE);
  if (bareMatch) {
    const rawTarget = bareMatch[1].trim();
    const groupMatch = rawTarget.match(/^\[(.+)\]$/);
    return {
      target: groupMatch ? groupMatch[1].trim() : rawTarget,
      targetIsGroup: !!groupMatch,
    };
  }

  // Labeled/colored arrow: -label(color)-> Target
  const arrowMatch = trimmed.match(ARROW_RE);
  if (arrowMatch) {
    const label = arrowMatch[1]?.trim() || undefined;
    let color = arrowMatch[2]
      ? (resolveColor(arrowMatch[2].trim(), palette) ?? undefined)
      : undefined;
    if (label && !color) {
      color = inferArrowColor(label);
    }
    const rawTarget = arrowMatch[3].trim();
    const groupMatch = rawTarget.match(/^\[(.+)\]$/);
    return {
      label,
      color,
      target: groupMatch ? groupMatch[1].trim() : rawTarget,
      targetIsGroup: !!groupMatch,
    };
  }

  return null;
}

// ============================================================
// Inference
// ============================================================

/**
 * Returns true if content looks like a sitemap diagram.
 * Heuristic: has `->` arrows AND `[Group]` containers but does NOT have
 * flowchart shape delimiters ((...), <...>, /.../) adjacent to arrows.
 */
export function looksLikeSitemap(content: string): boolean {
  const lines = content.split('\n');
  let hasArrow = false;
  let hasContainer = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Skip header lines
    if (parseFirstLine(trimmed)) continue;
    if (isTagBlockHeading(trimmed)) continue;

    if (/^-.*->\s*.+/.test(trimmed) || /^->\s*.+/.test(trimmed)) {
      hasArrow = true;
    }
    if (CONTAINER_RE.test(trimmed)) {
      hasContainer = true;
    }
  }

  if (!hasArrow || !hasContainer) return false;

  // Exclude flowchart: flowchart arrows connect shaped nodes like (X) -> [Y]
  // Sitemap arrows are indented under a parent node, target is plain text
  const hasFlowchartShapes =
    /[\])][ \t]*-.*->/.test(content) || /->[ \t]*[[(</]/.test(content);

  return !hasFlowchartShapes;
}

// ============================================================
// Parser
// ============================================================

export function parseSitemap(
  content: string,
  palette?: PaletteColors
): ParsedSitemap {
  const result: ParsedSitemap = {
    title: null,
    titleLineNumber: null,
    direction: 'LR',
    roots: [],
    edges: [],
    tagGroups: [],
    options: {},
    diagnostics: [],
    error: null,
  };

  const fail = (line: number, message: string): ParsedSitemap => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  const pushError = (line: number, message: string): void => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    if (!result.error) result.error = formatDgmoError(diag);
  };

  const pushWarning = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  if (!content || !content.trim()) {
    return fail(0, 'No content provided');
  }

  const lines = content.split('\n');
  let contentStarted = false;
  let nodeCounter = 0;
  let containerCounter = 0;
  let firstLineParsed = false;

  // Tag group parsing state
  let currentTagGroup: TagGroup | null = null;

  // Alias map: alias (lowercased) -> group name (lowercased)
  const aliasMap = new Map<string, string>();

  // Indent stack for hierarchy tracking
  const indentStack: { node: SitemapNode; indent: number }[] = [];

  // Map label (lowercased) -> node for arrow target resolution
  const labelToNode = new Map<string, SitemapNode>();

  // Map label (lowercased) -> container for group-targeted arrow resolution
  const labelToContainer = new Map<string, SitemapNode>();

  // Deferred arrows: { sourceNode, arrow info, lineNumber }
  const deferredArrows: {
    sourceNode: SitemapNode;
    targetLabel: string;
    targetIsGroup: boolean;
    label?: string;
    color?: string;
    lineNumber: number;
  }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      if (currentTagGroup) {
        currentTagGroup = null;
      }
      continue;
    }

    // Skip comments
    if (trimmed.startsWith('//')) continue;

    // --- Header phase ---

    // First line: try parseFirstLine for `sitemap [Title]`
    if (!firstLineParsed && !contentStarted) {
      const firstLineResult = parseFirstLine(trimmed);
      if (firstLineResult) {
        firstLineParsed = true;
        if (firstLineResult.chartType !== 'sitemap') {
          const allTypes = Array.from(ALL_CHART_TYPES);
          let msg = `Expected chart type "sitemap", got "${firstLineResult.chartType}"`;
          const hint = suggest(firstLineResult.chartType, allTypes);
          if (hint) msg += `. ${hint}`;
          return fail(lineNumber, msg);
        }
        if (firstLineResult.title) {
          result.title = firstLineResult.title;
          result.titleLineNumber = lineNumber;
        }
        continue;
      }
    }

    // Tag group heading
    const tagBlockMatch = matchTagBlockHeading(trimmed);
    if (tagBlockMatch) {
      if (contentStarted) {
        pushError(lineNumber, 'Tag groups must appear before sitemap content');
        continue;
      }
      currentTagGroup = {
        name: tagBlockMatch.name,
        alias: tagBlockMatch.alias,
        entries: [],
        lineNumber,
      };
      if (tagBlockMatch.alias) {
        aliasMap.set(
          tagBlockMatch.alias.toLowerCase(),
          tagBlockMatch.name.toLowerCase()
        );
      }
      result.tagGroups.push(currentTagGroup);
      continue;
    }

    // Generic header options (space-separated, before content/tag groups)
    // Skip lines with `|` (pipe metadata) or `->` (arrows) — those are content
    if (
      !contentStarted &&
      !currentTagGroup &&
      measureIndent(line) === 0 &&
      !trimmed.includes('|') &&
      !trimmed.includes('->')
    ) {
      // Bare boolean: direction-tb
      if (/^direction-tb$/i.test(trimmed)) {
        result.direction = 'TB';
        continue;
      }

      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch) {
        const key = optMatch[1].trim().toLowerCase();
        result.options[key] = optMatch[2].trim();
        continue;
      }
    }

    // Tag group entries (indented Value(color) under tag heading)
    // First entry is the default unless another is marked `default`
    if (currentTagGroup && !contentStarted) {
      const indent = measureIndent(line);
      if (indent > 0) {
        const { text: cleanEntry, isDefault } = stripDefaultModifier(trimmed);
        const { label, color } = extractColor(cleanEntry, palette);
        if (!color) {
          pushError(
            lineNumber,
            `Expected 'Value(color)' in tag group '${currentTagGroup.name}'`
          );
          continue;
        }
        currentTagGroup.entries.push({
          value: label,
          color,
          lineNumber,
        });
        if (isDefault) {
          currentTagGroup.defaultValue = label;
        } else if (currentTagGroup.entries.length === 1) {
          currentTagGroup.defaultValue = label;
        }
        continue;
      }
      // Non-indented line after tag group — fall through to content
      currentTagGroup = null; // eslint-disable-line no-useless-assignment
    }

    // --- Content phase ---
    contentStarted = true;
    currentTagGroup = null;

    const indent = measureIndent(line);

    // Check for arrow syntax (must check before metadata — arrows contain `:` in labels
    // but also start with `-`)
    const arrowInfo = parseArrowLine(trimmed, palette);
    if (arrowInfo) {
      // Find the source node: the most recent node on the indent stack
      // at a shallower indent (same pattern as metadata attachment)
      const source = findParentNode(indent, indentStack);
      if (!source) {
        pushError(lineNumber, 'Arrow has no source node');
      } else {
        deferredArrows.push({
          sourceNode: source,
          targetLabel: arrowInfo.target,
          targetIsGroup: arrowInfo.targetIsGroup,
          label: arrowInfo.label,
          color: arrowInfo.color,
          lineNumber,
        });
      }
      continue;
    }

    // Check for container syntax: [Group Name]
    const containerMatch = trimmed.match(CONTAINER_RE);

    // Check for metadata syntax: key: value
    const metadataMatch = trimmed.includes('|')
      ? null
      : trimmed.match(METADATA_RE);

    if (containerMatch) {
      const rawLabel = containerMatch[1].trim();
      const { label, color } = extractColor(rawLabel, palette);

      // Parse optional pipe metadata on the container line
      const pipeStr = containerMatch[2];
      const containerMetadata: Record<string, string> = {};
      if (pipeStr) {
        // Build segments array compatible with parsePipeMetadata (first element is label, rest are pipe parts)
        const pipeSegments = ['', pipeStr];
        Object.assign(
          containerMetadata,
          parsePipeMetadata(pipeSegments, aliasMap)
        );
      }

      containerCounter++;
      const node: SitemapNode = {
        id: `container-${containerCounter}`,
        label,
        metadata: containerMetadata,
        children: [],
        parentId: null,
        isContainer: true,
        lineNumber,
        color,
      };

      attachNode(node, indent, indentStack, result);
      // Register in labelToContainer for group-targeted arrows (-> [Group])
      labelToContainer.set(label.toLowerCase(), node);
    } else if (metadataMatch && indentStack.length > 0) {
      // Metadata line — attach to parent
      const rawKey = metadataMatch[1].trim().toLowerCase();
      const key = aliasMap.get(rawKey) ?? rawKey;
      const value = metadataMatch[2].trim();

      const parent = findParentNode(indent, indentStack);
      if (!parent) {
        pushError(lineNumber, 'Metadata has no parent node');
      } else {
        parent.metadata[key] = value;
      }
    } else if (metadataMatch && indentStack.length === 0) {
      // Could be a node label containing ':'
      if (indent === 0) {
        const node = parseNodeLabel(
          trimmed,
          lineNumber,
          palette,
          ++nodeCounter,
          aliasMap,
          pushWarning
        );
        attachNode(node, indent, indentStack, result);
        labelToNode.set(node.label.toLowerCase(), node);
      } else {
        pushError(lineNumber, 'Metadata has no parent node');
      }
    } else {
      // Node label — possibly with pipe-delimited metadata
      const node = parseNodeLabel(
        trimmed,
        lineNumber,
        palette,
        ++nodeCounter,
        aliasMap,
        pushWarning
      );
      attachNode(node, indent, indentStack, result);
      labelToNode.set(node.label.toLowerCase(), node);
    }
  }

  // --- Post-parse: resolve arrow targets ---
  for (const arrow of deferredArrows) {
    const targetKey = arrow.targetLabel.toLowerCase();

    if (arrow.targetIsGroup) {
      // Group target: look up in labelToContainer
      const targetContainer = labelToContainer.get(targetKey);
      if (!targetContainer) {
        const allLabels = Array.from(labelToContainer.keys());
        let msg = `Group '[${arrow.targetLabel}]' not found`;
        const hint = suggest(targetKey, allLabels);
        if (hint) msg += `. ${hint}`;
        pushError(arrow.lineNumber, msg);
        continue;
      }
      result.edges.push({
        sourceId: arrow.sourceNode.id,
        targetId: targetContainer.id,
        label: arrow.label,
        color: arrow.color,
        lineNumber: arrow.lineNumber,
      });
    } else {
      // Node target: look up in labelToNode (existing behavior)
      const targetNode = labelToNode.get(targetKey);
      if (!targetNode) {
        const allLabels = Array.from(labelToNode.keys());
        let msg = `Arrow target "${arrow.targetLabel}" not found`;
        const hint = suggest(targetKey, allLabels);
        if (hint) msg += `. ${hint}`;
        pushError(arrow.lineNumber, msg);
        continue;
      }
      result.edges.push({
        sourceId: arrow.sourceNode.id,
        targetId: targetNode.id,
        label: arrow.label,
        color: arrow.color,
        lineNumber: arrow.lineNumber,
      });
    }
  }

  // Validate tag group values on all nodes
  if (result.tagGroups.length > 0) {
    const allNodes: SitemapNode[] = [];
    const collectAll = (nodes: SitemapNode[]) => {
      for (const node of nodes) {
        allNodes.push(node);
        collectAll(node.children);
      }
    };
    collectAll(result.roots);
    validateTagValues(allNodes, result.tagGroups, pushWarning, suggest);
    validateTagGroupNames(result.tagGroups, pushWarning);
  }

  if (
    result.roots.length === 0 &&
    result.tagGroups.length === 0 &&
    !result.error
  ) {
    const diag = makeDgmoError(1, 'No pages found in sitemap');
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
  }

  return result;
}

// ============================================================
// Internal helpers
// ============================================================

function parseNodeLabel(
  trimmed: string,
  lineNumber: number,
  palette: PaletteColors | undefined,
  counter: number,
  aliasMap: Map<string, string> = new Map(),
  warnFn?: (line: number, msg: string) => void
): SitemapNode {
  const segments = trimmed.split('|').map((s) => s.trim());
  const rawLabel = segments[0];
  const { label, color } = extractColor(rawLabel, palette);
  const metadata = parsePipeMetadata(
    segments,
    aliasMap,
    warnFn ? () => warnFn(lineNumber, MULTIPLE_PIPE_ERROR) : undefined
  );

  return {
    id: `node-${counter}`,
    label,
    metadata,
    children: [],
    parentId: null,
    isContainer: false,
    lineNumber,
    color,
  };
}

function attachNode(
  node: SitemapNode,
  indent: number,
  indentStack: { node: SitemapNode; indent: number }[],
  result: ParsedSitemap
): void {
  // Pop stack entries with indent >= current indent
  while (indentStack.length > 0) {
    const top = indentStack[indentStack.length - 1];
    if (top.indent < indent) break;
    indentStack.pop();
  }

  if (indentStack.length > 0) {
    const parent = indentStack[indentStack.length - 1].node;
    node.parentId = parent.id;
    // Cascade container metadata to child nodes (child overrides on conflict)
    if (
      parent.isContainer &&
      Object.keys(parent.metadata).length > 0 &&
      !node.isContainer
    ) {
      node.metadata = { ...parent.metadata, ...node.metadata };
    }
    parent.children.push(node);
  } else {
    result.roots.push(node);
  }

  indentStack.push({ node, indent });
}

function findParentNode(
  indent: number,
  indentStack: { node: SitemapNode; indent: number }[]
): SitemapNode | null {
  for (let i = indentStack.length - 1; i >= 0; i--) {
    if (indentStack[i].indent < indent) {
      return indentStack[i].node;
    }
  }
  if (indentStack.length > 0) {
    return indentStack[indentStack.length - 1].node;
  }
  return null;
}

// ============================================================
// Sitemap Diagram Parser
// ============================================================

import type { PaletteColors } from '../palettes';
import { resolveColor } from '../colors';
import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';
import { isTagBlockHeading, matchTagBlockHeading, validateTagValues } from '../utils/tag-groups';
import {
  measureIndent,
  extractColor,
  parsePipeMetadata,
  MULTIPLE_PIPE_WARNING,
  CHART_TYPE_RE,
  TITLE_RE,
  OPTION_RE,
} from '../utils/parsing';
import type {
  SitemapNode,
  SitemapDirection,
  ParsedSitemap,
} from './types';

// ============================================================
// Regexes
// ============================================================

const CONTAINER_RE = /^\[([^\]]+)\]$/;
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
  palette?: PaletteColors,
): { label?: string; color?: string; target: string } | null {
  // Bare arrow: -> Target
  const bareMatch = trimmed.match(BARE_ARROW_RE);
  if (bareMatch) {
    return { target: bareMatch[1].trim() };
  }

  // Labeled/colored arrow: -label(color)-> Target
  const arrowMatch = trimmed.match(ARROW_RE);
  if (arrowMatch) {
    const label = arrowMatch[1]?.trim() || undefined;
    const color = arrowMatch[2]
      ? resolveColor(arrowMatch[2].trim(), palette)
      : undefined;
    const target = arrowMatch[3].trim();
    return { label, color, target };
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
    if (CHART_TYPE_RE.test(trimmed) || TITLE_RE.test(trimmed)) continue;
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
    /[\])][ \t]*-.*->/.test(content) || /->[ \t]*[\[(<\/]/.test(content);

  return !hasFlowchartShapes;
}

// ============================================================
// Parser
// ============================================================

export function parseSitemap(
  content: string,
  palette?: PaletteColors,
): ParsedSitemap {
  const result: ParsedSitemap = {
    title: null,
    titleLineNumber: null,
    direction: 'TB',
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

  // Tag group parsing state
  let currentTagGroup: TagGroup | null = null;

  // Alias map: alias (lowercased) -> group name (lowercased)
  const aliasMap = new Map<string, string>();

  // Indent stack for hierarchy tracking
  const indentStack: { node: SitemapNode; indent: number }[] = [];

  // Map label (lowercased) -> node for arrow target resolution
  const labelToNode = new Map<string, SitemapNode>();

  // Deferred arrows: { sourceNode, arrow info, lineNumber }
  const deferredArrows: {
    sourceNode: SitemapNode;
    targetLabel: string;
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

    // chart: type
    if (!contentStarted) {
      const chartMatch = trimmed.match(CHART_TYPE_RE);
      if (chartMatch) {
        const chartType = chartMatch[1].trim().toLowerCase();
        if (chartType !== 'sitemap') {
          const allTypes = [
            'sitemap', 'org', 'class', 'flowchart', 'sequence', 'er',
            'bar', 'line', 'pie', 'scatter', 'sankey', 'venn', 'timeline',
            'arc', 'slope', 'kanban', 'c4', 'initiative-status', 'state',
          ];
          let msg = `Expected chart type "sitemap", got "${chartType}"`;
          const hint = suggest(chartType, allTypes);
          if (hint) msg += `. ${hint}`;
          return fail(lineNumber, msg);
        }
        continue;
      }
    }

    // title: value
    if (!contentStarted) {
      const titleMatch = trimmed.match(TITLE_RE);
      if (titleMatch) {
        result.title = titleMatch[1].trim();
        result.titleLineNumber = lineNumber;
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
      if (tagBlockMatch.deprecated) {
        pushWarning(
          lineNumber,
          `'## ${tagBlockMatch.name}' is deprecated for tag groups — use 'tag: ${tagBlockMatch.name}' instead`,
        );
      }
      currentTagGroup = {
        name: tagBlockMatch.name,
        alias: tagBlockMatch.alias,
        entries: [],
        lineNumber,
      };
      if (tagBlockMatch.alias) {
        aliasMap.set(tagBlockMatch.alias.toLowerCase(), tagBlockMatch.name.toLowerCase());
      }
      result.tagGroups.push(currentTagGroup);
      continue;
    }

    // Generic header options (before content/tag groups)
    if (!contentStarted && !currentTagGroup && measureIndent(line) === 0) {
      const optMatch = trimmed.match(OPTION_RE);
      if (optMatch) {
        const key = optMatch[1].trim().toLowerCase();
        if (key === 'direction') {
          const dir = optMatch[2].trim().toUpperCase();
          if (dir === 'TB' || dir === 'LR') {
            result.direction = dir as SitemapDirection;
          }
          continue;
        }
        if (key !== 'chart' && key !== 'title') {
          result.options[key] = optMatch[2].trim();
          continue;
        }
      }
    }

    // Tag group entries (indented Value(color) under tag: heading)
    if (currentTagGroup && !contentStarted) {
      const indent = measureIndent(line);
      if (indent > 0) {
        const isDefault = /\bdefault\s*$/.test(trimmed);
        const entryText = isDefault
          ? trimmed.replace(/\s+default\s*$/, '').trim()
          : trimmed;
        const { label, color } = extractColor(entryText, palette);
        if (!color) {
          pushError(
            lineNumber,
            `Expected 'Value(color)' in tag group '${currentTagGroup.name}'`,
          );
          continue;
        }
        if (isDefault) {
          currentTagGroup.defaultValue = label;
        }
        currentTagGroup.entries.push({
          value: label,
          color,
          lineNumber,
        });
        continue;
      }
      // Non-indented line after tag group — fall through to content
      currentTagGroup = null;
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
    const metadataMatch =
      trimmed.includes('|') ? null : trimmed.match(METADATA_RE);

    if (containerMatch) {
      const rawLabel = containerMatch[1].trim();
      const { label, color } = extractColor(rawLabel, palette);

      containerCounter++;
      const node: SitemapNode = {
        id: `container-${containerCounter}`,
        label,
        metadata: {},
        children: [],
        parentId: null,
        isContainer: true,
        lineNumber,
        color,
      };

      attachNode(node, indent, indentStack, result);
      // Don't register containers in labelToNode — arrows target pages, not containers
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
        const node = parseNodeLabel(trimmed, lineNumber, palette, ++nodeCounter, aliasMap, pushWarning);
        attachNode(node, indent, indentStack, result);
        labelToNode.set(node.label.toLowerCase(), node);
      } else {
        pushError(lineNumber, 'Metadata has no parent node');
      }
    } else {
      // Node label — possibly with pipe-delimited metadata
      const node = parseNodeLabel(trimmed, lineNumber, palette, ++nodeCounter, aliasMap, pushWarning);
      attachNode(node, indent, indentStack, result);
      labelToNode.set(node.label.toLowerCase(), node);
    }
  }

  // --- Post-parse: resolve arrow targets ---
  for (const arrow of deferredArrows) {
    const targetKey = arrow.targetLabel.toLowerCase();
    const targetNode = labelToNode.get(targetKey);

    if (!targetNode) {
      // Try suggestion
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
  }

  if (result.roots.length === 0 && result.tagGroups.length === 0 && !result.error) {
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
  warnFn?: (line: number, msg: string) => void,
): SitemapNode {
  const segments = trimmed.split('|').map((s) => s.trim());
  const rawLabel = segments[0];
  const { label, color } = extractColor(rawLabel, palette);
  const metadata = parsePipeMetadata(segments, aliasMap, warnFn ? () => warnFn(lineNumber, MULTIPLE_PIPE_WARNING) : undefined);

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
  result: ParsedSitemap,
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
    parent.children.push(node);
  } else {
    result.roots.push(node);
  }

  indentStack.push({ node, indent });
}

function findParentNode(
  indent: number,
  indentStack: { node: SitemapNode; indent: number }[],
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

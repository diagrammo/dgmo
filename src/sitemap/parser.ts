// ============================================================
// Sitemap Diagram Parser
// ============================================================

import type { PaletteColors } from '../palettes';
import { resolveColorWithDiagnostic } from '../colors';
import type { DgmoError } from '../diagnostics';
import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import { normalizeName } from '../utils/name-normalize';
import type { TagGroup } from '../utils/tag-groups';
import {
  isTagBlockHeading,
  matchTagBlockHeading,
  emitTagLegacyDiagnostic,
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
  tryParseSharedOption,
} from '../utils/parsing';
import type { SitemapNode, ParsedSitemap } from './types';
import { tryStripDescriptionKeyword } from '../utils/description-helpers';

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
  palette: PaletteColors | undefined,
  lineNumber: number,
  diagnostics: DgmoError[]
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
      ? resolveColorWithDiagnostic(
          arrowMatch[2].trim(),
          lineNumber,
          diagnostics,
          palette
        )
      : undefined;
    if (label && !color) {
      const inferred = inferArrowColor(label);
      if (inferred)
        color = resolveColorWithDiagnostic(
          inferred,
          lineNumber,
          diagnostics,
          palette
        );
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

  // metaAliasMap: tag-group metadata-key aliases (per A1 convention).
  const metaAliasMap = new Map<string, string>();
  // nameAliasMap: TD-18 entity-name aliases (`a` → `node-7`). Per C8.
  const nameAliasMap = new Map<string, string>();

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
      emitTagLegacyDiagnostic(tagBlockMatch, lineNumber, result.diagnostics);
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
        metaAliasMap.set(
          normalizeName(tagBlockMatch.alias),
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

      if (tryParseSharedOption(trimmed, result.options)) {
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
    const arrowInfo = parseArrowLine(
      trimmed,
      palette,
      lineNumber,
      result.diagnostics
    );
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
      // TD-18: peel optional `as <alias>` from container label.
      const rawLabel = containerMatch[1].trim();
      const asMatch = rawLabel.match(
        /^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/
      );
      const label = asMatch ? asMatch[1].trim() : rawLabel;

      // Parse optional pipe metadata on the container line
      const pipeStr = containerMatch[2];
      const containerMetadata: Record<string, string> = {};
      if (pipeStr) {
        // Build segments array compatible with parsePipeMetadata (first element is label, rest are pipe parts)
        const pipeSegments = ['', pipeStr];
        Object.assign(
          containerMetadata,
          parsePipeMetadata(pipeSegments, metaAliasMap)
        );
      }

      containerCounter++;
      const containerId = `container-${containerCounter}`;
      if (asMatch) nameAliasMap.set(asMatch[2], containerId);
      const node: SitemapNode = {
        id: containerId,
        label,
        metadata: containerMetadata,
        children: [],
        parentId: null,
        isContainer: true,
        lineNumber,
      };

      attachNode(node, indent, indentStack, result);
      // Register in labelToContainer for group-targeted arrows (-> [Group])
      const key = normalizeName(label);
      labelToContainer.set(key, node);
    } else if (metadataMatch && indentStack.length > 0) {
      // Metadata line — attach to parent
      const rawKey = metadataMatch[1].trim().toLowerCase();
      const key = metaAliasMap.get(rawKey) ?? rawKey;
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
          metaAliasMap,
          pushWarning,
          result.diagnostics,
          nameAliasMap
        );
        attachNode(node, indent, indentStack, result);
        const key = normalizeName(node.label);
        labelToNode.set(key, node);
      } else {
        pushError(lineNumber, 'Metadata has no parent node');
      }
    } else {
      // Check if this is a description line for a parent node
      const descResult = tryStripDescriptionKeyword(trimmed);
      if (descResult.isKeyword && indentStack.length > 0) {
        const parent = findParentNode(indent, indentStack);
        if (parent) {
          if (!parent.description) parent.description = [];
          parent.description.push(descResult.text.trim());
          continue;
        }
      }

      // Node label — possibly with pipe-delimited metadata
      const node = parseNodeLabel(
        trimmed,
        lineNumber,
        palette,
        ++nodeCounter,
        metaAliasMap,
        pushWarning,
        result.diagnostics,
        nameAliasMap
      );
      attachNode(node, indent, indentStack, result);
      const key = normalizeName(node.label);
      labelToNode.set(key, node);
    }
  }

  // --- Post-parse: resolve arrow targets ---
  for (const arrow of deferredArrows) {
    // TD-18: resolve alias literal first; if hit, use the bound id directly.
    const aliasHit = nameAliasMap.get(arrow.targetLabel.trim());
    if (aliasHit !== undefined) {
      result.edges.push({
        sourceId: arrow.sourceNode.id,
        targetId: aliasHit,
        label: arrow.label,
        color: arrow.color,
        lineNumber: arrow.lineNumber,
      });
      continue;
    }
    const targetKey = normalizeName(arrow.targetLabel);

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
    validateTagGroupNames(result.tagGroups, pushWarning, pushError);
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
  _palette: PaletteColors | undefined,
  counter: number,
  metaAliasMap: Map<string, string> = new Map(),
  warnFn?: (line: number, msg: string) => void,
  _diagnostics?: DgmoError[],
  nameAliasMap?: Map<string, string>
): SitemapNode {
  const segments = trimmed.split('|').map((s) => s.trim());
  // TD-18: peel optional `as <alias>` from the label slot.
  let label = segments[0];
  const asMatch = label.match(/^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/);
  const id = `node-${counter}`;
  if (asMatch) {
    label = asMatch[1].trim();
    nameAliasMap?.set(normalizeName(asMatch[2]), id);
  }
  const metadata = parsePipeMetadata(
    segments,
    metaAliasMap,
    warnFn ? () => warnFn(lineNumber, MULTIPLE_PIPE_ERROR) : undefined
  );

  // Extract description from pipe metadata into dedicated field
  let description: string[] | undefined;
  if ('description' in metadata) {
    const descVal = metadata['description'].trim();
    if (descVal) {
      description = [descVal];
    }
    delete metadata['description'];
  }

  return {
    id,
    label,
    metadata,
    description,
    children: [],
    parentId: null,
    isContainer: false,
    lineNumber,
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

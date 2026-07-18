// ============================================================
// Sitemap Diagram Parser
// ============================================================

import type { PaletteColors } from '../palettes';
import type { DgmoError } from '../diagnostics';
import {
  formatDgmoError,
  makeDgmoError,
  makeFail,
  suggest,
} from '../diagnostics';
import {
  SITEMAP_REGISTRY,
  withTagAliases,
} from '../utils/reserved-key-registry';
import { normalizeName } from '../utils/name-normalize';
import type { TagGroup } from '../utils/tag-groups';
import type { Writable } from '../utils/brand';
import {
  isTagBlockHeading,
  matchTagBlockHeading,
  validateTagValues,
  validateTagGroupNames,
  stripDefaultModifier,
  finalizeAutoTagColors,
  AUTO_TAG_COLOR_SENTINEL,
  tagAttrKey,
} from '../utils/tag-groups';
import {
  measureIndent,
  extractColor,
  splitNameAndMeta,
  parseFirstLine,
  OPTION_NOCOLON_RE,
  ALL_CHART_TYPES,
  tryParseSharedOption,
  warnUnknownMetaKeys,
} from '../utils/parsing';
import type { SitemapNode, ParsedSitemap } from './types';
import { tryStripDescriptionKeyword } from '../utils/description-helpers';

// ============================================================
// Regexes
// ============================================================

// Captures: [1]=name, [2]=trailing content (same-line `key: value` metadata).
const CONTAINER_RE = /^\[([^\]]+)\]\s*(.*)$/;
/** Metadata on content nodes: `key: value` (colon-separated, used in content phase) */
const METADATA_RE = /^([^:]+):\s*(.+)$/;

/**
 * Arrow line: `-label->` or `->` followed by target label.
 * Edges have no color slot (spec §1.7).
 * Captures: [1] label, [2] target
 */
const ARROW_RE = /^-([^>][^>]*?)?\s*->\s*(.+)$/;
const BARE_ARROW_RE = /^->\s*(.+)$/;

// ============================================================
// Helpers
// ============================================================

function parseArrowLine(
  trimmed: string,
  _palette: PaletteColors | undefined,
  _lineNumber: number,
  _diagnostics: DgmoError[]
): {
  label?: string;
  target: string;
  targetIsGroup: boolean;
} | null {
  // Bare arrow: -> Target
  const bareMatch = trimmed.match(BARE_ARROW_RE);
  if (bareMatch) {
    // Capture group 1 present by regex shape.
    const rawTarget = bareMatch[1]!.trim();
    const groupMatch = rawTarget.match(/^\[(.+)\]$/);
    return {
      target: groupMatch ? groupMatch[1]!.trim() : rawTarget,
      targetIsGroup: !!groupMatch,
    };
  }

  // Labeled arrow: -label-> Target
  const arrowMatch = trimmed.match(ARROW_RE);
  if (arrowMatch) {
    const label = arrowMatch[1]?.trim() || undefined;
    // Capture group 2 present by regex shape.
    const rawTarget = arrowMatch[2]!.trim();
    const groupMatch = rawTarget.match(/^\[(.+)\]$/);
    return {
      ...(label !== undefined && { label }),
      target: groupMatch ? groupMatch[1]!.trim() : rawTarget,
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
  const options: Record<string, string> = {};
  const result: Writable<ParsedSitemap> = {
    title: null,
    titleLineNumber: null,
    direction: 'LR',
    roots: [],
    edges: [],
    tagGroups: [],
    options,
    diagnostics: [],
    error: null,
  };

  const fail = makeFail(result);

  const pushError = (line: number, message: string): void => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    if (!result.error) result.error = formatDgmoError(diag);
  };

  const pushWarning = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  if (!content?.trim()) {
    return fail(0, 'No content provided');
  }

  const lines = content.split('\n');
  let contentStarted = false;
  let nodeCounter = 0;
  let containerCounter = 0;
  let firstLineParsed = false;

  // Tag group parsing state
  let currentTagGroup: Writable<TagGroup> | null = null;

  // metaAliasMap: tag-group metadata-key aliases (per A1 convention).
  const metaAliasMap = new Map<string, string>();
  // nameAliasMap: TD-18 entity-name aliases (`a` → `node-7`). Per C8.
  const nameAliasMap = new Map<string, string>();

  // Indent stack for hierarchy tracking
  const indentStack: { node: Writable<SitemapNode>; indent: number }[] = [];

  // Map label (lowercased) -> node for arrow target resolution
  const labelToNode = new Map<string, Writable<SitemapNode>>();

  // Map label (lowercased) -> container for group-targeted arrow resolution
  const labelToContainer = new Map<string, Writable<SitemapNode>>();

  // Deferred arrows: { sourceNode, arrow info, lineNumber }
  const deferredArrows: {
    sourceNode: Writable<SitemapNode>;
    targetLabel: string;
    targetIsGroup: boolean;
    label?: string;
    lineNumber: number;
  }[] = [];

  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const line = lines[i]!;
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
      const newTagGroup: Writable<TagGroup> = {
        name: tagBlockMatch.name,
        ...(tagBlockMatch.alias !== undefined && {
          alias: tagBlockMatch.alias,
        }),
        entries: [],
        lineNumber,
      };
      currentTagGroup = newTagGroup;
      if (tagBlockMatch.alias) {
        metaAliasMap.set(
          normalizeName(tagBlockMatch.alias),
          tagAttrKey(tagBlockMatch.name)
        );
      }
      metaAliasMap.set(
        normalizeName(tagBlockMatch.name),
        tagAttrKey(tagBlockMatch.name)
      );
      result.tagGroups.push(newTagGroup);
      continue;
    }

    // Generic header options (space-separated, before content/tag groups)
    // Skip lines with `|` (pipe metadata), `->` (arrows), or `:` (page
    // with same-line metadata per §1.4) — those are content, not options.
    if (
      !contentStarted &&
      !currentTagGroup &&
      measureIndent(line) === 0 &&
      !trimmed.includes('|') &&
      !trimmed.includes('->') &&
      !trimmed.includes(':')
    ) {
      // Bare booleans: direction-lr / direction-tb (§1.9, last one wins;
      // direction-lr restates the LR default)
      const dirBool = trimmed.match(/^direction-(lr|tb)$/i);
      if (dirBool) {
        result.direction = dirBool[1]!.toUpperCase() as 'LR' | 'TB';
        continue;
      }

      if (tryParseSharedOption(trimmed, options)) {
        continue;
      }

      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch) {
        // Capture groups 1 and 2 present by regex shape.
        const key = optMatch[1]!.trim().toLowerCase();
        options[key] = optMatch[2]!.trim();
        continue;
      }
    }

    // Tag group entries (indented `Value color` under tag heading; §1.5)
    // First entry is the default unless another is marked `default`
    if (currentTagGroup && !contentStarted) {
      const indent = measureIndent(line);
      if (indent > 0) {
        const { text: cleanEntry, isDefault } = stripDefaultModifier(trimmed);
        const { label, color } = extractColor(
          cleanEntry,
          palette,
          result.diagnostics,
          lineNumber
        );
        // Bare value (no explicit color) → keep it; finalized below.
        currentTagGroup.entries.push({
          value: label,
          color: color ?? AUTO_TAG_COLOR_SENTINEL,
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
        pushError(
          lineNumber,
          "Arrow '-> target' must be indented under its source page — no page precedes it."
        );
      } else {
        deferredArrows.push({
          sourceNode: source,
          targetLabel: arrowInfo.target,
          targetIsGroup: arrowInfo.targetIsGroup,
          ...(arrowInfo.label !== undefined && { label: arrowInfo.label }),
          lineNumber,
        });
      }
      continue;
    }

    // Check for container syntax: [Group Name]
    const containerMatch = trimmed.match(CONTAINER_RE);

    // Check for metadata syntax: `key: value` (the indented form
    // that attaches to the parent node, not a node line with same-line
    // metadata). Require the key region to be a single identifier so
    // `Checkout access: Public` parses as a node, not metadata for the
    // container.
    const metadataMatch = (() => {
      if (trimmed.includes('|')) return null;
      const m = trimmed.match(METADATA_RE);
      if (!m) return null;
      const keyRegion = m[1]!.trim();
      if (/\s/.test(keyRegion)) return null;
      return m;
    })();

    if (containerMatch) {
      // TD-18: peel optional `as <alias>` from container label.
      // Capture group 1 present by regex shape.
      const rawLabel = containerMatch[1]!.trim();
      const asMatch = rawLabel.match(
        /^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/
      );
      // Capture groups 1 and 2 present by regex shape.
      const label = asMatch ? asMatch[1]!.trim() : rawLabel;

      // Parse the tail after `]`: optional same-line metadata per §1.4.
      const tail = (containerMatch[2] ?? '').trim();
      const containerMetadata: Record<string, string> = {};
      if (tail.length > 0) {
        Object.assign(
          containerMetadata,
          parseSitemapMetaTail(tail, metaAliasMap)
        );
      }

      containerCounter++;
      const containerId = `container-${containerCounter}`;
      if (asMatch) nameAliasMap.set(asMatch[2]!, containerId);
      const node: Writable<SitemapNode> = {
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
      // Capture groups 1 and 2 present by regex shape.
      const rawKey = metadataMatch[1]!.trim().toLowerCase();
      const key = metaAliasMap.get(rawKey) ?? rawKey;
      const value = metadataMatch[2]!.trim();

      const parent = findParentNode(indent, indentStack);
      if (!parent) {
        pushError(
          lineNumber,
          "Metadata 'key: value' must be indented under a page — no page precedes it."
        );
      } else {
        parent.metadata = { ...parent.metadata, [key]: value };
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
        pushError(
          lineNumber,
          "Metadata 'key: value' must be indented under a page — no page precedes it."
        );
      }
    } else {
      // Check if this is a description line for a parent node
      const descResult = tryStripDescriptionKeyword(trimmed);
      if (
        descResult.isKeyword &&
        !descResult.needsColon &&
        indentStack.length > 0
      ) {
        const parent = findParentNode(indent, indentStack);
        if (parent) {
          parent.description = [
            ...(parent.description ?? []),
            descResult.text.trim(),
          ];
          continue;
        }
      }

      // §12: reject sub-pages nested under a page inside a container.
      const enclosingContainer = nestedPageInsideContainer(indent, indentStack);
      if (enclosingContainer) {
        pushError(
          lineNumber,
          `Pages inside container '[${enclosingContainer}]' cannot have indented sub-pages. Containers hold a flat list of pages.`
        );
        continue;
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
        ...(arrow.label !== undefined && { label: arrow.label }),
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
        ...(arrow.label !== undefined && { label: arrow.label }),
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
        ...(arrow.label !== undefined && { label: arrow.label }),
        lineNumber: arrow.lineNumber,
      });
    }
  }

  // Validate tag group values on all nodes
  // Assign palette colors to bare (colorless) tag values.
  finalizeAutoTagColors(result.tagGroups as Writable<TagGroup>[], palette);

  if (result.tagGroups.length > 0) {
    const allNodes: SitemapNode[] = [];
    const collectAll = (nodes: readonly SitemapNode[]) => {
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
): Writable<SitemapNode> {
  // §1.4 unified metadata grammar — same-line cut.
  const registry = withTagAliases(
    SITEMAP_REGISTRY,
    new Set(metaAliasMap.keys())
  );
  const id = `node-${counter}`;
  const split = splitNameAndMeta(
    trimmed,
    registry,
    metaAliasMap,
    undefined,
    _diagnostics,
    lineNumber
  );
  if (warnFn) {
    warnUnknownMetaKeys(
      split.meta,
      registry,
      (msg) => warnFn(lineNumber, msg),
      split.name
    );
  }
  const label = split.name;
  if (split.alias) nameAliasMap?.set(normalizeName(split.alias), id);
  const metadata: Record<string, string> = { ...split.meta };
  if (split.color !== undefined) metadata['color'] = split.color;

  // Extract description from pipe metadata into dedicated field
  let description: string[] | undefined;
  if ('description' in metadata) {
    const descVal = metadata['description']!.trim();
    if (descVal) {
      description = [descVal];
    }
    delete metadata['description'];
  }

  return {
    id,
    label,
    metadata,
    ...(description !== undefined && { description }),
    children: [],
    parentId: null,
    isContainer: false,
    lineNumber,
  };
}

/**
 * Parse a pure-metadata tail (`key: value, k2: v2`) following a
 * `[Container]` heading via the §1.4 grammar. Leads with the
 * always-reserved `color:` sentinel so the entire tail lands in the
 * metadata region regardless of whether the first key is reserved.
 */
function parseSitemapMetaTail(
  tail: string,
  metaAliasMap: Map<string, string>
): Record<string, string> {
  const trimmed = tail.trim();
  if (!trimmed?.includes(':')) return {};
  const registry = withTagAliases(
    SITEMAP_REGISTRY,
    new Set(metaAliasMap.keys())
  );
  const split = splitNameAndMeta(
    `color: __smph, ${trimmed}`,
    registry,
    metaAliasMap
  );
  const meta = split.meta;
  if (meta['color'] === '__smph') delete meta['color'];
  return meta;
}

function attachNode(
  node: Writable<SitemapNode>,
  indent: number,
  indentStack: { node: Writable<SitemapNode>; indent: number }[],
  result: Writable<ParsedSitemap>
): void {
  // Pop stack entries with indent >= current indent
  while (indentStack.length > 0) {
    // In-bounds by length check above.
    const top = indentStack[indentStack.length - 1]!;
    if (top.indent < indent) break;
    indentStack.pop();
  }

  if (indentStack.length > 0) {
    // In-bounds by length check above.
    const parent = indentStack[indentStack.length - 1]!.node;
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

/**
 * §12: containers hold a flat list of pages — a page inside a `[Container]`
 * may not have indented sub-pages. Returns the enclosing container's label
 * when attaching a page at `indent` would nest it under a page that itself
 * lives inside a container; otherwise null. Non-destructive (mirrors
 * `attachNode`'s pop logic without mutating the stack).
 */
function nestedPageInsideContainer(
  indent: number,
  indentStack: { node: Writable<SitemapNode>; indent: number }[]
): string | null {
  let idx = indentStack.length - 1;
  while (idx >= 0 && indentStack[idx]!.indent >= indent) idx--;
  if (idx < 0) return null;
  // Immediate parent. A container parent → flat member, allowed.
  if (indentStack[idx]!.node.isContainer) return null;
  // Parent is a page; flag only when an ancestor is a container.
  for (let k = idx - 1; k >= 0; k--) {
    if (indentStack[k]!.node.isContainer) return indentStack[k]!.node.label;
  }
  return null;
}

function findParentNode(
  indent: number,
  indentStack: { node: Writable<SitemapNode>; indent: number }[]
): Writable<SitemapNode> | null {
  for (let i = indentStack.length - 1; i >= 0; i--) {
    // In-bounds by loop guard.
    if (indentStack[i]!.indent < indent) {
      return indentStack[i]!.node;
    }
  }
  if (indentStack.length > 0) {
    // In-bounds by length check above.
    return indentStack[indentStack.length - 1]!.node;
  }
  return null;
}

import type { PaletteColors } from '../palettes';
import {
  formatDgmoError,
  makeDgmoError,
  makeFail,
  suggest,
} from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';
import type { Writable } from '../utils/brand';
import {
  matchTagBlockHeading,
  validateTagValues,
  validateTagGroupNames,
  stripDefaultModifier,
  finalizeAutoTagColors,
  cascadeTagMetadata,
  AUTO_TAG_COLOR_SENTINEL,
  tagAttrKey,
} from '../utils/tag-groups';
import {
  measureIndent,
  peelTrailingCollapsedFlag,
  extractColor,
  parseFirstLine,
  OPTION_NOCOLON_RE,
  splitNameAndMeta,
  tryParseSharedOption,
  warnUnknownMetaKeys,
} from '../utils/parsing';
import {
  MINDMAP_REGISTRY,
  withTagAliases,
} from '../utils/reserved-key-registry';
import type { MindmapNode, ParsedMindmap } from './types';
import { tryStripDescriptionKeyword } from '../utils/description-helpers';

// ============================================================
// Constants
// ============================================================

/** Known mindmap options (key-value). */
const KNOWN_OPTIONS = new Set(['active-tag']);

// ============================================================
// Parser
// ============================================================

export function parseMindmap(
  content: string,
  palette?: PaletteColors
): ParsedMindmap {
  const options: Record<string, string> = {};
  const result: Writable<ParsedMindmap> = {
    title: null,
    titleLineNumber: null,
    roots: [],
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

  // Tag group parsing state
  let currentTagGroup: Writable<TagGroup> | null = null;
  const aliasMap = new Map<string, string>();

  // Indent stack for hierarchy tracking
  const indentStack: { node: Writable<MindmapNode>; indent: number }[] = [];

  // Track which nodes have had a child added (for late-description warnings)
  const nodesWithChildren = new Set<string>();

  // Title-derived root node (if title exists on first line)
  let titleRoot: Writable<MindmapNode> | null = null;

  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard (i < lines.length).
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

    if (!contentStarted) {
      // Extract chart type + title from first line
      const firstLine = parseFirstLine(trimmed);
      if (firstLine) {
        if (firstLine.chartType !== 'mindmap') {
          let msg = `Expected chart type "mindmap", got "${firstLine.chartType}"`;
          const hint = suggest(firstLine.chartType, ['mindmap']);
          if (hint) msg += `. ${hint}`;
          return fail(lineNumber, msg);
        }
        if (firstLine.title) {
          // Title IS the root
          const label = firstLine.title;
          result.title = label;
          result.titleLineNumber = lineNumber;

          nodeCounter++;
          const titleMetadata: Record<string, string> = {};
          titleRoot = {
            id: `node-${nodeCounter}`,
            label,
            metadata: titleMetadata,
            children: [],
            parentId: null,
            lineNumber,
          };
          result.roots.push(titleRoot);
          // Push title root onto indent stack at indent -1 so all indent-0 lines become children
          indentStack.push({ node: titleRoot, indent: -1 });
        }
        continue;
      }
    }

    // Tag group heading
    const tagBlockMatch = matchTagBlockHeading(trimmed);
    if (tagBlockMatch) {
      if (contentStarted) {
        pushError(lineNumber, 'Tag groups must appear before mindmap content');
        continue;
      }
      currentTagGroup = {
        name: tagBlockMatch.name,
        ...(tagBlockMatch.alias !== undefined && {
          alias: tagBlockMatch.alias,
        }),
        entries: [],
        lineNumber,
      };
      if (tagBlockMatch.alias) {
        aliasMap.set(
          tagBlockMatch.alias.toLowerCase(),
          tagAttrKey(tagBlockMatch.name)
        );
      }
      aliasMap.set(
        tagAttrKey(tagBlockMatch.name),
        tagAttrKey(tagBlockMatch.name)
      );
      result.tagGroups.push(currentTagGroup);
      continue;
    }

    // Options: key-value (e.g., `active-tag Priority`)
    if (!contentStarted && !currentTagGroup && measureIndent(line) === 0) {
      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch) {
        // Capture groups [1] and [2] are guaranteed by OPTION_NOCOLON_RE shape.
        const key = optMatch[1]!.trim().toLowerCase();
        if (KNOWN_OPTIONS.has(key)) {
          options[key] = optMatch[2]!.trim();
          continue;
        }
      }
      const lower = trimmed.toLowerCase();
      if (lower === 'no-descriptions') {
        pushWarning(
          lineNumber,
          '"no-descriptions" has been removed — delete description lines from your source instead.'
        );
        continue;
      }
      // Bare flag: colour nodes by depth instead of by tag (off by default).
      // View-state directive written by the app's Color-by-depth toggle.
      if (lower === 'color-by-depth') {
        options['color-by-depth'] = 'on';
        continue;
      }
      if (tryParseSharedOption(trimmed, options)) {
        continue;
      }
    }

    // Tag group entries (indented Value color under tag heading)
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
        if (isDefault) {
          currentTagGroup.defaultValue = label;
        } else if (currentTagGroup.entries.length === 0) {
          currentTagGroup.defaultValue = label;
        }
        currentTagGroup.entries.push({
          value: label,
          color: color ?? AUTO_TAG_COLOR_SENTINEL,
          lineNumber,
        });
        continue;
      }
      currentTagGroup = null; // eslint-disable-line no-useless-assignment
    }

    // --- Content phase ---
    contentStarted = true;
    currentTagGroup = null;

    const indent = measureIndent(line);

    // Check for indented `description: text` metadata
    if (indent > 0) {
      const descResult = tryStripDescriptionKeyword(trimmed);
      if (descResult.isKeyword && !descResult.needsColon) {
        // Find parent node from indent stack
        const parent = findMetadataParent(indent, indentStack);
        if (parent) {
          const descValue = descResult.text.trim();
          if (!descValue) {
            // Empty description: silently skip
            continue;
          }
          // Check if parent already has children at this indent level
          if (nodesWithChildren.has(parent.id)) {
            pushWarning(
              lineNumber,
              `description after child nodes under "${parent.label}" — should precede children`
            );
            continue;
          }
          const existing: string[] = parent.description
            ? [...parent.description]
            : [];
          existing.push(descValue);
          parent.description = existing;
          continue;
        }
      }
    }

    // It's a node line — possibly with same-line metadata
    const node = parseNodeLine(
      trimmed,
      lineNumber,
      palette,
      ++nodeCounter,
      aliasMap,
      result.diagnostics
    );
    attachNode(node, indent, indentStack, result, nodesWithChildren);
  }

  // If no title and roots exist, infer title from first root
  if (result.title === null && result.roots.length > 0) {
    // In-bounds: roots.length > 0 from the condition above.
    result.title = result.roots[0]!.label;
    result.titleLineNumber = result.roots[0]!.lineNumber;
  }

  // Validate tag group values
  // Assign palette colors to bare (colorless) tag values.
  finalizeAutoTagColors(result.tagGroups as Writable<TagGroup>[], palette);

  if (result.tagGroups.length > 0) {
    const allNodes: MindmapNode[] = [];
    const collectAll = (nodes: readonly MindmapNode[]) => {
      for (const node of nodes) {
        allNodes.push(node);
        collectAll(node.children);
      }
    };
    collectAll(result.roots);
    validateTagValues(allNodes, result.tagGroups, pushWarning, suggest);
    validateTagGroupNames(result.tagGroups, pushWarning);

    // Cascade explicit tag values down the tree so sub-nodes inherit a tagged
    // ancestor's value (overridable per-node). Runs after validation (so we
    // don't double-warn on inherited values) and before the layout's
    // global-default injection (so an inherited value wins over the default).
    cascadeTagMetadata(result.roots, result.tagGroups);
  }

  // Check for empty mindmap
  if (result.roots.length === 0 && !result.error) {
    const diag = makeDgmoError(1, 'No nodes found in mindmap');
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
  } else if (
    titleRoot?.children.length === 0 &&
    result.roots.length === 1 &&
    !result.error
  ) {
    // Title-only mindmap with no children is valid (single node)
    // No error needed
  }

  return result;
}

// ============================================================
// Internal helpers
// ============================================================

function parseNodeLine(
  trimmed: string,
  lineNumber: number,
  _palette: PaletteColors | undefined,
  counter: number,
  aliasMap: Map<string, string>,
  diagnostics: ReturnType<typeof makeDgmoError>[]
): Writable<MindmapNode> {
  // Canonical bare `collapsed` trailing flag (§1.8, decision #48) — peeled
  // from the end of the node line before the metadata split, so
  // `Research collapsed` and `Research blue collapsed` fold the subtree.
  // Case-sensitive lowercase (`Research Collapsed` stays a plain label), and
  // never empties the label: a lone `collapsed` line remains a node name,
  // mirroring the trailing-color never-empty rule.
  let bareCollapsed = false;
  let nodeText = trimmed;
  {
    const barePeel = peelTrailingCollapsedFlag(nodeText);
    if (barePeel.collapsed && barePeel.rest) {
      bareCollapsed = true;
      nodeText = barePeel.rest;
    }
  }

  // §1.4 unified metadata grammar — build registry with active tag aliases.
  const registry = withTagAliases(MINDMAP_REGISTRY, new Set(aliasMap.keys()));
  const split = splitNameAndMeta(
    nodeText,
    registry,
    aliasMap,
    undefined,
    diagnostics,
    lineNumber
  );
  warnUnknownMetaKeys(
    split.meta,
    registry,
    (msg) => diagnostics.push(makeDgmoError(lineNumber, msg, 'warning')),
    split.name
  );
  const label = split.name;
  const metadata: Record<string, string> = { ...split.meta };
  if (split.color !== undefined) metadata['color'] = split.color;

  let description: string[] | undefined;
  if ('description' in metadata) {
    const descVal = metadata['description'].trim();
    if (descVal) description = [descVal];
    delete metadata['description'];
  }

  // Legacy `collapsed: true` metadata form (canonical is the bare trailing
  // flag peeled above).
  let collapsed: boolean | undefined = bareCollapsed ? true : undefined;
  if ('collapsed' in metadata) {
    collapsed = collapsed || metadata['collapsed'].toLowerCase() === 'true';
    delete metadata['collapsed'];
  }

  return {
    id: `node-${counter}`,
    label,
    ...(description !== undefined && { description }),
    metadata,
    children: [],
    parentId: null,
    lineNumber,
    ...(collapsed !== undefined && { collapsed }),
  };
}

function attachNode(
  node: Writable<MindmapNode>,
  indent: number,
  indentStack: { node: Writable<MindmapNode>; indent: number }[],
  result: Writable<ParsedMindmap>,
  nodesWithChildren: Set<string>
): void {
  // Pop stack entries with indent >= current indent
  while (indentStack.length > 0) {
    // In-bounds: indentStack.length > 0 from loop guard.
    const top = indentStack[indentStack.length - 1]!;
    if (top.indent < indent) break;
    indentStack.pop();
  }

  if (indentStack.length > 0) {
    // In-bounds: indentStack.length > 0 from condition above.
    const parent = indentStack[indentStack.length - 1]!.node;
    node.parentId = parent.id;
    parent.children.push(node);
    nodesWithChildren.add(parent.id);
  } else {
    result.roots.push(node);
  }

  indentStack.push({ node, indent });
}

function findMetadataParent(
  indent: number,
  indentStack: { node: Writable<MindmapNode>; indent: number }[]
): Writable<MindmapNode> | null {
  for (let i = indentStack.length - 1; i >= 0; i--) {
    // In-bounds by loop guard (i in [0, indentStack.length)).
    const entry = indentStack[i]!;
    if (entry.indent < indent) {
      return entry.node;
    }
  }
  if (indentStack.length > 0) {
    // In-bounds: indentStack.length > 0 from condition above.
    return indentStack[indentStack.length - 1]!.node;
  }
  return null;
}

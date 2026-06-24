// ============================================================
// Treemap — Parser
// ============================================================
//
// Structure mirrors the mindmap parser (indent-stack hierarchy + §1.4 unified
// metadata via splitNameAndMeta). Treemap-specific bits:
//   - node SIZE is the bare trailing number on a leaf (§1.5 funnel/sankey idiom);
//     parents auto-sum, so a trailing number on a branch is ignored with a warn.
//   - `heat:` per-node metric + `heat <Label> [low] [high]` ramp directive.
//   - `depth N`, `no-values|no-percent|no-headers|no-legend`.

import type { PaletteColors } from '../palettes';
import {
  dataCommaRemovedMessage,
  formatDgmoError,
  makeDgmoError,
  makeFail,
  pipeOperatorRemovedMessage,
  suggest,
  METADATA_DIAGNOSTIC_CODES,
} from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import type { Writable } from '../utils/brand';
import type { TagGroup } from '../utils/tag-groups';
import {
  matchTagBlockHeading,
  emitTagLegacyDiagnostic,
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
  extractColor,
  parseFirstLine,
  peelRampColors,
  stripQuotes,
  splitNameAndMeta,
  warnUnknownMetaKeys,
} from '../utils/parsing';
import {
  TREEMAP_REGISTRY,
  withTagAliases,
} from '../utils/reserved-key-registry';
import type {
  ParsedTreemap,
  TreemapNode,
  TreemapOptions,
  TreemapColorMode,
} from './types';

// Diagnostic codes specific to the treemap value model.
export const TREEMAP_DIAGNOSTIC_CODES = {
  NEGATIVE_VALUE: 'E_TREEMAP_NEGATIVE_VALUE',
  LEAF_NO_VALUE: 'W_TREEMAP_LEAF_NO_VALUE',
  BRANCH_VALUE_IGNORED: 'W_TREEMAP_BRANCH_VALUE_IGNORED',
} as const;

/** A bare numeric token: optional sign, digits with `_`/`,`/`.` separators. */
const VALUE_TOKEN_RE = /^(.+?)\s+(-?\d[\d_,.]*)$/;

/** True when `s` is wrapped in a matching pair of single or double quotes. */
function isFullyQuoted(s: string): boolean {
  return (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'")))
  );
}

export function parseTreemap(
  content: string,
  palette?: PaletteColors
): ParsedTreemap {
  const options: TreemapOptions = {
    heatColors: [],
    noValues: false,
    noPercent: false,
    noHeaders: false,
    noLegend: false,
  };
  const result: Writable<ParsedTreemap> = {
    type: 'treemap',
    title: null,
    titleLineNumber: null,
    roots: [],
    tagGroups: [],
    hasHeat: false,
    defaultColorMode: 'branch',
    options,
    diagnostics: [],
    error: null,
  };

  const fail = makeFail(result);
  const pushError = (line: number, message: string, code?: string): void => {
    const diag = makeDgmoError(line, message, 'error', code);
    result.diagnostics.push(diag);
    if (!result.error) result.error = formatDgmoError(diag);
  };
  const pushWarning = (line: number, message: string, code?: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning', code));
  };

  if (!content?.trim()) {
    return fail(0, 'No content provided');
  }

  const lines = content.split('\n');
  let contentStarted = false;
  let nodeCounter = 0;

  let currentTagGroup: Writable<TagGroup> | null = null;
  const aliasMap = new Map<string, string>();

  // Indent stack for hierarchy tracking.
  const indentStack: { node: Writable<TreemapNode>; indent: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNumber = i + 1;
    const trimmed = line.trim();

    if (!trimmed) {
      currentTagGroup = null;
      continue;
    }
    if (trimmed.startsWith('//')) continue;

    // --- Header phase: first line declares `treemap [Title]` ---
    if (!contentStarted) {
      const firstLine = parseFirstLine(trimmed);
      if (firstLine && result.titleLineNumber === null && i === 0) {
        if (firstLine.chartType !== 'treemap') {
          let msg = `Expected chart type "treemap", got "${firstLine.chartType}"`;
          const hint = suggest(firstLine.chartType, ['treemap']);
          if (hint) msg += `. ${hint}`;
          return fail(lineNumber, msg);
        }
        result.title = firstLine.title ?? null;
        result.titleLineNumber = lineNumber;
        continue;
      }
    }

    // Tag group heading: `tag Team as t`
    const tagBlockMatch = matchTagBlockHeading(trimmed);
    if (tagBlockMatch) {
      emitTagLegacyDiagnostic(tagBlockMatch, lineNumber, result.diagnostics);
      if (contentStarted) {
        pushError(
          lineNumber,
          'Tag groups must appear before treemap content',
          'E_TAG_DECLARED_AFTER_CONTENT'
        );
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
      // Register BOTH the alias and the canonical tag name in the alias map so
      // `t:` and `Team:` both dispatch as the same tag metadata key.
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

    // Tag group entries (indented `Value color` under a tag heading).
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
      currentTagGroup = null;
    }

    // Directives (header phase only, indent 0).
    if (!contentStarted && measureIndent(line) === 0) {
      if (handleDirective(trimmed, options, result, pushWarning, lineNumber)) {
        continue;
      }
    }

    // --- Content phase ---
    contentStarted = true;
    currentTagGroup = null;

    const indent = measureIndent(line);
    const node = parseNodeLine(
      trimmed,
      lineNumber,
      ++nodeCounter,
      aliasMap,
      result.diagnostics,
      pushWarning
    );
    if (node.heat !== undefined) result.hasHeat = true;
    attachNode(node, indent, indentStack, result);
  }

  // Finalize auto tag colors before any color resolution.
  finalizeAutoTagColors(result.tagGroups as Writable<TagGroup>[], palette);

  // Value resolution post-pass: branch vs leaf is only known once the whole
  // tree is built (a node is a branch iff it has children).
  const allNodes: TreemapNode[] = [];
  const collectAll = (nodes: readonly TreemapNode[]): void => {
    for (const n of nodes) {
      allNodes.push(n);
      collectAll(n.children);
    }
  };
  collectAll(result.roots);

  for (const n of allNodes) {
    const node = n as Writable<TreemapNode>;
    const isBranch = node.children.length > 0;
    if (isBranch) {
      if (node.value !== undefined) {
        pushWarning(
          node.lineNumber,
          `"${node.label}" is a branch — its trailing number is ignored; the area is the auto-sum of its children`,
          TREEMAP_DIAGNOSTIC_CODES.BRANCH_VALUE_IGNORED
        );
        delete node.value;
      }
    } else if (node.value === undefined) {
      pushWarning(
        node.lineNumber,
        `Leaf "${node.label}" has no value — it renders with zero area`,
        TREEMAP_DIAGNOSTIC_CODES.LEAF_NO_VALUE
      );
      node.value = 0;
    } else if (node.value < 0) {
      pushError(
        node.lineNumber,
        `Leaf "${node.label}" has a negative value (${node.value}) — treemap sizes must be ≥ 0`,
        TREEMAP_DIAGNOSTIC_CODES.NEGATIVE_VALUE
      );
    }
  }

  if (result.hasHeat || options.heatLabel !== undefined) {
    result.hasHeat = true;
  }

  // Tag validation + inheritance (mirrors mindmap).
  if (result.tagGroups.length > 0) {
    validateTagValues(allNodes, result.tagGroups, pushWarning, suggest);
    validateTagGroupNames(result.tagGroups, pushWarning);
    cascadeTagMetadata(result.roots, result.tagGroups);
  }

  // Resolve the source-declared default color mode: tag > heat > branch.
  result.defaultColorMode = resolveDefaultColorMode(result);

  if (result.roots.length === 0 && !result.error) {
    const diag = makeDgmoError(1, 'No nodes found in treemap');
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
  }

  return result;
}

// ============================================================
// Directives
// ============================================================

function handleDirective(
  trimmed: string,
  options: Writable<TreemapOptions>,
  result: Writable<ParsedTreemap>,
  pushWarning: (line: number, message: string) => void,
  lineNumber: number
): boolean {
  const depthMatch = trimmed.match(/^depth\s+(-?\d+)\s*$/i);
  if (depthMatch) {
    const n = parseInt(depthMatch[1]!, 10);
    if (n >= 1) options.maxDepth = n;
    else pushWarning(lineNumber, '"depth" must be ≥ 1 — ignored');
    return true;
  }

  // `other-below` (small-leaf rollup into an "Other" bucket) was removed.
  // Still recognise the line so it doesn't fall through to node parsing (which
  // would render a junk "other-below" cell), but ignore it with a hint.
  if (/^other-below\b/i.test(trimmed)) {
    pushWarning(
      lineNumber,
      '"other-below" is no longer supported — remove this line'
    );
    return true;
  }

  // heat <Label> [low] [high] — names + (optionally) colors the value ramp.
  const heatMatch = trimmed.match(/^heat\s+(.+)$/i);
  if (heatMatch) {
    const { label, low, high } = peelRampColors(heatMatch[1]!.trim());
    options.heatLabel = label || 'Value';
    const colors: string[] = [];
    if (low !== undefined) colors.push(low);
    if (high !== undefined) colors.push(high);
    options.heatColors = colors;
    result.hasHeat = true;
    return true;
  }

  const noMatch = trimmed.match(/^no-(values|percent|headers|legend)\s*$/i);
  if (noMatch) {
    const key = noMatch[1]!.toLowerCase();
    if (key === 'values') options.noValues = true;
    else if (key === 'percent') options.noPercent = true;
    else if (key === 'headers') options.noHeaders = true;
    else if (key === 'legend') options.noLegend = true;
    return true;
  }

  return false;
}

function resolveDefaultColorMode(result: ParsedTreemap): TreemapColorMode {
  if (result.tagGroups.length > 0) return 'tag';
  if (result.hasHeat) return 'heat';
  return 'branch';
}

// ============================================================
// Node lines
// ============================================================

function parseNodeLine(
  trimmed: string,
  lineNumber: number,
  counter: number,
  aliasMap: Map<string, string>,
  diagnostics: DgmoError[],
  pushWarning: (line: number, message: string, code?: string) => void
): Writable<TreemapNode> {
  // Legacy pipe-metadata is removed language-wide.
  if (trimmed.includes('|')) {
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        pipeOperatorRemovedMessage(),
        'error',
        METADATA_DIAGNOSTIC_CODES.PIPE_OPERATOR_REMOVED
      )
    );
  }

  const registry = withTagAliases(TREEMAP_REGISTRY, new Set(aliasMap.keys()));
  const split = splitNameAndMeta(
    trimmed,
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

  const metadata: Record<string, string> = { ...split.meta };

  // Heat metric (optional second numeric).
  let heat: number | undefined;
  if ('heat' in metadata) {
    const h = parseFloat(metadata['heat']!.replace(/_/g, ''));
    if (Number.isFinite(h)) heat = h;
    delete metadata['heat'];
  }

  // Value resolution: a fully-quoted name preserves trailing digits (no value
  // peel); otherwise peel a bare trailing number as the leaf size. A quoted
  // label may itself carry a value (`"Region 5" 100`) — peel the value first,
  // then strip the quotes from the remaining label.
  const rawName = split.name;
  let label: string;
  let value: number | undefined;

  if (isFullyQuoted(rawName)) {
    label = stripQuotes(rawName);
  } else {
    const vm = rawName.match(VALUE_TOKEN_RE);
    if (vm) {
      const labelPart = vm[1]!.trim();
      const token = vm[2]!;
      if (token.includes(',')) {
        pushWarning(lineNumber, dataCommaRemovedMessage(labelPart));
      }
      const cleaned = token.replace(/[_,]/g, '');
      const parsed = parseFloat(cleaned);
      if (Number.isFinite(parsed)) {
        value = parsed;
        label = isFullyQuoted(labelPart) ? stripQuotes(labelPart) : labelPart;
      } else {
        label = rawName;
      }
    } else {
      label = rawName;
    }
  }

  return {
    id: `treemap-node-${counter}`,
    label,
    ...(value !== undefined && { value }),
    ...(heat !== undefined && { heat }),
    metadata,
    children: [],
    lineNumber,
  };
}

function attachNode(
  node: Writable<TreemapNode>,
  indent: number,
  indentStack: { node: Writable<TreemapNode>; indent: number }[],
  result: Writable<ParsedTreemap>
): void {
  while (indentStack.length > 0) {
    const top = indentStack[indentStack.length - 1]!;
    if (top.indent < indent) break;
    indentStack.pop();
  }

  if (indentStack.length > 0) {
    const parent = indentStack[indentStack.length - 1]!.node;
    parent.children.push(node);
  } else {
    result.roots.push(node);
  }

  indentStack.push({ node, indent });
}

// ============================================================
// Cycle Diagram — Parser
// ============================================================

import { makeDgmoError, makeFail } from '../diagnostics';
import {
  parseChartFrameLine,
  takeFootnoteBlock,
} from '../utils/chart-frame-parse';
import { extractPaletteDirective } from '../palettes/directive';
import type { PaletteColors } from '../palettes';
import type { TagGroup } from '../utils/tag-groups';
import {
  matchTagBlockHeading,
  validateTagValues,
  validateTagGroupNames,
  stripDefaultModifier,
  finalizeAutoTagColors,
  injectDefaultTagMetadata,
  activeTagNoMatchMessage,
  AUTO_TAG_COLOR_SENTINEL,
  tagAttrKey,
} from '../utils/tag-groups';
import { suggest } from '../diagnostics';
import {
  extractColor,
  measureIndent,
  parseFirstLine,
  splitNameAndMeta,
  tryParseSharedOption,
  warnUnknownMetaKeys,
} from '../utils/parsing';
import { CYCLE_REGISTRY, withTagAliases } from '../utils/reserved-key-registry';
import type { Writable } from '../utils/brand';
import type { ParsedCycle, CycleNode, CycleEdge } from './types';

// ── Edge pattern: `->`, `-label->` with optional target tail ──
// Bare: `-> [Target] [meta]`
const BARE_EDGE_RE = /^->\s*(.*)?$/;
// Labeled: `-Label-> [Target] [meta]`
const LABELED_EDGE_RE = /^-(.+?)->\s*(.*)?$/;
// `center PDCA` / `center "PDCA"` (lowercase keyword, text required)
const CENTER_RE = /^center\s+(.+)$/;
// `active-tag Type` / `active-tag none` (lowercase keyword, group required)
const ACTIVE_TAG_RE = /^active-tag\s+(.+)$/;
// `tag Type as t` — lowercase keyword only, so a step called "Tag assets"
// stays a step (same reason `center` is lowercase-only).
const TAG_KEYWORD_RE = /^tag\s/;

/**
 * Parse a `.dgmo` cycle diagram document.
 *
 * Syntax (§1.4 unified metadata grammar):
 * ```
 * cycle Title
 *
 * direction-counterclockwise
 * center PDCA
 * autonumber
 *
 * tag Phase as p            (optional, before the first step)
 *   Plan blue
 *   Do green
 *
 * NodeLabel p: Plan, span: 3
 *   Description line (indented under node)
 *   -Label-> color: red, width: 6
 *     Edge description (indented under edge)
 *   -Rework-> OtherStep color: red   (back edge, #2342)
 * ```
 */
export function parseCycle(
  content: string,
  palette?: PaletteColors
): ParsedCycle {
  const options: Record<string, string> = {};
  const result: Writable<ParsedCycle> = {
    type: 'cycle',
    title: '',
    titleLineNumber: 0,
    nodes: [],
    edges: [],
    tagGroups: [],
    direction: 'clockwise',
    options,
    diagnostics: [],
    error: null,
  };

  // The `palette` line is every chart type's (src/palettes/directive.ts).
  // The app preview calls this parser on raw source, so lift it here too
  // (#1469); lifting is idempotent, so the palette warnings are raised once.
  const directive = extractPaletteDirective(content);
  result.diagnostics.push(...directive.diagnostics);
  const lines = directive.content.split('\n');
  // The footnote block and its markdown body (#2093), before any line is read.
  takeFootnoteBlock(result, lines, result.diagnostics);
  let headerParsed = false;

  // Tag groups (§1.3): declared before the first step, like every tag chart.
  let contentStarted = false;
  let currentTagGroup: Writable<TagGroup> | null = null;
  let activeTagLine = 0;
  const aliasMap = new Map<string, string>();

  // State machine
  type State = 'top' | 'node' | 'edge';
  let state: State = 'top';
  let currentNode: Writable<CycleNode> | null = null;
  let currentEdge: Writable<CycleEdge> | null = null;
  // nodeBaseIndent tracking removed — indent-based nesting not used in cycle

  const fail = makeFail(result);

  const warn = (
    line: number,
    message: string,
    severity: 'warning' | 'error' = 'warning'
  ): void => {
    result.diagnostics.push(makeDgmoError(line, message, severity));
  };

  function addTagEntry(
    group: Writable<TagGroup>,
    rawEntry: string,
    lineNumber: number
  ): void {
    const { text, isDefault } = stripDefaultModifier(rawEntry);
    const { label, color } = extractColor(
      text,
      palette,
      result.diagnostics,
      lineNumber
    );
    // The first value is the implicit default unless another is marked.
    if (isDefault || group.entries.length === 0) group.defaultValue = label;
    group.entries.push({
      value: label,
      color: color ?? AUTO_TAG_COLOR_SENTINEL,
      lineNumber,
    });
  }

  function flushEdge(): void {
    if (currentEdge) {
      result.edges.push(currentEdge);
      currentEdge = null;
    }
  }

  function flushNode(): void {
    flushEdge();
    if (currentNode) {
      result.nodes.push(currentNode);
      currentNode = null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    // In-bounds by loop guard.
    const raw = lines[i]!;
    const trimmed = raw.trim();

    // Skip blanks and comments
    if (!trimmed) {
      currentTagGroup = null;
      continue;
    }
    if (trimmed.startsWith('//')) continue;

    const indent = measureIndent(raw);

    // ── First line: chart type declaration ──
    if (!headerParsed) {
      const firstLineResult = parseFirstLine(trimmed);
      if (firstLineResult?.chartType === 'cycle') {
        result.title = firstLineResult.title ?? '';
        result.titleLineNumber = lineNum;
        headerParsed = true;
        continue;
      }
      return fail(lineNum, 'Expected "cycle [Title]" as the first line.');
    }

    // Chart frame: subtitle, source, footnote, byline (#1827), column 1.
    // A column-1 line closes the open node, as a node declaration would.
    if (parseChartFrameLine(result, raw, lineNum, result.diagnostics)) {
      flushNode();
      continue;
    }

    // ── Tag group heading: `tag Type as t` (before the first step) ──
    const tagBlockMatch =
      indent === 0 && TAG_KEYWORD_RE.test(trimmed)
        ? matchTagBlockHeading(trimmed)
        : null;
    if (tagBlockMatch) {
      if (contentStarted) {
        result.diagnostics.push(
          makeDgmoError(
            lineNum,
            'Tag groups must appear before cycle content',
            'error',
            'E_TAG_DECLARED_AFTER_CONTENT'
          )
        );
        continue;
      }
      const group: Writable<TagGroup> = {
        name: tagBlockMatch.name,
        ...(tagBlockMatch.alias !== undefined && {
          alias: tagBlockMatch.alias,
        }),
        entries: [],
        lineNumber: lineNum,
      };
      if (tagBlockMatch.alias) {
        aliasMap.set(tagBlockMatch.alias.toLowerCase(), tagAttrKey(group.name));
      }
      aliasMap.set(tagAttrKey(group.name), tagAttrKey(group.name));
      for (const rawVal of tagBlockMatch.inlineValues ?? []) {
        addTagEntry(group, rawVal, lineNum);
      }
      currentTagGroup = group;
      result.tagGroups.push(group);
      continue;
    }

    // ── Tag entries: indented `Value [color]` under a heading ──
    if (currentTagGroup && !contentStarted && indent > 0) {
      addTagEntry(currentTagGroup, trimmed, lineNum);
      continue;
    }
    if (indent === 0) currentTagGroup = null;

    // ── Directive: active-tag <Group> ──
    const activeTagMatch = indent === 0 ? trimmed.match(ACTIVE_TAG_RE) : null;
    if (activeTagMatch) {
      options['active-tag'] = activeTagMatch[1]!.trim();
      activeTagLine = lineNum;
      continue;
    }

    // ── Directive: direction-counterclockwise ──
    if (indent === 0 && trimmed === 'direction-counterclockwise') {
      result.direction = 'counterclockwise';
      continue;
    }

    if (indent === 0 && trimmed.toLowerCase() === 'no-descriptions') {
      warn(
        lineNum,
        '"no-descriptions" has been removed — delete description lines from your source instead.'
      );
      continue;
    }

    // ── Bare keyword: circle-nodes ──
    if (indent === 0 && trimmed.toLowerCase() === 'circle-nodes') {
      options['circle-nodes'] = 'true';
      continue;
    }

    // ── Bare keyword: autonumber (step numbers on the nodes) ──
    if (indent === 0 && trimmed.toLowerCase() === 'autonumber') {
      options['autonumber'] = 'on';
      continue;
    }

    // ── `center TEXT` — text in the middle of the ring ──
    // Lowercase only, so a step called "Center ..." stays a step. Quotes
    // around the text are optional.
    const centerMatch = indent === 0 ? trimmed.match(CENTER_RE) : null;
    if (centerMatch) {
      const text = centerMatch[1]!
        .trim()
        .replace(/^"(.*)"$/, '$1')
        .trim();
      if (text) options['center'] = text;
      else warn(lineNum, 'center needs text — write: center PDCA');
      continue;
    }

    // ── Shared bare keyword: solid-fill ──
    if (indent === 0 && tryParseSharedOption(trimmed, options)) {
      continue;
    }

    // ── Top-level line (indent === 0): must be a node declaration ──
    if (indent === 0) {
      flushNode();
      contentStarted = true;

      // Validate: node labels cannot contain -> or <-
      if (trimmed.includes('->') || trimmed.includes('<-')) {
        warn(
          lineNum,
          'Node labels cannot contain "->". Use indented lines for edges.',
          'error'
        );
        continue;
      }

      // §1.4 unified metadata grammar — same-line cut.
      const nodeRegistry = withTagAliases(
        CYCLE_REGISTRY,
        new Set(aliasMap.keys())
      );
      const split = splitNameAndMeta(
        trimmed,
        nodeRegistry,
        aliasMap,
        undefined,
        result.diagnostics,
        lineNum
      );
      warnUnknownMetaKeys(
        split.meta,
        nodeRegistry,
        (msg) => warn(lineNum, msg),
        split.name
      );
      const label = split.name;
      const metadata: Record<string, string> = { ...split.meta };
      if (split.color !== undefined) metadata['color'] = split.color;

      if (!label) {
        warn(lineNum, 'Empty node label.');
        continue;
      }

      // Extract known keys from metadata
      const color = metadata['color'];
      const spanStr = metadata['span'];
      let span = 1;
      if (spanStr !== undefined) {
        const spanVal = parseFloat(spanStr);
        if (isNaN(spanVal) || spanVal <= 0) {
          warn(
            lineNum,
            `span must be a positive number, got "${spanStr}".`,
            'error'
          );
          continue;
        }
        span = spanVal;
      }

      const descFromPipe = metadata['description'];
      const description: string[] = descFromPipe ? [descFromPipe] : [];

      // Remove known keys from metadata passthrough
      const restMeta = { ...metadata };
      delete restMeta['color'];
      delete restMeta['span'];
      delete restMeta['description'];

      currentNode = {
        label,
        lineNumber: lineNum,
        ...(color !== undefined && { color }),
        span,
        description,
        metadata: restMeta,
      };
      state = 'node';
      continue;
    }

    // ── Indented lines ──
    if (indent > 0) {
      // Check for edge pattern: -> or -label->
      const bareMatch = trimmed.match(BARE_EDGE_RE);
      const labeledMatch = !bareMatch ? trimmed.match(LABELED_EDGE_RE) : null;
      const edgeMatch = bareMatch ?? labeledMatch;
      if (edgeMatch) {
        // Flush any previous edge
        flushEdge();

        if (!currentNode) {
          warn(lineNum, 'Edge line found outside of a node context.');
          continue;
        }

        const edgeLabel = bareMatch
          ? undefined
          : // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty label is stored as no label
            labeledMatch![1]?.trim() || undefined;
        const rest = (
          bareMatch ? (bareMatch[1] ?? '') : (labeledMatch![2] ?? '')
        ).trim();

        // §1.4 unified metadata grammar — same-line cut on the edge
        // tail. The "name" returned here is the explicit target (if
        // any), resolved to a step index at post-parse.
        const edgeSplit = splitNameAndMeta(
          rest,
          CYCLE_REGISTRY,
          new Map(),
          undefined,
          result.diagnostics,
          lineNum
        );
        warnUnknownMetaKeys(
          edgeSplit.meta,
          CYCLE_REGISTRY,
          (msg) => warn(lineNum, msg),
          edgeSplit.name
        );
        const explicitTarget = edgeSplit.name || undefined;
        if (explicitTarget?.endsWith(':')) {
          warn(
            lineNum,
            `Trailing colon is not valid — write '${explicitTarget.replace(/:$/, '')}' instead`,
            'error'
          );
          continue;
        }
        const edgeMeta: Record<string, string> = { ...edgeSplit.meta };
        if (edgeSplit.color !== undefined) edgeMeta['color'] = edgeSplit.color;

        const edgeColor = edgeMeta['color'];
        const widthStr = edgeMeta['width'];
        const edgeWidth = widthStr ? parseFloat(widthStr) : undefined;
        const edgeDescFromPipe = edgeMeta['description'];

        // Remove known keys
        const edgeRestMeta = { ...edgeMeta };
        delete edgeRestMeta['color'];
        delete edgeRestMeta['width'];
        delete edgeRestMeta['description'];

        // sourceIndex is the index of the current node (it hasn't been pushed yet)
        const sourceIndex = result.nodes.length;
        // targetIndex defaults to the next node; post-parse resolves an
        // explicit target.
        const targetIndex = sourceIndex + 1;

        currentEdge = {
          sourceIndex,
          targetIndex,
          ...(edgeLabel !== undefined && { label: edgeLabel }),
          ...(edgeColor !== undefined && { color: edgeColor }),
          ...(edgeWidth !== undefined && { width: edgeWidth }),
          description: edgeDescFromPipe ? [edgeDescFromPipe] : [],
          lineNumber: lineNum,
          metadata: edgeRestMeta,
        };

        // Check explicit target for diagnostic
        if (explicitTarget) {
          // Store for post-parse validation
          (
            currentEdge as CycleEdge & { _explicitTarget?: string }
          )._explicitTarget = explicitTarget;
        }

        state = 'edge';
        continue;
      }

      // Not an edge — must be a description line
      if (state === 'edge' && currentEdge) {
        // Description under an edge
        // Handle bullet points: `- item` → `• item`
        const descLine = trimmed.startsWith('- ')
          ? `• ${trimmed.substring(2)}`
          : trimmed;
        currentEdge.description.push(descLine);
        continue;
      }

      if (state === 'node' && currentNode) {
        // Description under a node
        const descLine = trimmed.startsWith('- ')
          ? `• ${trimmed.substring(2)}`
          : trimmed;
        currentNode.description.push(descLine);
        continue;
      }

      // Indented line with no context
      warn(
        lineNum,
        `Indented line "${trimmed}" has no step above it — add a step on a non-indented line first, then indent its details. (§21)`
      );
      continue;
    }
  }

  // Flush remaining
  flushNode();

  // ── Tag groups: auto colours, value checks, implicit default ──
  finalizeAutoTagColors(result.tagGroups as Writable<TagGroup>[], palette);
  if (result.tagGroups.length > 0) {
    validateTagValues(
      result.nodes,
      result.tagGroups,
      (line, msg) => warn(line, msg),
      suggest
    );
    validateTagGroupNames(result.tagGroups, (line, msg) => warn(line, msg));
    const activeTagWarning = activeTagNoMatchMessage(
      options['active-tag'],
      result.tagGroups
    );
    if (activeTagWarning) {
      result.diagnostics.push(
        makeDgmoError(
          activeTagLine || 1,
          activeTagWarning,
          'warning',
          'W_ACTIVE_TAG_NO_MATCH'
        )
      );
    }
    injectDefaultTagMetadata(result.nodes, result.tagGroups);
  }

  // ── Post-parse validation ──
  if (result.nodes.length < 2) {
    return fail(
      result.titleLineNumber || 1,
      'cycle requires at least 2 nodes.'
    );
  }

  // ── Resolve edge targets and generate implicit edges ──
  // Every edge line under a step is one arrow. A line with no target, or
  // naming the next step, styles the step's ring arrow (last one wins). A
  // line naming any other step is an arrow to that step (#2219). If the step
  // also has a ring-arrow line, the ring arrow stays and the other arrows are
  // back edges, drawn dashed (#2342); otherwise they replace the ring arrow.
  const nodeCount = result.nodes.length;
  const labels = result.nodes.map((n) => n.label);
  const ringBySource = new Map<number, Writable<CycleEdge>>();
  const targetedBySource = new Map<number, Map<number, Writable<CycleEdge>>>();
  for (const edge of result.edges as Writable<CycleEdge>[]) {
    // Default: the next step around the ring.
    const nextIndex = (edge.sourceIndex + 1) % nodeCount;
    edge.targetIndex = nextIndex;

    const typed = edge as Writable<CycleEdge> & { _explicitTarget?: string };
    const named = typed._explicitTarget;
    delete typed._explicitTarget;
    if (named) {
      // Matched by label, ignoring case; the first step with that label wins.
      const wanted = named.trim().toLowerCase();
      const found = result.nodes.findIndex(
        (n) => n.label.trim().toLowerCase() === wanted
      );
      if (found === -1) {
        const hint = suggest(named, labels);
        warn(
          edge.lineNumber!,
          `No step named '${named}'.${hint ? ` ${hint}` : ''} The arrow is not drawn.`,
          'error'
        );
        continue;
      }
      if (found === edge.sourceIndex) {
        warn(
          edge.lineNumber!,
          `A step cannot point to itself ('${named}'). The arrow is not drawn.`,
          'error'
        );
        continue;
      }
      if (found !== nextIndex) {
        edge.targetIndex = found;
        let byTarget = targetedBySource.get(edge.sourceIndex);
        if (!byTarget) {
          byTarget = new Map();
          targetedBySource.set(edge.sourceIndex, byTarget);
        }
        // Two lines to the same step: the last one wins.
        byTarget.set(found, edge);
        continue;
      }
    }
    // Several ring-arrow lines under one step: the last one wins.
    ringBySource.set(edge.sourceIndex, edge);
  }

  // Ring arrows first (one per step, in step order), then the back edges.
  const allEdges: Writable<CycleEdge>[] = [];
  const backEdges: Writable<CycleEdge>[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const targeted = [...(targetedBySource.get(i)?.values() ?? [])];
    const ring = ringBySource.get(i);
    if (targeted.length > 0 && !ring) {
      // A redirect (#2219): the named steps replace the ring arrow.
      allEdges.push(...targeted);
      continue;
    }
    allEdges.push(
      ring ?? {
        sourceIndex: i,
        targetIndex: (i + 1) % nodeCount,
        description: [],
        metadata: {},
      }
    );
    for (const e of targeted) backEdges.push({ ...e, back: true });
  }
  allEdges.push(...backEdges);
  result.edges = allEdges;

  return result;
}

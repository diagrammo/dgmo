import type { PaletteColors } from '../palettes';
import { AliasRegistry } from '../utils/alias-registry';
import type { DgmoError } from '../diagnostics';
import {
  formatDgmoError,
  makeDgmoError,
  makeFail,
  suggest,
} from '../diagnostics';
import { ORG_REGISTRY, withTagAliases } from '../utils/reserved-key-registry';
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
  activeTagNoMatchMessage,
} from '../utils/tag-groups';
import {
  measureIndent,
  extractColor,
  splitNameAndMeta,
  parseFirstLine,
  peelQuotedName,
  OPTION_NOCOLON_RE,
  warnUnknownMetaKeys,
} from '../utils/parsing';
import { normalizeName } from '../utils/name-normalize';

// ============================================================
// Types
// ============================================================

export interface OrgNode {
  readonly id: string;
  readonly label: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly children: readonly OrgNode[];
  readonly parentId: string | null;
  readonly isContainer: boolean;
  readonly lineNumber: number;
  readonly color?: string;
  /**
   * Seeded collapsed by source — `collapsed: true` on the node's own line, or
   * as an indented key under it / under a `[Container]` header (§6.5).
   * Lifted out of `metadata` at end of parse so it drives render and export
   * rather than being drawn as an attribute row.
   */
  readonly collapsed?: boolean;
}

export interface ParsedOrg {
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  readonly roots: readonly OrgNode[];
  readonly tagGroups: readonly TagGroup[];
  readonly options: Readonly<Record<string, string>>;
  /**
   * Resolved layout direction (§7.5). `direction-lr` / `direction-tb` are a
   * mutually-exclusive boolean pair (§1.9, last one wins). Defaults to 'TB',
   * which is the orientation org charts have always rendered.
   */
  readonly direction: 'LR' | 'TB';
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}

// ============================================================
// Helpers
// ============================================================

// A container header, optionally carrying the same-line collapse marker
// (§6.4.1). Deliberately narrow: ONLY `collapsed: <val>` may follow the
// bracket, so no other trailing text becomes legal on a container line and
// nothing else about container parsing moves. C4's CONTAINER_RE has the same
// shape (it also takes a bare `collapsed` flag, which org does not — see the
// colon-form-only ruling in decision #55).
const CONTAINER_RE = /^\[([^\]]+)\](?:\s+collapsed:\s*(\S+))?$/;
const METADATA_RE = /^([^:]+):\s*(.+)$/;

/** Known org chart options (key-value). */
const KNOWN_OPTIONS = new Set([
  'sub-node-label',
  'hide',
  'show-sub-node-count',
  'active-tag',
  'focus',
]);
/** Known org chart boolean options (bare keyword = on). */
const KNOWN_BOOLEANS = new Set([
  'show-sub-node-count',
  'direction-tb',
  'direction-lr',
  'fill-tint',
  'fill-solid',
  'fill-outline',
  'no-title',
  'no-legend',
]);

// ============================================================
// Inference
// ============================================================

/** Returns true if content contains tag group headings (`tag …`), suggesting an org chart. */
export function looksLikeOrg(content: string): boolean {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (isTagBlockHeading(trimmed)) return true;
  }
  return false;
}

// ============================================================
// Parser
// ============================================================

export function parseOrg(content: string, palette?: PaletteColors): ParsedOrg {
  const options: Record<string, string> = {};
  const result: Writable<ParsedOrg> = {
    title: null,
    titleLineNumber: null,
    roots: [],
    tagGroups: [],
    options,
    direction: 'TB',
    diagnostics: [],
    error: null,
  };

  const fail = makeFail(result);

  /** Push a recoverable error and continue parsing. */
  const pushError = (line: number, message: string): void => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    if (!result.error) result.error = formatDgmoError(diag);
  };

  /** Push a non-fatal warning (does not set result.error). */
  const pushWarning = (line: number, message: string, code?: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning', code));
  };

  if (!content?.trim()) {
    return fail(0, 'No content provided');
  }

  const lines = content.split('\n');
  let contentStarted = false;
  let nodeCounter = 0;
  let containerCounter = 0;
  let focusOptionLine = 0;
  let activeTagOptionLine = 0;

  // Tag group parsing state
  let currentTagGroup: Writable<TagGroup> | null = null;

  // Alias map: alias (lowercased) → group name (lowercased)
  // metaAliasMap: tag-group metadata-key aliases (e.g. `p` → `priority`).
  // Distinct from nameAliasMap below per the A1 convention.
  const metaAliasMap = new Map<string, string>();
  // nameAliasMap: TD-18 entity-name aliases (e.g. `pm` → `Product Manager`).
  // Per C8: per-parse, never persisted, fresh each parse.
  const nameAliasMap = new AliasRegistry();

  // Indent stack for hierarchy tracking
  // Each entry: { node, indent }
  const indentStack: { node: Writable<OrgNode>; indent: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!; // In-bounds by loop guard.
    const lineNumber = i + 1;
    nameAliasMap.at(lineNumber);
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      // Empty line ends a tag group
      if (currentTagGroup) {
        currentTagGroup = null;
      }
      continue;
    }

    // Skip comments
    if (trimmed.startsWith('//')) continue;

    // --- Header phase ---

    // Extract chart type + title from first line (e.g. `org My Org Chart`)
    if (!contentStarted) {
      const firstLine = parseFirstLine(trimmed);
      if (firstLine) {
        if (firstLine.chartType !== 'org') {
          const allTypes = [
            'org',
            'class',
            'flowchart',
            'sequence',
            'er',
            'bar',
            'line',
            'pie',
            'scatter',
            'sankey',
            'venn',
            'timeline',
            'arc',
            'slope',
          ];
          let msg = `Expected chart type "org", got "${firstLine.chartType}"`;
          const hint = suggest(firstLine.chartType, allTypes);
          if (hint) msg += `. ${hint}`;
          return fail(lineNumber, msg);
        }
        if (firstLine.title) {
          result.title = firstLine.title;
          result.titleLineNumber = lineNumber;
        }
        continue;
      }
    }

    // Tag group heading — `tag Name as <alias>`.
    // Must be checked BEFORE OPTION_RE to prevent `tag: Rank` being swallowed as option `tag=Rank`
    const tagBlockMatch = matchTagBlockHeading(trimmed);
    if (tagBlockMatch) {
      if (contentStarted) {
        pushError(lineNumber, 'Tag groups must appear before org content');
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
        metaAliasMap.set(
          normalizeName(tagBlockMatch.alias),
          tagAttrKey(tagBlockMatch.name)
        );
      }
      // §1.4 dispatch: register canonical name so `<name>:` triggers
      // the metadata cut even without an explicit `as <alias>`.
      metaAliasMap.set(
        normalizeName(tagBlockMatch.name),
        tagAttrKey(tagBlockMatch.name)
      );
      result.tagGroups.push(currentTagGroup);
      continue;
    }

    // Tag group entries (indented Value color under tag heading)
    // First entry is the default unless another is marked `default`.
    // 🔴 Runs BEFORE the option block below, and the order is load-bearing: a
    // non-indented line ends the tag block, and the option block is gated on
    // `!currentTagGroup`. Checked the other way round, the first directive after a
    // tag block closes the group and is then lost — silently on a single-group
    // source, and as a misleading "tag groups must appear before content" error on
    // the next tag block when there is one (#301).
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
        // Bare value (no explicit color) → keep it; the post-parse
        // finalize pass assigns a deterministic palette color.
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
      // Non-indented line after tag group — fall through to content parsing
      currentTagGroup = null;
    }

    // Generic header options (space-separated: `key value` or bare boolean `key`)
    // Only match non-indented lines with known option keys
    if (!contentStarted && !currentTagGroup && measureIndent(line) === 0) {
      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch) {
        // Capture groups 1 and 2 guaranteed by OPTION_NOCOLON_RE match.
        const key = optMatch[1]!.trim().toLowerCase();
        if (KNOWN_OPTIONS.has(key)) {
          options[key] = optMatch[2]!.trim();
          if (key === 'focus') focusOptionLine = lineNumber;
          if (key === 'active-tag') activeTagOptionLine = lineNumber;
          continue;
        }
      }
      // Bare boolean option (single keyword, no value)
      if (KNOWN_BOOLEANS.has(trimmed.toLowerCase())) {
        const boolKey = trimmed.toLowerCase();
        // The direction booleans are a mutually-exclusive pair (§1.9,
        // last one wins) — clear the sibling so only the latest survives.
        if (boolKey === 'direction-lr' || boolKey === 'direction-tb') {
          delete options['direction-lr'];
          delete options['direction-tb'];
        }
        options[boolKey] = 'on';
        continue;
      }
    }

    // --- Org content phase ---
    contentStarted = true;
    currentTagGroup = null;

    const indent = measureIndent(line);

    // Check for container syntax: [Team Name]
    const containerMatch = trimmed.match(CONTAINER_RE);

    // Check for indented metadata syntax: `key: value` with key at start.
    // A line like `Alice Park role: Senior` is a NODE with same-line
    // metadata (§1.4), not indented metadata for the parent — distinguish
    // by requiring the key (chars before the first `:`) to be a single
    // identifier-shaped token. Anything with embedded spaces in the key
    // region is a node line.
    const metadataMatch = (() => {
      if (trimmed.includes('|')) return null;
      // A line opening with a quote is a §2.2 quoted name, never a
      // metadata key — the `:` it may carry is inside the name.
      if (trimmed.startsWith('"') || trimmed.startsWith("'")) return null;
      const m = trimmed.match(METADATA_RE);
      if (!m) return null;
      const keyRegion = m[1]!.trim();
      // Bare-metadata key must be a single word (no embedded spaces).
      // A node line has the label first, then the metadata key.
      if (/\s/.test(keyRegion)) return null;
      return m;
    })();

    if (containerMatch) {
      // It's a container node — supports `as <alias>` postfix per TD-18.
      // Capture group 1 guaranteed by CONTAINER_RE match.
      const rawLabel = containerMatch[1]!.trim();
      const asMatch = rawLabel.match(
        /^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/
      );
      // Capture groups 1 and 2 guaranteed by the regex above when asMatch is truthy.
      // §2.2 quotes are delimiters, not label text.
      const label = peelQuotedName(asMatch ? asMatch[1]!.trim() : rawLabel);

      containerCounter++;
      const containerId = `container-${containerCounter}`;
      if (asMatch) nameAliasMap.declare(asMatch[2]!, containerId, lineNumber);
      nameAliasMap.noteCanonical(containerId, lineNumber);
      const node: Writable<OrgNode> = {
        id: containerId,
        label,
        // The same-line collapse marker (capture 2, §6.4.1). Goes into metadata
        // rather than the typed field so the one post-parse lift handles every
        // route — same-line here, indented under the header, or under a person.
        metadata:
          containerMatch[2] !== undefined
            ? { collapsed: containerMatch[2] }
            : {},
        children: [],
        parentId: null,
        isContainer: true,
        lineNumber,
      };

      attachNode(node, indent, indentStack, result);
    } else if (metadataMatch && indentStack.length > 0) {
      // It's a metadata line — attach to most recent node on stack at shallower indent
      // Capture groups 1 and 2 guaranteed by METADATA_RE match.
      const rawKey = metadataMatch[1]!.trim().toLowerCase();
      const key = metaAliasMap.get(rawKey) ?? rawKey;
      const value = metadataMatch[2]!.trim();

      // Find the parent node: top of stack (the most recent node)
      const parent = findMetadataParent(indent, indentStack);
      if (!parent) {
        pushError(
          lineNumber,
          "Metadata 'key: value' must be indented under a node — no node precedes it."
        );
      } else {
        parent.metadata = { ...parent.metadata, [key]: value };
      }
    } else if (metadataMatch && indentStack.length === 0) {
      // Metadata with no parent — could be a node label that happens to contain ':'
      // Treat it as a node if it's at indent 0 and no nodes exist yet
      // Otherwise it's an orphan metadata error
      if (indent === 0) {
        // Treat as a node label (e.g., "Dr. Smith: Surgeon" is a valid name)
        const node = parseNodeLabel(
          trimmed,
          indent,
          lineNumber,
          palette,
          ++nodeCounter,
          metaAliasMap,
          result.diagnostics,
          nameAliasMap
        );
        attachNode(node, indent, indentStack, result);
      } else {
        pushError(
          lineNumber,
          "Metadata 'key: value' must be indented under a node — no node precedes it."
        );
      }
    } else {
      // It's a node label — possibly with single-line metadata
      const node = parseNodeLabel(
        trimmed,
        indent,
        lineNumber,
        palette,
        ++nodeCounter,
        metaAliasMap,
        result.diagnostics,
        nameAliasMap
      );
      attachNode(node, indent, indentStack, result);
    }
  }

  // Assign palette colors to bare (colorless) tag values before validation.
  finalizeAutoTagColors(result.tagGroups as Writable<TagGroup>[], palette);

  // Validate tag group values on nodes
  if (result.tagGroups.length > 0) {
    // Flatten all nodes for the shared validation utility
    const allNodes: OrgNode[] = [];
    const collectAll = (nodes: readonly OrgNode[]) => {
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
    const diag = makeDgmoError(1, 'No nodes found in org chart');
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
  }

  // Lift the `collapsed` view-state marker out of metadata into a typed field
  // (§6.5). One pass at the end covers every way it can arrive — same-line on a
  // node, an indented key under a node, an indented key under a `[Container]`
  // header — because all three land in the same `metadata` bag. Dropped from
  // metadata so it never draws as an attribute row on the card.
  liftCollapsedMarkers(result.roots);

  // `focus <name>` must name a person or team that exists — warn (never
  // error) when it doesn't; renderers fall back to the whole chart.
  const focusName = options['focus'];
  if (focusName && result.roots.length > 0) {
    if (!findOrgNodeIdByName(result.roots, focusName)) {
      pushWarning(
        focusOptionLine || 1,
        `focus target "${focusName}" not found — showing the whole chart`
      );
    }
  }

  // `active-tag <group>` must name a declared tag group — warn (never error)
  // when it doesn't, or the chart silently renders in flat neutral colours and
  // reads as "tags aren't working" rather than "you spelled it wrong".
  const activeTagWarning = activeTagNoMatchMessage(
    options['active-tag'],
    result.tagGroups
  );
  if (activeTagWarning) {
    pushWarning(
      activeTagOptionLine || 1,
      activeTagWarning,
      'W_ACTIVE_TAG_NO_MATCH'
    );
  }

  // Resolve the layout direction (§7.5). The boolean pair is mutually
  // exclusive and already collapsed to a single surviving key above
  // (§1.9, last one wins), so a lone presence check is sufficient.
  // Absent both, org charts keep their long-standing top-down orientation.
  result.direction = options['direction-lr'] ? 'LR' : 'TB';

  // Alias namespace rules (§2A.2) — decidable only once the whole
  // source has been read.
  result.diagnostics.push(...nameAliasMap.finish());

  return result;
}

/**
 * Resolve a `focus <name>` directive value to a node id — case-insensitive
 * match on the person's (or team container's) display label, depth-first in
 * source order, first match wins. Returns null when nothing matches.
 */
export function findOrgNodeIdByName(
  nodes: readonly OrgNode[],
  name: string
): string | null {
  const target = name.trim().toLowerCase();
  for (const node of nodes) {
    if (node.label.trim().toLowerCase() === target) return node.id;
    const hit = findOrgNodeIdByName(node.children, target);
    if (hit) return hit;
  }
  return null;
}

// ============================================================
// Internal helpers
// ============================================================

function parseNodeLabel(
  trimmed: string,
  _indent: number,
  lineNumber: number,
  _palette: PaletteColors | undefined,
  counter: number,
  metaAliasMap: Map<string, string> = new Map(),
  diagnostics?: DgmoError[],
  nameAliasMap?: AliasRegistry
): Writable<OrgNode> {
  // §1.4 unified metadata grammar — same-line cut.
  const registry = withTagAliases(ORG_REGISTRY, new Set(metaAliasMap.keys()));
  const id = `node-${counter}`;
  const split = splitNameAndMeta(
    trimmed,
    registry,
    metaAliasMap,
    undefined,
    diagnostics,
    lineNumber
  );
  warnUnknownMetaKeys(
    split.meta,
    registry,
    (msg) => diagnostics?.push(makeDgmoError(lineNumber, msg, 'warning')),
    split.name
  );
  // §2.2 quotes are delimiters, not label text — peel before the label is
  // formed so a quoted declaration and a bare reference key identically.
  const peeled = peelQuotedName(split.name);
  // Org labels do not use §1.5 trailing-token color (org uses an indented
  // `color:` key). Restore the peeled color word back into the label so
  // `Alice Park blue role: Senior` parses as label `Alice Park blue` with
  // metadata only.
  const label = split.color !== undefined ? `${peeled} ${split.color}` : peeled;
  if (split.alias) {
    nameAliasMap?.declare(normalizeName(split.alias), id, lineNumber);
  }
  nameAliasMap?.noteCanonical(id, lineNumber);
  const metadata: Record<string, string> = { ...split.meta };

  return {
    id,
    label,
    metadata,
    children: [],
    parentId: null,
    isContainer: false,
    lineNumber,
  };
}

/**
 * Move `collapsed: <val>` from each node's metadata into its typed `collapsed`
 * field, recursively. Only the literal `true` collapses — every other chart
 * type reads this key the same way, so `collapsed: false` spells "expanded"
 * and still leaves no attribute row behind.
 */
function liftCollapsedMarkers(nodes: readonly OrgNode[]): void {
  for (const node of nodes) {
    const n = node as Writable<OrgNode>;
    const raw = n.metadata['collapsed'];
    if (raw !== undefined) {
      const meta = { ...n.metadata };
      delete meta['collapsed'];
      n.metadata = meta;
      if (raw.toLowerCase() === 'true') n.collapsed = true;
    }
    liftCollapsedMarkers(n.children);
  }
}

function attachNode(
  node: Writable<OrgNode>,
  indent: number,
  indentStack: { node: Writable<OrgNode>; indent: number }[],
  result: Writable<ParsedOrg>
): void {
  // Pop stack entries with indent >= current indent
  while (indentStack.length > 0) {
    // In-bounds by while-loop length guard.
    const top = indentStack[indentStack.length - 1]!;
    if (top.indent < indent) break;
    indentStack.pop();
  }

  if (indentStack.length > 0) {
    // Stack top becomes parent — in-bounds by length guard.
    const parent = indentStack[indentStack.length - 1]!.node;
    node.parentId = parent.id;
    parent.children.push(node);
  } else {
    // Top-level root
    result.roots.push(node);
  }

  // Push new node onto stack
  indentStack.push({ node, indent });
}

function findMetadataParent(
  indent: number,
  indentStack: { node: Writable<OrgNode>; indent: number }[]
): Writable<OrgNode> | null {
  // Walk backward from the top of the stack to find the most recent node
  // at a shallower indent than the metadata line
  for (let i = indentStack.length - 1; i >= 0; i--) {
    // In-bounds by reverse-for loop guard.
    const entry = indentStack[i]!;
    if (entry.indent < indent) {
      return entry.node;
    }
  }
  // If metadata is at same indent as top node, attach to top node
  if (indentStack.length > 0) {
    // In-bounds by length guard.
    return indentStack[indentStack.length - 1]!.node;
  }
  return null;
}

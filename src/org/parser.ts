import type { PaletteColors } from '../palettes';
import type { DgmoError } from '../diagnostics';
import {
  formatDgmoError,
  makeDgmoError,
  METADATA_DIAGNOSTIC_CODES,
  pipeOperatorRemovedMessage,
  suggest,
} from '../diagnostics';
import { ORG_REGISTRY, withTagAliases } from '../utils/reserved-key-registry';
import type { TagGroup } from '../utils/tag-groups';
import { tryCollectNote, resolveNotes, type DiagramNote } from '../utils/notes';
import type { Writable } from '../utils/brand';
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
  splitNameAndMeta,
  parseFirstLine,
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
}

export interface ParsedOrg {
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  readonly roots: readonly OrgNode[];
  readonly tagGroups: readonly TagGroup[];
  readonly options: Readonly<Record<string, string>>;
  /** Generic node notes (`note <Person> …`); resolved in layout. */
  readonly notes?: readonly DiagramNote[];
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}

// ============================================================
// Helpers
// ============================================================

const CONTAINER_RE = /^\[([^\]]+)\]$/;
const METADATA_RE = /^([^:]+):\s*(.+)$/;

/** Known org chart options (key-value). */
const KNOWN_OPTIONS = new Set([
  'sub-node-label',
  'hide',
  'show-sub-node-count',
  'active-tag',
]);
/** Known org chart boolean options (bare keyword = on). */
const KNOWN_BOOLEANS = new Set([
  'show-sub-node-count',
  'direction-tb',
  'solid-fill',
  'no-title',
  'no-notes',
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
    diagnostics: [],
    error: null,
  };

  const fail = (line: number, message: string): ParsedOrg => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  /** Push a recoverable error and continue parsing. */
  const pushError = (line: number, message: string): void => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    if (!result.error) result.error = formatDgmoError(diag);
  };

  /** Push a non-fatal warning (does not set result.error). */
  const pushWarning = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  if (!content?.trim()) {
    return fail(0, 'No content provided');
  }

  const lines = content.split('\n');
  const notes: DiagramNote[] = [];
  let contentStarted = false;
  let nodeCounter = 0;
  let containerCounter = 0;

  // Tag group parsing state
  let currentTagGroup: Writable<TagGroup> | null = null;

  // Alias map: alias (lowercased) → group name (lowercased)
  // metaAliasMap: tag-group metadata-key aliases (e.g. `p` → `priority`).
  // Distinct from nameAliasMap below per the A1 convention.
  const metaAliasMap = new Map<string, string>();
  // nameAliasMap: TD-18 entity-name aliases (e.g. `pm` → `Product Manager`).
  // Per C8: per-parse, never persisted, fresh each parse.
  const nameAliasMap = new Map<string, string>();

  // Indent stack for hierarchy tracking
  // Each entry: { node, indent }
  const indentStack: { node: Writable<OrgNode>; indent: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!; // In-bounds by loop guard.
    const lineNumber = i + 1;
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
      emitTagLegacyDiagnostic(tagBlockMatch, lineNumber, result.diagnostics);
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
          tagBlockMatch.name.toLowerCase()
        );
      }
      // §1.4 dispatch: register canonical name so `<name>:` triggers
      // the metadata cut even without an explicit `as <alias>`.
      metaAliasMap.set(
        normalizeName(tagBlockMatch.name),
        tagBlockMatch.name.toLowerCase()
      );
      result.tagGroups.push(currentTagGroup);
      continue;
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
          continue;
        }
      }
      // Bare boolean option (single keyword, no value)
      if (KNOWN_BOOLEANS.has(trimmed.toLowerCase())) {
        options[trimmed.toLowerCase()] = 'on';
        continue;
      }
    }

    // Tag group entries (indented Value color under tag heading)
    // First entry is the default unless another is marked `default`
    if (currentTagGroup && !contentStarted) {
      const indent = measureIndent(line);
      if (indent > 0) {
        const { text: cleanEntry, isDefault } = stripDefaultModifier(trimmed);
        const { label, color } = extractColor(cleanEntry, palette);
        if (!color) {
          pushError(
            lineNumber,
            `Expected 'Value color' in tag group '${currentTagGroup.name}'`
          );
          continue;
        }
        if (isDefault) {
          currentTagGroup.defaultValue = label;
        } else if (currentTagGroup.entries.length === 0) {
          currentTagGroup.defaultValue = label;
        }
        currentTagGroup.entries.push({
          value: label,
          color,
          lineNumber,
        });
        continue;
      }
      // Non-indented line after tag group — fall through to content parsing
      currentTagGroup = null; // eslint-disable-line no-useless-assignment
    }

    // --- Org content phase ---
    contentStarted = true;
    currentTagGroup = null;

    const indent = measureIndent(line);

    // Note annotation (top-level): `note <Person> [inline body]` + an optional
    // indented body. Gated to indent 0 so the indent-based hierarchy never
    // mistakes it for a node; its indented body is consumed via i advance.
    if (indent === 0) {
      const noteResult = tryCollectNote(
        lines,
        i,
        indent,
        palette,
        result.diagnostics
      );
      if (noteResult) {
        if (noteResult.note) notes.push(noteResult.note);
        i = noteResult.lastIndex;
        continue;
      }
    }

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
      const label = asMatch ? asMatch[1]!.trim() : rawLabel;

      containerCounter++;
      const containerId = `container-${containerCounter}`;
      if (asMatch) nameAliasMap.set(asMatch[2]!, containerId);
      const node: Writable<OrgNode> = {
        id: containerId,
        label,
        metadata: {},
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
        pushError(lineNumber, 'Metadata has no parent node');
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
        pushError(lineNumber, 'Metadata has no parent node');
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

  // Resolve note refs against node labels (forward refs OK). The id→note
  // binding is recomputed in layout; this pass surfaces diagnostics.
  if (notes.length > 0) {
    const flat: { id: string; label: string }[] = [];
    const collect = (nodes: readonly OrgNode[]) => {
      for (const node of nodes) {
        flat.push({ id: node.id, label: node.label });
        collect(node.children);
      }
    };
    collect(result.roots);
    result.notes = notes;
    resolveNotes(notes, flat, result.diagnostics);
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

  return result;
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
  nameAliasMap?: Map<string, string>
): Writable<OrgNode> {
  // Legacy `|` detection per §1.4.
  if (trimmed.includes('|') && diagnostics) {
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        pipeOperatorRemovedMessage(),
        'error',
        METADATA_DIAGNOSTIC_CODES.PIPE_OPERATOR_REMOVED
      )
    );
  }

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
  // Org labels do not use §1.5 trailing-token color (org uses an indented
  // `color:` key). Restore the peeled color word back into the label so
  // `Alice Park blue role: Senior` parses as label `Alice Park blue` with
  // metadata only.
  const label =
    split.color !== undefined ? `${split.name} ${split.color}` : split.name;
  if (split.alias) {
    nameAliasMap?.set(normalizeName(split.alias), id);
  }
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

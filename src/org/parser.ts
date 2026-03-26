import type { PaletteColors } from '../palettes';
import type { DgmoError } from '../diagnostics';
import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import type { TagGroup, TagEntry } from '../utils/tag-groups';
import { isTagBlockHeading, matchTagBlockHeading, validateTagValues } from '../utils/tag-groups';
import {
  measureIndent,
  extractColor,
  parsePipeMetadata,
  MULTIPLE_PIPE_WARNING,
  parseFirstLine,
  OPTION_NOCOLON_RE,
} from '../utils/parsing';

// ============================================================
// Types
// ============================================================

export interface OrgNode {
  id: string;
  label: string;
  metadata: Record<string, string>;
  children: OrgNode[];
  parentId: string | null;
  isContainer: boolean;
  lineNumber: number;
  color?: string;
}

export interface ParsedOrg {
  title: string | null;
  titleLineNumber: number | null;
  roots: OrgNode[];
  tagGroups: TagGroup[];
  options: Record<string, string>;
  diagnostics: DgmoError[];
  error: string | null;
}

// ============================================================
// Helpers
// ============================================================

const CONTAINER_RE = /^\[([^\]]+)\]$/;
const METADATA_RE = /^([^:]+):\s*(.+)$/;

/** Known org chart options (key-value). */
const KNOWN_OPTIONS = new Set([
  'direction', 'sub-node-label', 'hide', 'show-sub-node-count',
]);
/** Known org chart boolean options (bare keyword = on). */
const KNOWN_BOOLEANS = new Set([
  'show-sub-node-count',
]);

// ============================================================
// Inference
// ============================================================

/** Returns true if content contains tag group headings (`tag: …` or `## …`), suggesting an org chart. */
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

export function parseOrg(
  content: string,
  palette?: PaletteColors
): ParsedOrg {
  const result: ParsedOrg = {
    title: null,
    titleLineNumber: null,
    roots: [],
    tagGroups: [],
    options: {},
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

  if (!content || !content.trim()) {
    return fail(0, 'No content provided');
  }

  const lines = content.split('\n');
  let contentStarted = false;
  let nodeCounter = 0;
  let containerCounter = 0;

  // Tag group parsing state
  let currentTagGroup: TagGroup | null = null;

  // Alias map: alias (lowercased) → group name (lowercased)
  const aliasMap = new Map<string, string>();

  // Indent stack for hierarchy tracking
  // Each entry: { node, indent }
  const indentStack: { node: OrgNode; indent: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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
          const allTypes = ['org', 'class', 'flowchart', 'sequence', 'er', 'bar', 'line', 'pie', 'scatter', 'sankey', 'venn', 'timeline', 'arc', 'slope'];
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

    // Tag group heading — `tag: Name` (new) or `## Name` (deprecated)
    // Must be checked BEFORE OPTION_RE to prevent `tag: Rank` being swallowed as option `tag=Rank`
    const tagBlockMatch = matchTagBlockHeading(trimmed);
    if (tagBlockMatch) {
      if (contentStarted) {
        pushError(lineNumber, 'Tag groups must appear before org content');
        continue;
      }
      if (tagBlockMatch.deprecated) {
        pushError(lineNumber, `'## ${tagBlockMatch.name}' is no longer supported — use 'tag: ${tagBlockMatch.name}' instead`);
        continue;
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

    // Generic header options (space-separated: `key value` or bare boolean `key`)
    // Only match non-indented lines with known option keys
    if (!contentStarted && !currentTagGroup && measureIndent(line) === 0) {
      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch) {
        const key = optMatch[1].trim().toLowerCase();
        if (KNOWN_OPTIONS.has(key)) {
          result.options[key] = optMatch[2].trim();
          continue;
        }
      }
      // Bare boolean option (single keyword, no value)
      if (KNOWN_BOOLEANS.has(trimmed.toLowerCase())) {
        result.options[trimmed.toLowerCase()] = 'on';
        continue;
      }
    }

    // Tag group entries (indented Value(color) under tag heading)
    // First entry is implicitly the default.
    if (currentTagGroup && !contentStarted) {
      const indent = measureIndent(line);
      if (indent > 0) {
        const { label, color } = extractColor(trimmed, palette);
        if (!color) {
          pushError(lineNumber, `Expected 'Value(color)' in tag group '${currentTagGroup.name}'`);
          continue;
        }
        // First entry is the default
        if (currentTagGroup.entries.length === 0) {
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
      currentTagGroup = null;
    }

    // --- Org content phase ---
    contentStarted = true;
    currentTagGroup = null;

    const indent = measureIndent(line);

    // Check for container syntax: [Team Name]
    const containerMatch = trimmed.match(CONTAINER_RE);

    // Check for metadata syntax: key: value
    // Lines containing '|' are pipe-delimited nodes (e.g. "Alice | role: Engineer"),
    // not metadata — skip the metadata regex for them.
    const metadataMatch = trimmed.includes('|') ? null : trimmed.match(METADATA_RE);

    if (containerMatch) {
      // It's a container node
      const rawLabel = containerMatch[1].trim();
      const { label, color } = extractColor(rawLabel, palette);

      containerCounter++;
      const node: OrgNode = {
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
    } else if (metadataMatch && indentStack.length > 0) {
      // It's a metadata line — attach to most recent node on stack at shallower indent
      const rawKey = metadataMatch[1].trim().toLowerCase();
      const key = aliasMap.get(rawKey) ?? rawKey;
      const value = metadataMatch[2].trim();

      // Find the parent node: top of stack (the most recent node)
      const parent = findMetadataParent(indent, indentStack);
      if (!parent) {
        pushError(lineNumber, 'Metadata has no parent node');
      } else {
        parent.metadata[key] = value;
      }
    } else if (metadataMatch && indentStack.length === 0) {
      // Metadata with no parent — could be a node label that happens to contain ':'
      // Treat it as a node if it's at indent 0 and no nodes exist yet
      // Otherwise it's an orphan metadata error
      if (indent === 0) {
        // Treat as a node label (e.g., "Dr. Smith: Surgeon" is a valid name)
        const node = parseNodeLabel(trimmed, indent, lineNumber, palette, ++nodeCounter, aliasMap, pushWarning);
        attachNode(node, indent, indentStack, result);
      } else {
        pushError(lineNumber, 'Metadata has no parent node');
      }
    } else {
      // It's a node label — possibly with single-line pipe-delimited metadata
      const node = parseNodeLabel(trimmed, indent, lineNumber, palette, ++nodeCounter, aliasMap, pushWarning);
      attachNode(node, indent, indentStack, result);
    }
  }

  // Validate tag group values on nodes
  if (result.tagGroups.length > 0) {
    // Flatten all nodes for the shared validation utility
    const allNodes: OrgNode[] = [];
    const collectAll = (nodes: OrgNode[]) => {
      for (const node of nodes) {
        allNodes.push(node);
        collectAll(node.children);
      }
    };
    collectAll(result.roots);

    validateTagValues(allNodes, result.tagGroups, pushWarning, suggest);
  }

  if (result.roots.length === 0 && result.tagGroups.length === 0 && !result.error) {
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
  palette: PaletteColors | undefined,
  counter: number,
  aliasMap: Map<string, string> = new Map(),
  warnFn?: (line: number, msg: string) => void,
): OrgNode {
  // Check for single-line compact metadata: "Alice Park | role: Senior, location: NY"
  const segments = trimmed.split('|').map((s) => s.trim());

  let rawLabel = segments[0];
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
  node: OrgNode,
  indent: number,
  indentStack: { node: OrgNode; indent: number }[],
  result: ParsedOrg
): void {
  // Pop stack entries with indent >= current indent
  while (indentStack.length > 0) {
    const top = indentStack[indentStack.length - 1];
    if (top.indent < indent) break;
    indentStack.pop();
  }

  if (indentStack.length > 0) {
    // Stack top becomes parent
    const parent = indentStack[indentStack.length - 1].node;
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
  indentStack: { node: OrgNode; indent: number }[]
): OrgNode | null {
  // Walk backward from the top of the stack to find the most recent node
  // at a shallower indent than the metadata line
  for (let i = indentStack.length - 1; i >= 0; i--) {
    if (indentStack[i].indent < indent) {
      return indentStack[i].node;
    }
  }
  // If metadata is at same indent as top node, attach to top node
  if (indentStack.length > 0) {
    return indentStack[indentStack.length - 1].node;
  }
  return null;
}

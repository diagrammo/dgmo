import { resolveColor } from '../colors';
import type { PaletteColors } from '../palettes';

// ============================================================
// Types
// ============================================================

export interface OrgTagEntry {
  value: string;
  color: string;
  lineNumber: number;
}

export interface OrgTagGroup {
  name: string;
  entries: OrgTagEntry[];
  lineNumber: number;
}

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
  tagGroups: OrgTagGroup[];
  error: string | null;
}

// ============================================================
// Helpers
// ============================================================

function measureIndent(line: string): number {
  let indent = 0;
  for (const ch of line) {
    if (ch === ' ') indent++;
    else if (ch === '\t') indent += 4;
    else break;
  }
  return indent;
}

const COLOR_SUFFIX_RE = /\(([^)]+)\)\s*$/;

function extractColor(
  label: string,
  palette?: PaletteColors
): { label: string; color?: string } {
  const m = label.match(COLOR_SUFFIX_RE);
  if (!m) return { label };
  const colorName = m[1].trim();
  return {
    label: label.substring(0, m.index!).trim(),
    color: resolveColor(colorName, palette),
  };
}

const GROUP_HEADING_RE = /^##\s+(.+?)(?:\(([^)]+)\))?\s*$/;
const CONTAINER_RE = /^\[([^\]]+)\]$/;
const METADATA_RE = /^([^:]+):\s*(.+)$/;
const CHART_TYPE_RE = /^chart\s*:\s*(.+)/i;
const TITLE_RE = /^title\s*:\s*(.+)/i;

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
    error: null,
  };

  if (!content || !content.trim()) {
    result.error = 'No content provided';
    return result;
  }

  const lines = content.split('\n');
  let contentStarted = false;
  let nodeCounter = 0;
  let containerCounter = 0;

  // Tag group parsing state
  let currentTagGroup: OrgTagGroup | null = null;

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

    // chart: type
    if (!contentStarted) {
      const chartMatch = trimmed.match(CHART_TYPE_RE);
      if (chartMatch) {
        const chartType = chartMatch[1].trim().toLowerCase();
        if (chartType !== 'org') {
          result.error = `Line ${lineNumber}: Expected chart type "org", got "${chartType}"`;
          return result;
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

    // ## Tag group heading
    const groupMatch = trimmed.match(GROUP_HEADING_RE);
    if (groupMatch) {
      if (contentStarted) {
        result.error = `Line ${lineNumber}: Tag groups (##) must appear before org content`;
        return result;
      }
      currentTagGroup = {
        name: groupMatch[1].trim(),
        entries: [],
        lineNumber,
      };
      result.tagGroups.push(currentTagGroup);
      continue;
    }

    // Tag group entries (indented Value(color) under ## heading)
    if (currentTagGroup && !contentStarted) {
      const indent = measureIndent(line);
      if (indent > 0) {
        const { label, color } = extractColor(trimmed, palette);
        if (!color) {
          result.error = `Line ${lineNumber}: Expected 'Value(color)' in tag group '${currentTagGroup.name}'`;
          return result;
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
    const metadataMatch = trimmed.match(METADATA_RE);

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
      const key = metadataMatch[1].trim().toLowerCase();
      const value = metadataMatch[2].trim();

      // Find the parent node: top of stack (the most recent node)
      const parent = findMetadataParent(indent, indentStack);
      if (!parent) {
        result.error = `Line ${lineNumber}: Metadata has no parent node`;
        return result;
      }
      parent.metadata[key] = value;
    } else if (metadataMatch && indentStack.length === 0) {
      // Metadata with no parent — could be a node label that happens to contain ':'
      // Treat it as a node if it's at indent 0 and no nodes exist yet
      // Otherwise it's an orphan metadata error
      if (indent === 0) {
        // Treat as a node label (e.g., "Dr. Smith: Surgeon" is a valid name)
        const node = parseNodeLabel(trimmed, indent, lineNumber, palette, ++nodeCounter);
        attachNode(node, indent, indentStack, result);
      } else {
        result.error = `Line ${lineNumber}: Metadata has no parent node`;
        return result;
      }
    } else {
      // It's a node label — possibly with single-line pipe-delimited metadata
      const node = parseNodeLabel(trimmed, indent, lineNumber, palette, ++nodeCounter);
      attachNode(node, indent, indentStack, result);
    }
  }

  if (result.roots.length === 0 && !result.error) {
    result.error = 'No nodes found in org chart';
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
  counter: number
): OrgNode {
  // Check for single-line compact metadata: "Alice Park | role: Senior | location: NY"
  const segments = trimmed.split('|').map((s) => s.trim());

  let rawLabel = segments[0];
  const { label, color } = extractColor(rawLabel, palette);

  const metadata: Record<string, string> = {};
  for (let j = 1; j < segments.length; j++) {
    const seg = segments[j];
    const colonIdx = seg.indexOf(':');
    if (colonIdx > 0) {
      const key = seg.substring(0, colonIdx).trim().toLowerCase();
      const value = seg.substring(colonIdx + 1).trim();
      metadata[key] = value;
    }
  }

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

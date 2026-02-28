// ============================================================
// C4 Architecture Diagram — Parser
// ============================================================

import type { PaletteColors } from '../palettes';
import type { DgmoError } from '../diagnostics';
import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';
import { matchTagBlockHeading } from '../utils/tag-groups';
import { inferParticipantType } from '../sequence/participant-inference';
import {
  measureIndent,
  extractColor,
  parsePipeMetadata,
  CHART_TYPE_RE,
  TITLE_RE,
  OPTION_RE,
} from '../utils/parsing';
import type {
  ParsedC4,
  C4Element,
  C4ElementType,
  C4Shape,
  C4ArrowType,
  C4Relationship,
  C4Group,
  C4DeploymentNode,
} from './types';

// ============================================================
// Regex patterns
// ============================================================

const CONTAINER_RE = /^\[([^\]]+)\]$/;

/** Matches element declarations: `person Name`, `system Name | k: v` */
const ELEMENT_RE = /^(person|system|container|component)\s+(.+)$/i;

/** Matches `is a <shape>` in the element name portion */
const IS_A_RE = /\s+is\s+a(?:n)?\s+(\w+)\s*$/i;

/** Matches relationship arrows: `->`, `~>`, `<->`, `<~>` */
const RELATIONSHIP_RE = /^(<?-?>|<?~?>)\s+(.+)$/;

/** Labeled arrow relationships: -label->, ~label~>, <-label->, <~label~> */
const C4_LABELED_SYNC_RE = /^-(.+)->\s+(.+)$/;
const C4_LABELED_ASYNC_RE = /^~(.+)~>\s+(.+)$/;
const C4_LABELED_BIDI_SYNC_RE = /^<-(.+)->\s+(.+)$/;
const C4_LABELED_BIDI_ASYNC_RE = /^<~(.+)~>\s+(.+)$/;

/** Matches section headers: `containers:`, `components:`, `deployment:` */
const SECTION_HEADER_RE = /^(containers|components|deployment)\s*:\s*$/i;

/** Matches `container X` references inside deployment nodes */
const CONTAINER_REF_RE = /^container\s+(.+)$/i;

/** Matches indented metadata: `key: value` */
const METADATA_RE = /^([^:]+):\s*(.+)$/;

// ============================================================
// Helpers
// ============================================================


const VALID_ELEMENT_TYPES = new Set<string>([
  'person',
  'system',
  'container',
  'component',
]);

const VALID_SHAPES = new Set<string>([
  'default',
  'database',
  'cache',
  'queue',
  'cloud',
  'external',
]);

const ALL_CHART_TYPES = [
  'c4',
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
  'kanban',
];

/** Map from ParticipantType inference → C4Shape */
function participantTypeToC4Shape(
  pType: string,
): C4Shape {
  switch (pType) {
    case 'database':
      return 'database';
    case 'cache':
      return 'cache';
    case 'queue':
      return 'queue';
    case 'external':
      return 'external';
    case 'networking':
      return 'cloud';
    default:
      return 'default';
  }
}

/** Infer C4Shape from element name and optional technology value. */
function inferC4Shape(name: string, tech?: string): C4Shape {
  // Try tech value first (more specific)
  if (tech) {
    const techShape = participantTypeToC4Shape(inferParticipantType(tech));
    if (techShape !== 'default') return techShape;
  }
  // Fall back to name inference
  return participantTypeToC4Shape(inferParticipantType(name));
}

function parseArrowType(arrow: string): C4ArrowType | null {
  switch (arrow) {
    case '->':
      return 'sync';
    case '~>':
      return 'async';
    case '<->':
      return 'bidirectional';
    case '<~>':
      return 'bidirectional-async';
    default:
      return null;
  }
}

/** Parse relationship label and optional [technology] annotation. */
function parseRelationshipBody(
  body: string,
): { target: string; label?: string; technology?: string } {
  // Format: `Target: label [tech]` or `Target: label` or `Target`
  const colonIdx = body.indexOf(':');
  let target: string;
  let rest: string;

  if (colonIdx > 0) {
    target = body.substring(0, colonIdx).trim();
    rest = body.substring(colonIdx + 1).trim();
  } else {
    target = body.trim();
    rest = '';
  }

  if (!rest) return { target };

  // Extract [technology] from end of rest
  const techMatch = rest.match(/\[([^\]]+)\]\s*$/);
  if (techMatch) {
    const label = rest.substring(0, techMatch.index!).trim() || undefined;
    return { target, label, technology: techMatch[1].trim() };
  }

  return { target, label: rest };
}


// ============================================================
// Stack entry types
// ============================================================

interface ElementStackEntry {
  kind: 'element';
  element: C4Element;
  indent: number;
}

interface GroupStackEntry {
  kind: 'group';
  group: C4Group;
  parentElement: C4Element;
  indent: number;
}

interface SectionStackEntry {
  kind: 'section';
  sectionType: 'containers' | 'components';
  parentElement: C4Element;
  indent: number;
}

interface DeploymentStackEntry {
  kind: 'deployment';
  node: C4DeploymentNode;
  indent: number;
}

type StackEntry =
  | ElementStackEntry
  | GroupStackEntry
  | SectionStackEntry
  | DeploymentStackEntry;

// ============================================================
// Parser
// ============================================================

export function parseC4(
  content: string,
  palette?: PaletteColors,
): ParsedC4 {
  const result: ParsedC4 = {
    title: null,
    titleLineNumber: null,
    options: {},
    tagGroups: [],
    elements: [],
    relationships: [],
    deployment: [],
    diagnostics: [],
    error: null,
  };

  const pushError = (line: number, message: string, severity: 'error' | 'warning' = 'error'): void => {
    const diag = makeDgmoError(line, message, severity);
    result.diagnostics.push(diag);
    if (!result.error && severity === 'error') result.error = formatDgmoError(diag);
  };

  const fail = (line: number, message: string): ParsedC4 => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  if (!content || !content.trim()) {
    return fail(0, 'No content provided');
  }

  const lines = content.split('\n');
  let contentStarted = false;
  let sawChartType = false;
  let inDeployment = false;

  // Tag group parsing state
  let currentTagGroup: TagGroup | null = null;
  const aliasMap = new Map<string, string>();

  // Name uniqueness tracking
  const knownNames = new Map<string, number>(); // name → lineNumber

  // Indent stack for hierarchy tracking
  const stack: StackEntry[] = [];

  // Deployment indent stack
  const deployStack: { node: C4DeploymentNode; indent: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      if (currentTagGroup) currentTagGroup = null;
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
        if (chartType !== 'c4') {
          let msg = `Expected chart type "c4", got "${chartType}"`;
          const hint = suggest(chartType, ALL_CHART_TYPES);
          if (hint) msg += `. ${hint}`;
          return fail(lineNumber, msg);
        }
        sawChartType = true;
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

    // Tag group heading — `tag: Name` (new) or `## Name` (deprecated)
    // Must be checked BEFORE OPTION_RE to prevent `tag: Rank` being swallowed as option
    const tagBlockMatch = matchTagBlockHeading(trimmed);
    if (tagBlockMatch) {
      if (contentStarted) {
        pushError(lineNumber, 'Tag groups must appear before content');
        continue;
      }
      if (tagBlockMatch.deprecated) {
        pushError(lineNumber, `'## ${tagBlockMatch.name}' is deprecated for tag groups — use 'tag: ${tagBlockMatch.name}' instead`, 'warning');
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

    // Generic header options
    if (!contentStarted && !currentTagGroup && measureIndent(line) === 0) {
      const optMatch = trimmed.match(OPTION_RE);
      if (optMatch) {
        const key = optMatch[1].trim().toLowerCase();
        if (key !== 'chart' && key !== 'title') {
          result.options[key] = optMatch[2].trim();
          continue;
        }
      }
    }

    // Tag group entries
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
      currentTagGroup = null;
    }

    // --- Content phase ---
    contentStarted = true;
    currentTagGroup = null;

    if (!sawChartType) {
      return fail(lineNumber, 'Missing "chart: c4" header');
    }

    const indent = measureIndent(line);

    // ── Deployment section ──────────────────────────────────
    if (inDeployment) {
      // Pop deployment stack for decreased indent
      while (deployStack.length > 0) {
        const top = deployStack[deployStack.length - 1];
        if (top.indent < indent) break;
        deployStack.pop();
      }

      // Check for top-level non-deployment content (section ended)
      if (indent === 0 && ELEMENT_RE.test(trimmed)) {
        inDeployment = false;
        // Fall through to element parsing below
      } else {
        // container X reference?
        const refMatch = trimmed.match(CONTAINER_REF_RE);
        if (refMatch) {
          const refName = refMatch[1].trim();
          if (deployStack.length > 0) {
            deployStack[deployStack.length - 1].node.containerRefs.push(
              refName,
            );
          } else {
            pushError(lineNumber, `"container ${refName}" must be inside a deployment node`);
          }
          continue;
        }

        // Otherwise it's a deployment node (possibly with pipe metadata)
        const segments = trimmed.split('|').map((s) => s.trim());
        const nodeName = segments[0];
        const metadata = parsePipeMetadata(segments, aliasMap);
        const shape = inferC4Shape(nodeName, metadata.tech ?? metadata.technology);

        const dNode: C4DeploymentNode = {
          name: nodeName,
          metadata,
          shape,
          children: [],
          containerRefs: [],
          lineNumber,
        };

        if (deployStack.length > 0) {
          deployStack[deployStack.length - 1].node.children.push(dNode);
        } else {
          result.deployment.push(dNode);
        }
        deployStack.push({ node: dNode, indent });
        continue;
      }
    }

    // ── Section headers ─────────────────────────────────────
    const sectionMatch = trimmed.match(SECTION_HEADER_RE);
    if (sectionMatch) {
      const sectionType = sectionMatch[1].toLowerCase();

      if (sectionType === 'deployment') {
        inDeployment = true;
        continue;
      }

      // containers: / components: must be inside an element
      const parentEntry = findParentElement(indent, stack);
      if (parentEntry) {
        parentEntry.element.sectionHeader =
          sectionType as 'containers' | 'components';
        parentEntry.element.sectionHeaderLineNumber = lineNumber;
        stack.push({
          kind: 'section',
          sectionType: sectionType as 'containers' | 'components',
          parentElement: parentEntry.element,
          indent,
        });
      } else {
        pushError(
          lineNumber,
          `"${sectionType}:" must be inside an element`,
        );
      }
      continue;
    }

    // ── Pop stack for decreased indent ──────────────────────
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.indent < indent) break;
      stack.pop();
    }

    // ── Group boundaries: [Group Name] ──────────────────────
    const containerMatch = trimmed.match(CONTAINER_RE);
    if (containerMatch) {
      const groupName = containerMatch[1].trim();
      const parentEntry = findParentElement(indent, stack);
      if (parentEntry) {
        const group: C4Group = {
          name: groupName,
          children: [],
          lineNumber,
        };
        parentEntry.element.groups.push(group);
        stack.push({
          kind: 'group',
          group,
          parentElement: parentEntry.element,
          indent,
        });
      } else {
        pushError(lineNumber, `Group [${groupName}] must be inside an element`);
      }
      continue;
    }

    // ── Labeled arrow relationships: -label->, ~label~>, <-label->, <~label~> ──
    // Must be checked BEFORE plain RELATIONSHIP_RE to avoid partial matches
    {
      const labeledPatterns: {
        re: RegExp;
        arrowType: C4ArrowType;
      }[] = [
        { re: C4_LABELED_BIDI_SYNC_RE, arrowType: 'bidirectional' },
        { re: C4_LABELED_BIDI_ASYNC_RE, arrowType: 'bidirectional-async' },
        { re: C4_LABELED_SYNC_RE, arrowType: 'sync' },
        { re: C4_LABELED_ASYNC_RE, arrowType: 'async' },
      ];
      let labeledHandled = false;
      for (const { re, arrowType } of labeledPatterns) {
        const m = trimmed.match(re);
        if (!m) continue;
        const rawLabel = m[1].trim();
        const targetBody = m[2].trim();
        if (!rawLabel) break; // empty label — fall through to plain arrow

        // Extract [technology] from end of label
        let label: string | undefined = rawLabel;
        let technology: string | undefined;
        const techMatch = rawLabel.match(/\[([^\]]+)\]\s*$/);
        if (techMatch) {
          label = rawLabel.substring(0, techMatch.index!).trim() || undefined;
          technology = techMatch[1].trim();
        }

        const rel: C4Relationship = {
          target: targetBody,
          label,
          technology,
          arrowType,
          lineNumber,
        };

        const parentEntry = findParentElement(indent, stack);
        if (parentEntry) {
          parentEntry.element.relationships.push(rel);
        } else {
          result.relationships.push(rel);
        }
        labeledHandled = true;
        break;
      }
      if (labeledHandled) continue;
    }

    // ── Relationships ───────────────────────────────────────
    const relMatch = trimmed.match(RELATIONSHIP_RE);
    if (relMatch) {
      const arrowType = parseArrowType(relMatch[1]);
      if (arrowType) {
        const { target, label, technology } = parseRelationshipBody(
          relMatch[2],
        );
        const rel: C4Relationship = {
          target,
          label,
          technology,
          arrowType,
          lineNumber,
        };

        // Attach to nearest parent element
        const parentEntry = findParentElement(indent, stack);
        if (parentEntry) {
          parentEntry.element.relationships.push(rel);
        } else {
          // Top-level relationship (orphan) — add to result-level relationships
          result.relationships.push(rel);
        }
        continue;
      }
    }

    // ── Element declarations ────────────────────────────────
    const elementMatch = trimmed.match(ELEMENT_RE);
    if (elementMatch) {
      const elementType = elementMatch[1].toLowerCase() as C4ElementType;
      let nameAndRest = elementMatch[2];

      // Split on pipe for inline metadata
      const segments = nameAndRest.split('|').map((s) => s.trim());
      let namePart = segments[0];

      // Check for `is a <shape>` in the name portion
      let explicitShape: C4Shape | null = null;
      const isAMatch = namePart.match(IS_A_RE);
      if (isAMatch) {
        const shapeName = isAMatch[1].toLowerCase();
        if (VALID_SHAPES.has(shapeName)) {
          explicitShape = shapeName as C4Shape;
        } else {
          pushError(
            lineNumber,
            `Unknown shape "${isAMatch[1]}". Valid shapes: ${[...VALID_SHAPES].join(', ')}`,
          );
        }
        namePart = namePart.substring(0, isAMatch.index!).trim();
      }

      const metadata = parsePipeMetadata(segments, aliasMap);

      // Determine shape: explicit > inference
      const shape =
        explicitShape ??
        inferC4Shape(namePart, metadata.tech ?? metadata.technology);

      const element: C4Element = {
        name: namePart,
        type: elementType,
        shape,
        metadata,
        children: [],
        groups: [],
        relationships: [],
        lineNumber,
      };

      // Check for duplicate name
      const existingLine = knownNames.get(namePart.toLowerCase());
      if (existingLine !== undefined) {
        pushError(
          lineNumber,
          `Duplicate element name "${namePart}" (first defined on line ${existingLine})`,
        );
      } else {
        knownNames.set(namePart.toLowerCase(), lineNumber);
      }

      // Attach to parent or push to top-level
      attachElement(element, indent, stack, result);
      continue;
    }

    // ── Indented metadata (key: value) ──────────────────────
    // Only if we have a parent element and line doesn't look like a keyword
    const metadataMatch = trimmed.match(METADATA_RE);
    if (metadataMatch && !ELEMENT_RE.test(trimmed)) {
      const parentEntry = findParentElement(indent, stack);
      if (parentEntry) {
        const rawKey = metadataMatch[1].trim().toLowerCase();

        // Special case: `import: file.dgmo`
        if (rawKey === 'import') {
          parentEntry.element.importPath = metadataMatch[2].trim();
          continue;
        }

        const key = aliasMap.get(rawKey) ?? rawKey;
        const value = metadataMatch[2].trim();
        parentEntry.element.metadata[key] = value;
        continue;
      }
    }

    // ── Unknown line ────────────────────────────────────────
    // Check if it looks like a misspelled element keyword
    const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
    if (firstWord.length > 3) {
      const hint = suggest(firstWord, [...VALID_ELEMENT_TYPES]);
      if (hint) {
        pushError(lineNumber, `Unknown keyword "${firstWord}". ${hint}`);
        continue;
      }
    }

    // If inside a parent, could be an unkeyed description or misc text — ignore gracefully
    const parent = findParentElement(indent, stack);
    if (!parent) {
      pushError(lineNumber, `Unexpected content: "${trimmed}"`);
    }
  }

  // ── Post-parse validation ───────────────────────────────
  validateRelationshipTargets(result, knownNames, pushError);
  validateDeploymentRefs(result, knownNames, pushError);

  return result;
}

// ============================================================
// Attachment helpers
// ============================================================

/** Find the nearest parent element entry on the stack at shallower indent. */
function findParentElement(
  indent: number,
  stack: StackEntry[],
): ElementStackEntry | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];
    if (entry.indent >= indent) continue;
    if (entry.kind === 'element') return entry;
    if (entry.kind === 'group') {
      // Walk further up to find the element that owns this group
      continue;
    }
    if (entry.kind === 'section') {
      // The section's parent element is the attachment target
      return {
        kind: 'element',
        element: entry.parentElement,
        indent: entry.indent,
      };
    }
  }
  return null;
}

function attachElement(
  element: C4Element,
  indent: number,
  stack: StackEntry[],
  result: ParsedC4,
): void {
  // Find the immediate context: group, section, or parent element
  let attached = false;

  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];
    if (entry.indent >= indent) continue;

    if (entry.kind === 'group') {
      // Attach to the group
      entry.group.children.push(element);
      attached = true;
      break;
    }
    if (entry.kind === 'section') {
      // Attach as child of the section's parent element
      entry.parentElement.children.push(element);
      attached = true;
      break;
    }
    if (entry.kind === 'element') {
      entry.element.children.push(element);
      attached = true;
      break;
    }
  }

  if (!attached) {
    result.elements.push(element);
  }

  stack.push({ kind: 'element', element, indent });
}

// ============================================================
// Post-parse validation
// ============================================================

function collectAllNames(result: ParsedC4): Map<string, number> {
  const names = new Map<string, number>();
  function walk(elements: C4Element[]) {
    for (const el of elements) {
      names.set(el.name.toLowerCase(), el.lineNumber);
      walk(el.children);
      for (const g of el.groups) {
        walk(g.children);
      }
    }
  }
  walk(result.elements);
  return names;
}

function validateRelationshipTargets(
  result: ParsedC4,
  knownNames: Map<string, number>,
  pushWarning: (line: number, message: string, severity?: 'error' | 'warning') => void,
): void {
  function walkRels(elements: C4Element[]) {
    for (const el of elements) {
      for (const rel of el.relationships) {
        if (!knownNames.has(rel.target.toLowerCase())) {
          pushWarning(
            rel.lineNumber,
            `Relationship target "${rel.target}" not found`,
            'warning',
          );
        }
      }
      walkRels(el.children);
      for (const g of el.groups) {
        walkRels(g.children);
      }
    }
  }
  walkRels(result.elements);

  // Also check top-level relationships
  for (const rel of result.relationships) {
    if (!knownNames.has(rel.target.toLowerCase())) {
      pushWarning(
        rel.lineNumber,
        `Relationship target "${rel.target}" not found`,
        'warning',
      );
    }
  }
}

function validateDeploymentRefs(
  result: ParsedC4,
  knownNames: Map<string, number>,
  pushWarning: (line: number, message: string, severity?: 'error' | 'warning') => void,
): void {
  function walkDeploy(nodes: C4DeploymentNode[]) {
    for (const node of nodes) {
      for (const ref of node.containerRefs) {
        if (!knownNames.has(ref.toLowerCase())) {
          pushWarning(
            node.lineNumber,
            `Deployment reference "container ${ref}" not found`,
            'warning',
          );
        }
      }
      walkDeploy(node.children);
    }
  }
  walkDeploy(result.deployment);
}

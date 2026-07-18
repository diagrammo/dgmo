// ============================================================
// C4 Architecture Diagram — Parser
// ============================================================

import type { PaletteColors } from '../palettes';
import {
  formatDgmoError,
  makeDgmoError,
  makeFail,
  suggest,
} from '../diagnostics';
import { parseInArrowLabel } from '../utils/arrows';
import { normalizeName } from '../utils/name-normalize';
import type { TagGroup } from '../utils/tag-groups';
import type { Writable } from '../utils/brand';
import {
  matchTagBlockHeading,
  stripDefaultModifier,
  validateTagGroupNames,
  finalizeAutoTagColors,
  AUTO_TAG_COLOR_SENTINEL,
  tagAttrKey,
} from '../utils/tag-groups';
import { inferParticipantType } from '../sequence/participant-inference';
import {
  measureIndent,
  extractColor,
  splitNameAndMeta,
  parseFirstLine,
  OPTION_NOCOLON_RE,
  warnUnknownMetaKeys,
} from '../utils/parsing';
import { C4_REGISTRY, withTagAliases } from '../utils/reserved-key-registry';
import { tryStripDescriptionKeyword } from '../utils/description-helpers';
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

// Group boundary `[Name]` with an optional collapse marker: canonical bare
// `collapsed` trailing flag (§1.8, decision #48; capture 2, case-sensitive
// lowercase) or legacy `collapsed: <val>` metadata (capture 3). Any other
// tail keeps the line out of this regex, preserving prior diagnostics.
const CONTAINER_RE = /^\[([^\]]+)\](?:\s+(collapsed)|\s+collapsed:\s*(\S+))?$/;

/** Matches element declarations: `person Name`, `system Name | k: v` */
const ELEMENT_RE = /^(person|system|container|component)\s+(.+)$/i;

/** Matches `is a <shape>` in the element name portion */
const IS_A_RE = /\s+is\s+a(?:n)?\s+(\w+)\s*$/i;

/** Matches `Name is a <type>` declarations (new preferred syntax) */
const C4_IS_A_RE =
  /^([^:]+?)\s+is\s+an?\s+(person|system|container|component|external|database)\b(.*)$/i;

/** Matches relationship arrows: `->`, `~>`, `<->`, `<~>` */
const RELATIONSHIP_RE = /^(<?-?>|<?~?>)\s*(.+)$/;

/**
 * Labeled arrow relationships: -label->, ~label~>, <-label->, <~label~>.
 * Label captured lazily so a line splits at the FIRST arrow — matches every
 * other chart parser (which use lazy `.+?`); greedy `.+` split at the last.
 */
const C4_LABELED_SYNC_RE = /^-(.+?)->\s*(.+)$/;
const C4_LABELED_ASYNC_RE = /^~(.+?)~>\s*(.+)$/;
const C4_LABELED_BIDI_SYNC_RE = /^<-(.+?)->\s*(.+)$/;
const C4_LABELED_BIDI_ASYNC_RE = /^<~(.+?)~>\s*(.+)$/;

/** Matches section headers: `containers`, `components`, `deployment` (bare keyword) */
const SECTION_HEADER_RE = /^(containers|components|deployment)\s*$/i;

/** Matches `container X` references inside deployment nodes */
const CONTAINER_REF_RE = /^container\s+(.+)$/i;

/** Matches indented metadata: `key: value` (colon-separated) */
const METADATA_RE = /^([a-z][a-z0-9-]*):\s+(.+)$/i;

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

/** Known top-level option keys for C4 diagrams. */
const KNOWN_C4_OPTIONS = new Set<string>(['layout', 'active-tag']);

/** Known C4 boolean options (bare keyword = on). */
const KNOWN_C4_BOOLEANS = new Set<string>([
  'direction-tb',
  'direction-lr',
  'fill-tint',
  'fill-solid',
  'fill-outline',
  'no-title',
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
function participantTypeToC4Shape(pType: string): C4Shape {
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

/**
 * Pull metadata out of a c4 line tail (the part after `name is a type`
 * or after a target identifier), accepting both legacy and new forms:
 *   - legacy: `| k: v, k: v`
 *   - new (§1.4): `k: v, k: v`
 * Returns `{}` when the tail has no metadata.
 */
function parseC4MetaTail(
  tail: string,
  metaAliasMap: Map<string, string>
): Record<string, string> {
  const trimmed = tail.trim();
  if (!trimmed) return {};
  if (!trimmed.includes(':')) {
    // Non-empty tail with no `key:` — the removed bare-description/tech form.
    // The caller hard-errors on this (1.0 freeze) before rendering; this stays
    // a safe fallback that returns no metadata.
    return {};
  }
  const registry = withTagAliases(C4_REGISTRY, new Set(metaAliasMap.keys()));
  // Force the whole tail into the metadata region by leading with the
  // always-reserved `color:` key (sentinel), then drop that pair. This
  // parses every `key: value` pair regardless of whether the first key
  // is reserved (matching the prior same-line metadata behavior).
  const split = splitNameAndMeta(
    `color: __c4ph, ${trimmed}`,
    registry,
    metaAliasMap
  );
  const meta = split.meta;
  if (meta['color'] === '__c4ph') delete meta['color'];
  return meta;
}

/**
 * Split a name-prefixed line into `{ name, metadata }`. Accepts both:
 *   - legacy: `Name | k: v, k: v`     (first-`|` cut)
 *   - new (§1.4): `Name k: v, k: v`   (first reserved-key cut via
 *     `splitNameAndMeta` against `C4_REGISTRY` plus declared tag
 *     aliases)
 */
function parseC4NameAndMeta(
  text: string,
  metaAliasMap: Map<string, string>
): { name: string; metadata: Record<string, string> } {
  const registry = withTagAliases(C4_REGISTRY, new Set(metaAliasMap.keys()));
  const split = splitNameAndMeta(text, registry, metaAliasMap);
  return { name: split.name, metadata: split.meta };
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

// ============================================================
// Stack entry types
// ============================================================

interface ElementStackEntry {
  kind: 'element';
  element: Writable<C4Element>;
  indent: number;
}

interface GroupStackEntry {
  kind: 'group';
  group: Writable<C4Group>;
  parentElement: Writable<C4Element>;
  indent: number;
}

interface SectionStackEntry {
  kind: 'section';
  sectionType: 'containers' | 'components';
  parentElement: Writable<C4Element>;
  indent: number;
}

interface DeploymentStackEntry {
  kind: 'deployment';
  node: Writable<C4DeploymentNode>;
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

export function parseC4(content: string, palette?: PaletteColors): ParsedC4 {
  const options: Record<string, string> = {};
  const result: Writable<ParsedC4> = {
    title: null,
    titleLineNumber: null,
    options,
    tagGroups: [],
    elements: [],
    relationships: [],
    deployment: [],
    diagnostics: [],
    error: null,
  };

  const pushError = (
    line: number,
    message: string,
    severity: 'error' | 'warning' = 'error'
  ): void => {
    const diag = makeDgmoError(line, message, severity);
    result.diagnostics.push(diag);
    if (!result.error && severity === 'error')
      result.error = formatDgmoError(diag);
  };

  const fail = makeFail(result);

  if (!content?.trim()) {
    return fail(0, 'No content provided');
  }

  const lines = content.split('\n');
  let contentStarted = false;
  let sawChartType = false;
  let inDeployment = false;

  // Tag group parsing state
  let currentTagGroup: Writable<TagGroup> | null = null;
  // metaAliasMap: pipe-metadata-key aliases (`tech:` → `technology:`).
  // Distinct from nameAliasMap below per the A1 naming convention.
  const metaAliasMap = new Map<string, string>();

  // nameAliasMap: TD-18 entity-name aliases (`os` → `Order Service`).
  // Per C8: per-parse, never persisted, fresh each parse.
  const nameAliasMap = new Map<string, string>();
  function resolveNameRef(rawName: string): string {
    return nameAliasMap.get(rawName.trim()) ?? rawName;
  }

  // Name uniqueness tracking
  const knownNames = new Map<string, number>(); // name → lineNumber

  // Sidecar: each element's metadata is a mutable Record we own. The
  // C4Element.metadata field types it as Readonly, so post-construction
  // mutation goes through this map.
  const elementMetadata = new WeakMap<
    Writable<C4Element>,
    Record<string, string>
  >();
  // Sidecar: each element's description is a mutable string[] we own.
  const elementDescription = new WeakMap<Writable<C4Element>, string[]>();

  // Indent stack for hierarchy tracking
  const stack: StackEntry[] = [];

  // Deployment indent stack
  const deployStack: { node: Writable<C4DeploymentNode>; indent: number }[] =
    [];

  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const line = lines[i]!;
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

    // First line: `c4` or `c4 My Title`
    if (!contentStarted && !sawChartType) {
      const firstLine = parseFirstLine(trimmed);
      if (firstLine) {
        if (firstLine.chartType !== 'c4') {
          let msg = `Expected chart type "c4", got "${firstLine.chartType}"`;
          const hint = suggest(firstLine.chartType, ALL_CHART_TYPES);
          if (hint) msg += `. ${hint}`;
          return fail(lineNumber, msg);
        }
        sawChartType = true;
        if (firstLine.title) {
          result.title = firstLine.title;
          result.titleLineNumber = lineNumber;
        }
        continue;
      }
    }

    // Tag group heading — `tag Name as <alias>`
    // Must be checked BEFORE OPTION_RE to prevent `tag: Rank` being swallowed as option
    const tagBlockMatch = matchTagBlockHeading(trimmed);
    if (tagBlockMatch) {
      if (contentStarted) {
        pushError(lineNumber, 'Tag groups must appear before content');
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
      metaAliasMap.set(
        normalizeName(tagBlockMatch.name),
        tagAttrKey(tagBlockMatch.name)
      );
      result.tagGroups.push(currentTagGroup);
      continue;
    }

    // Generic header options (space-separated: `key value` or bare boolean)
    if (!contentStarted && !currentTagGroup && measureIndent(line) === 0) {
      // Bare boolean options
      if (KNOWN_C4_BOOLEANS.has(trimmed.toLowerCase())) {
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

      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch) {
        // Capture groups [1] and [2] guaranteed by regex match.
        const key = optMatch[1]!.trim().toLowerCase();
        if (KNOWN_C4_OPTIONS.has(key)) {
          options[key] = optMatch[2]!.trim();
          continue;
        }
      }
    }

    // Tag group entries — first entry is the default unless another is marked `default`
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
      currentTagGroup = null; // eslint-disable-line no-useless-assignment
    }

    // --- Content phase ---
    contentStarted = true;
    currentTagGroup = null;

    if (!sawChartType) {
      return fail(lineNumber, 'Missing "c4" header');
    }

    const indent = measureIndent(line);

    // ── Deployment section ──────────────────────────────────
    if (inDeployment) {
      // Pop deployment stack for decreased indent
      while (deployStack.length > 0) {
        // In-bounds by length > 0 check.
        const top = deployStack[deployStack.length - 1]!;
        if (top.indent < indent) break;
        deployStack.pop();
      }

      // Check for top-level non-deployment content (section ended)
      if (
        indent === 0 &&
        (C4_IS_A_RE.test(trimmed) || ELEMENT_RE.test(trimmed))
      ) {
        inDeployment = false;
        // Fall through to element parsing below
      } else {
        // container X reference?
        const refMatch = trimmed.match(CONTAINER_REF_RE);
        if (refMatch) {
          // Capture group [1] guaranteed by regex match.
          const refName = refMatch[1]!.trim();
          if (deployStack.length > 0) {
            // In-bounds by length > 0 check.
            deployStack[deployStack.length - 1]!.node.containerRefs.push(
              refName
            );
          } else {
            pushError(
              lineNumber,
              `"container ${refName}" must be indented under a deployment node (e.g. under 'Prod is a deployment-node')`
            );
          }
          continue;
        }

        // Otherwise it's a deployment node (possibly with metadata).
        // Accepts both `Name | k: v` (legacy) and `Name k: v` (§1.4).
        const { name: nodeName, metadata } = parseC4NameAndMeta(
          trimmed,
          metaAliasMap
        );
        warnUnknownMetaKeys(
          metadata,
          withTagAliases(C4_REGISTRY, new Set(metaAliasMap.keys())),
          (msg) => pushError(lineNumber, msg, 'warning'),
          nodeName
        );
        const shape = inferC4Shape(
          nodeName,
          metadata['tech'] ?? metadata['technology']
        );

        const dNode: Writable<C4DeploymentNode> = {
          name: nodeName,
          metadata,
          shape,
          children: [],
          containerRefs: [],
          lineNumber,
        };

        if (deployStack.length > 0) {
          // In-bounds by length > 0 check.
          deployStack[deployStack.length - 1]!.node.children.push(dNode);
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
      // Capture group [1] guaranteed by regex match.
      const sectionType = sectionMatch[1]!.toLowerCase();

      if (sectionType === 'deployment') {
        inDeployment = true;
        continue;
      }

      // containers / components must be inside an element
      const parentEntry = findParentElement(indent, stack);
      if (parentEntry) {
        parentEntry.element.sectionHeader = sectionType as
          | 'containers'
          | 'components';
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
          `"${sectionType}" must be indented under an element (e.g. under 'Web App is a container')`
        );
      }
      continue;
    }

    // ── Pop stack for decreased indent ──────────────────────
    while (stack.length > 0) {
      // In-bounds by length > 0 check.
      const top = stack[stack.length - 1]!;
      if (top.indent < indent) break;
      stack.pop();
    }

    // ── Group boundaries: [Group Name] ──────────────────────
    const containerMatch = trimmed.match(CONTAINER_RE);
    if (containerMatch) {
      // Capture group [1] guaranteed by regex match.
      const groupName = containerMatch[1]!.trim();
      // Canonical bare `collapsed` flag (capture 2) or legacy
      // `collapsed: true` metadata (capture 3).
      const groupCollapsed =
        containerMatch[2] !== undefined ||
        containerMatch[3]?.toLowerCase() === 'true';
      const parentEntry = findParentElement(indent, stack);
      if (parentEntry) {
        const group: Writable<C4Group> = {
          name: groupName,
          children: [],
          ...(groupCollapsed && { collapsed: true }),
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
        pushError(
          lineNumber,
          `Group [${groupName}] must be indented under an element (e.g. under 'Web App is a container')`
        );
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
        // Capture groups [1] and [2] guaranteed by regex match.
        const rawLabel = m[1]!.trim();
        const targetBody = m[2]!.trim();
        if (!rawLabel) break; // empty label — fall through to plain arrow

        // Reject bidirectional arrows
        if (
          arrowType === 'bidirectional' ||
          arrowType === 'bidirectional-async'
        ) {
          const source = findParentElement(indent, stack)?.element.name ?? '?';
          pushError(
            lineNumber,
            `Bidirectional arrows are no longer supported. Replace with two separate arrows:\n  -${rawLabel}-> ${targetBody}\n  ${targetBody} -${rawLabel}-> ${source}`
          );
          labeledHandled = true;
          break;
        }

        // TD-5: the trailing `[tech]` sugar is no longer extracted from the
        // in-arrow label. The entire label stays as the label. Technology
        // metadata comes from post-colon or pipe metadata on the target.
        // Also run TD-13/TD-14 validation on the label characters.
        const labelResult = parseInArrowLabel(rawLabel, lineNumber);
        labelResult.diagnostics.forEach((d) => result.diagnostics.push(d));
        const label: string | undefined = labelResult.label;
        let technology: string | undefined;

        // Extract metadata from target body. Accepts both
        // `Database | tech: SQL` (legacy) and `Database tech: SQL`
        // (§1.4). tech/technology on metadata override `[tech]` in
        // the label.
        const targetParsed = parseC4NameAndMeta(targetBody, metaAliasMap);
        warnUnknownMetaKeys(
          targetParsed.metadata,
          withTagAliases(C4_REGISTRY, new Set(metaAliasMap.keys())),
          (msg) => pushError(lineNumber, msg, 'warning'),
          targetParsed.name
        );
        const target = targetParsed.name;
        if (targetParsed.metadata['tech']) {
          technology = targetParsed.metadata['tech'];
        }
        if (targetParsed.metadata['technology']) {
          technology = targetParsed.metadata['technology'];
        }

        const rel: C4Relationship = {
          target: resolveNameRef(target),
          ...(label !== undefined && { label }),
          ...(technology !== undefined && { technology }),
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

    // ── Relationships (plain arrows: ->, ~>) ─────────────────
    const relMatch = trimmed.match(RELATIONSHIP_RE);
    if (relMatch) {
      // Capture groups [1] and [2] guaranteed by regex match.
      const arrowType = parseArrowType(relMatch[1]!);
      if (arrowType) {
        // Reject bidirectional arrows
        if (
          arrowType === 'bidirectional' ||
          arrowType === 'bidirectional-async'
        ) {
          const arrow = relMatch[1]!;
          const target = relMatch[2]!.trim();
          const source = findParentElement(indent, stack)?.element.name ?? '?';
          pushError(
            lineNumber,
            `'${arrow}' bidirectional arrows are no longer supported. Replace with two separate arrows:\n  -> ${target}\n  ${target} -> ${source}`
          );
          continue;
        }

        // Plain arrow: entire body is the target (no colon label, no technology)
        const target = relMatch[2]!.trim();
        const rel: C4Relationship = {
          target: resolveNameRef(target),
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

    // ── "Name is a type" declarations (preferred syntax) ────
    const isATypeMatch = trimmed.match(C4_IS_A_RE);
    if (isATypeMatch) {
      // Capture groups [1], [2], [3] guaranteed by regex match.
      let namePart = isATypeMatch[1]!.trim();
      const rawType = isATypeMatch[2]!.toLowerCase();
      let remainder = isATypeMatch[3]!;

      // TD-18: peel optional `as <alias>` from the trailing remainder
      // (modifier order: `Name is a TYPE [is a SHAPE] as <alias> [| meta]`).
      const asPostfix = remainder.match(
        /^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*(\|.*)?$/
      );
      if (asPostfix) {
        // Capture groups [1] and [2] guaranteed by regex match.
        nameAliasMap.set(asPostfix[2]!, namePart);
        remainder = (asPostfix[1]! + (asPostfix[3] ?? '')).trim();
      } else {
        // Or peel from the namePart itself in `Name as <alias> is a TYPE` form.
        const asInName = namePart.match(
          /^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/
        );
        if (asInName) {
          // Capture groups [1] and [2] guaranteed by regex match.
          namePart = asInName[1]!.trim();
          nameAliasMap.set(asInName[2]!, namePart);
        }
      }

      // Map external/database to shape overrides with default element type
      let elementType: C4ElementType;
      let explicitShape: C4Shape | null = null;
      if (rawType === 'external') {
        elementType = 'system';
        explicitShape = 'external';
      } else if (rawType === 'database') {
        elementType = 'container';
        explicitShape = 'database';
      } else {
        elementType = rawType as C4ElementType;
      }

      // Parse metadata from remainder. Accepts both legacy
      // (`| k: v, ...`) and new §1.4 (`k: v, ...`) forms.
      const remainderTrimmed = remainder.trim();
      let metaTail = remainderTrimmed;

      // Check for additional `is a <shape>` in the name (e.g., already stripped by C4_IS_A_RE won't happen,
      // but handle remainder like "is a cylinder" after type)
      const remainderIsA = remainderTrimmed.match(
        /^\s*is\s+a(?:n)?\s+(\w+)\s*(.*)$/i
      );
      if (remainderIsA) {
        // Capture groups [1] and [2] guaranteed by regex match.
        const shapeName = remainderIsA[1]!.toLowerCase();
        if (VALID_SHAPES.has(shapeName)) {
          explicitShape = shapeName as C4Shape;
        } else {
          pushError(
            lineNumber,
            `Unknown shape "${remainderIsA[1]}". Valid shapes: ${[...VALID_SHAPES].join(', ')}`
          );
        }
        // Re-parse remainder after shape
        metaTail = remainderIsA[2]!.trim();
      }

      // Also check for `is a <shape>` within the name part itself
      const nameIsAMatch = namePart.match(IS_A_RE);
      if (nameIsAMatch) {
        // Capture group [1] guaranteed by regex match.
        const shapeName = nameIsAMatch[1]!.toLowerCase();
        if (VALID_SHAPES.has(shapeName)) {
          explicitShape = shapeName as C4Shape;
        } else {
          pushError(
            lineNumber,
            `Unknown shape "${nameIsAMatch[1]}". Valid shapes: ${[...VALID_SHAPES].join(', ')}`
          );
        }
        namePart = namePart.substring(0, nameIsAMatch.index!).trim();
      }

      // 1.0 freeze: a non-empty tail after `is a <type>` with no `key:` is the
      // removed bare same-line description/tech form. After the #28 diagnostic-
      // family deletion it was dropped *silently* (data loss). Restore a hard
      // error — `result.error` makes the whole C4 diagram fail to render
      // (renderer bails on `parsed.error`), matching the prefix-form removal.
      const bareTail = metaTail.trim();
      if (bareTail && !bareTail.includes(':')) {
        pushError(
          lineNumber,
          `text after 'is a ${rawType}' must be 'key: value' metadata — '${bareTail}' is not recognized (did you mean 'description: ${bareTail}'?)`
        );
      }

      const metadata = parseC4MetaTail(metaTail, metaAliasMap);

      const shape =
        explicitShape ??
        inferC4Shape(namePart, metadata['tech'] ?? metadata['technology']);

      // Extract description from pipe metadata into dedicated field
      let isADescription: string[] | undefined;
      if ('description' in metadata) {
        const descVal = metadata['description'].trim();
        if (descVal) isADescription = [descVal];
        delete metadata['description'];
      }

      const element: Writable<C4Element> = {
        name: namePart,
        type: elementType,
        shape,
        metadata,
        ...(isADescription !== undefined && { description: isADescription }),
        children: [],
        groups: [],
        relationships: [],
        lineNumber,
      };
      elementMetadata.set(element, metadata);
      if (isADescription !== undefined)
        elementDescription.set(element, isADescription);

      // Check for duplicate name (forgiving: case + whitespace insensitive)
      const key = normalizeName(namePart);
      const existingLine = knownNames.get(key);
      if (existingLine !== undefined) {
        pushError(
          lineNumber,
          `Duplicate element name "${namePart}" (first defined on line ${existingLine})`
        );
      } else {
        knownNames.set(key, lineNumber);
      }

      attachElement(element, indent, stack, result);
      continue;
    }

    // ── Element declarations (deprecated prefix syntax) ─────
    const elementMatch = trimmed.match(ELEMENT_RE);
    if (elementMatch) {
      // Capture groups [1] and [2] guaranteed by regex match.
      const elementType = elementMatch[1]!.toLowerCase() as C4ElementType;
      const nameAndRest = elementMatch[2]!;

      const parsed = parseC4NameAndMeta(nameAndRest, metaAliasMap);
      warnUnknownMetaKeys(
        parsed.metadata,
        withTagAliases(C4_REGISTRY, new Set(metaAliasMap.keys())),
        (msg) => pushError(lineNumber, msg, 'warning'),
        parsed.name
      );
      let namePart = parsed.name;
      const metadata = parsed.metadata;

      // Check for `is a <shape>` in the name portion
      let explicitShape: C4Shape | null = null;
      const isAMatch = namePart.match(IS_A_RE);
      if (isAMatch) {
        // Capture group [1] guaranteed by regex match.
        const shapeName = isAMatch[1]!.toLowerCase();
        if (VALID_SHAPES.has(shapeName)) {
          explicitShape = shapeName as C4Shape;
        } else {
          pushError(
            lineNumber,
            `Unknown shape "${isAMatch[1]}". Valid shapes: ${[...VALID_SHAPES].join(', ')}`
          );
        }
        namePart = namePart.substring(0, isAMatch.index!).trim();
      }

      // Emit deprecation error with migration hint
      pushError(
        lineNumber,
        `'${elementMatch[1]} ${namePart}' prefix syntax is no longer supported — use '${namePart} is a ${elementType}' instead`
      );

      // Determine shape: explicit > inference
      const shape =
        explicitShape ??
        inferC4Shape(namePart, metadata['tech'] ?? metadata['technology']);

      // Extract description from pipe metadata into dedicated field
      let prefixDescription: string[] | undefined;
      if ('description' in metadata) {
        const descVal = metadata['description'].trim();
        if (descVal) prefixDescription = [descVal];
        delete metadata['description'];
      }

      const element: Writable<C4Element> = {
        name: namePart,
        type: elementType,
        shape,
        metadata,
        ...(prefixDescription !== undefined && {
          description: prefixDescription,
        }),
        children: [],
        groups: [],
        relationships: [],
        lineNumber,
      };
      elementMetadata.set(element, metadata);
      if (prefixDescription !== undefined)
        elementDescription.set(element, prefixDescription);

      // Check for duplicate name (forgiving: case + whitespace insensitive)
      const key = normalizeName(namePart);
      const existingLine = knownNames.get(key);
      if (existingLine !== undefined) {
        pushError(
          lineNumber,
          `Duplicate element name "${namePart}" (first defined on line ${existingLine})`
        );
      } else {
        knownNames.set(key, lineNumber);
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
        // Capture groups [1] and [2] guaranteed by regex match.
        const rawKey = metadataMatch[1]!.trim().toLowerCase();

        // Special case: `import: file.dgmo`
        if (rawKey === 'import') {
          parentEntry.element.importPath = metadataMatch[2]!.trim();
          continue;
        }

        const key = metaAliasMap.get(rawKey) ?? rawKey;
        const value = metadataMatch[2]!.trim();

        // Extract description into dedicated field
        if (key === 'description') {
          let desc = elementDescription.get(parentEntry.element);
          if (!desc) {
            desc = [];
            elementDescription.set(parentEntry.element, desc);
            parentEntry.element.description = desc;
          }
          desc.push(value);
          continue;
        }

        const meta = elementMetadata.get(parentEntry.element);
        if (meta) meta[key] = value;
        continue;
      }
    }

    // ── Unknown line ────────────────────────────────────────
    // Check if it looks like a misspelled element keyword
    // split() always produces at least one segment.
    const firstWord = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (firstWord.length > 3) {
      const hint = suggest(firstWord, [...VALID_ELEMENT_TYPES]);
      if (hint) {
        pushError(lineNumber, `Unknown keyword "${firstWord}". ${hint}`);
        continue;
      }
    }

    // If inside a parent, only the `description` keyword attaches as a
    // description; a bare prose line is no longer auto-promoted.
    const parent = findParentElement(indent, stack);
    const descResult = tryStripDescriptionKeyword(trimmed);
    if (parent && descResult.isKeyword && !descResult.needsColon) {
      let desc = elementDescription.get(parent.element);
      if (!desc) {
        desc = [];
        elementDescription.set(parent.element, desc);
        parent.element.description = desc;
      }
      desc.push(descResult.text);
    } else {
      pushError(
        lineNumber,
        `Unexpected content: "${trimmed}". Expected an element ('Web App is a container'), a relationship ('-Uses-> Database'), indented metadata ('tech: React'), or a group ('[Backend]'). (§8)`
      );
    }
  }

  // Assign palette colors to bare (colorless) tag values.
  finalizeAutoTagColors(result.tagGroups as Writable<TagGroup>[], palette);

  // ── Post-parse validation ───────────────────────────────
  validateRelationshipTargets(result, knownNames, pushError);
  validateDeploymentRefs(result, knownNames, pushError);
  validateTagGroupNames(result.tagGroups, (line, msg) =>
    pushError(line, msg, 'warning')
  );

  return result;
}

// ============================================================
// Attachment helpers
// ============================================================

/** Find the nearest parent element entry on the stack at shallower indent. */
function findParentElement(
  indent: number,
  stack: StackEntry[]
): ElementStackEntry | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    // In-bounds by loop guard.
    const entry = stack[i]!;
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
  element: Writable<C4Element>,
  indent: number,
  stack: StackEntry[],
  result: Writable<ParsedC4>
): void {
  // Find the immediate context: group, section, or parent element
  let attached = false;

  for (let i = stack.length - 1; i >= 0; i--) {
    // In-bounds by loop guard.
    const entry = stack[i]!;
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

function validateRelationshipTargets(
  result: ParsedC4,
  knownNames: Map<string, number>,
  pushWarning: (
    line: number,
    message: string,
    severity?: 'error' | 'warning'
  ) => void
): void {
  const allNames = Array.from(knownNames.keys());
  function walkRels(elements: readonly C4Element[]) {
    for (const el of elements) {
      for (const rel of el.relationships) {
        if (!knownNames.has(normalizeName(rel.target))) {
          let msg = `Relationship target "${rel.target}" not found — declare it first (e.g. '${rel.target} is a container'), then reference it in the arrow`;
          const hint = suggest(normalizeName(rel.target), allNames);
          if (hint) msg += `. ${hint}`;
          pushWarning(rel.lineNumber, msg, 'warning');
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
    if (!knownNames.has(normalizeName(rel.target))) {
      let msg = `Relationship target "${rel.target}" not found`;
      const hint = suggest(normalizeName(rel.target), allNames);
      if (hint) msg += `. ${hint}`;
      pushWarning(rel.lineNumber, msg, 'warning');
    }
  }
}

function validateDeploymentRefs(
  result: ParsedC4,
  knownNames: Map<string, number>,
  pushWarning: (
    line: number,
    message: string,
    severity?: 'error' | 'warning'
  ) => void
): void {
  const allNames = Array.from(knownNames.keys());
  function walkDeploy(nodes: readonly C4DeploymentNode[]) {
    for (const node of nodes) {
      for (const ref of node.containerRefs) {
        if (!knownNames.has(normalizeName(ref))) {
          let msg = `Deployment reference "container ${ref}" not found — declare the container element first, then reference it under the deployment node`;
          const hint = suggest(normalizeName(ref), allNames);
          if (hint) msg += `. ${hint}`;
          pushWarning(node.lineNumber, msg, 'warning');
        }
      }
      walkDeploy(node.children);
    }
  }
  walkDeploy(result.deployment);
}

/**
 * Diagram symbol extraction API + completion registry.
 *
 * Provides:
 * - DiagramSymbols interface + extractDiagramSymbols() dispatch
 * - COMPLETION_REGISTRY: chart-type → directives map (for editor autocomplete)
 * - CHART_TYPES: array of { name, description } for chart type completion
 * - METADATA_KEY_SET: derived set of all known directive keys
 *
 * Each diagram type registers its own extractor via registerExtractor().
 * All built-in extractors are registered at module init below.
 */

import { extractSymbols as extractBodySymbols } from './body/parser';
import { extractSymbols as extractErSymbols } from './er/parser';
import { extractSymbols as extractFlowchartSymbols } from './graph/flowchart-parser';
import { extractSymbols as extractInfraSymbols } from './infra/parser';
import { extractSymbols as extractClassSymbols } from './class/parser';
import { extractPertSymbols } from './pert/parser';
import { parseSwimlane } from './swimlane/parser';
import type { SwimShape } from './swimlane/types';
import { parseFirstLine, measureIndent } from './utils/parsing';
import { RECOGNIZED_COLOR_NAMES } from './colors';

const RECOGNIZED_COLOR_SET: ReadonlySet<string> = new Set(
  RECOGNIZED_COLOR_NAMES
);

// ============================================================
// Symbol extraction
// ============================================================

// Types live in ./completion-types so the chart-type parsers can
// import them without taking a cycle through this file.
import type { ChartType, DiagramSymbols, ExtractFn } from './completion-types';
export type { ChartType, DiagramSymbols, ExtractFn };

const extractorRegistry = new Map<ChartType, ExtractFn>();

export function registerExtractor(kind: ChartType, fn: ExtractFn): void {
  extractorRegistry.set(kind, fn);
}

/**
 * Extract diagram symbols from document text.
 * Returns null if the chart type is unknown or has no registered extractor.
 */
export function extractDiagramSymbols(docText: string): DiagramSymbols | null {
  // Parse chartType from first line — bare type name.
  let chartType: string | null = null;
  for (const line of docText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const result = parseFirstLine(trimmed);
    if (result) {
      chartType = result.chartType;
    }
    break; // only check the first non-empty, non-comment line
  }
  if (!chartType) return null;
  const fn = extractorRegistry.get(chartType);
  if (!fn) return null;
  const result = fn(docText);
  // Populate `aliases` uniformly for every chart type so downstream
  // editor surfaces don't need per-extractor branches.
  const aliases = extractAliasDeclarations(docText);
  return Object.keys(aliases).length > 0 ? { ...result, aliases } : result;
}

// ============================================================
// Static completion registries
// ============================================================
//
// The registries below were split into ./completion-registry (the light
// `@diagrammo/dgmo/completion` subpath) so editor front-ends can import them
// without the chart parsers this module pulls in for extraction. They are
// re-exported here so `./completion` stays the single import site for
// everything completion-related inside dgmo and for existing tests.
export * from './completion-registry';
import { METADATA_KEY_SET } from './completion-registry';

// ============================================================
// Sequence extractor
// ============================================================

// Universal Name Handling: source/target accept multi-word + "quoted" names.
// `[^|]+?` captures greedy-to-pipe-or-arrow; the arrow alternation acts as
// the boundary. Caller strips quotes via stripQuotes().
const SEQ_ARROW_RE =
  /^(?:"([^"]+)"|([^|"]+?))\s+(->|-.*->|~>|~.*~>)\s+(?:"([^"]+)"|([^|"]+?))(?:\s|\|.*)?$/;
const SEQ_IS_A_RE = /^(?:"([^"]+)"|([^|":]+?))\s+is\s+an?\s+/i;
const SEQ_SECTION_RE = /^==/;
const SEQ_STRUCTURAL_RE = /^(if|else|loop|parallel|end)\b/i;

function extractSequenceSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Skip first line (chart type)
    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    // Skip metadata lines
    // split(/\s+/) on non-empty `trimmed` always yields at least one element.
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    // Skip sections, structural keywords
    if (SEQ_SECTION_RE.test(trimmed)) continue;
    if (SEQ_STRUCTURAL_RE.test(trimmed)) continue;

    // Arrow lines: A -> B, A -label-> B, A ~> B
    const arrowMatch = trimmed.match(SEQ_ARROW_RE);
    if (arrowMatch) {
      const src = (arrowMatch[1] ?? arrowMatch[2] ?? '').trim();
      const dst = (arrowMatch[4] ?? arrowMatch[5] ?? '').trim();
      if (src && !entities.includes(src)) entities.push(src);
      if (dst && !entities.includes(dst)) entities.push(dst);
      continue;
    }

    // Type declarations: A is a person, A is an actor
    const isAMatch = trimmed.match(SEQ_IS_A_RE);
    if (isAMatch) {
      const name = (isAMatch[1] ?? isAMatch[2] ?? '').trim();
      if (name && !entities.includes(name)) entities.push(name);
      continue;
    }
  }

  return {
    kind: 'sequence',
    entities,
  };
}

// ============================================================
// State extractor
// ============================================================

const STATE_ARROW_RE = /^(\S+)\s+->\s+(\S+)/;

function extractStateSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    // Skip metadata lines
    // split(/\s+/) on non-empty `trimmed` always yields at least one element.
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    const arrowMatch = trimmed.match(STATE_ARROW_RE);
    if (arrowMatch) {
      // Regex captured groups 1 and 2 by successful match; split('|')[0] always defined.
      const src = arrowMatch[1]!.split('|')[0]!.trim();
      const dst = arrowMatch[2]!.split('|')[0]!.trim();
      if (src && !entities.includes(src)) entities.push(src);
      if (dst && !entities.includes(dst)) entities.push(dst);
    }
  }

  return { kind: 'state', entities };
}

// ============================================================
// Tag declaration extraction
// ============================================================

// Matches tag declarations in both forms:
// - `tag Name alias x` (explicit alias keyword)
// - `tag Name x` (shorthand: 1-4 lowercase chars = alias, matching parser's isAliasToken)
const TAG_DECL_EXPLICIT_RE = /^tag\s+(\S+)\s+alias\s+(\S+)/i;
const TAG_DECL_SHORT_RE = /^tag\s+(\S+)\s+([a-z]{1,4})(?:\s|$)/;

/**
 * Extract tag declarations from document text.
 * Returns a map of alias (or full name) → array of tag values.
 * Keys preserve original case for display; use case-insensitive lookup.
 */
export function extractTagDeclarations(docText: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const lines = docText.split('\n');
  let currentAlias: string | null = null;
  let currentValues: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const raw = lines[i]!;
    const trimmed = raw.trim();

    // Check for tag declaration — try explicit `alias` keyword first, then shorthand
    const tagMatch =
      trimmed.match(TAG_DECL_EXPLICIT_RE) ?? trimmed.match(TAG_DECL_SHORT_RE);
    if (tagMatch) {
      // Save previous tag group
      if (currentAlias !== null) {
        result.set(currentAlias, currentValues);
      }
      // Both regexes capture groups 1 (and 2 for explicit) on successful match.
      const name = tagMatch[1]!;
      const alias = tagMatch[2] ?? name;
      currentAlias = alias;
      currentValues = [];
      continue;
    }
    // Also match bare `tag Name` (no alias) — fall through with name as key
    if (/^tag\s+(\S+)\s*$/i.test(trimmed)) {
      if (currentAlias !== null) {
        result.set(currentAlias, currentValues);
      }
      // Regex captured group 1 by successful re-match (test passed above).
      currentAlias = trimmed.match(/^tag\s+(\S+)/i)![1]!;
      currentValues = [];
      continue;
    }

    // Collect indented tag values
    if (
      currentAlias !== null &&
      raw.length > 0 &&
      (raw[0] === ' ' || raw[0] === '\t')
    ) {
      if (trimmed && !trimmed.startsWith('//')) {
        // Strip trailing-token color (§1.5): `Frontend blue` → `Frontend`.
        // Whitespace-split; if the last token is a recognized color word,
        // drop it; otherwise the whole trimmed string is the value.
        const lastSpaceIdx = trimmed.lastIndexOf(' ');
        const value =
          lastSpaceIdx > 0 &&
          RECOGNIZED_COLOR_SET.has(trimmed.substring(lastSpaceIdx + 1))
            ? trimmed.substring(0, lastSpaceIdx).trim()
            : trimmed;
        if (value) currentValues.push(value);
      }
      continue;
    }

    // Non-indented non-tag line ends the current tag block
    if (currentAlias !== null && trimmed) {
      result.set(currentAlias, currentValues);
      currentAlias = null;
      currentValues = [];
    }
  }

  // Save last tag group
  if (currentAlias !== null) {
    result.set(currentAlias, currentValues);
  }

  return result;
}

// ============================================================
// Universal alias extractor (`Name as <alias>` postfix)
// ============================================================

// Postfix-alias form on any name-slot line. Caller-agnostic — runs
// over the full document so every chart-type extractor can populate
// `DiagramSymbols.aliases` consistently.
const ALIAS_POSTFIX_DECL_RE =
  /(?:^|[^|/])\s*(.+?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*(?:\|.*)?$/;

/**
 * Scan document text for `Name as <alias>` declarations.
 *
 * Returns `Record<alias, canonical-fragment>`. The canonical may
 * still carry color/type modifiers (the per-parser logic peels
 * those off at parse time); for autocomplete display purposes the
 * raw fragment is good enough.
 *
 * Pure helper — does NOT enforce strict-ordering, collisions, or
 * other semantic rules. Those are parser-side checks.
 */
export function extractAliasDeclarations(
  docText: string
): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const raw of docText.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const match = trimmed.match(ALIAS_POSTFIX_DECL_RE);
    if (!match) continue;
    // Regex captured groups 1 and 2 by successful match.
    const canonical = match[1]!.trim();
    const alias = match[2]!;
    // Skip if canonical itself looks structural (arrow / pipe-only / brackets-only)
    if (!canonical || canonical === '[' || canonical === ']') continue;
    if (!(alias in aliases)) {
      aliases[alias] = canonical;
    }
  }
  return aliases;
}

// ============================================================
// Sitemap extractor
// ============================================================

const SITEMAP_CONTAINER_RE = /^\[([^\]]+)\]/;
const SITEMAP_ARROW_RE = /^-.*->\s*(.+)$/;
const SITEMAP_BARE_ARROW_RE = /^->\s*(.+)$/;
const SITEMAP_METADATA_RE = /^([^:]+):\s*(.+)$/;

function extractSitemapSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;
  let inTagBlock = false;
  let lastNodeIndent = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    // Skip metadata lines
    // split(/\s+/) on non-empty `trimmed` always yields at least one element.
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    // Track tag blocks
    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }

    // Containers: [GroupName]
    const containerMatch = trimmed.match(SITEMAP_CONTAINER_RE);
    if (containerMatch) {
      // Regex captured group 1 by successful match; split('|')[0] always defined.
      const name = containerMatch[1]!.split('|')[0]!.trim();
      if (name && !entities.includes(name)) entities.push(name);
      lastNodeIndent = indent;
      continue;
    }

    // Arrows: -> Target or -label-> Target
    const bareArrow = trimmed.match(SITEMAP_BARE_ARROW_RE);
    const labeledArrow = !bareArrow ? trimmed.match(SITEMAP_ARROW_RE) : null;
    if (bareArrow || labeledArrow) {
      // split('|')[0] always defined on any string.
      const target = (bareArrow?.[1] ?? labeledArrow?.[1] ?? '')
        .split('|')[0]!
        .trim();
      if (target && !entities.includes(target)) entities.push(target);
      continue;
    }

    // Indented metadata under a node (key: value) — skip
    if (
      indent > 0 &&
      lastNodeIndent >= 0 &&
      indent > lastNodeIndent &&
      SITEMAP_METADATA_RE.test(trimmed)
    ) {
      continue;
    }

    // Page label (anything else that's not special)
    // split('|')[0] always defined on any string.
    const label = trimmed.split('|')[0]!.trim();
    if (label) {
      if (!entities.includes(label)) entities.push(label);
      lastNodeIndent = indent;
    }
  }

  return { kind: 'sitemap', entities };
}

// ============================================================
// C4 extractor
// ============================================================

const C4_ELEMENT_RE = /^(person|system|container|component)\s+(.+)$/i;
const C4_IS_A_RE =
  /^(.+?)\s+is\s+an?\s+(person|system|container|component|external|database)\b/i;
const C4_ARROW_RE =
  /^(\S+)\s+(?:->|-.*->|~>|~.*~>|<->|<-.*->|<~>|<~.*~>)\s+(\S+)/;
const C4_SECTION_RE = /^(containers|components|deployment)\s*$/i;

function extractC4Symbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;
  let inTagBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    // split(/\s+/) on non-empty `trimmed` always yields at least one element.
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }

    // Skip section headers
    if (C4_SECTION_RE.test(trimmed)) continue;

    // Element declaration: person Name, system Name, etc.
    const elemMatch = trimmed.match(C4_ELEMENT_RE);
    if (elemMatch) {
      // Regex captured group 2 by successful match; split('|')[0] always defined.
      const name = elemMatch[2]!.split('|')[0]!.trim();
      if (name && !entities.includes(name)) entities.push(name);
      continue;
    }

    // Is-a declaration: Name is a person
    const isAMatch = trimmed.match(C4_IS_A_RE);
    if (isAMatch) {
      // Regex captured group 1 by successful match; split('|')[0] always defined.
      const name = isAMatch[1]!.split('|')[0]!.trim();
      if (name && !entities.includes(name)) entities.push(name);
      continue;
    }

    // Arrow lines: Source -> Target, Source ~> Target, etc.
    const arrowMatch = trimmed.match(C4_ARROW_RE);
    if (arrowMatch) {
      // Regex captured groups 1 and 2 by successful match; split('|')[0] always defined.
      const src = arrowMatch[1]!.split('|')[0]!.trim();
      const dst = arrowMatch[2]!.split('|')[0]!.trim();
      if (src && !entities.includes(src)) entities.push(src);
      if (dst && !entities.includes(dst)) entities.push(dst);
      continue;
    }
  }

  return {
    kind: 'c4',
    entities,
  };
}

// ============================================================
// Gantt extractor
// ============================================================

const GANTT_LEGACY_DURATION_RE =
  /^(\d+(?:\.\d+)?)(min|bd|sp|d|w|m|q|y|h|s)\??\s+(.+)$/;
const GANTT_LEGACY_DATE_RE = /^(\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?)\s+(.+)$/;
const GANTT_GROUP_RE = /^\[(.+?)\]/;
const GANTT_STRUCTURAL_RE = /^(era|marker|holiday|workweek|parallel)\b/i;
const GANTT_META_KEY_RE = /\b(?:duration|start):\s/;

function extractGanttSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;
  let inTagBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    // split(/\s+/) on non-empty `trimmed` always yields at least one element.
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }

    // Groups: [GroupName]
    const groupMatch = trimmed.match(GANTT_GROUP_RE);
    if (groupMatch) {
      const name = groupMatch[1]!.trim();
      if (name && !entities.includes(name)) entities.push(name);
      continue;
    }

    // New syntax: Task Name duration: 5d or Task Name start: 2024-01-15
    // (checked before structural keyword skip so "Era of Innovation duration: 5d" isn't skipped)
    if (GANTT_META_KEY_RE.test(trimmed)) {
      const cutIdx = trimmed.search(
        /\b(?:duration|start|progress|offset|color|description):\s/
      );
      if (cutIdx > 0) {
        let taskName = trimmed.substring(0, cutIdx).trim();
        const arrowIdx = taskName.indexOf('->');
        if (arrowIdx > 0)
          taskName = taskName
            .substring(0, arrowIdx)
            .replace(/-[^>]*$/, '')
            .trim();
        if (taskName && !entities.includes(taskName)) entities.push(taskName);
        continue;
      }
    }

    // Skip structural keywords (after new-syntax check so "Era of Innovation duration: 5d" isn't skipped)
    if (GANTT_STRUCTURAL_RE.test(trimmed)) continue;

    // Legacy: Tasks by duration: 30d Task Name
    const durMatch = trimmed.match(GANTT_LEGACY_DURATION_RE);
    if (durMatch) {
      let taskName = durMatch[3]!.split('|')[0]!.trim();
      const arrowIdx = taskName.indexOf('->');
      if (arrowIdx > 0)
        taskName = taskName
          .substring(0, arrowIdx)
          .replace(/-[^>]*$/, '')
          .trim();
      if (taskName && !entities.includes(taskName)) entities.push(taskName);
      continue;
    }

    // Legacy: Tasks by date: 2024-01-15 Task Name
    const dateMatch = trimmed.match(GANTT_LEGACY_DATE_RE);
    if (dateMatch) {
      let taskName = dateMatch[2]!.split('|')[0]!.trim();
      const arrowIdx = taskName.indexOf('->');
      if (arrowIdx > 0)
        taskName = taskName
          .substring(0, arrowIdx)
          .replace(/-[^>]*$/, '')
          .trim();
      if (taskName && !entities.includes(taskName)) entities.push(taskName);
      continue;
    }
  }

  return { kind: 'gantt', entities };
}

// ============================================================
// Boxes-and-lines extractor
// ============================================================

const BL_ARROW_RE = /^(\S+)\s+(?:-.*)?(?:->|<->)\s+(\S+)/;

function extractBoxesAndLinesSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;
  let inTagBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    // split(/\s+/) on non-empty `trimmed` always yields at least one element.
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }

    // Skip groups
    if (/^\[.+?\]/.test(trimmed)) continue;

    // Edge lines
    const arrowMatch = trimmed.match(BL_ARROW_RE);
    if (arrowMatch) {
      // Regex captured groups 1 and 2 by successful match; split('|')[0] always defined.
      const src = arrowMatch[1]!.split('|')[0]!.trim();
      const dst = arrowMatch[2]!.split('|')[0]!.trim();
      if (src && !entities.includes(src)) entities.push(src);
      if (dst && !entities.includes(dst)) entities.push(dst);
      continue;
    }

    // Node lines
    // split('|')[0] and chained split('[')[0] always defined on any string.
    const label = trimmed.split('|')[0]!.split('[')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'boxes-and-lines', entities };
}

// ============================================================
// Org extractor
// ============================================================

const ORG_GROUP_RE = /^\[(.+?)\]/;

function extractOrgSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;
  let inTagBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }

    // Team/group headers: [Team Name]
    const groupMatch = trimmed.match(ORG_GROUP_RE);
    if (groupMatch) {
      const name = groupMatch[1]!.split('|')[0]!.trim();
      if (name && !entities.includes(name)) entities.push(name);
      continue;
    }

    // Skip indented metadata lines (key: value)
    if (indent > 0 && /^[a-z]+\s*:/.test(trimmed)) continue;

    // Person name (indent 0 or direct child)
    const label = trimmed.split('|')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'org', entities };
}

// ============================================================
// Family extractor — person names for reference completion
// ============================================================

function extractFamilySymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;
  let inTagBlock = false;

  const add = (raw: string): void => {
    let s = raw.trim();
    // Strip trailing `key:` metadata, a bare `adopted` token, and quotes.
    const mIdx = s.search(/\s[A-Za-z][\w-]*\s*:/);
    if (mIdx >= 0) s = s.slice(0, mIdx);
    s = s.replace(/\s+adopted\s*$/i, '');
    s = s
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim();
    if (s && !entities.includes(s)) entities.push(s);
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }
    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    // Union line → both sides; person/child line → the single name.
    for (const side of trimmed.split(/\s+\+\s+/)) add(side);
  }

  return { kind: 'family', entities };
}

// ============================================================
// Kanban extractor
// ============================================================

const KANBAN_COLUMN_RE = /^\[(.+?)\]/;

function extractKanbanSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;
  let inTagBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }

    // Column headers: [Column Name]
    const colMatch = trimmed.match(KANBAN_COLUMN_RE);
    if (colMatch) {
      const name = colMatch[1]!.split('|')[0]!.trim();
      if (name && !entities.includes(name)) entities.push(name);
      continue;
    }

    // Card names (indented under columns)
    if (indent > 0) {
      const label = trimmed.split('|')[0]!.trim();
      if (label && !entities.includes(label)) entities.push(label);
    }
  }

  return { kind: 'kanban', entities };
}

// ============================================================
// Mindmap extractor
// ============================================================

function extractMindmapSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;
  let inTagBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }

    // Skip indented metadata (description:, collapsed:)
    if (/^(description|collapsed)\s*:/i.test(trimmed)) continue;

    // Node name (at any indent level)
    const label = trimmed.split('|')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'mindmap', entities };
}

// ============================================================
// Treemap extractor
// ============================================================

function extractTreemapSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;
  let inTagBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    // Directives and tag blocks are not node entities.
    if (
      /^(depth|heat|no-[a-z]+)\s/i.test(trimmed) ||
      /^(no-[a-z]+|radial)$/i.test(trimmed)
    )
      continue;
    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }

    // Node name: strip same-line metadata + the bare trailing value number.
    let label = trimmed.split(/\s+\w+:/)[0]!.trim();
    label = label.replace(/\s+-?\d[\d_,.]*$/, '').trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'treemap', entities };
}

/** Block-diagram symbols: every `[Label]` on a grid row (skips tag blocks and
 *  the `columns` / `no-*` directives). */
function extractBlockSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;
  let inTagBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }
    if (/^(columns|no-[a-z]+)\b/i.test(trimmed)) continue;
    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }
    const re = /\[([^\]]*)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(trimmed)) !== null) {
      const label = m[1]!.trim();
      if (label && !entities.includes(label)) entities.push(label);
    }
  }

  return { kind: 'block', entities };
}

/** Sketch symbols: shape labels, aliases, and box labels — everything an
 *  edge line can reference (spec §31.4). */
function extractSketchSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  const push = (value: string): void => {
    const v = value.trim();
    if (v && !entities.includes(v)) entities.push(v);
  };
  let pastFirstLine = false;
  let inTagBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }
    if (/^(no-[a-z-]+|fill-tint|fill-solid|fill-outline)\s*$/i.test(trimmed))
      continue;
    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }
    if (/^[<\-~]/.test(trimmed)) continue; // edge line
    const boxMatch = trimmed.match(
      /^\[([^\]]+)\]\s*(?:as\s+([A-Za-z][A-Za-z0-9_]{0,11}))?/
    );
    if (boxMatch) {
      push(boxMatch[1]!);
      if (boxMatch[2]) push(boxMatch[2]);
      continue;
    }
    // Shape line: cut metadata at the first reserved key, peel `as alias`.
    let name = trimmed;
    const metaCut = name.search(/\s(?:shape|at|collapsed)\s*:/i);
    if (metaCut >= 0) name = name.slice(0, metaCut);
    const aliasMatch = name.match(
      /^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/
    );
    if (aliasMatch) {
      push(aliasMatch[1]!.replace(/^"|"$/g, ''));
      push(aliasMatch[2]!);
    } else {
      push(name.replace(/^"|"$/g, ''));
    }
  }

  return { kind: 'sketch', entities };
}

// ============================================================
// Pyramid extractor
// ============================================================

function extractPyramidSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    if (
      firstToken === 'inverted' ||
      firstToken === 'fill-tint' ||
      firstToken === 'fill-solid' ||
      firstToken === 'fill-outline'
    )
      continue;

    // Skip indented description lines
    if (line[0] === ' ' || line[0] === '\t') continue;

    // Layer name (strip pipe metadata)
    const label = trimmed.split('|')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'pyramid', entities };
}

// ============================================================
// Ring extractor
// ============================================================

function extractRingSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    if (
      firstToken === 'fill-tint' ||
      firstToken === 'fill-solid' ||
      firstToken === 'fill-outline'
    )
      continue;

    // Skip indented description lines
    if (line[0] === ' ' || line[0] === '\t') continue;

    // Layer name (strip pipe metadata)
    const label = trimmed.split('|')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'ring', entities };
}

// ============================================================
// Arc extractor
// ============================================================

const ARC_ARROW_RE = /^(\S+)\s+(?:->|-[^>]*->)\s+(\S+)/;

function extractArcSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    const arrowMatch = trimmed.match(ARC_ARROW_RE);
    if (arrowMatch) {
      const src = arrowMatch[1]!.split('|')[0]!.trim();
      const dst = arrowMatch[2]!.split('|')[0]!.trim();
      if (src && !entities.includes(src)) entities.push(src);
      if (dst && !entities.includes(dst)) entities.push(dst);
    }
  }

  return { kind: 'arc', entities };
}

// ============================================================
// Sankey extractor
// ============================================================

// Sankey links accept both directed `->` and undirected `--` (echarts.ts §1.5).
const SANKEY_ARROW_RE = /^(.+?)\s+(?:->|--)\s+(.+?)\s+(\d[\d,_.]*)/;

function extractSankeySymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    const arrowMatch = trimmed.match(SANKEY_ARROW_RE);
    if (arrowMatch) {
      const src = arrowMatch[1]!.split('|')[0]!.trim();
      const dst = arrowMatch[2]!.split('|')[0]!.trim();
      if (src && !entities.includes(src)) entities.push(src);
      if (dst && !entities.includes(dst)) entities.push(dst);
    } else {
      // Standalone node declaration (just a name, possibly with color)
      const label = trimmed.split('|')[0]!.trim();
      if (label && !entities.includes(label)) entities.push(label);
    }
  }

  return { kind: 'sankey', entities };
}

// ============================================================
// Timeline extractor
// ============================================================

const TIMELINE_ERA_RE = /^era\s+/i;
const TIMELINE_MARKER_RE = /^marker\s+/i;

const TIMELINE_SCHEDULING_RE = /\b(?:start|end|duration)\s*:/;

function extractTimelineSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;
  let inTagBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    if (TIMELINE_ERA_RE.test(trimmed) || TIMELINE_MARKER_RE.test(trimmed))
      continue;

    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }

    let label: string;
    if (TIMELINE_SCHEDULING_RE.test(trimmed)) {
      label = trimmed
        .replace(/\b(?:start|end|duration|color|description)\s*:.*$/, '')
        .split('|')[0]!
        .trim();
    } else {
      label = trimmed
        .replace(
          /^\d{4}(?:-\d{2}(?:-\d{2})?)?\s*(?:->\s*\d{4}(?:-\d{2}(?:-\d{2})?)?)?\s*/,
          ''
        )
        .split('|')[0]!
        .trim();
    }
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'timeline', entities };
}

// ============================================================
// Venn extractor
// ============================================================

function extractVennSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    // Skip indented intersection lines
    if (line[0] === ' ' || line[0] === '\t') continue;

    // Skip intersection rows — those are references to prior sets, not
    // declarations. Set NAMES + aliases come from the declaration lines below
    // (the `+`-completion offers those). Match the parser's detection (d3.ts:
    // any `+` on the line = intersection), not just the spaced form.
    if (trimmed.includes('+')) continue;

    // Set declaration: `Name [as <alias>] [color]`. Emit both the clean name
    // and the alias so `Set + ` reference completion can offer either token.
    const work = trimmed.split('|')[0]!.trim();
    const asMatch = work.match(/^(.+?)\s+as\s+([A-Za-z][\w-]*)\b/i);
    if (asMatch) {
      const name = asMatch[1]!.trim();
      const alias = asMatch[2]!;
      if (name && !entities.includes(name)) entities.push(name);
      if (alias && !entities.includes(alias)) entities.push(alias);
      continue;
    }
    // No alias — strip a trailing color token if present.
    const colorMatch = work.match(/^(.+?)\s+(\S+)$/);
    const label =
      colorMatch && RECOGNIZED_COLOR_SET.has(colorMatch[2]!.toLowerCase())
        ? colorMatch[1]!.trim()
        : work;
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'venn', entities };
}

// ============================================================
// Quadrant extractor
// ============================================================

const QUADRANT_POSITION_RE =
  /^(top-right|top-left|bottom-right|bottom-left)\s+/i;

function extractQuadrantSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    if (QUADRANT_POSITION_RE.test(trimmed)) continue;

    // Point name (may have coordinates: Name x,y)
    const parts = trimmed.split(/\s+\d/);
    const label = (parts[0] ?? '').split('|')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'quadrant', entities };
}

// ============================================================
// Slope extractor
// ============================================================

function extractSlopeSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    if (firstToken === 'period') continue;

    // Data row: Label value1 value2 [color]
    // Extract just the label (everything before first number)
    const numIdx = trimmed.search(/\s\d/);
    const label =
      numIdx > 0
        ? trimmed.slice(0, numIdx).trim()
        : trimmed.split('|')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'slope', entities };
}

// ============================================================
// Generic data chart extractor
// ============================================================

const SERIES_RE = /^series\s+(.+)$/i;
// "A -> B value" / "A -- B value" flow-link rows (chord/sankey via the shared
// extractor). Both endpoints captured; trailing weight optional.
const DATA_EDGE_RE = /^(.+?)\s+(?:->|--)\s+(.+?)(?:\s+-?\d[\d,_.]*)?\s*$/;

function extractDataChartSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let chartType = 'bar';
  let pastFirstLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
      if (firstToken) chartType = firstToken;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    // Series declarations: "series Revenue, Expenses"
    const seriesMatch = trimmed.match(SERIES_RE);
    if (seriesMatch) {
      for (const s of seriesMatch[1]!.split(',')) {
        const name = s.trim().split(/\s+/)[0]!;
        if (name && !entities.includes(name)) entities.push(name);
      }
      continue;
    }

    // Edge rows (chord / flow links): "A -> B value" / "A -- B value" — recover
    // BOTH endpoints. Without this the trailing-number scan below mangles the
    // whole "A -> B" into a single junk entity.
    const edgeMatch = trimmed.match(DATA_EDGE_RE);
    if (edgeMatch) {
      const src = edgeMatch[1]!.trim();
      const dst = edgeMatch[2]!.trim();
      if (src && !entities.includes(src)) entities.push(src);
      if (dst && !entities.includes(dst)) entities.push(dst);
      continue;
    }

    // Label-expression rows (function curves §15.4): "Name: expression". ONLY
    // for `function` — other data charts have no colon-form and would otherwise
    // truncate legitimate colon-bearing labels (`12:00 5` → `12`). Column-0
    // only, so indented `key: value` metadata is never misread as an entity.
    if (chartType === 'function') {
      const indent = line.length - line.trimStart().length;
      const colonIdx = trimmed.indexOf(':');
      if (indent === 0 && colonIdx > 0) {
        const beforeColon = trimmed.slice(0, colonIdx).trim();
        if (beforeColon && !METADATA_KEY_SET.has(beforeColon.toLowerCase())) {
          if (!entities.includes(beforeColon)) entities.push(beforeColon);
          continue;
        }
      }
    }

    // Data rows: "Label value [value...] [color]"
    const numIdx = trimmed.search(/\s-?\d/);
    if (numIdx > 0) {
      const label = trimmed.slice(0, numIdx).trim();
      if (label && !entities.includes(label)) entities.push(label);
    }
  }

  return { kind: chartType, entities };
}

// ============================================================
// Wireframe extractor
// ============================================================

// Wireframe element grammar is not a numeric-row variant, so it earns its own
// extractor: `[label]` fields, `(button)`, `{a | b}` dropdowns/selects, with
// possibly several elements per line. Returns the element labels as entities.
const WF_FIELD_RE = /\[([^\]]*)\]/g;
const WF_BUTTON_RE = /\(([^)]+)\)/g;
const WF_DROPDOWN_RE = /\{([^}]+)\}/g;

function extractWireframeSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;

  const push = (s: string): void => {
    // Strip any legacy trailing `| meta` inside a bracket; the `{a|b}` pipe is
    // handled separately by the dropdown split below.
    const t = s.split('|')[0]!.trim();
    if (t && !entities.includes(t)) entities.push(t);
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    // `[label]` input/group fields.
    for (const m of trimmed.matchAll(WF_FIELD_RE)) {
      const inner = m[1]!.trim();
      if (inner) push(inner);
    }
    // `(button)` — skip radio markers `(*)` / `( )`.
    for (const m of trimmed.matchAll(WF_BUTTON_RE)) {
      const inner = m[1]!.trim();
      if (inner === '*' || inner === '') continue;
      push(inner);
    }
    // `{opt1 | opt2}` dropdown/select — each option is an entity (carve-out pipe).
    for (const m of trimmed.matchAll(WF_DROPDOWN_RE)) {
      for (const opt of m[1]!.split('|')) {
        const t = opt.trim();
        if (t && !entities.includes(t)) entities.push(t);
      }
    }
  }

  return { kind: 'wireframe', entities };
}

// ============================================================
// Register built-in extractors
// ============================================================

/** Render a swimlane node label back into its authored delimited form. */
function wrapSwimNode(label: string, shape: SwimShape): string {
  switch (shape) {
    case 'exclusive':
      return `<${label}>`;
    case 'parallel':
      return `<+ ${label}>`;
    case 'terminal':
      return `(${label})`;
    case 'subprocess':
      return `[[${label}]]`;
    default:
      return label;
  }
}

/**
 * Parser-integrated (like flowchart/pert): the swimlane grammar — phases,
 * lanes, shape wrappers, in-arrow labels — is irregular enough that a faithful
 * scan is the parser. Offer every declared node as a flow reference (§27.6).
 */
function extractSwimlaneSymbols(docText: string): DiagramSymbols {
  const entities: string[] = [];
  const add = (s: string): void => {
    if (s && !entities.includes(s)) entities.push(s);
  };
  try {
    const parsed = parseSwimlane(docText);
    // Lane names — completed at a lane-header line and as the prefix of a
    // `Lane.Node` cross-lane qualified reference (§27.4).
    for (const l of parsed.lanes) add(l.label);
    // Which labels collide across lanes (need qualifying to disambiguate)?
    const labelCount = new Map<string, number>();
    for (const n of parsed.nodes)
      labelCount.set(n.label, (labelCount.get(n.label) ?? 0) + 1);
    for (const n of parsed.nodes) {
      add(wrapSwimNode(n.label, n.shape));
      // Same bare-task name in more than one lane → also offer `Lane.Node`.
      if (n.shape === 'task' && (labelCount.get(n.label) ?? 0) > 1)
        add(`${n.lane}.${n.label}`);
    }
  } catch {
    /* mid-edit parse failure — offer what we have (nothing) */
  }
  return { kind: 'swimlane', entities };
}

registerExtractor('body', extractBodySymbols);
registerExtractor('er', extractErSymbols);
registerExtractor('flowchart', extractFlowchartSymbols);
registerExtractor('infra', extractInfraSymbols);
registerExtractor('class', extractClassSymbols);
registerExtractor('sequence', extractSequenceSymbols);
registerExtractor('state', extractStateSymbols);
registerExtractor('sitemap', extractSitemapSymbols);
registerExtractor('c4', extractC4Symbols);
registerExtractor('gantt', extractGanttSymbols);
registerExtractor('pert', extractPertSymbols);
registerExtractor('boxes-and-lines', extractBoxesAndLinesSymbols);
registerExtractor('swimlane', extractSwimlaneSymbols);
registerExtractor('tech-radar', extractTechRadarSymbols);
registerExtractor('cycle', extractCycleSymbols);
registerExtractor('journey-map', extractJourneyMapSymbols);
registerExtractor('raci', extractRaciSymbols);
registerExtractor('org', extractOrgSymbols);
registerExtractor('family', extractFamilySymbols);
registerExtractor('kanban', extractKanbanSymbols);
registerExtractor('mindmap', extractMindmapSymbols);
registerExtractor('treemap', extractTreemapSymbols);
registerExtractor('block', extractBlockSymbols);
registerExtractor('sketch', extractSketchSymbols);
registerExtractor('pyramid', extractPyramidSymbols);
registerExtractor('ring', extractRingSymbols);
registerExtractor('arc', extractArcSymbols);
registerExtractor('sankey', extractSankeySymbols);
registerExtractor('timeline', extractTimelineSymbols);
registerExtractor('venn', extractVennSymbols);
registerExtractor('quadrant', extractQuadrantSymbols);
registerExtractor('slope', extractSlopeSymbols);
registerExtractor('bar', extractDataChartSymbols);
registerExtractor('line', extractDataChartSymbols);
registerExtractor('pie', extractDataChartSymbols);
registerExtractor('polar-area', extractDataChartSymbols);
registerExtractor('radar', extractDataChartSymbols);
registerExtractor('scatter', extractDataChartSymbols);
registerExtractor('heatmap', extractDataChartSymbols);
registerExtractor('funnel', extractDataChartSymbols);
// `function` (`Name: expr`) and `wordcloud` (`Word weight`) had NO extractor
// registered — extractDiagramSymbols returned null for them. The generalized
// shared extractor now handles the colon-label form, so register both.
registerExtractor('function', extractDataChartSymbols);
registerExtractor('wordcloud', extractDataChartSymbols);
registerExtractor('wireframe', extractWireframeSymbols);

function extractTechRadarSymbols(docText: string): DiagramSymbols {
  const entities: string[] = [];

  // Extract ring names and aliases from the rings block
  const lines = docText.split('\n');
  let inRings = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === 'rings') {
      inRings = true;
      continue;
    }
    if (inRings) {
      if (!trimmed || (line[0] !== ' ' && line[0] !== '\t')) {
        inRings = false;
        continue;
      }
      // Parse ring name (and alias)
      const aliasMatch = trimmed.match(/^(.+?)\s+(?:alias|aka)\s+(\S+)\s*$/i);
      if (aliasMatch) {
        // Regex captured groups 1 and 2 by successful match.
        entities.push(aliasMatch[1]!.trim());
        entities.push(aliasMatch[2]!.trim());
      } else {
        entities.push(trimmed);
      }
    }
  }

  return { kind: 'tech-radar', entities };
}

// ============================================================
// Cycle extractor
// ============================================================

function extractCycleSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    // Skip directives/metadata
    // split(/\s+/) on non-empty `trimmed` always yields at least one element.
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    if (
      firstToken === 'direction-counterclockwise' ||
      firstToken === 'circle-nodes'
    )
      continue;

    // Skip indented lines (descriptions, edges)
    if (line[0] === ' ' || line[0] === '\t') continue;

    // Node label (strip pipe metadata)
    // split('|')[0] always defined on any string.
    const label = trimmed.split('|')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return {
    kind: 'cycle',
    entities,
  };
}

// ============================================================
// RACI / RASCI / DACI extractor
// ============================================================
//
// Extract role names, task names, and phase labels for editor
// autocomplete. Mirrors the lightweight per-line scan pattern used
// by other extractors (cycle / journey-map) — does NOT rebuild the
// full AST.

const RACI_PHASE_RE = /^\[(.+)\]\s*$/;
const RACI_ROLES_DIRECTIVE_RE = /^roles\s+(.+)$/i;
const RACI_VARIANT_DIRECTIVE_RE = /^variant\s+(.+)$/i;
const RACI_ROLE_ASSIGNMENT_RE = /^([^:]+):\s*(.*)$/;

function extractRaciSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let chartType = 'raci';
  let pastFirstLine = false;
  let underTask = false;

  const push = (s: string): void => {
    const trimmed = s.trim();
    if (trimmed && !entities.includes(trimmed)) entities.push(trimmed);
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      // split(/\s+/) on non-empty `trimmed` always yields at least one element.
      const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
      if (firstToken === 'raci') {
        chartType = firstToken;
      }
      continue;
    }

    const indent = measureIndent(line);

    // Header directives
    if (indent === 0) {
      const rolesMatch = trimmed.match(RACI_ROLES_DIRECTIVE_RE);
      if (rolesMatch) {
        // Regex captured group 1 by successful match.
        for (const r of rolesMatch[1]!.split(',')) push(r);
        continue;
      }
      if (RACI_VARIANT_DIRECTIVE_RE.test(trimmed)) continue;
      // split(/\s+/) on non-empty `trimmed` always yields at least one element.
      if (METADATA_KEY_SET.has(trimmed.split(/\s+/)[0]!.toLowerCase()))
        continue;
      if (
        trimmed.toLowerCase() === 'draft' ||
        trimmed.toLowerCase() === 'fill-tint' ||
        trimmed.toLowerCase() === 'fill-solid' ||
        trimmed.toLowerCase() === 'fill-outline'
      )
        continue;
    }

    // [Phase Label]
    const phaseMatch = trimmed.match(RACI_PHASE_RE);
    if (phaseMatch && indent === 0) {
      // Regex captured group 1 by successful match.
      push(phaseMatch[1]!);
      underTask = false;
      continue;
    }

    // Role assignment (Role: markers) — only valid under a task
    const roleMatch = trimmed.match(RACI_ROLE_ASSIGNMENT_RE);
    if (underTask && roleMatch) {
      // Strip a possible trailing `# annotation`
      // Regex captured group 1 by successful match.
      const rolePart = roleMatch[1]!.trim();
      push(rolePart);
      continue;
    }

    // Otherwise: treat the line as a task name. `#` is NOT a comment
    // character in DGMO (`//` is) — task names are used verbatim.
    push(trimmed);
    underTask = true;
  }

  return {
    kind: chartType,
    entities,
  };
}

function extractJourneyMapSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    // Skip directives/metadata at indent 0
    // split(/\s+/) on non-empty `trimmed` always yields at least one element.
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    if (firstToken === 'persona' || firstToken === 'tag') continue;

    const isIndented = line[0] === ' ' || line[0] === '\t';

    // Skip deep-indented lines (annotations, descriptions under steps)
    // but keep singly-indented lines (steps within phases)
    if (isIndented) {
      // Annotation/description keywords — skip
      if (/^(pain|opportunity|thought|description)\s*:/i.test(trimmed))
        continue;
      // Tag group entries — skip
      if (/^\S+\([^)]+\)/.test(trimmed)) continue;
    }

    // Phase header
    const phaseMatch = trimmed.match(/^\[(.+?)\]$/);
    if (phaseMatch) {
      // Regex captured group 1 by successful match.
      entities.push(phaseMatch[1]!.trim());
      continue;
    }

    // Step label (strip pipe metadata) — works for both indent 0 and indented steps
    // split('|')[0] always defined on any string.
    const label = trimmed.split('|')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return {
    kind: 'journey-map',
    entities,
  };
}

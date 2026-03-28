import { resolveColor } from '../colors';
import type { PaletteColors } from '../palettes';
import { makeDgmoError, formatDgmoError } from '../diagnostics';
import {
  measureIndent,
  parseFirstLine,
  OPTION_NOCOLON_RE,
} from '../utils/parsing';
import type {
  ParsedClassDiagram,
  ClassNode,
  ClassMember,
  ClassModifier,
  MemberVisibility,
  RelationshipType,
} from './types';

// ============================================================
// Helpers
// ============================================================

function classId(name: string): string {
  return name.toLowerCase().trim();
}

// ============================================================
// Regex patterns
// ============================================================

// Class declaration: [modifier] ClassName [extends|implements ParentClass] (color)
// Supports both:
//   New: `abstract Animal` or `interface Serializable`
//   Old: `Animal [abstract]` (bracketed suffix, kept for transition)
const CLASS_DECL_RE =
  /^(?:(abstract|interface|enum)\s+)?([A-Z][A-Za-z0-9_]*)(?:\s+(extends|implements)\s+([A-Z][A-Za-z0-9_]*))?(?:\s+\[(abstract|interface|enum)\])?(?:\s+\(([^)]+)\))?\s*$/;

// Relationship — arrow syntax (indented under source class):
//   --|> TargetClass label  (space-separated)
//   --|> TargetClass : label  (colon-separated, kept for transition)
// Arrows: --|>  ..|>  *--  o--  ..>  ->
const INDENT_REL_ARROW_RE =
  /^(--\|>|\.\.\|>|\*--|o--|\.\.>|->)\s*([A-Z][A-Za-z0-9_]*)(?:\s+:?\s*(.+))?$/;

// Legacy top-level relationship regex (used only for detection/rejection)
const REL_ARROW_RE =
  /^([A-Z][A-Za-z0-9_]*)\s*(--\|>|\.\.\|>|\*--|o--|\.\.>|->)\s*([A-Z][A-Za-z0-9_]*)(?:\s+:?\s*(.+))?$/;

// Member line patterns
const VISIBILITY_RE = /^([+\-#])\s*/;
const STATIC_SUFFIX_RE = /\{static\}\s*$/;
const METHOD_RE = /^(.+?)\(([^)]*)\)(?:\s*:\s*(.+))?$/;
const FIELD_RE = /^(.+?)\s*:\s*(.+)$/;

const ARROW_TO_TYPE: Record<string, RelationshipType> = {
  '--|>': 'extends',
  '..|>': 'implements',
  '*--': 'composes',
  'o--': 'aggregates',
  '..>': 'depends',
  '->': 'associates',
};

function parseVisibility(prefix: string): MemberVisibility {
  switch (prefix) {
    case '-':
      return 'private';
    case '#':
      return 'protected';
    default:
      return 'public';
  }
}

// ============================================================
// Member parser
// ============================================================

function parseMember(
  line: string,
  lineNumber: number,
  isEnum: boolean
): ClassMember | null {
  let text = line.trim();
  if (!text) return null;

  // Enum values: plain text, no colon, no parens needed
  if (isEnum) {
    return {
      name: text,
      visibility: 'public',
      isStatic: false,
      isMethod: false,
      lineNumber,
    };
  }

  // Extract visibility prefix
  let visibility: MemberVisibility = 'public';
  const visMatch = text.match(VISIBILITY_RE);
  if (visMatch) {
    visibility = parseVisibility(visMatch[1]);
    text = text.substring(visMatch[0].length);
  }

  // Check for {static} suffix
  let isStatic = false;
  if (STATIC_SUFFIX_RE.test(text)) {
    isStatic = true;
    text = text.replace(STATIC_SUFFIX_RE, '').trim();
  }

  // Method: name(params) : returnType
  const methodMatch = text.match(METHOD_RE);
  if (methodMatch) {
    return {
      name: methodMatch[1].trim(),
      params: methodMatch[2].trim(),
      type: methodMatch[3]?.trim(),
      visibility,
      isStatic,
      isMethod: true,
      lineNumber,
    };
  }

  // Field: name : type
  const fieldMatch = text.match(FIELD_RE);
  if (fieldMatch) {
    return {
      name: fieldMatch[1].trim(),
      type: fieldMatch[2].trim(),
      visibility,
      isStatic,
      isMethod: false,
      lineNumber,
    };
  }

  // Plain name (field with no type)
  return {
    name: text,
    visibility,
    isStatic,
    isMethod: false,
    lineNumber,
  };
}

// ============================================================
// Main parser
// ============================================================

export function parseClassDiagram(
  content: string,
  palette?: PaletteColors
): ParsedClassDiagram {
  const lines = content.split('\n');
  const result: ParsedClassDiagram = {
    type: 'class',
    classes: [],
    relationships: [],
    options: {},
    diagnostics: [],
    error: null,
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _fail = (line: number, message: string): ParsedClassDiagram => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  const classMap = new Map<string, ClassNode>();
  let currentClass: ClassNode | null = null;
  let contentStarted = false;

  function getOrCreateClass(name: string, lineNumber: number): ClassNode {
    const id = classId(name);
    const existing = classMap.get(id);
    if (existing) return existing;

    const node: ClassNode = {
      id,
      name,
      members: [],
      lineNumber,
    };
    classMap.set(id, node);
    result.classes.push(node);
    return node;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const lineNumber = i + 1;
    const indent = measureIndent(raw);

    // Skip empty lines
    if (!trimmed) {
      // Empty line ends current class context
      if (indent === 0) currentClass = null;
      continue;
    }

    // Skip comments
    if (trimmed.startsWith('//')) continue;

    // First line: bare chart type + optional title (new syntax)
    if (!contentStarted && indent === 0 && i === 0) {
      const firstLine = parseFirstLine(trimmed);
      if (firstLine && firstLine.chartType === 'class') {
        if (firstLine.title) {
          result.title = firstLine.title;
          result.titleLineNumber = lineNumber;
        }
        continue;
      }
    }

    // Space-separated options before content (new syntax): `no-auto-color`
    // Only match lines starting with a lowercase token (options), not uppercase (class names)
    if (!contentStarted && indent === 0 && /^[a-z]/.test(trimmed)) {
      // Bare boolean option (single keyword, no value)
      if (trimmed.toLowerCase() === 'no-auto-color') {
        result.options['no-auto-color'] = 'on';
        continue;
      }
      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch) {
        const key = optMatch[1].toLowerCase();
        const value = optMatch[2].trim();
        // Don't swallow lines that look like class modifier keywords
        if (key !== 'abstract' && key !== 'interface' && key !== 'enum') {
          result.options[key] = value;
          continue;
        }
      }
    }

    // Indented lines = relationships or members of current class
    if (indent > 0 && currentClass) {
      // Try indented relationship arrow: --|> TargetClass [label]
      const indentRel = trimmed.match(INDENT_REL_ARROW_RE);
      if (indentRel) {
        const arrow = indentRel[1];
        const targetName = indentRel[2];
        const label = indentRel[3]?.trim();

        getOrCreateClass(targetName, lineNumber);

        result.relationships.push({
          source: currentClass.id,
          target: classId(targetName),
          type: ARROW_TO_TYPE[arrow],
          ...(label && { label }),
          lineNumber,
        });
        continue;
      }

      const member = parseMember(
        trimmed,
        lineNumber,
        currentClass.modifier === 'enum'
      );
      if (member) {
        currentClass.members.push(member);
      }
      continue;
    }

    // At indent 0 — this ends any previous class context
    currentClass = null;
    contentStarted = true;

    // Reject top-level relationship arrows — must be indented under source class
    const relArrow = trimmed.match(REL_ARROW_RE);
    if (relArrow) {
      const sourceName = relArrow[1];
      const arrow = relArrow[2];
      const targetName = relArrow[3];
      result.diagnostics.push(
        makeDgmoError(
          lineNumber,
          `Relationship "${sourceName} ${arrow} ${targetName}" must be indented under the source class "${sourceName}"`,
          'warning'
        )
      );
      continue;
    }

    // Try class declaration
    const classDecl = trimmed.match(CLASS_DECL_RE);
    if (classDecl) {
      const prefixModifier = classDecl[1] as ClassModifier | undefined;
      const name = classDecl[2];
      const relKeyword = classDecl[3] as 'extends' | 'implements' | undefined;
      const parentName = classDecl[4];
      const bracketModifier = classDecl[5] as ClassModifier | undefined;
      const modifier = prefixModifier ?? bracketModifier;
      const colorName = classDecl[6]?.trim();
      const color = colorName ? resolveColor(colorName, palette) : undefined;

      const node = getOrCreateClass(name, lineNumber);
      if (modifier) node.modifier = modifier;
      if (color) node.color = color;
      // Update line number to the declaration line (may have been created by relationship)
      node.lineNumber = lineNumber;

      // Inline extends/implements creates a relationship
      if (relKeyword && parentName) {
        getOrCreateClass(parentName, lineNumber);
        result.relationships.push({
          source: classId(name),
          target: classId(parentName),
          type: relKeyword as RelationshipType,
          lineNumber,
        });
      }

      currentClass = node;
      continue;
    }
  }

  // Validation
  if (result.classes.length === 0 && !result.error) {
    const diag = makeDgmoError(
      1,
      'No classes found. Add class declarations like "ClassName" or "ClassName [interface]".'
    );
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
  }

  // Warn about isolated classes (not in any relationship)
  if (
    result.classes.length >= 2 &&
    result.relationships.length >= 1 &&
    !result.error
  ) {
    const connectedIds = new Set<string>();
    for (const rel of result.relationships) {
      connectedIds.add(rel.source);
      connectedIds.add(rel.target);
    }
    for (const cls of result.classes) {
      if (!connectedIds.has(cls.id)) {
        result.diagnostics.push(
          makeDgmoError(
            cls.lineNumber,
            `Class "${cls.name}" is not connected to any other class`,
            'warning'
          )
        );
      }
    }
  }

  return result;
}

// ============================================================
// Detection helper
// ============================================================

/**
 * Detect if content looks like a class diagram without explicit `chart: class`.
 * Requires class-like patterns (capitalized names with modifiers or UML relationships).
 * Must not false-positive on flowcharts.
 */
export function looksLikeClassDiagram(content: string): boolean {
  const lines = content.split('\n');

  let hasModifier = false;
  let hasRelationship = false;
  let hasIndentedMember = false;
  let hasClassDecl = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Skip metadata
    if (/^(chart|title)\s*:/i.test(trimmed)) continue;
    // Skip new-style first line (bare chart type)
    if (/^class(\s|$)/i.test(trimmed)) continue;

    const indent = measureIndent(line);

    if (indent === 0) {
      // Check for bare modifier keyword: `abstract ClassName`, `interface ClassName`, `enum ClassName`
      if (/^(abstract|interface|enum)\s+[A-Z][A-Za-z0-9_]*/i.test(trimmed)) {
        hasModifier = true;
        hasClassDecl = true;
      }
      // Check for old modifier pattern: ClassName [abstract|interface|enum]
      if (
        /^[A-Z][A-Za-z0-9_]*\s+\[(abstract|interface|enum)\]/i.test(trimmed)
      ) {
        hasModifier = true;
        hasClassDecl = true;
      }
      // Check for inline extends/implements in class declaration
      if (/^[A-Z][A-Za-z0-9_]*\s+(extends|implements)\s+[A-Z]/.test(trimmed)) {
        hasRelationship = true;
        hasClassDecl = true;
      }
      // Check for relationship arrows
      if (REL_ARROW_RE.test(trimmed)) {
        hasRelationship = true;
      }
      // Check for plain class declaration (capitalized name only)
      if (CLASS_DECL_RE.test(trimmed)) {
        hasClassDecl = true;
      }
    } else {
      // Indented lines that look like members
      if (/^[+\-#]?\s*\w+.*[:(]/.test(trimmed)) {
        hasIndentedMember = true;
      }
      // Indented relationship arrows
      if (INDENT_REL_ARROW_RE.test(trimmed)) {
        hasRelationship = true;
      }
    }
  }

  // Require modifier OR (relationship + class-like declarations)
  // Modifier alone is strong enough signal
  if (hasModifier) return true;

  // Relationship keywords/arrows + at least one class declaration + member
  if (hasRelationship && hasClassDecl && hasIndentedMember) return true;

  return false;
}

// ============================================================
// Symbol extraction (for completion API)
// ============================================================

import type { DiagramSymbols } from '../completion';

/**
 * Extract class names (entities) from class diagram document text.
 * Used by the dgmo completion API for ghost hints and popup completions.
 */
export function extractSymbols(docText: string): DiagramSymbols {
  const entities: string[] = [];
  let inMetadata = true;
  for (const rawLine of docText.split('\n')) {
    const line = rawLine.trim();
    // Skip old-style colon metadata and new-style first line / space-separated options
    if (
      inMetadata &&
      (/^[a-z-]+\s*:/i.test(line) || /^class(\s|$)/i.test(line))
    )
      continue;
    if (inMetadata && line.toLowerCase() === 'no-auto-color') continue;
    if (inMetadata && /^[a-z]/.test(line) && OPTION_NOCOLON_RE.test(line)) {
      const key = line.match(OPTION_NOCOLON_RE)![1].toLowerCase();
      if (key !== 'abstract' && key !== 'interface' && key !== 'enum') continue;
    }
    inMetadata = false;
    if (line.length === 0 || /^\s/.test(rawLine)) continue;
    const m = CLASS_DECL_RE.exec(line);
    if (m) {
      const name = m[2]!; // group 2 is the class name in the new regex
      if (!entities.includes(name)) entities.push(name);
    }
  }
  return {
    kind: 'class',
    entities,
    keywords: ['extends', 'implements', 'abstract', 'interface', 'enum'],
  };
}

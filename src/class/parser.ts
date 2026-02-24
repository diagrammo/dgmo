import { resolveColor } from '../colors';
import type { PaletteColors } from '../palettes';
import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import type {
  ParsedClassDiagram,
  ClassNode,
  ClassMember,
  ClassRelationship,
  ClassModifier,
  MemberVisibility,
  RelationshipType,
} from './types';

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

function classId(name: string): string {
  return name.toLowerCase().trim();
}

// ============================================================
// Regex patterns
// ============================================================

// Class declaration: ClassName [modifier] (color)
const CLASS_DECL_RE =
  /^([A-Z][A-Za-z0-9_]*)(?:\s+\[(abstract|interface|enum)\])?(?:\s+\(([^)]+)\))?\s*$/;

// Relationship — keyword syntax:
// ClassName extends|implements|contains|has|uses TargetClass : label
const REL_KEYWORD_RE =
  /^([A-Z][A-Za-z0-9_]*)\s+(extends|implements|contains|has|uses)\s+([A-Z][A-Za-z0-9_]*)(?:\s*:\s*(.+))?$/;

// Relationship — arrow syntax:
// ClassName --|> TargetClass : label
// Arrows: --|>  ..|>  *--  o--  ..>  ->
const REL_ARROW_RE =
  /^([A-Z][A-Za-z0-9_]*)\s+(--\|>|\.\.\|>|\*--|o--|\.\.\>|->)\s+([A-Z][A-Za-z0-9_]*)(?:\s*:\s*(.+))?$/;

// Member line patterns
const VISIBILITY_RE = /^([+\-#])\s*/;
const STATIC_SUFFIX_RE = /\{static\}\s*$/;
const METHOD_RE = /^(.+?)\(([^)]*)\)(?:\s*:\s*(.+))?$/;
const FIELD_RE = /^(.+?)\s*:\s*(.+)$/;

const KEYWORD_TO_TYPE: Record<string, RelationshipType> = {
  extends: 'extends',
  implements: 'implements',
  contains: 'composes',
  has: 'aggregates',
  uses: 'depends',
};

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
  };

  const fail = (line: number, message: string): ParsedClassDiagram => {
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

    // Metadata directives (before content) — only simple keys (no spaces)
    if (!contentStarted && indent === 0 && /^[a-z][a-z0-9-]*\s*:/i.test(trimmed)) {
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.substring(0, colonIdx).trim().toLowerCase();
      const value = trimmed.substring(colonIdx + 1).trim();

      // Only recognize known metadata keys
      if (key === 'chart') {
        if (value.toLowerCase() !== 'class') {
          const allTypes = ['class', 'flowchart', 'sequence', 'er', 'org', 'bar', 'line', 'pie', 'scatter', 'sankey', 'venn', 'timeline', 'arc', 'slope'];
          let msg = `Expected chart type "class", got "${value}"`;
          const hint = suggest(value.toLowerCase(), allTypes);
          if (hint) msg += `. ${hint}`;
          return fail(lineNumber, msg);
        }
        continue;
      }

      if (key === 'title') {
        result.title = value;
        result.titleLineNumber = lineNumber;
        continue;
      }

      // Store diagram-level options (e.g., color: off)
      if (!/\s/.test(key)) {
        result.options[key] = value;
        continue;
      }
    }

    // Indented lines = members of current class
    if (indent > 0 && currentClass) {
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

    // Try relationship — keyword syntax
    const relKeyword = trimmed.match(REL_KEYWORD_RE);
    if (relKeyword) {
      const sourceName = relKeyword[1];
      const keyword = relKeyword[2].toLowerCase();
      const targetName = relKeyword[3];
      const label = relKeyword[4]?.trim();

      // Ensure both classes exist
      getOrCreateClass(sourceName, lineNumber);
      getOrCreateClass(targetName, lineNumber);

      result.relationships.push({
        source: classId(sourceName),
        target: classId(targetName),
        type: KEYWORD_TO_TYPE[keyword],
        ...(label && { label }),
        lineNumber,
      });
      continue;
    }

    // Try relationship — arrow syntax
    const relArrow = trimmed.match(REL_ARROW_RE);
    if (relArrow) {
      const sourceName = relArrow[1];
      const arrow = relArrow[2];
      const targetName = relArrow[3];
      const label = relArrow[4]?.trim();

      // Ensure both classes exist
      getOrCreateClass(sourceName, lineNumber);
      getOrCreateClass(targetName, lineNumber);

      result.relationships.push({
        source: classId(sourceName),
        target: classId(targetName),
        type: ARROW_TO_TYPE[arrow],
        ...(label && { label }),
        lineNumber,
      });
      continue;
    }

    // Try class declaration
    const classDecl = trimmed.match(CLASS_DECL_RE);
    if (classDecl) {
      const name = classDecl[1];
      const modifier = classDecl[2] as ClassModifier | undefined;
      const colorName = classDecl[3]?.trim();
      const color = colorName ? resolveColor(colorName, palette) : undefined;

      const node = getOrCreateClass(name, lineNumber);
      if (modifier) node.modifier = modifier;
      if (color) node.color = color;
      // Update line number to the declaration line (may have been created by relationship)
      node.lineNumber = lineNumber;

      currentClass = node;
      continue;
    }
  }

  // Validation
  if (result.classes.length === 0 && !result.error) {
    const diag = makeDgmoError(1, 'No classes found. Add class declarations like "ClassName" or "ClassName [interface]".');
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
  }

  // Warn about isolated classes (not in any relationship)
  if (result.classes.length >= 2 && result.relationships.length >= 1 && !result.error) {
    const connectedIds = new Set<string>();
    for (const rel of result.relationships) {
      connectedIds.add(rel.source);
      connectedIds.add(rel.target);
    }
    for (const cls of result.classes) {
      if (!connectedIds.has(cls.id)) {
        result.diagnostics.push(makeDgmoError(cls.lineNumber, `Class "${cls.name}" is not connected to any other class`, 'warning'));
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

    const indent = measureIndent(line);

    if (indent === 0) {
      // Check for modifier pattern: ClassName [abstract|interface|enum]
      if (/^[A-Z][A-Za-z0-9_]*\s+\[(abstract|interface|enum)\]/i.test(trimmed)) {
        hasModifier = true;
        hasClassDecl = true;
      }
      // Check for relationship keywords
      if (REL_KEYWORD_RE.test(trimmed)) {
        hasRelationship = true;
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
    }
  }

  // Require modifier OR (relationship + class-like declarations)
  // Modifier alone is strong enough signal
  if (hasModifier) return true;

  // Relationship keywords/arrows + at least one class declaration + member
  if (hasRelationship && hasClassDecl && hasIndentedMember) return true;

  return false;
}

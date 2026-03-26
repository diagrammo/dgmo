import { resolveColor } from '../colors';
import type { PaletteColors } from '../palettes';
import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import { measureIndent, extractColor, parsePipeMetadata, MULTIPLE_PIPE_WARNING } from '../utils/parsing';
import { matchTagBlockHeading, validateTagValues } from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import type {
  ParsedERDiagram,
  ERTable,
  ERConstraint,
  ERCardinality,
} from './types';

// ============================================================
// Helpers
// ============================================================

function tableId(name: string): string {
  return name.toLowerCase().trim();
}

// ============================================================
// Regex patterns
// ============================================================

// Table declaration: table_name or table_name (color) or table_name | key: value
// Allows lowercase, uppercase, underscores, digits — must start with letter or underscore
const TABLE_DECL_RE = /^([a-zA-Z_]\w*)(?:\s*\(([^)]+)\))?(?:\s*\|(.+))?$/;

// Column: name: type [constraints]  or  name [constraints]  or  name: type  or  name
const COLUMN_RE = /^(\w+)(?:\s*:\s*(\w[\w()]*(?:\s*\[\])?))?(?:\s+\[([^\]]+)\])?\s*$/;

// Indented relationship: 1-* target  or  1-label-* target
const INDENT_REL_RE = /^([1*?])-(?:(.+)-)?([1*?])\s+([a-zA-Z_]\w*)\s*$/;

// Constraint keywords
const CONSTRAINT_MAP: Record<string, ERConstraint> = {
  pk: 'pk',
  fk: 'fk',
  unique: 'unique',
  nullable: 'nullable',
};

// ============================================================
// Cardinality parsing
// ============================================================

/**
 * Parse a cardinality side token (symbolic only: "1", "*", "?").
 */
function parseCardSide(token: string): ERCardinality | null {
  if (token === '1' || token === '*' || token === '?') return token;
  return null;
}

/**
 * Try to parse a relationship line with symbolic cardinality.
 *
 * Supported form:
 *   tableName 1--* tableName : label
 *   tableName 1-* tableName : label
 *   tableName ?--1 tableName : label
 */
const REL_SYMBOLIC_RE =
  /^([a-zA-Z_]\w*)\s+([1*?])\s*-{1,2}\s*([1*?])\s+([a-zA-Z_]\w*)(?:\s*:\s*(.+))?$/;

/** Detects keyword cardinality forms to emit helpful error */
const REL_KEYWORD_RE =
  /^([a-zA-Z_]\w*)\s+(one|many|zero)[- ]to[- ](one|many|zero)\s+([a-zA-Z_]\w*)(?:\s*:\s*(.+))?$/i;

const KEYWORD_TO_SYMBOL: Record<string, string> = {
  one: '1',
  many: '*',
  zero: '?',
};

function parseRelationship(
  trimmed: string,
  lineNumber: number,
  pushError: (line: number, message: string) => void,
): {
  source: string;
  target: string;
  from: ERCardinality;
  to: ERCardinality;
  label?: string;
} | null {
  // Symbolic: 1--*, 1-*, ?--1, etc.
  const sym = trimmed.match(REL_SYMBOLIC_RE);
  if (sym) {
    const fromCard = parseCardSide(sym[2]);
    const toCard = parseCardSide(sym[3]);
    if (fromCard && toCard) {
      return {
        source: sym[1],
        target: sym[4],
        from: fromCard,
        to: toCard,
        label: sym[5]?.trim(),
      };
    }
  }

  // Keyword / natural: produce helpful error with symbolic suggestion
  const kw = trimmed.match(REL_KEYWORD_RE);
  if (kw) {
    const fromSym = KEYWORD_TO_SYMBOL[kw[2].toLowerCase()] ?? kw[2];
    const toSym = KEYWORD_TO_SYMBOL[kw[3].toLowerCase()] ?? kw[3];
    pushError(
      lineNumber,
      `Use symbolic cardinality (1--*, ?--1, *--*) instead of "${kw[2]}-to-${kw[3]}". Example: ${kw[1]} ${fromSym}--${toSym} ${kw[4]}`,
    );
    return null;
  }

  return null;
}

// ============================================================
// Constraint parser
// ============================================================

function parseConstraints(raw: string): ERConstraint[] {
  const parts = raw.split(',').map((s) => s.trim().toLowerCase());
  const result: ERConstraint[] = [];
  for (const part of parts) {
    const c = CONSTRAINT_MAP[part];
    if (c) result.push(c);
  }
  return result;
}

// ============================================================
// Main parser
// ============================================================

export function parseERDiagram(
  content: string,
  palette?: PaletteColors
): ParsedERDiagram {
  const lines = content.split('\n');
  const result: ParsedERDiagram = {
    type: 'er',
    options: {},
    tables: [],
    relationships: [],
    tagGroups: [],
    diagnostics: [],
    error: null,
  };

  const fail = (line: number, message: string): ParsedERDiagram => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  const pushError = (line: number, message: string): void => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    if (!result.error) result.error = formatDgmoError(diag);
  };

  const tableMap = new Map<string, ERTable>();
  let currentTable: ERTable | null = null;
  let contentStarted = false;
  let currentTagGroup: TagGroup | null = null;
  const aliasMap = new Map<string, string>();

  function getOrCreateTable(name: string, lineNumber: number): ERTable {
    const id = tableId(name);
    const existing = tableMap.get(id);
    if (existing) return existing;

    const table: ERTable = {
      id,
      name,
      columns: [],
      metadata: {},
      lineNumber,
    };
    tableMap.set(id, table);
    result.tables.push(table);
    return table;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const lineNumber = i + 1;
    const indent = measureIndent(raw);

    // Skip empty lines
    if (!trimmed) {
      if (indent === 0) currentTable = null;
      continue;
    }

    // Skip comments
    if (trimmed.startsWith('//')) continue;

    // Tag group heading — `tag: Name` or deprecated `## Name`
    if (!contentStarted && indent === 0) {
      const tagBlockMatch = matchTagBlockHeading(trimmed);
      if (tagBlockMatch) {
        if (tagBlockMatch.deprecated) {
          result.diagnostics.push(makeDgmoError(lineNumber,
            `'## ${tagBlockMatch.name}' is no longer supported — use 'tag: ${tagBlockMatch.name}' instead`));
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
    }

    // Tag group entries (indented under tag: heading)
    if (currentTagGroup && !contentStarted && indent > 0) {
      const isDefault = /\bdefault\s*$/.test(trimmed);
      const entryText = isDefault
        ? trimmed.replace(/\s+default\s*$/, '').trim()
        : trimmed;
      const { label, color } = extractColor(entryText, palette);
      if (!color) {
        result.diagnostics.push(makeDgmoError(lineNumber,
          `Expected 'Value(color)' in tag group '${currentTagGroup.name}'`, 'warning'));
        continue;
      }
      if (isDefault) {
        currentTagGroup.defaultValue = label;
      }
      currentTagGroup.entries.push({ value: label, color, lineNumber });
      continue;
    }

    // End tag group on non-indented line
    if (currentTagGroup && indent === 0) {
      currentTagGroup = null;
    }

    // Metadata directives (before content)
    if (!contentStarted && indent === 0 && /^[a-z][a-z0-9-]*\s*:/i.test(trimmed)) {
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.substring(0, colonIdx).trim().toLowerCase();
      const value = trimmed.substring(colonIdx + 1).trim();

      if (key === 'chart') {
        if (value.toLowerCase() !== 'er') {
          const allTypes = ['er', 'class', 'flowchart', 'sequence', 'org', 'bar', 'line', 'pie', 'scatter', 'sankey', 'venn', 'timeline', 'arc', 'slope'];
          let msg = `Expected chart type "er", got "${value}"`;
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

      if (key === 'notation') {
        result.options.notation = value.toLowerCase();
        continue;
      }

      // Unknown single-word keys are metadata — skip
      if (!/\s/.test(key)) continue;
    }

    // Indented lines = columns or relationships of current table
    if (indent > 0 && currentTable) {
      // Try indented relationship first: 1-* target  or  1-label-* target
      const indentRel = trimmed.match(INDENT_REL_RE);
      if (indentRel) {
        const fromCard = parseCardSide(indentRel[1]);
        const toCard = parseCardSide(indentRel[3]);
        if (fromCard && toCard) {
          const targetName = indentRel[4];
          getOrCreateTable(targetName, lineNumber);
          result.relationships.push({
            source: currentTable.id,
            target: tableId(targetName),
            cardinality: { from: fromCard, to: toCard },
            ...(indentRel[2]?.trim() && { label: indentRel[2].trim() }),
            lineNumber,
          });
        }
        continue;
      }

      const colMatch = trimmed.match(COLUMN_RE);
      if (colMatch) {
        const colName = colMatch[1];
        const colType = colMatch[2]?.trim();
        const constraintRaw = colMatch[3];
        const constraints = constraintRaw ? parseConstraints(constraintRaw) : [];

        currentTable.columns.push({
          name: colName,
          ...(colType && { type: colType }),
          constraints,
          lineNumber,
        });
      }
      continue;
    }

    // At indent 0 — this ends any previous table context
    currentTable = null;
    contentStarted = true;

    // Try relationship
    const rel = parseRelationship(trimmed, lineNumber, pushError);
    if (rel) {
      getOrCreateTable(rel.source, lineNumber);
      getOrCreateTable(rel.target, lineNumber);

      result.relationships.push({
        source: tableId(rel.source),
        target: tableId(rel.target),
        cardinality: { from: rel.from, to: rel.to },
        ...(rel.label && { label: rel.label }),
        lineNumber,
      });
      continue;
    }

    // Try table declaration
    const tableDecl = trimmed.match(TABLE_DECL_RE);
    if (tableDecl) {
      const name = tableDecl[1];
      const colorName = tableDecl[2]?.trim();
      const color = colorName ? resolveColor(colorName, palette) : undefined;

      const table = getOrCreateTable(name, lineNumber);
      if (color) table.color = color;
      table.lineNumber = lineNumber;

      // Parse pipe metadata: TableName(color) | key: value, key2: value2
      const pipeStr = tableDecl[3]?.trim();
      if (pipeStr) {
        // Split on additional pipes (treated as commas) and warn if found
        const pipeSegments = pipeStr.split('|');
        const meta = parsePipeMetadata(['', ...pipeSegments], aliasMap,
          () => result.diagnostics.push(makeDgmoError(lineNumber, MULTIPLE_PIPE_WARNING, 'warning')));
        Object.assign(table.metadata, meta);
      }

      currentTable = table;
      continue;
    }
  }

  // Validation
  if (result.tables.length === 0 && !result.error) {
    const diag = makeDgmoError(1, 'No tables found. Add table declarations like "users" or "orders (blue)".');
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
  }

  // Validate tag values on tables
  if (result.tagGroups.length > 0) {
    const tagEntities = result.tables.map((t) => ({
      metadata: t.metadata,
      lineNumber: t.lineNumber,
    }));
    validateTagValues(
      tagEntities,
      result.tagGroups,
      (line, msg) => result.diagnostics.push(makeDgmoError(line, msg, 'warning')),
      suggest,
    );

    // Inject defaults for tables without explicit tags
    for (const group of result.tagGroups) {
      if (!group.defaultValue) continue;
      const key = group.name.toLowerCase();
      for (const table of result.tables) {
        if (!table.metadata[key]) {
          table.metadata[key] = group.defaultValue;
        }
      }
    }
  }

  // Warn about isolated tables (not in any relationship)
  if (result.tables.length >= 2 && result.relationships.length >= 1 && !result.error) {
    const connectedIds = new Set<string>();
    for (const rel of result.relationships) {
      connectedIds.add(rel.source);
      connectedIds.add(rel.target);
    }
    for (const table of result.tables) {
      if (!connectedIds.has(table.id)) {
        result.diagnostics.push(makeDgmoError(table.lineNumber, `Table "${table.name}" is not connected to any other table`, 'warning'));
      }
    }
  }

  return result;
}

// ============================================================
// Detection helper
// ============================================================

/**
 * Detect if content looks like an ER diagram without explicit `chart: er`.
 * Looks for indented lines with [pk] or [fk] constraint patterns.
 */
export function looksLikeERDiagram(content: string): boolean {
  const lines = content.split('\n');

  let hasConstraint = false;
  let hasTableDecl = false;
  let hasRelationship = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Skip metadata
    if (/^(chart|title|notation)\s*:/i.test(trimmed)) continue;

    const indent = measureIndent(line);

    if (indent > 0) {
      // Indented line with [pk] or [fk] is strong ER signal
      if (/\[(pk|fk)\]/i.test(trimmed)) {
        hasConstraint = true;
      }
      // Indented relationship is a strong ER signal
      if (INDENT_REL_RE.test(trimmed)) {
        hasRelationship = true;
      }
    } else {
      // Check for table-like declaration
      if (TABLE_DECL_RE.test(trimmed)) {
        hasTableDecl = true;
      }
      // Check for relationship patterns
      if (REL_SYMBOLIC_RE.test(trimmed)) {
        hasRelationship = true;
      }
    }
  }

  // [pk]/[fk] constraint is a strong enough signal
  if (hasConstraint && hasTableDecl) return true;

  // Relationship with table declarations is sufficient
  if (hasRelationship && hasTableDecl) return true;

  return false;
}

// ============================================================
// Symbol extraction (for completion API)
// ============================================================

import type { DiagramSymbols } from '../completion';

/**
 * Extract table names (entities) and ER keywords from document text.
 * Used by the dgmo completion API for ghost hints and popup completions.
 */
export function extractSymbols(docText: string): DiagramSymbols {
  const entities: string[] = [];
  let inMetadata = true;
  for (const rawLine of docText.split('\n')) {
    const line = rawLine.trim();
    if (inMetadata && /^chart\s*:/i.test(line)) continue;
    if (inMetadata && /^[a-z-]+\s*:/i.test(line)) continue; // metadata key
    inMetadata = false;
    if (line.length === 0) continue;
    if (/^\s/.test(rawLine)) continue; // indented = column definition, not table
    const m = TABLE_DECL_RE.exec(line);
    if (m) entities.push(m[1]!);
  }
  return {
    kind: 'er',
    entities,
    keywords: ['pk', 'fk', 'unique', 'nullable', '1', '*', '?'],
  };
}

import { resolveColorWithDiagnostic } from '../colors';
import type { PaletteColors } from '../palettes';
import {
  makeDgmoError,
  formatDgmoError,
  suggest,
  NAME_DIAGNOSTIC_CODES,
  nameMergedMessage,
} from '../diagnostics';
import { validateLabelCharacters } from '../utils/arrows';
import { normalizeName, displayName } from '../utils/name-normalize';
import {
  measureIndent,
  extractColor,
  parsePipeMetadata,
  parseFirstLine,
  OPTION_NOCOLON_RE,
  tryParseSharedOption,
  stripQuotes,
  tokenizeQuoteAware,
} from '../utils/parsing';
import {
  matchTagBlockHeading,
  emitTagLegacyDiagnostic,
  validateTagValues,
  validateTagGroupNames,
  stripDefaultModifier,
} from '../utils/tag-groups';
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
  return normalizeName(name);
}

// ============================================================
// Regex patterns
// ============================================================

// Table declaration: `name`, `name color` (trailing-token §1.5), or
// `name | key: value`. Multi-word names allowed; quote `"name with reserved
// chars"` if the name contains pipe / paren / colon. Captures:
//   1: quoted-name content (without surrounding quotes), or undefined
//   2: bare-name (trimmed at call site), or undefined
//   3: trailing-token color (recognized palette word), or undefined
//   4: pipe metadata (without leading `|`), or undefined
const TABLE_DECL_RE =
  /^(?:"([^"]+)"|([a-zA-Z_][^|":(]*?))(?:\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white))?(?:\s*\|(.+))?$/;

// Column: name [type] [constraints...]  — space-separated, no colon, no brackets
// First token is always the name. Second token is the type if it's not a constraint keyword.
// Remaining tokens are constraint keywords (pk, fk, unique, nullable).
// Handled programmatically, not with a single regex.

// Indented relationship: 1-* target, 1--* target, or 1-label-* target / 1--label--* target
// Target name accepts multi-word + quoted form per Universal Name Handling.
const INDENT_REL_RE =
  /^([1*?])-{1,2}(?:(.+?)-{1,2})?([1*?])\s+(?:"([^"]+)"|([a-zA-Z_][^":]*?))\s*$/;

// Constraint keywords
const CONSTRAINT_MAP: Record<string, ERConstraint> = {
  pk: 'pk',
  fk: 'fk',
  unique: 'unique',
  nullable: 'nullable',
};

// Known options (space-separated, no colon)
const KNOWN_OPTIONS = new Set(['notation', 'active-tag']);

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
 * Supported form (no colon before label):
 *   tableName 1--* tableName label
 *   tableName 1-* tableName label
 *   tableName ?--1 tableName
 */
// Top-level relationship (symbolic): SourceName 1--* TargetName [label]
// Both names accept quoted or multi-word bare form.
const REL_SYMBOLIC_RE =
  /^(?:"([^"]+)"|([a-zA-Z_][^":]*?))\s+([1*?])\s*-{1,2}\s*([1*?])\s+(?:"([^"]+)"|([a-zA-Z_][^":]*?))(?:\s+(.+))?$/;

/** Detects keyword cardinality forms to emit helpful error */
const REL_KEYWORD_RE =
  /^(?:"([^"]+)"|([a-zA-Z_][^":]*?))\s+(one|many|zero)[- ]to[- ](one|many|zero)\s+(?:"([^"]+)"|([a-zA-Z_][^":]*?))(?:\s+(.+))?$/i;

const KEYWORD_TO_SYMBOL: Record<string, string> = {
  one: '1',
  many: '*',
  zero: '?',
};

function parseRelationship(
  trimmed: string,
  lineNumber: number,
  pushError: (line: number, message: string) => void
): {
  source: string;
  target: string;
  from: ERCardinality;
  to: ERCardinality;
  label?: string;
} | null {
  // Symbolic: 1--*, 1-*, ?--1, etc.
  // Captures: [1]=qSrc [2]=bareSrc [3]=fromCard [4]=toCard [5]=qTarget [6]=bareTarget [7]=label
  const sym = trimmed.match(REL_SYMBOLIC_RE);
  if (sym) {
    const fromCard = parseCardSide(sym[3]);
    const toCard = parseCardSide(sym[4]);
    if (fromCard && toCard) {
      const sourceName = (sym[1] ?? sym[2] ?? '').trim();
      const targetName = (sym[5] ?? sym[6] ?? '').trim();
      const label = sym[7]?.trim();
      if (label) {
        validateLabelCharacters(label, lineNumber).forEach((d) =>
          pushError(d.line, d.message)
        );
      }
      return {
        source: tableId(sourceName),
        target: tableId(targetName),
        from: fromCard,
        to: toCard,
        label,
      };
    }
  }

  // Keyword / natural: produce helpful error with symbolic suggestion.
  // Captures: [1]=qSrc [2]=bareSrc [3]=fromKw [4]=toKw [5]=qTarget [6]=bareTarget [7]=label
  const kw = trimmed.match(REL_KEYWORD_RE);
  if (kw) {
    const sourceName = (kw[1] ?? kw[2] ?? '').trim();
    const targetName = (kw[5] ?? kw[6] ?? '').trim();
    const fromSym = KEYWORD_TO_SYMBOL[kw[3].toLowerCase()] ?? kw[3];
    const toSym = KEYWORD_TO_SYMBOL[kw[4].toLowerCase()] ?? kw[4];
    pushError(
      lineNumber,
      `Use symbolic cardinality (1--*, ?--1, *--*) instead of "${kw[3]}-to-${kw[4]}". Example: ${sourceName} ${fromSym}--${toSym} ${targetName}`
    );
    return null;
  }

  return null;
}

// ============================================================
// Column parser (space-separated: name [type] [constraints...])
// ============================================================

function parseColumn(trimmed: string): {
  name: string;
  type?: string;
  constraints: ERConstraint[];
} | null {
  // Quote-aware tokenizer keeps `"first name"` together as a single token
  // so multi-word column names work via Universal Name Handling quoting.
  const rawTokens = tokenizeQuoteAware(trimmed);
  if (rawTokens.length === 0) return null;

  const firstRaw = rawTokens[0];
  const wasQuoted = firstRaw.startsWith('"') || firstRaw.startsWith("'");
  const name = stripQuotes(firstRaw);

  // Bare names must look like a single word (preserves rejection of lines
  // that aren't column declarations, e.g. relationships). Quoted names are
  // accepted as-is.
  if (!wasQuoted && !/^\w+$/.test(name)) return null;

  const constraints: ERConstraint[] = [];
  let type: string | undefined;

  for (let i = 1; i < rawTokens.length; i++) {
    const tok = stripQuotes(rawTokens[i]);
    const lower = tok.toLowerCase();
    const constraint = CONSTRAINT_MAP[lower];
    if (constraint) {
      constraints.push(constraint);
    } else if (type === undefined) {
      // First non-constraint token after name is the type
      type = tok;
    } else {
      // Unknown token after type — not a valid column line
      return null;
    }
  }

  return { name, type, constraints };
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

  const pushError = (line: number, message: string): void => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    if (!result.error) result.error = formatDgmoError(diag);
  };

  const tableMap = new Map<string, ERTable>();
  let currentTable: ERTable | null = null;
  let contentStarted = false;
  let currentTagGroup: TagGroup | null = null;
  // metaAliasMap: tag-group metadata-key aliases (per A1 convention).
  const metaAliasMap = new Map<string, string>();
  // nameAliasMap: TD-18 entity-name aliases (`u` → `users`). Per C8.
  const nameAliasMap = new Map<string, string>();
  function peelAlias(label: string): { label: string; alias?: string } {
    const trimmed = label.trim();
    const m = trimmed.match(/^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/);
    if (!m) return { label: trimmed };
    return { label: m[1].trim(), alias: m[2] };
  }
  function resolveAliasName(token: string): string {
    return nameAliasMap.get(token.trim()) ?? token;
  }
  let firstLineParsed = false;

  function getOrCreateTable(name: string, lineNumber: number): ERTable {
    const key = tableId(name);
    const existing = tableMap.get(key);
    if (existing) {
      const incomingDisplay = displayName(name);
      const existingDisplay = displayName(existing.name);
      if (incomingDisplay !== existingDisplay) {
        result.diagnostics.push(
          makeDgmoError(
            lineNumber,
            nameMergedMessage({
              incomingDisplay,
              incomingLine: lineNumber,
              existingDisplay,
              existingLine: existing.lineNumber,
            }),
            'warning',
            NAME_DIAGNOSTIC_CODES.NAME_MERGED
          )
        );
      }
      return existing;
    }

    const table: ERTable = {
      id: key,
      name,
      columns: [],
      metadata: {},
      lineNumber,
    };
    tableMap.set(key, table);
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

    // First line: chart type + optional title
    if (!firstLineParsed && indent === 0) {
      const firstLineResult = parseFirstLine(trimmed);
      if (firstLineResult?.chartType === 'er') {
        firstLineParsed = true;
        if (firstLineResult.title) {
          result.title = firstLineResult.title;
          result.titleLineNumber = lineNumber;
        }
        continue;
      }
      // Not an explicit `er` first line — that's OK, treat as implicit
      firstLineParsed = true;
    }

    // Tag group heading — `tag Name`
    if (!contentStarted && indent === 0) {
      const tagBlockMatch = matchTagBlockHeading(trimmed);
      if (tagBlockMatch) {
        emitTagLegacyDiagnostic(tagBlockMatch, lineNumber, result.diagnostics);
        currentTagGroup = {
          name: tagBlockMatch.name,
          alias: tagBlockMatch.alias,
          entries: [],
          lineNumber,
        };
        if (tagBlockMatch.alias) {
          metaAliasMap.set(
            normalizeName(tagBlockMatch.alias),
            tagBlockMatch.name.toLowerCase()
          );
        }
        result.tagGroups.push(currentTagGroup);
        continue;
      }
    }

    // Tag group entries (indented under tag heading)
    if (currentTagGroup && !contentStarted && indent > 0) {
      const { text: cleanEntry, isDefault } = stripDefaultModifier(trimmed);
      const { label, color } = extractColor(cleanEntry, palette);
      if (!color) {
        result.diagnostics.push(
          makeDgmoError(
            lineNumber,
            `Expected 'Value color' in tag group '${currentTagGroup.name}'`,
            'warning'
          )
        );
        continue;
      }
      if (isDefault) {
        currentTagGroup.defaultValue = label;
      } else if (currentTagGroup.entries.length === 0) {
        currentTagGroup.defaultValue = label;
      }
      currentTagGroup.entries.push({ value: label, color, lineNumber });
      continue;
    }

    // End tag group on non-indented line
    if (currentTagGroup && indent === 0) {
      currentTagGroup = null;
    }

    // Options (space-separated, no colon) — before content
    if (!contentStarted && indent === 0) {
      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch) {
        const key = optMatch[1].toLowerCase();
        const value = optMatch[2].trim();
        if (KNOWN_OPTIONS.has(key)) {
          result.options[key] = value.toLowerCase();
          continue;
        }
      }
      if (tryParseSharedOption(trimmed, result.options)) {
        continue;
      }
    }

    // Indented lines = columns or relationships of current table
    if (indent > 0 && currentTable) {
      // Try indented relationship first: 1-* target  or  1-label-* target
      // ER chart-specific constraint: labels cannot contain `-` because
      // INDENT_REL_RE uses `-{1,2}` as hard delimiters on both sides of the
      // label. So `1-has-*` works but `1-has dashes-*` does not.
      // INDENT_REL_RE captures: [1]=fromCard [2]=label [3]=toCard
      // [4]=qTarget [5]=bareTarget
      const indentRel = trimmed.match(INDENT_REL_RE);
      if (indentRel) {
        const fromCard = parseCardSide(indentRel[1]);
        const toCard = parseCardSide(indentRel[3]);
        if (fromCard && toCard) {
          const rawTarget = (indentRel[4] ?? indentRel[5] ?? '').trim();
          // TD-18: resolve alias literal → canonical table name.
          const targetName = resolveAliasName(rawTarget);
          getOrCreateTable(targetName, lineNumber);
          const rawLabel = indentRel[2]?.trim();
          if (rawLabel) {
            result.diagnostics.push(
              ...validateLabelCharacters(rawLabel, lineNumber)
            );
          }
          result.relationships.push({
            source: currentTable.id,
            target: tableId(targetName),
            cardinality: { from: fromCard, to: toCard },
            ...(rawLabel && { label: rawLabel }),
            lineNumber,
          });
        }
        continue;
      }

      const colResult = parseColumn(trimmed);
      if (colResult) {
        currentTable.columns.push({
          name: colResult.name,
          ...(colResult.type && { type: colResult.type }),
          constraints: colResult.constraints,
          lineNumber,
        });
      }
      continue;
    }

    // At indent 0 — this ends any previous table context
    currentTable = null;
    contentStarted = true;

    // Reject top-level relationships — must be indented under source table
    const rel = parseRelationship(trimmed, lineNumber, pushError);
    if (rel) {
      result.diagnostics.push(
        makeDgmoError(
          lineNumber,
          `Relationship "${rel.source} → ${rel.target}" must be indented under the source table "${rel.source}"`,
          'warning'
        )
      );
      continue;
    }

    // Try table declaration
    // Captures: [1]=quotedName [2]=bareName [3]=color [4]=pipe
    const tableDecl = trimmed.match(TABLE_DECL_RE);
    if (tableDecl) {
      const rawName = (tableDecl[1] ?? tableDecl[2] ?? '').trim();
      // TD-18: peel optional `as <alias>` from the name slot.
      const peeled = peelAlias(rawName);
      const name = peeled.label;
      if (peeled.alias) nameAliasMap.set(peeled.alias, name);
      const colorName = tableDecl[3]?.trim();
      const color = colorName
        ? resolveColorWithDiagnostic(
            colorName,
            lineNumber,
            result.diagnostics,
            palette
          )
        : undefined;

      const table = getOrCreateTable(name, lineNumber);
      if (color) table.color = color;
      table.lineNumber = lineNumber;

      // Parse pipe metadata: TableName(color) | key: value, key2: value2
      const pipeStr = tableDecl[4]?.trim();
      if (pipeStr) {
        const pipeSegments = pipeStr.split('|');
        const meta = parsePipeMetadata(['', ...pipeSegments], metaAliasMap);
        Object.assign(table.metadata, meta);
      }

      currentTable = table;
      continue;
    }

    // Catch-all: nothing matched this line
    result.diagnostics.push(
      makeDgmoError(lineNumber, `Unexpected line: '${trimmed}'.`, 'warning')
    );
  }

  // Validation
  if (result.tables.length === 0 && !result.error) {
    const diag = makeDgmoError(
      1,
      'No tables found. Add table declarations like "users" or "orders blue".'
    );
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
      (line, msg) =>
        result.diagnostics.push(makeDgmoError(line, msg, 'warning')),
      suggest
    );
    validateTagGroupNames(result.tagGroups, (line, msg) =>
      result.diagnostics.push(makeDgmoError(line, msg, 'warning'))
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
  if (
    result.tables.length >= 2 &&
    result.relationships.length >= 1 &&
    !result.error
  ) {
    const connectedIds = new Set<string>();
    for (const rel of result.relationships) {
      // rel.source and rel.target are already-normalized table ids
      // eslint-disable-next-line name-normalize/required-at-insertion
      connectedIds.add(rel.source);
      // eslint-disable-next-line name-normalize/required-at-insertion
      connectedIds.add(rel.target);
    }
    for (const table of result.tables) {
      if (!connectedIds.has(table.id)) {
        result.diagnostics.push(
          makeDgmoError(
            table.lineNumber,
            `Table "${table.name}" is not connected to any other table`,
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

// Column detection for looksLikeERDiagram: space-separated with constraint keywords
const CONSTRAINT_KEYWORD_RE = /\b(pk|fk)\b/i;

/**
 * Detect if content looks like an ER diagram without explicit `er` first line.
 * Looks for indented lines with pk or fk constraint keywords.
 */
export function looksLikeERDiagram(content: string): boolean {
  const lines = content.split('\n');

  let hasConstraint = false;
  let hasTableDecl = false;
  let hasRelationship = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Skip metadata (both old colon and new space-separated)
    if (/^(er|notation)\s/i.test(trimmed) || /^er$/i.test(trimmed)) continue;

    const indent = measureIndent(line);

    if (indent > 0) {
      // Indented line with pk or fk is strong ER signal
      if (CONSTRAINT_KEYWORD_RE.test(trimmed)) {
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

  // pk/fk constraint is a strong enough signal
  if (hasConstraint && hasTableDecl) return true;

  // Relationship with table declarations is sufficient
  if (hasRelationship && hasTableDecl) return true;

  return false;
}

// ============================================================
// Symbol extraction (for completion API)
// ============================================================

import type { DiagramSymbols } from '../completion-types';

/**
 * Extract table names (entities) and ER keywords from document text.
 * Used by the dgmo completion API for ghost hints and popup completions.
 */
export function extractSymbols(docText: string): DiagramSymbols {
  const entities: string[] = [];
  let inMetadata = true;
  for (const rawLine of docText.split('\n')) {
    const line = rawLine.trim();
    if (inMetadata && /^er(\s|$)/i.test(line)) continue;
    // Under §1.5 trailing-token, `Users blue` matches OPTION_NOCOLON_RE
    // (key=Users, value=blue) but is actually a table with a color.
    // Detect tables FIRST so they aren't swallowed by the option fallback.
    if (/^\s/.test(rawLine)) continue; // indented = column definition, not table
    if (line.length === 0) continue;
    const m = TABLE_DECL_RE.exec(line);
    if (m) {
      const name = (m[1] ?? m[2] ?? '').trim();
      if (name) {
        inMetadata = false;
        entities.push(name);
        continue;
      }
    }
    if (inMetadata && OPTION_NOCOLON_RE.test(line)) continue; // option line
    inMetadata = false;
  }
  return {
    kind: 'er',
    entities,
    keywords: ['pk', 'fk', 'unique', 'nullable', '1', '*', '?'],
  };
}

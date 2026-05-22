import type { PaletteColors } from '../palettes';
import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import { resolveColorWithDiagnostic } from '../colors';
import {
  matchTagBlockHeading,
  emitTagLegacyDiagnostic,
  stripDefaultModifier,
  validateTagGroupNames,
} from '../utils/tag-groups';
import {
  measureIndent,
  extractColor,
  parsePipeMetadata,
  parseFirstLine,
  OPTION_NOCOLON_RE,
} from '../utils/parsing';
import { normalizeName } from '../utils/name-normalize';
import type {
  ParsedKanban,
  KanbanColumn,
  KanbanCard,
  KanbanTagGroup,
} from './types';

// ============================================================
// Regex patterns
// ============================================================

// [Column Name], [Column Name] color, [Column Name] as <alias>, [Column Name] | wip: 3, etc.
// Universal §1.5 trailing-token: color is a bare token after `]`.
// Captures: [1]=label [2]=color [3]=alias (TD-18) [4]=pipe meta
const COLUMN_RE =
  /^\[(.+?)\](?:\s+(\S+))?(?:\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11}))?\s*(?:\|\s*(.+))?$/;
// Legacy delimiter
const LEGACY_COLUMN_RE = /^==\s+(.+?)\s*(?:\[wip:\s*(\d+)\])?\s*==$/;

/** Known kanban options (key-value). */
const KNOWN_OPTIONS = new Set(['hide', 'active-tag']);
/** Known kanban boolean options (bare keyword = on). */
const KNOWN_BOOLEANS = new Set<string>([
  'no-auto-color',
  'solid-fill',
  'no-title',
]);

// ============================================================
// Parser
// ============================================================

export function parseKanban(
  content: string,
  palette?: PaletteColors
): ParsedKanban {
  const result: ParsedKanban = {
    type: 'kanban',
    columns: [],
    tagGroups: [],
    options: {},
    diagnostics: [],
    error: null,
  };

  const fail = (line: number, message: string): ParsedKanban => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  const warn = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  if (!content?.trim()) {
    return fail(0, 'No content provided');
  }

  const lines = content.split('\n');
  let contentStarted = false;
  let currentTagGroup: KanbanTagGroup | null = null;
  let currentColumn: KanbanColumn | null = null;
  let currentCard: KanbanCard | null = null;
  let cardBaseIndent = 0; // indent level of current card (for detail detection)
  let columnCounter = 0;
  let cardCounter = 0;

  // metaAliasMap: tag-group metadata-key aliases (per A1 convention).
  const metaAliasMap = new Map<string, string>();
  // nameAliasMap: TD-18 entity-name aliases for kanban columns. Per C8.
  const nameAliasMap = new Map<string, string>();

  // Build a lookup for tag group entries (for validation)
  const tagValueSets = new Map<string, Set<string>>();

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

    // Extract chart type + title from first line (e.g. `kanban Sprint 12`)
    if (!contentStarted && !currentTagGroup) {
      const firstLine = parseFirstLine(trimmed);
      if (firstLine) {
        if (firstLine.chartType !== 'kanban') {
          const allTypes = [
            'kanban',
            'org',
            'class',
            'flowchart',
            'sequence',
            'er',
            'bar',
            'line',
            'pie',
          ];
          let msg = `Expected chart type "kanban", got "${firstLine.chartType}"`;
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

    // Tag group heading — `tag Name`
    // Must be checked BEFORE OPTION_RE to prevent `tag Rank` being swallowed as option
    if (!contentStarted) {
      const tagBlockMatch = matchTagBlockHeading(trimmed);
      if (tagBlockMatch) {
        emitTagLegacyDiagnostic(tagBlockMatch, lineNumber, result.diagnostics);
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
        result.tagGroups.push(currentTagGroup);
        continue;
      }
    }

    // Generic header options (space-separated: `key value` or bare boolean `key`)
    // Only match known option keys to avoid swallowing content lines
    if (!contentStarted && !currentTagGroup && measureIndent(line) === 0) {
      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch && !COLUMN_RE.test(trimmed)) {
        // OPTION_NOCOLON_RE has 2 capture groups; both exist when matched.
        const key = optMatch[1]!.trim().toLowerCase();
        if (KNOWN_OPTIONS.has(key)) {
          result.options[key] = optMatch[2]!.trim();
          continue;
        }
      }
      // Bare boolean option (single keyword, no value)
      if (
        KNOWN_BOOLEANS.has(trimmed.toLowerCase()) &&
        !COLUMN_RE.test(trimmed)
      ) {
        result.options[trimmed.toLowerCase()] = 'on';
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
          warn(
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
      // Non-indented line after tag group — fall through
      currentTagGroup = null;
    }

    // --- Content phase ---

    const indent = measureIndent(line);

    // Reject legacy == Column == syntax
    if (LEGACY_COLUMN_RE.test(trimmed)) {
      const legacyMatch = trimmed.match(LEGACY_COLUMN_RE)!;
      const name = legacyMatch[1]!.replace(/\s*\(.*\)\s*$/, '').trim();
      result.diagnostics.push(
        makeDgmoError(
          lineNumber,
          `'== ${name} ==' is no longer supported. Use '[${name}]' instead`
        )
      );
      continue;
    }

    // [Column] header at indent 0
    const columnMatch = indent === 0 ? trimmed.match(COLUMN_RE) : null;
    if (columnMatch) {
      contentStarted = true;
      currentTagGroup = null;

      // Finalize previous card's endLineNumber
      if (currentCard) {
        currentCard.endLineNumber = lineNumber - 1;
        while (
          currentCard.endLineNumber > currentCard.lineNumber &&
          !lines[currentCard.endLineNumber - 1]!.trim()
        ) {
          currentCard.endLineNumber--;
        }
      }
      currentCard = null;

      columnCounter++;
      const colName = columnMatch[1]!.trim();
      // Trailing token after `]` must be a recognized color word (§1.5).
      // If it isn't, the line is malformed — emit the standard diagnostic.
      const rawTrailing = columnMatch[2]?.trim();
      const colColor = rawTrailing
        ? resolveColorWithDiagnostic(
            rawTrailing,
            lineNumber,
            result.diagnostics,
            palette
          )
        : undefined;
      // TD-18: alias capture (group 3 after regex extension).
      // Bind to the column id once it's allocated below.
      const colAlias = columnMatch[3];

      // Parse pipe metadata (e.g., "| wip: 3, t: Sprint1")
      let wipLimit: number | undefined;
      const columnMetadata: Record<string, string> = {};
      const pipeStr = columnMatch[4];
      if (pipeStr) {
        const pipeSegments = ['', pipeStr];
        Object.assign(
          columnMetadata,
          parsePipeMetadata(pipeSegments, metaAliasMap)
        );
        // Extract wip from metadata
        if (columnMetadata['wip']) {
          const wipVal = parseInt(columnMetadata['wip'], 10);
          if (!isNaN(wipVal)) {
            wipLimit = wipVal;
          }
        }
      }

      const colId = `col-${columnCounter}`;
      if (colAlias) nameAliasMap.set(colAlias, colId);
      currentColumn = {
        id: colId,
        name: colName,
        ...(wipLimit !== undefined && { wipLimit }),
        ...(colColor !== undefined && { color: colColor }),
        cards: [],
        lineNumber,
        metadata: columnMetadata,
      };
      result.columns.push(currentColumn);
      continue;
    }

    // If we hit a non-column, non-header line and haven't started content yet,
    // skip silently (blank lines or whitespace between header and columns)
    if (!contentStarted) {
      continue;
    }

    if (!currentColumn) {
      warn(lineNumber, 'Card line found before any column');
      continue;
    }

    // Detail lines: indented deeper than the card
    if (currentCard && indent > cardBaseIndent) {
      currentCard.details.push(trimmed);
      currentCard.endLineNumber = lineNumber;
      continue;
    }

    // Card line: indented under a [Column]
    if (indent > 0) {
      cardCounter++;
      const card = parseCardLine(
        trimmed,
        lineNumber,
        cardCounter,
        metaAliasMap,
        palette,
        result.diagnostics
      );
      // Cascade column metadata to card tags (card overrides on conflict)
      // Exclude 'wip' from cascading — it's a column-level property, not a card tag
      if (currentColumn.metadata) {
        for (const [key, value] of Object.entries(currentColumn.metadata)) {
          if (key === 'wip') continue;
          if (!(key in card.tags)) {
            card.tags[key] = value;
          }
        }
      }
      cardBaseIndent = indent;
      currentCard = card;
      currentColumn.cards.push(card);
      continue;
    }

    // Un-indented non-column line in content phase — stray text
    warn(lineNumber, `Unexpected line: '${trimmed}'.`);
  }

  // Finalize last card's endLineNumber
  if (currentCard) {
    // Already tracked via detail lines or card line itself
  }

  // Build tag value sets for validation
  for (const group of result.tagGroups) {
    const values = new Set(group.entries.map((e) => e.value.toLowerCase()));
    tagValueSets.set(group.name.toLowerCase(), values);
  }

  // Validate WIP limits
  for (const col of result.columns) {
    if (col.wipLimit != null && col.cards.length > col.wipLimit) {
      warn(
        col.lineNumber,
        `Column "${col.name}" has ${col.cards.length} cards but WIP limit is ${col.wipLimit}`
      );
    }
  }

  // Validate tag values on cards
  for (const col of result.columns) {
    for (const card of col.cards) {
      for (const [tagKey, tagValue] of Object.entries(card.tags)) {
        const groupKey =
          metaAliasMap.get(tagKey.toLowerCase()) ?? tagKey.toLowerCase();
        const validValues = tagValueSets.get(groupKey);
        if (validValues && !validValues.has(tagValue.toLowerCase())) {
          const entries = result.tagGroups
            .find((g) => g.name.toLowerCase() === groupKey)
            ?.entries.map((e) => e.value);
          let msg = `Unknown tag value "${tagValue}" for group "${groupKey}"`;
          if (entries) {
            const hint = suggest(tagValue, entries);
            if (hint) msg += `. ${hint}`;
          }
          warn(card.lineNumber, msg);
        }
      }
    }
  }

  if (result.columns.length === 0 && !result.error) {
    return fail(1, 'No columns found. Use [Column Name] to define columns');
  }

  validateTagGroupNames(result.tagGroups, warn, (line, msg) => {
    const diag = makeDgmoError(line, msg);
    result.diagnostics.push(diag);
    if (!result.error) result.error = formatDgmoError(diag);
  });

  return result;
}

// ============================================================
// Card line parser
// ============================================================

function parseCardLine(
  trimmed: string,
  lineNumber: number,
  counter: number,
  metaAliasMap: Map<string, string>,
  _palette?: PaletteColors,
  _diagnostics?: import('../diagnostics').DgmoError[]
): KanbanCard {
  // Split on first pipe: Title | tag: value, tag: value
  const pipeIdx = trimmed.indexOf('|');
  let rawTitle: string;
  let tagsStr: string | null = null;

  if (pipeIdx >= 0) {
    rawTitle = trimmed.substring(0, pipeIdx).trim();
    tagsStr = trimmed.substring(pipeIdx + 1).trim();
  } else {
    rawTitle = trimmed;
  }

  const title = rawTitle;

  // Parse tags: comma-separated key: value pairs
  const tags: Record<string, string> = {};
  if (tagsStr) {
    for (const part of tagsStr.split(',')) {
      const colonIdx = part.indexOf(':');
      if (colonIdx > 0) {
        const rawKey = part.substring(0, colonIdx).trim().toLowerCase();
        const key = metaAliasMap.get(rawKey) ?? rawKey;
        const value = part.substring(colonIdx + 1).trim();
        tags[key] = value;
      }
    }
  }

  return {
    id: `card-${counter}`,
    title,
    tags,
    details: [],
    lineNumber,
    endLineNumber: lineNumber,
  };
}

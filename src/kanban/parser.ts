import type { PaletteColors } from '../palettes';
import type { DgmoError } from '../diagnostics';
import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import { matchTagBlockHeading } from '../utils/tag-groups';
import {
  measureIndent,
  extractColor,
  CHART_TYPE_RE,
  TITLE_RE,
  OPTION_RE,
} from '../utils/parsing';
import type {
  ParsedKanban,
  KanbanColumn,
  KanbanCard,
  KanbanTagGroup,
  KanbanTagEntry,
} from './types';

// ============================================================
// Regex patterns
// ============================================================

const COLUMN_RE = /^==\s+(.+?)\s*(?:\[wip:\s*(\d+)\])?\s*==$/;

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

  if (!content || !content.trim()) {
    return fail(0, 'No content provided');
  }

  const lines = content.split('\n');
  let contentStarted = false;
  let currentTagGroup: KanbanTagGroup | null = null;
  let currentColumn: KanbanColumn | null = null;
  let currentCard: KanbanCard | null = null;
  let columnCounter = 0;
  let cardCounter = 0;

  // Alias map: alias (lowercased) → group name (lowercased)
  const aliasMap = new Map<string, string>();

  // Build a lookup for tag group entries (for validation)
  const tagValueSets = new Map<string, Set<string>>();

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
    if (!contentStarted && !currentTagGroup) {
      const chartMatch = trimmed.match(CHART_TYPE_RE);
      if (chartMatch) {
        const chartType = chartMatch[1].trim().toLowerCase();
        if (chartType !== 'kanban') {
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
          let msg = `Expected chart type "kanban", got "${chartType}"`;
          const hint = suggest(chartType, allTypes);
          if (hint) msg += `. ${hint}`;
          return fail(lineNumber, msg);
        }
        continue;
      }
    }

    // title: value
    if (!contentStarted && !currentTagGroup) {
      const titleMatch = trimmed.match(TITLE_RE);
      if (titleMatch) {
        result.title = titleMatch[1].trim();
        result.titleLineNumber = lineNumber;
        continue;
      }
    }

    // Tag group heading — `tag: Name` (new) or `## Name` (deprecated)
    // Must be checked BEFORE OPTION_RE to prevent `tag: Rank` being swallowed as option
    if (!contentStarted) {
      const tagBlockMatch = matchTagBlockHeading(trimmed);
      if (tagBlockMatch) {
        if (tagBlockMatch.deprecated) {
          warn(lineNumber, `'## ${tagBlockMatch.name}' is deprecated for tag groups — use 'tag: ${tagBlockMatch.name}' instead`);
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

    // Generic header options (key: value before content/tag groups)
    if (!contentStarted && !currentTagGroup && measureIndent(line) === 0) {
      const optMatch = trimmed.match(OPTION_RE);
      if (optMatch && !COLUMN_RE.test(trimmed)) {
        const key = optMatch[1].trim().toLowerCase();
        if (key !== 'chart' && key !== 'title') {
          result.options[key] = optMatch[2].trim();
          continue;
        }
      }
    }

    // Tag group entries (indented Value(color) [default] under ## heading)
    if (currentTagGroup && !contentStarted) {
      const indent = measureIndent(line);
      if (indent > 0) {
        const isDefault = /\bdefault\s*$/.test(trimmed);
        const entryText = isDefault
          ? trimmed.replace(/\s+default\s*$/, '').trim()
          : trimmed;
        const { label, color } = extractColor(entryText, palette);
        if (!color) {
          warn(
            lineNumber,
            `Expected 'Value(color)' in tag group '${currentTagGroup.name}'`
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
      // Non-indented line after tag group — fall through
      currentTagGroup = null;
    }

    // --- Content phase ---

    // Column delimiter: == Name == or == Name [wip: N] ==
    const columnMatch = trimmed.match(COLUMN_RE);
    if (columnMatch) {
      contentStarted = true;
      currentTagGroup = null;

      // Finalize previous card's endLineNumber
      if (currentCard) {
        currentCard.endLineNumber = lineNumber - 1;
        // Walk back over trailing empty lines
        while (
          currentCard.endLineNumber > currentCard.lineNumber &&
          !lines[currentCard.endLineNumber - 1].trim()
        ) {
          currentCard.endLineNumber--;
        }
      }
      currentCard = null;

      columnCounter++;
      const rawColName = columnMatch[1].trim();
      const wipStr = columnMatch[2];
      const { label: colName, color: colColor } = extractColor(
        rawColName,
        palette
      );
      currentColumn = {
        id: `col-${columnCounter}`,
        name: colName,
        wipLimit: wipStr ? parseInt(wipStr, 10) : undefined,
        color: colColor,
        cards: [],
        lineNumber,
      };
      result.columns.push(currentColumn);
      continue;
    }

    // If we hit a non-column, non-header line and haven't started content yet,
    // it's invalid (cards without a column)
    if (!contentStarted) {
      // Could be the first column, or an error
      // For permissiveness, skip these lines silently (they might be blank
      // lines or just whitespace between header and columns)
      continue;
    }

    if (!currentColumn) {
      // Content line before any column — skip with warning
      warn(lineNumber, 'Card line found before any column');
      continue;
    }

    const indent = measureIndent(line);

    // Detail lines: indented under a card
    if (indent > 0 && currentCard) {
      currentCard.details.push(trimmed);
      currentCard.endLineNumber = lineNumber;
      continue;
    }

    // New card line (non-indented within a column)
    // Finalize previous card
    if (currentCard) {
      // endLineNumber already tracked
    }

    cardCounter++;
    const card = parseCardLine(
      trimmed,
      lineNumber,
      cardCounter,
      aliasMap,
      palette
    );
    currentCard = card;
    currentColumn.cards.push(card);
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
        const groupKey = aliasMap.get(tagKey.toLowerCase()) ?? tagKey.toLowerCase();
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
    return fail(1, 'No columns found. Use == Column Name == to define columns');
  }

  return result;
}

// ============================================================
// Card line parser
// ============================================================

function parseCardLine(
  trimmed: string,
  lineNumber: number,
  counter: number,
  aliasMap: Map<string, string>,
  palette?: PaletteColors
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

  // Extract optional color suffix from title
  const { label: title, color } = extractColor(rawTitle, palette);

  // Parse tags: comma-separated key: value pairs
  const tags: Record<string, string> = {};
  if (tagsStr) {
    for (const part of tagsStr.split(',')) {
      const colonIdx = part.indexOf(':');
      if (colonIdx > 0) {
        const rawKey = part.substring(0, colonIdx).trim().toLowerCase();
        const key = aliasMap.get(rawKey) ?? rawKey;
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
    color,
  };
}

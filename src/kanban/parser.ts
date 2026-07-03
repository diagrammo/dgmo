import type { PaletteColors } from '../palettes';
import {
  formatDgmoError,
  makeDgmoError,
  makeFail,
  suggest,
} from '../diagnostics';
import { resolveColorWithDiagnostic } from '../colors';
import {
  KANBAN_REGISTRY,
  withTagAliases,
} from '../utils/reserved-key-registry';
import {
  matchTagBlockHeading,
  stripDefaultModifier,
  validateTagGroupNames,
  finalizeAutoTagColors,
  AUTO_TAG_COLOR_SENTINEL,
  tagAttrKey,
} from '../utils/tag-groups';
import {
  measureIndent,
  extractColor,
  splitNameAndMeta,
  parseFirstLine,
  OPTION_NOCOLON_RE,
  warnUnknownMetaKeys,
} from '../utils/parsing';
import { normalizeName } from '../utils/name-normalize';
import type { Writable } from '../utils/brand';
import type {
  ParsedKanban,
  KanbanColumn,
  KanbanCard,
  KanbanTagGroup,
} from './types';

// ============================================================
// Regex patterns
// ============================================================

// [Column Name], [Column Name] color, [Column Name] as <alias>, [Column Name] wip: 3, etc.
// Universal §1.5 trailing-token: color is a bare token after `]`.
// Universal §1.4 same-line metadata also allowed after `]`.
// Captures: [1]=label [2]=trailing content (color / alias / metadata, parsed below)
const COLUMN_RE = /^\[(.+?)\]\s*(.*)$/;
const PALETTE_COLOR_WORD_RE =
  /^(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white)\b/;
const AS_ALIAS_TOKEN_RE = /^as\s+([A-Za-z][A-Za-z0-9_]{0,11})\b/;

/** Known kanban options (key-value). */
const KNOWN_OPTIONS = new Set(['hide', 'active-tag']);
/** Known kanban boolean options (bare keyword = on). */
const KNOWN_BOOLEANS = new Set<string>(['solid-fill', 'no-title']);
const REMOVED_BOOLEANS: Record<string, string> = {
  'no-auto-color':
    '"no-auto-color" was removed — colors are always auto-assigned from the palette; delete this line.',
};

// ============================================================
// Parser
// ============================================================

export function parseKanban(
  content: string,
  palette?: PaletteColors
): ParsedKanban {
  const options: Record<string, string> = {};
  const result: Writable<ParsedKanban> = {
    type: 'kanban',
    columns: [],
    tagGroups: [],
    options,
    diagnostics: [],
    error: null,
  };

  const fail = makeFail(result);

  const warn = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  if (!content?.trim()) {
    return fail(0, 'No content provided');
  }

  const lines = content.split('\n');
  let contentStarted = false;
  let currentTagGroup: Writable<KanbanTagGroup> | null = null;
  let currentColumn: Writable<KanbanColumn> | null = null;
  let currentCard: Writable<KanbanCard> | null = null;
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
        // §1.4 dispatch: register the canonical tag name so `priority: X`
        // also dispatches as metadata (not just the optional `p: X` alias).
        metaAliasMap.set(
          normalizeName(tagBlockMatch.name),
          tagAttrKey(tagBlockMatch.name)
        );
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
          options[key] = optMatch[2]!.trim();
          continue;
        }
      }
      const removedMsg = REMOVED_BOOLEANS[trimmed.toLowerCase()];
      if (removedMsg && !COLUMN_RE.test(trimmed)) {
        warn(lineNumber, removedMsg);
        continue;
      }
      if (
        KNOWN_BOOLEANS.has(trimmed.toLowerCase()) &&
        !COLUMN_RE.test(trimmed)
      ) {
        options[trimmed.toLowerCase()] = 'on';
        continue;
      }
    }

    // Tag group entries (indented Value color under tag heading)
    // First entry is the default unless another is marked `default`
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
        // Bare value (no explicit color) → keep it; finalized below.
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
      // Non-indented line after tag group — fall through
      currentTagGroup = null;
    }

    // --- Content phase ---

    const indent = measureIndent(line);

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
      let tail = (columnMatch[2] ?? '').trim();

      // Parse tail in order: optional color word, optional `as <alias>`,
      // optional same-line metadata (per §1.4) — with legacy `|` detection.
      let colColor: string | undefined;
      const colorMatch = tail.match(PALETTE_COLOR_WORD_RE);
      if (colorMatch) {
        colColor = resolveColorWithDiagnostic(
          colorMatch[1]!,
          lineNumber,
          result.diagnostics,
          palette
        );
        tail = tail.substring(colorMatch[0]!.length).trim();
      }

      let colAlias: string | undefined;
      const aliasMatch = tail.match(AS_ALIAS_TOKEN_RE);
      if (aliasMatch) {
        colAlias = aliasMatch[1];
        tail = tail.substring(aliasMatch[0]!.length).trim();
      }

      // §1.4 unified metadata grammar — same-line cut on the tail (which
      // is now `wip: 3, t: Sprint1` shape after color/alias peeled).
      const columnMetadata: Record<string, string> = {};
      let wipLimit: number | undefined;
      if (tail.length > 0) {
        const registry = withTagAliases(
          KANBAN_REGISTRY,
          new Set(metaAliasMap.keys())
        );
        // Build a virtual line so splitNameAndMeta sees the tail at offset 0.
        const split = splitNameAndMeta(
          tail,
          registry,
          metaAliasMap,
          undefined,
          result.diagnostics,
          lineNumber
        );
        warnUnknownMetaKeys(
          split.meta,
          registry,
          (msg) => warn(lineNumber, msg),
          split.name
        );
        Object.assign(columnMetadata, split.meta);
      }
      if (columnMetadata['wip']) {
        const wipVal = parseInt(columnMetadata['wip'], 10);
        if (!isNaN(wipVal)) wipLimit = wipVal;
      }

      // `[Column] collapsed: true` view-state marker (mirrors gantt/sequence):
      // a reserved same-line key seeding the column collapsed, extracted into a
      // typed field and dropped from metadata.
      let colCollapsed = false;
      if (columnMetadata['collapsed']?.toLowerCase() === 'true') {
        colCollapsed = true;
        delete columnMetadata['collapsed'];
      }

      const colId = `col-${columnCounter}`;
      if (colAlias) nameAliasMap.set(colAlias, colId);
      currentColumn = {
        id: colId,
        name: colName,
        ...(wipLimit !== undefined && { wipLimit }),
        ...(colColor !== undefined && { color: colColor }),
        ...(colCollapsed && { collapsed: true }),
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
      warn(
        lineNumber,
        "Card line found before any column. Declare a column first with '[Column Name]', then indent cards beneath it. (§11)"
      );
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
        const cardTags = card.tags as Record<string, string>;
        for (const [key, value] of Object.entries(currentColumn.metadata)) {
          if (key === 'wip') continue;
          if (!(key in cardTags)) {
            cardTags[key] = value;
          }
        }
      }
      cardBaseIndent = indent;
      currentCard = card as Writable<KanbanCard>;
      currentColumn.cards.push(card);
      continue;
    }

    // Un-indented non-column line in content phase — stray text
    warn(
      lineNumber,
      currentColumn
        ? `Unexpected line: '${trimmed}'. Expected an indented card name or column header like '[Column Name]'.`
        : `Unexpected line: '${trimmed}'. Expected a column header like '[Column Name]'.`
    );
  }

  // Finalize last card's endLineNumber
  if (currentCard) {
    // Already tracked via detail lines or card line itself
  }

  // Build tag value sets for validation
  for (const group of result.tagGroups) {
    const values = new Set(group.entries.map((e) => e.value.toLowerCase()));
    tagValueSets.set(tagAttrKey(group.name), values);
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

  // Assign palette colors to bare (colorless) tag values.
  finalizeAutoTagColors(
    result.tagGroups as Writable<KanbanTagGroup>[],
    palette
  );

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
  diagnostics?: import('../diagnostics').DgmoError[]
): KanbanCard {
  // §1.4 unified metadata grammar — same-line cut.
  const registry = withTagAliases(
    KANBAN_REGISTRY,
    new Set(metaAliasMap.keys())
  );
  const split = splitNameAndMeta(
    trimmed,
    registry,
    metaAliasMap,
    undefined,
    diagnostics,
    lineNumber
  );
  warnUnknownMetaKeys(
    split.meta,
    registry,
    (msg) => diagnostics?.push(makeDgmoError(lineNumber, msg, 'warning')),
    split.name
  );
  // Cards don't have a color slot; the §1.5 trailing-token peel that
  // splitNameAndMeta runs by default would strip `Urgent task red` to
  // title `Urgent task`. Restore the trailing color word as part of the
  // literal title for cards.
  const title =
    split.color !== undefined ? `${split.name} ${split.color}` : split.name;
  const tags: Record<string, string> = { ...split.meta };

  return {
    id: `card-${counter}`,
    title,
    tags,
    details: [],
    lineNumber,
    endLineNumber: lineNumber,
  };
}

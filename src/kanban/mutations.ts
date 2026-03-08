import type { ParsedKanban, KanbanCard, KanbanColumn } from './types';

const ARCHIVE_COLUMN_NAME = 'archive';

// ============================================================
// computeCardMove — pure function for source text mutation
// ============================================================

/**
 * Compute new file content after moving a card to a different position.
 *
 * @param content     - original file content string
 * @param parsed      - parsed kanban board
 * @param cardId      - id of the card to move
 * @param targetColumnId - id of the destination column
 * @param targetIndex - position within target column (0 = first card)
 * @returns new content string, or null if move is invalid
 */
export function computeCardMove(
  content: string,
  parsed: ParsedKanban,
  cardId: string,
  targetColumnId: string,
  targetIndex: number
): string | null {
  // Find source card and column
  let sourceCard: KanbanCard | null = null;
  let sourceColumn: KanbanColumn | null = null;

  for (const col of parsed.columns) {
    for (const card of col.cards) {
      if (card.id === cardId) {
        sourceCard = card;
        sourceColumn = col;
        break;
      }
    }
    if (sourceCard) break;
  }

  if (!sourceCard || !sourceColumn) return null;

  const targetColumn = parsed.columns.find((c) => c.id === targetColumnId);
  if (!targetColumn) return null;

  const lines = content.split('\n');

  // Extract the card's lines (0-based indices)
  const startIdx = sourceCard.lineNumber - 1;
  const endIdx = sourceCard.endLineNumber - 1;
  const cardLines = lines.slice(startIdx, endIdx + 1);

  // Remove the card lines from content
  const withoutCard = [
    ...lines.slice(0, startIdx),
    ...lines.slice(endIdx + 1),
  ];

  // Compute insertion point (0-based index in withoutCard)
  let insertIdx: number;

  // Adjust target column and card line numbers after removal
  // Lines after the removed range shift up by the number of removed lines
  const removedCount = endIdx - startIdx + 1;
  const adjustLine = (ln: number): number => {
    // ln is 1-based
    if (ln > endIdx + 1) return ln - removedCount;
    return ln;
  };

  if (targetIndex === 0) {
    // Insert right after column header line
    const adjColLine = adjustLine(targetColumn.lineNumber);
    insertIdx = adjColLine; // 0-based: insert after the column header line
  } else {
    // Insert after the preceding card's last line
    // Get the cards in the target column, excluding the moved card
    const targetCards = targetColumn.cards.filter((c) => c.id !== cardId);
    const clampedIdx = Math.min(targetIndex, targetCards.length);
    const precedingCard = targetCards[clampedIdx - 1];
    if (!precedingCard) {
      // Fallback: after column header
      const adjColLine = adjustLine(targetColumn.lineNumber);
      insertIdx = adjColLine;
    } else {
      const adjEndLine = adjustLine(precedingCard.endLineNumber);
      insertIdx = adjEndLine; // 0-based: insert after this line
    }
  }

  // Splice the card lines into the new position
  const result = [
    ...withoutCard.slice(0, insertIdx),
    ...cardLines,
    ...withoutCard.slice(insertIdx),
  ];

  return result.join('\n');
}

// ============================================================
// computeCardArchive — move card to an Archive section
// ============================================================

/**
 * Move a card to the Archive section at the end of the file.
 * Creates `== Archive ==` if it doesn't exist.
 *
 * @returns new content string, or null if the card is not found
 */
export function computeCardArchive(
  content: string,
  parsed: ParsedKanban,
  cardId: string
): string | null {
  let sourceCard: KanbanCard | null = null;
  for (const col of parsed.columns) {
    for (const card of col.cards) {
      if (card.id === cardId) {
        sourceCard = card;
        break;
      }
    }
    if (sourceCard) break;
  }
  if (!sourceCard) return null;

  const lines = content.split('\n');

  // Extract card lines
  const startIdx = sourceCard.lineNumber - 1;
  const endIdx = sourceCard.endLineNumber - 1;
  const cardLines = lines.slice(startIdx, endIdx + 1);

  // Remove card from its current position
  const withoutCard = [
    ...lines.slice(0, startIdx),
    ...lines.slice(endIdx + 1),
  ];

  // Check if an Archive column already exists
  const archiveCol = parsed.columns.find(
    (c) => c.name.toLowerCase() === ARCHIVE_COLUMN_NAME
  );

  if (archiveCol) {
    // Append to existing archive column
    // Find the last line of the archive column (after removal adjustment)
    const removedCount = endIdx - startIdx + 1;
    let archiveEndLine = archiveCol.lineNumber;
    if (archiveCol.cards.length > 0) {
      const lastCard = archiveCol.cards[archiveCol.cards.length - 1];
      archiveEndLine = lastCard.endLineNumber;
    }
    // Adjust for removed lines
    if (archiveEndLine > endIdx + 1) {
      archiveEndLine -= removedCount;
    }
    // Insert after the archive end (0-based in withoutCard)
    const insertIdx = archiveEndLine; // archiveEndLine is 1-based, so this is after that line
    return [
      ...withoutCard.slice(0, insertIdx),
      ...cardLines,
      ...withoutCard.slice(insertIdx),
    ].join('\n');
  } else {
    // Create archive section at end of file
    // Ensure trailing newline before the new section
    const trimmedEnd = withoutCard.length > 0 && withoutCard[withoutCard.length - 1].trim() === ''
      ? withoutCard
      : [...withoutCard, ''];
    return [
      ...trimmedEnd,
      '[Archive]',
      ...cardLines,
    ].join('\n');
  }
}

/** Check if a column name is the archive column (case-insensitive). */
export function isArchiveColumn(name: string): boolean {
  return name.toLowerCase() === ARCHIVE_COLUMN_NAME;
}

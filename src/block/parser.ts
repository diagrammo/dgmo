// ============================================================
// Block diagram — Parser
// ============================================================
//
// Grid-structured (not a pure indent hierarchy): one source line = one row of
// `[bracket]` cells (+ `_` gaps). A block becomes a CONTAINER by indenting a
// sub-grid under it. Metadata is parsed from the tail AFTER the `]` (the
// boxes-and-lines group idiom — robust to colons inside a label) and a group's
// tag cascades to children. Columns are inferred from the widest row unless
// `columns N` is given; short rows that evenly divide the column count spread to
// fill, a lone block fills the width, and an over-long span clamps to the count.

import type { PaletteColors } from '../palettes';
import {
  formatDgmoError,
  makeDgmoError,
  makeFail,
  suggest,
} from '../diagnostics';
import type { Writable } from '../utils/brand';
import type { TagGroup } from '../utils/tag-groups';
import {
  matchTagBlockHeading,
  validateTagValues,
  validateTagGroupNames,
  stripDefaultModifier,
  finalizeAutoTagColors,
  AUTO_TAG_COLOR_SENTINEL,
  tagAttrKey,
} from '../utils/tag-groups';
import { measureIndent, extractColor, parseFirstLine } from '../utils/parsing';
import type {
  ParsedBlock,
  BlockOptions,
  BlockGrid,
  BlockCell,
  BlockNode,
} from './types';
import { isBlockNode } from './types';

type ContentLine = { indent: number; trimmed: string; lineNumber: number };

export function parseBlock(
  content: string,
  palette?: PaletteColors
): ParsedBlock {
  const options: BlockOptions = { noLegend: false, solidFill: false };
  const result: Writable<ParsedBlock> = {
    type: 'block',
    title: null,
    titleLineNumber: null,
    top: { cols: null, rows: [] },
    tagGroups: [],
    options,
    diagnostics: [],
    error: null,
  };

  const fail = makeFail(result);
  const pushError = (line: number, message: string, code?: string): void => {
    const diag = makeDgmoError(line, message, 'error', code);
    result.diagnostics.push(diag);
    if (!result.error) result.error = formatDgmoError(diag);
  };
  const pushWarning = (line: number, message: string, code?: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning', code));
  };

  if (!content?.trim()) {
    return fail(0, 'No content provided');
  }

  const lines = content.split('\n');
  let contentStarted = false;
  let topCols: number | null = null;
  let currentTagGroup: Writable<TagGroup> | null = null;
  const aliasMap = new Map<string, string>();
  const contentLines: ContentLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNumber = i + 1;
    const trimmed = line.trim();

    if (!trimmed) {
      currentTagGroup = null;
      continue;
    }
    if (trimmed.startsWith('//')) continue;

    // --- Header phase ---
    if (!contentStarted) {
      // First line declares `block [Title]`.
      if (result.titleLineNumber === null && i === 0) {
        const firstLine = parseFirstLine(trimmed);
        if (firstLine) {
          if (firstLine.chartType !== 'block') {
            let msg = `Expected chart type "block", got "${firstLine.chartType}"`;
            const hint = suggest(firstLine.chartType, ['block']);
            if (hint) msg += `. ${hint}`;
            return fail(lineNumber, msg);
          }
          result.title = firstLine.title ?? null;
          result.titleLineNumber = lineNumber;
          continue;
        }
      }

      // Tag group heading: `tag Team as t`.
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
          aliasMap.set(
            tagBlockMatch.alias.toLowerCase(),
            tagAttrKey(tagBlockMatch.name)
          );
        }
        aliasMap.set(
          tagAttrKey(tagBlockMatch.name),
          tagAttrKey(tagBlockMatch.name)
        );
        result.tagGroups.push(currentTagGroup);
        continue;
      }

      // Tag group entries (indented `Value color`).
      if (currentTagGroup) {
        const indent = measureIndent(line);
        if (indent > 0) {
          const { text: cleanEntry, isDefault } = stripDefaultModifier(trimmed);
          const { label, color } = extractColor(
            cleanEntry,
            palette,
            result.diagnostics,
            lineNumber
          );
          if (isDefault || currentTagGroup.entries.length === 0) {
            currentTagGroup.defaultValue = label;
          }
          currentTagGroup.entries.push({
            value: label,
            color: color ?? AUTO_TAG_COLOR_SENTINEL,
            lineNumber,
          });
          continue;
        }
        currentTagGroup = null;
      }

      // Header directives (indent 0). A top-level `columns N` applies to the
      // outer grid but may sit before the tag block, so it's a header line.
      if (measureIndent(line) === 0) {
        const headerCols = trimmed.match(/^columns\s+(\d+)\s*$/i);
        if (headerCols) {
          topCols = parseInt(headerCols[1]!, 10);
          continue;
        }
        if (/^no-legend\s*$/i.test(trimmed)) {
          options.noLegend = true;
          continue;
        }
        if (/^solid-fill\s*$/i.test(trimmed)) {
          options.solidFill = true;
          continue;
        }
      }
    }

    // Tag groups after content has begun are an error.
    if (contentStarted && matchTagBlockHeading(trimmed)) {
      pushError(
        lineNumber,
        'Tag groups must appear before block content',
        'E_TAG_DECLARED_AFTER_CONTENT'
      );
      continue;
    }

    // --- Content phase ---
    contentStarted = true;
    currentTagGroup = null;
    contentLines.push({ indent: measureIndent(line), trimmed, lineNumber });
  }

  // Finalize auto tag colors before any color resolution.
  finalizeAutoTagColors(result.tagGroups as Writable<TagGroup>[], palette);

  // --- Build the grid tree (recursive over indentation) ---
  let idx = 0;
  let nodeCounter = 0;
  const baseIndent = contentLines.length > 0 ? contentLines[0]!.indent : 0;

  const parseGrid = (base: number): BlockGrid => {
    const grid: BlockGrid = { cols: null, rows: [] };
    while (idx < contentLines.length) {
      const ln = contentLines[idx]!;
      if (ln.indent < base) break;
      if (ln.indent > base) {
        // Orphan deeper line with no container header — skip with a hint.
        pushWarning(
          ln.lineNumber,
          `Over-indented line "${ln.trimmed}" has no parent block — ignored`
        );
        idx++;
        continue;
      }

      const colsMatch = ln.trimmed.match(/^columns\s+(\d+)\s*$/i);
      if (colsMatch) {
        grid.cols = parseInt(colsMatch[1]!, 10);
        idx++;
        continue;
      }

      if (/^\[|^_(?=\s|$)|^space(?=\s|$)/.test(ln.trimmed)) {
        const cells = parseRow(
          ln.trimmed,
          ln.lineNumber,
          aliasMap,
          () => ++nodeCounter,
          pushWarning
        );
        idx++;
        // A lone block followed by an indented body is a CONTAINER.
        const only = cells.length === 1 ? cells[0]! : null;
        if (
          only &&
          isBlockNode(only) &&
          idx < contentLines.length &&
          contentLines[idx]!.indent > base
        ) {
          only.grid = parseGrid(contentLines[idx]!.indent);
        }
        if (cells.length > 0) grid.rows.push(cells);
        continue;
      }

      pushWarning(
        ln.lineNumber,
        `Unrecognized line "${ln.trimmed}" — block rows are bracketed (e.g. [A] [B]) or a "columns N" directive`
      );
      idx++;
    }
    return grid;
  };

  result.top = parseGrid(baseIndent);
  if (topCols !== null && result.top.cols === null) result.top.cols = topCols;

  // --- Layout inference: columns, span clamp, even-fill (recursive) ---
  const inferGrid = (grid: BlockGrid): void => {
    const cols =
      grid.cols ??
      Math.max(
        1,
        ...grid.rows.map((r) => r.reduce((s, c) => s + (c.span || 1), 0))
      );
    grid.cols = cols;
    for (const row of grid.rows) {
      for (const c of row) if (c.span > cols) c.span = cols; // clamp overflow
      const cnt = row.length;
      const allOne = row.every((c) => (c.span || 1) === 1);
      if (allOne && cnt > 0 && cnt < cols && cols % cnt === 0) {
        const sp = cols / cnt;
        for (const c of row) c.span = sp; // even-fill divisible short rows
      }
      for (const c of row) if (isBlockNode(c) && c.grid) inferGrid(c.grid);
    }
  };
  inferGrid(result.top);

  // --- Tags: cascade group → children, then validate ---
  const allNodes: BlockNode[] = [];
  const collect = (grid: BlockGrid): void => {
    for (const row of grid.rows)
      for (const c of row)
        if (isBlockNode(c)) {
          allNodes.push(c);
          if (c.grid) collect(c.grid);
        }
  };
  collect(result.top);

  if (result.tagGroups.length > 0) {
    const tagKeys = result.tagGroups.map((g) => tagAttrKey(g.name));
    const cascade = (
      grid: BlockGrid,
      inherited: Record<string, string>
    ): void => {
      for (const row of grid.rows)
        for (const c of row) {
          if (!isBlockNode(c)) continue;
          for (const k of tagKeys) {
            if (!(k in c.metadata) && inherited[k] !== undefined) {
              c.metadata[k] = inherited[k]!;
            }
          }
          if (c.grid) cascade(c.grid, c.metadata);
        }
    };
    cascade(result.top, {});
    validateTagValues(allNodes, result.tagGroups, pushWarning, suggest);
    validateTagGroupNames(result.tagGroups, pushWarning);
  }

  if (allNodes.length === 0 && !result.error) {
    const diag = makeDgmoError(1, 'No blocks found in block diagram');
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
  }

  return result;
}

// ============================================================
// Row + cell parsing
// ============================================================

/** Scan a row left-to-right into cells: each `[label]` carries trailing
 *  metadata up to the next `[` or gap token; `_`/`space` are empty cells. */
function parseRow(
  line: string,
  lineNumber: number,
  aliasMap: Map<string, string>,
  nextId: () => number,
  pushWarning: (line: number, message: string) => void
): BlockCell[] {
  const cells: BlockCell[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    while (i < n && line[i] === ' ') i++;
    if (i >= n) break;

    const gap = line.slice(i).match(/^(_|space)(?=\s|$)/);
    if (gap) {
      cells.push({ empty: true, span: 1 });
      i += gap[1]!.length;
      continue;
    }

    if (line[i] === '[') {
      const end = line.indexOf(']', i);
      if (end < 0) {
        pushWarning(lineNumber, `Unclosed "[" in block row "${line.trim()}"`);
        break;
      }
      const label = line.slice(i + 1, end).trim();
      i = end + 1;

      // Collect trailing metadata tokens until the next bracket or gap token.
      let tail = '';
      while (i < n) {
        let k = i;
        while (k < n && line[k] === ' ') k++;
        if (k >= n || line[k] === '[') {
          i = k;
          break;
        }
        let e = k;
        while (e < n && line[e] !== ' ' && line[e] !== '[') e++;
        const tok = line.slice(k, e);
        if (tok === '_' || tok === 'space') {
          i = k;
          break;
        }
        tail += (tail ? ' ' : '') + tok;
        i = e;
      }

      const { meta, span, collapsed } = parseBlockTail(tail, aliasMap);
      const node: BlockNode = {
        id: `block-node-${nextId()}`,
        label,
        span: span ?? 1,
        collapsed,
        metadata: meta,
        lineNumber,
      };
      cells.push(node);
      continue;
    }

    i++; // skip stray character
  }
  return cells;
}

/** Parse the metadata tail after a `]`: comma-separated `key: value` pairs
 *  (boxes-and-lines idiom), plus the `span:` key and a bare `collapsed` flag. */
function parseBlockTail(
  tail: string,
  aliasMap: Map<string, string>
): { meta: Record<string, string>; span?: number; collapsed: boolean } {
  let collapsed = false;
  const stripped = tail.replace(/(^|\s)collapsed(?=\s|$)/i, (_m, a: string) => {
    collapsed = true;
    return a;
  });

  const meta: Record<string, string> = {};
  let span: number | undefined;
  for (const seg of stripped.split(',')) {
    const t = seg.trim();
    if (!t) continue;
    const colonIdx = t.indexOf(':');
    if (colonIdx < 0) continue; // bare words ignored (no status system)
    const rawKey = t.slice(0, colonIdx).trim().toLowerCase();
    const value = t.slice(colonIdx + 1).trim();
    if (rawKey === 'span') {
      const num = parseInt(value, 10);
      if (Number.isFinite(num) && num >= 1) span = num;
    } else if (value) {
      meta[aliasMap.get(rawKey) ?? rawKey] = value;
    }
  }

  return { meta, ...(span !== undefined && { span }), collapsed };
}

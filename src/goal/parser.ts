// ============================================================
// Goal chart — Parser
// ============================================================
//
// Syntax:
//   goal <Title with unit>          // trailing color token ok (§1.5)
//   [thermometer | gauge]           // bare-flag mode (omit = progress bar)
//   now <number>                    // space-separated key value (no colon)
//   target <number>
//   note <text>                     // optional free-text caption/description
//   [no-percent] [no-value] [solid-fill] [no-title] [no-auto-color] [no-note]
//
// One value only — this type has no children/rows. Unit lives in the title
// (treemap rule §24C); values accept `_` separators but not thousands commas.

import type { PaletteColors } from '../palettes';
import { makeDgmoError, makeFail } from '../diagnostics';
import type { Writable } from '../utils/brand';
import {
  extractColor,
  measureIndent,
  parseFirstLine,
  tryParseSharedOption,
  fillModeFromOptions,
} from '../utils/parsing';
import type { GoalMode, GoalOptions, ParsedGoal } from './types';

/** Parse a numeric value token, honoring `_` separators. Rejects commas. */
function parseGoalNumber(token: string): number | null {
  if (token.includes(',')) return null;
  const n = parseFloat(token.replace(/_/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function parseGoal(
  content: string,
  palette?: PaletteColors
): ParsedGoal {
  const options: Writable<GoalOptions> = {
    noPercent: false,
    noValue: false,
    fillMode: undefined,
    noTitle: false,
    noAutoColor: false,
    noNote: false,
  };
  const result: Writable<ParsedGoal> = {
    type: 'goal',
    title: null,
    titleLineNumber: null,
    description: null,
    mode: 'bar',
    now: 0,
    target: 0,
    hasTarget: false,
    options,
    diagnostics: [],
    error: null,
  };

  const fail = makeFail(result);
  const warn = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };
  // Error-severity but NON-fatal: appended so consumers surface it, while the
  // renderer still draws a 0% shell (§3). Does NOT set result.error.
  const softError = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'error'));
  };

  if (!content?.trim()) return fail(0, 'No content provided');

  const lines = content.split('\n');
  let headerParsed = false;
  let sawNow = false;
  const sharedOpts: Record<string, string> = {};

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    // ── First line: `goal [Title]` ──
    if (!headerParsed) {
      const first = parseFirstLine(trimmed);
      if (first?.chartType !== 'goal') {
        return fail(lineNum, 'Expected "goal [Title]" as the first line.');
      }
      if (first.title) {
        const { label, color } = extractColor(
          first.title,
          palette,
          result.diagnostics,
          lineNum
        );
        result.title = label || null;
        if (color !== undefined) result.color = color;
      }
      result.titleLineNumber = lineNum;
      headerParsed = true;
      continue;
    }

    // ── `note` — free-text caption. Either inline (`note <text>`) or a block
    //    header followed by indented body lines (multi-line, simple markdown,
    //    `- ` list items). Body lines keep their newlines. ──
    const noteHeader = trimmed.match(/^note(?:\s+(.+))?$/i);
    if (noteHeader && measureIndent(raw) === 0) {
      const body: string[] = [];
      if (noteHeader[1]) body.push(noteHeader[1].trim());
      while (i + 1 < lines.length && measureIndent(lines[i + 1]!) > 0) {
        body.push(lines[i + 1]!.trim());
        i++;
      }
      result.description = body.length ? body.join('\n') : null;
      continue;
    }

    // Single-value type — other indented content is a parse warning (§3).
    if (measureIndent(raw) > 0) {
      warn(
        lineNum,
        `Indented content "${trimmed}" ignored — goal is a single value.`
      );
      continue;
    }

    const lower = trimmed.toLowerCase();

    // ── Bare-flag mode directives ──
    if (lower === 'thermometer' || lower === 'gauge') {
      result.mode = lower as GoalMode;
      continue;
    }

    // ── Bare-flag display toggles ──
    if (lower === 'no-percent') {
      options.noPercent = true;
      continue;
    }
    if (lower === 'no-value') {
      options.noValue = true;
      continue;
    }
    if (lower === 'no-auto-color') {
      options.noAutoColor = true;
      continue;
    }
    if (lower === 'no-note') {
      options.noNote = true;
      continue;
    }

    // ── Shared cross-cutting flags: fill family / no-title ──
    if (tryParseSharedOption(trimmed, sharedOpts)) {
      options.fillMode = fillModeFromOptions(sharedOpts);
      if (sharedOpts['no-title'] === 'on') options.noTitle = true;
      continue;
    }

    // ── `now <n>` / `target <n>` (space-separated key value) ──
    const kv = trimmed.match(/^(now|target)\s+(.+)$/i);
    if (kv) {
      const key = kv[1]!.toLowerCase();
      const value = parseGoalNumber(kv[2]!.trim());
      if (value === null) {
        softError(lineNum, `"${key}" needs a number (got "${kv[2]!.trim()}").`);
        continue;
      }
      if (key === 'now') {
        result.now = value;
        sawNow = true;
      } else {
        if (value <= 0) {
          softError(lineNum, '"target" must be greater than 0.');
        } else {
          result.target = value;
          result.hasTarget = true;
        }
      }
      continue;
    }

    warn(lineNum, `Unrecognized line "${trimmed}".`);
  }

  if (!sawNow) {
    warn(result.titleLineNumber ?? 1, 'Missing "now" value — treating as 0.');
  }
  if (!result.hasTarget) {
    softError(
      result.titleLineNumber ?? 1,
      'Missing or invalid "target" — a goal needs a target > 0.'
    );
  }

  return result;
}

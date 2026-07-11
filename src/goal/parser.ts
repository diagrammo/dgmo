// ============================================================
// Goal chart — Parser
// ============================================================
//
// Syntax:
//   goal <Title with unit>          // trailing color token ok (§1.5)
//   [thermometer | gauge]           // bare-flag mode (omit = progress bar)
//   now <number>                    // space-separated key value (no colon)
//   target <number>
//   [no-percent] [no-value] [solid-fill] [no-title]
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
    solidFill: false,
    noTitle: false,
  };
  const result: Writable<ParsedGoal> = {
    type: 'goal',
    title: null,
    titleLineNumber: null,
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

    // Single-value type — indented content is a parse warning (§3).
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

    // ── Shared cross-cutting flags: solid-fill / no-title ──
    if (tryParseSharedOption(trimmed, sharedOpts)) {
      if (sharedOpts['solid-fill'] === 'on') options.solidFill = true;
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

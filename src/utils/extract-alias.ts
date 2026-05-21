// ============================================================
// Universal Alias Extraction (`Name as <alias>` postfix)
// ============================================================
//
// One shared utility called from every parser at name-slot
// boundaries. Pure function — no parser context, no I/O.
//
// Derived from venn's prior-art pattern at `d3.ts:957`:
//   /^([^(:]+?)(?:\(([^)]+)\))?(?:\s+alias\s+(\S+))?\s*$/i
// generalized to a postfix-only `\s+as\s+` form that runs after
// the caller has stripped pipe metadata. Color/type modifiers
// are NOT stripped by this helper — the caller's existing
// per-chart-type logic continues to peel those off the returned
// `canonical` string.
//
// See `_bmad-output/implementation-artifacts/tech-spec-universal-alias-syntax.md`.

import type { DgmoError } from '../diagnostics.js';
import {
  ALIAS_DIAGNOSTIC_CODES,
  aliasInvalidFormatMessage,
  aliasReservedKeywordMessage,
  makeDgmoError,
} from '../diagnostics.js';
import { CHART_TYPES } from '../editor/keywords.js';

/** Alias character set: letter start, letters/digits/underscore, length 1–12. */
export const ALIAS_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_]{0,11}$/;

/**
 * Reserved tokens that cannot be used as aliases. Combines actual
 * DGMO grammar keywords with all chart-type tokens (per F5).
 *
 * Articles (`a`, `an`, `the`) are intentionally NOT reserved — the
 * spec's worked examples use `Alice is an actor as a`, where `a`
 * is a perfectly fine single-letter alias. Reserving English
 * articles would break the canonical example pattern.
 */
const CORE_RESERVED = ['as', 'is', 'tag', 'alias', 'aka'];

const RESERVED_ALIAS_TOKENS: ReadonlySet<string> = new Set<string>([
  ...CORE_RESERVED,
  ...CHART_TYPES,
]);

export function isReservedAliasToken(token: string): boolean {
  return RESERVED_ALIAS_TOKENS.has(token);
}

/**
 * Match the postfix-alias shape on a (presumed pipe-stripped) line.
 *
 * The lazy `.+?` capture deliberately leaves SaaS-style names
 * (`Storage as a Service`) alone — there is no position where the
 * trailing `\S+` can also be the line-final token, so the regex
 * fails to match and the line is treated as a single canonical.
 *
 * Optional pipe-tolerance is included so that callers which forgot
 * to pipe-strip first still get a stable parse.
 */
const ALIAS_POSTFIX_RE = /^(.+?)\s+as\s+(\S+)\s*(?:\|.*)?$/;

export interface ExtractAliasResult {
  /** The name portion with surrounding whitespace trimmed. */
  canonical: string;
  /** The alias token if one was successfully extracted. */
  alias?: string;
}

export interface ExtractAliasOptions {
  /** 1-based line number for diagnostic emission. Required if `diagnostics` is provided. */
  lineNumber?: number;
  /** Diagnostic sink. Push-only — never read. */
  diagnostics?: DgmoError[];
}

/**
 * Extract `{canonical, alias?}` from a line.
 *
 * Contract (locked — A3 in the tech-spec):
 * - Never throws. Never returns null/undefined.
 * - No alias matched → `{canonical: <full input, trimmed>, alias: undefined}`.
 * - Valid alias → `{canonical: <prefix, trimmed>, alias: <token>}`.
 * - `as` matched but the token is malformed (digit-start, hyphen,
 *   too long, etc.) → emits `E_ALIAS_INVALID_FORMAT` and falls back
 *   to `{canonical: <full input, trimmed>, alias: undefined}`.
 * - `as` matched but the token is reserved (`as`, `is`, chart-type
 *   tokens, etc.) → emits `E_ALIAS_RESERVED_KEYWORD` and falls back
 *   to `{canonical: <full input, trimmed>, alias: undefined}`.
 *
 * Per the C1 precedence rule, `E_ALIAS_RESERVED_KEYWORD` outranks
 * `E_ALIAS_INVALID_FORMAT` when both could fire — reserved is
 * checked AFTER format because a reserved token (e.g. `as`) does
 * pass the format regex.
 */
export function extractAlias(
  line: string,
  options?: ExtractAliasOptions
): ExtractAliasResult {
  const trimmed = line.trim();
  const match = trimmed.match(ALIAS_POSTFIX_RE);
  if (!match) return { canonical: trimmed };

  // ALIAS_POSTFIX_RE has 2 capture groups; both always exist when matched.
  const candidate = match[2]!;
  const isFormatValid = ALIAS_TOKEN_RE.test(candidate);
  const isReserved = isFormatValid && RESERVED_ALIAS_TOKENS.has(candidate);

  if (isReserved) {
    if (options?.diagnostics && options.lineNumber !== undefined) {
      options.diagnostics.push(
        makeDgmoError(
          options.lineNumber,
          aliasReservedKeywordMessage(candidate),
          'error',
          ALIAS_DIAGNOSTIC_CODES.ALIAS_RESERVED_KEYWORD
        )
      );
    }
    return { canonical: trimmed };
  }

  if (!isFormatValid) {
    if (options?.diagnostics && options.lineNumber !== undefined) {
      options.diagnostics.push(
        makeDgmoError(
          options.lineNumber,
          aliasInvalidFormatMessage(candidate),
          'error',
          ALIAS_DIAGNOSTIC_CODES.ALIAS_INVALID_FORMAT
        )
      );
    }
    return { canonical: trimmed };
  }

  return { canonical: match[1]!.trim(), alias: candidate };
}

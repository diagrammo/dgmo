// ============================================================
// Per-parser alias-binding helper (TD-18)
// ============================================================
//
// Wraps `extractAlias` + `bindAlias` so each parser can call a
// single function at name-slot boundaries. Centralizes diagnostic
// emission for the conflict shapes so wording stays consistent.
//
// Flow:
//   1. Caller passes the name-slot text (already pipe-stripped).
//   2. We run `extractAlias` to peel off any `as <alias>` postfix.
//   3. If an alias was extracted, we resolve the canonical against
//      the existing name store and bind the alias.
//   4. Diagnostics for collision / rebinding / shadows-name /
//      alias-of-alias / alias-after-canonical are pushed to the
//      caller-supplied sink.
//   5. Returns the canonical text the caller should use for its
//      existing logic. (No alias → input untouched.)
//
// Per the C8 contract, the caller's `nameAliasMap` is per-parse —
// fresh for every reparse. This helper does NOT persist anything.

import type { DgmoError } from '../diagnostics.js';
import {
  ALIAS_DIAGNOSTIC_CODES,
  aliasAfterCanonicalMessage,
  aliasCollisionMessage,
  aliasOfAliasMessage,
  aliasRebindingMessage,
  aliasShadowsNameMessage,
  makeDgmoError,
} from '../diagnostics.js';
import { extractAlias } from './extract-alias.js';
import {
  bindAlias,
  getOrCreateName,
  isAliasLiteral,
  type AliasMap,
  type NameEntry,
} from './name-normalize.js';

export interface ProcessNameSlotInput {
  /** Raw name-slot text. Caller has already stripped pipe metadata. */
  text: string;
  /** 1-based line number for diagnostics. */
  lineNumber: number;
  /** Parser-local name-store (UNH canonical entries). */
  nameStore: Map<string, NameEntry>;
  /** Parser-local alias-map. Per-parse, never persisted. */
  nameAliasMap: AliasMap;
  /** Diagnostic sink; diagnostics push here. */
  diagnostics: DgmoError[];
  /**
   * If `false` (default), an alias declaration is permitted on
   * this slot. Set to `true` for slots that are pure references
   * (e.g. flowchart arrow targets where no `as` declaration is
   * allowed) so a stray `as` token is flagged via the
   * `extract-alias` diagnostic path.
   */
  referenceOnly?: boolean;
}

export interface ProcessNameSlotResult {
  /** Canonical text the caller should use in its existing logic. */
  canonical: string;
  /** Set if an alias was extracted (whether or not it bound cleanly). */
  alias?: string;
  /**
   * The bound canonical entry, when (a) the slot resolved to an
   * existing alias, or (b) a fresh declaration successfully bound
   * a new alias. `undefined` means caller's normal entity-creation
   * logic should run.
   */
  entry?: NameEntry;
}

/**
 * Process a name-slot string. Returns the canonical form for the
 * caller to feed into existing parser logic.
 */
export function processNameSlot(
  input: ProcessNameSlotInput
): ProcessNameSlotResult {
  const { text, lineNumber, nameStore, nameAliasMap, diagnostics } = input;

  const trimmed = text.trim();
  if (!trimmed) return { canonical: trimmed };

  // 1. Reference short-circuit: the slot text is exactly an
  //    already-declared alias. Return its canonical entry.
  const aliasHit = nameAliasMap.get(trimmed);
  if (aliasHit !== undefined) {
    return { canonical: aliasHit.displayLabel, entry: aliasHit };
  }

  // 2. Run extract-alias to peel off any `as <alias>` postfix.
  const { canonical, alias } = extractAlias(trimmed, {
    lineNumber,
    diagnostics,
  });

  if (alias === undefined) {
    return { canonical };
  }

  // 3. Alias-of-alias pre-flight: the canonical-side literal is
  //    itself an alias. Emit and fall through (use the resolved
  //    underlying entry to avoid cascading errors).
  if (isAliasLiteral(canonical, nameAliasMap)) {
    const underlying = nameAliasMap.get(canonical.trim())!;
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        aliasOfAliasMessage({
          token: canonical.trim(),
          canonical: underlying.displayLabel,
        }),
        'error',
        ALIAS_DIAGNOSTIC_CODES.ALIAS_OF_ALIAS
      )
    );
    return { canonical: underlying.displayLabel, alias, entry: underlying };
  }

  // 4. Resolve / create the canonical entry. If the canonical was
  //    already declared on an earlier line WITHOUT being aliased,
  //    that's `E_ALIAS_AFTER_CANONICAL`.
  const lookup = getOrCreateName(canonical, nameStore, lineNumber);
  if (!lookup.created) {
    // Existing entry: was it declared previously with no alias bound?
    let alreadyAliased = false;
    for (const boundEntry of nameAliasMap.values()) {
      if (boundEntry === lookup.entry) {
        alreadyAliased = true;
        break;
      }
    }
    if (!alreadyAliased && lookup.entry.declaredLine < lineNumber) {
      diagnostics.push(
        makeDgmoError(
          lineNumber,
          aliasAfterCanonicalMessage({
            canonical: lookup.entry.displayLabel,
            existingLine: lookup.entry.declaredLine,
          }),
          'error',
          ALIAS_DIAGNOSTIC_CODES.ALIAS_AFTER_CANONICAL
        )
      );
      // Continue with the binding so downstream code still resolves.
    }
  }

  // 5. Bind. Conflicts produce a structured rejection — emit the
  //    appropriate diagnostic and return the canonical fragment
  //    unchanged so the caller's logic still works.
  const result = bindAlias(alias, lookup.entry, nameAliasMap, nameStore);
  if (result.conflict) {
    if (result.conflict.kind === 'collision') {
      diagnostics.push(
        makeDgmoError(
          lineNumber,
          aliasCollisionMessage({
            token: alias,
            existingCanonical: result.conflict.existingEntry.displayLabel,
            existingLine: result.conflict.existingEntry.declaredLine,
            incomingCanonical: lookup.entry.displayLabel,
          }),
          'error',
          ALIAS_DIAGNOSTIC_CODES.ALIAS_COLLISION
        )
      );
    } else if (result.conflict.kind === 'rebinding') {
      diagnostics.push(
        makeDgmoError(
          lineNumber,
          aliasRebindingMessage({
            canonical: lookup.entry.displayLabel,
            existingAlias: result.conflict.existingAlias,
            existingLine: lookup.entry.declaredLine,
            incomingAlias: alias,
          }),
          'error',
          ALIAS_DIAGNOSTIC_CODES.ALIAS_REBINDING
        )
      );
    } else if (result.conflict.kind === 'shadows-name') {
      diagnostics.push(
        makeDgmoError(
          lineNumber,
          aliasShadowsNameMessage(alias),
          'error',
          ALIAS_DIAGNOSTIC_CODES.ALIAS_SHADOWS_NAME
        )
      );
    }
  }

  return { canonical: lookup.entry.displayLabel, alias, entry: lookup.entry };
}

/**
 * Resolve a reference-only slot. Looks up an alias literal first,
 * falls back to the canonical name store. If neither matches, the
 * input is returned unchanged so the caller's existing
 * entity-creation logic runs.
 *
 * Use for slots that should NOT contain `as <alias>` declarations
 * — e.g. flowchart arrow targets where the syntax is already
 * established.
 */
export function resolveNameReference(
  text: string,
  nameAliasMap: AliasMap
): string {
  const trimmed = text.trim();
  const hit = nameAliasMap.get(trimmed);
  return hit !== undefined ? hit.displayLabel : trimmed;
}

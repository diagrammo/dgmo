// ============================================================
// Alias integrity — the TD-18 `as <alias>` rules, in one place
// ============================================================
//
// Spec §2A.2 locks eight rules on `Name as <alias>`. None of them was
// enforced anywhere in the library until this module: an alias collision,
// an out-of-order reference, an alias-of-alias and an over-length alias all
// parsed without a single diagnostic, and a MALFORMED alias additionally
// failed the `as` peel silently — `Alice as thirteencharss` produced a
// participant literally named "Alice as thirteencharss". That last one is
// the dropped-parse class: it does not merely lose an error, it changes
// what the diagram means.
//
// The rules split by what they need to know, and the split is why the
// wiring is in two places rather than one:
//
//   SYNTAX (this token alone)   — invalid format, reserved keyword.
//     Decidable where the alias is peeled, so they live in the shared peel
//     (`splitNameAndMeta`) and in the handful of parsers that peel with
//     their own regex. Every chart type gets them.
//
//   NAMESPACE (the whole source) — collision, rebinding, shadows-name,
//     alias-of-alias, before-decl, after-canonical.
//     They need every declaration, every canonical, and the line each sat
//     on, so a parser that owns an alias namespace keeps an `AliasRegistry`
//     for the parse and flushes it at the end.
//
// Ordering note: the namespace rules are decided in `finish()`, not as the
// declarations arrive. `shadows-name` and `after-canonical` both compare an
// alias against canonicals that may be declared LATER in the source, so an
// answer given at declaration time would depend on how far the parse had
// got.

import { emit, type DgmoError } from '../diagnostics';
import {
  ALIAS_BEFORE_DECL_DX,
  ALIAS_COLLISION_DX,
  ALIAS_INVALID_FORMAT_DX,
  ALIAS_OF_ALIAS_DX,
  ALIAS_REBINDING_DX,
  ALIAS_RESERVED_KEYWORD_DX,
  ALIAS_SHADOWS_NAME_DX,
  ALIAS_AFTER_CANONICAL_DX,
} from '../alias-diagnostics';
import { CHART_TYPE_IDS } from '../chart-types';

/**
 * The alias token shape (spec §2A.2): letter start, then letters, digits or
 * underscore, 1–12 characters. Case-sensitive — `pm` and `PM` are distinct.
 */
export const ALIAS_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_]{0,11}$/;

/**
 * A trailing `as <something>` on a name region, where `<something>` is a
 * single token that reaches end-of-string. Deliberately looser than
 * {@link ALIAS_TOKEN_RE} so a malformed attempt can be REPORTED rather than
 * silently folded into the name.
 *
 * It still requires the token to be line-final, which is what keeps SaaS
 * naming safe: `Storage as a Service` has a space after `a`, so nothing
 * matches and the name is untouched (spec §2A.2).
 */
const ALIAS_ATTEMPT_RE = /\s+as\s+(\S+)\s*$/;

/**
 * Tokens that cannot be an alias: DGMO grammar keywords plus every chart
 * type id.
 *
 * 🔴 English articles are NOT reserved — `Alice as a` is valid, and the
 * language spec says so explicitly (§2A.2). The universal-alias tech spec
 * disagrees, listing `a`, `an` and `the` as reserved; the spec is the
 * canonical reference and wins. Reserving them would break the very
 * example the enforcement issue (#200) was filed with.
 */
export const RESERVED_ALIAS_TOKENS: ReadonlySet<string> = new Set([
  'as',
  'is',
  'tag',
  'alias',
  'aka',
  ...CHART_TYPE_IDS,
]);

/**
 * Check an alias token that has already been peeled, plus the name region it
 * was peeled from, and return whatever syntax diagnostics apply.
 *
 * Call it with the name region BEFORE the peel: when the peel failed because
 * the token is malformed, `alias` is undefined and the malformed attempt is
 * still visible in `nameRegion`.
 */
export function checkAliasSyntax(
  nameRegion: string,
  alias: string | undefined,
  line: number
): DgmoError[] {
  if (alias !== undefined) {
    return RESERVED_ALIAS_TOKENS.has(alias)
      ? [emit(ALIAS_RESERVED_KEYWORD_DX, line, { alias })]
      : [];
  }
  const attempt = ALIAS_ATTEMPT_RE.exec(nameRegion);
  if (!attempt) return [];
  const token = attempt[1]!;
  // A token that passes the shape but was not peeled is not an alias attempt
  // gone wrong — the caller peels aliases off elsewhere, or not at all.
  if (ALIAS_TOKEN_RE.test(token)) return [];
  return [emit(ALIAS_INVALID_FORMAT_DX, line, { alias: token })];
}

/**
 * Fold a canonical name for comparison. Canonicals are UNH-normalized (§2A.4:
 * `Alice` ≡ `alice` ≡ `ALICE`), so a shadow or a first-use is the same name
 * whatever its casing. Aliases themselves stay case-sensitive as tokens — this
 * fold is only ever applied when comparing an alias literal against a NAME.
 */
function foldName(name: string): string {
  return name.trim().toLowerCase();
}

interface Declaration {
  readonly alias: string;
  readonly canonical: string;
  readonly line: number;
}

interface Reference {
  readonly token: string;
  readonly line: number;
}

/**
 * One parse's alias namespace — flat and global to the source, per spec
 * §2A.2 ("one alias literal has exactly one binding per source").
 *
 * A parser creates one, records what it sees, and concatenates
 * {@link AliasRegistry.finish} onto its diagnostics at the end:
 *
 * ```ts
 * const aliases = new AliasRegistry();
 * // …at a declaration: `Alice as a`
 * aliases.declare('a', 'Alice', lineNumber);
 * // …wherever a name is read as a name
 * aliases.noteCanonical('Alice', lineNumber);
 * // …at a reference site, in place of `map.get(token) ?? token`
 * const canonical = aliases.resolve(token, lineNumber) ?? token;
 * // …once the whole source has been read
 * result.diagnostics.push(...aliases.finish());
 * ```
 *
 * `resolve` doubles as the reference recorder, so a parser that swaps its
 * `Map<string, string>` lookup for it gets the ordering rule for free
 * rather than needing a second call at every reference site.
 */
export class AliasRegistry {
  private readonly declarations: Declaration[] = [];
  private readonly references: Reference[] = [];
  /** Folded canonical name → the first line it was seen on as a canonical. */
  private readonly canonicals = new Map<string, number>();
  private readonly bindings = new Map<string, string>();

  /**
   * The line the parser is currently reading. Several parsers resolve
   * references inside a closure that has no line in scope — `resolveNameRef`,
   * `resolveAliasName`, `resolveSlot` — and threading one through every call
   * site would be a far larger edit than the rule is worth. A parser sets this
   * once per line in its main loop instead.
   *
   * A resolution that happens in a POST-pass therefore attributes its
   * references to the last line read. That direction is deliberate: it can
   * only make the strict-ordering rule miss an out-of-order reference, never
   * invent one, because a reference dated after every declaration is in order
   * by definition.
   */
  private currentLine = 0;

  /** Tell the registry which line is being read (see {@link currentLine}). */
  at(line: number): void {
    this.currentLine = line;
  }

  /** Record `<canonical> as <alias>` at `line`. */
  declare(
    alias: string,
    canonical: string,
    line: number = this.currentLine
  ): void {
    this.declarations.push({ alias, canonical, line });
    if (!this.bindings.has(alias)) this.bindings.set(alias, canonical);
  }

  /** Record that `name` appeared as a canonical name (not as an alias). */
  noteCanonical(name: string, line: number = this.currentLine): void {
    const key = foldName(name);
    if (key === '') return;
    if (!this.canonicals.has(key)) this.canonicals.set(key, line);
  }

  /**
   * Resolve a token that may be an alias, recording the reference so the
   * ordering rule can be decided later. Returns `undefined` when the token
   * is not a declared alias, so callers keep their existing fallback.
   */
  resolve(token: string, line: number = this.currentLine): string | undefined {
    const key = token.trim();
    // Recorded whether or not it resolves TODAY: an out-of-order reference is
    // by definition one the parser could not resolve when it read it, so
    // recording only the hits would make the strict-ordering rule unfireable
    // — the exact rule this records for.
    if (key !== '') this.references.push({ token: key, line });
    return this.bindings.get(key);
  }

  /** True when `token` is bound in this parse — a lookup with no reference recorded. */
  has(token: string): boolean {
    return this.bindings.has(token.trim());
  }

  /**
   * The canonical bound to `token`, WITHOUT recording a reference. For code
   * asking a question about the namespace ("is this label the thing that
   * alias points at?") rather than reading a name — recording those would
   * date references to lines that never referred to anything.
   */
  lookup(token: string): string | undefined {
    return this.bindings.get(token.trim());
  }

  /**
   * Decide the six namespace rules over everything recorded, in source
   * order. Safe to call once; a parser calls it as it returns.
   */
  finish(): DgmoError[] {
    const out: DgmoError[] = [];
    /** alias → the declaration that owns it */
    const owner = new Map<string, Declaration>();
    /** folded canonicals that are themselves a declared alias (`a as b`) */
    const aliasedAsCanonical = new Set<string>();
    /**
     * Declarations already named by a more specific rule. A second alias for
     * one name is a rebinding, and saying "and the name was used earlier" of
     * the same line adds nothing but noise — most specific wins.
     */
    const reported = new Set<Declaration>();
    /** canonical → the declaration that first aliased it */
    const aliasedCanonical = new Map<string, Declaration>();

    for (const decl of this.declarations) {
      const { alias, canonical, line } = decl;

      const previous = owner.get(alias);
      if (previous) {
        reported.add(decl);
        // Same alias twice: a different canonical is a collision, the same
        // canonical again is a rebinding of a binding that already held.
        out.push(
          emit(
            previous.canonical === canonical
              ? ALIAS_REBINDING_DX
              : ALIAS_COLLISION_DX,
            line,
            {
              alias,
              canonical,
              previousCanonical: previous.canonical,
              previousLine: previous.line,
            }
          )
        );
        continue;
      }
      owner.set(alias, decl);

      // `pm as p` where `pm` is itself an alias — alias the canonical instead.
      //
      // A declaration is never an alias OF ITSELF: several parsers bind the
      // alias to a slug of the canonical (`CDN as cdn` binds `cdn` → node id
      // `cdn`), which reads as "the canonical is a declared alias" unless the
      // declaration under test is excluded. That shape is the ordinary way to
      // alias a name, and flagging it fired on real diagrams.
      const aliasedTarget = owner.get(canonical);
      if (
        aliasedTarget &&
        aliasedTarget !== decl &&
        aliasedTarget.alias === canonical
      ) {
        aliasedAsCanonical.add(foldName(canonical));
        out.push(
          emit(ALIAS_OF_ALIAS_DX, line, {
            alias,
            canonical,
            target: aliasedTarget.canonical,
          })
        );
      }

      // The same canonical cannot carry two aliases — the namespace is flat
      // in both directions.
      const already = aliasedCanonical.get(canonical);
      if (already) {
        reported.add(decl);
        out.push(
          emit(ALIAS_REBINDING_DX, line, {
            alias,
            canonical,
            previousAlias: already.alias,
            previousLine: already.line,
          })
        );
      } else {
        aliasedCanonical.set(canonical, decl);
      }
    }

    for (const decl of owner.values()) {
      // An alias that is also somebody's canonical name reads as two things
      // at every later use, and which one wins is an implementation detail.
      //
      // An alias-of-alias line is exempt: `a as b` makes the parser read `a`
      // as a name, so `a` lands in the canonical index as an artifact of the
      // very mistake already reported as E_ALIAS_OF_ALIAS. Reporting the
      // shadow too would name the same line twice for one defect.
      //
      // An alias equal to its OWN canonical is not a shadow either: parsers
      // that bind to a slug produce exactly that for the ordinary declaration
      // `CDN as cdn`, whose node id is `cdn`. A shadow is an alias colliding
      // with SOMEBODY ELSE's name.
      const selfBound = foldName(decl.alias) === foldName(decl.canonical);
      const shadowed = selfBound
        ? undefined
        : this.canonicals.get(foldName(decl.alias));
      if (
        shadowed !== undefined &&
        !aliasedAsCanonical.has(foldName(decl.alias))
      ) {
        out.push(
          emit(ALIAS_SHADOWS_NAME_DX, decl.line, {
            alias: decl.alias,
            nameLine: shadowed,
          })
        );
      }

      // Declared below a line that already used the canonical: every earlier
      // line was parsed against a namespace this alias was not in yet.
      const firstUse = this.canonicals.get(foldName(decl.canonical));
      if (
        firstUse !== undefined &&
        firstUse < decl.line &&
        !reported.has(decl)
      ) {
        out.push(
          emit(ALIAS_AFTER_CANONICAL_DX, decl.line, {
            canonical: decl.canonical,
            firstLine: firstUse,
          })
        );
      }
    }

    // Strict ordering: an alias must be declared on or before its first use.
    for (const ref of this.references) {
      const decl = owner.get(ref.token);
      if (decl && ref.line < decl.line) {
        out.push(
          emit(ALIAS_BEFORE_DECL_DX, ref.line, {
            alias: ref.token,
            canonical: decl.canonical,
            declLine: decl.line,
          })
        );
      }
    }

    return out.sort((a, b) => a.line - b.line);
  }
}

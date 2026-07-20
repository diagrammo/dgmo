/**
 * §1.11 Emphasis family — `highlight <Name>…` / `dim <Name>…`.
 *
 * The one appearance axis that creates contrast *within* a chart. The `fill-*`
 * family (§1.9) is chart-wide by construction, so it can state a treatment but
 * never a hierarchy; color states *identity*, not weight. Emphasis is the third
 * axis: which elements are figure and which are ground.
 *
 * Two duals, mutually exclusive (last-one-wins, per the `fill-*` precedent):
 *   `highlight A B` — A and B are figure; EVERYTHING ELSE recedes.
 *   `dim A B`       — A and B recede; everything else is untouched.
 *
 * Both are chart-level directives, never per-element trailing tokens: the
 * trailing bare-token slot already belongs to color (§1.5), and a second
 * trailing token would need ordered peeling plus a fresh label-collision
 * hazard. Keeping emphasis at chart level also means it survives edits to the
 * data rows and has exactly one home on chart types (sankey, chord) where an
 * element is named by many lines rather than declared on one.
 *
 * Rendering contract: a resolved-dim is a BAKED opacity multiplier on the
 * element's existing paint — never a color substitution. Hue is preserved, so
 * `dim` composes with a brand color instead of competing with it, and the
 * output is a static attribute that survives PNG/SVG export with no
 * interactivity dependency (contrast with event-line's runtime legend muting).
 */

/**
 * Opacity applied to receded elements. Matches the `family` chart's shipped
 * `DIM_OPACITY` (`src/family/renderer.ts`), which this family generalizes —
 * one number so a dimmed sankey flow and a dimmed bloodline read alike.
 */
export const EMPHASIS_DIM_OPACITY = 0.28;

/**
 * Opacity for receded *text*. Deliberately higher than the shape constant: the
 * requirement is "recede without removing", and a label at 0.28 against the
 * page is effectively deleted. Shapes carry the weight hierarchy; labels only
 * need to stop competing, so they get a legibility floor.
 */
export const EMPHASIS_DIM_TEXT_OPACITY = 0.5;

/** A parsed emphasis directive: which dual, and the names it lists. */
export interface EmphasisDirective {
  readonly kind: 'highlight' | 'dim';
  readonly names: readonly string[];
  /**
   * True when the author used no comma, so `names` is a *guess* — `dim Ship
   * Provisions` is one two-word element far more often than two one-word ones.
   * Resolution tries the whole phrase first and only falls back to these
   * tokens, which means a comma is never required for the common single-name
   * case but always disambiguates when an author wants several.
   */
  readonly ambiguous: boolean;
  /** The directive's argument text, verbatim — the whole-phrase candidate. */
  readonly raw: string;
  readonly lineNumber: number;
}

/** The directive tokens, exported so parsers can build escape hatches. */
export const EMPHASIS_TOKENS = Object.freeze(['highlight', 'dim'] as const);

/**
 * True iff `token` leads an emphasis directive. Parsers whose bare-label branch
 * runs BEFORE their option branch (sankey, chord) must consult this so
 * `dim Losses` isn't swallowed as a phantom node — the same escape hatch
 * `layout arc|chord` already needs.
 */
export function isEmphasisToken(token: string): boolean {
  return (EMPHASIS_TOKENS as readonly string[]).includes(token.toLowerCase());
}

/**
 * Parses `highlight A, B` / `dim Ship Provisions`.
 *
 * Comma is the list separator and is authoritative when present. Without a
 * comma the argument is treated as ONE name (resolution falls back to
 * whitespace tokens if that phrase matches nothing), because element names in
 * this language routinely contain spaces and demanding punctuation for the
 * single-name case would make the common gesture the awkward one.
 *
 * Returns null when the line isn't an emphasis directive.
 */
export function parseEmphasisDirective(
  line: string,
  lineNumber: number
): EmphasisDirective | null {
  const m = line.trim().match(/^(highlight|dim)\s+(.+)$/i);
  if (!m) return null;
  const kind = m[1]!.toLowerCase() as 'highlight' | 'dim';
  const raw = m[2]!.trim();
  if (!raw) return null;

  const hasComma = raw.includes(',');
  const names = (hasComma ? raw.split(',') : [raw])
    .map((n) => n.trim())
    .filter(Boolean);
  if (names.length === 0) return null;
  return { kind, names, ambiguous: !hasComma, raw, lineNumber };
}

/** Outcome of matching a directive's names against a chart's real elements. */
export interface ResolvedEmphasis {
  /** Names that should render receded. Empty ⇒ nothing dims. */
  readonly dimmed: ReadonlySet<string>;
  /** Listed names matching no element — callers emit a warning per name. */
  readonly unknown: readonly string[];
}

const EMPTY: ResolvedEmphasis = { dimmed: new Set(), unknown: [] };

/**
 * Resolves a directive against the chart's actual element names.
 *
 * Matching is case-insensitive and whitespace-normalized so `dim ship
 * provisions` finds "Ship Provisions" — emphasis names an element the author
 * already typed elsewhere, so it should not demand an exact retype.
 *
 * A `highlight` whose names ALL miss resolves to nothing dimmed rather than
 * dimming the entire chart: the failure mode of a typo must be "no emphasis",
 * never "everything vanishes". This mirrors `family`'s shipped ruling that an
 * unknown `highlight` warns and dims nobody.
 */
export function resolveEmphasis(
  directive: EmphasisDirective | undefined,
  elementNames: Iterable<string>,
  /**
   * Optional closure applied to a `highlight` hit set BEFORE the complement is
   * taken — the chart type's notion of "what else belongs to this story".
   *
   * This is what makes `highlight` a real generalization of the `family`
   * chart's shipped behavior rather than a namesake: family lights a bloodline
   * (focus + ancestors + descendants), and the sankey analogue is the upstream
   * + downstream flow closure. Without it, highlighting one node dims that
   * node's own inflows, which is never what an author means.
   *
   * Deliberately NOT applied to `dim`: `dim Losses` must recede exactly the
   * losses, not everything that feeds them (which is usually the whole chart).
   * The duals are asymmetric because their intents are — `highlight` names a
   * story, `dim` names a specific thing to push back.
   */
  expandHighlight?: (hits: ReadonlySet<string>) => Iterable<string>
): ResolvedEmphasis {
  if (!directive) return EMPTY;

  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const byNorm = new Map<string, string>();
  for (const name of elementNames) byNorm.set(norm(name), name);

  const match = (listed: readonly string[]) => {
    const hit = new Set<string>();
    const unknown: string[] = [];
    for (const name of listed) {
      const found = byNorm.get(norm(name));
      if (found === undefined) unknown.push(name);
      else hit.add(found);
    }
    return { hit, unknown };
  };

  let { hit, unknown } = match(directive.names);

  // No comma was written: the whole argument was tried as one name. If that
  // missed entirely, re-read it as a whitespace-separated list before giving up
  // — so `dim Spoilage Losses` still works without punctuation.
  if (directive.ambiguous && hit.size === 0) {
    const tokens = directive.raw.split(/\s+/).filter(Boolean);
    if (tokens.length > 1) {
      const retry = match(tokens);
      if (retry.hit.size > 0) ({ hit, unknown } = retry);
    }
  }

  // Every listed name missed — degrade to no-emphasis, not to all-dimmed.
  if (hit.size === 0) return { dimmed: new Set(), unknown };

  if (directive.kind === 'dim') return { dimmed: hit, unknown };

  const lit = expandHighlight ? new Set(expandHighlight(hit)) : hit;
  const dimmed = new Set<string>();
  for (const name of byNorm.values()) if (!lit.has(name)) dimmed.add(name);
  return { dimmed, unknown };
}

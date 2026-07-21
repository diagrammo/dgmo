// ============================================================
// Bracket chart — Parser
// ============================================================
//
// Syntax (verify against docs/dgmo-language-spec.md, not fixtures):
//   bracket <Title>                    // first line — no colon (§1.1)
//   rounds Wild Card, Division, Championship   // column names, entry → inner
//   single-elim | double-elim | seeded // bare-flag directives (like treemap radial)
//   tag Ticketing as tk                // tag group (block/org idiom) — colors box OUTLINE
//     MLB Ballpark blue
//     Ticketmaster orange
//   [Side] [color]                     // bracket column (kanban idiom, §1.7)
//     seed 1 Blue Jays tk: MLB Ballpark  // seeded field + §1.4 competitor metadata
//     Yankees beats Guardians 2-1 @ Yankees  // WINNER left; optional `@ home`
//       Walk-off in the 11th — **Vlad Jr.**  // commentary: prose indented under match
//     Astros vs Rangers                // pending match — no winner yet
//   Blue Jays beats Brewers 4-3        // indent-0 (outside any side) = championship
//   Mariners tk: Ticketmaster          // casual roster line: tag a team (no beats/vs)
//
// Two modes: any `seed` line → SEEDED (day-0 skeleton). Otherwise CASUAL
// (structure inferred from results). Score is cosmetic — a score that
// contradicts the declared winner warns but never flips it.

import type { PaletteColors } from '../palettes';
import { makeDgmoError, makeFail } from '../diagnostics';
import type { Writable } from '../utils/brand';
import {
  extractColor,
  fillModeFromToken,
  measureIndent,
  parseFirstLine,
  splitNameAndMeta,
} from '../utils/parsing';
import { preprocessDescriptionLine } from '../utils/description-helpers';
import type { ReservedKeyRegistry } from '../utils/reserved-key-registry';
import type { TagGroup } from '../utils/tag-groups';
import {
  matchTagBlockHeading,
  stripDefaultModifier,
  finalizeAutoTagColors,
  resolveActiveTagGroup,
  AUTO_TAG_COLOR_SENTINEL,
  tagAttrKey,
} from '../utils/tag-groups';
import type {
  BracketMode,
  BracketSide,
  ParsedBracket,
  RawSeed,
  RoundDef,
} from './types';

/** ` beats ` / ` vs ` split — keyword surrounded by spaces so names may contain them. */
const BEATS_RE = /^(.+?)\s+beats\s+(.+)$/i;
const VS_RE = /^(.+?)\s+vs\s+(.+)$/i;
/** Trailing `\d+-\d+` (ASCII hyphen or en-dash) score annotation. */
const SCORE_RE = /\s+(\d+\s*[-–]\s*\d+)$/;
/** Trailing `@ Home` host marker. */
const HOME_RE = /\s+@\s+(.+)$/;
const SEED_RE = /^seed\s+(\d+)\s+(.+)$/i;

const MODE_FLAGS = new Set(['single-elim', 'double-elim', 'seeded']);

/** A mutable match under construction (commentary lines are appended later). */
interface MutMatch {
  p1: string;
  p2: string;
  decided: boolean;
  score: string | null;
  side: string | null;
  home: string | null;
  commentary: string[];
  lineNumber: number;
}

/** Split a decided match tail into `{left, right, score, home}`. */
function splitMatch(body: string): {
  left: string;
  right: string;
  score: string | null;
  home: string | null;
} | null {
  let rest = body;
  // Peel `@ home` first (rightmost), then the score, then split on `beats`.
  let home: string | null = null;
  const hm = rest.match(HOME_RE);
  if (hm) {
    home = hm[1]!.trim();
    rest = rest.slice(0, hm.index).trimEnd();
  }
  let score: string | null = null;
  const sm = rest.match(SCORE_RE);
  if (sm) {
    score = sm[1]!.replace(/\s+/g, '');
    rest = rest.slice(0, sm.index).trimEnd();
  }
  const m = rest.match(BEATS_RE);
  if (m) return { left: m[1]!.trim(), right: m[2]!.trim(), score, home };
  return null;
}

export function parseBracket(
  content: string,
  palette?: PaletteColors
): ParsedBracket {
  const result: Writable<ParsedBracket> = {
    type: 'bracket',
    title: null,
    titleLineNumber: null,
    mode: 'single-elim',
    seeded: false,
    roundNames: [],
    sides: [],
    matches: [],
    seeds: [],
    tagGroups: [],
    competitorMeta: new Map(),
    activeTag: null,
    noLegend: false,
    noRounds: false,
    diagnostics: [],
    error: null,
  };
  const matches: MutMatch[] = [];
  const seeds: RawSeed[] = [];
  const sides: BracketSide[] = [];
  const sideSeen = new Set<string>();
  const tagGroups: Writable<TagGroup>[] = [];
  const metaAliasMap = new Map<string, string>();
  const competitorMeta = new Map<string, Record<string, string>>();

  const fail = makeFail(result);
  const warn = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };
  const softError = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'error'));
  };

  if (!content?.trim()) return fail(0, 'No content provided');

  // §1.4 registry — bracket has no fixed reserved keys, only declared tag
  // aliases. Rebuilt per-call against the current alias set.
  const registry = (): ReservedKeyRegistry => ({
    keys: new Set<string>(),
    tagAliases: new Set(metaAliasMap.keys()),
  });
  /** Peel `Name k: v, k2: v2` → record the metadata against the competitor. */
  const takeMeta = (rest: string, lineNum: number): string => {
    const split = splitNameAndMeta(
      rest,
      registry(),
      metaAliasMap,
      palette,
      result.diagnostics,
      lineNum
    );
    if (Object.keys(split.meta).length > 0) {
      const prev = competitorMeta.get(split.name) ?? {};
      competitorMeta.set(split.name, { ...prev, ...split.meta });
    }
    return split.name;
  };

  const lines = content.split('\n');
  let headerParsed = false;
  /** True when the title line's trailing color set the winner accent (§1.5). */
  let accentFromTitle = false;
  let currentSide: string | null = null;
  let currentTagGroup: Writable<TagGroup> | null = null;
  let commentaryTarget: MutMatch | null = null;
  let commentaryIndent = 0;
  let inRoundsBlock = false;
  const roundDefs: RoundDef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) {
      currentTagGroup = null;
      commentaryTarget = null;
      inRoundsBlock = false;
      continue;
    }

    // ── First line: `bracket <Title>` ──
    if (!headerParsed) {
      const first = parseFirstLine(trimmed);
      if (first?.chartType !== 'bracket') {
        return fail(lineNum, 'Expected "bracket [Title]" as the first line.');
      }
      if (first.title) {
        // §1.5 title-line accent slot (decision #48): a trailing color token
        // sets the winner accent, mirroring goal/countdown. It WINS over the
        // legacy `accent <color>` directive.
        const { label, color } = extractColor(
          first.title,
          palette,
          result.diagnostics,
          lineNum
        );
        result.title = label || null;
        if (color !== undefined) {
          result.accentColor = color;
          accentFromTitle = true;
        }
      }
      result.titleLineNumber = lineNum;
      headerParsed = true;
      continue;
    }

    const indent = measureIndent(raw);

    // ── Commentary: prose indented deeper than its match line ──
    if (commentaryTarget && indent > commentaryIndent) {
      commentaryTarget.commentary.push(preprocessDescriptionLine(trimmed));
      continue;
    }
    commentaryTarget = null;

    // ── Indented `rounds` block entries: `Name [color]` ──
    if (inRoundsBlock) {
      if (indent > 0) {
        const { label, color } = extractColor(
          trimmed,
          palette,
          result.diagnostics,
          lineNum
        );
        if (label)
          roundDefs.push(
            color !== undefined ? { name: label, color } : { name: label }
          );
        continue;
      }
      inRoundsBlock = false;
    }

    // ── Tag group heading: `tag Ticketing as tk` ──
    const tagHead = matchTagBlockHeading(trimmed);
    if (tagHead) {
      currentTagGroup = {
        name: tagHead.name,
        ...(tagHead.alias !== undefined && { alias: tagHead.alias }),
        entries: [],
        lineNumber: lineNum,
      };
      if (tagHead.alias) {
        metaAliasMap.set(tagHead.alias.toLowerCase(), tagAttrKey(tagHead.name));
      }
      // The canonical name must map too, so `Ticketing: X` cuts even with no alias.
      metaAliasMap.set(tagAttrKey(tagHead.name), tagAttrKey(tagHead.name));
      tagGroups.push(currentTagGroup);
      continue;
    }
    // Indented `Value color` entries under the current tag group.
    if (currentTagGroup && indent > 0) {
      const { text: cleanEntry, isDefault } = stripDefaultModifier(trimmed);
      const { label, color } = extractColor(
        cleanEntry,
        palette,
        result.diagnostics,
        lineNum
      );
      if (isDefault || currentTagGroup.entries.length === 0) {
        currentTagGroup.defaultValue = label;
      }
      currentTagGroup.entries.push({
        value: label,
        color: color ?? AUTO_TAG_COLOR_SENTINEL,
        lineNumber: lineNum,
      });
      continue;
    }
    currentTagGroup = null;

    if (indent === 0) currentSide = null;
    const lower = trimmed.toLowerCase();

    // ── `rounds` — inline `rounds A, B, C`, or bare header of an indented,
    //     colorable block (`rounds` then indented `Name [color]` lines). ──
    const roundsM = trimmed.match(/^rounds\b(.*)$/i);
    if (roundsM) {
      const rest = roundsM[1]!.trim();
      if (rest) {
        for (const name of rest
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean))
          roundDefs.push({ name });
      } else {
        inRoundsBlock = true;
      }
      continue;
    }

    // ── bare-flag directives ──
    if (MODE_FLAGS.has(lower)) {
      if (lower === 'seeded') result.seeded = true;
      else result.mode = lower as BracketMode;
      continue;
    }
    if (lower === 'legend-inline') {
      result.legendInline = true;
      continue;
    }
    if (lower === 'no-legend') {
      result.noLegend = true;
      continue;
    }
    if (lower === 'no-round' || lower === 'no-rounds') {
      result.noRounds = true;
      continue;
    }
    // §1.9 fill family — mutually exclusive, last one wins (`fill-tint` is the
    // explicit spelling of the default, so it clears the mode back to tint).
    const fm = fillModeFromToken(lower);
    if (fm !== null) {
      if (fm === 'tint') delete result.fillMode;
      else result.fillMode = fm;
      continue;
    }

    // ── `accent <color>` — legacy alias for the title-line trailing color
    // (decision #48). Still parse-accepted; the title-line token wins. ──
    const accentM = trimmed.match(/^accent\s+(.+)$/i);
    if (accentM) {
      const { color } = extractColor(
        `x ${accentM[1]!.trim()}`,
        palette,
        result.diagnostics,
        lineNum
      );
      if (color !== undefined && !accentFromTitle) result.accentColor = color;
      continue;
    }

    // ── `[Side] [color]` header (kanban idiom) ──
    const sideM = trimmed.match(/^\[(.+?)\](.*)$/);
    if (sideM) {
      const label = sideM[1]!.trim();
      if (MODE_FLAGS.has(label.toLowerCase())) {
        const lk = label.toLowerCase();
        if (lk === 'seeded') result.seeded = true;
        else result.mode = lk as BracketMode;
        continue;
      }
      const { label: cleanLabel, color } = extractColor(
        sideM[2]!.trim() ? `${label} ${sideM[2]!.trim()}` : label,
        palette,
        result.diagnostics,
        lineNum
      );
      currentSide = cleanLabel;
      if (!sideSeen.has(cleanLabel)) {
        sideSeen.add(cleanLabel);
        sides.push(
          color !== undefined
            ? { label: cleanLabel, color }
            : { label: cleanLabel }
        );
      }
      continue;
    }

    const side = indent > 0 ? currentSide : null;

    // ── `seed N Name [k: v]` (seeded mode) ──
    const seedM = trimmed.match(SEED_RE);
    if (seedM) {
      const n = parseInt(seedM[1]!, 10);
      const name = takeMeta(seedM[2]!.trim(), lineNum);
      result.seeded = true;
      seeds.push({ seed: n, name, side, lineNumber: lineNum });
      continue;
    }

    // ── decided match: `X beats Y [score] [@ home]` ──
    const decided = splitMatch(trimmed);
    if (decided) {
      if (decided.left === decided.right) {
        softError(
          lineNum,
          `A match can't be "${decided.left}" against itself.`
        );
        continue;
      }
      if (decided.score) {
        const parts = decided.score.split(/[-–]/).map((x) => parseInt(x, 10));
        if (parts.length === 2 && parts[0]! < parts[1]!) {
          warn(
            lineNum,
            `Score ${decided.score} shows "${decided.left}" losing, but they're on the winning side — keeping "${decided.left}" as the winner.`
          );
        }
      }
      const match: MutMatch = {
        p1: decided.left,
        p2: decided.right,
        decided: true,
        score: decided.score,
        side,
        home: decided.home,
        commentary: [],
        lineNumber: lineNum,
      };
      matches.push(match);
      commentaryTarget = match;
      commentaryIndent = indent;
      continue;
    }

    // ── pending match: `A vs B [@ home]` ──
    let vsBody = trimmed;
    let vsHome: string | null = null;
    const vhm = vsBody.match(HOME_RE);
    if (vhm && VS_RE.test(vsBody.slice(0, vhm.index))) {
      vsHome = vhm[1]!.trim();
      vsBody = vsBody.slice(0, vhm.index).trimEnd();
    }
    const pending = vsBody.match(VS_RE);
    if (pending) {
      const a = pending[1]!.trim();
      const b = pending[2]!.trim();
      if (a === b) {
        softError(lineNum, `A match can't be "${a}" against itself.`);
        continue;
      }
      const match: MutMatch = {
        p1: a,
        p2: b,
        decided: false,
        score: null,
        side,
        home: vsHome,
        commentary: [],
        lineNumber: lineNum,
      };
      matches.push(match);
      commentaryTarget = match;
      commentaryIndent = indent;
      continue;
    }

    // ── casual roster line: `Name k: v` (tags a team, no beats/vs) ──
    const rosterSplit = splitNameAndMeta(
      trimmed,
      registry(),
      metaAliasMap,
      palette,
      result.diagnostics,
      lineNum
    );
    if (Object.keys(rosterSplit.meta).length > 0) {
      const prev = competitorMeta.get(rosterSplit.name) ?? {};
      competitorMeta.set(rosterSplit.name, { ...prev, ...rosterSplit.meta });
      continue;
    }

    warn(lineNum, `Unrecognized line "${trimmed}".`);
  }

  // Double-elim is reserved (§7) — parse it, warn, render the winners' side only.
  if (result.mode === 'double-elim') {
    warn(
      result.titleLineNumber ?? 1,
      'Double-elimination brackets are not yet supported — rendering the winners’ side only.'
    );
  }

  // Duplicate competitor names: a name declared as a seed more than once means
  // two distinct entrants collide (§2 idiom rules) — hard error with a hint.
  const seedNames = new Map<string, number>();
  for (const s of seeds) {
    const prev = seedNames.get(s.name);
    if (prev !== undefined) {
      softError(
        s.lineNumber,
        `Duplicate competitor "${s.name}" (already seeded on line ${prev}). Rename one — names are identifiers.`
      );
    } else {
      seedNames.set(s.name, s.lineNumber);
    }
  }

  finalizeAutoTagColors(tagGroups, palette);

  result.sides = sides;
  result.matches = matches;
  result.seeds = seeds;
  result.roundNames = roundDefs;
  result.tagGroups = tagGroups;
  result.competitorMeta = competitorMeta;
  // `no-legend` hides the legend only — tags still color the outlines.
  result.activeTag = resolveActiveTagGroup(tagGroups, undefined);

  if (!result.seeded && matches.length === 0) {
    warn(
      result.titleLineNumber ?? 1,
      'No matches — add "A beats B" or "A vs B" lines.'
    );
  }

  return result;
}

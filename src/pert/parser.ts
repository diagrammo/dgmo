// ============================================================
// PERT Parser — two-pass
// ============================================================
//
// Pass 1: scan source line-by-line, collect declarations, references,
//         groups. Indent-tracked state machine, no resolution.
// Pass 2: resolve aliases → canonical ids; classify groups (hammock vs
//         cluster); detect conflicts; emit diagnostics.
//
// See `_bmad-output/implementation-artifacts/tech-spec-pert.md`
// for the design rationale; AC1.* for the contract this parser meets.

import { emit, makeDgmoError, suggest } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import { PERT_DX } from './diagnostics';
import { parseDuration } from '../utils/duration';
import { parseDateToken, toInternal, type DateOrder } from '../utils/date';
import {
  extractColor,
  measureIndent,
  splitNameAndMeta,
  warnUnknownMetaKeys,
} from '../utils/parsing';
import { PERT_REGISTRY, withTagAliases } from '../utils/reserved-key-registry';
import { normalizeName } from '../utils/name-normalize';
import {
  injectDefaultTagMetadata,
  matchTagBlockHeading,
  stripDefaultModifier,
  validateTagGroupNames,
  validateTagValues,
  finalizeAutoTagColors,
  AUTO_TAG_COLOR_SENTINEL,
  type TagGroup,
  tagAttrKey,
} from '../utils/tag-groups';
import type { Writable } from '../utils/brand';
import type { Duration, DurationUnit } from '../gantt/types';
import type { PaletteColors } from '../palettes';
import type {
  EdgeType,
  ParsedPert,
  PertActivity,
  PertEdge,
  PertGroup,
  PertOptions,
  PertDirection,
  NodeDetail,
} from './types';
import { formatLocalISODate } from './internal';
import type {
  DurationEstimate,
  DeclarationSite,
  ReferenceSite,
} from './internal';
import type { DiagramSymbols } from '../completion-types';

// ============================================================
// Regexes / constants
// ============================================================

/** Bare directive lines accepted at the diagram level. */
const DIRECTIVE_KEYS = new Set([
  'time-unit',
  'default-confidence',
  'direction',
  'node-detail',
  'no-analysis',
  'trials',
  'seed',
  'scrubber-trials',
  'start-date',
  'end-date',
  'no-title',
  'solid-fill',
  'sprint-length',
  'sprint-number',
  'sprint-start',
  'active-tag',
  // Universal date directives (§ BL-121); effect captured in the prescan.
  'year',
  'date-order',
  'no-current-year',
]);

/**
 * Pipe-metadata keys that PERT consumes for non-tag purposes. Anything
 * else after alias resolution is treated as tag metadata.
 */
const RESERVED_PIPE_KEYS: ReadonlySet<string> = new Set([
  'confidence',
  'collapsed',
]);

/**
 * Common typo stems for directive keywords. When a line starts with one
 * of these AND its value would be valid for the canonical directive, we
 * emit a clear error instead of silently registering a TBD activity —
 * the latter previously poisoned backward-anchored rollups, leaving the
 * user to debug a chart full of `?` cells with no diagnostic to follow.
 */
const NEAR_DIRECTIVE_HINTS: ReadonlyArray<{
  stem: string;
  canonical: string;
  matches: RegExp;
}> = [
  {
    stem: 'confidence',
    canonical: 'default-confidence',
    matches: /^(low|medium|high)$/i,
  },
  {
    stem: 'start',
    canonical: 'start-date',
    matches: /^(\d{4}-\d{2}-\d{2}|now)$/i,
  },
  {
    stem: 'end',
    canonical: 'end-date',
    matches: /^\d{4}-\d{2}-\d{2}$/,
  },
  {
    stem: 'time',
    canonical: 'time-unit',
    matches: /^(d|w|m|q|y|h|min|bd|s)$/i,
  },
];

/** Group header: `[name]` with optional `| collapsed: true` etc. */
// Captures: [1]=name [2]=trailing content (metadata, parsed via splitNameAndMeta below)
const GROUP_HEADER_RE = /^\[([^\]]+)\]\s*(.*)$/;

/** Indented reference, no edge label: `-> dest`. */
const ARROW_RE = /^->\s*(.+?)\s*$/;

/**
 * Indented metadata line: `key: value` (§1.4.2). Captures [1]=key
 * [2]=value. The key must still pass the reserved-registry / tag-alias
 * gate before it dispatches as metadata — this only screens the shape.
 */
const INDENTED_META_RE = /^([A-Za-z][\w-]*)\s*:\s*(.+)$/;

/**
 * Indented reference with edge label: `-LABEL-> dest` where LABEL encodes
 * dependency type and/or lag (e.g. `SS`, `2d`, `SS+2d`, `FF-1d`).
 * The leading `-` and trailing `->` frame the label.
 */
const LABELED_ARROW_RE = /^-(.+?)->\s*(.+?)\s*$/;

/**
 * Parse an edge label into `{ type, lag }`. Returns `null` when the
 * label is malformed; emits no diagnostics — caller decides phrasing.
 *
 * Grammar: `[TYPE][SIGN NUMBER UNIT?]` — at least one of TYPE / lag must
 * be present. TYPE is FS/SS/FF/SF (case-insensitive). NUMBER may be
 * decimal. UNIT defaults to the diagram-level `time-unit`.
 */
export function parseEdgeLabel(
  label: string,
  defaultUnit: Duration['unit']
): { type: EdgeType; lag: Duration | null } | null {
  const trimmed = label.trim();
  if (trimmed === '') return null;
  // [TYPE][SIGN NUMBER UNIT?] — TYPE optional, lag optional, but at least
  // one must be present (re-checked below).
  const m = trimmed.match(/^(fs|ss|ff|sf)?([+-]?\d+(?:\.\d+)?)?\s*([a-z]+)?$/i);
  if (!m) return null;
  const typeRaw = m[1];
  const numRaw = m[2];
  const unitRaw = m[3];
  // Reject empty match where neither piece was provided.
  if (!typeRaw && !numRaw) return null;
  // Unit alone (no number) is not a valid lag.
  if (unitRaw && !numRaw) return null;
  const type: EdgeType = typeRaw ? (typeRaw.toUpperCase() as EdgeType) : 'FS';
  let lag: Duration | null = null;
  if (numRaw) {
    const amount = parseFloat(numRaw);
    if (amount !== 0) {
      const unit = unitRaw
        ? (unitRaw.toLowerCase() as Duration['unit'])
        : defaultUnit;
      // Whitelist valid units to surface typos instead of silently
      // accepting `A -SS+2x-> B`.
      if (!isValidDurationUnit(unit)) return null;
      lag = { amount, unit };
    }
  }
  return { type, lag };
}

const VALID_DURATION_UNITS: ReadonlySet<string> = new Set([
  'min',
  'h',
  'd',
  'bd',
  'w',
  'm',
  'q',
  'y',
  's',
]);

function isValidDurationUnit(u: string): u is Duration['unit'] {
  return VALID_DURATION_UNITS.has(u);
}

/** Trailing `as <ident>` (alias) suffix; `<ident>` ≤ 12 chars. */
const ALIAS_SUFFIX_RE = /\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/;

/**
 * Numeric-with-optional-unit token. The unit set matches `parseDuration()`
 * (h/min/d/bd/w/m/q/y/s). A bare number falls back to `timeUnit`.
 */
const ESTIMATE_TOKEN_RE = /^(\d+(?:\.\d+)?)(min|bd|d|w|m|q|y|h|s)?$/;

/** Default options when nothing is declared. */
/**
 * Sentinel values mean "user didn't author this directive — derive a
 * sensible default from the parsed graph at the end of parsePert".
 * `trials`: scaled to activity count (see `deriveTrials`).
 * `seed`:   FNV-1a hash of the title or sorted activity names.
 */
const DEFAULT_OPTIONS: PertOptions = {
  timeUnit: 'd',
  direction: 'LR',
  nodeDetail: 'compact',
  confidence: 'medium',
  trials: -1,
  seed: -1,
  scrubberTrials: 300,
  anchor: null,
  sprintLength: null,
  sprintNumber: null,
  sprintStart: null,
  sprintMode: null,
  today: '',
};

/**
 * Auto-derive `trials` from activity count: small plans run fast, big
 * plans get more samples. Clamped to [5000, 20000].
 */
function deriveTrials(activityCount: number): number {
  const t = Math.round(1000 * Math.sqrt(Math.max(activityCount, 1)));
  return Math.max(5000, Math.min(20000, t));
}

/**
 * Auto-derive `seed` from a stable string (title or activity names).
 * FNV-1a 32-bit. Returns a positive 31-bit integer so it round-trips
 * cleanly through JSON / share-link encoding.
 */
function deriveSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 1;
}

// ============================================================
// Utility helpers
// ============================================================

/** Trim a `#` line-leading comment off the END of a line. */
function stripTrailingComment(line: string): string {
  // Only strip when `#` is preceded by whitespace; preserves names that
  // happen to contain `#` literally (none in PERT today, but cheap).
  const m = line.match(/^(.*?)\s+#.*$/);
  // In-bounds by regex match: group 1 is guaranteed present.
  return (m ? m[1]! : line).trimEnd();
}

/**
 * Peel a trailing `as <ident>` suffix off `text`, returning the bare
 * left-hand side and (optionally) the alias. Backward scan per Parser
 * Rule 8 — names containing the literal `as` parse cleanly when no
 * alias is actually appended.
 */
function peelAlias(text: string): { head: string; alias?: string } {
  const trimmed = text.trim();
  const m = trimmed.match(ALIAS_SUFFIX_RE);
  if (!m) return { head: trimmed };
  const alias = m[1];
  return {
    head: trimmed.slice(0, m.index!).trim(),
    ...(alias !== undefined && { alias }),
  };
}

/**
 * Split a line into name and duration-token portions, plus an optional
 * trailing alias and pipe-metadata block. The split point is the first
 * token that parses as a numeric estimate token.
 *
 * Returns `{ name, durationTokens, alias?, pipeMetadata? }`.
 */
function tokenizeActivityLine(
  line: string,
  diagnostics?: import('../diagnostics').DgmoError[],
  lineNumber?: number,
  metaAliasMap?: Map<string, string>
): {
  name: string;
  durationTokens: string[];
  alias?: string;
  pipeMetadata?: string;
} {
  let body = line;
  let pipeMetadata: string | undefined;

  // §1.4 unified metadata grammar — same-line cut on the body.
  // PERT activity lines: `Name 5 10 15 confidence: low` → split out
  // metadata, leaving `Name 5 10 15` for duration tokenization below.
  if (metaAliasMap !== undefined) {
    const registry = withTagAliases(
      PERT_REGISTRY,
      new Set(metaAliasMap.keys())
    );
    const split = splitNameAndMeta(
      body,
      registry,
      metaAliasMap,
      undefined,
      diagnostics,
      lineNumber
    );
    if (diagnostics && lineNumber != null) {
      warnUnknownMetaKeys(
        split.meta,
        registry,
        (msg) => diagnostics.push(makeDgmoError(lineNumber, msg, 'warning')),
        split.name
      );
    }
    if (Object.keys(split.meta).length > 0) {
      // Restore body with color and alias re-appended so the downstream
      // PERT tokenizer (peelAlias, duration token scan) sees the same
      // shape as a pre-0.18.0 `name 5 10 15 as id` body.
      let restored = split.name;
      if (split.color) restored = `${restored} ${split.color}`;
      if (split.alias) restored = `${restored} as ${split.alias}`;
      body = restored;
      // Merge metadata into the pipeMetadata string so downstream
      // parsePipeMetadata picks it up unchanged.
      const merged = Object.entries(split.meta)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      pipeMetadata = pipeMetadata ? `${pipeMetadata}, ${merged}` : merged;
    }
  }

  // Peel alias suffix (must come after numeric tail; the alias regex
  // requires whitespace + `as` + ident so it cleanly avoids names that
  // contain `as` as a literal token).
  const peeled = peelAlias(body);

  // Now scan tokens left-to-right (whitespace OR commas separate),
  // splitting on the first numeric-looking token.
  const rawTokens = peeled.head
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  let firstNumIdx = -1;
  for (let i = 0; i < rawTokens.length; i++) {
    // In-bounds by loop guard.
    if (ESTIMATE_TOKEN_RE.test(rawTokens[i]!)) {
      firstNumIdx = i;
      break;
    }
  }

  let name: string;
  let durationTokens: string[];
  if (firstNumIdx === -1) {
    name = peeled.head;
    durationTokens = [];
  } else {
    name = rawTokens.slice(0, firstNumIdx).join(' ').trim();
    durationTokens = rawTokens.slice(firstNumIdx);
  }

  return {
    name,
    durationTokens,
    ...(peeled.alias !== undefined && { alias: peeled.alias }),
    ...(pipeMetadata !== undefined && { pipeMetadata }),
  };
}

/**
 * Parse a single estimate token into a `Duration`. Accepts bare numerics
 * (inheriting `defaultUnit`) and unit-suffixed forms (`0.5d`). Returns
 * null on a malformed token (caller will diagnose).
 */
function parseEstimateToken(
  token: string,
  defaultUnit: DurationUnit
): Duration | null {
  const m = token.match(ESTIMATE_TOKEN_RE);
  if (!m) return null;
  // In-bounds by regex match: group 1 is guaranteed present.
  const amount = parseFloat(m[1]!);
  if (!Number.isFinite(amount)) return null;
  const unit = (m[2] as DurationUnit | undefined) ?? defaultUnit;
  if (unit === 's') {
    // Sprint units don't make sense for PERT (no calendar). Fall back
    // to the diagram time-unit for now and let the analyzer warn.
    return { amount, unit: defaultUnit };
  }
  // Use parseDuration to round-trip the value (also normalizes form).
  const round = parseDuration(`${amount}${unit}`);
  return round ?? { amount, unit };
}

/**
 * Build a `DurationEstimate` from a list of tokens.
 * - 0 tokens → null (TBD)
 * - 1 token → caller must apply confidence factors elsewhere; here we
 *   return `{ o: m, m, p: m }` so the analyzer's `applyMOnlyHeuristic()`
 *   can rebuild it once it knows the per-activity confidence.
 * - 3 tokens → O, M, P literal.
 * - 2/N tokens → null + diagnostic at call site.
 */
function buildEstimate(
  tokens: string[],
  defaultUnit: DurationUnit,
  diagnose: (msg: string) => void
): DurationEstimate | null {
  if (tokens.length === 0) return null;
  if (tokens.length === 2) {
    // In-bounds by length check above: tokens[0] and tokens[1] are guaranteed present.
    diagnose(
      `Expected 1 (M) or 3 (O M P) durations; got 2 (${tokens.join(' ')}). ` +
        `Did you mean '${tokens[0]!} ${(parseFloat(tokens[0]!) + parseFloat(tokens[1]!)) / 2} ${tokens[1]!}'?`
    );
    return null;
  }
  if (tokens.length !== 1 && tokens.length !== 3) {
    diagnose(
      `Expected 1 (M) or 3 (O M P) durations; got ${tokens.length} (${tokens.join(' ')}).`
    );
    return null;
  }

  const parsed: Duration[] = [];
  for (const t of tokens) {
    const dur = parseEstimateToken(t, defaultUnit);
    if (!dur) {
      diagnose(`Invalid duration token '${t}'.`);
      return null;
    }
    if (dur.amount < 0) {
      diagnose(`Duration must be ≥ 0; got '${t}'.`);
      return null;
    }
    parsed.push(dur);
  }

  if (parsed.length === 1) {
    // M-only — analyzer expands using confidence factors. Stash M in
    // all three slots; the `mOnly` flag (not value-equality) is the
    // sentinel, so a literal "1 1 1" triple is correctly preserved.
    // In-bounds by length === 1 check.
    return { o: parsed[0]!, m: parsed[0]!, p: parsed[0]!, mOnly: true };
  }

  // 3-tuple — validate O ≤ M ≤ P (after unit-normalization on amounts).
  // In-bounds: validated to be length 3 above.
  const [o, m, p] = parsed as [Duration, Duration, Duration];
  // For mixed units we compare with same-unit normalization; for v1 we
  // compare amounts directly when units match (the common case).
  const sameUnit = o.unit === m.unit && m.unit === p.unit;
  if (sameUnit && !(o.amount <= m.amount && m.amount <= p.amount)) {
    diagnose(
      `Invalid estimate (${tokens.join(' ')}): expected O ≤ M ≤ P. ` +
        `Did you mean (${[o.amount, m.amount, p.amount].sort((a, b) => a - b).join(' ')})?`
    );
    return null;
  }
  return { o, m, p, mOnly: false };
}

/**
 * Pipe metadata: `key: value, key2: value2`.
 * Reserved keys (`confidence`, `collapsed`) flow into their dedicated
 * activity/group fields; everything else is treated as tag metadata
 * once aliases (`p` → `priority`) are resolved against the diagram's
 * declared tag groups.
 */
function parsePipeMetadata(
  raw: string,
  aliasMap: Map<string, string> = new Map()
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    const rawKey = trimmed.slice(0, idx).trim().toLowerCase();
    const key = aliasMap.get(rawKey) ?? rawKey;
    const value = trimmed.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

// ============================================================
// parsePert
// ============================================================

export interface ParsePertOptions {
  /**
   * "Today" reference for `start-date now` and `options.today`. Defaults
   * to `new Date()` at call time; tests inject a fixed date for
   * deterministic snapshots and past-row assertions.
   */
  now?: Date;
  /**
   * Active palette — used when resolving color names on `tag` entries
   * (e.g. `High red` → palette.colors.red). Optional; when omitted the
   * universal default color map is used.
   */
  palette?: PaletteColors;
}

/**
 * First explicit-year date among the `start-date`/`end-date`/`sprint-start`
 * anchors — the base year for a bare-date anchor (§ BL-121 prescan-anchor).
 */
function prescanPertYear(lines: string[], order: DateOrder): number | null {
  for (const raw of lines) {
    const m = raw
      .trim()
      .match(/^(?:start-date|end-date|sprint-start)\s+(.+)$/i);
    if (!m) continue;
    const res = parseDateToken(m[1]!.trim(), { dateOrder: order });
    if (res?.token.year != null) return res.token.sign * res.token.year;
  }
  return null;
}

export function parsePert(
  content: string,
  parseOpts: ParsePertOptions = {}
): ParsedPert {
  const lines = content.split('\n');
  const diagnostics: DgmoError[] = [];
  const error = (line: number, msg: string, code?: string): void => {
    diagnostics.push(makeDgmoError(line, msg, 'error', code));
  };
  const warn = (line: number, msg: string, code?: string): void => {
    diagnostics.push(makeDgmoError(line, msg, 'warning', code));
  };

  // Parse-time "today" — single capture, used both for `start-date now`
  // resolution AND surfaced to the analyzer via `options.today`. Baking
  // at parse time matches the spec: shared share-links land on the
  // recipient's render path with a frozen `today`, and `(as of …)`
  // suffixes reflect the author's clock.
  const today = formatLocalISODate(parseOpts.now ?? new Date());

  // ── Universal date handling (§ BL-121) ────────────────────
  // Pre-scan for the date directives so they govern the anchors regardless of
  // line order, then resolve the base year: directive year, else the first
  // explicit-year anchor found anywhere. `currentYear` comes from the frozen
  // `today` snapshot so injected-clock tests stay deterministic.
  let dateOrder: DateOrder = 'mdy';
  let directiveYear: number | null = null;
  let noCurrentYear = false;
  for (const raw of lines) {
    const t = raw.trim();
    const dm = t.match(/^date-order\s+(mdy|dmy)$/i);
    if (dm) dateOrder = dm[1]!.toLowerCase() as DateOrder;
    const ym = t.match(/^year\s+(\d{1,4})$/i);
    if (ym) directiveYear = parseInt(ym[1]!, 10);
    if (t.toLowerCase() === 'no-current-year') noCurrentYear = true;
  }
  const currentYear = parseInt(today.slice(0, 4), 10);
  const baseYear = directiveYear ?? prescanPertYear(lines, dateOrder);

  const options: PertOptions = { ...DEFAULT_OPTIONS, today };
  let title: string | null = null;

  // Track the line of the FIRST anchor directive so a later collision
  // can name it (per F9 review feedback). Cleared along with
  // `options.anchor` when both-anchors is detected.
  let firstAnchorLine: number | null = null;
  let firstAnchorKey: 'start-date' | 'end-date' | null = null;

  // ── Pass 1 ──────────────────────────────────────────────
  // Collect declarations, references, group blocks. No resolution yet.

  /** Map of canonical normalized name → declaration site (the first one wins). */
  const declarationsByName = new Map<string, DeclarationSite>();
  /** Same map keyed by alias literal → declaration. */
  const declarationsByAlias = new Map<string, DeclarationSite>();
  /** All declaration sites in source order (used for conflict detection). */
  const allDeclarations: DeclarationSite[] = [];
  /** Cross-site duplicate buckets keyed by normalized name. */
  const sitesByName = new Map<string, DeclarationSite[]>();

  /** Edge references from indented `-> dest` lines. */
  const references: ReferenceSite[] = [];

  /** Groups discovered in source order; activityIds populated in Pass 2. */
  const groups: Writable<PertGroup>[] = [];

  /**
   * Tag groups declared at the top of the diagram. A `tag …` heading
   * opens a block; entries (indented `Value color` lines) accumulate
   * until the first non-tag content line closes it.
   */
  const tagGroups: TagGroup[] = [];
  let currentTagGroup: Writable<TagGroup> | null = null;
  /**
   * Tag-block phase ends as soon as the parser sees any directive,
   * group header, activity, or arrow line. After `contentStarted`
   * flips, further `tag …` headings are rejected with an error.
   */
  let contentStarted = false;
  /**
   * Map of pipe-metadata alias → canonical tag-group key (lowercased
   * tag-group name). `tag Priority as p` adds `p → priority`, so
   * `| p: High` resolves to `priority: High` at activity-parse time.
   */
  const metaAliasMap = new Map<string, string>();

  /** Stack of (groupId, indent) — the group at the bottom is the open one. */
  type GroupFrame = { groupId: string; indent: number };
  const groupStack: GroupFrame[] = [];
  const currentGroupId = (): string | undefined =>
    groupStack.length > 0
      ? // In-bounds by length check.
        groupStack[groupStack.length - 1]!.groupId
      : undefined;

  /** Tracks the most recent activity declaration line (for `-> dest` source). */
  let currentSourceName: string | null = null;
  /** Indent of currentSourceName — used to pop on dedent. */
  let currentSourceIndent = -1;
  /**
   * The declaration site backing `currentSourceName` — the target for
   * indented `key: value` metadata lines (§1.4.2) that appear beneath an
   * activity, intermixed with its `-> dest` arrows.
   */
  let currentSourceSite: DeclarationSite | null = null;

  let pastFirstLine = false;

  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const rawLine = lines[i]!;
    const lineNumber = i + 1;
    const trimmed = stripTrailingComment(rawLine).trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    const indent = measureIndent(rawLine);

    // Pop any group frames whose indent ≥ this line's indent (block closes).
    while (groupStack.length > 0) {
      // In-bounds by length check.
      const top = groupStack[groupStack.length - 1]!;
      if (indent <= top.indent) groupStack.pop();
      else break;
    }
    // Ditto for current source: indented arrow lines (`-> dest` or
    // `-LABEL-> dest`) must be deeper than the source.
    if (
      currentSourceIndent >= 0 &&
      indent <= currentSourceIndent &&
      !trimmed.startsWith('-')
    ) {
      currentSourceName = null;
      currentSourceIndent = -1;
      currentSourceSite = null;
    }

    // ── First line: `pert [title]` (chart-type declaration).
    if (!pastFirstLine) {
      pastFirstLine = true;
      const tokens = trimmed.split(/\s+/);
      // In-bounds: split always returns at least one element.
      const head = tokens[0]!.toLowerCase();
      if (head === 'pert') {
        if (tokens.length > 1) title = tokens.slice(1).join(' ');
        continue;
      }
      // No explicit `pert` line — fall through; the diagram may be
      // inferred via `looksLikePert`. We don't error here; the dispatch
      // layer is responsible for routing.
    }

    // ── Tag-block phase. `tag Priority as p\n  High red\n  Low green`
    // lives BEFORE diagram content; once any group / activity / arrow
    // is seen, `contentStarted` flips and further `tag …` headings
    // emit an error.
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
            tagBlockMatch.alias.toLowerCase(),
            tagAttrKey(tagBlockMatch.name)
          );
        }
        metaAliasMap.set(
          normalizeName(tagBlockMatch.name),
          tagAttrKey(tagBlockMatch.name)
        );
        tagGroups.push(currentTagGroup);
        // Inline values (e.g. `tag Priority as p Low green, High red`).
        if (tagBlockMatch.inlineValues) {
          for (const raw of tagBlockMatch.inlineValues) {
            const { text, isDefault } = stripDefaultModifier(raw);
            const { label, color } = extractColor(
              text,
              parseOpts.palette,
              diagnostics,
              lineNumber
            );
            // Bare value (no explicit color) → keep it; finalized below.
            if (isDefault || currentTagGroup.entries.length === 0) {
              currentTagGroup.defaultValue = label;
            }
            currentTagGroup.entries.push({
              value: label,
              color: color ?? AUTO_TAG_COLOR_SENTINEL,
              lineNumber,
            });
          }
        }
        continue;
      }
      // Indented `Value color` entry under an open tag block.
      if (currentTagGroup && indent > 0) {
        const { text, isDefault } = stripDefaultModifier(trimmed);
        const { label, color } = extractColor(
          text,
          parseOpts.palette,
          diagnostics,
          lineNumber
        );
        // Bare value (no explicit color) → keep it; finalized below.
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
      // Any other line at indent 0 closes the tag block (and content phase begins).
      currentTagGroup = null;
    } else if (matchTagBlockHeading(trimmed)) {
      // `tag …` after content has started — must live at the top of the file.
      error(
        lineNumber,
        `'tag' declarations must appear before activities and groups.`
      );
      continue;
    }

    // ── Group header: `[group-name] collapsed: true` or `[group-name] c: Bosun`.
    const groupMatch = trimmed.match(GROUP_HEADER_RE);
    if (groupMatch) {
      contentStarted = true;
      currentTagGroup = null;
      const name = groupMatch[1]!.trim();
      const tail = (groupMatch[2] ?? '').trim();
      // Parse the tail as §1.4 metadata. tail is `k: v, k: v` shape.
      const meta = tail ? parsePipeMetadata(tail, metaAliasMap) : {};
      const id = `[${normalizeName(name)}]`;
      const tags: Record<string, string> = {};
      for (const [k, v] of Object.entries(meta)) {
        if (!RESERVED_PIPE_KEYS.has(k)) tags[k] = v;
      }
      groups.push({
        id,
        name,
        activityIds: [],
        collapsed: meta['collapsed'] === 'true',
        lineNumber,
        ...(Object.keys(tags).length > 0 && { tags }),
      });
      groupStack.push({ groupId: id, indent });
      currentSourceName = null;
      currentSourceIndent = -1;
      currentSourceSite = null;
      continue;
    }

    // ── Indented arrow line: `-> dest` or `-LABEL-> dest` where LABEL
    // is `[TYPE][±LAG]` (e.g. `SS`, `2d`, `SS+2d`, `FF-1d`). Type
    // defaults to FS, lag to zero.
    if (trimmed.startsWith('-')) {
      contentStarted = true;
      currentTagGroup = null;
      let arrowTargetText: string;
      let edgeType: EdgeType = 'FS';
      let edgeLag: Duration | null = null;

      const bareMatch = trimmed.match(ARROW_RE);
      if (bareMatch) {
        // In-bounds by regex match: group 1 is guaranteed present.
        arrowTargetText = bareMatch[1]!;
      } else {
        const labeledMatch = trimmed.match(LABELED_ARROW_RE);
        if (!labeledMatch) {
          error(lineNumber, `Malformed arrow line: '${trimmed}'.`);
          continue;
        }
        // In-bounds by regex match: groups 1 and 2 are guaranteed present.
        const parsedLabel = parseEdgeLabel(labeledMatch[1]!, options.timeUnit);
        if (!parsedLabel) {
          error(
            lineNumber,
            `Invalid edge label '${labeledMatch[1]!}' in '${trimmed}'. ` +
              `Expected a dependency type (FS/SS/FF/SF) and/or lag (e.g. '+2d', '-1d').`
          );
          continue;
        }
        arrowTargetText = labeledMatch[2]!;
        edgeType = parsedLabel.type;
        edgeLag = parsedLabel.lag;
      }

      if (!currentSourceName) {
        error(
          lineNumber,
          `'-> ${arrowTargetText}' has no source — declare an activity above on a non-indented line.`
        );
        continue;
      }
      const tok = tokenizeActivityLine(
        arrowTargetText,
        diagnostics,
        lineNumber,
        metaAliasMap
      );
      const targetName = tok.name;
      if (!targetName) {
        error(lineNumber, `'-> …' is missing a target name.`);
        continue;
      }

      // Arrow lines are pure references. Durations, alias declarations,
      // and pipe metadata must live on a non-indented source-line so
      // readers know exactly where to look for an activity's attributes.
      if (
        tok.durationTokens.length > 0 ||
        tok.alias !== undefined ||
        tok.pipeMetadata !== undefined
      ) {
        const extras: string[] = [];
        if (tok.durationTokens.length > 0) {
          extras.push(`'${tok.durationTokens.join(' ')}'`);
        }
        if (tok.alias !== undefined) extras.push(`'as ${tok.alias}'`);
        if (tok.pipeMetadata !== undefined) {
          extras.push(`'${tok.pipeMetadata}'`);
        }
        const durHint =
          tok.durationTokens.length > 0
            ? ` ${tok.durationTokens.join(' ')}`
            : '';
        error(
          lineNumber,
          `Inline forward-declaration not allowed on '-> ${arrowTargetText}' ` +
            `(${extras.join(', ')}). ` +
            `Move attributes to a source-line: '${targetName}${durHint}' ` +
            `then '-> ${targetName}'.`
        );
        continue;
      }

      references.push({
        sourceName: currentSourceName,
        sourceLineNumber: -1, // resolved in Pass 2 from declarations
        targetName,
        targetLineNumber: lineNumber,
        type: edgeType,
        lag: edgeLag,
      });
      continue;
    }

    // ── Indented metadata line (§1.4.2): `key: value` attached to the
    // activity declared above, intermixable with its `-> dest` arrows.
    // Only keys in the reserved registry (`confidence`, `collapsed`) or a
    // declared tag alias dispatch here; everything else falls through to
    // the activity-declaration grammar below. Reaching this point with a
    // live source guarantees the line is indented deeper than it (the
    // dedent guard above already cleared shallower lines).
    if (currentSourceSite) {
      const metaMatch = trimmed.match(INDENTED_META_RE);
      if (metaMatch) {
        const rawKey = metaMatch[1]!;
        const key = rawKey.toLowerCase();
        const resolvedKey = metaAliasMap.get(key) ?? key;
        if (RESERVED_PIPE_KEYS.has(resolvedKey) || metaAliasMap.has(key)) {
          contentStarted = true;
          currentTagGroup = null;
          const entry = `${rawKey}: ${metaMatch[2]!.trim()}`;
          currentSourceSite.pipeMetadata = currentSourceSite.pipeMetadata
            ? `${currentSourceSite.pipeMetadata}, ${entry}`
            : entry;
          continue;
        }
      }
    }

    // ── Diagram-level directives (bare keyword + optional value).
    {
      const firstSpace = trimmed.indexOf(' ');
      const head =
        firstSpace === -1
          ? trimmed.toLowerCase()
          : trimmed.slice(0, firstSpace).toLowerCase();
      if (DIRECTIVE_KEYS.has(head)) {
        const value =
          firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();
        if (head === 'start-date' || head === 'end-date') {
          // Closure-aware path: collision diagnostic names the first
          // anchor's line so the user knows which directive to remove.
          const hadAnchor = options.anchor !== null;
          applyAnchorDirective(
            head as 'start-date' | 'end-date',
            value,
            lineNumber,
            options,
            diagnostics,
            firstAnchorLine,
            firstAnchorKey,
            { order: dateOrder, baseYear, currentYear, noCurrentYear }
          );
          if (!hadAnchor && options.anchor !== null) {
            firstAnchorLine = lineNumber;
            firstAnchorKey = head as 'start-date' | 'end-date';
          } else if (hadAnchor && options.anchor === null) {
            // Both-anchors collision cleared the prior anchor — clear the
            // tracker too so a third directive (if any) sees a clean slate.
            firstAnchorLine = null;
            firstAnchorKey = null;
          }
          continue;
        }
        applyDirective(head, value, lineNumber, options, error, warn, {
          order: dateOrder,
          baseYear,
          currentYear,
          noCurrentYear,
        });
        continue;
      }
    }

    // ── Near-directive typos: `confidence medium` (meaning
    // `default-confidence medium`), `start 2026-06-01`, `end YYYY-MM-DD`,
    // `time w`. Without this check the line was silently parsed as a
    // TBD activity, which propagates `?` through every corner cell in
    // backward-anchor mode with no actionable error to fix.
    {
      const firstSpace = trimmed.indexOf(' ');
      if (firstSpace > 0) {
        const head = trimmed.slice(0, firstSpace).toLowerCase();
        const value = trimmed.slice(firstSpace + 1).trim();
        const hint = NEAR_DIRECTIVE_HINTS.find((h) => h.stem === head);
        if (hint?.matches.test(value)) {
          diagnostics.push(
            emit(PERT_DX.NEAR_DIRECTIVE, lineNumber, {
              head,
              canonical: hint.canonical,
            })
          );
          continue;
        }
      }
    }

    // ── Reject the `milestone` keyword outright — zero-duration
    // activities (`<name> 0`) cover the use case.
    if (/^milestone(\s|$)/i.test(trimmed)) {
      error(lineNumber, `Unknown keyword 'milestone'.`);
      continue;
    }

    // ── Activity declaration: `<name> <durs?> [as <id>] [| meta]`.
    {
      const tok = tokenizeActivityLine(
        trimmed,
        diagnostics,
        lineNumber,
        metaAliasMap
      );
      if (!tok.name) {
        error(lineNumber, `Empty activity name: '${trimmed}'.`);
        continue;
      }
      contentStarted = true;
      currentTagGroup = null;

      // Bare source-line referencing an existing alias: don't register a
      // duplicate activity — just point currentSource at the canonical
      // name so subsequent `-> dest` lines attach correctly.
      const isBareSource =
        tok.durationTokens.length === 0 &&
        tok.alias === undefined &&
        tok.pipeMetadata === undefined;
      if (isBareSource && declarationsByAlias.has(tok.name)) {
        const existing = declarationsByAlias.get(tok.name)!;
        currentSourceName = existing.name;
        currentSourceIndent = indent;
        currentSourceSite = existing;
        continue;
      }

      const groupHint = currentGroupId();
      const site: DeclarationSite = {
        name: tok.name,
        ...(tok.alias !== undefined && { alias: tok.alias }),
        durationTokens: tok.durationTokens,
        ...(tok.pipeMetadata !== undefined && {
          pipeMetadata: tok.pipeMetadata,
        }),
        lineNumber,
        ...(groupHint !== undefined && { groupHint }),
      };
      registerSite(site);
      currentSourceName = tok.name;
      currentSourceIndent = indent;
      currentSourceSite = site;
      continue;
    }
  }

  function registerSite(site: DeclarationSite): void {
    allDeclarations.push(site);
    const key = normalizeName(site.name);
    const bucket = sitesByName.get(key);
    if (bucket) bucket.push(site);
    else sitesByName.set(key, [site]);
    if (!declarationsByName.has(key)) {
      declarationsByName.set(key, site);
    }
    if (site.alias && !declarationsByAlias.has(site.alias)) {
      declarationsByAlias.set(site.alias, site);
    }
  }

  // ── Anchor + time-unit cross-checks ─────────────────────
  // Order-independent: directives can appear in any order; both must
  // be parsed before this fires. Render-blocking false; the chart
  // still renders with whatever rounding the date display imposes.
  if (options.anchor !== null) {
    if (options.timeUnit === 'bd') {
      diagnostics.push(emit(PERT_DX.BD_WITH_ANCHOR, 0));
    } else if (options.timeUnit === 'min' || options.timeUnit === 'h') {
      diagnostics.push(emit(PERT_DX.SUBDAY_WITH_ANCHOR, 0));
    }
  }

  // ── Pass 2 ──────────────────────────────────────────────
  // Resolve, validate, classify, build edges + activities.

  // 2a) Conflict detection across declaration sites of the same name.
  for (const [key, sites] of sitesByName) {
    if (sites.length < 2) continue;
    // Collect explicit-duration sites; tokens-equal across all → silent OK.
    const explicit = sites.filter((s) => s.durationTokens.length > 0);
    if (explicit.length < 2) continue;
    const fingerprints = new Set(
      explicit.map((s) => s.durationTokens.join(' '))
    );
    if (fingerprints.size > 1) {
      const lineList = explicit
        .map((s) => `line ${s.lineNumber} (${s.durationTokens.join(' ')})`)
        .join(' and ');
      // Anchor the diagnostic on the first site so navigation lands somewhere stable.
      // In-bounds: explicit.length >= 2 above.
      error(
        explicit[0]!.lineNumber,
        `Conflicting estimates for "${declarationsByName.get(key)!.name}" on ${lineList}. Keep one declaration site.`
      );
    }
  }

  // 2b) Build alias → canonical id table.
  // Canonical id = normalizeName(decl.name). Aliases are alternate lookup
  // keys for resolution; an aliased activity and a bare-name source line
  // pointing at the same activity must collapse to one canonical id.
  const idMap: Record<string, string> = {};
  for (const [, decl] of declarationsByName) {
    const id = canonicalIdFromDeclaration(decl);
    idMap[normalizeName(decl.name)] = id;
    idMap[decl.name.toLowerCase()] = id;
  }
  for (const [aliasLiteral, decl] of declarationsByAlias) {
    idMap[aliasLiteral] = canonicalIdFromDeclaration(decl);
  }

  function canonicalIdFromDeclaration(decl: DeclarationSite): string {
    return normalizeName(decl.name);
  }

  function resolveTargetId(token: string, lineNumber: number): string | null {
    const trimmed = token.trim();
    // Try alias first (case-sensitive — aliases are short tokens).
    if (declarationsByAlias.has(trimmed)) {
      return canonicalIdFromDeclaration(declarationsByAlias.get(trimmed)!);
    }
    const norm = normalizeName(trimmed);
    if (declarationsByName.has(norm)) {
      return canonicalIdFromDeclaration(declarationsByName.get(norm)!);
    }
    const candidates = [
      ...declarationsByAlias.keys(),
      ...[...declarationsByName.values()].map((d) => d.name),
    ];
    const hint = suggest(trimmed, candidates);
    error(
      lineNumber,
      `Unknown activity '${trimmed}'.${hint ? ` ${hint}` : ''}`
    );
    return null;
  }

  // 2c) Materialize activities from declarations (one per canonical name).
  // The "best" declaration site for an activity is the one that supplies
  // duration tokens (or the alias) — a bare-name source line never wins
  // over an explicit declaration.
  const bestDeclByName = new Map<string, DeclarationSite>();
  for (const decl of allDeclarations) {
    const key = normalizeName(decl.name);
    const existing = bestDeclByName.get(key);
    if (!existing) {
      bestDeclByName.set(key, decl);
      continue;
    }
    const existingHasInfo =
      existing.durationTokens.length > 0 || existing.alias !== undefined;
    const incomingHasInfo =
      decl.durationTokens.length > 0 || decl.alias !== undefined;
    if (!existingHasInfo && incomingHasInfo) {
      bestDeclByName.set(key, decl);
    }
  }

  const activitiesById = new Map<string, Writable<PertActivity>>();
  for (const [id, decl] of bestDeclByName) {
    const estimate = buildEstimate(
      decl.durationTokens,
      options.timeUnit,
      (msg) => error(decl.lineNumber, msg)
    );
    const meta = decl.pipeMetadata
      ? parsePipeMetadata(decl.pipeMetadata, metaAliasMap)
      : {};
    // Split reserved keys (`confidence`) from tag metadata.
    const tags: Record<string, string> = {};
    for (const [k, v] of Object.entries(meta)) {
      if (!RESERVED_PIPE_KEYS.has(k)) tags[k] = v;
    }
    // Zero-duration activities (O = M = P = 0) are flagged as milestones
    // so the renderer can mark them with the diamond glyph.
    const isMilestone =
      estimate !== null &&
      estimate.o.amount === 0 &&
      estimate.m.amount === 0 &&
      estimate.p.amount === 0;
    activitiesById.set(id, {
      id,
      name: decl.name,
      ...(decl.alias !== undefined && { alias: decl.alias }),
      duration: estimate,
      ...(meta['confidence'] && { confidence: meta['confidence'] }),
      ...(decl.groupHint !== undefined && { groupId: decl.groupHint }),
      lineNumber: decl.lineNumber,
      isMilestone,
      ...(Object.keys(tags).length > 0 && { tags }),
    });
  }

  // 2d) Build edges from references; resolve sources + targets.
  const edges: PertEdge[] = [];
  for (const ref of references) {
    const sourceId = resolveTargetId(ref.sourceName, ref.targetLineNumber);
    const targetId = resolveTargetId(ref.targetName, ref.targetLineNumber);
    if (!sourceId || !targetId) continue;
    edges.push({
      source: sourceId,
      target: targetId,
      lineNumber: ref.targetLineNumber,
      type: ref.type,
      lag: ref.lag,
    });
  }

  // 2e) Populate group memberships + classify hammock vs cluster.
  for (const group of groups) {
    group.activityIds = [...activitiesById.values()]
      .filter((a) => a.groupId === group.id)
      .map((a) => a.id);
    group.classification = classifyGroup(group, edges);
  }

  // 2f) Final ordering — preserve source order from `allDeclarations`.
  const seen = new Set<string>();
  const activities: Writable<PertActivity>[] = [];
  for (const decl of allDeclarations) {
    const id = canonicalIdFromDeclaration(decl);
    if (seen.has(id)) continue;
    seen.add(id);
    const a = activitiesById.get(id);
    if (a) activities.push(a);
  }

  // Resolve auto-derived defaults for `trials` and `seed`. The directive
  // sets the value verbatim; -1 sentinel means "user didn't author it".
  if (options.trials === -1) {
    options.trials = deriveTrials(activities.length);
  }
  if (options.seed === -1) {
    const seedSource =
      title ||
      activities
        .map((a) => a.name)
        .sort()
        .join('\n') ||
      'pert';
    options.seed = deriveSeed(seedSource);
  }

  // Sprint-mode detection (mirrors Gantt). `time-unit s` → auto;
  // any explicit `sprint-*` directive → explicit (wins over auto).
  // Apply sensible defaults when sprint mode is active.
  const hasSprintOption =
    options.sprintLength !== null ||
    options.sprintNumber !== null ||
    options.sprintStart !== null;
  const hasSprintUnit =
    options.timeUnit === 's' ||
    activities.some(
      (a) =>
        a.duration !== null &&
        (a.duration.o.unit === 's' ||
          a.duration.m.unit === 's' ||
          a.duration.p.unit === 's')
    );
  if (hasSprintOption) {
    options.sprintMode = 'explicit';
  } else if (hasSprintUnit) {
    options.sprintMode = 'auto';
  }
  if (options.sprintMode) {
    if (!options.sprintLength) {
      options.sprintLength = { amount: 2, unit: 'w' };
    }
    if (options.sprintNumber === null) {
      options.sprintNumber = 1;
    }
  }

  // Assign palette colors to bare (colorless) tag values.
  finalizeAutoTagColors(tagGroups as Writable<TagGroup>[], parseOpts.palette);

  // ── Tag-group post-validation + default injection ───────
  if (tagGroups.length > 0) {
    validateTagGroupNames(
      tagGroups.map((g) => ({
        name: g.name,
        alias: g.alias ?? null,
        lineNumber: g.lineNumber,
      })),
      warn,
      error
    );
    const ensureTags = (
      entity: Writable<PertActivity> | Writable<PertGroup>
    ): { metadata: Record<string, string>; lineNumber: number } => {
      if (!entity.tags) entity.tags = {};
      return {
        metadata: entity.tags as Record<string, string>,
        lineNumber: entity.lineNumber,
      };
    };
    const activityShells = activities.map(ensureTags);
    const groupShells = groups.map(ensureTags);
    validateTagValues(
      [...activityShells, ...groupShells],
      tagGroups,
      warn,
      suggest
    );
    // Default-tag injection: only activities (containers stay structural).
    injectDefaultTagMetadata(activityShells, tagGroups);
    // Strip empty tags maps for cleaner downstream consumption.
    for (const a of activities) {
      if (a.tags && Object.keys(a.tags).length === 0) delete a.tags;
    }
    for (const g of groups) {
      if (g.tags && Object.keys(g.tags).length === 0) delete g.tags;
    }
  }

  const firstFatal = diagnostics.find((d) => d.severity === 'error');
  return {
    title,
    options,
    activities,
    edges,
    groups,
    tagGroups,
    idMap,
    diagnostics,
    error: firstFatal ? firstFatal.message : null,
  };
}

// ============================================================
// Helpers continued
// ============================================================

function applyDirective(
  key: string,
  value: string,
  lineNumber: number,
  options: PertOptions,
  error: (line: number, msg: string, code?: string) => void,
  warn: (line: number, msg: string, code?: string) => void,
  dateCfg: {
    order: DateOrder;
    baseYear: number | null;
    currentYear: number;
    noCurrentYear: boolean;
  }
): void {
  switch (key) {
    // Universal date directives (§ BL-121) — captured in the parsePert prescan;
    // consumed here so they don't warn as unknown.
    case 'year':
    case 'date-order':
    case 'no-current-year':
      return;
    case 'time-unit': {
      const valid: DurationUnit[] = [
        'min',
        'h',
        'd',
        'bd',
        'w',
        'm',
        'q',
        'y',
        's',
      ];
      if (!(valid as string[]).includes(value)) {
        error(
          lineNumber,
          `Unknown time-unit '${value}'. Expected one of ${valid.join(', ')}.`
        );
        return;
      }
      options.timeUnit = value as DurationUnit;
      return;
    }
    case 'default-confidence': {
      // Verbatim — `resolveConfidence` validates at analyzer time.
      options.confidence = value || 'medium';
      return;
    }
    case 'no-title': {
      // Bare boolean directive — suppresses the diagram banner title.
      options.noTitle = true;
      return;
    }
    case 'solid-fill': {
      // Bare boolean directive — render card fills at full saturation.
      options.solidFill = true;
      return;
    }
    case 'active-tag': {
      // Selects which declared tag group drives node fill.
      // `none` (case-insensitive) suppresses coloring entirely;
      // an unrecognized name resolves to no color at render time.
      // Unset → first declared group auto-activates.
      options.activeTag = value;
      return;
    }
    case 'sprint-length': {
      const dur = parseDuration(value);
      if (!dur) {
        warn(
          lineNumber,
          `Invalid sprint-length value: "${value}". Expected a duration like "2w" or "10d".`
        );
      } else if (dur.unit !== 'd' && dur.unit !== 'w') {
        warn(
          lineNumber,
          `sprint-length only accepts "d" or "w" units, got "${dur.unit}".`
        );
      } else if (dur.amount <= 0) {
        warn(lineNumber, `sprint-length must be greater than 0.`);
      } else if (!Number.isInteger(dur.amount * (dur.unit === 'w' ? 7 : 1))) {
        warn(
          lineNumber,
          `sprint-length must resolve to a whole number of days.`
        );
      } else {
        options.sprintLength = dur;
      }
      return;
    }
    case 'sprint-number': {
      const n = Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        warn(
          lineNumber,
          `sprint-number must be a positive integer, got "${value}".`
        );
      } else {
        options.sprintNumber = n;
      }
      return;
    }
    case 'sprint-start': {
      // Liberal input → canonical ISO day (§ BL-121).
      const res = parseDateToken(value.trim(), { dateOrder: dateCfg.order });
      const yr = res?.token.year ?? dateCfg.baseYear ?? dateCfg.currentYear;
      const iso =
        res?.consumed === value.trim().length &&
        !res.token.invalidTime &&
        res.token.grain >= 3 &&
        !res.token.hasTime
          ? toInternal(res.token, yr)
          : null;
      if (!iso) {
        warn(
          lineNumber,
          `sprint-start requires a full date (e.g. YYYY-MM-DD, 7/4, or Jul 4), got "${value}".`
        );
      } else if (Number.isNaN(new Date(iso + 'T00:00:00').getTime())) {
        warn(lineNumber, `sprint-start is not a valid date: "${value}".`);
      } else {
        options.sprintStart = iso;
      }
      return;
    }
    case 'direction': {
      const upper = value.toUpperCase();
      if (upper !== 'LR' && upper !== 'TB') {
        error(lineNumber, `Unknown direction '${value}'. Expected LR or TB.`);
        return;
      }
      options.direction = upper as PertDirection;
      return;
    }
    case 'node-detail': {
      if (value !== 'compact' && value !== 'full') {
        error(
          lineNumber,
          `Unknown node-detail '${value}'. Expected compact or full.`
        );
        return;
      }
      options.nodeDetail = value as NodeDetail;
      return;
    }
    case 'no-analysis': {
      // Bare boolean directive — suppresses the analysis layer (tornado
      // + S-curve), which otherwise renders by default whenever Monte
      // Carlo ran. Mirrors `no-title`. An explicit `viewState.an` (app
      // toggle / share link) overrides it at render time.
      options.noAnalysis = true;
      return;
    }
    case 'trials': {
      const n = parseInt(value, 10);
      if (!Number.isFinite(n) || n < 1) {
        error(
          lineNumber,
          `'trials' expects a positive integer; got '${value}'.`
        );
        return;
      }
      options.trials = n;
      return;
    }
    case 'seed': {
      const n = parseInt(value, 10);
      if (!Number.isFinite(n)) {
        error(lineNumber, `'seed' expects an integer; got '${value}'.`);
        return;
      }
      options.seed = n;
      return;
    }
    case 'scrubber-trials': {
      const n = parseInt(value, 10);
      if (!Number.isFinite(n) || n < 1) {
        error(
          lineNumber,
          `'scrubber-trials' expects a positive integer; got '${value}'.`
        );
        return;
      }
      if (n < 100) {
        warn(
          lineNumber,
          `'scrubber-trials ${n}' is below the floor of 100; analyzer will still degrade if needed.`
        );
      }
      options.scrubberTrials = n;
      return;
    }
    case 'start-date':
    case 'end-date': {
      // Anchor directives need closure state (first-anchor line/key) to
      // produce a useful collision diagnostic. They are intercepted in
      // the parse loop before this dispatch fires; reaching this case
      // would be a bug.
      error(
        lineNumber,
        `internal error: anchor directive '${key}' reached generic dispatch`
      );
      return;
    }
  }
}

/**
 * Validate and apply a `start-date` / `end-date` directive. Mutual
 * exclusion enforced via clear-on-collision: when a second anchor of
 * either kind arrives we emit `E_PERT_BOTH_ANCHORS` and reset
 * `options.anchor` to `null` so downstream code never sees partial state.
 */
function applyAnchorDirective(
  key: 'start-date' | 'end-date',
  value: string,
  lineNumber: number,
  options: PertOptions,
  diagnostics: DgmoError[],
  firstAnchorLine: number | null,
  firstAnchorKey: 'start-date' | 'end-date' | null,
  dateCfg: {
    order: DateOrder;
    baseYear: number | null;
    currentYear: number;
    noCurrentYear: boolean;
  }
): void {
  // Both-anchors collision (per F4 — clear-on-collision policy):
  // if the user already authored an anchor of either kind, emit error
  // AND drop the prior anchor so the parsed result has no ambiguous
  // partial state. The user must fix the source.
  if (options.anchor !== null) {
    diagnostics.push(
      emit(PERT_DX.BOTH_ANCHORS, lineNumber, {
        firstAnchorKey,
        firstAnchorLine,
      })
    );
    options.anchor = null;
    return;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    diagnostics.push(
      emit(PERT_DX.INVALID_DATE, lineNumber, { empty: true, key, value })
    );
    return;
  }

  // `now` token — only valid for start-date.
  if (trimmed.toLowerCase() === 'now') {
    if (key === 'end-date') {
      diagnostics.push(emit(PERT_DX.END_DATE_NOW, lineNumber));
      return;
    }
    // Resolve `now` from the parse-time today snapshot stored on
    // `options.today` (single source — see parsePert entry).
    options.anchor = { kind: 'forward', date: options.today };
    return;
  }

  // Liberal input → canonical ISO (§ BL-121): slash / month-name / bare-year
  // forms resolve here; a bare month-day derives its year via the ladder.
  // Anchors need a specific day, so a full (day-grain) date is required.
  const res = parseDateToken(trimmed, { dateOrder: dateCfg.order });
  if (
    res?.consumed !== trimmed.length ||
    res.token.invalidTime ||
    res.token.grain < 3
  ) {
    diagnostics.push(emit(PERT_DX.INVALID_DATE, lineNumber, { trimmed, key }));
    return;
  }
  let year = res.token.year;
  if (year == null) {
    if (dateCfg.baseYear == null && dateCfg.noCurrentYear) {
      diagnostics.push(
        emit(PERT_DX.INVALID_DATE, lineNumber, { trimmed, key })
      );
      return;
    }
    year = dateCfg.baseYear ?? dateCfg.currentYear;
  }
  // Calendar-validity check (parseDateToken is range-lenient): reject 2026-13-99,
  // Feb 30, etc. so PERT keeps its strict anchor diagnostics.
  const probe = new Date(year, res.token.month - 1, res.token.day);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== res.token.month - 1 ||
    probe.getDate() !== res.token.day
  ) {
    diagnostics.push(emit(PERT_DX.INVALID_DATE, lineNumber, { trimmed, key }));
    return;
  }
  const iso = toInternal(res.token, year);

  options.anchor =
    key === 'start-date'
      ? { kind: 'forward', date: iso }
      : { kind: 'backward', date: iso };
}

function classifyGroup(
  group: PertGroup,
  edges: PertEdge[]
): 'hammock' | 'cluster' {
  const members = new Set(group.activityIds);
  if (members.size === 0) return 'cluster';

  const entries = new Set<string>();
  const exits = new Set<string>();

  for (const id of members) {
    const incoming = edges.filter((e) => e.target === id);
    const outgoing = edges.filter((e) => e.source === id);
    const hasInsideIn = incoming.some((e) => members.has(e.source));
    const hasOutsideIn = incoming.some((e) => !members.has(e.source));
    const hasInsideOut = outgoing.some((e) => members.has(e.target));
    const hasOutsideOut = outgoing.some((e) => !members.has(e.target));
    if (hasOutsideIn || (!hasInsideIn && incoming.length === 0))
      entries.add(id);
    if (hasOutsideOut || (!hasInsideOut && outgoing.length === 0))
      exits.add(id);
  }

  return entries.size === 1 && exits.size === 1 ? 'hammock' : 'cluster';
}

// ============================================================
// extractPertSymbols — for editor autocomplete
// ============================================================

export function extractPertSymbols(docText: string): DiagramSymbols {
  const parsed = parsePert(docText);
  const entities: string[] = [];
  for (const a of parsed.activities) {
    if (!entities.includes(a.name)) entities.push(a.name);
    if (a.alias && !entities.includes(a.alias)) entities.push(a.alias);
  }
  for (const g of parsed.groups) {
    if (!entities.includes(g.name)) entities.push(g.name);
  }
  return {
    kind: 'pert',
    entities,
  };
}

// ============================================================
// looksLikePert — content-inference heuristic
// ============================================================

/**
 * Returns true when content lacks an explicit chart type but reads as a
 * PERT diagram. Per spec § Implementation Decisions: drop the
 * "three-number durations" heuristic (too generic) — require any of:
 *   (a) literal `pert` chart-type line (already handled by parseFirstLine)
 *   (b) an `analysis monte-carlo` directive
 *
 * This function is for case (b) inference — case (a) is handled upstream.
 */
export function looksLikePert(content: string): boolean {
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    if (/^analysis\s+monte-carlo\b/i.test(line)) return true;
  }
  return false;
}

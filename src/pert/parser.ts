// ============================================================
// PERT Parser — two-pass
// ============================================================
//
// Pass 1: scan source line-by-line, collect declarations, references,
//         groups, milestones. Indent-tracked state machine, no
//         resolution.
// Pass 2: resolve aliases → canonical ids; classify groups (hammock vs
//         cluster); detect conflicts; emit diagnostics.
//
// See `_bmad-output/implementation-artifacts/tech-spec-pert.md`
// for the design rationale; AC1.* for the contract this parser meets.

import { makeDgmoError, suggest } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import { parseDuration } from '../utils/duration';
import { measureIndent } from '../utils/parsing';
import { normalizeName } from '../utils/name-normalize';
import type { Duration, DurationUnit } from '../gantt/types';
import type {
  ParsedPert,
  PertActivity,
  PertEdge,
  PertGroup,
  PertOptions,
  PertDirection,
  NodeDetail,
} from './types';
import type {
  DurationEstimate,
  DeclarationSite,
  ReferenceSite,
} from './internal';
import type { DiagramSymbols } from '../completion';

// ============================================================
// Regexes / constants
// ============================================================

/** Bare directive lines accepted at the diagram level. */
const DIRECTIVE_KEYS = new Set([
  'time-unit',
  'confidence',
  'direction',
  'node-detail',
  'analysis',
  'trials',
  'seed',
  'scrubber-trials',
]);

/** Group header: `[name]` with optional `| collapsed: true` etc. */
const GROUP_HEADER_RE = /^\[([^\]]+)\]\s*(?:\|\s*(.+))?$/;

/** Inline reference / forward-decl: `-> rest…` */
const ARROW_RE = /^->\s*(.+?)\s*$/;

/** Trailing `as <ident>` (alias) suffix; `<ident>` ≤ 12 chars. */
const ALIAS_SUFFIX_RE = /\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/;

/**
 * Numeric-with-optional-unit token. The unit set matches `parseDuration()`
 * (h/min/d/bd/w/m/q/y/s). A bare number falls back to `timeUnit`.
 */
const ESTIMATE_TOKEN_RE = /^(\d+(?:\.\d+)?)(min|bd|d|w|m|q|y|h|s)?$/;

/** Default options when nothing is declared. */
const DEFAULT_OPTIONS: PertOptions = {
  timeUnit: 'd',
  direction: 'LR',
  nodeDetail: 'compact',
  confidence: 'medium',
  analysis: 'none',
  trials: 10000,
  seed: 1,
  scrubberTrials: 300,
};

// ============================================================
// Utility helpers
// ============================================================

/** Trim a `#` line-leading comment off the END of a line. */
function stripTrailingComment(line: string): string {
  // Only strip when `#` is preceded by whitespace; preserves names that
  // happen to contain `#` literally (none in PERT today, but cheap).
  const m = line.match(/^(.*?)\s+#.*$/);
  return (m ? m[1] : line).trimEnd();
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
  return { head: trimmed.slice(0, m.index!).trim(), alias: m[1] };
}

/**
 * Split a line into name and duration-token portions, plus an optional
 * trailing alias and pipe-metadata block. The split point is the first
 * token that parses as a numeric estimate token.
 *
 * Returns `{ name, durationTokens, alias?, pipeMetadata? }`.
 */
function tokenizeActivityLine(line: string): {
  name: string;
  durationTokens: string[];
  alias?: string;
  pipeMetadata?: string;
} {
  // Split off pipe metadata first (`name | k: v, k2: v2`).
  let body = line;
  let pipeMetadata: string | undefined;
  const pipeIdx = body.indexOf('|');
  if (pipeIdx >= 0) {
    pipeMetadata = body.slice(pipeIdx + 1).trim();
    body = body.slice(0, pipeIdx).trim();
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
    if (ESTIMATE_TOKEN_RE.test(rawTokens[i])) {
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
  const amount = parseFloat(m[1]);
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
    diagnose(
      `Expected 1 (M) or 3 (O M P) durations; got 2 (${tokens.join(' ')}). ` +
        `Did you mean '${tokens[0]} ${(parseFloat(tokens[0]) + parseFloat(tokens[1])) / 2} ${tokens[1]}'?`
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
    if (dur.amount <= 0) {
      diagnose(`Duration must be > 0; got '${t}'.`);
      return null;
    }
    parsed.push(dur);
  }

  if (parsed.length === 1) {
    // M-only — analyzer expands using confidence factors. Stash M in
    // all three slots; the `mOnly` flag (not value-equality) is the
    // sentinel, so a literal "1 1 1" triple is correctly preserved.
    return { o: parsed[0], m: parsed[0], p: parsed[0], mOnly: true };
  }

  // 3-tuple — validate O ≤ M ≤ P (after unit-normalization on amounts).
  const [o, m, p] = parsed;
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
 * PERT only consumes one key in v1 (`confidence`, plus `collapsed` on
 * groups), but we parse the full surface for forward-compat.
 */
function parsePipeMetadata(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim().toLowerCase();
    const value = trimmed.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

// ============================================================
// parsePert
// ============================================================

export function parsePert(content: string): ParsedPert {
  const lines = content.split('\n');
  const diagnostics: DgmoError[] = [];
  const error = (line: number, msg: string): void => {
    diagnostics.push(makeDgmoError(line, msg, 'error'));
  };
  const warn = (line: number, msg: string): void => {
    diagnostics.push(makeDgmoError(line, msg, 'warning'));
  };

  const options: PertOptions = { ...DEFAULT_OPTIONS };
  let title: string | null = null;

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
  const groups: PertGroup[] = [];

  /** Stack of (groupId, indent) — the group at the bottom is the open one. */
  type GroupFrame = { groupId: string; indent: number };
  const groupStack: GroupFrame[] = [];
  const currentGroupId = (): string | undefined =>
    groupStack.length > 0
      ? groupStack[groupStack.length - 1].groupId
      : undefined;

  /** Tracks the most recent activity declaration line (for `-> dest` source). */
  let currentSourceName: string | null = null;
  /** Indent of currentSourceName — used to pop on dedent. */
  let currentSourceIndent = -1;

  let pastFirstLine = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNumber = i + 1;
    const trimmed = stripTrailingComment(rawLine).trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    const indent = measureIndent(rawLine);

    // Pop any group frames whose indent ≥ this line's indent (block closes).
    while (groupStack.length > 0) {
      const top = groupStack[groupStack.length - 1];
      if (indent <= top.indent) groupStack.pop();
      else break;
    }
    // Ditto for current source: indented `->` lines must be deeper than the source.
    if (
      currentSourceIndent >= 0 &&
      indent <= currentSourceIndent &&
      !trimmed.startsWith('->')
    ) {
      currentSourceName = null;
      currentSourceIndent = -1;
    }

    // ── First line: `pert [title]` (chart-type declaration).
    if (!pastFirstLine) {
      pastFirstLine = true;
      const tokens = trimmed.split(/\s+/);
      const head = tokens[0].toLowerCase();
      if (head === 'pert') {
        if (tokens.length > 1) title = tokens.slice(1).join(' ');
        continue;
      }
      // No explicit `pert` line — fall through; the diagram may be
      // inferred via `looksLikePert`. We don't error here; the dispatch
      // layer is responsible for routing.
    }

    // ── Group header: `[group-name] | collapsed: true`.
    const groupMatch = trimmed.match(GROUP_HEADER_RE);
    if (groupMatch) {
      const name = groupMatch[1].trim();
      const meta = groupMatch[2] ? parsePipeMetadata(groupMatch[2]) : {};
      const id = `[${normalizeName(name)}]`;
      groups.push({
        id,
        name,
        activityIds: [],
        collapsed: meta.collapsed === 'true',
        lineNumber,
      });
      groupStack.push({ groupId: id, indent });
      currentSourceName = null;
      currentSourceIndent = -1;
      continue;
    }

    // ── Indented arrow line: `-> dest [durations] [as <id>] [| meta]`.
    if (trimmed.startsWith('->')) {
      const arrowMatch = trimmed.match(ARROW_RE);
      if (!arrowMatch) {
        error(lineNumber, `Malformed arrow line: '${trimmed}'.`);
        continue;
      }
      if (!currentSourceName) {
        error(
          lineNumber,
          `'-> ${arrowMatch[1]}' has no source — declare an activity above on a non-indented line.`
        );
        continue;
      }
      const tok = tokenizeActivityLine(arrowMatch[1]);
      const targetName = tok.name;
      if (!targetName) {
        error(lineNumber, `'-> …' is missing a target name.`);
        continue;
      }
      references.push({
        sourceName: currentSourceName,
        sourceLineNumber: -1, // resolved in Pass 2 from declarations
        targetName,
        targetLineNumber: lineNumber,
      });

      // Inline forward-decl: register a tentative declaration if the
      // line carries duration tokens or an alias. Pass 2 will demote
      // it to a reference if the target turns out to already be declared.
      if (tok.durationTokens.length > 0 || tok.alias !== undefined) {
        const site: DeclarationSite = {
          name: targetName,
          ...(tok.alias !== undefined && { alias: tok.alias }),
          durationTokens: tok.durationTokens,
          ...(tok.pipeMetadata !== undefined && {
            pipeMetadata: tok.pipeMetadata,
          }),
          lineNumber,
          inline: true,
          ...(currentGroupId() !== undefined && {
            groupHint: currentGroupId(),
          }),
          isMilestone: false,
        };
        registerSite(site);
      }
      continue;
    }

    // ── `milestone <name>` primitive.
    {
      const milestoneMatch = trimmed.match(/^milestone\s+(.+?)\s*$/i);
      if (milestoneMatch) {
        const name = milestoneMatch[1].trim();
        const peeled = peelAlias(name);
        const site: DeclarationSite = {
          name: peeled.head,
          ...(peeled.alias !== undefined && { alias: peeled.alias }),
          durationTokens: [],
          lineNumber,
          inline: false,
          ...(currentGroupId() !== undefined && {
            groupHint: currentGroupId(),
          }),
          isMilestone: true,
        };
        registerSite(site);
        currentSourceName = peeled.head;
        currentSourceIndent = indent;
        continue;
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
        applyDirective(head, value, lineNumber, options, error, warn);
        continue;
      }
    }

    // ── Activity declaration: `<name> <durs?> [as <id>] [| meta]`.
    {
      const tok = tokenizeActivityLine(trimmed);
      if (!tok.name) {
        error(lineNumber, `Empty activity name: '${trimmed}'.`);
        continue;
      }

      // Bare source-line referencing an existing alias: don't register a
      // duplicate activity — just point currentSource at the canonical
      // name so subsequent `-> dest` lines attach correctly.
      const isBareSource =
        tok.durationTokens.length === 0 &&
        tok.alias === undefined &&
        tok.pipeMetadata === undefined;
      if (isBareSource && declarationsByAlias.has(tok.name)) {
        currentSourceName = declarationsByAlias.get(tok.name)!.name;
        currentSourceIndent = indent;
        continue;
      }

      const site: DeclarationSite = {
        name: tok.name,
        ...(tok.alias !== undefined && { alias: tok.alias }),
        durationTokens: tok.durationTokens,
        ...(tok.pipeMetadata !== undefined && {
          pipeMetadata: tok.pipeMetadata,
        }),
        lineNumber,
        inline: false,
        ...(currentGroupId() !== undefined && { groupHint: currentGroupId() }),
        isMilestone: false,
      };
      registerSite(site);
      currentSourceName = tok.name;
      currentSourceIndent = indent;
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
      error(
        explicit[0].lineNumber,
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
      existing.durationTokens.length > 0 ||
      existing.alias !== undefined ||
      existing.isMilestone;
    const incomingHasInfo =
      decl.durationTokens.length > 0 ||
      decl.alias !== undefined ||
      decl.isMilestone;
    if (!existingHasInfo && incomingHasInfo) {
      bestDeclByName.set(key, decl);
    }
  }

  const activitiesById = new Map<string, PertActivity>();
  for (const [id, decl] of bestDeclByName) {
    const estimate = decl.isMilestone
      ? milestoneEstimate(options.timeUnit)
      : buildEstimate(decl.durationTokens, options.timeUnit, (msg) =>
          error(decl.lineNumber, msg)
        );
    const meta = decl.pipeMetadata ? parsePipeMetadata(decl.pipeMetadata) : {};
    activitiesById.set(id, {
      id,
      name: decl.name,
      ...(decl.alias !== undefined && { alias: decl.alias }),
      duration: decl.isMilestone
        ? milestoneEstimate(options.timeUnit)
        : estimate,
      ...(meta.confidence && { confidence: meta.confidence }),
      ...(decl.groupHint !== undefined && { groupId: decl.groupHint }),
      lineNumber: decl.lineNumber,
      isMilestone: decl.isMilestone,
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
  const activities: PertActivity[] = [];
  for (const decl of allDeclarations) {
    const id = canonicalIdFromDeclaration(decl);
    if (seen.has(id)) continue;
    seen.add(id);
    const a = activitiesById.get(id);
    if (a) activities.push(a);
  }

  const firstFatal = diagnostics.find((d) => d.severity === 'error');
  return {
    title,
    options,
    activities,
    edges,
    groups,
    idMap,
    diagnostics,
    error: firstFatal ? firstFatal.message : null,
  };
}

// ============================================================
// Helpers continued
// ============================================================

function milestoneEstimate(unit: DurationUnit): DurationEstimate {
  const dur: Duration = { amount: 0, unit };
  return { o: dur, m: dur, p: dur, mOnly: false };
}

function applyDirective(
  key: string,
  value: string,
  lineNumber: number,
  options: PertOptions,
  error: (line: number, msg: string) => void,
  warn: (line: number, msg: string) => void
): void {
  switch (key) {
    case 'time-unit': {
      const valid: DurationUnit[] = ['min', 'h', 'd', 'bd', 'w', 'm', 'q', 'y'];
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
    case 'confidence': {
      // Verbatim — `resolveConfidence` validates at analyzer time.
      options.confidence = value || 'medium';
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
    case 'analysis': {
      if (value !== 'monte-carlo') {
        error(lineNumber, `Unknown analysis '${value}'. Expected monte-carlo.`);
        return;
      }
      options.analysis = 'monte-carlo';
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
  }
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
    keywords: [
      'time-unit',
      'confidence',
      'direction',
      'node-detail',
      'analysis',
      'monte-carlo',
      'trials',
      'seed',
      'scrubber-trials',
      'milestone',
      'as',
    ],
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
 *   (b) a `milestone <name>` directive
 *   (c) an `analysis monte-carlo` directive
 *
 * This function is for case (b) / (c) inference — case (a) is handled
 * upstream.
 */
export function looksLikePert(content: string): boolean {
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    if (/^milestone\s+\S/i.test(line)) return true;
    if (/^analysis\s+monte-carlo\b/i.test(line)) return true;
  }
  return false;
}

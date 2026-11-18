// ============================================================
// Ownership chart parser — corporate entity structure (#1873)
// ============================================================
//
//   ownership Acme group structure
//   tag Jurisdiction as j
//     UK blue
//     US red
//
//   Acme Holdings plc  j: UK
//     Listed on the LSE
//     100% Acme Inc  j: US
//       60% Acme Labs LLC  j: US, type: partnership
//     100% Acme BV  j: NL
//       90% Acme GmbH
//   Partner Fund LP  type: partnership
//     40% -> Acme Labs LLC
//
// An indented line under an entity is read in this order: `NN% Name` declares
// a subsidiary owned at that stake; `NN% -> Name` adds an owner link to an
// entity declared elsewhere (a cross-holding, or an outside owner's stake); a
// `key: value` line whose key is reserved (`type`) or a tag alias is metadata;
// any other line is free description. The first top-level entity that declares
// a subsidiary is the root of the group; every other top-level entity, and
// what it declares, is outside the group.

import type { PaletteColors } from '../palettes';
import { withPaletteLifted } from '../palettes/directive';
import {
  emit,
  formatDgmoError,
  makeDgmoError,
  makeFail,
  suggest,
} from '../diagnostics';
import type {
  DgmoError,
  DiagnosticParams,
  DiagnosticSpec,
} from '../diagnostics';
import type { Writable } from '../utils/brand';
import {
  parseChartFrameLine,
  takeFootnoteBlock,
} from '../utils/chart-frame-parse';
import { normalizeName } from '../utils/name-normalize';
import {
  extractColor,
  measureIndent,
  parseFirstLine,
  parseMetadataRegion,
  peelQuotedName,
  splitNameAndMeta,
  warnUnknownMetaKeys,
} from '../utils/parsing';
import {
  OWNERSHIP_REGISTRY,
  withTagAliases,
} from '../utils/reserved-key-registry';
import {
  activeTagNoMatchMessage,
  AUTO_TAG_COLOR_SENTINEL,
  finalizeAutoTagColors,
  matchTagBlockHeading,
  stripDefaultModifier,
  tagAttrKey,
  validateTagGroupNames,
  validateTagValues,
} from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import { OWNERSHIP_DX } from './diagnostics';
import { layoutOwnership } from './layout';
import { ENTITY_TYPES } from './types';
import type {
  EntityType,
  OwnershipEntity,
  OwnershipLink,
  ParsedOwnership,
} from './types';

const VALUE_OPTIONS = new Set(['active-tag', 'palette']);
const BOOLEAN_OPTIONS = new Set([
  'fill-tint',
  'fill-solid',
  'fill-outline',
  'no-title',
  'no-legend',
  'legend-inline',
]);
const FILL_OPTIONS = ['fill-tint', 'fill-solid', 'fill-outline'];

/** `60%`, `33.3%`, then the rest of the line. */
const STAKE_RE = /^([+-]?\d*\.?\d+)\s*%\s*(.*)$/;
/** `key: …` with a single-word key. */
const META_LINE_RE = /^([A-Za-z_][\w-]*)\s*:/;
/** Sums are compared with this slack, so 33.3 + 33.3 + 33.4 is 100. */
const SUM_EPSILON = 1e-6;

/** `60` → `60`, `33.30` → `33.3`. */
export function formatPct(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

type MutableEntity = Writable<OwnershipEntity> & {
  metadata: Record<string, string>;
  description: string[];
};

export function parseOwnership(
  content: string,
  palette?: PaletteColors
): ParsedOwnership {
  return withPaletteLifted(content, (lifted) =>
    parseOwnershipRaw(lifted, palette)
  );
}

function parseOwnershipRaw(
  content: string,
  palette?: PaletteColors
): ParsedOwnership {
  const options: Record<string, string> = {};
  const result: Writable<ParsedOwnership> & { diagnostics: DgmoError[] } = {
    type: 'ownership',
    entities: [],
    links: [],
    rootId: null,
    tagGroups: [],
    options,
    diagnostics: [],
    error: null,
  };
  const diagnostics = result.diagnostics;
  const fail = makeFail(result);

  const report = (
    spec: DiagnosticSpec,
    line: number,
    params: DiagnosticParams
  ): void => {
    const diag = emit(spec, line, params);
    diagnostics.push(diag);
    if (diag.severity === 'error') result.error ??= formatDgmoError(diag);
  };
  const warn = (line: number, message: string, code?: string): void => {
    diagnostics.push(makeDgmoError(line, message, 'warning', code));
  };

  if (!content?.trim()) return fail(0, 'No content provided');

  const lines = content.split('\n');
  // The footnote block and its markdown body (#2093), before any line is read.
  takeFootnoteBlock(result, lines, diagnostics);
  const metaAliasMap = new Map<string, string>();
  const tagGroups = result.tagGroups as Writable<TagGroup>[];
  const entities: MutableEntity[] = [];
  const byName = new Map<string, MutableEntity>();
  /** Tree links (`NN% Name`); arrow links resolve after every line is read. */
  const links: Writable<OwnershipLink>[] = [];
  const pendingArrows: {
    owner: MutableEntity;
    name: string;
    pct: number;
    pctText: string;
    lineNumber: number;
  }[] = [];
  const stack: { entity: MutableEntity; indent: number }[] = [];
  let firstLineSeen = false;
  let contentStarted = false;
  let currentTagGroup: Writable<TagGroup> | null = null;
  let activeTagLine = 0;
  let linkCounter = 0;

  const registry = (): ReturnType<typeof withTagAliases> =>
    withTagAliases(OWNERSHIP_REGISTRY, new Set(metaAliasMap.keys()));

  /** `type: x` → the entity type, reporting an unknown value. */
  const applyType = (
    entity: MutableEntity,
    value: string,
    lineNumber: number
  ): void => {
    const v = value.trim().toLowerCase();
    if ((ENTITY_TYPES as readonly string[]).includes(v)) {
      entity.type = v as EntityType;
      return;
    }
    report(OWNERSHIP_DX.BAD_TYPE, lineNumber, {
      value: value.trim(),
      hint: suggest(v, ENTITY_TYPES) ?? undefined,
    });
  };

  const applyMeta = (
    entity: MutableEntity,
    meta: Record<string, string>,
    lineNumber: number
  ): void => {
    for (const [rawKey, value] of Object.entries(meta)) {
      const key = metaAliasMap.get(rawKey) ?? rawKey;
      if (key === 'type') applyType(entity, value, lineNumber);
      else entity.metadata[key] = value;
    }
  };

  /** Read an entity line (`Name  j: UK, type: trust`) into a new entity. */
  const declareEntity = (
    text: string,
    lineNumber: number,
    treeParent: MutableEntity | null
  ): MutableEntity | null => {
    const reg = registry();
    const split = splitNameAndMeta(
      text,
      reg,
      metaAliasMap,
      undefined,
      diagnostics,
      lineNumber,
      { peelAlias: false }
    );
    warnUnknownMetaKeys(
      split.meta,
      reg,
      (msg) => warn(lineNumber, msg),
      split.name
    );
    const peeled = peelQuotedName(split.name);
    // An entity has no colour slot: a trailing colour word stays in the name.
    const name = (
      split.color !== undefined ? `${peeled} ${split.color}` : peeled
    ).trim();
    if (!name) {
      report(OWNERSHIP_DX.MISSING_NAME, lineNumber, { line: text });
      return null;
    }
    const key = normalizeName(name);
    const existing = byName.get(key);
    if (existing) {
      report(OWNERSHIP_DX.DUPLICATE_ENTITY, lineNumber, {
        name,
        first: existing.lineNumber,
      });
      return null;
    }
    const entity: MutableEntity = {
      id: `e${entities.length + 1}`,
      name,
      type: 'corporation',
      metadata: {},
      description: [],
      outside: false,
      treeParentId: treeParent?.id ?? null,
      lineNumber,
    };
    applyMeta(entity, split.meta, lineNumber);
    entities.push(entity);
    byName.set(key, entity);
    return entity;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNumber = i + 1;
    const trimmed = line.trim();

    if (!trimmed) {
      currentTagGroup = null;
      continue;
    }
    if (trimmed.startsWith('//')) continue;

    if (!firstLineSeen) {
      firstLineSeen = true;
      const firstLine = parseFirstLine(trimmed);
      if (firstLine) {
        if (firstLine.chartType !== 'ownership') {
          let msg = `Expected chart type "ownership", got "${firstLine.chartType}"`;
          const hint = suggest(firstLine.chartType, ['ownership']);
          if (hint) msg += `. ${hint}`;
          return fail(lineNumber, msg);
        }
        if (firstLine.title) {
          result.title = firstLine.title;
          result.titleLineNumber = lineNumber;
        }
        continue;
      }
    }

    if (parseChartFrameLine(result, line, lineNumber, diagnostics)) {
      currentTagGroup = null;
      continue;
    }

    const indent = measureIndent(line);

    // ── Header: tag groups and options ──────────────────────
    if (currentTagGroup && !contentStarted) {
      if (indent > 0) {
        const { text, isDefault } = stripDefaultModifier(trimmed);
        const { label, color } = extractColor(
          text,
          palette,
          diagnostics,
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

    if (indent === 0 && !contentStarted) {
      const heading = matchTagBlockHeading(trimmed);
      if (heading) {
        currentTagGroup = {
          name: heading.name,
          ...(heading.alias !== undefined && { alias: heading.alias }),
          entries: [],
          lineNumber,
        };
        if (heading.alias) {
          metaAliasMap.set(
            normalizeName(heading.alias),
            tagAttrKey(heading.name)
          );
        }
        metaAliasMap.set(normalizeName(heading.name), tagAttrKey(heading.name));
        tagGroups.push(currentTagGroup);
        continue;
      }
      const space = trimmed.search(/\s/);
      const keyword = (
        space < 0 ? trimmed : trimmed.slice(0, space)
      ).toLowerCase();
      const rest = space < 0 ? '' : trimmed.slice(space + 1).trim();
      if (BOOLEAN_OPTIONS.has(keyword) && !rest) {
        // The fill family is mutually exclusive (§1.9): the last one wins.
        if (FILL_OPTIONS.includes(keyword))
          for (const f of FILL_OPTIONS) delete options[f];
        options[keyword] = 'on';
        continue;
      }
      if (VALUE_OPTIONS.has(keyword) && rest) {
        options[keyword] = rest;
        if (keyword === 'active-tag') activeTagLine = lineNumber;
        continue;
      }
    }

    // ── Content ─────────────────────────────────────────────
    contentStarted = true;
    currentTagGroup = null;

    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }
    const parent = stack.length > 0 ? stack[stack.length - 1]!.entity : null;

    const stake = STAKE_RE.exec(trimmed);
    const metaKey = META_LINE_RE.exec(trimmed)?.[1]?.toLowerCase();
    const isMetaLine =
      metaKey !== undefined &&
      (metaKey === 'type' || metaAliasMap.has(normalizeName(metaKey)));
    if (indent === 0 || !parent) {
      // A stake or a reserved `key: value` needs an entity above it; any other
      // top-level line is an entity, colon and all ("Dr. Smith: Trustee").
      if (stake || isMetaLine || indent > 0) {
        report(OWNERSHIP_DX.ORPHAN_LINE, lineNumber, { line: trimmed });
        continue;
      }
      const entity = declareEntity(trimmed, lineNumber, null);
      if (entity) stack.push({ entity, indent });
      continue;
    }

    if (stake) {
      const pctText = stake[1]!;
      const pct = Number(pctText);
      const rest = stake[2]!.trim();
      if (!(pct > 0 && pct <= 100)) {
        report(OWNERSHIP_DX.BAD_STAKE, lineNumber, { stake: `${pctText}%` });
        continue;
      }
      if (rest.startsWith('->')) {
        const name = peelQuotedName(rest.slice(2).trim());
        if (!name) {
          report(OWNERSHIP_DX.MISSING_NAME, lineNumber, { line: trimmed });
          continue;
        }
        pendingArrows.push({
          owner: parent,
          name,
          pct,
          pctText: formatPct(pct),
          lineNumber,
        });
        continue;
      }
      if (!rest) {
        report(OWNERSHIP_DX.MISSING_NAME, lineNumber, { line: trimmed });
        continue;
      }
      const child = declareEntity(rest, lineNumber, parent);
      if (!child) continue;
      links.push({
        id: `l${++linkCounter}`,
        ownerId: parent.id,
        ownedId: child.id,
        pct,
        pctText: formatPct(pct),
        arrow: false,
        lineNumber,
      });
      stack.push({ entity: child, indent });
      continue;
    }

    if (isMetaLine) {
      applyMeta(
        parent,
        parseMetadataRegion(trimmed, metaAliasMap, diagnostics, lineNumber),
        lineNumber
      );
      continue;
    }

    // Anything else is free description, one line per source line.
    parent.description.push(trimmed);
  }

  if (result.error !== null && entities.length === 0) return result;

  // ── Arrow links, now that every entity is known ────────────
  const names = entities.map((e) => e.name);
  for (const arrow of pendingArrows) {
    const target = byName.get(normalizeName(arrow.name));
    if (!target) {
      report(OWNERSHIP_DX.UNKNOWN_ENTITY, arrow.lineNumber, {
        name: arrow.name,
        hint: suggest(arrow.name, names) ?? undefined,
      });
      continue;
    }
    if (target === arrow.owner) {
      report(OWNERSHIP_DX.SELF_LINK, arrow.lineNumber, { name: target.name });
      continue;
    }
    links.push({
      id: `l${++linkCounter}`,
      ownerId: arrow.owner.id,
      ownedId: target.id,
      pct: arrow.pct,
      pctText: arrow.pctText,
      arrow: true,
      lineNumber: arrow.lineNumber,
    });
  }

  // One link per owner and owned entity.
  const seenPairs = new Map<string, Writable<OwnershipLink>>();
  const byId = new Map(entities.map((e) => [e.id, e]));
  const kept: Writable<OwnershipLink>[] = [];
  for (const link of links) {
    const key = `${link.ownerId}>${link.ownedId}`;
    const first = seenPairs.get(key);
    if (first) {
      report(OWNERSHIP_DX.DUPLICATE_LINK, link.lineNumber, {
        owner: byId.get(link.ownerId)!.name,
        owned: byId.get(link.ownedId)!.name,
        first: first.lineNumber,
      });
      continue;
    }
    seenPairs.set(key, link);
    kept.push(link);
  }
  kept.sort((a, b) => a.lineNumber - b.lineNumber);

  if (entities.length === 0) {
    if (result.error === null) report(OWNERSHIP_DX.NO_ENTITIES, 1, {});
    return result;
  }

  // ── The group: the root's tree; the rest is outside ────────
  const topLevel = entities.filter((e) => e.treeParentId === null);
  const root =
    topLevel.find((e) => kept.some((l) => !l.arrow && l.ownerId === e.id)) ??
    topLevel[0]!;
  const treeRootOf = (e: MutableEntity): MutableEntity => {
    let cur = e;
    while (cur.treeParentId !== null) cur = byId.get(cur.treeParentId)!;
    return cur;
  };
  for (const e of entities) e.outside = treeRootOf(e) !== root;
  result.rootId = root.id;

  // ── Owners summing over 100% ───────────────────────────────
  const totals = new Map<string, number>();
  for (const link of kept)
    totals.set(link.ownedId, (totals.get(link.ownedId) ?? 0) + link.pct);
  for (const e of entities) {
    const total = totals.get(e.id) ?? 0;
    if (total > 100 + SUM_EPSILON) {
      report(OWNERSHIP_DX.OVER_100, e.lineNumber, {
        entity: e.name,
        total: formatPct(total),
      });
    }
  }

  // ── Cycles (each reported once, at the link that closes it) ─
  const out = new Map<string, Writable<OwnershipLink>[]>();
  for (const link of kept) {
    const list = out.get(link.ownerId) ?? [];
    list.push(link);
    out.set(link.ownerId, list);
  }
  const state = new Map<string, 1 | 2>();
  const path: string[] = [];
  const visit = (id: string): void => {
    state.set(id, 1);
    path.push(id);
    for (const link of out.get(id) ?? []) {
      const s = state.get(link.ownedId);
      if (s === 1) {
        const start = path.indexOf(link.ownedId);
        const cycle = [...path.slice(start), link.ownedId]
          .map((n) => byId.get(n)!.name)
          .join(' → ');
        report(OWNERSHIP_DX.CYCLE, link.lineNumber, { cycle });
      } else if (s === undefined) visit(link.ownedId);
    }
    path.pop();
    state.set(id, 2);
  };
  visit(root.id);
  for (const e of entities) if (!state.has(e.id)) visit(e.id);

  result.entities = entities;
  result.links = kept;

  // ── Tags ───────────────────────────────────────────────────
  finalizeAutoTagColors(tagGroups, palette);
  validateTagValues(entities, tagGroups, warn, suggest);
  validateTagGroupNames(tagGroups, warn, (line, msg) => {
    const diag = makeDgmoError(line, msg);
    diagnostics.push(diag);
    result.error ??= formatDgmoError(diag);
  });
  const activeTagWarning = activeTagNoMatchMessage(
    options['active-tag'],
    tagGroups
  );
  if (activeTagWarning) {
    warn(activeTagLine || 1, activeTagWarning, 'W_ACTIVE_TAG_NO_MATCH');
  }

  // ── Crossings the structure forces (routing rule 4) ────────
  if (result.error === null) {
    const layout = layoutOwnership(result);
    for (const crossing of layout.crossings) {
      const a = kept.find((l) => l.id === crossing.a)!;
      const b = kept.find((l) => l.id === crossing.b)!;
      const describe = (l: OwnershipLink): string =>
        `${byId.get(l.ownerId)!.name} → ${byId.get(l.ownedId)!.name} (${l.pctText}%)`;
      report(
        OWNERSHIP_DX.FORCED_CROSSING,
        Math.max(a.lineNumber, b.lineNumber),
        {
          a: describe(a),
          b: describe(b),
        }
      );
    }
  }

  return result;
}

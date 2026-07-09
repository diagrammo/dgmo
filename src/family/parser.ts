// ============================================================
// Family Diagram (genealogy) — Parser
// ============================================================
//
// Grammar (source of truth: `docs/dgmo-language-spec.md` §32):
//   family [Title]
//   tag <Group> as <a> …            // optional tag groups (§1.3)
//   <Person> [metadata]             // standalone person (metadata carrier)
//   <PersonA> + <PersonB> [m: year] // union line (a couple)
//     <Child> [adopted] [metadata]  //   children indented underneath
//   <Person>                        // single parent = lone person + indented kids
//     <Child>
//
// There is NO `looksLikeFamily` content sniffer — the explicit `family` first
// line is required (recent-type convention). Detection is via `parseFirstLine`
// (ALL_CHART_TYPES) in the router.
//
// Union split (load-bearing): union-level metadata (`m`) is cut off the END
// FIRST via `cutUnionMetadata` (FAMILY_UNION_REGISTRY = only `m`), THEN ` + ` is
// split within the remaining NAME region only — so a ` + ` inside a quoted name
// (`"Anne + Jack"`) or inside a metadata value never mis-splits. Each side is a
// bare name (quote / `as`-alias / trailing color); per-side key:value metadata
// is NOT supported (declare persons standalone).

import { emit, type DgmoError } from '../diagnostics';
import { FAMILY_DX } from './diagnostics';
import {
  measureIndent,
  parseFirstLine,
  splitNameAndMeta,
  cutUnionMetadata,
  extractColor,
  peelTrailingColorName,
  tokenizeQuoteAware,
  stripQuotes,
  tryParseSharedOption,
} from '../utils/parsing';
import {
  FAMILY_PERSON_REGISTRY,
  FAMILY_UNION_REGISTRY,
  withTagAliases,
  isReservedKey,
} from '../utils/reserved-key-registry';
import { normalizeName, displayName } from '../utils/name-normalize';
import { resolveColor, nord } from '../colors';
import {
  matchTagBlockHeading,
  stripDefaultModifier,
  finalizeAutoTagColors,
  AUTO_TAG_COLOR_SENTINEL,
  tagAttrKey,
  type TagGroup,
} from '../utils/tag-groups';
import type { Writable } from '../utils/brand';
import type { PaletteColors } from '../palettes';
import { buildCoupleQuotient } from './couple-rank';
import type {
  ParsedFamily,
  FamilyPerson,
  FamilyUnion,
  FamilyChild,
  FamilySex,
} from './types';

/** Mutable person accumulator (frozen into FamilyPerson at the end). */
interface MutablePerson {
  id: string;
  label: string;
  sex: FamilySex;
  metadata: Record<string, string>;
  color?: string;
  tagMetadata: Record<string, string>;
  lineNumber: number;
}

function normKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Quote-aware split of a union name region on standalone ` + ` tokens. */
function splitUnionSides(nameRegion: string): string[] {
  const tokens = tokenizeQuoteAware(nameRegion);
  const sides: string[] = [];
  let cur: string[] = [];
  for (const tok of tokens) {
    if (tok === '+') {
      sides.push(cur.join(' '));
      cur = [];
    } else {
      cur.push(tok);
    }
  }
  sides.push(cur.join(' '));
  return sides;
}

export function parseFamily(
  content: string,
  palette?: PaletteColors
): ParsedFamily {
  const diagnostics: DgmoError[] = [];
  const persons = new Map<string, MutablePerson>();
  const unions: FamilyUnion[] = [];
  const tagGroups: Writable<TagGroup>[] = [];
  const options: Record<string, string> = {};

  const rawLines = content.split('\n');

  // ── First line: chart type + title ──────────────────────────
  let title: string | undefined;
  let titleLineNumber: number | undefined;
  let startIdx = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const t = rawLines[i]!.trim();
    if (!t || t.startsWith('//')) continue;
    const fl = parseFirstLine(rawLines[i]!);
    if (fl?.chartType === 'family') {
      title = fl.title;
      titleLineNumber = i + 1;
    }
    startIdx = i + 1;
    break;
  }

  // ── Pass 1: tag groups + bare options (top-level, before content) ──
  const metaAliasMap = new Map<string, string>();
  const aliasKeys = new Set<string>();
  let currentTagGroup: Writable<TagGroup> | null = null;
  let sawContent = false;
  for (let i = startIdx; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const lineNum = i + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const indent = measureIndent(raw);

    const tagMatch = matchTagBlockHeading(trimmed);
    if (tagMatch && indent === 0 && !sawContent) {
      const newGroup: Writable<TagGroup> = {
        name: tagMatch.name,
        ...(tagMatch.alias !== undefined && { alias: tagMatch.alias }),
        entries: [],
        lineNumber: lineNum,
      };
      currentTagGroup = newGroup;
      const attr = tagAttrKey(tagMatch.name);
      metaAliasMap.set(normKey(tagMatch.name), attr);
      aliasKeys.add(normKey(tagMatch.name));
      if (tagMatch.alias) {
        metaAliasMap.set(normKey(tagMatch.alias), attr);
        aliasKeys.add(normKey(tagMatch.alias));
      }
      if (tagMatch.inlineValues) {
        for (const rawVal of tagMatch.inlineValues) {
          const { text, isDefault } = stripDefaultModifier(rawVal);
          const { label, color } = extractColor(
            text,
            palette,
            diagnostics,
            lineNum
          );
          newGroup.entries.push({
            value: label,
            color: color ?? AUTO_TAG_COLOR_SENTINEL,
            lineNumber: lineNum,
          });
          if (isDefault) newGroup.defaultValue = label;
        }
        if (!newGroup.defaultValue && newGroup.entries.length > 0) {
          newGroup.defaultValue = newGroup.entries[0]!.value;
        }
      }
      tagGroups.push(newGroup);
      continue;
    }
    if (currentTagGroup && indent > 0 && !sawContent) {
      const { text, isDefault } = stripDefaultModifier(trimmed);
      const { label, color } = extractColor(
        text,
        palette,
        diagnostics,
        lineNum
      );
      currentTagGroup.entries.push({
        value: label,
        color: color ?? AUTO_TAG_COLOR_SENTINEL,
        lineNumber: lineNum,
      });
      if (isDefault || currentTagGroup.entries.length === 1) {
        currentTagGroup.defaultValue = label;
      }
      continue;
    }
    if (indent === 0) currentTagGroup = null;

    // Bare shared options (solid-fill, no-title, …).
    if (indent === 0 && tryParseSharedOption(trimmed, options)) continue;

    // First real content line ends tag/option collection.
    if (indent === 0 && !tagMatch) sawContent = true;
  }

  const personRegistry = withTagAliases(FAMILY_PERSON_REGISTRY, aliasKeys);
  const tagAttrKeys = new Set(tagGroups.map((g) => tagAttrKey(g.name)));

  // ── Person get-or-create + metadata merge ───────────────────
  const aliasMap = new Map<string, string>(); // normalized alias → canonical id
  const getPerson = (rawName: string, lineNum: number): MutablePerson => {
    const aliasHit = aliasMap.get(normalizeName(rawName));
    const id = aliasHit ?? normalizeName(rawName);
    let p = persons.get(id);
    if (!p) {
      p = {
        id,
        label: displayName(rawName),
        sex: 'unknown',
        metadata: {},
        tagMetadata: {},
        lineNumber: lineNum,
      };
      persons.set(id, p);
    }
    return p;
  };

  /** Apply parsed metadata/color to a person, splitting fixed vs tag vs unknown. */
  const applyMeta = (
    p: MutablePerson,
    meta: Record<string, string>,
    color: string | undefined,
    lineNum: number
  ): void => {
    if (color !== undefined && p.color === undefined) p.color = color;
    for (const [k, v] of Object.entries(meta)) {
      if (k === 'sex') {
        const s = v.trim().toLowerCase();
        const sex: FamilySex = s === 'm' ? 'm' : s === 'f' ? 'f' : 'unknown';
        if (sex !== 'unknown' && p.sex === 'unknown') p.sex = sex;
        continue;
      }
      if (tagAttrKeys.has(k)) {
        p.tagMetadata[k] = v;
        continue;
      }
      if (isReservedKey(FAMILY_PERSON_REGISTRY, k)) {
        const prev = p.metadata[k];
        if (prev !== undefined && prev !== v) {
          diagnostics.push(
            emit(FAMILY_DX.DUPLICATE_METADATA, lineNum, {
              key: k,
              old: prev,
              new: v,
            })
          );
          continue; // keep first
        }
        p.metadata[k] = v;
        continue;
      }
      diagnostics.push(emit(FAMILY_DX.UNKNOWN_KEY, lineNum, { key: k }));
    }
  };

  /**
   * Parse a person reference (one union side, a child, or a standalone person).
   * Returns the person + whether the line carried a trailing `adopted` token.
   * `allowAdopted` gates the adoption strip to child lines only.
   */
  const parsePersonRef = (
    segment: string,
    lineNum: number,
    allowAdopted: boolean
  ): { person: MutablePerson; adopted: boolean } => {
    const {
      name,
      meta,
      color: rawColor,
      alias,
    } = splitNameAndMeta(
      segment,
      personRegistry,
      metaAliasMap,
      palette,
      diagnostics,
      lineNum
    );
    let cleanName = name.replace(/,\s*$/, '').trim();
    let color = rawColor;
    let adopted = false;
    if (allowAdopted) {
      const toks = tokenizeQuoteAware(cleanName);
      if (
        toks.length >= 2 &&
        toks[toks.length - 1] === 'adopted' // unquoted bare token
      ) {
        adopted = true;
        cleanName = toks.slice(0, -1).join(' ');
        // Re-peel a color that sat before `adopted` (`Carol red adopted`). Use
        // the RAW-name peel so `color` stays a raw name (the FamilyPerson.color
        // contract), matching the `Carol adopted red` path — not a resolved hex.
        const re = peelTrailingColorName(cleanName);
        if (re.colorName !== undefined) {
          cleanName = re.label;
          if (color === undefined) color = re.colorName;
        }
      }
    }
    // An unknown `key:` that splitNameAndMeta did NOT cut (not a reserved key)
    // lingers in the name region — warn and trim it off (skip quoted names).
    // Only when the key sits AFTER a name (index > 0); a leading `word:` at
    // index 0 would erase the whole name, so leave it intact as a literal name.
    if (!/^["']/.test(cleanName)) {
      const um = cleanName.match(/\b([A-Za-z][\w-]*)\s*:/);
      if (
        um?.index !== undefined &&
        um.index > 0 &&
        !isReservedKey(personRegistry, um[1]!.toLowerCase())
      ) {
        diagnostics.push(
          emit(FAMILY_DX.UNKNOWN_KEY, lineNum, { key: um[1]!.toLowerCase() })
        );
        cleanName = cleanName.slice(0, um.index).trim();
      }
    }
    cleanName = stripQuotes(cleanName.trim());
    const person = getPerson(cleanName, lineNum);
    if (alias !== undefined) aliasMap.set(normalizeName(alias), person.id);
    applyMeta(person, meta, color, lineNum);
    return { person, adopted };
  };

  // ── Pass 2: content (persons, unions, children) ─────────────
  // Scope stack: each entry is a union/person whose indented lines are its
  // children. A person-scope creates its single-parent union lazily on first
  // child (so a childless standalone person never spawns an empty union).
  interface Scope {
    indent: number;
    personId?: string; // person-scope (potential single parent)
    unionId?: string; // union-scope (children attach here)
    singleParentUnionId?: string; // lazily created for a person-scope
  }
  const stack: Scope[] = [];
  let unionSeq = 0;
  const unionById = new Map<string, Writable<FamilyUnion>>();

  const makeUnion = (
    parents: string[],
    metadata: Record<string, string>,
    lineNum: number
  ): Writable<FamilyUnion> => {
    const u: Writable<FamilyUnion> = {
      id: `u${unionSeq++}`,
      parents,
      metadata,
      children: [] as FamilyChild[],
      lineNumber: lineNum,
    };
    unions.push(u);
    unionById.set(u.id, u);
    return u;
  };

  const attachChild = (
    parentScope: Scope,
    childId: string,
    adopted: boolean,
    lineNum: number
  ): void => {
    let unionId = parentScope.unionId;
    if (!unionId) {
      // person-scope → lazily create its single-parent union.
      if (!parentScope.singleParentUnionId) {
        const u = makeUnion([parentScope.personId!], {}, lineNum);
        parentScope.singleParentUnionId = u.id;
      }
      unionId = parentScope.singleParentUnionId;
    }
    const u = unionById.get(unionId)!;
    (u.children as FamilyChild[]).push({ personId: childId, adopted });
  };

  let inTagBlock = false;
  for (let i = startIdx; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const lineNum = i + 1;
    let trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const cIdx = trimmed.indexOf(' //');
    if (cIdx > 0) trimmed = trimmed.slice(0, cIdx).trim();
    if (!trimmed) continue;
    const indent = measureIndent(raw);

    // Skip pass-1 declarations (tags + bare options).
    if (indent === 0 && matchTagBlockHeading(trimmed)) {
      inTagBlock = true;
      continue;
    }
    if (indent === 0) inTagBlock = false;
    if (inTagBlock && indent > 0) continue;
    if (indent === 0 && tryParseSharedOption(trimmed, {})) continue;

    // Pop scopes shallower-or-equal to this line's indent.
    while (stack.length && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }
    const parentScope = stack.length ? stack[stack.length - 1]! : null;

    // A child line indented with no scope above → error (but still register the
    // person so downstream refs resolve).
    // Detect union vs person: cut union-level metadata FIRST, then split ` + `.
    const cut = cutUnionMetadata(trimmed, FAMILY_UNION_REGISTRY);
    const nameRegion = cut < 0 ? trimmed : trimmed.slice(0, cut).trimEnd();
    const metaRegion = cut < 0 ? '' : trimmed.slice(cut);
    const rawSides = splitUnionSides(nameRegion);
    const hadPlus = rawSides.length >= 2;
    // Empty operands (`Anne +`, `+ Bob`, `A + + B`) never become phantom
    // persons — drop the blanks, then decide on the REAL operand count.
    const sides = rawSides.map((s) => s.trim()).filter((s) => s !== '');

    if (hadPlus && sides.length >= 2) {
      // ── Union line ──
      let parentSides = sides;
      if (sides.length > 2) {
        diagnostics.push(
          emit(FAMILY_DX.TOO_MANY_PARENTS, lineNum, {
            count: sides.length,
            line: nameRegion,
          })
        );
        parentSides = sides.slice(0, 2);
      }
      const unionMeta: Record<string, string> = {};
      if (metaRegion) {
        const { meta } = splitNameAndMeta(
          metaRegion,
          withTagAliases(FAMILY_UNION_REGISTRY, new Set()),
          new Map(),
          palette,
          diagnostics,
          lineNum
        );
        for (const [k, v] of Object.entries(meta)) {
          if (k === 'm') unionMeta['m'] = v;
          else
            diagnostics.push(emit(FAMILY_DX.UNKNOWN_KEY, lineNum, { key: k }));
        }
      }
      const parentPersons = parentSides.map(
        (s) => parsePersonRef(s, lineNum, false).person
      );
      if (
        parentPersons.length === 2 &&
        parentPersons[0]!.id === parentPersons[1]!.id
      ) {
        diagnostics.push(
          emit(FAMILY_DX.SELF_UNION, lineNum, {
            name: parentPersons[0]!.label,
          })
        );
      }
      // If this union is nested under a scope, the LEFT parent descends from it
      // (bloodline-left convention). Flat remarriage needs no nesting.
      if (parentScope) {
        attachChild(parentScope, parentPersons[0]!.id, false, lineNum);
      }
      const u = makeUnion(
        parentPersons.map((p) => p.id),
        unionMeta,
        lineNum
      );
      stack.push({ indent, unionId: u.id });
    } else if (hadPlus) {
      // ── Malformed union: a `+` with a blank side (`Anne +`, `+ Bob`) ──
      diagnostics.push(
        emit(FAMILY_DX.MISSING_OPERAND, lineNum, { line: nameRegion })
      );
      // Best effort: if a single real operand remains, keep it as a person so
      // any indented children still attach; otherwise skip the line entirely.
      if (sides.length === 1) {
        const isChild = parentScope !== null;
        const { person, adopted } = parsePersonRef(sides[0]!, lineNum, isChild);
        if (parentScope) attachChild(parentScope, person.id, adopted, lineNum);
        stack.push({ indent, personId: person.id });
      }
    } else {
      // ── Person line (standalone, child, or single parent) ──
      const isChild = parentScope !== null;
      const { person, adopted } = parsePersonRef(trimmed, lineNum, isChild);
      if (parentScope) {
        attachChild(parentScope, person.id, adopted, lineNum);
      } else if (indent > 0) {
        // Indented but no scope above → orphaned child.
        diagnostics.push(emit(FAMILY_DX.CHILD_OUTSIDE_UNION, lineNum, {}));
      }
      // Push as a scope so its own indented children (single-parent) attach.
      stack.push({ indent, personId: person.id });
    }
  }

  finalizeAutoTagColors(tagGroups, palette);

  // Synthesize a first-class "Sex" tag group when any `sex:` is defined, so sex
  // colouring flows through the STANDARD tag-group legend framework (pills,
  // active capsule, hover-dim) exactly like a user tag group — instead of a
  // bespoke sex legend. It's inserted FIRST so it is the default-active group.
  const SEX_META: Record<
    FamilySex,
    [label: string, colorName: string, hex: string]
  > = {
    m: ['Male', 'blue', nord.nord10],
    f: ['Female', 'purple', nord.nord15],
    unknown: ['Unknown', 'gray', nord.nord3],
  };
  const anySex = [...persons.values()].some((p) => p.sex !== 'unknown');
  if (anySex) {
    const present = new Set([...persons.values()].map((p) => p.sex));
    const order: FamilySex[] = ['m', 'f', 'unknown'];
    const entries = order
      .filter((s) => present.has(s))
      .map((s) => {
        const [label, colorName, fallback] = SEX_META[s];
        return {
          value: label,
          color: resolveColor(colorName, palette) ?? fallback,
          lineNumber: 0,
        };
      });
    // Tag every person with its sex label so hover-dim + active colouring work
    // (unknowns match the Unknown entry, not the default).
    for (const p of persons.values()) p.tagMetadata['sex'] = SEX_META[p.sex][0];
    const sexGroup: Writable<TagGroup> = {
      name: 'Sex',
      entries,
      defaultValue: entries[0]!.value,
      lineNumber: 0,
    };
    tagGroups.unshift(sexGroup);
  }

  // Freeze persons.
  const frozenPersons = new Map<string, FamilyPerson>();
  for (const [id, p] of persons) {
    frozenPersons.set(id, {
      id: p.id,
      label: p.label,
      sex: p.sex,
      metadata: p.metadata,
      ...(p.color !== undefined && { color: p.color }),
      tagMetadata: p.tagMetadata,
      lineNumber: p.lineNumber,
    });
  }

  // ── Ancestry cycle = quotient cycle (fatal; renderer bails on error) ──
  let error: string | null = null;
  const quotient = buildCoupleQuotient(frozenPersons, unions);
  if (quotient.cycle) {
    const diag = emit(FAMILY_DX.ANCESTRY_CYCLE, 0, {});
    diagnostics.push(diag);
    error = diag.message;
  }

  return {
    ...(title !== undefined && { title }),
    ...(titleLineNumber !== undefined && { titleLineNumber }),
    persons: frozenPersons,
    unions,
    tagGroups,
    options,
    diagnostics,
    error,
  };
}

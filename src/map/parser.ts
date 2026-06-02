// Parser for the `map` chart type (spec §24B): source lines → raw AST.
// PURE — no name resolution, no rendering, no data-asset access. Implements the
// single-pass deterministic line classification of §24B.10. See the tech-spec
// at _bmad-output/implementation-artifacts/tech-spec-map-parser.md.
import { makeDgmoError, formatDgmoError } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import type { Writable } from '../utils/brand';
import {
  measureIndent,
  splitNameAndMeta,
  extractColor,
  peelTrailingColorName,
} from '../utils/parsing';
import {
  MAP_REGISTRY,
  withTagAliases,
  type ReservedKeyRegistry,
} from '../utils/reserved-key-registry';
import {
  matchTagBlockHeading,
  emitTagLegacyDiagnostic,
  stripDefaultModifier,
  validateTagGroupNames,
} from '../utils/tag-groups';
import { parseInArrowLabel } from '../utils/arrows';
import type {
  ParsedMap,
  MapDirectives,
  MapRegion,
  MapPoi,
  MapRoute,
  MapRouteLeg,
  MapEdge,
  PoiPos,
  MapScale,
} from './types';
import type { TagGroup, TagEntry } from '../utils/tag-groups';

const COORD_RE = /^[+-]?\d+(?:\.\d+)?\s+[+-]?\d+(?:\.\d+)?$/;
const NUMERIC_LEAD_RE = /^[+-]?\d/; // a name region that starts like a number
const SCOPE_RE = /^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/;
// Arrow tokens (longest-match first); only recognized with surrounding
// whitespace, so hyphens inside names (`office-east`) and `foo-bar` are safe.
const ARROW_SPLIT = /\s+(-[^>]*?->|->|~[^>]*?~>|~>|--)\s+/;
const HUB_RE = /^(->|~>)\s+(.+)$/;
// A route leg line: an optional leading arrow (with in-arrow label) + a destination.
const LEG_ARROW_RE = /^(-[^>]*?->|->|~[^>]*?~>|~>|--)\s+(.+)$/;
const AT_RE = /(^|[\s,])at\s*:/i; // the removed `at:` coord form (§24B.9)

const DIRECTIVE_SET: ReadonlySet<string> = new Set([
  'projection',
  'region-metric',
  'poi-metric',
  'flow-metric',
  'scale',
  'region-labels',
  'poi-labels',
  'locale',
  'active-tag',
  'no-legend',
  'relief',
  'surface',
  'subtitle',
  'caption',
]);

/** True when the first non-blank/non-comment line declares `map`. */
export function looksLikeMap(content: string): boolean {
  for (const raw of content.split('\n')) {
    const t = stripInlineComment(raw).trim();
    if (!t || t.startsWith('//')) continue;
    return /^map(\s|$)/.test(t);
  }
  return false;
}

/** Strip a trailing/`//`-leading line comment (dgmo convention) without eating
 *  `http://`-style substrings (require start-of-line or preceding whitespace). */
function stripInlineComment(line: string): string {
  return line
    .replace(/(^|\s)\/\/.*$/, (_m, p1: string) => p1)
    .replace(/\s+$/, '');
}

export function parseMap(content: string): ParsedMap {
  const result: Writable<ParsedMap> = {
    title: null,
    titleLineNumber: null,
    directives: {} as MapDirectives,
    tagGroups: [],
    regions: [],
    pois: [],
    routes: [],
    edges: [],
    options: {},
    diagnostics: [],
    error: null,
  };
  const diagnostics = result.diagnostics as DgmoError[];

  const pushError = (line: number, message: string, code?: string): void => {
    diagnostics.push(makeDgmoError(line, message, 'error', code));
    result.error ??= formatDgmoError(diagnostics[diagnostics.length - 1]!);
  };
  const fail = (line: number, message: string): ParsedMap => {
    pushError(line, message);
    return result;
  };
  const pushWarning = (line: number, message: string): void => {
    diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  const lines = content.split('\n');

  // ── First line: declaration + title (hand-rolled; `map` isn't in
  //    ALL_CHART_TYPES, so parseFirstLine can't be used — R1). ──
  let firstIdx = 0;
  while (firstIdx < lines.length) {
    const t = stripInlineComment(lines[firstIdx]!).trim();
    if (t && !t.startsWith('//')) break;
    firstIdx++;
  }
  const firstLine = stripInlineComment(lines[firstIdx] ?? '').trim();
  const firstTok = firstLine.split(/\s+/)[0] ?? '';
  if (firstTok !== 'map') {
    return fail(
      firstIdx + 1,
      `Expected chart type "map" on the first line, got "${firstTok || '(empty)'}"`
    );
  }
  const titleText = firstLine.slice(3).trim();
  if (titleText) {
    result.title = titleText;
    result.titleLineNumber = firstIdx + 1;
  }

  // ── Mutable parse state ──
  const tagGroups = result.tagGroups as Writable<TagGroup>[];
  const regions = result.regions as MapRegion[];
  const pois = result.pois as MapPoi[];
  const routes = result.routes as MapRoute[];
  const edges = result.edges as MapEdge[];
  const aliasMap = new Map<string, string>(); // tag alias → group name (lowercased)

  // Holder object (property access avoids TS narrowing closure-mutated `let`s
  // to `never`). `tag`/`route`/`poi` are the currently-open blocks.
  const open: {
    tag: Writable<TagGroup> | null;
    route: { route: Writable<MapRoute>; indent: number } | null;
    poi: { poi: Writable<MapPoi>; indent: number } | null;
  } = { tag: null, route: null, poi: null };

  const registry = (): ReservedKeyRegistry =>
    withTagAliases(MAP_REGISTRY, new Set(aliasMap.keys()));
  // Declared tag-group names (lowercased) — the keys `partitionMeta` treats as
  // tag values (resolved from aliases). Recomputed as groups are declared.
  const tagGroupNames = (): ReadonlySet<string> =>
    new Set(tagGroups.map((g) => g.name.toLowerCase()));

  const closeBlocks = (): void => {
    open.tag = null;
    open.route = null;
    open.poi = null;
  };

  for (let i = firstIdx + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineNumber = i + 1;
    const cleaned = stripInlineComment(raw);
    const trimmed = cleaned.trim();
    const indent = measureIndent(raw);

    // A blank line does NOT close an open block — closing only happens on a
    // dedent to/below the block's indent (#10: a stray blank mid-route must not
    // silently truncate it). Full-line comments are likewise transparent.
    if (!trimmed || trimmed.startsWith('//')) continue;

    // (1) Indented child of an open tag block → an entry (must run BEFORE
    //     closeBlocks, else the entry falls through to a region-fill).
    if (open.tag && indent > 0) {
      addTagEntry(open.tag, trimmed, lineNumber);
      continue;
    }
    // (1a) Indented child of an open route → a leg (an edge from the prev stop).
    if (open.route && indent > open.route.indent) {
      const leg = parseLeg(
        trimmed,
        lineNumber,
        open.route.route.style,
        open.route.route.surface
      );
      (open.route.route.legs as MapRouteLeg[]).push(leg);
      continue;
    }
    // (1b) Indented child of an open POI → hub edge or extra metadata.
    if (open.poi && indent > open.poi.indent) {
      const hub = trimmed.match(HUB_RE);
      if (hub) {
        const src = open.poi.poi.alias ?? poiName(open.poi.poi.pos);
        if (src) {
          edges.push({
            from: src,
            to: hub[2]!.trim(),
            directed: true,
            style: hub[1] === '~>' ? 'arc' : 'straight',
            meta: {},
            lineNumber,
          });
        }
        continue;
      }
      const split = splitNameAndMeta(trimmed, registry(), aliasMap);
      if (Object.keys(split.meta).length && !split.name) {
        Object.assign(open.poi.poi.meta as Record<string, string>, split.meta);
        continue;
      }
      // not a recognized child → fall through after closing the POI
    }

    // Dedent / non-child line: close open blocks before classifying (gotcha).
    closeBlocks();

    const firstWord = trimmed.split(/\s+/)[0]!;

    // (2) Keyword lines.
    if (firstWord === 'tag') {
      handleTag(trimmed, lineNumber);
      continue;
    }
    if (
      DIRECTIVE_SET.has(firstWord) &&
      !trimmed.slice(firstWord.length).trimStart().startsWith(':')
    ) {
      handleDirective(
        firstWord,
        trimmed.slice(firstWord.length).trim(),
        lineNumber
      );
      continue;
    }
    if (firstWord === 'poi') {
      handlePoi(trimmed.slice(3).trim(), lineNumber, indent);
      continue;
    }
    if (firstWord === 'route') {
      handleRoute(trimmed.slice(5).trim(), lineNumber, indent);
      continue;
    }

    // (4) Edge line (contains a whitespace-delimited arrow / `--`).
    if (ARROW_SPLIT.test(' ' + trimmed + ' ') || ARROW_SPLIT.test(trimmed)) {
      handleEdges(trimmed, lineNumber);
      continue;
    }

    // (5) Fallthrough → region-fill.
    handleRegion(trimmed, lineNumber);
  }

  // ── Post-parse validation (all groups now known). ──
  validateTagGroupNames(tagGroups, pushWarning, (line, m) =>
    pushError(line, m)
  );
  const at = result.directives.activeTag;
  if (at && at.toLowerCase() !== 'none') {
    const names = tagGroupNames();
    if (!names.has(at.toLowerCase())) {
      const hint = tagGroups.length
        ? ` Declared groups: ${tagGroups.map((g) => g.name).join(', ')}.`
        : ' No tag groups are declared.';
      pushWarning(
        0,
        `active-tag "${at}" does not match a declared tag group.${hint}`
      );
    }
  }

  return result;

  // ──────────────────────────── handlers ────────────────────────────

  function handleDirective(key: string, value: string, line: number): void {
    const d = result.directives as MapDirectives;
    const dup = (have: unknown): void => {
      if (have !== undefined)
        pushWarning(line, `Duplicate directive "${key}" — last value wins.`);
    };
    switch (key) {
      case 'projection':
        dup(d.projection);
        if (
          value &&
          ![
            'equirectangular',
            'natural-earth',
            'albers-usa',
            'mercator',
          ].includes(value)
        )
          pushWarning(
            line,
            `Unknown projection "${value}" (expected equirectangular | natural-earth | albers-usa | mercator).`
          );
        d.projection = value;
        break;
      case 'region-metric': {
        dup(d.regionMetric);
        // A trailing color names the choropleth ramp hue (§24B.3): the
        // label keeps the rest. `region-metric Sales ($M) blue` → blue ramp.
        const { label: rmLabel, colorName: rmColor } =
          peelTrailingColorName(value);
        d.regionMetric = rmLabel;
        if (rmColor) d.regionMetricColor = rmColor;
        break;
      }
      case 'poi-metric':
        dup(d.poiMetric);
        d.poiMetric = value;
        break;
      case 'flow-metric':
        dup(d.flowMetric);
        d.flowMetric = value;
        break;
      case 'scale':
        dup(d.scale);
        {
          const s = parseScale(value, line);
          if (s) d.scale = s;
        }
        break;
      case 'region-labels':
        dup(d.regionLabels);
        if (value && !['full', 'abbrev', 'off'].includes(value))
          pushWarning(
            line,
            `Unknown region-labels "${value}" (expected full | abbrev | off).`
          );
        d.regionLabels = value;
        break;
      case 'poi-labels':
        dup(d.poiLabels);
        if (value && !['off', 'auto', 'all'].includes(value))
          pushWarning(
            line,
            `Unknown poi-labels "${value}" (expected off | auto | all).`
          );
        d.poiLabels = value;
        break;
      case 'locale':
        dup(d.locale);
        d.locale = value;
        break;
      case 'active-tag':
        dup(d.activeTag);
        d.activeTag = value;
        break;
      case 'no-legend':
        d.noLegend = true;
        break;
      case 'relief':
        // Bare flag (idempotent — `relief\nrelief` is no warning).
        d.relief = true;
        break;
      case 'surface':
        dup(d.surface);
        if (value === 'water' || value === 'land') d.surface = value;
        else
          pushWarning(
            line,
            `Unknown surface "${value}" (expected water | land).`
          );
        break;
      case 'subtitle':
        dup(d.subtitle);
        d.subtitle = value;
        break;
      case 'caption':
        dup(d.caption);
        d.caption = value;
        break;
    }
  }

  function parseScale(value: string, line: number): MapScale | null {
    const toks = value.split(/\s+/).filter(Boolean);
    const min = Number(toks[0]);
    const max = Number(toks[1]);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      pushError(line, `scale requires numeric <min> <max> (got "${value}").`);
      return null;
    }
    // `center <n>` (diverging ramp) is a future seam (§24B.12) — not parsed in v1.
    return { min, max };
  }

  function handleTag(trimmed: string, line: number): void {
    const m = matchTagBlockHeading(trimmed);
    if (!m) {
      pushError(line, `Malformed tag declaration: "${trimmed}".`);
      return;
    }
    emitTagLegacyDiagnostic(m, line, diagnostics);
    const group: Writable<TagGroup> = {
      name: m.name,
      ...(m.alias !== undefined && { alias: m.alias }),
      entries: [],
      lineNumber: line,
    };
    if (m.alias) aliasMap.set(m.alias.toLowerCase(), m.name.toLowerCase());
    tagGroups.push(group);
    open.tag = group;
    // Inline form: `tag Market as m HQ indigo, Region teal` (R4).
    if (m.inlineValues?.length) {
      for (const seg of m.inlineValues) addTagEntry(group, seg.trim(), line);
      open.tag = null;
    }
  }

  function addTagEntry(
    group: Writable<TagGroup>,
    text: string,
    line: number
  ): void {
    const { text: clean, isDefault } = stripDefaultModifier(text);
    const { label, color } = extractColor(clean, undefined, diagnostics, line);
    if (!color) {
      pushError(line, `Expected 'Value color' in tag group '${group.name}'`);
      return;
    }
    const entries = group.entries as TagEntry[];
    if (isDefault || entries.length === 0) group.defaultValue = label;
    entries.push({ value: label, color, lineNumber: line });
  }

  function handleRegion(trimmed: string, line: number): void {
    if (AT_RE.test(trimmed))
      pushError(
        line,
        'Coordinates are positional, not `at:` — write region names bare and POIs as `poi <lat> <lon>`.'
      );
    const split = splitNameAndMeta(
      trimmed,
      registry(),
      aliasMap,
      undefined,
      diagnostics,
      line
    );
    const { tags, meta } = partitionMeta(split.meta, tagGroupNames());
    let valueNum: number | undefined;
    const value = meta['value'];
    if (value !== undefined) {
      delete (meta as Record<string, string>)['value']; // lifted out of meta
      valueNum = Number(value);
      if (!Number.isFinite(valueNum)) {
        pushError(line, `value must be a number (got "${value}").`);
        valueNum = undefined;
      }
    }
    // A region may carry BOTH a `value:` and a tag value — they are two
    // selectable colouring dimensions (the legend flips between the value ramp
    // and the tag group), so this is no longer warned (bivariate is handled).
    // Peel a trailing ISO scope token (§24B.8) — same qualifier POIs accept,
    // so `Georgia US-GA` / `Georgia US` can force the country-vs-state pick.
    let regionName = split.name;
    let regionScope: string | undefined;
    const rToks = regionName.split(/\s+/);
    const rLast = rToks[rToks.length - 1]!;
    if (rToks.length > 1 && SCOPE_RE.test(rLast)) {
      regionName = rToks.slice(0, -1).join(' ');
      regionScope = rLast;
    }
    const region: Writable<MapRegion> = {
      name: regionName,
      tags,
      meta,
      lineNumber: line,
    };
    if (regionScope !== undefined) region.scope = regionScope;
    if (valueNum !== undefined) region.value = valueNum;
    // §1.5 trailing color → flat categorical override fill (§24B.4).
    if (split.color) region.color = split.color;
    regions.push(region);
  }

  function handlePoi(rest: string, line: number, indent: number): void {
    if (AT_RE.test(rest))
      pushError(
        line,
        'Coordinates are positional, not `at:` — write `poi <lat> <lon>`.'
      );
    const split = splitNameAndMeta(
      rest,
      registry(),
      aliasMap,
      undefined,
      diagnostics,
      line
    );
    const pos = parsePos(split.name, line);
    if (!pos) return; // error already pushed
    const { tags, meta } = partitionMeta(split.meta, tagGroupNames());
    const label = meta['label']; // label lifted out of meta; `value` (→ marker size) stays in meta
    if (label !== undefined) delete (meta as Record<string, string>)['label'];
    const poi: Writable<MapPoi> = { pos, tags, meta, lineNumber: line };
    if (split.alias) poi.alias = split.alias;
    if (label !== undefined) poi.label = label;
    // §1.5 trailing color → flat marker fill (§24B.5); wins over a tag color.
    if (split.color) poi.color = split.color;
    pois.push(poi);
    open.poi = { poi, indent };
  }

  function handleRoute(rest: string, line: number, indent: number): void {
    const split = rest
      ? splitNameAndMeta(
          rest,
          registry(),
          aliasMap,
          undefined,
          diagnostics,
          line
        )
      : { name: '', meta: {} as Record<string, string>, alias: undefined };
    const pos = parsePos(split.name, line);
    if (!pos || (pos.kind === 'name' && !pos.name)) {
      pushError(
        line,
        'route requires an origin: `route <origin> [style: arc]`.'
      );
      return;
    }
    const { tags, meta } = partitionMeta(split.meta, tagGroupNames());
    const originLabel = meta['label'];
    const originValue = meta['value'];
    const surface = parseSurface(meta['surface'], line);
    // `surface:` implies arc (F9) — a straight leg has no bow to move.
    const style: 'straight' | 'arc' =
      meta['style'] === 'arc' || surface !== undefined ? 'arc' : 'straight';
    const route: Writable<MapRoute> = {
      origin: pos,
      ...(split.alias !== undefined && { originAlias: split.alias }),
      ...(originLabel !== undefined && { originLabel }),
      ...(originValue !== undefined && { originValue }),
      originTags: tags,
      style,
      ...(surface !== undefined && { surface }),
      legs: [],
      lineNumber: line,
    };
    routes.push(route);
    open.route = { route, indent };
  }

  /** Validate a raw `surface:` value into the `water|land` union (else warn). */
  function parseSurface(
    raw: string | undefined,
    line: number
  ): 'water' | 'land' | undefined {
    if (raw === undefined) return undefined;
    if (raw === 'water' || raw === 'land') return raw;
    pushWarning(line, `Unknown surface "${raw}" (expected water | land).`);
    return undefined;
  }

  /** Parse one route body line into a leg: `[-label->] <destination> [keys]`.
   *  The arrow (if any) gives the leg label + shape; `value:` is leg thickness;
   *  a tag / `label:` decorate the destination stop. Bare `<dest>` = plain leg. */
  function parseLeg(
    trimmed: string,
    line: number,
    headerStyle: 'straight' | 'arc',
    headerSurface: 'water' | 'land' | undefined
  ): MapRouteLeg {
    let arrowStyle: 'straight' | 'arc' = 'straight';
    let label: string | undefined;
    let rest = trimmed;
    const m = trimmed.match(LEG_ARROW_RE);
    if (m) {
      const arr = classifyArrow(m[1]!, line);
      arrowStyle = arr.style;
      label = arr.label;
      rest = m[2]!;
    }
    const split = splitNameAndMeta(
      rest,
      registry(),
      aliasMap,
      undefined,
      diagnostics,
      line
    );
    const pos = parsePos(split.name, line) ?? {
      kind: 'name',
      name: split.name,
    };
    const { tags, meta } = partitionMeta(split.meta, tagGroupNames());
    const value = meta['value'];
    const destLabel = meta['label'];
    // Leg-level `surface:` overrides the route-header default (narrower wins).
    const legSurface = parseSurface(meta['surface'], line);
    const surface = legSurface ?? headerSurface;
    // `surface:` implies arc (F9) — at header or leg level.
    const style: 'straight' | 'arc' =
      arrowStyle === 'arc' || headerStyle === 'arc' || surface !== undefined
        ? 'arc'
        : 'straight';
    return {
      ...(label !== undefined && { label }),
      style,
      ...(surface !== undefined && { surface }),
      ...(value !== undefined && { value }),
      dest: pos,
      ...(split.alias !== undefined && { destAlias: split.alias }),
      ...(destLabel !== undefined && { destLabel }),
      destTags: tags,
      lineNumber: line,
    };
  }

  function handleEdges(trimmed: string, line: number): void {
    const parts = trimmed.split(ARROW_SPLIT);
    // parts = [ep0, tok0, ep1, tok1, ep2, ...]
    if (parts.length < 3) {
      pushError(line, `Malformed edge: "${trimmed}".`);
      return;
    }
    const endpoints: string[] = [];
    const links: {
      label?: string;
      directed: boolean;
      style: 'straight' | 'arc';
    }[] = [];
    for (let k = 0; k < parts.length; k++) {
      if (k % 2 === 0) endpoints.push(parts[k]!.trim());
      else links.push(classifyArrow(parts[k]!, line));
    }
    // Trailing metadata rides on the final endpoint only (R5), and attaches to
    // the FINAL leg only — not broadcast to every leg of a chain (#7).
    const lastSplit = splitNameAndMeta(
      endpoints[endpoints.length - 1]!,
      registry(),
      aliasMap
    );
    endpoints[endpoints.length - 1] = lastSplit.name;
    // Trailing `surface:` attaches to the FINAL hop only (mirrors value:/label: — F4).
    const lastSurface = parseSurface(lastSplit.meta['surface'], line);
    for (let k = 0; k < links.length; k++) {
      const from = endpoints[k]!;
      const to = endpoints[k + 1]!;
      if (!from || !to) {
        pushError(line, `Edge has an empty endpoint: "${trimmed}".`);
        continue;
      }
      const isLast = k === links.length - 1;
      const meta = isLast ? lastSplit.meta : {};
      const surface = isLast ? lastSurface : undefined;
      // `surface:` implies arc (F9).
      const style: 'straight' | 'arc' =
        links[k]!.style === 'arc' || surface !== undefined ? 'arc' : 'straight';
      edges.push({
        from,
        to,
        ...(links[k]!.label !== undefined && { label: links[k]!.label }),
        directed: links[k]!.directed,
        style,
        ...(surface !== undefined && { surface }),
        meta,
        lineNumber: line,
      });
    }
  }

  function classifyArrow(
    tok: string,
    line: number
  ): { label?: string; directed: boolean; style: 'straight' | 'arc' } {
    if (tok === '--') return { directed: false, style: 'straight' };
    if (tok === '->') return { directed: true, style: 'straight' };
    if (tok === '~>') return { directed: true, style: 'arc' };
    if (tok.startsWith('~')) {
      const lbl = parseInArrowLabel(tok.slice(1, -2), line);
      lbl.diagnostics.forEach((d) => diagnostics.push(d));
      return {
        ...(lbl.label !== undefined && { label: lbl.label }),
        directed: true,
        style: 'arc',
      };
    }
    // directed labeled `-…->`
    const lbl = parseInArrowLabel(tok.slice(1, -2), line);
    lbl.diagnostics.forEach((d) => diagnostics.push(d));
    return {
      ...(lbl.label !== undefined && { label: lbl.label }),
      directed: true,
      style: 'straight',
    };
  }

  /** Resolve a name region into a PoiPos (coords | name+scope), or null on error. */
  function parsePos(nameRegion: string, line: number): PoiPos | null {
    const n = nameRegion.trim();
    if (COORD_RE.test(n)) {
      const [latS, lonS] = n.split(/\s+/);
      const lat = Number(latS);
      const lon = Number(lonS);
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        pushError(
          line,
          `Coordinates out of range: lat ${lat}, lon ${lon} (lat ∈ [-90,90], lon ∈ [-180,180]).`
        );
        return null;
      }
      return { kind: 'coords', lat, lon };
    }
    if (NUMERIC_LEAD_RE.test(n)) {
      pushError(
        line,
        `Malformed coordinates "${n}" — expected "<lat> <lon>" (two signed numbers).`
      );
      return null;
    }
    // peel a trailing ISO scope token (§24B.8)
    const toks = n.split(/\s+/);
    const last = toks[toks.length - 1]!;
    if (toks.length > 1 && SCOPE_RE.test(last)) {
      return { kind: 'name', name: toks.slice(0, -1).join(' '), scope: last };
    }
    return { kind: 'name', name: n };
  }
}

/** Split metadata into tag-values (declared tag-group keys) vs everything else
 *  (inert/reserved/score, kept verbatim — nothing dropped). A key is a tag iff
 *  it's a declared tag-GROUP name (so a tag alias colliding with a reserved word
 *  still resolves as a tag — #3), avoiding a hardcoded set that drifts from
 *  MAP_REGISTRY. */
function partitionMeta(
  meta: Record<string, string>,
  tagGroupNames: ReadonlySet<string>
): { tags: Record<string, string>; meta: Record<string, string> } {
  const tags: Record<string, string> = {};
  const inert: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (tagGroupNames.has(k)) tags[k] = v;
    else inert[k] = v;
  }
  return { tags, meta: inert };
}

function poiName(pos: PoiPos): string | undefined {
  return pos.kind === 'name' ? pos.name : undefined;
}

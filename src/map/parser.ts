// Parser for the `map` chart type (spec §24B): source lines → raw AST.
// PURE — no name resolution, no rendering, no data-asset access. Implements the
// single-pass deterministic line classification of §24B.10. See the tech-spec
// at _bmad-output/implementation-artifacts/tech-spec-map-parser.md.
import { makeDgmoError, formatDgmoError } from '../diagnostics';
import { MAP_DIRECTIVE_KEY_SET } from '../directives-registry';
import type { DgmoError } from '../diagnostics';
import type { Writable } from '../utils/brand';
import type { PaletteColors } from '../palettes/types';
import {
  measureIndent,
  splitNameAndMeta,
  extractColor,
  peelRampColors,
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
  finalizeAutoTagColors,
  AUTO_TAG_COLOR_SENTINEL,
  tagAttrKey,
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
} from './types';
import type { TagGroup, TagEntry } from '../utils/tag-groups';

const COORD_RE = /^[+-]?\d+(?:\.\d+)?\s+[+-]?\d+(?:\.\d+)?$/;
const NUMERIC_LEAD_RE = /^[+-]?\d/; // a name region that starts like a number
const SCOPE_RE = /^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/;
// Arrow tokens (longest-match first); only recognized with surrounding
// whitespace, so hyphens inside names (`office-east`) and `foo-bar` are safe.
// Drop the trailing `>` to drop the arrowhead: `--`/`-label-` are undirected
// straight, `~~`/`~label~` undirected arc. `[^>]` excludes `>` so an undirected
// branch can never swallow a directed token; directed branches are listed first.
const ARROW_TOKENS = '-[^>]*?->|->|~[^>]*?~>|~>|-[^>]*?-|~[^>]*?~';
const ARROW_SPLIT = new RegExp(`\\s+(${ARROW_TOKENS})\\s+`);
const HUB_RE = new RegExp(`^(${ARROW_TOKENS})\\s+(.+)$`);
// A route leg line: an optional leading arrow (with in-arrow label) + a destination.
const LEG_ARROW_RE = new RegExp(`^(${ARROW_TOKENS})\\s+(.+)$`);
const AT_RE = /(^|[\s,])at\s*:/i; // the removed `at:` coord form (§24B.9)

// The 14 map-specific directives (§24B.2): 6 irreducible-intent + 8 `no-*`
// cosmetic opt-outs (every cosmetic on by default; its `no-*` flag is the only
// switch). Plus `no-title` — the universal banner-suppression flag (§1), wired
// in here so the map parser recognizes it rather than mis-parsing it as a region.
// Derived from the single-source directives registry; the anti-drift guard
// (tests/highlight-coverage.test.ts) cross-checks this vocab against the
// editor keyword sets.
export const MAP_DIRECTIVE_SET: ReadonlySet<string> = MAP_DIRECTIVE_KEY_SET;
const DIRECTIVE_SET = MAP_DIRECTIVE_SET;

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

export function parseMap(content: string, palette?: PaletteColors): ParsedMap {
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
  // Bespoke (not the shared makeFail, Story 111.4): map delegates to pushError,
  // which is first-error-wins (`??=`) and carries an optional diagnostic code.
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
    new Set(tagGroups.map((g) => tagAttrKey(g.name)));

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
      const leg = parseLeg(trimmed, lineNumber);
      if (leg) (open.route.route.legs as MapRouteLeg[]).push(leg);
      continue;
    }
    // (1b) Indented child of an open POI → hub edge or extra metadata.
    if (open.poi && indent > open.poi.indent) {
      const hub = trimmed.match(HUB_RE);
      if (hub) {
        const src = open.poi.poi.alias ?? poiName(open.poi.poi.pos);
        if (src) {
          const arr = classifyArrow(hub[1]!, lineNumber);
          const hubSplit = splitNameAndMeta(hub[2]!, registry(), aliasMap);
          const { tags, meta } = partitionMeta(hubSplit.meta, tagGroupNames());
          edges.push({
            from: src,
            to: hubSplit.name.trim(),
            ...(arr.label !== undefined && { label: arr.label }),
            directed: arr.directed,
            style: arr.style,
            meta,
            tags,
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
      // A named child line with no arrow is a hub edge missing its glyph (the
      // POI-hub mirror of a malformed route leg). Error here rather than letting
      // it fall through and be silently reinterpreted as a top-level region.
      if (split.name) {
        const src =
          open.poi.poi.alias ?? poiName(open.poi.poi.pos) ?? 'the poi';
        pushError(
          lineNumber,
          `Malformed hub edge: "${trimmed}" — an indented line under a poi is an edge from "${src}" and needs an arrow glyph (\`-> dest\`, \`~> dest\`, or labeled \`-label-> dest\`). For a standalone place, declare it at the top level. (§24B.5)`
        );
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

  // Assign palette colors to bare (colorless) tag values (all groups known).
  finalizeAutoTagColors(tagGroups, palette);

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
      case 'region-metric': {
        dup(d.regionMetric);
        // Up to two trailing colors name the choropleth ramp endpoints
        // (§24B.3): one ⇒ high hue over a neutral low; two ⇒ `low high`. The
        // label keeps the rest. `region-metric Sales ($M) green red` →
        // green→red ramp.
        const {
          label: rmLabel,
          low: rmLow,
          high: rmHigh,
        } = peelRampColors(value);
        d.regionMetric = rmLabel;
        if (rmHigh) d.regionMetricColor = rmHigh;
        if (rmLow) d.regionMetricLowColor = rmLow;
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
      case 'locale':
        dup(d.locale);
        d.locale = value;
        break;
      case 'active-tag':
        dup(d.activeTag);
        d.activeTag = value;
        break;
      case 'caption':
        dup(d.caption);
        d.caption = value;
        break;
      // ── Cosmetic `no-*` opt-outs: bare flags, idempotent (mirror `no-legend`,
      //    no dup warning); each defaults the feature ON when absent. ──
      case 'no-title':
        d.noTitle = true;
        break;
      case 'no-legend':
        d.noLegend = true;
        break;
      case 'no-coastline':
        d.noCoastline = true;
        break;
      case 'no-relief':
        d.noRelief = true;
        break;
      case 'no-context-labels':
        d.noContextLabels = true;
        break;
      case 'no-region-labels':
        d.noRegionLabels = true;
        break;
      case 'no-region-value':
        d.noRegionValue = true;
        break;
      case 'no-poi-labels':
        d.noPoiLabels = true;
        break;
      case 'no-colorize':
        d.noColorize = true;
        break;
      case 'no-cities':
        d.noCities = true;
        break;
      case 'no-cluster-pois':
        d.noClusterPois = true;
        break;
    }
  }

  function handleTag(trimmed: string, line: number): void {
    const m = matchTagBlockHeading(trimmed);
    if (!m) {
      pushError(
        line,
        `Malformed tag declaration: "${trimmed}" — write 'tag <Group>' (optionally 'tag <Group> as <alias>'), e.g. 'tag Market as m', with indented 'Value color' entries below.`
      );
      return;
    }
    emitTagLegacyDiagnostic(m, line, diagnostics);
    const group: Writable<TagGroup> = {
      name: m.name,
      ...(m.alias !== undefined && { alias: m.alias }),
      entries: [],
      lineNumber: line,
    };
    if (m.alias) aliasMap.set(m.alias.toLowerCase(), tagAttrKey(m.name));
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
    const { label, color } = extractColor(clean, palette, diagnostics, line);
    // Bare value (no explicit color) → keep it; finalized at end of parse.
    const entries = group.entries as TagEntry[];
    if (isDefault || entries.length === 0) group.defaultValue = label;
    entries.push({
      value: label,
      color: color ?? AUTO_TAG_COLOR_SENTINEL,
      lineNumber: line,
    });
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
        'route needs an origin place — `route <origin>` then indented legs (`-> dest`); origin may be a city name, IATA code, or `<lat> <lon>`. (§24B)'
      );
      return;
    }
    const { tags, meta } = partitionMeta(split.meta, tagGroupNames());
    const originLabel = meta['label'];
    const originValue = meta['value'];
    // `style: arc` on the route header was removed (§24B.6): leg shape comes
    // solely from each leg's own arrow glyph (`-…->` straight, `~…~>` arc).
    if (meta['style'] !== undefined) {
      pushError(
        line,
        'route header no longer takes `style:` — set leg shape with the arrow glyph instead (`~…~>` for an arc leg, `-…->` for a straight one). (§24B.6)'
      );
    }
    const route: Writable<MapRoute> = {
      origin: pos,
      ...(split.alias !== undefined && { originAlias: split.alias }),
      ...(originLabel !== undefined && { originLabel }),
      ...(originValue !== undefined && { originValue }),
      originTags: tags,
      legs: [],
      lineNumber: line,
    };
    routes.push(route);
    open.route = { route, indent };
  }

  /** Parse one route body line into a leg: `<arrow> <destination> [keys]`. The
   *  arrow is REQUIRED and gives the leg label + shape (`-…->` straight, `~…~>`
   *  arc); `value:` is leg thickness; a tag colours the LINE (§24B.6);
   *  `label:`/`as` name the destination stop. A bare destination with no arrow,
   *  or an undirected (`--`/`~~`) glyph, is a parse error — a voyage always flows
   *  from the previous stop to the next (§24B.6). */
  function parseLeg(trimmed: string, line: number): MapRouteLeg | null {
    const m = trimmed.match(LEG_ARROW_RE);
    if (!m) {
      pushError(
        line,
        `Malformed route leg: "${trimmed}" — a leg needs an arrow glyph (\`-> dest\`, \`~> dest\`, or labeled \`-label-> dest\` / \`~label~> dest\`). (§24B.6)`
      );
      return null;
    }
    const arr = classifyArrow(m[1]!, line);
    // A route leg is always directional (prev stop → next), so the undirected
    // `--`/`~~` glyphs are meaningless here (they stay valid on free-form edges).
    if (!arr.directed) {
      pushError(
        line,
        `A route leg is directional — "${trimmed}" uses an undirected glyph; use \`-> \` (straight) or \`~> \` (arc). (§24B.6)`
      );
      return null;
    }
    const arrowStyle: 'straight' | 'arc' = arr.style;
    const label: string | undefined = arr.label;
    const rest = m[2]!;
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
    // Leg shape comes solely from the leg's own arrow glyph (§24B.6) — the route
    // header `style:` was removed.
    return {
      ...(label !== undefined && { label }),
      style: arrowStyle,
      ...(value !== undefined && { value }),
      dest: pos,
      ...(split.alias !== undefined && { destAlias: split.alias }),
      ...(destLabel !== undefined && { destLabel }),
      tags, // colour the LINE (§24B.6); stop tags go on the poi line
      lineNumber: line,
    };
  }

  function handleEdges(trimmed: string, line: number): void {
    const parts = trimmed.split(ARROW_SPLIT);
    // parts = [ep0, tok0, ep1, tok1, ep2, ...]
    if (parts.length < 3) {
      pushError(
        line,
        `Malformed edge: "${trimmed}" — an edge is 'A -> B' (or 'A -label-> B', '~>' for arc, '--' undirected), both endpoints non-empty. (§24B)`
      );
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
    // the FINAL leg only — not broadcast to every leg of a chain (#7). A tag on
    // the line colours the LINE (§24B.6), so peel tags out of the meta here.
    const lastSplit = splitNameAndMeta(
      endpoints[endpoints.length - 1]!,
      registry(),
      aliasMap
    );
    endpoints[endpoints.length - 1] = lastSplit.name;
    const { tags: lastTags, meta: lastMeta } = partitionMeta(
      lastSplit.meta,
      tagGroupNames()
    );
    for (let k = 0; k < links.length; k++) {
      const from = endpoints[k]!;
      const to = endpoints[k + 1]!;
      if (!from || !to) {
        pushError(
          line,
          `Edge has an empty endpoint: "${trimmed}" — both sides of the arrow need a place, e.g. 'Paris -> Berlin'. (§24B)`
        );
        continue;
      }
      const isLast = k === links.length - 1;
      const meta = isLast ? lastMeta : {};
      const tags = isLast ? lastTags : {};
      // Edge shape comes only from the arrow token (surface parsing removed).
      const style: 'straight' | 'arc' =
        links[k]!.style === 'arc' ? 'arc' : 'straight';
      edges.push({
        from,
        to,
        ...(links[k]!.label !== undefined && { label: links[k]!.label }),
        directed: links[k]!.directed,
        style,
        meta,
        tags,
        lineNumber: line,
      });
    }
  }

  function classifyArrow(
    tok: string,
    line: number
  ): { label?: string; directed: boolean; style: 'straight' | 'arc' } {
    if (tok === '--') return { directed: false, style: 'straight' };
    if (tok === '~~') return { directed: false, style: 'arc' };
    if (tok === '->') return { directed: true, style: 'straight' };
    if (tok === '~>') return { directed: true, style: 'arc' };
    // Labeled form: arrowhead iff it ends in `>`, arc iff it starts with `~`.
    // The label sits between the delimiters — drop 2 trailing chars for the
    // directed `…->`/`…~>`, 1 for the undirected `…-`/`…~`.
    const directed = tok.endsWith('>');
    const style: 'straight' | 'arc' = tok.startsWith('~') ? 'arc' : 'straight';
    const inner = directed ? tok.slice(1, -2) : tok.slice(1, -1);
    const lbl = parseInArrowLabel(inner, line);
    lbl.diagnostics.forEach((d) => diagnostics.push(d));
    return {
      ...(lbl.label !== undefined && { label: lbl.label }),
      directed,
      style,
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

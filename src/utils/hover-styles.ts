// ============================================================
// Baked-CSS hover interactivity for exported SVGs (no JavaScript).
//
// Diagrammo charts serialize to static SVG strings — every live D3
// `.on('mouseenter')` listener is dropped on `outerHTML`, so an embedded chart
// (Obsidian, remark/astro/docusaurus/fumadocs doc sites, a browser-opened
// `.svg`) is completely flat. This module restores hover feedback with ZERO JS
// by baking a `<style>` block into the SVG, keyed off the `data-*` attributes
// the renderers already emit.
//
// Two effects, pure CSS:
//   1. self-emphasis  — hover a mark → it pops (`${mark}:hover { … }`). Universal.
//   2. cross-highlight — hover a mark → its group lifts / the rest dims, via
//      `svg:has(…[attr="v"]:hover) …` (CSS `:has()`).
//
// ARCHITECTURE (tech-spec-chart-hover-interactivity, ADR-2): a central
// `HOVER_SPECS` registry (one row per chart) + one `injectHoverStyles` string
// splice. `buildHoverCss` is a PURE formatter (unit-tested in isolation); the
// injector self-derives the enumerated values/ids by scanning the rendered DOM,
// so a CROSS-FREE chart opts in with a single registry row and no renderer edit.
//
// GATE (ADR-1): wired into the public `render()` entry (the embed/CLI path),
// defaulting ON. The desktop app renders its live preview through its own direct
// renderer calls (never `render()`), so the app keeps its richer JS emphasis and
// there is no opacity double-up. `render({ bakeHover: false })` opts out.
// ============================================================

import { tagAttrKey } from './tag-groups';

/** How a chart's cross-highlight rules are shaped. `self` = self-emphasis only
 *  (no cross-highlight — single-series / non-relational charts). */
export type HoverStrategy = 'enumerated' | 'structural' | 'connection' | 'self';

/** Lift the matched group, or dim everything else. Default `lift` (ADR-5). */
export type HoverEmphasis = 'lift' | 'dim';

/** One registry row: everything `buildHoverCss` needs to format a chart. */
export interface HoverSpec {
  /** The hoverable mark selector, e.g. `.dgmo-datum`. */
  markSelector: string;
  strategy: HoverStrategy;
  /** `structural`: the co-group wrapper `<g>`, e.g. `g.dgmo-series`. */
  groupSelector?: string;
  /** `enumerated`: the per-mark group key attr, e.g. `data-emph-key`. */
  groupAttr?: string;
  /** `enumerated`: resolve `groupAttr` at scan time from the active tag group
   *  (`data-legend-active` → `data-tag-<slug>`) instead of a fixed name. */
  groupAttrMode?: 'tag-active';
  /** `lift` (default) or `dim`. */
  emphasis?: HoverEmphasis;
  /** Dim opacity for non-matched marks (dim mode only). Default 0.4. */
  dimOpacity?: number;
  /** Emit legend↔mark pairing rules (`data-legend-entry`). */
  legend?: boolean;
  /** Emit the `${mark}:hover` self rule. Default true. */
  selfEmphasis?: boolean;
  /** Chart already animates opacity (infra pulse) — skip the transition. */
  animatesOpacity?: boolean;
  // ── connection strategy (graph-family node→edge highlight) ──
  /** The hoverable node selector, e.g. `.participant[data-participant-id]`. */
  hoverSelector?: string;
  /** The node id attr, e.g. `data-participant-id`. */
  hoverAttr?: string;
  /** The edge selector, e.g. `.message-arrow`. */
  edgeSelector?: string;
  /** Edge source-endpoint attr, e.g. `data-from`. */
  fromAttr?: string;
  /** Edge target-endpoint attr, e.g. `data-to`. */
  toAttr?: string;
}

/** DOM-scanned data the injector supplies to the pure formatter. */
export interface HoverDerived {
  /** Distinct group values (enumerated / legend). */
  values?: string[];
  /** Distinct endpoint node ids (connection). */
  ids?: string[];
  /** The group attr resolved at scan time (tag-active charts). */
  groupAttr?: string;
}

/**
 * Cap on enumerated rule count (values + legend pairings + connection ids). Over
 * it, we bail to self-emphasis only — `:has()` style-recalc on a huge chart
 * (200-region map, 100-slice pie) can stutter on hover (F10 / PM2).
 */
export const MAX_HOVER_GROUPS = 40;

const DEFAULT_DIM_OPACITY = 0.4;

/** Positive emphasis for the MATCHED marks in `lift` mode (never opacity>1). */
const LIFT_DECL = 'filter:saturate(1.4) brightness(1.06)';

const TRANSITION_DECL = 'transition:filter .12s ease, opacity .12s ease';

/**
 * Escape a value to a CSS `<string>` literal body (the text INSIDE the quotes of
 * an attribute selector). Matches `CSS.escape`/CSS `<string>` semantics — jsdom
 * has no `CSS.escape`, so we write it to spec (F16). Quote and backslash are
 * backslash-escaped; controls (incl. newline → `\A `) are hex-escaped with a
 * trailing space terminator.
 *
 * `<` is ALSO hex-escaped (`\3c `), even though it is a valid CSS string char.
 * The rules land in a `<style>` element, whose content is HTML *raw text*: the
 * tokenizer ends it at the first `</style` regardless of CSS quoting. A chart
 * label like `a</style><script>…` would otherwise break out of the style block.
 * Neutralizing `<` makes a `</style` token impossible (F16 / security).
 */
export function escCssString(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '<') out += '\\3c ';
    else if (code < 0x20 || code === 0x7f)
      out += '\\' + code.toString(16) + ' ';
    else out += ch;
  }
  return out;
}

/** The `:hover` self-emphasis floor — works with no `:has()` support. */
function selfRule(markSelector: string): string {
  return `${markSelector}:hover{${LIFT_DECL}}`;
}

/** One enumerated cross rule for value `v`. */
function enumeratedRule(
  mark: string,
  attr: string,
  v: string,
  emphasis: HoverEmphasis,
  dimOpacity: number
): string {
  const lit = escCssString(v);
  const trigger = `svg:has(${mark}[${attr}="${lit}"]:hover)`;
  return emphasis === 'lift'
    ? `${trigger} ${mark}[${attr}="${lit}"]{${LIFT_DECL}}`
    : `${trigger} ${mark}:not([${attr}="${lit}"]){opacity:${dimOpacity}}`;
}

/** One legend↔mark pairing rule for value `v` (F2: independent casing). */
function legendRule(
  mark: string,
  attr: string,
  v: string,
  emphasis: HoverEmphasis,
  dimOpacity: number
): string {
  // `data-legend-entry` is lowercased at the source (legend-svg.ts); the group
  // attr keeps the mark's raw baked casing. The two must NOT share one literal.
  const entryLit = escCssString(v.toLowerCase());
  const attrLit = escCssString(v);
  const trigger = `svg:has([data-legend-entry="${entryLit}"]:hover)`;
  return emphasis === 'lift'
    ? `${trigger} ${mark}[${attr}="${attrLit}"]{${LIFT_DECL}}`
    : `${trigger} ${mark}:not([${attr}="${attrLit}"]){opacity:${dimOpacity}}`;
}

/** One connection rule for node id `id` — dim edges not incident to it. */
function connectionRule(
  spec: HoverSpec,
  id: string,
  dimOpacity: number
): string {
  const lit = escCssString(id);
  const { hoverSelector, hoverAttr, edgeSelector, fromAttr, toAttr } = spec;
  const trigger = `svg:has(${hoverSelector}[${hoverAttr}="${lit}"]:hover)`;
  return `${trigger} ${edgeSelector}:not([${fromAttr}="${lit}"]):not([${toAttr}="${lit}"]){opacity:${dimOpacity}}`;
}

/**
 * Pure formatter: given a registry spec + DOM-derived values/ids, return the
 * CSS text for one chart's baked hover `<style>` (no `<style>` wrapper). Returns
 * `''` when there is nothing to emit.
 */
export function buildHoverCss(
  spec: HoverSpec,
  derived: HoverDerived = {},
  emphasisOverride?: HoverEmphasis
): string {
  const emphasis = emphasisOverride ?? spec.emphasis ?? 'lift';
  const dimOpacity = spec.dimOpacity ?? DEFAULT_DIM_OPACITY;
  const selfOn = spec.selfEmphasis !== false;
  const values = derived.values ?? [];
  const ids = derived.ids ?? [];

  const base: string[] = [];
  if (selfOn) {
    base.push(selfRule(spec.markSelector));
    // Guarded transition so the emphasis eases in/out (RED-3: skip when the
    // chart already animates opacity, to avoid fighting its own animation).
    if (!spec.animatesOpacity) {
      base.push(`${spec.markSelector}{${TRANSITION_DECL}}`);
    }
  }

  const cross: string[] = [];

  if (spec.strategy === 'structural' && spec.groupSelector) {
    // Single rule, no enumeration, no cap.
    const g = spec.groupSelector;
    cross.push(
      emphasis === 'lift'
        ? `svg:has(${g}:hover) ${g}:hover{${LIFT_DECL}}`
        : `svg:has(${g}:hover) ${g}:not(:hover){opacity:${dimOpacity}}`
    );
  } else if (spec.strategy === 'enumerated' && spec.groupAttr) {
    const legendCount = spec.legend ? values.length : 0;
    if (values.length + legendCount > MAX_HOVER_GROUPS) {
      // Over cap: self-emphasis only, record the skip.
      base.push(
        `/* hover: ${values.length} groups exceeds cap ${MAX_HOVER_GROUPS}; self-emphasis only */`
      );
    } else {
      for (const v of values) {
        cross.push(
          enumeratedRule(
            spec.markSelector,
            spec.groupAttr,
            v,
            emphasis,
            dimOpacity
          )
        );
      }
      if (spec.legend) {
        for (const v of values) {
          cross.push(
            legendRule(
              spec.markSelector,
              spec.groupAttr,
              v,
              emphasis,
              dimOpacity
            )
          );
        }
      }
    }
  } else if (spec.strategy === 'connection') {
    if (ids.length > MAX_HOVER_GROUPS) {
      base.push(
        `/* hover: ${ids.length} nodes exceeds cap ${MAX_HOVER_GROUPS}; self-emphasis only */`
      );
    } else {
      for (const id of ids) cross.push(connectionRule(spec, id, dimOpacity));
    }
  }

  // Cross/connection rules are pointer-only (RED-4): a touch device has no
  // hover, so `@media (hover:hover)` prevents stuck/absent dimming there. Self
  // emphasis is intentionally global (a tap counts as :hover on touch).
  const parts = [...base];
  if (cross.length) parts.push(`@media (hover:hover){${cross.join('')}}`);
  return parts.join('');
}

// ============================================================
// Registry — one row per chart (ADR-2)
// ============================================================

/**
 * `HOVER_SPECS[chartType]` → the chart's hover rule shape. The injector scans
 * the rendered DOM for the enumerated values/ids, so CROSS-FREE charts need only
 * a row here (no renderer edit). A chart with no row is a no-op.
 *
 * MVP tier (CROSS-FREE statistical charts): all share the `tagDatum` convention
 * — `.dgmo-datum` marks carrying `data-emph-key` (the per-category/per-series
 * key) + a `data-legend-entry` legend. `data-emph-key` is:
 *   pie/funnel/polar/heatmap → the item/row LABEL  (hover isolates one mark/row)
 *   bar → series when multi-series, else the bar LABEL.
 * `lift` (default) filter-emphasizes the matched marks — it never dims, so inline
 * `.style('opacity')` on a mark cannot silently defeat it (sidesteps RED-2/AC12
 * for this tier).
 */
export const HOVER_SPECS: Record<string, HoverSpec> = {
  // Data-chart family (`.dgmo-datum`): `dim` at 0.18 to MIRROR the app's live
  // hover (charts-d3/interactions.ts `.dgmo-dim{opacity:.18}` — hover a mark →
  // every other emph-key drops out). `lift` (saturate/brightness) read as
  // "nothing happened" on muted fills. Safe to dim: these export renderers set
  // NO inline `style="opacity"` on datums (only presentation `*-opacity` attrs,
  // which a `<style>` rule outranks), so no RED-2 inline-defeat.
  pie: {
    markSelector: '.dgmo-datum',
    strategy: 'enumerated',
    groupAttr: 'data-emph-key',
    emphasis: 'dim',
    dimOpacity: 0.18,
    legend: true,
  },
  bar: {
    markSelector: '.dgmo-datum',
    strategy: 'enumerated',
    groupAttr: 'data-emph-key',
    emphasis: 'dim',
    dimOpacity: 0.18,
    legend: true,
  },
  funnel: {
    markSelector: '.dgmo-datum',
    strategy: 'enumerated',
    groupAttr: 'data-emph-key',
    emphasis: 'dim',
    dimOpacity: 0.18,
    legend: true,
  },
  heatmap: {
    markSelector: '.dgmo-datum',
    strategy: 'enumerated',
    groupAttr: 'data-emph-key',
    emphasis: 'dim',
    dimOpacity: 0.18,
    legend: true,
  },
  'polar-area': {
    markSelector: '.dgmo-datum',
    strategy: 'enumerated',
    groupAttr: 'data-emph-key',
    emphasis: 'dim',
    dimOpacity: 0.18,
    legend: true,
  },

  // ── CROSS-FREE diagram charts — FIXED-attr keys, DOM-verified (Task 3) ──
  // Purely additive: the baked CSS lights up embeds; the app keeps its own live
  // JS emphasis (it renders via direct calls, never render()), so no double-up
  // and no renderer edits. Tag-group charts (treemap/event-line/block/map —
  // keyed on a per-diagram `data-tag-<slug>`) are deferred: they need
  // active-tag-slug discovery in the injector.
  gantt: {
    markSelector: '.gantt-task',
    strategy: 'enumerated',
    groupAttr: 'data-group',
  },
  timeline: {
    markSelector: '.tl-event',
    strategy: 'enumerated',
    groupAttr: 'data-group',
  },
  // raci cells AND column headers both carry `data-role-id`; keying on the bare
  // attr makes hovering either lift the whole role (cross-column highlight).
  raci: {
    markSelector: '[data-role-id]',
    strategy: 'enumerated',
    groupAttr: 'data-role-id',
  },

  // ── CROSS-FREE connection charts (node hover → dim non-incident edges) ──
  sequence: {
    markSelector: '.participant',
    strategy: 'connection',
    hoverSelector: '.participant',
    hoverAttr: 'data-participant-id',
    edgeSelector: '.message-arrow',
    fromAttr: 'data-from',
    toAttr: 'data-to',
  },
  arc: {
    markSelector: '.arc-node',
    strategy: 'connection',
    hoverSelector: '.arc-node',
    hoverAttr: 'data-node',
    edgeSelector: '.arc-link',
    fromAttr: 'data-source',
    toAttr: 'data-target',
  },
  pert: {
    markSelector: '.pert-node',
    strategy: 'connection',
    hoverSelector: '.pert-node',
    hoverAttr: 'data-activity-id',
    edgeSelector: '.pert-edge',
    fromAttr: 'data-source',
    toAttr: 'data-target',
  },

  // ── CROSS-FREE tag-group charts — active group discovered at scan time ──
  // The mark carries `data-tag-<slug>` for the ONE active tag group; the
  // injector reads the slug from `data-legend-active` (F9). `data-tag-*` values
  // and `data-legend-entry` are both lowercased, so legend pairing casing lines
  // up. (map is excluded — it carries two tag kinds on different marks.)
  treemap: {
    markSelector: '.dgmo-treemap-cell',
    strategy: 'enumerated',
    groupAttrMode: 'tag-active',
    legend: true,
  },
  block: {
    markSelector: '.dgmo-block-cell',
    strategy: 'enumerated',
    groupAttrMode: 'tag-active',
    legend: true,
  },
  'event-line': {
    markSelector: '.dgmo-event-dot',
    strategy: 'enumerated',
    groupAttrMode: 'tag-active',
    legend: true,
  },

  // ── Connection graph-family — edge endpoint attrs baked in the renderers ──
  // Hover a node → dim edges not incident to it. Node id ↔ edge from/to.
  flowchart: {
    markSelector: '.fc-node',
    strategy: 'connection',
    hoverSelector: '.fc-node',
    hoverAttr: 'data-node-id',
    edgeSelector: '.fc-edge-group',
    fromAttr: 'data-source',
    toAttr: 'data-target',
  },
  state: {
    markSelector: '.st-node',
    strategy: 'connection',
    hoverSelector: '.st-node',
    hoverAttr: 'data-node-id',
    edgeSelector: '.st-edge-group',
    fromAttr: 'data-source',
    toAttr: 'data-target',
  },
  'boxes-and-lines': {
    markSelector: '.bl-node',
    strategy: 'connection',
    hoverSelector: '.bl-node',
    hoverAttr: 'data-node-id',
    edgeSelector: '.bl-edge-group',
    fromAttr: 'data-from',
    toAttr: 'data-to',
  },
  sketch: {
    markSelector: '.sk-node',
    strategy: 'connection',
    hoverSelector: '.sk-node',
    hoverAttr: 'data-node-id',
    edgeSelector: '.sk-edge-group',
    fromAttr: 'data-from',
    toAttr: 'data-to',
  },
  infra: {
    markSelector: '.infra-node',
    strategy: 'connection',
    hoverSelector: '.infra-node',
    hoverAttr: 'data-infra-node',
    edgeSelector: '.infra-edge',
    fromAttr: 'data-from',
    toAttr: 'data-to',
  },
  c4: {
    markSelector: '.c4-card',
    strategy: 'connection',
    hoverSelector: '.c4-card',
    hoverAttr: 'data-node-id',
    edgeSelector: '.c4-edge-group',
    fromAttr: 'data-source',
    toAttr: 'data-target',
  },
  class: {
    markSelector: '.cd-class',
    strategy: 'connection',
    hoverSelector: '.cd-class',
    hoverAttr: 'data-node-id',
    edgeSelector: '.cd-edge-group',
    fromAttr: 'data-source',
    toAttr: 'data-target',
  },
  er: {
    markSelector: '.er-table',
    strategy: 'connection',
    hoverSelector: '.er-table',
    hoverAttr: 'data-node-id',
    edgeSelector: '.er-edge-group',
    fromAttr: 'data-source',
    toAttr: 'data-target',
  },
  org: {
    markSelector: '.org-node',
    strategy: 'connection',
    hoverSelector: '.org-node',
    hoverAttr: 'data-node-id',
    edgeSelector: '.org-edge',
    fromAttr: 'data-from',
    toAttr: 'data-to',
  },
  sitemap: {
    markSelector: '.sitemap-node',
    strategy: 'connection',
    hoverSelector: '.sitemap-node',
    hoverAttr: 'data-node-id',
    edgeSelector: '.sitemap-edge-group',
    fromAttr: 'data-from',
    toAttr: 'data-to',
  },
  cycle: {
    markSelector: '.cycle-node',
    strategy: 'connection',
    hoverSelector: '.cycle-node',
    hoverAttr: 'data-node-index',
    edgeSelector: '.cycle-edge',
    fromAttr: 'data-from',
    toAttr: 'data-to',
  },

  // ── CROSS-ADD — one attr baked in the renderer, then keyed here ──
  scatter: {
    markSelector: '.dgmo-datum',
    strategy: 'enumerated',
    groupAttr: 'data-category',
    emphasis: 'dim',
    dimOpacity: 0.18,
    legend: true,
  },
  quadrant: {
    markSelector: '.point-group',
    strategy: 'enumerated',
    groupAttr: 'data-quadrant',
  },
  'version-control': {
    markSelector: '[data-branch]',
    strategy: 'enumerated',
    groupAttr: 'data-branch',
  },
  // kanban: cards nest under a `.kanban-column` wrapper, so a structural rule
  // gives column-focus with NO renderer edit — hovering any card puts its
  // column into `:hover` and the others dim. `dim` (not lift) reads as
  // "focus this column"; the marks' opacity is a presentation attr, which a
  // `<style>` rule outranks (no RED-2 conflict).
  kanban: {
    markSelector: '.kanban-column',
    strategy: 'structural',
    groupSelector: '.kanban-column',
    emphasis: 'dim',
    selfEmphasis: false,
  },
  // line: each series is a `g.dgmo-series` wrapping its line + data dots + an
  // invisible fat hit corridor (`.dgmo-series-hit`, renderer-baked) — without
  // the corridor only the 2.5px stroke and 4px dots were hittable, so the
  // baked hover read as dead in embeds. Hovering anywhere along a line puts
  // its group into `:hover` and the other series dim.
  line: {
    markSelector: 'g.dgmo-series',
    strategy: 'structural',
    groupSelector: 'g.dgmo-series',
    emphasis: 'dim',
    selfEmphasis: false,
  },
  swimlane: {
    markSelector: '[data-lane]',
    strategy: 'enumerated',
    groupAttr: 'data-lane',
  },

  // tech-radar: blips are `<g>` carrying data-quadrant/data-ring/data-trend;
  // only blips have data-trend (the sector wedges don't), so `[data-trend]`
  // isolates them. Hover a blip → lift same-quadrant blips.
  'tech-radar': {
    markSelector: '[data-trend]',
    strategy: 'enumerated',
    groupAttr: 'data-quadrant',
  },
  // journey-map: faces carry data-score (the emotion). Hover a face → lift all
  // same-score touchpoints across the journey.
  'journey-map': {
    markSelector: '.journey-face',
    strategy: 'enumerated',
    groupAttr: 'data-score',
  },
  // mindmap: nodes carry a single data-tag-<group> when tagged (no
  // legend-active marker → the single-tag fallback in deriveFromSvg resolves
  // it). Untagged → self-emphasis only.
  mindmap: {
    markSelector: '.mindmap-node',
    strategy: 'enumerated',
    groupAttrMode: 'tag-active',
  },

  // ── SELF-emphasis only (single-series / non-relational solid marks) ──
  pyramid: { markSelector: '.pyramid-layer', strategy: 'self' },
  ring: { markSelector: '.ring-layer', strategy: 'self' },
  slope: { markSelector: '.slope-series', strategy: 'self' },
  // function: each curve is a `.dgmo-datum` path — self-emphasis floor only
  // (thin line, no group).
  function: { markSelector: '.dgmo-datum', strategy: 'self' },
  // map: POIs carry data-tag-<group> for the active legend group (resolved from
  // data-legend-active). Hover a POI → lift same-group POIs. `lift` (never dim)
  // sidesteps the decorative-layer / inactive-pill inline-opacity trap (F6).
  // Region-tag (choropleth) maps have no POIs → self-emphasis only.
  map: {
    markSelector: '[data-poi]',
    strategy: 'enumerated',
    groupAttrMode: 'tag-active',
  },
};

// ============================================================
// Injector — one call site, self-derives from the DOM
// ============================================================

export interface InjectHoverOptions {
  /** Master gate. When false/absent, the SVG is returned unchanged. */
  bakeHover?: boolean;
  /** Override the registry default emphasis for all charts. */
  emphasis?: HoverEmphasis;
}

/**
 * Scan a rendered SVG string for the distinct group values / endpoint ids the
 * spec needs. Uses a throwaway DOM parse (read-only — the returned string is
 * never re-serialized, so no attribute reordering / entity churn). Requires a
 * `document`; returns an empty derived set when none is available.
 */
function deriveFromSvg(svg: string, spec: HoverSpec): HoverDerived {
  if (typeof document === 'undefined') return {};
  const holder = document.createElement('div');
  holder.innerHTML = svg;
  const root = holder.querySelector('svg');
  if (!root) return {};

  if (spec.strategy === 'enumerated') {
    // Resolve the group attr. Fixed name (`groupAttr`), or — for tag-group
    // charts — the single ACTIVE tag group, discovered from the legend's
    // `data-legend-active="<slug>"` marker → `data-tag-<slug>` (F9: exactly one
    // group drives the rules, never the intersection of all tag groups). No
    // active tag → self-emphasis only.
    let groupAttr = spec.groupAttr;
    if (spec.groupAttrMode === 'tag-active') {
      const slug = root
        .querySelector('[data-legend-active]')
        ?.getAttribute('data-legend-active');
      if (slug) {
        // Defensive re-slug: legacy SVGs (pre-0.46) carried the raw lowercased
        // group name here, which is not a valid attribute name when the group
        // name contains spaces/parens — querySelectorAll would throw.
        groupAttr = `data-tag-${tagAttrKey(slug)}`;
      } else {
        // Fallback for charts with no legend-active marker (e.g. mindmap): if
        // the marks carry exactly ONE distinct `data-tag-*` group, use it.
        // Ambiguous (multiple) or none → self-emphasis only (F9).
        const names = new Set<string>();
        root.querySelectorAll(spec.markSelector).forEach((el) => {
          for (const a of Array.from(el.attributes)) {
            if (a.name.startsWith('data-tag-')) names.add(a.name);
          }
        });
        if (names.size !== 1) return {};
        groupAttr = [...names][0];
      }
    }
    if (!groupAttr) return {};
    const attr = groupAttr;
    const seen = new Set<string>();
    root.querySelectorAll(`${spec.markSelector}[${attr}]`).forEach((el) => {
      const v = el.getAttribute(attr);
      if (v != null) seen.add(v);
    });
    return { values: [...seen], groupAttr: attr };
  }
  if (spec.strategy === 'connection' && spec.hoverSelector && spec.hoverAttr) {
    const seen = new Set<string>();
    root
      .querySelectorAll(`${spec.hoverSelector}[${spec.hoverAttr}]`)
      .forEach((el) => {
        const v = el.getAttribute(spec.hoverAttr!);
        if (v != null) seen.add(v);
      });
    return { ids: [...seen] };
  }
  return {}; // structural needs no derived values
}

/**
 * Bake pure-CSS hover into a rendered SVG string. No-op (returns the input
 * unchanged) when the gate is off, the chart has no registry row, or there is
 * nothing to emit. Otherwise splices a single `<style>` immediately after the
 * opening `<svg …>` tag — the rest of the markup is byte-for-byte untouched, so
 * a render snapshot diff is purely the added style block.
 */
export function injectHoverStyles(
  svg: string,
  chartType: string | null | undefined,
  opts?: InjectHoverOptions
): string {
  if (!opts?.bakeHover || !svg || !chartType) return svg;
  const spec = HOVER_SPECS[chartType];
  if (!spec) return svg;

  const derived = deriveFromSvg(svg, spec);
  // A tag-active chart resolves its group attr at scan time; fold it into the
  // spec so the pure formatter keys off the real attr name.
  const eff = derived.groupAttr
    ? { ...spec, groupAttr: derived.groupAttr }
    : spec;
  const css = buildHoverCss(eff, derived, opts.emphasis);
  if (!css) return svg;

  const open = svg.match(/<svg\b[^>]*>/);
  if (open?.index == null) return svg;
  const at = open.index + open[0].length;
  return `${svg.slice(0, at)}<style>${css}</style>${svg.slice(at)}`;
}

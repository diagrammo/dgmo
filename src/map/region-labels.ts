import { mix } from '../palettes/color-utils';
import { createLabelPlacement } from '../label-layout';
import type { LabelRect, PointCircle, Leader } from '../label-layout';
import { measureLegendText } from '../utils/legend-constants';
import type { GeoPath } from 'd3-geo';
import type { PaletteColors } from '../palettes/types';
import type { ResolvedMap, ResolvedRegion } from './resolved-types';
import type { InsetLabelSeed } from './insets';
import {
  FONT,
  LABEL_PADY,
  REGION_FONT_MAX_ORIENT,
  SUBJECT_FONT_MAX,
  SUBJECT_MIN_PROMINENCE,
  SUBJECT_LEADER_FONT,
} from './label-metrics';
import type { LabelMetrics } from './label-metrics';
// Type-only, so the cycle with layout.ts is erased at build time.
import type {
  GeoFeature,
  MapLayoutRegion,
  MapLayoutPoi,
  PlacedLabel,
} from './layout';
import { WORLD_LABEL_ANCHORS, FIT_PAD } from './layout-constants';

/**
 * Place a label on every region that should carry one — subject regions with
 * their value, orientation backdrop names, frame containers, and the AK/HI
 * inset seeds — escalating from in-shape through short-hop callout to a
 * leader-lined margin chip as space runs out.
 *
 * MUTATES the three collections it is handed (`labels`, `labeledRegionIds`,
 * `regionLabelGuards`) and returns nothing; that is the whole of its outward
 * effect, verified against the call site before the move.
 *
 * The parameter list is long because the coupling is real, not because the
 * signature is lazy: this stage genuinely reads the projection, the fill model,
 * the colouring dimension, the settled POI positions and the collision set. It
 * was previously spelled as 35 closed-over locals in a 3,200-line body, where
 * the same coupling was invisible. Shortening it means changing what the stage
 * depends on, which is a separate piece of work from moving it.
 */
export function placeRegionLabels(args: {
  readonly resolved: ResolvedMap;
  readonly palette: PaletteColors;
  readonly width: number;
  readonly height: number;
  readonly path: GeoPath;
  readonly project: (lon: number, lat: number) => [number, number] | null;
  readonly worldLayer: ReadonlyMap<string, GeoFeature>;
  readonly usLayer: ReadonlyMap<string, GeoFeature> | null;
  readonly regionById: ReadonlyMap<string, ResolvedRegion>;
  readonly regions: readonly MapLayoutRegion[];
  readonly pois: readonly MapLayoutPoi[];
  readonly insetLabelSeeds: readonly InsetLabelSeed[];
  /** Top band already claimed by the title/legend overlays. */
  readonly topReserved: readonly LabelRect[];
  readonly topPad: number;
  readonly markers: readonly PointCircle[];
  readonly collides: (rect: LabelRect) => boolean;
  readonly neutralFill: string;
  readonly water: string;
  readonly foreignFill: string;
  readonly backdropLandTone: string;
  readonly regionFill: (r: {
    iso?: string;
    value?: number;
    color?: string;
    tags: Readonly<Record<string, string>>;
  }) => string;
  readonly fillAt: (x: number, y: number) => string;
  readonly regionValueStr: (value: number | undefined) => string | undefined;
  readonly isCompact: boolean;
  readonly usChoroplethZoom: boolean;
  readonly metrics: LabelMetrics;
  readonly pushRegionLabel: (
    x: number,
    y: number,
    text: string,
    fill: string,
    lineNumber: number,
    valueLine?: string,
    fontSize?: number,
    colorOverride?: string
  ) => void;
  readonly regionLabelRect: (
    cx: number,
    cy: number,
    text: string,
    valueText?: string,
    font?: number
  ) => LabelRect;
  /** MUTATED: the placed labels this stage appends to. */
  readonly labels: PlacedLabel[];
  /** MUTATED: ISO codes that now carry a label, so later stages skip them. */
  readonly labeledRegionIds: Set<string>;
  /** MUTATED: label+rect pairs the final overlap guard re-checks. */
  readonly regionLabelGuards: Array<{ label: PlacedLabel; rect: LabelRect }>;
}): void {
  const {
    resolved,
    palette,
    width,
    height,
    path,
    project,
    worldLayer,
    usLayer,
    regionById,
    regions,
    pois,
    insetLabelSeeds,
    topReserved,
    topPad,
    markers,
    collides,
    neutralFill,
    water,
    foreignFill,
    backdropLandTone,
    regionFill,
    fillAt,
    regionValueStr,
    isCompact,
    usChoroplethZoom,
    metrics,
    pushRegionLabel,
    regionLabelRect,
    labels,
    labeledRegionIds,
    regionLabelGuards,
  } = args;
  const { labelW, labelH, stackW, stackH, sizeT } = metrics;

  // Gather the placeable region labels, then commit them largest-footprint
  // first. Two adjacent regions can sit too close to both carry a label at the
  // current scale (Spain + Portugal on a whole-world view collapse to ~32px
  // apart). Rather than overlap, the bigger region keeps its label and the
  // smaller one yields; zoom in and the footprints separate, no collision
  // fires, and both labels show. Order is by projected box AREA (visual claim)
  // so the result is scale-driven, not source-order-driven.
  // POI-only region framing: the region(s) CONTAINING the POIs are labelled
  // prominently even though they carry no data (layer 'base'). Neighbour land
  // gets the muted context-label treatment further down.
  const frameContainers = new Set(resolved.poiFrameContainers);
  const entries = regions
    .map((r) => {
      const isContainer = frameContainers.has(r.id);
      if ((r.layer === 'base' && !isContainer) || r.label === undefined)
        return null;
      // A container state carries layer 'base', so key off the id shape too.
      const isUsState = r.layer === 'us-state' || r.id.startsWith('US-');
      const f = isUsState ? usLayer?.get(r.id) : worldLayer.get(r.id);
      if (!f) return null;
      const [[x0, y0], [x1, y1]] = path.bounds(f as never);
      const boxW = x1 - x0;
      const boxH = y1 - y0;
      // full → abbrev → hide. Abbrev exists only for US states; at the compact
      // breakpoint abbrev is tried first. A POI-frame CONTAINER (e.g. the
      // "California" framing a US cloud-regions map) never degrades to the
      // 2-letter code to squeeze past its own POIs — it stays full or yields
      // entirely (the post-POI guard below hides it on collision).
      // On a zoomed US choropleth, drop the abbreviation entirely (full name or
      // a leader callout — never "NH"). Elsewhere the full → abbrev → hide
      // cascade stands (compact tries abbrev first; a POI container never
      // abbreviates).
      const abbrev =
        isUsState && !usChoroplethZoom ? r.id.replace(/^US-/, '') : undefined;
      const candidates =
        abbrev !== undefined
          ? isCompact
            ? [abbrev, r.label]
            : isContainer
              ? [r.label]
              : [r.label, abbrev]
          : [r.label];
      const anchor = !isUsState ? WORLD_LABEL_ANCHORS[r.id] : undefined;
      const c = anchor
        ? project(anchor[0], anchor[1])
        : path.centroid(f as never);
      if (!c || !Number.isFinite(c[0])) return null;
      return { r, c, boxW, boxH, area: boxW * boxH, candidates };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => b.area - a.area || a.r.lineNumber - b.r.lineNumber);
  // Every guard and every commit in this pass runs through `placement`, which
  // owns what has been placed and which leaders have been drawn. Those two
  // used to be bare arrays the loop had to remember to push onto — miss one
  // and the next iteration silently reads a stale world. `commit()` is the
  // single call that cannot be half-done.
  //
  // Seeded with the title + legend boxes so region/data labels dodge the
  // overlay the same way context labels do. A new short-hop leader that would
  // cross one already drawn is rejected — crossing leaders read as spaghetti,
  // so the label is dropped instead (the shading + legend + hover carry the
  // region).
  // "Empty" screen space a short-hop callout chip may sit on: open water or
  // un-valued base/foreign land (Canada, Mexico, neighbour states with no
  // metric). A chip must NEVER cover another VALUED region's choropleth fill —
  // that's the data, and a label box on top of it is worse than no label. On a
  // region-heat map valued regions take `fillForValue` (never water / neutral
  // / foreign), so testing the fill at a point cleanly separates data from
  // empty. (Colorize mode — which recolours base land — is mutually exclusive
  // with the score ramp that gates callouts, so this stays sound.)
  const isEmptyFill = (f: string): boolean =>
    f === water || f === neutralFill || f === foreignFill;
  // POI markers are obstacles for region labels: a region whose centroid sits on
  // a POI (e.g. Colorado's centroid under the "Core POP" dot in Denver) must NOT
  // stamp its name there — the POI's own label owns that spot, and two names by
  // one dot is ambiguous. The dot rect is padded to also keep the region name
  // clear of the POI's adjacent label. Region labels with no nearby POI (a
  // container whose POIs cluster in one corner, or an empty neighbour state) are
  // unaffected. POI markers are positioned above; their labels place further
  // down, so dot-proximity is the signal available here.
  const POI_LABEL_PAD = 14; // px — rough room for the POI's own hugging label
  const poiObstacles: LabelRect[] = pois.map((p) => ({
    x: p.cx - p.r - POI_LABEL_PAD,
    y: p.cy - p.r - POI_LABEL_PAD,
    w: 2 * (p.r + POI_LABEL_PAD),
    h: 2 * (p.r + POI_LABEL_PAD),
  }));
  const placement = createLabelPlacement({
    reserved: topReserved,
    obstacles: poiObstacles,
    markers,
  });
  // ── Short-hop callout into adjacent empty space ────────────────────────
  // A valued region whose name won't fit in place (even abbreviated) may nudge
  // its full name+value chip a SHORT hop into the open space right next to it —
  // north into Canada, south into Mexico, out into the ocean — joined by a tiny
  // leader + centroid dot. This is deliberately LOCAL: the hop is capped well
  // under a map-width, so a chip always hugs its own region. If no cardinal
  // direction has clean adjacent space within reach — the chip would land on
  // another valued region, run off-canvas, collide with a placed label/POI, or
  // its leader would cross an existing leader — the region gets NO label and the
  // choropleth shading speaks for it (hover still reveals the name+value). That
  // "give up cleanly" rule is the whole point: a readable blank beats a tangle
  // of crossing leaders and overlapping chips.
  const SHORT_HOP_MAX = Math.max(46, Math.min(width, height) * 0.11);
  const STEP = 4; // px probe granularity walking out of the region
  const HOP_GAP = 9; // px clearance between region edge and chip
  // How OPEN is the space a chip projects into? Measured on the chip's OUTWARD
  // hemisphere (the side facing away from its region): cast a fan of rays and
  // return the distance to the nearest land or canvas edge. A chip wedged in a
  // crowded inlet (the Gulf of Mexico, hemmed by Florida + the Caribbean)
  // scores low; one sitting in open water (the empty Pacific off Mexico's west
  // coast) saturates the cap. Callout scoring MAXIMISES this, using leader
  // length only as a tie-break — so a region leaders toward the open sea, not
  // into whichever coast happens to be the shortest hop away. We only probe the
  // outward hemisphere because the inward side always hits the region's own
  // fill immediately (the chip hugs its border), which would flatten every spot.
  const CLEAR_STEP = 6; // px granularity of the openness probe
  const CLEAR_MAX = SHORT_HOP_MAX * 3; // saturation — beyond this it's "open"
  const CLEAR_TOL = CLEAR_STEP; // openness within a probe step counts as a tie
  const clearanceAt = (
    px: number,
    py: number,
    ox: number, // outward unit dir (away from the region)
    oy: number
  ): number => {
    const baseAng = Math.atan2(oy, ox);
    let minClear = CLEAR_MAX;
    // 5 rays spanning the outward hemisphere (baseAng ± 90° in 45° steps).
    for (let k = -2; k <= 2; k++) {
      const a = baseAng + (k * Math.PI) / 4;
      const rx = Math.cos(a);
      const ry = Math.sin(a);
      let d = CLEAR_STEP;
      for (; d <= CLEAR_MAX; d += CLEAR_STEP) {
        const qx = px + rx * d;
        const qy = py + ry * d;
        if (
          qx < FIT_PAD ||
          qy < topPad ||
          qx > width - FIT_PAD ||
          qy > height - FIT_PAD
        )
          break; // ran into the frame — that edge bounds the openness
        if (fillAt(qx, qy) !== water) break; // hit land of any kind
      }
      if (d < minClear) minClear = d;
    }
    return minClear;
  };
  // Try to seat `name`(+`value`) as a short-hop chip for a region centred at
  // (cx,cy) on fill `fill`. Returns the placement (chip rect + leader) or null.
  const tryShortHopCallout = (
    cx: number,
    cy: number,
    fill: string,
    name: string,
    value: string | undefined,
    font: number = FONT,
    gap: number = HOP_GAP,
    maxLen: number = SHORT_HOP_MAX
  ): {
    x: number;
    y: number;
    rect: LabelRect;
    leader: [number, number, number, number];
  } | null => {
    const chipW = stackW(name, value, font);
    const chipH = stackH(value !== undefined, font);
    // Unit vectors — 4 cardinals + 4 diagonals. Diagonals matter: open water
    // often sits off-axis (Mexico's empty sea is WSW), and a pure-cardinal
    // scheme can only aim due-N/S/E/W. Magnitude 1 keeps each walk step = STEP px.
    const D = Math.SQRT1_2; // 0.7071…
    const dirs: Array<[number, number]> = [
      [0, -1], // north
      [0, 1], // south
      [1, 0], // east
      [-1, 0], // west
      [D, -D], // NE
      [D, D], // SE
      [-D, -D], // NW
      [-D, D], // SW
    ];
    let best: {
      x: number;
      y: number;
      rect: LabelRect;
      leader: Leader;
      len: number;
      clear: number;
    } | null = null;
    for (const [dx, dy] of dirs) {
      // Walk from the centroid outward until we leave the region's own fill —
      // that exit point is the border the chip will sit just beyond.
      let ex = cx;
      let ey = cy;
      let steps = 0;
      const maxSteps = Math.ceil(maxLen / STEP) + 1;
      while (steps < maxSteps && fillAt(ex, ey) === fill) {
        ex += dx * STEP;
        ey += dy * STEP;
        steps++;
      }
      if (fillAt(ex, ey) === fill) continue; // never left the region in reach
      // Chip centre sits a gap + half-extent beyond the border along the dir.
      const halfAlong = (Math.abs(dx) * chipW + Math.abs(dy) * chipH) / 2;
      const ccx = ex + dx * (gap + halfAlong);
      const ccy = ey + dy * (gap + halfAlong);
      const rect: LabelRect = {
        x: ccx - chipW / 2,
        y: ccy - chipH / 2,
        w: chipW,
        h: chipH,
      };
      // On-canvas (respect the title band at the top).
      if (
        rect.x < FIT_PAD ||
        rect.y < topPad ||
        rect.x + rect.w > width - FIT_PAD ||
        rect.y + rect.h > height - FIT_PAD
      )
        continue;
      // Every sampled point of the chip must be on EMPTY space (no covering a
      // valued region's data fill). Sample the four corners + centre + edge mids.
      const sx = [rect.x + 2, ccx, rect.x + rect.w - 2];
      const sy = [rect.y + 2, ccy, rect.y + rect.h - 2];
      let onEmpty = true;
      for (const px of sx)
        for (const py of sy)
          if (!isEmptyFill(fillAt(px, py))) {
            onEmpty = false;
            break;
          }
      if (!onEmpty) continue;
      // Clear every already-placed region label / chip, and every POI.
      if (placement.hitsPlaced(rect)) continue;
      if (placement.hitsObstacle(rect)) continue;
      if (placement.hitsMarker(rect)) continue;
      // Leader runs centroid → chip inner edge; cap its length and forbid it
      // from crossing any leader already drawn or any placed label box.
      const innerX = ccx - dx * (chipW / 2);
      const innerY = ccy - dy * (chipH / 2);
      const len = Math.hypot(innerX - cx, innerY - cy);
      if (len > maxLen) continue;
      const leader: Leader = [cx, cy, innerX, innerY];
      if (placement.leaderCrosses(leader)) continue;
      if (placement.leaderHitsPlaced(leader)) continue;
      // Prefer the MOST OPEN spot; fall back to the shortest leader only when
      // two candidates are about equally open (e.g. several open-water spots
      // that all saturate the clearance cap). This is what redirects a label
      // away from a cramped-but-close coast toward the empty sea.
      const clear = clearanceAt(ccx, ccy, dx, dy);
      const better =
        best === null ||
        clear > best.clear + CLEAR_TOL ||
        (clear >= best.clear - CLEAR_TOL && len < best.len);
      if (better)
        best = {
          x: ccx,
          y: ccy,
          rect,
          leader,
          len,
          clear,
        };
    }
    return best
      ? { x: best.x, y: best.y, rect: best.rect, leader: best.leader }
      : null;
  };
  for (const { r, c, boxW, boxH, candidates } of entries) {
    const valStr = regionValueStr(r.value);
    // vs other placed REGION labels (full stack) / vs POI obstacles (name only)
    // — defined up here so the subject pre-pass below can reuse them.
    const fitsRegions = (rect: LabelRect): boolean =>
      !placement.hitsPlaced(rect);
    const fitsPois = (rect: LabelRect): boolean =>
      !placement.hitsObstacle(rect);
    // A SUBJECT is a user-referenced region (the thing the map is ABOUT —
    // `regionById` holds only `resolved.regions`, so an auto-added
    // poiFrameContainer is NOT a subject). A subject must read prominently and
    // NEVER drop: a thin ribbon (Chile) whose centroid sits on a sliver doesn't
    // stamp a cramped name there — it leaders into the open space beside it.
    const isSubject = regionById.has(r.id);
    // Both horizontal extremes of `text` (centred at ax,ay, base font) land on
    // the region's own fill — true in-shape containment. Gates a DATA label's
    // in-place placement so a name that would spill off its own choropleth fill
    // onto a neighbour (where its fill-picked colour is illegible) leaders out
    // instead — which is what lets the data label drop its halo (it can no
    // longer overflow, so `overflows` is false and no rescue stroke is drawn).
    const extremesOnFill = (ax: number, ay: number, text: string): boolean => {
      const halfW = measureLegendText(text, FONT) / 2;
      return (
        fillAt(ax - halfW, ay) === r.fill && fillAt(ax + halfW, ay) === r.fill
      );
    };
    // ── Valueless SUBJECT: prominent in-shape, else leader (the Chile case) ──
    // A user-referenced region with no metric is the map's point and must read
    // PROMINENTLY. Find the largest font (up to a cap) whose full name sits
    // wholly inside the region's own fill at the centroid AND clears every
    // obstacle (other labels, POI markers, route arcs). If that best size meets
    // the prominence floor, place it there in full contrast. If the shape is too
    // thin/small to host a prominent name even at the floor — a ribbon like Chile
    // whose centroid is a sliver — fall through to a leader that carries the
    // full name into the open space beside it. A subject NEVER drops.
    if (isSubject && valStr === undefined && r.label !== undefined) {
      const name = candidates[0]!; // subjects use the full name, never an abbrev
      let best = -1;
      for (let f = SUBJECT_FONT_MAX; f >= FONT; f--) {
        if (measureLegendText(name, f) > boxW || f + 2 * LABEL_PADY > boxH)
          continue;
        const rect = regionLabelRect(c[0], c[1], name, undefined, f);
        if (!fitsRegions(rect) || !fitsPois(rect) || collides(rect)) continue;
        const halfW = measureLegendText(name, f) / 2;
        if (
          fillAt(c[0] - halfW, c[1]) !== r.fill ||
          fillAt(c[0] + halfW, c[1]) !== r.fill
        )
          continue;
        best = f;
        break;
      }
      if (best >= SUBJECT_MIN_PROMINENCE) {
        const rect = regionLabelRect(c[0], c[1], name, undefined, best);
        placement.commit(rect);
        pushRegionLabel(
          c[0],
          c[1],
          name,
          r.fill,
          r.lineNumber,
          undefined,
          best
        );
        labeledRegionIds.add(r.id);
        regionLabelGuards.push({ label: labels[labels.length - 1]!, rect });
      } else {
        // The shape can't host a prominent name (Chile's ribbon) → leader the
        // name into the open space beside it at a PROMINENT size, pushed well
        // clear of the coast (a larger gap + reach) so it reads as the subject,
        // not a cramped afterthought.
        const hop = tryShortHopCallout(
          c[0],
          c[1],
          r.fill,
          r.label,
          undefined,
          SUBJECT_LEADER_FONT,
          HOP_GAP + SUBJECT_LEADER_FONT,
          SHORT_HOP_MAX * 2.2
        );
        if (hop) {
          placement.commit(hop.rect, hop.leader);
          const dark = mix(r.fill, palette.text, 60);
          labels.push({
            x: hop.x,
            y: hop.y,
            text: r.label,
            anchor: 'middle',
            color: palette.text,
            halo: false,
            haloColor: palette.bg,
            fontSize: SUBJECT_LEADER_FONT,
            leader: {
              x1: hop.leader[0],
              y1: hop.leader[1],
              x2: hop.leader[2],
              y2: hop.leader[3],
            },
            leaderColor: dark,
            calloutDot: { x: c[0], y: c[1], color: dark },
            lineNumber: r.lineNumber,
          });
          labeledRegionIds.add(r.id);
        }
      }
      continue;
    }
    // The first candidate that BOTH fits its own footprint AND clears every
    // already-placed region label AND every POI marker wins; none qualifies →
    // the label is hidden (a country has no abbrev, so it degrades full → hide;
    // a US state may fall back to its 2-letter code before hiding).
    // When the region carries a metric value, the name+value STACK is tried
    // first; if the stack won't fit (a smaller state), it degrades to the bare
    // name (today's behaviour) so adding values never costs an existing label.
    //
    // Two collision tests, deliberately different footprints:
    //  - vs other REGION labels: use the FULL stack rect (two stacks must not
    //    overlap).
    //  - vs POI obstacles: use only the NAME rect. A POI obstacle exists to keep
    //    the region NAME off a POI's dot/label; the (shorter, dimmer) value line
    //    hanging below a name that already clears the dot is fine. Testing the
    //    taller stack here made a region with a nearby POI (Texas under the big
    //    Dallas marker) silently drop its value even though the name fit.
    // Try the centroid first (existing placement — unchanged when it fits),
    // then a ring of offsets WITHIN the region's box so a label blocked at the
    // centroid (typically a POI marker sitting on it — Dallas on Texas) is
    // re-seated on open land of the SAME region rather than exiled to a far
    // callout column. Off-centroid anchors are kept on the region's own fill
    // (fillAt) so the label never drifts onto a neighbour or the sea.
    // Centroid is always tried. The off-centroid re-seat ring is added ONLY for
    // a region that carries a value — the point of seeking is to not lose the
    // region's VALUE to a POI on its centroid. A valueless frame container
    // (e.g. the state hosting a POI hub) keeps the old behaviour: it yields the
    // spot to the POI rather than sprouting a re-seated name near the hub.
    const seekAnchors: Array<{ x: number; y: number; guard: boolean }> = [
      { x: c[0], y: c[1], guard: false },
    ];
    if (valStr) {
      seekAnchors.push(
        { x: c[0], y: c[1] + boxH * 0.26, guard: true },
        { x: c[0], y: c[1] - boxH * 0.26, guard: true },
        { x: c[0] + boxW * 0.26, y: c[1], guard: true },
        { x: c[0] - boxW * 0.26, y: c[1], guard: true },
        { x: c[0] + boxW * 0.22, y: c[1] + boxH * 0.22, guard: true },
        { x: c[0] - boxW * 0.22, y: c[1] + boxH * 0.22, guard: true },
        { x: c[0] + boxW * 0.22, y: c[1] - boxH * 0.22, guard: true },
        { x: c[0] - boxW * 0.22, y: c[1] - boxH * 0.22, guard: true }
      );
    }
    let chosen:
      | { text: string; valueLine?: string; ax: number; ay: number }
      | undefined;
    for (const a of seekAnchors) {
      if (a.guard && fillAt(a.x, a.y) !== r.fill) continue;
      for (const t of candidates) {
        const nameRect = regionLabelRect(a.x, a.y, t);
        if (valStr && stackW(t, valStr) <= boxW && stackH(true) <= boxH) {
          const stackRect = regionLabelRect(a.x, a.y, t, valStr);
          if (
            fitsRegions(stackRect) &&
            fitsPois(nameRect) &&
            extremesOnFill(a.x, a.y, t)
          ) {
            chosen = { text: t, valueLine: valStr, ax: a.x, ay: a.y };
            break;
          }
        }
        if (labelW(t) <= boxW && labelH <= boxH) {
          // A data label must sit inside its own choropleth fill (so it can drop
          // the halo); a context/container label keeps the looser bbox fit.
          if (
            fitsRegions(nameRect) &&
            fitsPois(nameRect) &&
            (valStr === undefined || extremesOnFill(a.x, a.y, t))
          ) {
            chosen = { text: t, ax: a.x, ay: a.y };
            break;
          }
        }
      }
      if (chosen) break;
    }
    if (chosen === undefined && r.label !== undefined && isSubject) {
      // A SUBJECT whose name won't sit inside its own shape — a thin ribbon
      // (Chile) or a small valued region crowded by a POI. Rather than overflow
      // onto neighbours (illegible) or fire a long leader to a margin column
      // (spaghetti), nudge the FULL name(+value) chip a short hop into the open
      // space right beside it — out to sea, north over Canada, south over Mexico
      // — joined by a tiny non-crossing leader. A subject is the map's point, so
      // it gets this leader whether or not it carries a value. If no direction
      // has clean adjacent room within reach, the region gets no static label
      // (the shading/legend + hover carry it); a readable blank beats a tangle.
      const hop = tryShortHopCallout(c[0], c[1], r.fill, r.label, valStr);
      if (hop) {
        placement.commit(hop.rect, hop.leader);
        // Chip sits on empty land / water (the callout only seats on isEmptyFill)
        // → palette text, NO halo (full-contrast dark/light text reads cleanly on
        // the light basemap; the leader + dot tie the line back to the region).
        const dark = mix(r.fill, palette.text, 60);
        labels.push({
          x: hop.x,
          y: hop.y,
          text: r.label,
          anchor: 'middle',
          color: palette.text,
          halo: false,
          haloColor: palette.bg,
          ...(valStr !== undefined && { valueLine: valStr }),
          leader: {
            x1: hop.leader[0],
            y1: hop.leader[1],
            x2: hop.leader[2],
            y2: hop.leader[3],
          },
          leaderColor: dark,
          calloutDot: { x: c[0], y: c[1], color: dark },
          lineNumber: r.lineNumber,
        });
        labeledRegionIds.add(r.id);
      }
      continue;
    }
    // Nothing placed (a valueless region that didn't fit, or a valued region
    // with no clean adjacent space) → drop, leaving the map clean.
    if (chosen === undefined) continue;
    // Footprint-driven growth applies ONLY to orientation backdrop names — a
    // data-less neighbour/frame region (Canada framing a POI, foreign land).
    // DATA labels (a choropleth value) keep the base font + full contrast and
    // the existing fit-inside cascade UNCHANGED: fading a value washed it
    // lighter than its own region fill, and a loose bbox let a wide name
    // ("United States of America") spill past its region. Orientation names sit
    // on neutral basemap land where a larger, gently-faded backdrop reads well.
    const isOrient = r.value === undefined && r.layer === 'base';
    let font = FONT;
    if (isOrient) {
      const growT = sizeT(boxW, boxH);
      const desiredFont = Math.round(
        FONT + growT * (REGION_FONT_MAX_ORIENT - FONT)
      );
      const hasVal = chosen.valueLine !== undefined;
      // A backdrop name carries NO halo, so it must sit cleanly at whatever size
      // it takes. Try the desired (footprint-grown) size DOWN TO the base font;
      // at each, the name must fit the box, clear neighbours/POIs/route arcs
      // (`collides` adds the arc segments `fitsPois` misses), AND have both
      // horizontal extremes on a floored-readable substrate — its own fill, or
      // empty land/water (neutral/foreign/sea). The only thing it must NOT cross
      // is a saturated foreign DATA fill, where the muted floored tone is
      // illegible and there's no halo to rescue it. If nothing — not even the
      // base font — sits clean, the label is DROPPED (the basemap shading +
      // hover carry the region); a readable blank beats an unreadable name.
      const extremesClean = (f: number): boolean => {
        const halfW = measureLegendText(chosen.text, f) / 2;
        return [chosen.ax - halfW, chosen.ax + halfW].every((sx) => {
          const fAt = fillAt(sx, chosen.ay);
          return fAt === r.fill || isEmptyFill(fAt);
        });
      };
      let fit = -1;
      for (let f = desiredFont; f >= FONT; f--) {
        if (
          stackW(chosen.text, chosen.valueLine, f) > boxW ||
          stackH(hasVal, f) > boxH
        )
          continue;
        const gRect = regionLabelRect(
          chosen.ax,
          chosen.ay,
          chosen.text,
          chosen.valueLine,
          f
        );
        const gName = regionLabelRect(
          chosen.ax,
          chosen.ay,
          chosen.text,
          undefined,
          f
        );
        if (!fitsRegions(gRect) || !fitsPois(gName) || collides(gName))
          continue;
        if (!extremesClean(f)) continue;
        fit = f;
        break;
      }
      if (fit < 0) {
        // A POI-frame CONTAINER is the map's subject (its headline name) — it
        // must never drop, so it falls back to the base font even when no size
        // sits perfectly clean (the floored tone keeps it legible). A mere
        // backdrop NEIGHBOUR with no clean placement is dropped: the basemap
        // shading + hover carry it, and a readable blank beats a name crammed
        // onto an arc or a foreign data fill.
        if (!frameContainers.has(r.id)) continue;
        font = FONT;
      } else {
        font = fit;
      }
    }
    const rRect = regionLabelRect(
      chosen.ax,
      chosen.ay,
      chosen.text,
      chosen.valueLine,
      font
    );
    placement.commit(rRect);
    pushRegionLabel(
      chosen.ax,
      chosen.ay,
      chosen.text,
      r.fill,
      r.lineNumber,
      chosen.valueLine,
      font,
      isOrient ? backdropLandTone : undefined
    );
    labeledRegionIds.add(r.id);
    // Guard so a POI label landing here later makes this label yield (below).
    regionLabelGuards.push({
      label: labels[labels.length - 1]!,
      rect: rRect,
    });
  }
  // AK/HI labels live in their insets (own projection centroids). Insets are
  // tiny, so prefer the abbreviation when the canvas is compact.
  for (const seed of insetLabelSeeds) {
    const text = isCompact ? seed.iso.replace(/^US-/, '') : seed.name;
    const src = regionById.get(seed.iso);
    const valStr = regionValueStr(src?.value);
    pushRegionLabel(
      seed.x,
      seed.y,
      text,
      src ? regionFill(src) : neutralFill,
      seed.lineNumber,
      valStr
    );
    labeledRegionIds.add(seed.iso);
    regionLabelGuards.push({
      label: labels[labels.length - 1]!,
      rect: regionLabelRect(seed.x, seed.y, text, valStr),
    });
  }
}

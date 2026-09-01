// ============================================================
// Sketch — what colour a node, a container or a line is
// ============================================================
//
// 🔴 ONE answer, for the renderer AND for the app's live canvas. This lived
// inside `renderer.ts` as a closure while dgmo was the only thing drawing a
// sketch. The app draws the same chart type by hand — it is the only drawing
// surface here that is not a renderer — and had invented its own: the raw tag
// colour at 25% alpha for a shape and 12% for a container, against `shapeFill`'s
// opaque blend here.
//
// That is not a near miss, it is a different model. `shapeFill` PRE-MIXES the
// tag colour into the theme's base and paints the result opaque, so nothing
// behind a node reaches the eye. Alpha only matches it when what sits behind
// happens to be the page background — and inside a tinted container it does
// not, so the container bled through every child (reported 2026-08-27, #516).
//
// Exported so the app cites it rather than restating it, for the same reason
// `SKETCH_VISUALS` and `FONT_FAMILY` are.

import type { PaletteColors } from '../palettes';
import {
  contrastText,
  groupFill,
  groupStroke,
  mix,
  shapeFill,
  themeBaseBg,
} from '../palettes/color-utils';
import type { TagGroup } from '../utils/tag-groups';
import {
  resolveActiveTagGroup,
  resolveGroupTagColor,
  resolveTagColor,
  tagAttrKey,
} from '../utils/tag-groups';

export interface SketchNodeColors {
  readonly fill: string;
  readonly stroke: string;
  readonly text: string;
}

/** How a sketch fills its shapes — the `fill-mode` option, verbatim. */
export type SketchFillMode = 'solid' | 'outline' | undefined;

/**
 * 🔴 Containers are painted at this, over an opaque node fill. dgmo's own
 * number (`renderer.ts`), here so the app cannot pick a different one — it had
 * 0.12 against this 0.4, which is most of why a group read as a wash rather
 * than a frame.
 */
export const CONTAINER_FILL_OPACITY = 1;
/** A container's outline, which is far softer than a node's — `boxes-and-lines`
 *  gives the same object exactly this. */
export const CONTAINER_STROKE_OPACITY = 0.35;
/** And its stroke width: a plain 1, not a node's. */
export const CONTAINER_STROKE_WIDTH = 1;

/**
 * An UNTAGGED container's surface — the library's neutral group fill.
 *
 * 🔴 It is `groupFill` with no colour, delegated rather than restated, because
 * the two were the same expression written twice and the whole point of #619 is
 * that sketch stopped having its own answer here.
 *
 * ⚠️ The name is now narrower than it reads: a container that CARRIES a value
 * does not come through here at all — see the container branch of
 * `sketchColors`. This stays exported for the app's live canvas, which asks for
 * the neutral fill directly when it is drawing a frame nothing has classified.
 *
 * The history is worth keeping, because it is why sketch was the last chart
 * type left out. Sketch used to paint a whole group in its own tag at 0.4, so a
 * tagged group was a wash with everything inside it swimming in that wash, and
 * a sketch beside a `boxes-and-lines` chart of the same content did not read as
 * the same product (reported 2026-08-27). The fix was to make a container
 * neutral *whatever it carried* — which overshot: the group-frame sweep for
 * diagrammo/diagrammo#585 gave five other chart types a **tenth**, not a
 * fortieth, and a coloured stroke to carry the meaning. That is what the frame
 * wears now, and the wash cannot come back at 10%.
 */
export function sketchContainerFill(
  palette: PaletteColors,
  isDark: boolean
): string {
  return groupFill(palette, isDark);
}

/**
 * Untagged shapes still read as filled cards, not empty outlines: a slight gray
 * tint (muted mixed into the bg) — subtle on light, a touch lighter than the bg
 * on dark.
 */
export function sketchNeutralFill(
  palette: PaletteColors,
  isDark: boolean,
  fillMode: SketchFillMode
): string {
  return fillMode === 'outline'
    ? themeBaseBg(palette, isDark)
    : mix(palette.textMuted, palette.bg, 12);
}

/**
 * The colours one thing on a sketch wears, given what it carries.
 *
 * Returns a function rather than a value because every node on a board asks the
 * same question against the same active group, and resolving that group once is
 * the whole point.
 */
export function sketchColors(opts: {
  readonly palette: PaletteColors;
  readonly isDark: boolean;
  readonly tagGroups: readonly TagGroup[];
  /** The group the legend says is active, or undefined to let dgmo choose. */
  readonly activeTagGroup?: string | null | undefined;
  readonly fillMode: SketchFillMode;
}): (
  metadata: Record<string, string>,
  isContainer?: boolean
) => SketchNodeColors {
  const { palette, isDark, fillMode } = opts;
  const neutralFill = sketchNeutralFill(palette, isDark, fillMode);
  const tagGroups = [...opts.tagGroups];
  const activeName = resolveActiveTagGroup(
    tagGroups,
    undefined,
    opts.activeTagGroup ?? undefined
  );
  const activeKey = activeName === null ? null : tagAttrKey(activeName);

  return (metadata, isContainer = false) => {
    // 🔴 A container takes its OWN tag value, through the same two functions
    // boxes-and-lines, infra, c4, state and pert go through (#619). Sketch was
    // the one chart type still refusing this, while its own spec section said
    // "**Taggable**: the frame tints and the tag **cascades** to children" and
    // §1 said it universally — so a tagged group and an untagged one rendered
    // byte-identical, and dropping a colour on a group did nothing you could
    // see.
    //
    // 🔴 CONTAINER resolution: `resolveGroupTagColor` withholds the tag group's
    // `defaultValue`, so a frame colours only where the author wrote a value on
    // the group line. Without that every untagged frame on the board wears the
    // first entry's colour, which is worse than the uncoloured frames this
    // fixes.
    //
    // The text stays `palette.text`: the tint is a tenth, which is nowhere near
    // heavy enough to need `contrastText` the way a node's 25% fill does.
    if (isContainer) {
      const groupColor = resolveGroupTagColor(metadata, tagGroups, activeName);
      return {
        fill: groupFill(palette, isDark, groupColor),
        stroke: groupStroke(palette, groupColor),
        text: palette.text,
      };
    }
    const tagged = activeKey !== null && metadata[activeKey] !== undefined;
    const tagColor = tagged
      ? resolveTagColor(metadata, tagGroups, activeName, isContainer)
      : undefined;
    if (!tagColor) {
      return {
        fill: neutralFill,
        // 🔴 The same expression `boxes-and-lines` gives an untagged node
        // (`renderer.ts`): a softened text colour, not `palette.textMuted`.
        // Muted is a good deal darker, and at the shared stroke width it made
        // an untagged sketch card the most heavily outlined object in the
        // product (2026-08-27).
        stroke: mix(palette.text, palette.bg, isDark ? 60 : 40),
        text: palette.text,
      };
    }
    const fill = shapeFill(palette, tagColor, isDark, { mode: fillMode });
    return {
      fill,
      stroke: tagColor,
      // 🔴 CONTRAST-DERIVED, like every other chart type. This took the tag
      // colour itself in the default and `outline` modes, which made sketch the
      // only chart in the product whose labels are tinted — and on the 25% blend
      // a card is filled with, that is pale-green text on a pale-green card.
      // `boxes-and-lines` and `org` both derive it from the fill and land on one
      // of two neutral tokens; sketch now does the same, in every mode rather
      // than only `solid`.
      text: contrastText(fill, palette.textOnFillLight, palette.textOnFillDark),
    };
  };
}

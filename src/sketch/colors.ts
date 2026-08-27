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
  mix,
  shapeFill,
  themeBaseBg,
} from '../palettes/color-utils';
import type { TagGroup } from '../utils/tag-groups';
import {
  resolveActiveTagGroup,
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
export const CONTAINER_FILL_OPACITY = 0.4;
/** Likewise for a container's outline, which is softer than a node's. */
export const CONTAINER_STROKE_OPACITY = 0.7;

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
    const tagged = activeKey !== null && metadata[activeKey] !== undefined;
    const tagColor = tagged
      ? resolveTagColor(metadata, tagGroups, activeName, isContainer)
      : undefined;
    if (!tagColor) {
      return {
        fill: neutralFill,
        stroke: palette.textMuted,
        text: palette.text,
      };
    }
    const fill = shapeFill(palette, tagColor, isDark, { mode: fillMode });
    return {
      fill,
      stroke: tagColor,
      // Label text takes the shape's own (tag) color — but for solid fills the
      // tag color would vanish into the fill, so keep a contrast color there.
      text:
        fillMode === 'solid'
          ? contrastText(fill, palette.textOnFillLight, palette.textOnFillDark)
          : tagColor,
    };
  };
}

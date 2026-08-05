import { measureLegendText } from '../utils/legend-constants';

/** Base label font size (px). */
export const FONT = 11;

export const LABEL_PADX = 6;
export const LABEL_PADY = 3;
/** The value line is ~0.82× the name size; a hair of vertical gap separates them. */
export const VALUE_GAP = 1;
/** The value line's size relative to its name. */
const VALUE_FONT_FRAC = 0.82;

// Footprint-driven label growth (size-up + fade), gradual + resolution-free.
// Applies to ORIENTATION backdrop names ONLY (neighbour land / frame
// containers with no data value): a big one reads as a large, gently-faded
// backdrop, a small one stays at the base font. DATA labels are deliberately
// EXCLUDED — fading a choropleth value washes it lighter than its own fill and
// a loose bbox overran irregular regions. Size scales with the region's
// projected footprint as a fraction of the canvas's linear extent. Growth runs
// AFTER the base-font fit cascade picks the text+anchor, and only while the
// larger glyphs still fit the box, clear neighbours/POIs, and stay inside the
// region's own fill.
export const REGION_FONT_MAX_ORIENT = 22; // px ceiling, backdrop names
const REGION_SIZE_FRAC_MIN = 0.06; // footprint linear-frac at base font
const REGION_SIZE_FRAC_MAX = 0.32; // footprint linear-frac at max font

// A valueless SUBJECT (referenced, no metric) grows up to this ceiling in-shape;
// if it can't host its name at least at the prominence FLOOR inside its own fill
// (a thin ribbon like Chile), it leaders into the open space instead.
export const SUBJECT_FONT_MAX = 18; // px ceiling for a prominent in-shape subject name
export const SUBJECT_MIN_PROMINENCE = 13; // px floor below which a subject leaders out
export const SUBJECT_LEADER_FONT = 15; // px for a leadered subject chip (Chile in the sea)

/**
 * Text measurement for map labels, at whatever font a fit cascade is trying.
 *
 * Every member is a pure function of its arguments and the canvas size. The
 * reason this is a factory rather than free functions is `sizeT`, which needs
 * the canvas's linear extent, and passing that to each call site separately is
 * how it drifts.
 *
 * Every member is a function PROPERTY, not a method, so destructuring one off
 * the object can never strip a `this` it needs — the implementations are
 * closures over the canvas size and reference no receiver.
 */
export interface LabelMetrics {
  /** Width of a single line of text at `font`, including horizontal padding. */
  readonly labelW: (text: string, font?: number) => number;
  /** Height of a single line at the base font, including vertical padding. */
  readonly labelH: number;
  /** Footprint of a name (+optional value) stack used for the box-fit cascade. */
  readonly stackW: (text: string, valueText?: string, font?: number) => number;
  readonly stackH: (hasValue: boolean, font?: number) => number;
  /**
   * 0→1 growth factor for a region's footprint: 0 at the base font, 1 at the
   * ceiling. Zero for anything smaller than the minimum fraction of the canvas.
   */
  readonly sizeT: (boxW: number, boxH: number) => number;
}

export function createLabelMetrics(size: {
  readonly width: number;
  readonly height: number;
}): LabelMetrics {
  const canvasLinear = Math.sqrt(Math.max(1, size.width * size.height));

  const labelW = (text: string, font: number = FONT): number =>
    measureLegendText(text, font) + 2 * LABEL_PADX;

  return {
    labelW,
    labelH: FONT + 2 * LABEL_PADY,
    // `font` defaults to the base size (every existing call is byte-identical);
    // the post-placement growth pass passes a larger size to test an upscaled fit.
    stackW: (text, valueText, font = FONT) =>
      Math.max(
        labelW(text, font),
        valueText
          ? measureLegendText(valueText, Math.round(font * VALUE_FONT_FRAC)) +
              2 * LABEL_PADX
          : 0
      ),
    stackH: (hasValue, font = FONT) => {
      const lh = font + 2 * LABEL_PADY;
      return hasValue
        ? lh + VALUE_GAP + Math.round(font * VALUE_FONT_FRAC)
        : lh;
    },
    sizeT: (boxW, boxH) => {
      const frac = Math.sqrt(Math.max(0, boxW * boxH)) / canvasLinear;
      return Math.min(
        1,
        Math.max(
          0,
          (frac - REGION_SIZE_FRAC_MIN) /
            (REGION_SIZE_FRAC_MAX - REGION_SIZE_FRAC_MIN)
        )
      );
    },
  };
}

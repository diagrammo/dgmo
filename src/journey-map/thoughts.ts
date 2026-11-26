import { measureText, wrapTextToWidth } from '../utils/text-measure';

// Static thought bubbles: drawn above each thought-bearing face in export
// renders. Layout and renderer share this plan so the reserved headroom always
// matches what is drawn.

export const THOUGHT_FONT = 11;
export const THOUGHT_PAD_X = 10;
export const THOUGHT_PAD_Y = 6;
export const THOUGHT_MAX_W = 200;
export const THOUGHT_LINE_H = 14;
export const THOUGHT_GAP = 10;

const FACE_R = 15; // FACE_RADIUS + 1 (ring)
const CAPTION_HALF_W = 40;
const CAPTION_H = 30;
const MARGIN = 4;
const STAGGER_STEP = 8;
const MAX_STEPS = 60;
// The score-1 face sits near the bottom of the plot; the plot's own left and
// right padding bound the bubble horizontally.
export interface ThoughtFacePoint {
  x: number;
  y: number;
  hasCaption: boolean;
  thought?: string | undefined;
  key: number;
}

export interface ThoughtBubble {
  key: number;
  faceX: number;
  faceY: number;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
}

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const hit = (a: Rect, b: Rect) =>
  a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

/**
 * Place each bubble above its face. Bubbles that would touch a neighbour's
 * bubble, connector, face or emotion caption are lifted in small steps until
 * they clear. Y is unclamped, so the caller can read the topmost edge.
 */
export function planThoughtBubbles(
  points: readonly ThoughtFacePoint[],
  totalWidth: number,
  padding: number
): ThoughtBubble[] {
  const faceRects = (p: ThoughtFacePoint): Rect[] => {
    const r: Rect[] = [
      {
        x1: p.x - FACE_R,
        y1: p.y - FACE_R,
        x2: p.x + FACE_R,
        y2: p.y + FACE_R,
      },
    ];
    if (p.hasCaption) {
      r.push({
        x1: p.x - CAPTION_HALF_W,
        y1: p.y + FACE_R,
        x2: p.x + CAPTION_HALF_W,
        y2: p.y + FACE_R + CAPTION_H,
      });
    }
    return r;
  };

  const placed: ThoughtBubble[] = [];
  const placedRects: Rect[] = [];
  const sorted = [...points].sort((a, b) => a.x - b.x);

  for (const p of sorted) {
    if (!p.thought) continue;
    const lines = wrapTextToWidth(p.thought, THOUGHT_FONT, THOUGHT_MAX_W);
    const textW = Math.min(
      THOUGHT_MAX_W,
      Math.max(...lines.map((l) => measureText(l, THOUGHT_FONT)))
    );
    const w = textW + THOUGHT_PAD_X * 2;
    const h = lines.length * THOUGHT_LINE_H + THOUGHT_PAD_Y * 2;
    const x = Math.max(
      padding,
      Math.min(p.x - w / 2, totalWidth - padding - w)
    );
    const faceTop = p.y - FACE_R;

    const obstacles: Rect[] = [
      ...points.filter((o) => o.key !== p.key).flatMap(faceRects),
      ...placedRects,
    ];

    let y = faceTop - THOUGHT_GAP - h;
    for (let i = 0; i < MAX_STEPS; i++) {
      const box: Rect = {
        x1: x - MARGIN,
        y1: y - MARGIN,
        x2: x + w + MARGIN,
        y2: y + h + MARGIN,
      };
      const conn: Rect = {
        x1: p.x - 2,
        y1: y + h,
        x2: p.x + 2,
        y2: faceTop,
      };
      if (!obstacles.some((o) => hit(o, box) || hit(o, conn))) break;
      y -= STAGGER_STEP;
    }

    placed.push({
      key: p.key,
      faceX: p.x,
      faceY: p.y,
      x,
      y,
      w,
      h,
      lines,
    });
    placedRects.push(
      { x1: x, y1: y, x2: x + w, y2: y + h },
      { x1: p.x - 2, y1: y + h, x2: p.x + 2, y2: faceTop }
    );
  }
  return placed;
}

interface PointLike {
  x: number;
  y: number;
  emotionLabel?: string | undefined;
  stepIndex: number;
}
interface StepLike {
  annotations: readonly { type: string; text: string }[];
}

/** Plan the bubbles for a journey's curve points and its flat step list. */
export function planJourneyThoughts(
  curvePoints: readonly PointLike[],
  steps: readonly StepLike[],
  totalWidth: number,
  padding: number
): ThoughtBubble[] {
  return planThoughtBubbles(
    curvePoints.map((pt) => {
      const thoughts = steps[pt.stepIndex]?.annotations.filter(
        (a) => a.type === 'thought'
      );
      return {
        x: pt.x,
        y: pt.y,
        hasCaption: pt.emotionLabel !== undefined,
        thought: thoughts?.length
          ? thoughts.map((t) => t.text).join(' \u2022 ')
          : undefined,
        key: pt.stepIndex,
      };
    }),
    totalWidth,
    padding
  );
}

/**
 * Annotations a step card lists. A static render draws each scored step's
 * thoughts as a bubble above its face, so the card leaves them out there.
 * Unscored steps have no face, so their card keeps the thought.
 */
export function cardAnnotations<T extends { type: string }>(
  step: { score?: number | undefined; annotations: readonly T[] },
  staticRender: boolean
): readonly T[] {
  if (!staticRender || step.score === undefined) return step.annotations;
  return step.annotations.filter((a) => a.type !== 'thought');
}

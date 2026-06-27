import type { PaletteColors } from '../palettes';
import { mix, shapeFill } from '../palettes/color-utils';
import { measureText, wrapTextToWidth } from '../utils/text-measure';
import type {
  ParsedJourneyMap,
  JourneyMapPhase,
  JourneyMapStep,
} from './types';

// ============================================================
// Layout Types
// ============================================================

export interface CurvePoint {
  x: number;
  y: number;
  score: number;
  emotionLabel?: string;
  stepIndex: number;
}

export interface StepLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  step: JourneyMapStep;
  color: string;
}

interface PhaseLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  phase: JourneyMapPhase;
  headerColor: string;
  stepLayouts: StepLayout[];
}

export interface JourneyMapLayout {
  phases: PhaseLayout[];
  flatStepLayouts: StepLayout[];
  curvePoints: CurvePoint[];
  totalWidth: number;
  totalHeight: number;
  curveAreaTop: number;
  curveAreaBottom: number;
  cardAreaTop: number;
  personaHeight: number;
  titleHeight: number;
  /** Whether any step has thought annotations */
  hasThoughts: boolean;
}

// ============================================================
// Constants
// ============================================================

const PADDING = 24;
const TITLE_HEIGHT = 36;
const PERSONA_HEIGHT = 48;
// Must match renderer.ts persona panel width
const PERSONA_PANEL_WIDTH = 280;
const HEADER_GAP = 24;
const CURVE_AREA_HEIGHT = 260;
const CARD_GAP = 8;
const STEP_CARD_WIDTH = 190;
const CARD_HEADER_HEIGHT = 24;
const CARD_META_LINE_HEIGHT = 14;
const PHASE_HEADER_HEIGHT = 36;
const CARD_PADDING_X = 10;
const CARD_PADDING_Y = 6;
const ANNO_ICON_SIZE = 10;
const ANNO_ICON_GAP = 4;
export const TAG_STRIP_HEIGHT = 18;
const PHASE_GAP = 16;
const COLUMN_PADDING = 12;
const FACE_ICON_SIZE = 20;
// Extra room reserved below the curve band for emotion captions (which hang
// beneath the lowest face) so they clear the phase header bar.
const EMOTION_CAPTION_BAND = 18;

// ============================================================
// Score-to-color
// ============================================================

export function scoreToColor(score: number, palette: PaletteColors): string {
  // Diverging red → amber → green ramp (RAG). A straight red→green sRGB lerp
  // muddies the midrange into olive/brown; routing through yellow at score 3
  // keeps the negative/neutral faces clean amber instead.
  const s = Math.max(1, Math.min(5, score));
  const { red, yellow, green } = palette.colors;
  return s <= 3
    ? mix(yellow, red, ((s - 1) / 2) * 100) // 1→red, 3→yellow
    : mix(green, yellow, ((s - 3) / 2) * 100); // 3→yellow, 5→green
}

// Vertical headroom reserved at the top of the curve area (px). Keep faces
// off the very edge while still using the full height.
const CURVE_TOP_RESERVE = 20;

// Map an emotion score (1-5) to a y coordinate within the curve area. Shared
// by the curve points and the grid lines so both stay on the same scale.
export function scoreToCurveY(score: number, curveAreaBottom: number): number {
  return (
    curveAreaBottom -
    ((score - 1) / 4) * (CURVE_AREA_HEIGHT - CURVE_TOP_RESERVE) -
    10
  );
}

// ============================================================
// Layout Engine
// ============================================================

export function layoutJourneyMap(
  parsed: ParsedJourneyMap,
  palette: PaletteColors,
  options?: {
    exportDims?: { width: number; height: number };
    collapsedPhases?: Set<string>;
    isDark?: boolean;
  }
): JourneyMapLayout {
  const isDark = options?.isDark ?? false;
  const hasTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  const hasPersona = !!parsed.persona;
  const hasPhases = parsed.phases.length > 0;

  const titleHeight = hasTitle ? TITLE_HEIGHT : 0;
  const personaHeight = hasPersona ? PERSONA_HEIGHT : 0;

  // Thought bubbles render as overlays on hover — no reserved vertical space
  const allStepsForThoughts = hasPhases
    ? parsed.phases.flatMap((p) => p.steps)
    : parsed.steps;
  const hasThoughts = allStepsForThoughts.some((s) =>
    s.annotations.some((a) => a.type === 'thought')
  );

  // Emotion captions render below their face. The score-1 face sits at the very
  // bottom of the curve band, so without reserved room its caption collides with
  // the phase header bar just below. Reserve a caption band in the curve→card gap
  // whenever any scored step carries an emotion label.
  const hasEmotions = allStepsForThoughts.some(
    (s) => s.score !== undefined && s.emotionLabel !== undefined
  );

  // Reserve top headroom so an expanded thought bubble — which always pops
  // ABOVE its face — clears the title + persona band, even when it hangs above
  // the highest (score-5) face. Mirrors the renderer's bubble metrics.
  const baseTop = PADDING + titleHeight + personaHeight;
  let topHeadroom = 0;
  if (hasThoughts) {
    const THOUGHT_MAX_W = 200;
    const THOUGHT_FONT = 11;
    const THOUGHT_LINE_H = 14;
    const THOUGHT_PAD_Y = 6;
    const THOUGHT_GAP = 10;
    const FACE_HOVER_R = (14 + 1) * 1.5; // (FACE_RADIUS + 1) * FACE_HOVER_SCALE
    const PERSONA_DESC_FONT = 10; // FONT_SIZE_META in the renderer
    const PERSONA_SILHOUETTE = 60;
    const BUBBLE_MARGIN = 16;

    // Tallest thought bubble + the highest face that carries a thought.
    let maxBubbleH = 0;
    let topThoughtScore = 1;
    for (const s of allStepsForThoughts) {
      const thoughts = s.annotations.filter((a) => a.type === 'thought');
      if (thoughts.length === 0) continue;
      const text = thoughts.map((t) => t.text).join(' • ');
      const lineCount = wrapTextToWidth(
        text,
        THOUGHT_FONT,
        THOUGHT_MAX_W
      ).length;
      maxBubbleH = Math.max(
        maxBubbleH,
        lineCount * THOUGHT_LINE_H + THOUGHT_PAD_Y * 2
      );
      if (s.score !== undefined) {
        topThoughtScore = Math.max(topThoughtScore, s.score);
      }
    }

    // Actual persona card height — the PERSONA_HEIGHT reservation underestimates
    // a multi-line description, so measure it for an honest band bottom.
    let personaActualH = personaHeight;
    if (hasPersona && parsed.persona?.description) {
      const textAreaWidth =
        PERSONA_PANEL_WIDTH - PERSONA_SILHOUETTE - CARD_PADDING_X;
      const descLineCount = wrapTextToWidth(
        parsed.persona.description,
        PERSONA_DESC_FONT,
        textAreaWidth
      ).length;
      personaActualH = CARD_HEADER_HEIGHT + descLineCount * 14 + 8;
    }
    const topBandBottom = PADDING + Math.max(titleHeight, personaActualH);

    // Where the highest thought-bearing face would sit with zero headroom, and
    // where its bubble's top edge would land. Shift down by any shortfall.
    const faceY0 = scoreToCurveY(topThoughtScore, baseTop + CURVE_AREA_HEIGHT);
    const bubbleTop0 = faceY0 - FACE_HOVER_R - THOUGHT_GAP - maxBubbleH;
    topHeadroom = Math.max(0, topBandBottom + BUBBLE_MARGIN - bubbleTop0);
  }

  const curveAreaTop = baseTop + topHeadroom;
  const curveAreaBottom = curveAreaTop + CURVE_AREA_HEIGHT;
  const cardAreaTop =
    curveAreaBottom + PADDING + (hasEmotions ? EMOTION_CAPTION_BAND : 0);

  const allSteps = hasPhases
    ? parsed.phases.flatMap((p) => p.steps)
    : parsed.steps;

  // Compute step card heights based on content (matches kanban card sizing).
  // Line counts route through the same `wrapTextToWidth` the renderer uses,
  // at the same font sizes, so reserved height always matches rendered text.
  const annoIconIndent = ANNO_ICON_SIZE + ANNO_ICON_GAP;
  const annoTextW = STEP_CARD_WIDTH - CARD_PADDING_X * 2 - annoIconIndent;
  const descTextWidth = STEP_CARD_WIDTH - CARD_PADDING_X * 2;
  const FONT_SIZE_META = 10; // renderer FONT_SIZE_META (desc/anno)
  const FONT_SIZE_STEP = 12; // renderer FONT_SIZE_STEP (title)

  const titleTextWidth = STEP_CARD_WIDTH - CARD_PADDING_X * 2;
  const TITLE_LINE_HEIGHT = 16;

  const stepHeights = allSteps.map((step) => {
    const titleLines = wrapTextToWidth(
      step.title,
      FONT_SIZE_STEP,
      titleTextWidth
    ).length;
    let h = CARD_PADDING_Y + titleLines * TITLE_LINE_HEIGHT + CARD_PADDING_Y;
    const cardAnnos = step.annotations;
    let contentLines = 0;
    // Description may wrap
    if (step.description) {
      contentLines += wrapTextToWidth(
        step.description,
        FONT_SIZE_META,
        descTextWidth
      ).length;
    }
    // Annotations: all lines indented past icon
    for (const anno of cardAnnos) {
      contentLines += wrapTextToWidth(
        anno.text,
        FONT_SIZE_META,
        annoTextW
      ).length;
    }
    if (contentLines > 0) {
      h += contentLines * CARD_META_LINE_HEIGHT + 4; // 4px bottom padding
    }
    return h;
  });

  const minCardHeight = CARD_HEADER_HEIGHT + CARD_META_LINE_HEIGHT;
  const maxCardHeight = Math.max(minCardHeight, ...stepHeights);

  // Check if any step has tags — if so, reserve space for the tag strip above cards
  const hasTags = allSteps.some((s) => Object.keys(s.tags).length > 0);
  const tagStripOffset = hasTags ? TAG_STRIP_HEIGHT + 6 : 0;

  // Layout phases or flat steps
  const phaseLayouts: PhaseLayout[] = [];
  const flatStepLayouts: StepLayout[] = [];
  const curvePoints: CurvePoint[] = [];

  let globalStepIndex = 0;

  const collapsed = options?.collapsedPhases ?? new Set<string>();

  if (hasPhases) {
    let phaseX = PADDING;

    for (const phase of parsed.phases) {
      const isCollapsed = collapsed.has(phase.name);
      const stepCount = Math.max(phase.steps.length, 1);
      const phaseWidth = isCollapsed
        ? STEP_CARD_WIDTH + COLUMN_PADDING * 2
        : stepCount * STEP_CARD_WIDTH +
          (stepCount - 1) * CARD_GAP +
          COLUMN_PADDING * 2;

      const stepLayouts: StepLayout[] = [];

      if (!isCollapsed) {
        let stepX = phaseX + COLUMN_PADDING;

        for (let si = 0; si < phase.steps.length; si++) {
          // In-bounds by loop guard.
          const step = phase.steps[si]!;
          const color =
            step.score !== undefined
              ? scoreToColor(step.score, palette)
              : palette.surface;

          const sl: StepLayout = {
            x: stepX,
            y: cardAreaTop + PHASE_HEADER_HEIGHT + CARD_GAP + tagStripOffset,
            width: STEP_CARD_WIDTH,
            height: maxCardHeight,
            step,
            color,
          };
          stepLayouts.push(sl);

          // Curve point
          if (step.score !== undefined) {
            const curveX = stepX + STEP_CARD_WIDTH / 2;
            const curveY = scoreToCurveY(step.score, curveAreaBottom);
            curvePoints.push({
              x: curveX,
              y: curveY,
              score: step.score,
              ...(step.emotionLabel !== undefined && {
                emotionLabel: step.emotionLabel,
              }),
              stepIndex: globalStepIndex,
            });
          }

          stepX += STEP_CARD_WIDTH + CARD_GAP;
          globalStepIndex++;
        }
      } else {
        // Collapsed: spread curve points across the compressed column width
        const stepCount = phase.steps.length;
        const padX = COLUMN_PADDING + FACE_ICON_SIZE;
        const availW = phaseWidth - padX * 2;
        for (let si = 0; si < stepCount; si++) {
          // In-bounds by loop guard.
          const step = phase.steps[si]!;
          if (step.score !== undefined) {
            const curveX =
              stepCount === 1
                ? phaseX + phaseWidth / 2
                : phaseX + padX + (si / (stepCount - 1)) * availW;
            const curveY = scoreToCurveY(step.score, curveAreaBottom);
            curvePoints.push({
              x: curveX,
              y: curveY,
              score: step.score,
              ...(step.emotionLabel !== undefined && {
                emotionLabel: step.emotionLabel,
              }),
              stepIndex: globalStepIndex,
            });
          }
          globalStepIndex++;
        }
      }

      // Phase header color from average score
      const scoredSteps = phase.steps.filter((s) => s.score !== undefined);
      const avgScore =
        scoredSteps.length > 0
          ? scoredSteps.reduce((sum, s) => sum + s.score!, 0) /
            scoredSteps.length
          : 3;
      const headerColor = shapeFill(
        palette,
        scoreToColor(avgScore, palette),
        isDark,
        { solid: parsed.options['solid-fill'] === 'on' }
      );

      const COLLAPSED_CARD_H = 26;
      const COLLAPSED_GAP = 6;
      const phaseHeight = isCollapsed
        ? PHASE_HEADER_HEIGHT +
          CARD_GAP +
          phase.steps.length * (COLLAPSED_CARD_H + COLLAPSED_GAP) +
          CARD_GAP
        : PHASE_HEADER_HEIGHT +
          CARD_GAP +
          tagStripOffset +
          maxCardHeight +
          CARD_GAP;

      phaseLayouts.push({
        x: phaseX,
        y: cardAreaTop,
        width: phaseWidth,
        height: phaseHeight,
        phase,
        headerColor,
        stepLayouts,
      });

      phaseX += phaseWidth + PHASE_GAP;
    }
  } else {
    // Flat mode
    let stepX = PADDING;

    for (let si = 0; si < parsed.steps.length; si++) {
      // In-bounds by loop guard.
      const step = parsed.steps[si]!;
      const color =
        step.score !== undefined
          ? scoreToColor(step.score, palette)
          : palette.surface;

      flatStepLayouts.push({
        x: stepX,
        y: cardAreaTop + CARD_GAP + tagStripOffset,
        width: STEP_CARD_WIDTH,
        height: maxCardHeight,
        step,
        color,
      });

      if (step.score !== undefined) {
        const curveX = stepX + STEP_CARD_WIDTH / 2;
        const curveY = scoreToCurveY(step.score, curveAreaBottom);
        curvePoints.push({
          x: curveX,
          y: curveY,
          score: step.score,
          ...(step.emotionLabel !== undefined && {
            emotionLabel: step.emotionLabel,
          }),
          stepIndex: si,
        });
      }

      stepX += STEP_CARD_WIDTH + CARD_GAP;
      globalStepIndex++;
    }
  }

  // Compute total dimensions
  // In-bounds by length checks below.
  const rightEdge = hasPhases
    ? phaseLayouts.length > 0
      ? phaseLayouts[phaseLayouts.length - 1]!.x +
        phaseLayouts[phaseLayouts.length - 1]!.width +
        PADDING
      : PADDING * 2
    : flatStepLayouts.length > 0
      ? flatStepLayouts[flatStepLayouts.length - 1]!.x +
        STEP_CARD_WIDTH +
        PADDING
      : PADDING * 2;

  const bottomEdge = hasPhases
    ? phaseLayouts.length > 0
      ? phaseLayouts[0]!.y + phaseLayouts[0]!.height + PADDING + 40
      : cardAreaTop + PADDING
    : cardAreaTop + CARD_GAP + tagStripOffset + maxCardHeight + PADDING + 40;

  // Reserve enough horizontal space so the title text and the persona card
  // don't collapse into each other when the diagram has few steps. Without
  // this, a single-step journey produces a totalWidth that's narrower than
  // the title + persona row, and the persona panel overlaps the title.
  const headerTitleWidth = hasTitle
    ? measureText(parsed.title!, 18) // FONT_SIZE_TITLE (18px bold)
    : 0;
  const personaPanelWidth = parsed.persona ? PERSONA_PANEL_WIDTH : 0;
  const headerWidth =
    hasTitle && parsed.persona
      ? PADDING + headerTitleWidth + HEADER_GAP + personaPanelWidth + PADDING
      : Math.max(
          PADDING + headerTitleWidth + PADDING,
          PADDING + personaPanelWidth + PADDING
        );

  // Add space for score legend at bottom
  const totalWidth = Math.max(rightEdge, 400, headerWidth);
  const totalHeight = bottomEdge;

  return {
    phases: phaseLayouts,
    flatStepLayouts,
    curvePoints,
    totalWidth,
    totalHeight,
    curveAreaTop,
    curveAreaBottom,
    cardAreaTop,
    personaHeight,
    titleHeight,
    hasThoughts,
  };
}

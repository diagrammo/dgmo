import type { PaletteColors } from '../palettes';
import { mix, shapeFill } from '../palettes/color-utils';
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

// ============================================================
// Score-to-color
// ============================================================

export function scoreToColor(score: number, palette: PaletteColors): string {
  // 5=green, 1=red — interpolate
  const t = ((5 - score) / 4) * 100;
  return mix(palette.colors.red, palette.colors.green, t);
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
  const hasTitle = !!parsed.title;
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

  const curveAreaTop = PADDING + titleHeight + personaHeight;
  const curveAreaBottom = curveAreaTop + CURVE_AREA_HEIGHT;
  const cardAreaTop = curveAreaBottom + PADDING;

  const allSteps = hasPhases
    ? parsed.phases.flatMap((p) => p.steps)
    : parsed.steps;

  // Compute step card heights based on content (matches kanban card sizing).
  // Char-width constants MUST match the renderer's wrapText() in renderer.ts
  // (`fontSize * 0.6`) and the title wrap (`TITLE_CHAR_WIDTH`) — otherwise the
  // layout reserves too little vertical space and rendered text overflows.
  const annoIconIndent = ANNO_ICON_SIZE + ANNO_ICON_GAP;
  const annoTextW = STEP_CARD_WIDTH - CARD_PADDING_X * 2 - annoIconIndent;
  const descTextWidth = STEP_CARD_WIDTH - CARD_PADDING_X * 2;
  const FONT_SIZE_META = 10;
  const charWidth = FONT_SIZE_META * 0.6; // matches renderer wrapText()

  const titleTextWidth = STEP_CARD_WIDTH - CARD_PADDING_X * 2;
  const titleCharWidth = 6.5; // matches renderer TITLE_CHAR_WIDTH (FONT_SIZE_STEP 12px)
  const TITLE_LINE_HEIGHT = 16;

  const stepHeights = allSteps.map((step) => {
    const titleLines = wrapLineCount(
      step.title,
      titleTextWidth,
      titleCharWidth
    );
    let h = CARD_PADDING_Y + titleLines * TITLE_LINE_HEIGHT + CARD_PADDING_Y;
    const cardAnnos = step.annotations;
    let contentLines = 0;
    // Description may wrap
    if (step.description) {
      contentLines += wrapLineCount(step.description, descTextWidth, charWidth);
    }
    // Annotations: all lines indented past icon
    for (const anno of cardAnnos) {
      contentLines += wrapLineCount(anno.text, annoTextW, charWidth);
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
          const step = phase.steps[si];
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
            const curveY =
              curveAreaBottom -
              ((step.score - 1) / 4) * (CURVE_AREA_HEIGHT - 120) -
              10;
            curvePoints.push({
              x: curveX,
              y: curveY,
              score: step.score,
              emotionLabel: step.emotionLabel,
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
          const step = phase.steps[si];
          if (step.score !== undefined) {
            const curveX =
              stepCount === 1
                ? phaseX + phaseWidth / 2
                : phaseX + padX + (si / (stepCount - 1)) * availW;
            const curveY =
              curveAreaBottom -
              ((step.score - 1) / 4) * (CURVE_AREA_HEIGHT - 120) -
              10;
            curvePoints.push({
              x: curveX,
              y: curveY,
              score: step.score,
              emotionLabel: step.emotionLabel,
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
      const step = parsed.steps[si];
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
        const curveY =
          curveAreaBottom -
          ((step.score - 1) / 4) * (CURVE_AREA_HEIGHT - 20) -
          10;
        curvePoints.push({
          x: curveX,
          y: curveY,
          score: step.score,
          emotionLabel: step.emotionLabel,
          stepIndex: si,
        });
      }

      stepX += STEP_CARD_WIDTH + CARD_GAP;
      globalStepIndex++;
    }
  }

  // Compute total dimensions
  const rightEdge = hasPhases
    ? phaseLayouts.length > 0
      ? phaseLayouts[phaseLayouts.length - 1].x +
        phaseLayouts[phaseLayouts.length - 1].width +
        PADDING
      : PADDING * 2
    : flatStepLayouts.length > 0
      ? flatStepLayouts[flatStepLayouts.length - 1].x +
        STEP_CARD_WIDTH +
        PADDING
      : PADDING * 2;

  const bottomEdge = hasPhases
    ? phaseLayouts.length > 0
      ? phaseLayouts[0].y + phaseLayouts[0].height + PADDING + 40
      : cardAreaTop + PADDING
    : cardAreaTop + CARD_GAP + tagStripOffset + maxCardHeight + PADDING + 40;

  // Add space for score legend at bottom
  const totalWidth = Math.max(rightEdge, 400);
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

/** Count how many visual lines a text string will occupy when wrapped. */
function wrapLineCount(
  text: string,
  maxWidth: number,
  charWidth: number
): number {
  const maxChars = Math.max(1, Math.floor(maxWidth / charWidth));
  const words = text.split(/\s+/);
  let lines = 1;
  let currentLen = 0;
  for (const word of words) {
    const needed = currentLen > 0 ? word.length + 1 : word.length;
    if (currentLen + needed > maxChars && currentLen > 0) {
      lines++;
      currentLen = word.length;
    } else {
      currentLen += needed;
    }
  }
  return lines;
}

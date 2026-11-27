import type { PaletteColors } from '../palettes';
import { fillModeFromOptions } from '../utils/parsing';
import { mix, shapeFill } from '../palettes/color-utils';
import { LEGEND_HEIGHT } from '../utils/legend-constants';
import { FRAME_BODY_TOP, LEGEND_BODY_GAP } from '../utils/title-constants';
import { frameAlign } from '../utils/chart-frame-parse';
import { measureText, wrapTextToWidth } from '../utils/text-measure';
import { cardAnnotations, planJourneyThoughts } from './thoughts';
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
  /** Bottom edge of the filled curve area and its frame. The renderer draws
   *  to this; `cardAreaTop` sits `CURVE_AREA_PANEL_GAP` below it (#2447). */
  areaBottom: number;
  cardAreaTop: number;
  personaHeight: number;
  /** Top edge of the persona panel: the top padding beside a left title,
   *  or below the title (and tag legend) when it is centred or right. */
  personaTop: number;
  /** The persona panel sits on its own row under the title (#2305). */
  personaBelowTitle: boolean;
  titleHeight: number;
  /** Whether any step has thought annotations */
  hasThoughts: boolean;
}

// ============================================================
// Constants
// ============================================================

const PADDING = 24;
const TITLE_HEIGHT = 36;
const LEGEND_BOX_SLACK = 7; // LEGEND_HEIGHT exceeds the legend's ink by this much
const LEGEND_TOP_PAD = 20; // renderer DIAGRAM_PADDING
const PERSONA_BESIDE_TITLE_TOP = 20; // renderer DIAGRAM_PADDING: panel y beside a left title
const LEGEND_TITLE_FONT_SIZE = 18; // renderer FONT_SIZE_TITLE
const CURVE_INK_ABOVE = 5.5; // top face ink above the curve area
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
// Distance from curveAreaBottom down to the filled area's bottom edge and
// frame. The score-1 face sits ~10px above curveAreaBottom; its emotion
// caption hangs FACE_RADIUS + 5 + label height (~29px) below the face
// centre, so the area drops far enough that the caption clears the frame.
const CURVE_AREA_BOTTOM_GAP = 28;
// Clear space between the curve area's bottom frame and the phase panels
// (or step cards). The same gap holds with or without emotion captions (#2447).
export const CURVE_AREA_PANEL_GAP = 14;

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
  // Pass 1 at the hover headroom; if the static (export) bubbles reach above
  // the title/persona band, pass 2 adds the shortfall.
  const first = layoutOnce(parsed, palette, options, 0);
  if (!first.layout.hasThoughts) return first.layout;
  const steps =
    parsed.phases.length > 0
      ? parsed.phases.flatMap((p) => p.steps)
      : parsed.steps;
  const bubbles = planJourneyThoughts(
    first.layout.curvePoints,
    steps,
    first.layout.totalWidth,
    PADDING
  );
  if (bubbles.length === 0) return first.layout;
  const topEdge = Math.min(...bubbles.map((b) => b.y));
  const shortfall = first.thoughtTopLimit - topEdge;
  if (shortfall <= 0) return first.layout;
  return layoutOnce(parsed, palette, options, shortfall).layout;
}

function layoutOnce(
  parsed: ParsedJourneyMap,
  palette: PaletteColors,
  options:
    | {
        exportDims?: { width: number; height: number };
        collapsedPhases?: Set<string>;
        isDark?: boolean;
      }
    | undefined,
  extraHeadroom: number
): { layout: JourneyMapLayout; thoughtTopLimit: number } {
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

  // Reserve top headroom so an expanded thought bubble — which always pops
  // ABOVE its face — clears the title + persona band, even when it hangs above
  // the highest (score-5) face. Mirrors the renderer's bubble metrics.
  // With a title, the top face's ink starts CURVE_INK_ABOVE above the curve
  // area; it lands on the shared band (#1838) — FRAME_BODY_TOP, or
  // LEGEND_BODY_GAP under the tag legend, which the renderer draws under the
  // title at its padding + title font size + 8.
  const hasLegend =
    parsed.tagGroups.length > 0 && parsed.options['no-legend'] !== 'on';
  const legendBottom =
    LEGEND_TOP_PAD +
    LEGEND_TITLE_FONT_SIZE +
    8 +
    LEGEND_HEIGHT -
    LEGEND_BOX_SLACK;
  // A centred or right-aligned title would land under the persona panel in
  // the top-right corner (#2305), so the panel drops to its own row below
  // the title band and everything under it moves down by the same amount.
  const stackTitle =
    hasTitle && hasPersona && frameAlign(parsed.frame, 'title') !== 'left';
  const titleBandBottom = hasLegend
    ? legendBottom + LEGEND_BODY_GAP
    : FRAME_BODY_TOP;
  const personaTop = stackTitle ? titleBandBottom : PERSONA_BESIDE_TITLE_TOP;
  const baseTop =
    (hasTitle
      ? titleBandBottom + CURVE_INK_ABOVE + personaHeight
      : PADDING + personaHeight) +
    (stackTitle ? personaTop - PERSONA_BESIDE_TITLE_TOP : 0);
  let topHeadroom = extraHeadroom;
  let thoughtTopLimit = 0;
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
    const topBandBottom = stackTitle
      ? personaTop + personaActualH
      : PADDING + Math.max(titleHeight, personaActualH);

    // Where the highest thought-bearing face would sit with zero headroom, and
    // where its bubble's top edge would land. Shift down by any shortfall.
    const faceY0 = scoreToCurveY(topThoughtScore, baseTop + CURVE_AREA_HEIGHT);
    const bubbleTop0 = faceY0 - FACE_HOVER_R - THOUGHT_GAP - maxBubbleH;
    thoughtTopLimit = topBandBottom + BUBBLE_MARGIN;
    topHeadroom += Math.max(0, thoughtTopLimit - bubbleTop0);
  }

  const curveAreaTop = baseTop + topHeadroom;
  const curveAreaBottom = curveAreaTop + CURVE_AREA_HEIGHT;
  const areaBottom = curveAreaBottom + CURVE_AREA_BOTTOM_GAP;
  const cardAreaTop = areaBottom + CURVE_AREA_PANEL_GAP;

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
    const cardAnnos = cardAnnotations(step, !!options?.exportDims);
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
        { mode: fillModeFromOptions(parsed.options) }
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
    ? measureText(parsed.title, 18) // FONT_SIZE_TITLE (18px bold)
    : 0;
  const personaPanelWidth = parsed.persona ? PERSONA_PANEL_WIDTH : 0;
  const headerWidth =
    hasTitle && parsed.persona && !stackTitle
      ? PADDING + headerTitleWidth + HEADER_GAP + personaPanelWidth + PADDING
      : Math.max(
          PADDING + headerTitleWidth + PADDING,
          PADDING + personaPanelWidth + PADDING
        );

  // Add space for score legend at bottom
  const totalWidth = Math.max(rightEdge, 400, headerWidth);
  const totalHeight = bottomEdge;

  const layout: JourneyMapLayout = {
    phases: phaseLayouts,
    flatStepLayouts,
    curvePoints,
    totalWidth,
    totalHeight,
    curveAreaTop,
    curveAreaBottom,
    areaBottom,
    cardAreaTop,
    personaHeight,
    personaTop,
    personaBelowTitle: stackTitle,
    titleHeight,
    hasThoughts,
  };
  return { layout, thoughtTopLimit };
}

import { serializeSvg } from '../utils/svg-serialize';
import { tagAttrKey } from '../utils/tag-groups';
import { fillModeFromOptions } from '../utils/parsing';
import * as d3 from 'd3-selection';
import * as d3Shape from 'd3-shape';
import type { PaletteColors } from '../palettes';
import {
  contrastText,
  mix,
  shapeFill,
  themeBaseBg,
} from '../palettes/color-utils';
import { FONT_FAMILY } from '../fonts';
import { parseJourneyMap } from './parser';
import {
  layoutJourneyMap,
  scoreToColor,
  scoreToCurveY,
  TAG_STRIP_HEIGHT,
  type CurvePoint,
  type StepLayout,
} from './layout';
import type {
  ParsedJourneyMap,
  JourneyMapAnnotation,
  JourneyMapStep,
} from './types';
import { renderInlineText } from '../utils/inline-markdown';
import { wrapNoteBody, NOTE_BULLET_INDENT } from '../utils/note-box';
import { renderIntegratedLegend } from '../utils/legend-integration';
import { resolveActiveTagGroup } from '../utils/tag-groups';
import { ScaleContext } from '../utils/scaling';
import {
  measureText,
  wrapTextToWidth,
  truncateText as truncateToWidth,
} from '../utils/text-measure';

// ============================================================
// Interactive Options
// ============================================================

export interface JourneyMapInteractiveOptions {
  onNavigateToLine?: (line: number) => void;
  exportDims?: { width: number; height: number };
  activeTagGroup?: string | null;
  onActiveTagGroupChange?: (group: string | null) => void;
  /** Current editor cursor line — highlights the matching face + card, dims the rest */
  currentLine?: number | null;
  /** Set of collapsed phase names */
  collapsedPhases?: Set<string>;
  /** Called when a phase is toggled */
  onPhaseToggle?: (phaseName: string) => void;
  exportMode?: boolean;
}

// ============================================================
// Constants
// ============================================================

// Match kanban styling constants
const DIAGRAM_PADDING = 20;
const PADDING = DIAGRAM_PADDING;
import { CARD_RADIUS } from '../utils/visual-conventions'; // shared (Story 111.1)
const CARD_PADDING_X = 10;
const CARD_PADDING_Y = 6;
const CARD_HEADER_HEIGHT = 24;
const CARD_STROKE_WIDTH = 1.5;
const CARD_META_LINE_HEIGHT = 14;
const CARD_GAP_INTERNAL = 8;
const COLUMN_RADIUS = 8;
const COLUMN_HEADER_HEIGHT = 36;
const COLUMN_PADDING = 12;
const FONT_SIZE_TITLE = 18;
/** Persona panel width; the title stops before it, so both must agree. */
const PERSONA_PANEL_WIDTH = 280;
const FONT_SIZE_PHASE = 13;
const FONT_SIZE_STEP = 12;
const FONT_SIZE_META = 10;
const GRID_LINE_OPACITY = 0.15;
const CURVE_STROKE_WIDTH = 2.5;
const FACE_RADIUS = 14;
// Distance from curveAreaBottom down to the filled band's bottom edge/border.
// The score-1 face sits ~10px above curveAreaBottom; its emotion caption hangs
// FACE_RADIUS + 5 + label-height (~29px) below the face center, so the band
// must drop far enough that the caption clears the bottom border.
const CURVE_AREA_BOTTOM_GAP = 28;
// Faces grow on hover/active; the thought bubble + connector must clear the
// enlarged outer edge (radius + ring halo), not the base radius.
const FACE_HOVER_SCALE = 1.5;
const FACE_HOVER_R = (FACE_RADIUS + 1) * FACE_HOVER_SCALE;
const DIM_HOVER = 0.25;
const TITLE_LINE_HEIGHT = 16;

// ============================================================
// Renderer
// ============================================================

export function renderJourneyMap(
  container: HTMLElement,
  parsed: ParsedJourneyMap,
  palette: PaletteColors,
  isDark: boolean,
  options?: JourneyMapInteractiveOptions
): void {
  const exportDims = options?.exportDims;
  const onNavigateToLine = options?.onNavigateToLine;
  const activeTagGroup = options?.activeTagGroup ?? null;
  const onActiveTagGroupChange = options?.onActiveTagGroupChange;
  const collapsedPhases = options?.collapsedPhases ?? new Set<string>();
  const onPhaseToggle = options?.onPhaseToggle;
  const fillMode = fillModeFromOptions(parsed.options);

  const layout = layoutJourneyMap(parsed, palette, {
    collapsedPhases,
    ...(exportDims !== undefined && { exportDims }),
    isDark,
  });

  container.innerHTML = '';

  const containerW = exportDims?.width ?? container.clientWidth;
  const containerH = exportDims?.height ?? container.clientHeight;
  const useContainerFit = !exportDims && containerW > 0 && containerH > 0;

  const sctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(containerW, layout.totalWidth);

  const svg = d3
    .select(container)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr(
      'width',
      useContainerFit ? containerW : (exportDims?.width ?? layout.totalWidth)
    )
    .attr(
      'height',
      useContainerFit ? containerH : (exportDims?.height ?? layout.totalHeight)
    )
    .attr('viewBox', `0 0 ${layout.totalWidth} ${layout.totalHeight}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .attr('font-family', FONT_FAMILY);

  if (sctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  // Background
  svg
    .append('rect')
    .attr('width', layout.totalWidth)
    .attr('height', layout.totalHeight)
    .attr('fill', palette.bg);

  // Defs for gradients
  const defs = svg.append('defs');

  // Curve area gradient (green top, red bottom)
  const curveGradient = defs
    .append('linearGradient')
    .attr('id', 'journey-curve-gradient')
    .attr('x1', '0')
    .attr('y1', '0')
    .attr('x2', '0')
    .attr('y2', '1');
  curveGradient
    .append('stop')
    .attr('offset', '0%')
    .attr('stop-color', palette.colors.green)
    .attr('stop-opacity', 0.3);
  curveGradient
    .append('stop')
    .attr('offset', '100%')
    .attr('stop-color', palette.colors.red)
    .attr('stop-opacity', 0.3);

  // ── Title ────────────────────────────────────────────────
  const showTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  if (showTitle) {
    const titleG = svg.append('g').attr('class', 'chart-title');
    if (parsed.titleLineNumber) {
      titleG.attr('data-line-number', parsed.titleLineNumber);
    }
    // The persona panel sits at PADDING from the top-right corner, so it
    // shares the title's band — the title stops before it rather than running
    // underneath. Bold is the one place in this renderer where the heavier
    // face is really drawn, so it is the one place measured as bold.
    const personaPanelX = parsed.persona
      ? layout.totalWidth - PADDING - PERSONA_PANEL_WIDTH
      : layout.totalWidth;
    const titleMaxW = Math.max(
      0,
      Math.min(personaPanelX - PADDING, layout.totalWidth - PADDING) - PADDING
    );
    titleG
      .append('text')
      .attr('x', PADDING)
      .attr('y', PADDING + FONT_SIZE_TITLE)
      .attr('font-size', FONT_SIZE_TITLE)
      .attr('font-weight', 'bold')
      .attr('fill', palette.text)
      .text(
        truncateToWidth(parsed.title!, FONT_SIZE_TITLE, titleMaxW, {
          bold: true,
        })
      );

    if (onNavigateToLine && parsed.titleLineNumber) {
      titleG.style('cursor', 'pointer').on('click', () => {
        onNavigateToLine(parsed.titleLineNumber!);
      });
    }
  }

  // ── Persona ──────────────────────────────────────────────
  if (parsed.persona) {
    const personaColor = parsed.persona.color ?? palette.textMuted;
    const personaG = svg
      .append('g')
      .attr('class', 'journey-persona')
      .attr('data-line-number', parsed.persona.lineNumber);

    // Panel dimensions
    const titleRowH = CARD_HEADER_HEIGHT;
    const silhouetteZone = 60; // right-side space reserved for silhouette
    const panelWidth = PERSONA_PANEL_WIDTH;
    const textAreaWidth = panelWidth - silhouetteZone - CARD_PADDING_X;
    const descLineH = 14;

    // Wrap description text into lines — bullet-aware (`- `/`* ` → hanging
    // "•") + inline markdown, matching how note boxes render rich bodies.
    const descLines = parsed.persona.description
      ? wrapNoteBody(parsed.persona.description, textAreaWidth, FONT_SIZE_META)
      : [];
    const descRowH =
      descLines.length > 0 ? descLines.length * descLineH + 8 : 0;
    const panelHeight = titleRowH + descRowH;
    const panelX = layout.totalWidth - PADDING - panelWidth;
    const panelY = PADDING;
    const textX = panelX + CARD_PADDING_X;

    // Clip path so silhouette stays inside the card
    const clipId = 'persona-clip';
    defs
      .append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('x', panelX)
      .attr('y', panelY)
      .attr('width', panelWidth)
      .attr('height', panelHeight)
      .attr('rx', CARD_RADIUS);

    // Card — canonical 25% tint via shapeFill() (or full intent when solid-fill is on)
    const personaFill = shapeFill(palette, personaColor, isDark, {
      mode: fillMode,
    });
    // Text drawn on top of the card must contrast against the fill, not against bg/surface.
    const onPersonaText = contrastText(
      personaFill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );

    personaG
      .append('rect')
      .attr('x', panelX)
      .attr('y', panelY)
      .attr('width', panelWidth)
      .attr('height', panelHeight)
      .attr('rx', CARD_RADIUS)
      .attr('fill', personaFill);

    // Divider line (drawn BEFORE silhouette so it doesn't cut through)
    if (descLines.length > 0) {
      personaG
        .append('line')
        .attr('x1', panelX + 1)
        .attr('x2', panelX + panelWidth - silhouetteZone)
        .attr('y1', panelY + titleRowH)
        .attr('y2', panelY + titleRowH)
        .attr('stroke', fillMode === 'solid' ? onPersonaText : personaColor)
        .attr('stroke-opacity', 0.3)
        .attr('stroke-width', 1);
    }

    // Silhouette (clipped inside card, more right padding, taller)
    const silX = panelX + panelWidth - 32;
    const silY = panelY + panelHeight / 2 - 6;
    const silClip = personaG.append('g').attr('clip-path', `url(#${clipId})`);
    renderPersonaSilhouette(
      silClip,
      silX,
      silY,
      personaColor,
      palette,
      isDark,
      1.2,
      fillMode
    );

    // Card border (drawn on top so outline is clean all around)
    personaG
      .append('rect')
      .attr('x', panelX)
      .attr('y', panelY)
      .attr('width', panelWidth)
      .attr('height', panelHeight)
      .attr('rx', CARD_RADIUS)
      .attr('fill', 'none')
      .attr('stroke', personaColor)
      .attr('stroke-width', CARD_STROKE_WIDTH);

    // Name (left-aligned in title row, matches kanban card title)
    personaG
      .append('text')
      .attr('x', textX)
      .attr('y', panelY + CARD_PADDING_Y + FONT_SIZE_STEP)
      .attr('font-size', FONT_SIZE_STEP)
      .attr('font-weight', '500')
      .attr('fill', onPersonaText)
      // Same text area the description already wraps into — the silhouette
      // occupies the right of the card. Weight 500 is NOT measured as bold:
      // only 400 and 700 faces ship, so it resolves down to regular.
      .text(
        truncateToWidth(parsed.persona.name, FONT_SIZE_STEP, textAreaWidth)
      );

    // Description — wrapped lines below divider, with inline markdown.
    // Bullet first-lines get a "•" glyph at the left edge with the body
    // hanging-indented; continuation lines align under the body.
    for (let li = 0; li < descLines.length; li++) {
      // In-bounds by loop guard.
      const line = descLines[li]!;
      const indent = line.kind === 'plain' ? 0 : NOTE_BULLET_INDENT;
      const lineY = panelY + titleRowH + descLineH * (li + 1);
      if (line.kind === 'bullet-first') {
        personaG
          .append('text')
          .attr('x', textX)
          .attr('y', lineY)
          .attr('font-size', FONT_SIZE_META)
          .attr('fill', onPersonaText)
          .text('•');
      }
      const lineEl = personaG
        .append('text')
        .attr('x', textX + indent)
        .attr('y', lineY)
        .attr('font-size', FONT_SIZE_META)
        .attr('fill', onPersonaText);
      renderInlineText(lineEl, line.text, palette, FONT_SIZE_META);
    }

    if (onNavigateToLine) {
      personaG.style('cursor', 'pointer').on('click', () => {
        onNavigateToLine(parsed.persona!.lineNumber);
      });
    }
  }

  // ── Score group + active group (shared by legend and card coloring) ──
  const scoreGroup = {
    name: 'Score',
    entries: [1, 2, 3, 4, 5].map((s) => ({
      value: String(s),
      color: scoreToColor(s, palette),
      lineNumber: 0,
    })),
    lineNumber: 0,
  };
  const allLegendGroups = [...parsed.tagGroups, scoreGroup];
  const effectiveActiveGroup =
    activeTagGroup ??
    resolveActiveTagGroup(allLegendGroups, parsed.options['active-tag']);

  // ── Legend ──────────────────────────────────────────────
  if (parsed.options['no-legend'] !== 'on') {
    const legendX = PADDING;
    const legendY = PADDING + (showTitle ? FONT_SIZE_TITLE + 8 : 0);
    const legendG = svg
      .append('g')
      .attr('class', 'journey-legend')
      .attr('transform', `translate(${legendX},${legendY})`);

    const legendCallbacks: import('../utils/legend-types').LegendCallbacks = {
      ...(onActiveTagGroupChange
        ? {
            onGroupToggle: (groupName: string) => {
              const isDeactivating =
                effectiveActiveGroup?.toLowerCase() === groupName.toLowerCase();
              onActiveTagGroupChange(isDeactivating ? null : groupName);
            },
          }
        : {}),
      ...(!exportDims
        ? {
            onEntryHover: (groupName: string, entryValue: string | null) => {
              if (!entryValue) {
                // Hover out — restore all
                svg.selectAll('.journey-step').style('opacity', null);
                svg.selectAll('.journey-face').style('opacity', null);
                svg.selectAll('.journey-face-icon').attr('transform', null);
                svg.selectAll('.journey-thought').style('opacity', null);
                return;
              }

              const isScore = groupName === 'Score';
              const attrName = isScore
                ? 'data-score'
                : `data-tag-${tagAttrKey(groupName)}`;

              const matches = (el: Element) =>
                el.getAttribute(attrName) === entryValue;

              svg
                .selectAll<SVGGElement, unknown>('.journey-step')
                .each(function () {
                  const hit = matches(this);
                  d3.select(this).style(
                    'opacity',
                    hit ? '1' : String(DIM_HOVER)
                  );
                });

              svg
                .selectAll<SVGGElement, unknown>('.journey-face')
                .each(function () {
                  const hit = matches(this);
                  const sel = d3.select(this);
                  sel.style('opacity', hit ? '1' : String(DIM_HOVER));
                  const icon = sel.select('.journey-face-icon');
                  if (hit) {
                    const fcx = parseFloat(sel.attr('data-cx') ?? '0');
                    const fcy = parseFloat(sel.attr('data-cy') ?? '0');
                    icon.attr(
                      'transform',
                      `translate(${fcx},${fcy}) scale(1.3) translate(${-fcx},${-fcy})`
                    );
                  } else {
                    icon.attr('transform', null);
                  }
                });

              // Dim thought bubbles that aren't associated with matching faces
              svg
                .selectAll<SVGGElement, unknown>('.journey-thought')
                .style('opacity', String(DIM_HOVER));
            },
          }
        : {}),
    };

    renderIntegratedLegend(legendG, {
      groups: parsed.tagGroups,
      activeGroup: effectiveActiveGroup,
      mode: options?.exportMode ? 'export' : 'preview',
      position: { placement: 'top-center', titleRelation: 'inline-with-title' },
      titleWidth: 0,
      callbacks: legendCallbacks,
      palette,
      isDark,
      // Reduce available width if persona card exists to avoid collision
      width: parsed.persona
        ? layout.totalWidth - legendX - PADDING - 280 - PADDING
        : layout.totalWidth - legendX - PADDING,
    });
  }

  // ── Curve Area ───────────────────────────────────────────
  const curveG = svg.append('g').attr('class', 'journey-curve-area');

  // Grid lines at score levels 1-5
  for (let score = 1; score <= 5; score++) {
    const y = scoreToCurveY(score, layout.curveAreaBottom);

    curveG
      .append('line')
      .attr('x1', PADDING)
      .attr('x2', layout.totalWidth - PADDING)
      .attr('y1', y)
      .attr('y2', y)
      .attr('stroke', palette.textMuted)
      .attr('stroke-opacity', GRID_LINE_OPACITY)
      .attr('stroke-dasharray', '4,4');
  }

  // Emotion curve (area fill + line)
  if (layout.curvePoints.length >= 2) {
    // Extend curve to edges with flat continuations
    // In-bounds by length >= 2 check above.
    const first = layout.curvePoints[0]!;
    const last = layout.curvePoints[layout.curvePoints.length - 1]!;
    const extendedPoints: CurvePoint[] = [
      {
        x: PADDING,
        y: first.y,
        score: first.score,
        stepIndex: first.stepIndex,
      },
      ...layout.curvePoints,
      {
        x: layout.totalWidth - PADDING,
        y: last.y,
        score: last.score,
        stepIndex: last.stepIndex,
      },
    ];

    // Bottom of the filled band. Sits clear of the lowest face's emotion
    // caption (score-1 face + FACE_RADIUS + EMOTION_LABEL gap) so the caption
    // doesn't collide with the bottom border.
    const areaBottomY = layout.curveAreaBottom + CURVE_AREA_BOTTOM_GAP;

    const areaGen = d3Shape
      .area<CurvePoint>()
      .x((d) => d.x)
      .y0(areaBottomY)
      .y1((d) => d.y)
      .curve(d3Shape.curveMonotoneX);

    // fill-outline drops the green→red gradient band to the theme base
    // background — the 2.5px primary curve stroke alone carries the shape.
    // Tint + solid keep the gradient (solid saturation on a broad band
    // would drown the plot, so only outline diverges).
    curveG
      .append('path')
      .attr('d', areaGen(extendedPoints) ?? '')
      // The emotion area keeps its gradient wash in every fill mode — the
      // wash is the read of the journey's emotional arc (user ruling).
      .attr('fill', 'url(#journey-curve-gradient)')
      .attr('stroke', 'none');

    // Frame the filled area on three sides (left, bottom, right) — the curve
    // line itself forms the top edge. Polishes the plot into a contained box.
    const leftX = PADDING;
    const rightX = layout.totalWidth - PADDING;
    curveG
      .append('path')
      .attr(
        'd',
        `M${leftX},${first.y} L${leftX},${areaBottomY} ` +
          `L${rightX},${areaBottomY} L${rightX},${last.y}`
      )
      .attr('fill', 'none')
      .attr('stroke', palette.primary)
      .attr('stroke-width', CURVE_STROKE_WIDTH)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round');

    // Curve line on top
    const lineGen = d3Shape
      .line<CurvePoint>()
      .x((d) => d.x)
      .y((d) => d.y)
      .curve(d3Shape.curveMonotoneX);

    curveG
      .append('path')
      .attr('d', lineGen(extendedPoints) ?? '')
      .attr('fill', 'none')
      .attr('stroke', palette.primary)
      .attr('stroke-width', CURVE_STROKE_WIDTH)
      .attr('stroke-linecap', 'round');

    // Curve face icons (clickable → navigate to step line)
    const allSteps =
      parsed.phases.length > 0
        ? parsed.phases.flatMap((p) => p.steps)
        : parsed.steps;

    for (const pt of layout.curvePoints) {
      const step = allSteps[pt.stepIndex];
      const faceG = renderScoreFace(
        curveG,
        pt.x,
        pt.y,
        pt.score,
        palette,
        isDark,
        undefined,
        fillMode
      );
      addEmotionLabel(faceG, pt, palette);
      if (step) {
        faceG.attr('data-line-number', step.lineNumber);
        faceG.attr('data-score', pt.score);
        for (const [key, value] of Object.entries(step.tags)) {
          faceG.attr(`data-tag-${key.toLowerCase()}`, value);
        }
        // Store thought text for hover-to-reveal
        const thoughts = step.annotations.filter((a) => a.type === 'thought');
        if (thoughts.length > 0) {
          faceG.attr(
            'data-thought',
            thoughts.map((t) => t.text).join(' \u2022 ')
          );
        }
        if (onNavigateToLine) {
          faceG.style('cursor', 'pointer').on('click', () => {
            onNavigateToLine(step.lineNumber);
          });
        }
      }
    }
  } else if (layout.curvePoints.length === 1) {
    // Single point — face only, no curve
    // In-bounds by length === 1 check above.
    const pt = layout.curvePoints[0]!;
    const allSteps =
      parsed.phases.length > 0
        ? parsed.phases.flatMap((p) => p.steps)
        : parsed.steps;
    const step = allSteps[pt.stepIndex];
    const faceG = renderScoreFace(
      curveG,
      pt.x,
      pt.y,
      pt.score,
      palette,
      isDark,
      undefined,
      fillMode
    );
    addEmotionLabel(faceG, pt, palette);
    if (step) {
      faceG.attr('data-line-number', step.lineNumber);
      faceG.attr('data-score', pt.score);
      for (const [key, value] of Object.entries(step.tags)) {
        faceG.attr(`data-tag-${key.toLowerCase()}`, value);
      }
      const thoughts = step.annotations.filter((a) => a.type === 'thought');
      if (thoughts.length > 0) {
        faceG.attr(
          'data-thought',
          thoughts.map((t) => t.text).join(' \u2022 ')
        );
      }
      if (onNavigateToLine) {
        faceG.style('cursor', 'pointer').on('click', () => {
          onNavigateToLine(step.lineNumber);
        });
      }
    }
  }

  // ── Phases + Cards ───────────────────────────────────────
  const phasesG = svg.append('g').attr('class', 'journey-phases');

  if (layout.phases.length > 0) {
    for (const pl of layout.phases) {
      const isCollapsed = collapsedPhases.has(pl.phase.name);
      const phaseG = phasesG
        .append('g')
        .attr('class', 'journey-phase')
        .attr('data-line-number', pl.phase.lineNumber);

      // Column background (no stroke — matches kanban)
      const colBg = isDark
        ? mix(palette.surface, palette.bg, 50)
        : mix(palette.surface, palette.bg, 30);
      phaseG
        .append('rect')
        .attr('x', pl.x)
        .attr('y', pl.y)
        .attr('width', pl.width)
        .attr('height', pl.height)
        .attr('rx', COLUMN_RADIUS)
        .attr('fill', colBg);

      // Column header (no stroke — matches kanban)
      phaseG
        .append('rect')
        .attr('x', pl.x)
        .attr('y', pl.y)
        .attr('width', pl.width)
        .attr('height', COLUMN_HEADER_HEIGHT)
        .attr('rx', COLUMN_RADIUS)
        .attr('fill', pl.headerColor);

      // Clip bottom corners of header
      phaseG
        .append('rect')
        .attr('x', pl.x)
        .attr('y', pl.y + COLUMN_HEADER_HEIGHT - COLUMN_RADIUS)
        .attr('width', pl.width)
        .attr('height', COLUMN_RADIUS)
        .attr('fill', pl.headerColor);

      // Column header text — must contrast against pl.headerColor, not bg.
      // (palette.text is dark in light themes, illegible on a saturated header.)
      const onHeaderText = contrastText(
        pl.headerColor,
        palette.textOnFillLight,
        palette.textOnFillDark
      );
      phaseG
        .append('text')
        .attr('x', pl.x + COLUMN_PADDING)
        .attr('y', pl.y + COLUMN_HEADER_HEIGHT / 2)
        .attr('dominant-baseline', 'central')
        .attr('font-size', FONT_SIZE_PHASE)
        .attr('font-weight', 'bold')
        .attr('fill', onHeaderText)
        .text(
          isCollapsed
            ? truncateToWidth(
                pl.phase.name,
                FONT_SIZE_PHASE,
                pl.width - COLUMN_PADDING * 2
              )
            : pl.phase.name
        );

      // Click header to toggle collapse
      if (onPhaseToggle) {
        phaseG.style('cursor', 'pointer').on('click', (event: MouseEvent) => {
          const target = event.target as Element;
          if (
            !target.closest('.journey-step') &&
            !target.closest('.journey-face')
          ) {
            onPhaseToggle(pl.phase.name);
          }
        });
      } else if (onNavigateToLine) {
        phaseG.style('cursor', 'pointer').on('click', (event: MouseEvent) => {
          const target = event.target as Element;
          if (!target.closest('.journey-step')) {
            onNavigateToLine(pl.phase.lineNumber);
          }
        });
      }

      if (isCollapsed) {
        // Collapsed: mini card rows with colored border matching active tag
        const COLLAPSED_CARD_H = 26;
        const COLLAPSED_GAP = 6;
        const COLLAPSED_FACE_R = 7;
        const listX = pl.x + COLUMN_PADDING;
        const cardW = pl.width - COLUMN_PADDING * 2;
        let itemY = pl.y + COLUMN_HEADER_HEIGHT + CARD_GAP_INTERNAL + 4;

        for (const step of pl.phase.steps) {
          const itemG = phaseG
            .append('g')
            .attr('class', 'journey-step')
            .attr('data-line-number', step.lineNumber);

          // Data attributes for legend hover highlighting
          if (step.score !== undefined) {
            itemG.attr('data-score', step.score);
          }
          for (const [key, value] of Object.entries(step.tags)) {
            itemG.attr(`data-tag-${key.toLowerCase()}`, value);
          }

          // Resolve card color from active tag group
          const stepColor = resolveStepColor(
            step,
            step.score !== undefined
              ? scoreToColor(step.score, palette)
              : palette.surface,
            effectiveActiveGroup,
            parsed.tagGroups,
            palette
          );
          // Canonical 25% tint via shapeFill() (or full intent when solid-fill is on)
          const rowFill = shapeFill(
            palette,
            stepColor ?? palette.primary,
            isDark,
            { mode: fillMode }
          );
          const rowStroke = stepColor ?? palette.textMuted;

          // Card background
          itemG
            .append('rect')
            .attr('x', listX)
            .attr('y', itemY)
            .attr('width', cardW)
            .attr('height', COLLAPSED_CARD_H)
            .attr('rx', CARD_RADIUS)
            .attr('fill', rowFill)
            .attr('stroke', rowStroke)
            .attr('stroke-width', CARD_STROKE_WIDTH);

          // Face icon (small, left side)
          const faceCx = listX + CARD_PADDING_X + COLLAPSED_FACE_R;
          const faceCy = itemY + COLLAPSED_CARD_H / 2;
          if (step.score !== undefined) {
            const faceG = renderScoreFace(
              itemG,
              faceCx,
              faceCy,
              step.score,
              palette,
              isDark,
              COLLAPSED_FACE_R,
              fillMode
            );
            faceG.attr('data-line-number', step.lineNumber);
            faceG.attr('data-score', step.score);
            for (const [key, value] of Object.entries(step.tags)) {
              faceG.attr(`data-tag-${key.toLowerCase()}`, value);
            }
          }

          // Step title
          const textX = listX + CARD_PADDING_X + COLLAPSED_FACE_R * 2 + 6;
          const maxTextW =
            cardW - CARD_PADDING_X * 2 - COLLAPSED_FACE_R * 2 - 6;
          itemG
            .append('text')
            .attr('x', textX)
            .attr('y', itemY + COLLAPSED_CARD_H / 2)
            .attr('dominant-baseline', 'central')
            .attr('font-size', FONT_SIZE_META)
            .attr('fill', palette.text)
            .text(truncateToWidth(step.title, FONT_SIZE_META, maxTextW));

          if (onNavigateToLine) {
            itemG.style('cursor', 'pointer').on('click', (event: Event) => {
              event.stopPropagation();
              onNavigateToLine(step.lineNumber);
            });
          }

          itemY += COLLAPSED_CARD_H + COLLAPSED_GAP;
        }
      } else {
        // Expanded: render step cards
        for (const sl of pl.stepLayouts) {
          renderStepCard(
            phaseG,
            sl,
            palette,
            isDark,
            effectiveActiveGroup,
            parsed.tagGroups,
            onNavigateToLine,
            fillMode
          );
        }
      }
    }
  } else {
    // Flat mode
    for (const sl of layout.flatStepLayouts) {
      renderStepCard(
        phasesG,
        sl,
        palette,
        isDark,
        effectiveActiveGroup,
        parsed.tagGroups,
        onNavigateToLine,
        fillMode
      );
    }
  }

  // Top-level overlay group for hover elements (renders above everything)
  const overlayG = svg.append('g').attr('class', 'journey-overlay');

  // ── Hover + click-to-lock dimming ─────────────────────
  if (!exportDims) {
    const DIM_OPACITY = 0.35;
    let lockedLine: number | null = null;

    // Helper: dim everything except elements matching a line number
    const applyDimming = (activeLine: number) => {
      svg.selectAll('.journey-step').each(function () {
        const el = d3.select(this);
        const ln = parseInt(el.attr('data-line-number') ?? '0', 10);
        el.style('opacity', ln === activeLine ? '1' : String(DIM_OPACITY));
      });
      svg.selectAll('.journey-face').each(function () {
        const el = d3.select(this);
        const ln = parseInt(el.attr('data-line-number') ?? '0', 10);
        const isActive = ln === activeLine;
        el.style('opacity', isActive ? '1' : String(DIM_OPACITY));
        const icon = el.select('.journey-face-icon');
        if (isActive) {
          const fcx = parseFloat(el.attr('data-cx') ?? '0');
          const fcy = parseFloat(el.attr('data-cy') ?? '0');
          icon.attr(
            'transform',
            `translate(${fcx},${fcy}) scale(${FACE_HOVER_SCALE}) translate(${-fcx},${-fcy})`
          );
        } else {
          icon.attr('transform', null);
        }
      });
      // Dim phases slightly (but not as much)
      svg.selectAll('.journey-phase').each(function () {
        const el = d3.select(this);
        const hasActive = el.select(
          `.journey-step[data-line-number="${activeLine}"]`
        );
        if (!hasActive.node()) {
          el.style('opacity', String(DIM_OPACITY + 0.3));
        }
      });
    };

    const clearDimming = () => {
      svg.selectAll('.journey-step').style('opacity', null);
      svg.selectAll('.journey-face').style('opacity', null);
      svg.selectAll('.journey-face-icon').attr('transform', null);
      svg.selectAll('.journey-phase').style('opacity', null);
      overlayG.selectAll('.journey-thought-hover').remove();
    };

    // Show thought bubble for a face in the overlay layer
    const THOUGHT_FONT = 11;
    const THOUGHT_PAD_X = 10;
    const THOUGHT_PAD_Y = 6;
    const THOUGHT_MAX_W = 200;
    const THOUGHT_LINE_H = 14;
    const THOUGHT_GAP = 10;

    const showThoughtBubble = (
      faceEl: d3.Selection<SVGGElement, unknown, null, undefined>
    ) => {
      overlayG.selectAll('.journey-thought-hover').remove();

      const thoughtText = faceEl.attr('data-thought');
      if (!thoughtText || !layout.hasThoughts) return;

      const fcx = parseFloat(faceEl.attr('data-cx') ?? '0');
      const fcy = parseFloat(faceEl.attr('data-cy') ?? '0');
      const score = parseInt(faceEl.attr('data-score') ?? '3', 10);

      const lines = wrapTextToWidth(thoughtText, THOUGHT_FONT, THOUGHT_MAX_W);
      const textW = Math.min(
        THOUGHT_MAX_W,
        Math.max(...lines.map((l) => measureText(l, THOUGHT_FONT)))
      );
      const bw = textW + THOUGHT_PAD_X * 2;
      const bh = lines.length * THOUGHT_LINE_H + THOUGHT_PAD_Y * 2;

      // Position above the face, overlaying the curve area (clamp to stay in
      // view). The layout reserves top headroom so the bubble clears the title
      // and persona band even above the highest face — no flip needed.
      const bx = Math.max(
        PADDING,
        Math.min(fcx - bw / 2, layout.totalWidth - PADDING - bw)
      );
      const by = Math.max(PADDING, fcy - FACE_HOVER_R - THOUGHT_GAP - bh);

      const scoreColor = scoreToColor(score, palette);
      const tintedBg =
        fillMode === 'outline'
          ? themeBaseBg(palette, isDark)
          : mix(scoreColor, palette.surface, 20);

      const g = overlayG.append('g').attr('class', 'journey-thought-hover');

      g.append('rect')
        .attr('x', bx)
        .attr('y', by)
        .attr('width', bw)
        .attr('height', bh)
        .attr('rx', CARD_RADIUS)
        .attr('fill', tintedBg)
        .attr('stroke', scoreColor)
        .attr('stroke-width', CARD_STROKE_WIDTH);

      // Connector line from bubble bottom to face top
      g.append('line')
        .attr('x1', fcx)
        .attr('y1', by + bh)
        .attr('x2', fcx)
        .attr('y2', fcy - FACE_HOVER_R - 1)
        .attr('stroke', scoreColor)
        .attr('stroke-width', CARD_STROKE_WIDTH);

      const centerX = bx + bw / 2;
      for (let i = 0; i < lines.length; i++) {
        g.append('text')
          .attr('x', centerX)
          .attr('y', by + THOUGHT_PAD_Y + (i + 1) * THOUGHT_LINE_H - 2)
          .attr('text-anchor', 'middle')
          .attr('font-size', THOUGHT_FONT)
          .attr('font-style', 'italic')
          .attr('fill', palette.textMuted)
          // In-bounds by loop guard.
          .text(lines[i]!);
      }
    };

    // Click background to unlock
    svg.on('click', (event: MouseEvent) => {
      const target = event.target as Element;
      if (
        !target.closest('.journey-face') &&
        !target.closest('.journey-step') &&
        !target.closest('.journey-phase')
      ) {
        lockedLine = null;
        clearDimming();
      }
    });

    // Find the curve face for a line number and show its thought bubble
    const showThoughtForLine = (ln: number) => {
      svg
        .selectAll<SVGGElement, unknown>('.journey-curve-area .journey-face')
        .each(function () {
          const face = d3.select<SVGGElement, unknown>(this);
          if (parseInt(face.attr('data-line-number') ?? '0', 10) === ln) {
            showThoughtBubble(face);
          }
        });
    };

    // Hover + click on faces
    svg.selectAll<SVGGElement, unknown>('.journey-face').each(function () {
      const el = d3.select<SVGGElement, unknown>(this);
      el.on('mouseenter', () => {
        if (lockedLine !== null) return;
        const ln = parseInt(el.attr('data-line-number') ?? '0', 10);
        if (ln) {
          applyDimming(ln);
          showThoughtForLine(ln);
        }
      })
        .on('mouseleave', () => {
          if (lockedLine !== null) return;
          clearDimming();
        })
        .on('click', (event: MouseEvent) => {
          event.stopPropagation();
          const ln = parseInt(el.attr('data-line-number') ?? '0', 10);
          if (lockedLine === ln) {
            lockedLine = null;
            clearDimming();
          } else {
            lockedLine = ln;
            applyDimming(ln);
            showThoughtForLine(ln);
            if (onNavigateToLine && ln) onNavigateToLine(ln);
          }
        });
    });

    // Hover + click on step cards
    svg.selectAll('.journey-step').each(function () {
      const el = d3.select(this);
      el.on('mouseenter', () => {
        if (lockedLine !== null) return;
        const ln = parseInt(el.attr('data-line-number') ?? '0', 10);
        if (ln) {
          applyDimming(ln);
          showThoughtForLine(ln);
        }
      })
        .on('mouseleave', () => {
          if (lockedLine !== null) return;
          clearDimming();
        })
        .on('click', (event: MouseEvent) => {
          event.stopPropagation();
          const ln = parseInt(el.attr('data-line-number') ?? '0', 10);
          if (lockedLine === ln) {
            lockedLine = null;
            clearDimming();
          } else {
            lockedLine = ln;
            applyDimming(ln);
            showThoughtForLine(ln);
            if (onNavigateToLine && ln) onNavigateToLine(ln);
          }
        });
    });
  }
}

// ============================================================
// Step Card Renderer
// ============================================================

function resolveStepColor(
  step: JourneyMapStep,
  scoreColor: string,
  activeGroup: string | null,
  tagGroups: readonly import('../utils/tag-groups').TagGroup[],
  _palette: PaletteColors
): string | undefined {
  if (!activeGroup) return undefined;

  // "Score" is a synthetic group — use the score-to-color mapping
  if (activeGroup.toLowerCase() === 'score') {
    return step.score !== undefined ? scoreColor : undefined;
  }

  // Tag group — find the matching group and look up the step's tag value
  const group = tagGroups.find(
    (g) => g.name.toLowerCase() === activeGroup.toLowerCase()
  );
  if (!group) return undefined;

  const tagValue = step.tags[tagAttrKey(group.name)];
  if (!tagValue) return undefined;

  const entry = group.entries.find(
    (e) => e.value.toLowerCase() === tagValue.toLowerCase()
  );
  return entry?.color;
}

function renderStepCard(
  parent: d3.Selection<SVGGElement, unknown, null, undefined>,
  sl: StepLayout,
  palette: PaletteColors,
  isDark: boolean,
  activeGroup: string | null,
  tagGroups: readonly import('../utils/tag-groups').TagGroup[],
  onNavigateToLine?: (line: number) => void,
  fillMode?: 'solid' | 'outline'
): void {
  const stepG = parent
    .append('g')
    .attr('class', 'journey-step')
    .attr('data-line-number', sl.step.lineNumber);

  // Data attributes for legend hover highlighting
  if (sl.step.score !== undefined) {
    stepG.attr('data-score', sl.step.score);
  }
  for (const [key, value] of Object.entries(sl.step.tags)) {
    stepG.attr(`data-tag-${key.toLowerCase()}`, value);
  }

  const cx = sl.x;
  const cy = sl.y;

  // Card colors — driven by active legend group (matches kanban pattern)
  const resolvedColor = resolveStepColor(
    sl.step,
    sl.color,
    activeGroup,
    tagGroups,
    palette
  );
  // Canonical 25% tint via shapeFill() (or full intent when solid-fill is on)
  const cardFill = shapeFill(
    palette,
    resolvedColor ?? palette.primary,
    isDark,
    { mode: fillMode }
  );
  const cardStroke = resolvedColor ?? palette.textMuted;
  // Text drawn on top of the card must contrast against the fill,
  // not against bg/surface (otherwise textMuted is illegible on solid fills).
  const onCardText = contrastText(
    cardFill,
    palette.textOnFillLight,
    palette.textOnFillDark
  );

  // Card background
  stepG
    .append('rect')
    .attr('x', cx)
    .attr('y', cy)
    .attr('width', sl.width)
    .attr('height', sl.height)
    .attr('rx', CARD_RADIUS)
    .attr('fill', cardFill)
    .attr('stroke', cardStroke)
    .attr('stroke-width', CARD_STROKE_WIDTH);

  // Title (wrapped)
  const titleMaxW = sl.width - CARD_PADDING_X * 2;
  const titleLines = wrapTextToWidth(sl.step.title, FONT_SIZE_STEP, titleMaxW);

  for (let i = 0; i < titleLines.length; i++) {
    stepG
      .append('text')
      .attr('x', cx + CARD_PADDING_X)
      .attr('y', cy + CARD_PADDING_Y + FONT_SIZE_STEP + i * TITLE_LINE_HEIGHT)
      .attr('font-size', FONT_SIZE_STEP)
      .attr('font-weight', '500')
      .attr('fill', onCardText)
      // In-bounds by loop guard.
      .text(titleLines[i]!);
  }

  const titleBlockH =
    CARD_PADDING_Y + titleLines.length * TITLE_LINE_HEIGHT + CARD_PADDING_Y;
  const cardAnnotations = sl.step.annotations;

  // Separator line between title and content (matches kanban)
  const hasContent = sl.step.description || cardAnnotations.length > 0;

  if (hasContent) {
    stepG
      .append('line')
      .attr('x1', cx)
      .attr('y1', cy + titleBlockH)
      .attr('x2', cx + sl.width)
      .attr('y2', cy + titleBlockH)
      // Solid mode: cardStroke matches the fill, so the divider is invisible.
      // Use the contrast text color at low opacity instead.
      .attr('stroke', fillMode === 'solid' ? onCardText : cardStroke)
      .attr('stroke-opacity', 0.3)
      .attr('stroke-width', 1);
  }

  let metaY = cy + titleBlockH + CARD_META_LINE_HEIGHT;

  // Description (wrapped text, matches kanban metadata style)
  if (sl.step.description) {
    const descLines = wrapTextToWidth(
      sl.step.description,
      FONT_SIZE_META,
      sl.width - CARD_PADDING_X * 2
    );
    for (const line of descLines) {
      stepG
        .append('text')
        .attr('x', cx + CARD_PADDING_X)
        .attr('y', metaY)
        .attr('font-size', FONT_SIZE_META)
        .attr('fill', onCardText)
        .text(line);
      metaY += CARD_META_LINE_HEIGHT;
    }
  }

  // Annotations (icon bullet + indented text)
  const ANNO_ICON_SIZE = 10;
  const ANNO_ICON_GAP = 4;
  const annoIconIndent = ANNO_ICON_SIZE + ANNO_ICON_GAP;
  const annoTextW = sl.width - CARD_PADDING_X * 2 - annoIconIndent;
  for (const anno of cardAnnotations) {
    const annoColor = annotationColor(anno.type, palette);
    const iconPaths = annotationIconPaths(anno.type);
    const annoLines = wrapTextToWidth(anno.text, FONT_SIZE_META, annoTextW);
    // Icon color: semantic in tint mode (red pain / green opportunity reads
    // fine on a 25% tinted card). In solid mode the semantic color often
    // matches the card fill (red icon on red card → invisible), so fall back
    // to the contrast color — the icon SHAPE still differentiates the type.
    const iconColor = fillMode === 'solid' ? onCardText : annoColor;
    // Icon as bullet, aligned to first line
    renderAnnotationIcon(
      stepG,
      cx + CARD_PADDING_X,
      metaY - ANNO_ICON_SIZE + 1,
      ANNO_ICON_SIZE,
      iconPaths,
      iconColor
    );
    // All text lines indented past the icon. Text uses the same
    // contrast color as the rest of the card body — the icon already
    // signals the annotation type. Without this, "thought" lines
    // (palette.textMuted) and "pain"/"opportunity" lines (red/green)
    // are illegible on solid fills.
    for (let li = 0; li < annoLines.length; li++) {
      stepG
        .append('text')
        .attr('x', cx + CARD_PADDING_X + annoIconIndent)
        .attr('y', metaY)
        .attr('font-size', FONT_SIZE_META)
        .attr('fill', onCardText)
        // In-bounds by loop guard.
        .text(annoLines[li]!);
      metaY += CARD_META_LINE_HEIGHT;
    }
  }

  // Tag strip — colored bar above the card
  for (const [key, value] of Object.entries(sl.step.tags)) {
    const group = tagGroups.find(
      (g) => g.name.toLowerCase() === key.toLowerCase()
    );
    const entry = group?.entries.find(
      (e) => e.value.toLowerCase() === value.toLowerCase()
    );
    const stripColor = entry?.color ?? palette.textMuted;
    const TAG_GAP = 6;
    const stripY = cy - TAG_STRIP_HEIGHT - TAG_GAP;
    // Canonical 25% tint via shapeFill() (or full intent when solid-fill is on)
    const stripFill = shapeFill(palette, stripColor, isDark, {
      mode: fillMode,
    });

    stepG
      .append('rect')
      .attr('x', cx)
      .attr('y', stripY)
      .attr('width', sl.width)
      .attr('height', TAG_STRIP_HEIGHT)
      .attr('rx', CARD_RADIUS)
      .attr('fill', stripFill)
      .attr('stroke', stripColor)
      .attr('stroke-width', CARD_STROKE_WIDTH);

    // Tag strip text — contrast against the strip fill, not against bg.
    const stripTextColor = contrastText(
      stripFill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );
    stepG
      .append('text')
      .attr('x', cx + sl.width / 2)
      .attr('y', stripY + TAG_STRIP_HEIGHT / 2)
      .attr('dominant-baseline', 'central')
      .attr('text-anchor', 'middle')
      .attr('font-size', FONT_SIZE_META)
      .attr('fill', stripTextColor)
      .text(value);
  }

  if (onNavigateToLine) {
    stepG.style('cursor', 'pointer').on('click', (event: MouseEvent) => {
      event.stopPropagation();
      onNavigateToLine(sl.step.lineNumber);
    });
  }
}

// ============================================================
// Helpers
// ============================================================

// ============================================================
// Persona Silhouette
// ============================================================

function renderPersonaSilhouette(
  parent: d3.Selection<SVGGElement, unknown, null, undefined>,
  cx: number,
  cy: number,
  color: string,
  palette: PaletteColors,
  isDark: boolean,
  scale = 1,
  fillMode?: 'solid' | 'outline'
): void {
  // Solid color border, muted fill that stands out slightly from card bg.
  // fill-outline hollows the figure to the theme base background so the
  // colored stroke alone draws it (tint + solid keep the 70% mix — the
  // silhouette is decorative and reads better with body than at full
  // saturation).
  const fill =
    fillMode === 'outline'
      ? themeBaseBg(palette, isDark)
      : mix(color, palette.bg, 70);
  const stroke = color;
  const s = scale;

  // Torso + neck (drawn first so head overlaps the junction cleanly)
  parent
    .append('path')
    .attr(
      'd',
      `M ${cx - 5 * s} ${cy + 6 * s}` +
        ` L ${cx - 5 * s} ${cy + 11 * s}` +
        ` L ${cx - 8 * s} ${cy + 11 * s}` +
        ` Q ${cx - 20 * s} ${cy + 12 * s}, ${cx - 20 * s} ${cy + 22 * s}` +
        ` L ${cx - 20 * s} ${cy + 36 * s}` +
        ` L ${cx + 20 * s} ${cy + 36 * s}` +
        ` L ${cx + 20 * s} ${cy + 22 * s}` +
        ` Q ${cx + 20 * s} ${cy + 12 * s}, ${cx + 8 * s} ${cy + 11 * s}` +
        ` L ${cx + 5 * s} ${cy + 11 * s}` +
        ` L ${cx + 5 * s} ${cy + 6 * s}` +
        ` Z`
    )
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', 1.2);

  // Head — oval (drawn on top, covers neck junction)
  parent
    .append('path')
    .attr(
      'd',
      `M ${cx} ${cy - 12 * s}` +
        ` C ${cx + 10 * s} ${cy - 12 * s}, ${cx + 9 * s} ${cy + 2 * s}, ${cx + 6 * s} ${cy + 6 * s}` +
        ` Q ${cx} ${cy + 9 * s}, ${cx - 6 * s} ${cy + 6 * s}` +
        ` C ${cx - 9 * s} ${cy + 2 * s}, ${cx - 10 * s} ${cy - 12 * s}, ${cx} ${cy - 12 * s}` +
        ` Z`
    )
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', 1.2);
}

// ============================================================
// Score Face Icon (SVG smiley)
// ============================================================

function renderScoreFace(
  parent: d3.Selection<SVGGElement, unknown, null, undefined>,
  cx: number,
  cy: number,
  score: number,
  palette: PaletteColors,
  isDark: boolean,
  radius?: number,
  fillMode?: 'solid' | 'outline'
): d3.Selection<SVGGElement, unknown, null, undefined> {
  const r = radius ?? FACE_RADIUS;
  const color = scoreToColor(score, palette);
  const g = parent
    .append('g')
    .attr('class', 'journey-face')
    .attr('data-cx', cx)
    .attr('data-cy', cy);

  // Inner group holding only the face visuals. Hover/focus scaling is applied
  // to THIS group, not the outer `g`, so the emotion caption (appended into the
  // outer group later) never grows or shifts down into the bottom border.
  const iconG = g.append('g').attr('class', 'journey-face-icon');

  // Face: a solid colored ring over the canonical tinted fill (the same
  // shapeFill() tint used for unsolid shapes elsewhere), with the eyes and
  // mouth drawn in the full score color. fill-outline hollows the disc
  // (theme-bg fill) so the ring + features alone carry the score color;
  // solid keeps the tint — a fully saturated disc would swallow the
  // same-color eyes/mouth.
  const faceFill =
    fillMode === 'outline'
      ? shapeFill(palette, color, isDark, { mode: 'outline' })
      : shapeFill(palette, color, isDark);

  // Thin bg halo so the colored ring reads crisply where it crosses the line.
  iconG
    .append('circle')
    .attr('cx', cx)
    .attr('cy', cy)
    .attr('r', r + 1)
    .attr('fill', palette.bg);

  iconG
    .append('circle')
    .attr('cx', cx)
    .attr('cy', cy)
    .attr('r', r)
    .attr('fill', faceFill)
    .attr('stroke', color)
    .attr('stroke-width', 2);

  // Eyes & mouth share the solid score color.
  const eyeColor = color;
  const eyeY = cy - r * 0.15;
  const eyeSpacing = r * 0.32;
  const eyeR = r * 0.12;
  iconG
    .append('circle')
    .attr('cx', cx - eyeSpacing)
    .attr('cy', eyeY)
    .attr('r', eyeR)
    .attr('fill', eyeColor);
  iconG
    .append('circle')
    .attr('cx', cx + eyeSpacing)
    .attr('cy', eyeY)
    .attr('r', eyeR)
    .attr('fill', eyeColor);

  // Mouth — arc curvature based on score
  // score 5: big smile, score 3: straight, score 1: deep frown
  const mouthW = r * 0.46;
  // Curve amount: positive = smile, negative = frown
  const curve = ((score - 3) / 2) * r * 0.42;
  // Pin the mouth's visual apex (its mid-point) to a fixed Y and let the
  // curvature swing symmetrically about it. Anchoring the corners instead made
  // the frown's arch ride up into the eyes and read as a cramped grimace.
  const apexY = cy + r * 0.32;
  const mouthY = apexY - curve / 2;

  iconG
    .append('path')
    .attr(
      'd',
      `M ${cx - mouthW} ${mouthY} Q ${cx} ${mouthY + curve} ${cx + mouthW} ${mouthY}`
    )
    .attr('fill', 'none')
    .attr('stroke', eyeColor)
    .attr('stroke-width', 1.2)
    .attr('stroke-linecap', 'round');

  return g;
}

// Max width an emotion caption may occupy. Curve faces sit at card centers
// (columns are ~190px wide and never overlap), so clamping each caption below
// the column width guarantees adjacent captions can never collide horizontally,
// however tight the journey gets.
const EMOTION_LABEL_MAX_WIDTH = 180;
const EMOTION_LABEL_FONT_SIZE = FONT_SIZE_META;

/**
 * Caption a curve face with its emotion word. Appended INTO the face group so
 * it dims / navigates with the face. Always placed BELOW the face: the curve
 * band reserves a gap beneath the lowest face before the cards, and — crucially
 * — the hover thought-bubble always pops ABOVE the face, so a below-caption is
 * never occluded on hover (above-captions were). Below also keeps every caption
 * clear of the persona box / title at the top of the band.
 */
function addEmotionLabel(
  faceG: d3.Selection<SVGGElement, unknown, null, undefined>,
  pt: CurvePoint,
  palette: PaletteColors
): void {
  if (!pt.emotionLabel) return;
  const text = truncateToWidth(
    pt.emotionLabel,
    EMOTION_LABEL_FONT_SIZE,
    EMOTION_LABEL_MAX_WIDTH
  );
  const y = pt.y + FACE_RADIUS + 5 + EMOTION_LABEL_FONT_SIZE;

  faceG
    .append('text')
    .attr('class', 'journey-emotion-label')
    .attr('x', pt.x)
    .attr('y', y)
    .attr('text-anchor', 'middle')
    .attr('font-family', FONT_FAMILY)
    .attr('font-size', EMOTION_LABEL_FONT_SIZE)
    .attr('font-weight', 500)
    .attr('fill', palette.text)
    .attr('stroke', palette.bg)
    .attr('stroke-width', 3)
    .attr('stroke-linejoin', 'round')
    .attr('stroke-opacity', 0.8)
    .attr('paint-order', 'stroke')
    .attr('pointer-events', 'none')
    .text(text);
}

function annotationColor(
  type: JourneyMapAnnotation['type'],
  palette: PaletteColors
): string {
  switch (type) {
    case 'pain':
      return palette.colors.red;
    case 'opportunity':
      return palette.colors.green;
    case 'thought':
      return palette.textMuted;
  }
}

// Lucide icon paths (24×24 viewBox, ISC license)
const ICON_THUMBS_DOWN: string[] = [
  'M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z',
  'M17 14V2',
];
const ICON_THUMBS_UP: string[] = [
  'M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z',
  'M7 10v12',
];
const ICON_THOUGHT: string[] = [
  'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5',
  'M9 18h6',
  'M10 22h4',
];

function annotationIconPaths(type: JourneyMapAnnotation['type']): string[] {
  switch (type) {
    case 'pain':
      return ICON_THUMBS_DOWN;
    case 'opportunity':
      return ICON_THUMBS_UP;
    case 'thought':
      return ICON_THOUGHT;
  }
}

/** Render a lucide-style icon (24×24 viewBox) scaled to fit `size` px. */
function renderAnnotationIcon(
  parent: d3.Selection<SVGGElement, unknown, null, undefined>,
  x: number,
  y: number,
  size: number,
  paths: string[],
  color: string
): void {
  const g = parent.append('g').attr('transform', `translate(${x}, ${y})`);
  const scale = size / 24;
  const inner = g.append('g').attr('transform', `scale(${scale})`);
  for (const d of paths) {
    inner
      .append('path')
      .attr('d', d)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round');
  }
}

// ============================================================
// Export Renderer
// ============================================================

export function renderJourneyMapForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors
): string {
  const parsed = parseJourneyMap(content, palette);
  if (
    parsed.error ||
    (parsed.phases.length === 0 && parsed.steps.length === 0)
  ) {
    return '';
  }

  const isDark = theme === 'dark';
  const layout = layoutJourneyMap(parsed, palette, { isDark });

  const container = document.createElement('div');
  renderJourneyMap(container, parsed, palette, isDark, {
    exportDims: { width: layout.totalWidth, height: layout.totalHeight },
    exportMode: true,
  });

  const svgEl = container.querySelector('svg');
  if (!svgEl) return '';

  // Handle transparent background
  if (theme === 'transparent') {
    const bgRect = svgEl.querySelector('rect:first-child');
    if (bgRect) bgRect.remove();
  }

  return serializeSvg(svgEl);
}

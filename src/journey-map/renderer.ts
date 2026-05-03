import * as d3 from 'd3-selection';
import * as d3Shape from 'd3-shape';
import type { PaletteColors } from '../palettes';
import { contrastText, mix, shapeFill } from '../palettes/color-utils';
import { FONT_FAMILY } from '../fonts';
import { parseJourneyMap } from './parser';
import {
  layoutJourneyMap,
  scoreToColor,
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
import { renderLegendD3 } from '../utils/legend-d3';
import type { LegendConfig, LegendState } from '../utils/legend-types';
import { resolveActiveTagGroup } from '../utils/tag-groups';

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
}

// ============================================================
// Constants
// ============================================================

// Match kanban styling constants
const DIAGRAM_PADDING = 20;
const PADDING = DIAGRAM_PADDING;
const CARD_RADIUS = 6;
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
const FONT_SIZE_PHASE = 13;
const FONT_SIZE_STEP = 12;
const FONT_SIZE_META = 10;
const GRID_LINE_OPACITY = 0.15;
const CURVE_STROKE_WIDTH = 2.5;
const FACE_RADIUS = 14;
const DIM_HOVER = 0.25;
const TITLE_LINE_HEIGHT = 16;
const TITLE_CHAR_WIDTH = 6.5;

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
  const solid = parsed.options['solid-fill'] === 'on';

  const layout = layoutJourneyMap(parsed, palette, {
    collapsedPhases,
    exportDims,
    isDark,
  });

  // Clear container
  container.innerHTML = '';

  // For interactive mode, fit the diagram to the container
  const containerW = exportDims?.width ?? container.clientWidth;
  const containerH = exportDims?.height ?? container.clientHeight;
  const useContainerFit = !exportDims && containerW > 0 && containerH > 0;

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
  if (parsed.title) {
    const titleG = svg.append('g').attr('class', 'chart-title');
    if (parsed.titleLineNumber) {
      titleG.attr('data-line-number', parsed.titleLineNumber);
    }
    titleG
      .append('text')
      .attr('x', PADDING)
      .attr('y', PADDING + FONT_SIZE_TITLE)
      .attr('font-size', FONT_SIZE_TITLE)
      .attr('font-weight', 'bold')
      .attr('fill', palette.text)
      .text(parsed.title);

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
    const panelWidth = 280;
    const textAreaWidth = panelWidth - silhouetteZone - CARD_PADDING_X;
    const descLineH = 14;

    // Wrap description text into lines
    const descLines = parsed.persona.description
      ? wrapText(parsed.persona.description, textAreaWidth, FONT_SIZE_META)
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
    const personaFill = shapeFill(palette, personaColor, isDark, { solid });

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
        .attr('stroke', personaColor)
        .attr('stroke-opacity', 0.3)
        .attr('stroke-width', 1);
    }

    // Silhouette (clipped inside card, more right padding, taller)
    const silX = panelX + panelWidth - 32;
    const silY = panelY + panelHeight / 2 - 6;
    const silClip = personaG.append('g').attr('clip-path', `url(#${clipId})`);
    renderPersonaSilhouette(silClip, silX, silY, personaColor, palette, 1.2);

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
      .attr('fill', palette.text)
      .text(parsed.persona.name);

    // Description — wrapped lines below divider, with inline markdown
    for (let li = 0; li < descLines.length; li++) {
      const lineEl = personaG
        .append('text')
        .attr('x', textX)
        .attr('y', panelY + titleRowH + descLineH * (li + 1))
        .attr('font-size', FONT_SIZE_META)
        .attr('fill', palette.textMuted);
      renderInlineText(lineEl, descLines[li], palette, FONT_SIZE_META);
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
    const legendY = PADDING + (parsed.title ? FONT_SIZE_TITLE + 8 : 0);
    const legendG = svg
      .append('g')
      .attr('class', 'journey-legend')
      .attr('transform', `translate(${legendX},${legendY})`);

    const legendConfig: LegendConfig = {
      groups: parsed.tagGroups,
      position: {
        placement: 'top-center',
        titleRelation: 'inline-with-title',
      },
      titleWidth: 0,
      mode: exportDims ? 'inline' : 'fixed',
    };

    const legendState: LegendState = { activeGroup: effectiveActiveGroup };

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
                svg
                  .selectAll('.journey-face')
                  .style('opacity', null)
                  .attr('transform', null);
                svg.selectAll('.journey-thought').style('opacity', null);
                return;
              }

              const isScore = groupName === 'Score';
              const attrName = isScore
                ? 'data-score'
                : `data-tag-${groupName.toLowerCase()}`;

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
                  if (hit) {
                    const fcx = parseFloat(sel.attr('data-cx') ?? '0');
                    const fcy = parseFloat(sel.attr('data-cy') ?? '0');
                    sel.attr(
                      'transform',
                      `translate(${fcx},${fcy}) scale(1.3) translate(${-fcx},${-fcy})`
                    );
                  } else {
                    sel.attr('transform', null);
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

    renderLegendD3(
      legendG,
      legendConfig,
      legendState,
      palette,
      isDark,
      legendCallbacks,
      // Reduce available width if persona card exists to avoid collision
      parsed.persona
        ? layout.totalWidth - legendX - PADDING - 280 - PADDING
        : layout.totalWidth - legendX - PADDING
    );
  }

  // ── Curve Area ───────────────────────────────────────────
  const curveG = svg.append('g').attr('class', 'journey-curve-area');

  // Grid lines at score levels 1-5
  for (let score = 1; score <= 5; score++) {
    const y =
      layout.curveAreaBottom -
      ((score - 1) / 4) * (layout.curveAreaBottom - layout.curveAreaTop - 120) -
      10;

    curveG
      .append('line')
      .attr('x1', PADDING)
      .attr('x2', layout.totalWidth - PADDING)
      .attr('y1', y)
      .attr('y2', y)
      .attr('stroke', palette.textMuted)
      .attr('stroke-opacity', GRID_LINE_OPACITY)
      .attr('stroke-dasharray', '4,4');

    // Score label — emotion face icon
    const SCORE_LABEL_R = 8;
    const labelG = curveG
      .append('g')
      .attr('class', 'journey-score-label')
      .attr('data-score', String(score));
    renderScoreFace(
      labelG,
      PADDING - SCORE_LABEL_R - 2,
      y,
      score,
      palette,
      SCORE_LABEL_R
    );

    // Score label interactivity is wired up in the click-to-lock section below
    if (!exportDims) {
      labelG.style('cursor', 'pointer');
    }
  }

  // Emotion curve (area fill + line)
  if (layout.curvePoints.length >= 2) {
    // Extend curve to edges with flat continuations
    const first = layout.curvePoints[0];
    const last = layout.curvePoints[layout.curvePoints.length - 1];
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

    const areaGen = d3Shape
      .area<CurvePoint>()
      .x((d) => d.x)
      .y0(layout.curveAreaBottom + FACE_RADIUS)
      .y1((d) => d.y)
      .curve(d3Shape.curveMonotoneX);

    curveG
      .append('path')
      .attr('d', areaGen(extendedPoints) ?? '')
      .attr('fill', 'url(#journey-curve-gradient)')
      .attr('stroke', 'none');

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
      const faceG = renderScoreFace(curveG, pt.x, pt.y, pt.score, palette);
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
    const pt = layout.curvePoints[0];
    const allSteps =
      parsed.phases.length > 0
        ? parsed.phases.flatMap((p) => p.steps)
        : parsed.steps;
    const step = allSteps[pt.stepIndex];
    const faceG = renderScoreFace(curveG, pt.x, pt.y, pt.score, palette);
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

      // Column header text (always show full name)
      phaseG
        .append('text')
        .attr('x', pl.x + COLUMN_PADDING)
        .attr('y', pl.y + COLUMN_HEADER_HEIGHT / 2 + FONT_SIZE_PHASE / 2 - 2)
        .attr('font-size', FONT_SIZE_PHASE)
        .attr('font-weight', 'bold')
        .attr('fill', palette.text)
        .text(
          isCollapsed
            ? truncateText(pl.phase.name, pl.width - COLUMN_PADDING * 2)
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
            { solid }
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
              COLLAPSED_FACE_R
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
            .attr('y', itemY + COLLAPSED_CARD_H / 2 + FONT_SIZE_META / 2 - 1)
            .attr('font-size', FONT_SIZE_META)
            .attr('fill', palette.text)
            .text(truncateText(step.title, maxTextW));

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
            solid
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
        solid
      );
    }
  }

  // Top-level overlay group for hover elements (renders above everything)
  const overlayG = svg.append('g').attr('class', 'journey-overlay');

  // ── Hover + click-to-lock dimming ─────────────────────
  if (!exportDims) {
    const DIM_OPACITY = 0.35;
    let lockedLine: number | null = null;
    let lockedScore: number | null = null;

    // Helper: dim everything except elements matching a score value
    const applyScoreDimming = (activeScore: number) => {
      const scoreStr = String(activeScore);
      svg.selectAll<SVGGElement, unknown>('.journey-step').each(function () {
        const hit = this.getAttribute('data-score') === scoreStr;
        d3.select(this).style('opacity', hit ? '1' : String(DIM_HOVER));
      });
      svg.selectAll<SVGGElement, unknown>('.journey-face').each(function () {
        const hit = this.getAttribute('data-score') === scoreStr;
        const sel = d3.select(this);
        sel.style('opacity', hit ? '1' : String(DIM_HOVER));
        if (hit) {
          const fcx = parseFloat(sel.attr('data-cx') ?? '0');
          const fcy = parseFloat(sel.attr('data-cy') ?? '0');
          sel.attr(
            'transform',
            `translate(${fcx},${fcy}) scale(1.3) translate(${-fcx},${-fcy})`
          );
        } else {
          sel.attr('transform', null);
        }
      });
      svg
        .selectAll<SVGGElement, unknown>('.journey-thought')
        .style('opacity', String(DIM_HOVER));
      // Highlight the active y-axis score label, dim the rest
      svg
        .selectAll<SVGGElement, unknown>('.journey-score-label')
        .each(function () {
          const sel = d3.select(this);
          const s = sel.attr('data-score');
          sel.style('opacity', s === scoreStr ? '1' : String(DIM_HOVER));
        });
    };

    const clearScoreDimming = () => {
      svg.selectAll('.journey-step').style('opacity', null);
      svg
        .selectAll('.journey-face')
        .style('opacity', null)
        .attr('transform', null);
      svg.selectAll('.journey-thought').style('opacity', null);
      svg.selectAll('.journey-score-label').style('opacity', null);
    };

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
        if (isActive) {
          const fcx = parseFloat(el.attr('data-cx') ?? '0');
          const fcy = parseFloat(el.attr('data-cy') ?? '0');
          el.attr(
            'transform',
            `translate(${fcx},${fcy}) scale(1.5) translate(${-fcx},${-fcy})`
          );
        } else {
          el.attr('transform', null);
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
      svg
        .selectAll('.journey-face')
        .style('opacity', null)
        .attr('transform', null);
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

      const lines = wrapText(thoughtText, THOUGHT_MAX_W, THOUGHT_FONT);
      const textW = Math.min(
        THOUGHT_MAX_W,
        Math.max(...lines.map((l) => l.length * THOUGHT_FONT * 0.6))
      );
      const bw = textW + THOUGHT_PAD_X * 2;
      const bh = lines.length * THOUGHT_LINE_H + THOUGHT_PAD_Y * 2;

      // Position above the face, overlaying the curve area (clamp to stay in view)
      const bx = Math.max(
        PADDING,
        Math.min(fcx - bw / 2, layout.totalWidth - PADDING - bw)
      );
      const by = Math.max(PADDING, fcy - FACE_RADIUS - THOUGHT_GAP - bh);

      const scoreColor = scoreToColor(score, palette);
      const tintedBg = mix(scoreColor, palette.surface, 20);

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
        .attr('y2', fcy - FACE_RADIUS - 1)
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
          .text(lines[i]);
      }
    };

    // Click background to unlock
    svg.on('click', (event: MouseEvent) => {
      const target = event.target as Element;
      if (
        !target.closest('.journey-face') &&
        !target.closest('.journey-step') &&
        !target.closest('.journey-phase') &&
        !target.closest('.journey-score-label')
      ) {
        lockedLine = null;
        lockedScore = null;
        clearDimming();
        clearScoreDimming();
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
        if (lockedLine !== null || lockedScore !== null) return;
        const ln = parseInt(el.attr('data-line-number') ?? '0', 10);
        if (ln) {
          applyDimming(ln);
          showThoughtForLine(ln);
        }
      })
        .on('mouseleave', () => {
          if (lockedLine !== null || lockedScore !== null) return;
          clearDimming();
        })
        .on('click', (event: MouseEvent) => {
          event.stopPropagation();
          if (lockedScore !== null) {
            lockedScore = null;
            clearScoreDimming();
            return;
          }
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
        if (lockedLine !== null || lockedScore !== null) return;
        const ln = parseInt(el.attr('data-line-number') ?? '0', 10);
        if (ln) {
          applyDimming(ln);
          showThoughtForLine(ln);
        }
      })
        .on('mouseleave', () => {
          if (lockedLine !== null || lockedScore !== null) return;
          clearDimming();
        })
        .on('click', (event: MouseEvent) => {
          event.stopPropagation();
          if (lockedScore !== null) {
            lockedScore = null;
            clearScoreDimming();
            return;
          }
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

    // Hover + click on y-axis score labels
    svg
      .selectAll<SVGGElement, unknown>('.journey-score-label')
      .each(function () {
        const el = d3.select<SVGGElement, unknown>(this);
        const score = parseInt(el.attr('data-score') ?? '0', 10);
        el.on('mouseenter', () => {
          if (lockedLine !== null || lockedScore !== null) return;
          applyScoreDimming(score);
        })
          .on('mouseleave', () => {
            if (lockedLine !== null || lockedScore !== null) return;
            clearScoreDimming();
          })
          .on('click', (event: MouseEvent) => {
            event.stopPropagation();
            if (lockedLine !== null) {
              lockedLine = null;
              clearDimming();
            }
            if (lockedScore === score) {
              lockedScore = null;
              clearScoreDimming();
            } else {
              lockedScore = score;
              applyScoreDimming(score);
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
  tagGroups: import('../utils/tag-groups').TagGroup[],
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

  const tagValue = step.tags[group.name.toLowerCase()];
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
  tagGroups: import('../utils/tag-groups').TagGroup[],
  onNavigateToLine?: (line: number) => void,
  solid?: boolean
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
    {
      solid,
    }
  );
  const cardStroke = resolvedColor ?? palette.textMuted;

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
  const titleMaxChars = Math.max(1, Math.floor(titleMaxW / TITLE_CHAR_WIDTH));
  const titleWords = sl.step.title.split(/\s+/);
  const titleLines: string[] = [];
  let titleCur = '';
  for (const w of titleWords) {
    const candidate = titleCur ? `${titleCur} ${w}` : w;
    if (candidate.length > titleMaxChars && titleCur) {
      titleLines.push(titleCur);
      titleCur = w;
    } else {
      titleCur = candidate;
    }
  }
  if (titleCur) titleLines.push(titleCur);

  for (let i = 0; i < titleLines.length; i++) {
    stepG
      .append('text')
      .attr('x', cx + CARD_PADDING_X)
      .attr('y', cy + CARD_PADDING_Y + FONT_SIZE_STEP + i * TITLE_LINE_HEIGHT)
      .attr('font-size', FONT_SIZE_STEP)
      .attr('font-weight', '500')
      .attr('fill', palette.text)
      .text(titleLines[i]);
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
      .attr('stroke', cardStroke)
      .attr('stroke-opacity', 0.3)
      .attr('stroke-width', 1);
  }

  let metaY = cy + titleBlockH + CARD_META_LINE_HEIGHT;

  // Description (wrapped text, matches kanban metadata style)
  if (sl.step.description) {
    const descLines = wrapText(
      sl.step.description,
      sl.width - CARD_PADDING_X * 2,
      FONT_SIZE_META
    );
    for (const line of descLines) {
      stepG
        .append('text')
        .attr('x', cx + CARD_PADDING_X)
        .attr('y', metaY)
        .attr('font-size', FONT_SIZE_META)
        .attr('fill', palette.textMuted)
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
    const annoLines = wrapText(anno.text, annoTextW, FONT_SIZE_META);
    // Icon as bullet, aligned to first line
    renderAnnotationIcon(
      stepG,
      cx + CARD_PADDING_X,
      metaY - ANNO_ICON_SIZE + 1,
      ANNO_ICON_SIZE,
      iconPaths,
      annoColor
    );
    // All text lines indented past the icon
    for (let li = 0; li < annoLines.length; li++) {
      stepG
        .append('text')
        .attr('x', cx + CARD_PADDING_X + annoIconIndent)
        .attr('y', metaY)
        .attr('font-size', FONT_SIZE_META)
        .attr('fill', annoColor)
        .text(annoLines[li]);
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
    const stripFill = shapeFill(palette, stripColor, isDark, { solid });

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

    stepG
      .append('text')
      .attr('x', cx + sl.width / 2)
      .attr('y', stripY + TAG_STRIP_HEIGHT / 2 + FONT_SIZE_META / 2 - 1)
      .attr('text-anchor', 'middle')
      .attr('font-size', FONT_SIZE_META)
      .attr('fill', palette.text)
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
  scale = 1
): void {
  // Solid color border, muted fill that stands out slightly from card bg
  const fill = mix(color, palette.bg, 70);
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
  radius?: number
): d3.Selection<SVGGElement, unknown, null, undefined> {
  const r = radius ?? FACE_RADIUS;
  const color = scoreToColor(score, palette);
  const g = parent
    .append('g')
    .attr('class', 'journey-face')
    .attr('data-cx', cx)
    .attr('data-cy', cy);

  // Face circle
  g.append('circle')
    .attr('cx', cx)
    .attr('cy', cy)
    .attr('r', r)
    .attr('fill', color)
    .attr('stroke', palette.bg)
    .attr('stroke-width', 1.5);

  // Eyes
  const eyeColor = contrastText(
    color,
    palette.textOnFillLight,
    palette.textOnFillDark
  );
  const eyeY = cy - r * 0.15;
  const eyeSpacing = r * 0.32;
  const eyeR = r * 0.12;
  g.append('circle')
    .attr('cx', cx - eyeSpacing)
    .attr('cy', eyeY)
    .attr('r', eyeR)
    .attr('fill', eyeColor);
  g.append('circle')
    .attr('cx', cx + eyeSpacing)
    .attr('cy', eyeY)
    .attr('r', eyeR)
    .attr('fill', eyeColor);

  // Mouth — arc curvature based on score
  // score 5: big smile, score 3: straight, score 1: deep frown
  const mouthY = cy + r * 0.25;
  const mouthW = r * 0.45;
  // Curve amount: positive = smile, negative = frown
  const curve = ((score - 3) / 2) * r * 0.35;

  g.append('path')
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

function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const charWidth = fontSize * 0.6;
  const maxChars = Math.floor(maxWidth / charWidth);
  if (maxChars <= 0) return [text];

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function truncateText(text: string, maxWidth: number): string {
  const maxChars = Math.floor(maxWidth / 6.6);
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 1) + '\u2026';
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
  });

  const svgEl = container.querySelector('svg');
  if (!svgEl) return '';

  // Handle transparent background
  if (theme === 'transparent') {
    const bgRect = svgEl.querySelector('rect:first-child');
    if (bgRect) bgRect.remove();
  }

  return svgEl.outerHTML;
}

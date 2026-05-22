import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { mix, shapeFill } from '../palettes/color-utils';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type {
  ParsedTechRadar,
  QuadrantPosition,
  TechRadarBlip,
  TechRadarRenderOptions,
} from './types';
import { getQuadrantArc } from './layout';
import {
  resolveQuadrantColor,
  renderTrendIndicator,
  createTooltip,
  DIM_OPACITY,
} from './shared';
import { parseInlineMarkdown } from '../utils/inline-markdown';
import { safeHref } from '../utils/safe-href';

// ============================================================
// Constants
// ============================================================

const BLIP_RADIUS = 13;
const BLIP_FONT_SIZE = 10;
const TITLE_FONT_SIZE = 16;
const NARROW_BREAKPOINT = 600;

// ============================================================
// Quadrant Focus Renderer
// ============================================================

export function renderQuadrantFocus(
  container: HTMLDivElement,
  parsed: ParsedTechRadar,
  quadrantPosition: QuadrantPosition,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions,
  _options?: TechRadarRenderOptions
): void {
  const quadrant = parsed.quadrants.find(
    (q) => q.position === quadrantPosition
  );
  if (!quadrant) return;

  // Clear container
  container.innerHTML = '';

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const isNarrow = width < NARROW_BREAKPOINT;
  const qColor = resolveQuadrantColor(
    quadrant.position,
    quadrant.color,
    palette
  );

  // ── Breadcrumb title ──
  const titleBar = document.createElement('div');
  titleBar.style.cssText = `
    display: flex; align-items: baseline; gap: 8px;
    padding: 8px 12px; font-family: ${FONT_FAMILY};
    font-size: ${TITLE_FONT_SIZE}px; background: ${palette.bg};
  `;

  const titleLink = document.createElement('span');
  titleLink.textContent = parsed.title || 'Tech Radar';
  titleLink.style.cssText = `font-weight: bold; color: ${palette.text}; cursor: pointer;`;
  titleLink.setAttribute('data-line-number', String(parsed.titleLineNumber));

  const sep = document.createElement('span');
  sep.textContent = '›';
  sep.style.color = palette.border;

  const quadrantLabel = document.createElement('span');
  quadrantLabel.textContent = quadrant.name;
  quadrantLabel.style.cssText = `font-weight: bold; color: ${qColor};`;

  titleBar.appendChild(titleLink);
  titleBar.appendChild(sep);
  titleBar.appendChild(quadrantLabel);
  container.appendChild(titleBar);

  // ── Main layout: SVG radar (left) + HTML panel (right) ──
  const mainLayout = document.createElement('div');
  mainLayout.style.cssText = `
    display: flex; flex-direction: ${isNarrow ? 'column' : 'row'};
    flex: 1; min-height: 0; height: calc(100% - 40px); background: ${palette.bg};
  `;
  container.appendChild(mainLayout);

  // SVG container for quarter-circle
  const svgContainer = document.createElement('div');
  svgContainer.style.cssText = `
    ${isNarrow ? 'height: 40%;' : 'width: 50%; min-width: 200px;'}
    flex-shrink: 0;
  `;
  mainLayout.appendChild(svgContainer);

  // HTML panel for blip listing
  const panel = document.createElement('div');
  panel.style.cssText = `
    flex: 1; overflow-y: auto; padding: 8px 12px;
    font-family: ${FONT_FAMILY}; background: ${palette.bg};
  `;
  mainLayout.appendChild(panel);

  // ── Render HTML side panel first (returns toggle callback for radar clicks) ──
  const toggleBlip = renderHtmlPanel(
    panel,
    parsed,
    quadrant,
    qColor,
    palette,
    isDark,
    container,
    onClickItem
  );

  // ── Render quarter-circle SVG ──
  const svgWidth = svgContainer.clientWidth || (isNarrow ? width : width * 0.5);
  const svgHeight =
    svgContainer.clientHeight || (isNarrow ? height * 0.4 : height - 40);

  const svg = d3Selection
    .select(svgContainer)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${svgWidth} ${svgHeight}`)
    .style('background', palette.bg);

  const tooltip = createTooltip(container, palette, isDark);

  renderQuarterCircle(
    svg,
    parsed,
    quadrant,
    qColor,
    palette,
    isDark,
    svgWidth,
    svgHeight,
    palette.border,
    tooltip,
    container,
    toggleBlip
  );

  // ── Click handlers for title (back navigation) ──
  titleLink.addEventListener('click', () => {
    if (onClickItem) onClickItem(parsed.titleLineNumber);
  });

  // ── Active line from editor cursor → expand that blip in the panel ──
  if (_options?.activeLine) {
    const activeLn = _options.activeLine;
    for (const blip of quadrant.blips) {
      const isOnBlip = blip.lineNumber === activeLn;
      const isOnDesc =
        blip.description.length > 0 &&
        activeLn > blip.lineNumber &&
        activeLn <= blip.lineNumber + blip.description.length;
      if (isOnBlip || isOnDesc) {
        toggleBlip(blip.lineNumber);
        break;
      }
    }
  }
}

// ============================================================
// Quarter-Circle SVG Rendering
// ============================================================

function renderQuarterCircle(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  parsed: ParsedTechRadar,
  quadrant: ParsedTechRadar['quadrants'][number],
  qColor: string,
  palette: PaletteColors,
  isDark: boolean,
  width: number,
  height: number,
  mutedColor: string,
  _tooltip: HTMLDivElement,
  rootContainer: HTMLElement,
  onClickItem?: (lineNumber: number) => void
): void {
  const padding = 8;
  const size = Math.min(width - padding, height - padding);
  const maxRadius = size * 0.95;
  const ringCount = parsed.rings.length;
  const ringBandWidth = maxRadius / ringCount;

  const { startAngle, endAngle } = getQuadrantArc(quadrant.position);
  let cx: number, cy: number;

  switch (quadrant.position) {
    case 'top-right':
      cx = padding;
      cy = size + padding;
      break;
    case 'top-left':
      cx = width - padding;
      cy = size + padding;
      break;
    case 'bottom-left':
      cx = width - padding;
      cy = padding;
      break;
    case 'bottom-right':
      cx = padding;
      cy = padding;
      break;
  }

  // Ring arcs with zebra shading
  const arcGen = (innerR: number, outerR: number) =>
    `M${cx + outerR * Math.cos(startAngle)},${cy - outerR * Math.sin(startAngle)} A${outerR},${outerR} 0 0,0 ${cx + outerR * Math.cos(endAngle)},${cy - outerR * Math.sin(endAngle)} L${cx + innerR * Math.cos(endAngle)},${cy - innerR * Math.sin(endAngle)} A${innerR},${innerR} 0 0,1 ${cx + innerR * Math.cos(startAngle)},${cy - innerR * Math.sin(startAngle)} Z`;

  for (let ri = parsed.rings.length - 1; ri >= 0; ri--) {
    const innerR = ri * ringBandWidth;
    const outerR = (ri + 1) * ringBandWidth;
    const fillColor =
      ri % 2 === 0 ? palette.bg : mix(palette.bg, palette.border, 0.15);

    // In-bounds by loop guard (ri < parsed.rings.length).
    const ringName = parsed.rings[ri]!.name;

    // Background ring arc
    svg
      .append('path')
      .attr('d', arcGen(innerR, outerR))
      .attr('fill', fillColor)
      .attr('stroke', mutedColor)
      .attr('stroke-width', 0.5);

    // Transparent hover overlay for ring interaction
    svg
      .append('path')
      .attr('d', arcGen(innerR, outerR))
      .attr('fill', 'transparent')
      .attr('data-ring-arc', ringName)
      .style('cursor', 'pointer')
      .on('mouseenter', () => {
        // Tint the hovered ring arc
        d3Selection
          .select(rootContainer)
          .selectAll<SVGPathElement, unknown>('[data-ring-arc]')
          .each(function () {
            const el = d3Selection.select(this);
            const isMatch = this.getAttribute('data-ring-arc') === ringName;
            el.attr('fill', isMatch ? qColor : 'transparent').attr(
              'opacity',
              isMatch ? 0.15 : 1
            );
          });
        dimExceptRing(rootContainer, ringName);
      })
      .on('mouseleave', () => {
        d3Selection
          .select(rootContainer)
          .selectAll<SVGPathElement, unknown>('[data-ring-arc]')
          .attr('fill', 'transparent')
          .attr('opacity', 1);
        clearDim(rootContainer);
      });
  }

  // Ring labels removed — the side panel ring headers serve this purpose

  // Blip dots
  const ringOrder = parsed.rings.map((r) => r.name);
  const angularPadding = 0.08;
  const radialPadding = ringBandWidth * 0.12;
  const usableArcStart = startAngle + angularPadding;
  const usableArcEnd = endAngle - angularPadding;
  const arcSpan = usableArcEnd - usableArcStart;

  const blipsByRing = new Map<string, TechRadarBlip[]>();
  for (const blip of quadrant.blips) {
    const list = blipsByRing.get(blip.ring) ?? [];
    list.push(blip);
    blipsByRing.set(blip.ring, list);
  }

  for (const [ringName, blips] of blipsByRing) {
    const ringIndex = ringOrder.indexOf(ringName);
    if (ringIndex < 0) continue;
    const rInner = ringIndex * ringBandWidth + radialPadding;
    const rOuter = (ringIndex + 1) * ringBandWidth - radialPadding;
    const rMid = (rInner + rOuter) / 2;

    for (let bi = 0; bi < blips.length; bi++) {
      // In-bounds by loop guard (bi < blips.length).
      const blip = blips[bi]!;
      const angle =
        blips.length === 1
          ? (usableArcStart + usableArcEnd) / 2
          : usableArcStart + ((bi + 0.5) / blips.length) * arcSpan;

      const radius =
        blips.length <= 3
          ? rMid
          : rInner +
            BLIP_RADIUS +
            ((bi % 3) / 2) * (rOuter - rInner - BLIP_RADIUS * 2);

      const bx = cx + radius * Math.cos(angle);
      const by = cy - radius * Math.sin(angle);

      const blipGroup = svg
        .append('g')
        .attr('data-line-number', blip.lineNumber)
        .attr('data-ring', blip.ring)
        .attr('data-trend', blip.trend ?? 'stable')
        .style('cursor', 'pointer');

      const angleToCenter = Math.atan2(cy - by, cx - bx);
      renderTrendIndicator(
        blipGroup,
        blip.trend,
        qColor,
        bx,
        by,
        BLIP_RADIUS,
        angleToCenter
      );

      blipGroup
        .append('text')
        .attr('x', bx)
        .attr('y', by + 3)
        .attr('text-anchor', 'middle')
        .attr('fill', isDark ? '#000' : '#fff')
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', BLIP_FONT_SIZE)
        .attr('font-weight', 'bold')
        .text(blip.globalNumber);

      // Hover: scale up + dim others (preview only, no expansion)
      const lineNum = String(blip.lineNumber);
      blipGroup
        .on('mouseenter', () => {
          blipGroup.attr(
            'transform',
            `translate(${bx},${by}) scale(1.5) translate(${-bx},${-by})`
          );
          dimExcept(rootContainer, lineNum);
        })
        .on('mouseleave', () => {
          blipGroup.attr('transform', null);
          clearDim(rootContainer);
        });

      // Click: expand description in panel (persistent)
      blipGroup.on('click', () => {
        if (onClickItem) {
          onClickItem(blip.lineNumber);
          requestAnimationFrame(() => dimExcept(rootContainer, lineNum));
        }
      });
    }
  }
}

// ============================================================
// Cross-highlight helpers (work across SVG + HTML)
// ============================================================

function dimExcept(root: HTMLElement, lineNum: string): void {
  root.querySelectorAll<HTMLElement>('[data-line-number]').forEach((el) => {
    el.style.opacity =
      el.getAttribute('data-line-number') === lineNum
        ? '1'
        : String(DIM_OPACITY);
  });
}

function dimExceptRing(root: HTMLElement, ringName: string): void {
  // Dim blips not in the hovered ring (SVG + HTML)
  root.querySelectorAll<HTMLElement>('[data-line-number]').forEach((el) => {
    el.style.opacity =
      el.getAttribute('data-ring') === ringName ? '1' : String(DIM_OPACITY);
  });
  // Dim ring groups not matching
  root.querySelectorAll<HTMLElement>('[data-ring-group]').forEach((el) => {
    el.style.opacity =
      el.getAttribute('data-ring-group') === ringName
        ? '1'
        : String(DIM_OPACITY);
  });
}

function clearDim(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-line-number]').forEach((el) => {
    el.style.opacity = '1';
  });
  root.querySelectorAll<HTMLElement>('[data-ring-group]').forEach((el) => {
    el.style.opacity = '1';
  });
}

// ============================================================
// HTML Side Panel
// ============================================================

/**
 * Render the HTML side panel. Returns a toggle callback that the radar
 * can call to expand/scroll a blip by line number.
 */
function renderHtmlPanel(
  panel: HTMLElement,
  parsed: ParsedTechRadar,
  quadrant: ParsedTechRadar['quadrants'][number],
  qColor: string,
  palette: PaletteColors,
  isDark: boolean,
  rootContainer: HTMLElement,
  onClickItem?: (lineNumber: number) => void
): (lineNumber: number) => void {
  const ringOrder = parsed.rings.map((r) => r.name);
  const fillColor = shapeFill(palette, qColor, isDark, {
    solid: parsed.options['solid-fill'] === 'on',
  });
  let expandedLineNum: string | null = null;

  function render() {
    panel.innerHTML = '';

    for (const ringName of ringOrder) {
      const blips = quadrant.blips.filter((b) => b.ring === ringName);
      if (blips.length === 0) continue;

      // Ring group container
      const ringGroup = document.createElement('div');
      ringGroup.setAttribute('data-ring-group', ringName);
      ringGroup.style.cssText = `
        background: ${palette.surface};
        border-radius: 8px;
        padding: 10px;
        margin-bottom: 12px;
        transition: opacity 0.15s;
      `;

      // Ring header inside the group
      const header = document.createElement('div');
      header.style.cssText = `
        font-size: 13px; font-weight: 700; color: ${palette.textMuted};
        margin-bottom: 8px;
      `;
      header.textContent = ringName;
      ringGroup.appendChild(header);

      panel.appendChild(ringGroup);

      // Blip nodes (appended to ringGroup, not panel)
      for (const blip of blips) {
        const ln = String(blip.lineNumber);
        const isExpanded = expandedLineNum === ln;
        const hasDesc = blip.description.length > 0;

        const node = document.createElement('div');
        node.setAttribute('data-line-number', ln);
        node.setAttribute('data-ring', blip.ring);
        node.setAttribute('data-trend', blip.trend ?? 'stable');
        node.style.cssText = `
          background: ${fillColor}; border: 1.5px solid ${qColor};
          border-radius: 6px; margin-bottom: 6px; cursor: pointer;
          transition: border-width 0.1s;
          ${isExpanded ? 'border-width: 2px;' : ''}
        `;

        // Title row
        const titleRow = document.createElement('div');
        titleRow.style.cssText = `
          display: flex; align-items: center; gap: 8px;
          padding: 6px 10px; min-height: 28px;
        `;

        // Mini SVG blip indicator
        const indicatorSvg = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'svg'
        );
        indicatorSvg.setAttribute('width', '26');
        indicatorSvg.setAttribute('height', '26');
        indicatorSvg.style.flexShrink = '0';
        const indicatorG = d3Selection
          .select(indicatorSvg)
          .append('g') as d3Selection.Selection<
          SVGGElement,
          unknown,
          null,
          undefined
        >;
        renderTrendIndicator(
          indicatorG,
          blip.trend,
          qColor,
          13,
          13,
          10,
          -Math.PI / 2
        );
        d3Selection
          .select(indicatorSvg)
          .append('text')
          .attr('x', 13)
          .attr('y', 16)
          .attr('text-anchor', 'middle')
          .attr('fill', isDark ? '#000' : '#fff')
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', 9)
          .attr('font-weight', 'bold')
          .text(blip.globalNumber);
        titleRow.appendChild(indicatorSvg);

        // Name
        const name = document.createElement('span');
        name.textContent = blip.name;
        name.style.cssText = `
          flex: 1; font-size: 12px; font-weight: 600;
          color: ${palette.text}; white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis;
        `;
        titleRow.appendChild(name);

        node.appendChild(titleRow);

        // Description (expanded only)
        if (isExpanded && hasDesc) {
          const sep = document.createElement('div');
          sep.style.cssText = `
            border-top: 1px solid ${qColor}; opacity: 0.3;
          `;
          node.appendChild(sep);

          const descDiv = document.createElement('div');
          descDiv.style.cssText = `
            padding: 6px 10px 8px; font-size: 11px; line-height: 1.6;
            color: ${palette.textMuted};
          `;
          descDiv.innerHTML = renderDescriptionHtml(blip.description, palette);
          node.appendChild(descDiv);
        }

        // Hover: dim all other blips (radar + panel), scale up matching radar dot
        node.addEventListener('mouseenter', () => {
          dimExcept(rootContainer, ln);
          // Scale up matching radar dot
          rootContainer
            .querySelectorAll<SVGElement>('svg [data-line-number]')
            .forEach((el) => {
              if (el.getAttribute('data-line-number') === ln) {
                const bbox = (el as SVGGraphicsElement).getBBox?.();
                if (bbox) {
                  const bx = bbox.x + bbox.width / 2;
                  const by = bbox.y + bbox.height / 2;
                  el.setAttribute(
                    'transform',
                    `translate(${bx},${by}) scale(1.5) translate(${-bx},${-by})`
                  );
                }
              }
            });
        });
        node.addEventListener('mouseleave', () => {
          clearDim(rootContainer);
          rootContainer
            .querySelectorAll<SVGElement>('svg [data-line-number]')
            .forEach((el) => {
              el.removeAttribute('transform');
            });
        });

        // Click: accordion toggle + persistent dim
        node.addEventListener('click', (event) => {
          event.stopPropagation();
          if (hasDesc) {
            const wasExpanded = expandedLineNum === ln;
            expandedLineNum = wasExpanded ? null : ln;
            render();
            if (!wasExpanded) {
              // Dim others after re-render
              requestAnimationFrame(() => {
                dimExcept(rootContainer, ln);
                // Scale up matching radar dot
                rootContainer
                  .querySelectorAll<SVGElement>('svg [data-line-number]')
                  .forEach((el) => {
                    if (el.getAttribute('data-line-number') === ln) {
                      const bbox = (el as SVGGraphicsElement).getBBox?.();
                      if (bbox) {
                        const cbx = bbox.x + bbox.width / 2;
                        const cby = bbox.y + bbox.height / 2;
                        el.setAttribute(
                          'transform',
                          `translate(${cbx},${cby}) scale(1.5) translate(${-cbx},${-cby})`
                        );
                      }
                    }
                  });
              });
            } else {
              // Collapsed — clear all
              clearDim(rootContainer);
              rootContainer
                .querySelectorAll<SVGElement>('svg [data-line-number]')
                .forEach((el) => el.removeAttribute('transform'));
            }
          } else if (onClickItem) {
            onClickItem(blip.lineNumber);
          }
        });

        ringGroup.appendChild(node);
      }
    }
  }

  render();

  // Click on empty panel space → collapse and clear
  panel.addEventListener('click', () => {
    if (expandedLineNum) {
      expandedLineNum = null;
      render();
      clearDim(rootContainer);
      rootContainer
        .querySelectorAll<SVGElement>('svg [data-line-number]')
        .forEach((el) => el.removeAttribute('transform'));
    }
  });

  // Return a toggle function for external callers (radar blip clicks)
  return (lineNumber: number) => {
    const ln = String(lineNumber);
    const blip = quadrant.blips.find((b) => String(b.lineNumber) === ln);
    if (blip && blip.description.length > 0) {
      const wasExpanded = expandedLineNum === ln;
      expandedLineNum = wasExpanded ? null : ln;
      render();
      const node = panel.querySelector(`[data-line-number="${ln}"]`);
      if (node) node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (!wasExpanded) {
        requestAnimationFrame(() => dimExcept(rootContainer, ln));
      } else {
        clearDim(rootContainer);
        rootContainer
          .querySelectorAll<SVGElement>('svg [data-line-number]')
          .forEach((el) => el.removeAttribute('transform'));
      }
    } else if (onClickItem) {
      onClickItem(lineNumber);
    }
  };
}

// ============================================================
// Description HTML Rendering (with markdown)
// ============================================================

function renderDescriptionHtml(
  lines: readonly string[],
  palette: PaletteColors
): string {
  // Join prose lines into paragraphs, keep bullets separate
  const paragraphs = joinParagraphs(lines);
  let html = '';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    const isBullet = /^[-*•]\s+/.test(trimmed);
    const content = isBullet ? trimmed.replace(/^[-*•]\s+/, '') : trimmed;
    const rendered = renderInlineMarkdownHtml(content, palette);

    if (isBullet) {
      html += `<div style="padding-left: 14px; text-indent: -10px; margin: 2px 0;">• ${rendered}</div>`;
    } else {
      html += `<div style="margin: 4px 0;">${rendered}</div>`;
    }
  }

  return html;
}

function joinParagraphs(lines: readonly string[]): string[] {
  const result: string[] = [];
  let currentPara = '';

  for (const line of lines) {
    const trimmed = line.trim();
    const isBullet = /^[-*•]\s+/.test(trimmed);

    if (isBullet) {
      if (currentPara) {
        result.push(currentPara);
        currentPara = '';
      }
      result.push(trimmed);
    } else if (!trimmed) {
      if (currentPara) {
        result.push(currentPara);
        currentPara = '';
      }
    } else {
      currentPara = currentPara ? `${currentPara} ${trimmed}` : trimmed;
    }
  }

  if (currentPara) result.push(currentPara);
  return result;
}

function renderInlineMarkdownHtml(
  text: string,
  palette: PaletteColors
): string {
  const spans = parseInlineMarkdown(text);
  let html = '';
  for (const span of spans) {
    let t = escapeHtml(span.text);
    if (span.bold) t = `<strong>${t}</strong>`;
    if (span.italic) t = `<em>${t}</em>`;
    if (span.code)
      t = `<code style="background:${palette.surface}; padding: 1px 4px; border-radius: 3px; font-size: 10px;">${t}</code>`;
    if (span.href) {
      const safe = safeHref(span.href);
      if (safe !== null) {
        t = `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer" style="color: ${palette.primary ?? palette.text}; text-decoration: underline;">${t}</a>`;
      }
      // else: drop the anchor, leave text as plain content.
    }
    html += t;
  }
  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// Static Quadrant Export Renderer (all descriptions expanded, no interactivity)
// ============================================================

export function renderQuadrantFocusForExport(
  container: HTMLDivElement,
  parsed: ParsedTechRadar,
  quadrantPosition: QuadrantPosition,
  palette: PaletteColors,
  isDark: boolean,
  exportDims: { width: number; height: number }
): void {
  const quadrant = parsed.quadrants.find(
    (q) => q.position === quadrantPosition
  );
  if (!quadrant) return;

  container.innerHTML = '';

  const width = exportDims.width;
  const height = exportDims.height;
  const qColor = resolveQuadrantColor(
    quadrant.position,
    quadrant.color,
    palette
  );

  // ── Title bar ──
  const titleBar = document.createElement('div');
  titleBar.style.cssText = `
    display: flex; align-items: baseline; gap: 8px;
    padding: 12px 16px; font-family: ${FONT_FAMILY};
    font-size: ${TITLE_FONT_SIZE + 2}px; background: ${palette.bg};
  `;

  const titleText = document.createElement('span');
  titleText.textContent = parsed.title || 'Tech Radar';
  titleText.style.cssText = `font-weight: bold; color: ${palette.text};`;

  const sep = document.createElement('span');
  sep.textContent = '›';
  sep.style.color = palette.border;

  const quadrantLabel = document.createElement('span');
  quadrantLabel.textContent = quadrant.name;
  quadrantLabel.style.cssText = `font-weight: bold; color: ${qColor};`;

  titleBar.appendChild(titleText);
  titleBar.appendChild(sep);
  titleBar.appendChild(quadrantLabel);
  container.appendChild(titleBar);

  // ── Main layout: SVG radar (left) + HTML panel (right) ──
  const mainLayout = document.createElement('div');
  mainLayout.style.cssText = `
    display: flex; flex-direction: row;
    height: ${height - 48}px; background: ${palette.bg};
  `;
  container.appendChild(mainLayout);

  // SVG container for quarter-circle (left 45%)
  const svgContainer = document.createElement('div');
  svgContainer.style.cssText = `width: 45%; min-width: 200px; flex-shrink: 0;`;
  mainLayout.appendChild(svgContainer);

  // HTML panel for blip listing (right 55%)
  const panel = document.createElement('div');
  panel.style.cssText = `
    flex: 1; padding: 8px 16px;
    font-family: ${FONT_FAMILY}; background: ${palette.bg};
  `;
  mainLayout.appendChild(panel);

  // ── Render static HTML panel (all descriptions expanded) ──
  renderStaticHtmlPanel(panel, parsed, quadrant, qColor, palette, isDark);

  // ── Render quarter-circle SVG ──
  const svgWidth = width * 0.45;
  const svgHeight = height - 48;

  const svg = d3Selection
    .select(svgContainer)
    .append('svg')
    .attr('width', svgWidth)
    .attr('height', svgHeight)
    .attr('viewBox', `0 0 ${svgWidth} ${svgHeight}`)
    .style('background', palette.bg);

  renderQuarterCircleStatic(
    svg,
    parsed,
    quadrant,
    qColor,
    palette,
    isDark,
    svgWidth,
    svgHeight,
    palette.border
  );
}

/**
 * Render the quarter-circle SVG without any interactivity.
 */
function renderQuarterCircleStatic(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  parsed: ParsedTechRadar,
  quadrant: ParsedTechRadar['quadrants'][number],
  qColor: string,
  palette: PaletteColors,
  isDark: boolean,
  width: number,
  height: number,
  mutedColor: string
): void {
  const padding = 8;
  const size = Math.min(width - padding, height - padding);
  const maxRadius = size * 0.95;
  const ringCount = parsed.rings.length;
  const ringBandWidth = maxRadius / ringCount;

  const { startAngle, endAngle } = getQuadrantArc(quadrant.position);
  let cx: number, cy: number;

  switch (quadrant.position) {
    case 'top-right':
      cx = padding;
      cy = size + padding;
      break;
    case 'top-left':
      cx = width - padding;
      cy = size + padding;
      break;
    case 'bottom-left':
      cx = width - padding;
      cy = padding;
      break;
    case 'bottom-right':
      cx = padding;
      cy = padding;
      break;
  }

  // Ring arcs with zebra shading
  const arcGen = (innerR: number, outerR: number) =>
    `M${cx + outerR * Math.cos(startAngle)},${cy - outerR * Math.sin(startAngle)} A${outerR},${outerR} 0 0,0 ${cx + outerR * Math.cos(endAngle)},${cy - outerR * Math.sin(endAngle)} L${cx + innerR * Math.cos(endAngle)},${cy - innerR * Math.sin(endAngle)} A${innerR},${innerR} 0 0,1 ${cx + innerR * Math.cos(startAngle)},${cy - innerR * Math.sin(startAngle)} Z`;

  for (let ri = parsed.rings.length - 1; ri >= 0; ri--) {
    const innerR = ri * ringBandWidth;
    const outerR = (ri + 1) * ringBandWidth;
    const fillColor =
      ri % 2 === 0 ? palette.bg : mix(palette.bg, palette.border, 0.15);

    svg
      .append('path')
      .attr('d', arcGen(innerR, outerR))
      .attr('fill', fillColor)
      .attr('stroke', mutedColor)
      .attr('stroke-width', 0.5);
  }

  // Ring labels along the arc edge
  for (let ri = 0; ri < parsed.rings.length; ri++) {
    const rCenter = (ri + 0.5) * ringBandWidth;
    const midAngle = (startAngle + endAngle) / 2;
    const labelX = cx + rCenter * Math.cos(midAngle);
    const labelY = cy - rCenter * Math.sin(midAngle);

    svg
      .append('text')
      .attr('x', labelX)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', palette.textMuted)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', 11)
      .attr('font-weight', '600')
      .attr('opacity', 0.5)
      // In-bounds by loop guard (ri < parsed.rings.length).
      .text(parsed.rings[ri]!.name);
  }

  // Blip dots
  const ringOrder = parsed.rings.map((r) => r.name);
  const angularPadding = 0.08;
  const radialPadding = ringBandWidth * 0.12;
  const usableArcStart = startAngle + angularPadding;
  const usableArcEnd = endAngle - angularPadding;
  const arcSpan = usableArcEnd - usableArcStart;

  const blipsByRing = new Map<string, TechRadarBlip[]>();
  for (const blip of quadrant.blips) {
    const list = blipsByRing.get(blip.ring) ?? [];
    list.push(blip);
    blipsByRing.set(blip.ring, list);
  }

  for (const [ringName, blips] of blipsByRing) {
    const ringIndex = ringOrder.indexOf(ringName);
    if (ringIndex < 0) continue;
    const rInner = ringIndex * ringBandWidth + radialPadding;
    const rOuter = (ringIndex + 1) * ringBandWidth - radialPadding;
    const rMid = (rInner + rOuter) / 2;

    for (let bi = 0; bi < blips.length; bi++) {
      // In-bounds by loop guard (bi < blips.length).
      const blip = blips[bi]!;
      const angle =
        blips.length === 1
          ? (usableArcStart + usableArcEnd) / 2
          : usableArcStart + ((bi + 0.5) / blips.length) * arcSpan;

      const radius =
        blips.length <= 3
          ? rMid
          : rInner +
            BLIP_RADIUS +
            ((bi % 3) / 2) * (rOuter - rInner - BLIP_RADIUS * 2);

      const bx = cx + radius * Math.cos(angle);
      const by = cy - radius * Math.sin(angle);

      const blipGroup = svg.append('g');

      const angleToCenter = Math.atan2(cy - by, cx - bx);
      renderTrendIndicator(
        blipGroup,
        blip.trend,
        qColor,
        bx,
        by,
        BLIP_RADIUS,
        angleToCenter
      );

      blipGroup
        .append('text')
        .attr('x', bx)
        .attr('y', by + 3)
        .attr('text-anchor', 'middle')
        .attr('fill', isDark ? '#000' : '#fff')
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', BLIP_FONT_SIZE)
        .attr('font-weight', 'bold')
        .text(blip.globalNumber);
    }
  }
}

/**
 * Render static HTML panel with all descriptions expanded (for export).
 */
function renderStaticHtmlPanel(
  panel: HTMLElement,
  parsed: ParsedTechRadar,
  quadrant: ParsedTechRadar['quadrants'][number],
  qColor: string,
  palette: PaletteColors,
  isDark: boolean
): void {
  const ringOrder = parsed.rings.map((r) => r.name);
  const fillColor = shapeFill(palette, qColor, isDark, {
    solid: parsed.options['solid-fill'] === 'on',
  });

  for (const ringName of ringOrder) {
    const blips = quadrant.blips.filter((b) => b.ring === ringName);
    if (blips.length === 0) continue;

    // Ring group container
    const ringGroup = document.createElement('div');
    ringGroup.style.cssText = `
      background: ${palette.surface};
      border-radius: 8px;
      padding: 10px;
      margin-bottom: 12px;
    `;

    // Ring header
    const header = document.createElement('div');
    header.style.cssText = `
      font-size: 13px; font-weight: 700; color: ${palette.textMuted};
      margin-bottom: 8px;
    `;
    header.textContent = ringName;
    ringGroup.appendChild(header);

    panel.appendChild(ringGroup);

    for (const blip of blips) {
      const hasDesc = blip.description.length > 0;

      const node = document.createElement('div');
      node.style.cssText = `
        background: ${fillColor}; border: 1.5px solid ${qColor};
        border-radius: 6px; margin-bottom: 6px;
      `;

      // Title row
      const titleRow = document.createElement('div');
      titleRow.style.cssText = `
        display: flex; align-items: center; gap: 8px;
        padding: 6px 10px; min-height: 28px;
      `;

      // Mini SVG blip indicator
      const indicatorSvg = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'svg'
      );
      indicatorSvg.setAttribute('width', '26');
      indicatorSvg.setAttribute('height', '26');
      indicatorSvg.style.flexShrink = '0';
      const indicatorG = d3Selection
        .select(indicatorSvg)
        .append('g') as d3Selection.Selection<
        SVGGElement,
        unknown,
        null,
        undefined
      >;
      renderTrendIndicator(
        indicatorG,
        blip.trend,
        qColor,
        13,
        13,
        10,
        -Math.PI / 2
      );
      d3Selection
        .select(indicatorSvg)
        .append('text')
        .attr('x', 13)
        .attr('y', 16)
        .attr('text-anchor', 'middle')
        .attr('fill', isDark ? '#000' : '#fff')
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', 9)
        .attr('font-weight', 'bold')
        .text(blip.globalNumber);
      titleRow.appendChild(indicatorSvg);

      // Name
      const name = document.createElement('span');
      name.textContent = blip.name;
      name.style.cssText = `
        flex: 1; font-size: 12px; font-weight: 600;
        color: ${palette.text};
      `;
      titleRow.appendChild(name);

      node.appendChild(titleRow);

      // Description (always expanded for export)
      if (hasDesc) {
        const sepDiv = document.createElement('div');
        sepDiv.style.cssText = `border-top: 1px solid ${qColor}; opacity: 0.3;`;
        node.appendChild(sepDiv);

        const descDiv = document.createElement('div');
        descDiv.style.cssText = `
          padding: 6px 10px 8px; font-size: 11px; line-height: 1.6;
          color: ${palette.textMuted};
        `;
        descDiv.innerHTML = renderDescriptionHtml(blip.description, palette);
        node.appendChild(descDiv);
      }

      ringGroup.appendChild(node);
    }
  }
}

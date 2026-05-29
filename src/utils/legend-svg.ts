// ============================================================
// Shared legend SVG string generator
// Produces SVG <g> elements matching the standard legend style
// used across all diagram types (capsule pills with colored dots).
//
// Both renderLegendSvg() (string, used by ECharts + static export) and
// renderLegendD3() (DOM, used by every structured diagram) now drive off
// the SAME layout engine — `computeLegendLayout` — so the ECharts legend
// wraps long entry lists onto multiple rows exactly like the D3 diagrams.
// This file is the SSR/string view of that layout; legend-d3.ts is the
// interactive DOM view. Text is positioned with explicit baseline math
// (not dominant-baseline) so resvg renders it correctly in PNG export.
// ============================================================

import type {
  LegendConfig,
  LegendState,
  LegendPalette,
  LegendCapsuleLayout,
  LegendPillLayout,
} from './legend-types';
import {
  LEGEND_HEIGHT,
  LEGEND_PILL_FONT_SIZE,
  LEGEND_DOT_R,
  LEGEND_ENTRY_FONT_SIZE,
} from './legend-constants';
import { computeLegendLayout } from './legend-layout';
import { mix } from '../palettes/color-utils';
import { FONT_FAMILY } from '../fonts';

// ── Types ────────────────────────────────────────────────────

export interface LegendGroupData {
  readonly name: string;
  readonly entries: ReadonlyArray<{
    readonly value: string;
    readonly color: string;
  }>;
}

interface LegendRenderOptions {
  palette: { bg: string; surface: string; text: string; textMuted: string };
  isDark: boolean;
  /**
   * Width to wrap entries against (entries flow onto new rows past this).
   * Pass 0 when the caller CSS-centers a natural-width legend; a generous
   * fallback budget is used so a single row still fits on one line.
   */
  containerWidth: number;
  activeGroup?: string | null;
  className?: string;
}

interface LegendRenderResult {
  svg: string;
  height: number;
  /** Natural content width (px). Callers can use this for CSS-based centering. */
  width: number;
}

// ── Helpers ──────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Active capsule (group pill + wrapped colored-dot entries) → SVG string. */
function emitCapsule(
  capsule: LegendCapsuleLayout,
  palette: LegendRenderOptions['palette'],
  groupBg: string,
  pillBorder: string
): string {
  const inner: string[] = [];
  const pill = capsule.pill;

  // Outer capsule background (grows to the wrapped entry rows' height)
  inner.push(
    `<rect width="${capsule.width}" height="${capsule.height}" rx="${LEGEND_HEIGHT / 2}" fill="${esc(groupBg)}"/>`
  );

  // Inner pill background + border
  inner.push(
    `<rect x="${pill.x}" y="${pill.y}" width="${pill.width}" height="${pill.height}" rx="${pill.height / 2}" fill="${esc(palette.bg)}"/>`,
    `<rect x="${pill.x}" y="${pill.y}" width="${pill.width}" height="${pill.height}" rx="${pill.height / 2}" fill="none" stroke="${esc(pillBorder)}" stroke-width="0.75"/>`
  );

  // Pill text — vertically centered in the first row.
  inner.push(
    `<text x="${pill.x + pill.width / 2}" y="${LEGEND_HEIGHT / 2 + LEGEND_PILL_FONT_SIZE / 2 - 2}" font-size="${LEGEND_PILL_FONT_SIZE}" font-weight="500" fill="${esc(palette.text)}" text-anchor="middle" font-family="${esc(FONT_FAMILY)}">${esc(capsule.groupName)}</text>`
  );

  // Wrapped entries — dots + labels positioned by the layout engine.
  for (const entry of capsule.entries) {
    const label = entry.displayValue ?? entry.value;
    inner.push(
      `<g data-legend-entry="${esc(entry.value.toLowerCase())}" data-series-name="${esc(entry.value)}" style="cursor:pointer">` +
        `<circle cx="${entry.dotCx}" cy="${entry.dotCy}" r="${LEGEND_DOT_R}" fill="${esc(entry.color)}"/>` +
        `<text x="${entry.textX}" y="${entry.dotCy + LEGEND_ENTRY_FONT_SIZE / 2 - 1}" font-size="${LEGEND_ENTRY_FONT_SIZE}" fill="${esc(palette.textMuted)}" font-family="${esc(FONT_FAMILY)}">${esc(label)}</text>` +
        `</g>`
    );
  }

  return `<g transform="translate(${capsule.x},${capsule.y})" data-legend-group="${esc(capsule.groupName.toLowerCase())}" style="cursor:pointer">${inner.join('')}</g>`;
}

/** Collapsed group pill (no active group) → SVG string. */
function emitPill(
  pill: LegendPillLayout,
  palette: LegendRenderOptions['palette'],
  groupBg: string
): string {
  return (
    `<g transform="translate(${pill.x},${pill.y})" data-legend-group="${esc(pill.groupName.toLowerCase())}" style="cursor:pointer">` +
    `<rect width="${pill.width}" height="${pill.height}" rx="${pill.height / 2}" fill="${esc(groupBg)}"/>` +
    `<text x="${pill.width / 2}" y="${pill.height / 2 + LEGEND_PILL_FONT_SIZE / 2 - 2}" font-size="${LEGEND_PILL_FONT_SIZE}" font-weight="500" fill="${esc(palette.textMuted)}" text-anchor="middle" font-family="${esc(FONT_FAMILY)}">${esc(pill.groupName)}</text>` +
    `</g>`
  );
}

// ── Main renderer ────────────────────────────────────────────

export function renderLegendSvg(
  groups: readonly LegendGroupData[],
  options: LegendRenderOptions
): LegendRenderResult {
  if (groups.length === 0) return { svg: '', height: 0, width: 0 };

  const { palette, isDark, containerWidth, activeGroup, className } = options;

  // The layout engine wraps entries against the available width. Callers that
  // CSS-center the legend pass containerWidth: 0 — fall back to a generous
  // budget so a single row still fits rather than wrapping one-per-line.
  const wrapWidth = containerWidth > 0 ? containerWidth : 1200;

  const config: LegendConfig = {
    groups,
    position: { placement: 'top-center', titleRelation: 'below-title' },
    mode: 'preview',
  };
  const state: LegendState = { activeGroup: activeGroup ?? null };
  const layout = computeLegendLayout(config, state, wrapWidth);

  if (!layout.activeCapsule && layout.pills.length === 0) {
    return { svg: '', height: 0, width: 0 };
  }

  const groupBg = isDark
    ? mix(palette.surface, palette.bg, 50)
    : mix(palette.surface, palette.bg, 30);
  const pillBorder = mix(palette.textMuted, palette.bg, 50);

  const parts: string[] = [];
  let bottom = 0;
  let left = Infinity;
  let right = 0;

  const track = (x: number, y: number, w: number, h: number): void => {
    left = Math.min(left, x);
    right = Math.max(right, x + w);
    bottom = Math.max(bottom, y + h);
  };

  if (layout.activeCapsule) {
    const c = layout.activeCapsule;
    parts.push(emitCapsule(c, palette, groupBg, pillBorder));
    track(c.x, c.y, c.width, c.height);
  }
  for (const pill of layout.pills) {
    parts.push(emitPill(pill, palette, groupBg));
    track(pill.x, pill.y, pill.width, pill.height);
  }

  const classAttr = className ? ` class="${esc(className)}"` : '';
  const activeAttr = activeGroup
    ? ` data-legend-active="${esc(activeGroup.toLowerCase())}"`
    : '';
  const svg = `<g${classAttr}${activeAttr}>${parts.join('')}</g>`;

  return {
    svg,
    height: bottom,
    width: right - (left === Infinity ? 0 : left),
  };
}

// ── Config-based API ────────────────────────────────────────

export function renderLegendSvgFromConfig(
  config: LegendConfig,
  state: LegendState,
  palette: LegendPalette & { isDark: boolean },
  containerWidth: number
): LegendRenderResult {
  // Delegate to existing renderer with adapted parameters
  return renderLegendSvg(config.groups, {
    palette: {
      bg: palette.bg,
      surface: palette.surface,
      text: palette.text,
      textMuted: palette.textMuted,
    },
    isDark: palette.isDark,
    containerWidth,
    activeGroup: state.activeGroup,
  });
}

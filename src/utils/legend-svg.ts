// ============================================================
// Shared legend SVG string generator
// Produces SVG <g> elements matching the standard legend style
// used across all diagram types (capsule pills with colored dots).
// ============================================================

import {
  LEGEND_HEIGHT,
  LEGEND_PILL_PAD,
  LEGEND_PILL_FONT_SIZE,
  LEGEND_CAPSULE_PAD,
  LEGEND_DOT_R,
  LEGEND_ENTRY_FONT_SIZE,
  LEGEND_ENTRY_DOT_GAP,
  LEGEND_ENTRY_TRAIL,
  LEGEND_GROUP_GAP,
  measureLegendText,
} from './legend-constants';
import { mix } from '../palettes/color-utils';
import { FONT_FAMILY } from '../fonts';

// ── Types ────────────────────────────────────────────────────

export interface LegendGroupData {
  name: string;
  entries: Array<{ value: string; color: string }>;
}

export interface LegendRenderOptions {
  palette: { bg: string; surface: string; text: string; textMuted: string };
  isDark: boolean;
  containerWidth: number;
  activeGroup?: string | null;
  className?: string;
}

export interface LegendRenderResult {
  svg: string;
  height: number;
}

// ── Helpers ──────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pillWidth(name: string): number {
  return measureLegendText(name, LEGEND_PILL_FONT_SIZE) + LEGEND_PILL_PAD;
}

function entriesWidth(entries: Array<{ value: string }>): number {
  let w = 0;
  for (const e of entries) {
    w += LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP + measureLegendText(e.value, LEGEND_ENTRY_FONT_SIZE) + LEGEND_ENTRY_TRAIL;
  }
  return w;
}

function groupTotalWidth(name: string, entries: Array<{ value: string }>, isActive: boolean): number {
  const pw = pillWidth(name);
  if (!isActive) return pw;
  return LEGEND_CAPSULE_PAD * 2 + pw + 4 + entriesWidth(entries);
}

// ── Main renderer ────────────────────────────────────────────

export function renderLegendSvg(
  groups: LegendGroupData[],
  options: LegendRenderOptions,
): LegendRenderResult {
  if (groups.length === 0) return { svg: '', height: 0 };

  const { palette, isDark, containerWidth, activeGroup, className } = options;
  const groupBg = isDark
    ? mix(palette.surface, palette.bg, 50)
    : mix(palette.surface, palette.bg, 30);

  // Pre-compute layout
  const items = groups
    .filter((g) => g.entries.length > 0)
    .map((g) => {
      const isActive = !!activeGroup && g.name.toLowerCase() === activeGroup.toLowerCase();
      const pw = pillWidth(g.name);
      const tw = groupTotalWidth(g.name, g.entries, isActive);
      return { group: g, isActive, pillWidth: pw, totalWidth: tw };
    });

  if (items.length === 0) return { svg: '', height: 0 };

  const totalWidth = items.reduce((s, it) => s + it.totalWidth, 0) + (items.length - 1) * LEGEND_GROUP_GAP;
  let x = Math.max(0, (containerWidth - totalWidth) / 2);

  const parts: string[] = [];
  const pillH = LEGEND_HEIGHT - LEGEND_CAPSULE_PAD * 2;

  for (const item of items) {
    const groupKey = item.group.name.toLowerCase();
    const inner: string[] = [];

    // Outer capsule (active only)
    if (item.isActive) {
      inner.push(
        `<rect width="${item.totalWidth}" height="${LEGEND_HEIGHT}" rx="${LEGEND_HEIGHT / 2}" fill="${esc(groupBg)}"/>`,
      );
    }

    const pillXOff = item.isActive ? LEGEND_CAPSULE_PAD : 0;
    const pillYOff = item.isActive ? LEGEND_CAPSULE_PAD : 0;
    const h = item.isActive ? pillH : LEGEND_HEIGHT;

    // Pill background
    inner.push(
      `<rect x="${pillXOff}" y="${pillYOff}" width="${item.pillWidth}" height="${h}" rx="${h / 2}" fill="${esc(item.isActive ? palette.bg : groupBg)}"/>`,
    );

    // Active pill border
    if (item.isActive) {
      inner.push(
        `<rect x="${pillXOff}" y="${pillYOff}" width="${item.pillWidth}" height="${h}" rx="${h / 2}" fill="none" stroke="${esc(mix(palette.textMuted, palette.bg, 50))}" stroke-width="0.75"/>`,
      );
    }

    // Pill text
    inner.push(
      `<text x="${pillXOff + item.pillWidth / 2}" y="${LEGEND_HEIGHT / 2 + LEGEND_PILL_FONT_SIZE / 2 - 2}" font-size="${LEGEND_PILL_FONT_SIZE}" font-weight="500" fill="${esc(item.isActive ? palette.text : palette.textMuted)}" text-anchor="middle" font-family="${esc(FONT_FAMILY)}">${esc(item.group.name)}</text>`,
    );

    // Entry dots + labels (active only)
    if (item.isActive) {
      let entryX = pillXOff + item.pillWidth + 4;
      for (const entry of item.group.entries) {
        const textX = entryX + LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP;
        inner.push(
          `<g data-legend-entry="${esc(entry.value.toLowerCase())}" data-series-name="${esc(entry.value)}" style="cursor:pointer">` +
          `<circle cx="${entryX + LEGEND_DOT_R}" cy="${LEGEND_HEIGHT / 2}" r="${LEGEND_DOT_R}" fill="${esc(entry.color)}"/>` +
          `<text x="${textX}" y="${LEGEND_HEIGHT / 2 + LEGEND_ENTRY_FONT_SIZE / 2 - 1}" font-size="${LEGEND_ENTRY_FONT_SIZE}" fill="${esc(palette.textMuted)}" font-family="${esc(FONT_FAMILY)}">${esc(entry.value)}</text>` +
          `</g>`,
        );
        entryX = textX + measureLegendText(entry.value, LEGEND_ENTRY_FONT_SIZE) + LEGEND_ENTRY_TRAIL;
      }
    }

    parts.push(
      `<g transform="translate(${x},0)" data-legend-group="${esc(groupKey)}" style="cursor:pointer">${inner.join('')}</g>`,
    );

    x += item.totalWidth + LEGEND_GROUP_GAP;
  }

  const classAttr = className ? ` class="${esc(className)}"` : '';
  const activeAttr = activeGroup ? ` data-legend-active="${esc(activeGroup.toLowerCase())}"` : '';
  const svg = `<g${classAttr}${activeAttr}>${parts.join('')}</g>`;

  return { svg, height: LEGEND_HEIGHT };
}

import type { PaletteColors } from './types';
import { mute, tint, shade, contrastText } from './color-utils';

// ============================================================
// Mermaid Theme Variable Generator
// ============================================================

/**
 * Generates ~121 Mermaid theme variables from palette tokens.
 * Replaces the hardcoded lightThemeVars/darkThemeVars objects.
 *
 * Dark mode fills use `mute()` to derive desaturated variants
 * that are readable with light text.
 */
export function buildMermaidThemeVars(
  colors: PaletteColors,
  isDark: boolean
): Record<string, string> {
  const c = colors.colors;

  // Ordered accent array for pie/cScale/fillType/actor slots
  const accentOrder = [
    c.blue,
    c.red,
    c.green,
    c.yellow,
    c.purple,
    c.orange,
    c.teal,
    c.cyan,
    colors.secondary,
  ];

  // Dark mode fills use muted variants for readability
  const fills = isDark ? accentOrder.map(mute) : accentOrder;

  return {
    // ── Backgrounds ──
    background: isDark ? colors.overlay : colors.border,
    mainBkg: colors.surface,

    // ── Primary/Secondary/Tertiary nodes ──
    primaryColor: isDark ? colors.primary : colors.surface,
    primaryTextColor: colors.text,
    primaryBorderColor: isDark ? colors.secondary : colors.border,
    secondaryColor: colors.secondary,
    secondaryTextColor: contrastText(colors.secondary, colors.text, colors.bg),
    secondaryBorderColor: colors.primary,
    tertiaryColor: colors.accent,
    tertiaryTextColor: contrastText(colors.accent, colors.text, colors.bg),
    tertiaryBorderColor: colors.border,

    // ── Lines & text ──
    lineColor: colors.textMuted,
    textColor: colors.text,

    // ── Clusters ──
    clusterBkg: colors.bg,
    clusterBorder: isDark ? colors.border : colors.textMuted,
    titleColor: colors.text,

    // ── Labels ──
    edgeLabelBackground: 'transparent',

    // ── Notes (sequence diagrams) ──
    noteBkgColor: colors.bg,
    noteTextColor: colors.text,
    noteBorderColor: isDark ? colors.border : colors.textMuted,

    // ── Actors (sequence diagrams) ──
    actorBkg: colors.surface,
    actorTextColor: colors.text,
    actorBorder: isDark ? colors.border : colors.textMuted,
    actorLineColor: colors.textMuted,

    // ── Signals (sequence diagrams) ──
    signalColor: colors.textMuted,
    signalTextColor: colors.text,

    // ── Labels ──
    labelColor: colors.text,
    labelTextColor: colors.text,
    labelBoxBkgColor: colors.surface,
    labelBoxBorderColor: isDark ? colors.border : colors.textMuted,

    // ── Loop boxes ──
    loopTextColor: colors.text,

    // ── Activation (sequence diagrams) ──
    activationBkgColor: isDark ? colors.overlay : colors.border,
    activationBorderColor: isDark ? colors.border : colors.textMuted,

    // ── Sequence numbers ──
    sequenceNumberColor: isDark ? colors.text : colors.bg,

    // ── State diagrams ──
    labelBackgroundColor: colors.surface,

    // ── Pie chart (9 slices) ──
    // Dark mode: use muted fills so light pieSectionTextColor stays readable
    ...Object.fromEntries(
      (isDark ? fills : accentOrder).map((col, i) => [`pie${i + 1}`, col])
    ),
    pieTitleTextColor: colors.text,
    pieSectionTextColor: isDark ? colors.text : colors.bg,
    pieLegendTextColor: colors.text,
    pieStrokeColor: 'transparent',
    pieOuterStrokeWidth: '0px',
    pieOuterStrokeColor: 'transparent',

    // ── cScale (9 tiers) — muted in dark mode ──
    ...Object.fromEntries(fills.map((f, i) => [`cScale${i}`, f])),
    ...Object.fromEntries(
      fills.map((_, i) => [
        `cScaleLabel${i}`,
        isDark ? colors.text : i < 2 || i > 6 ? colors.bg : colors.text,
      ])
    ),

    // ── fillType (8 slots) ──
    ...Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [
        `fillType${i}`,
        fills[i % fills.length],
      ])
    ),

    // ── Journey actors (6 slots) ──
    ...Object.fromEntries(
      [c.red, c.green, c.yellow, c.purple, c.orange, c.teal].map((color, i) => [
        `actor${i}`,
        color,
      ])
    ),

    // ── Flowchart ──
    nodeBorder: isDark ? colors.border : colors.textMuted,
    nodeTextColor: colors.text,

    // ── Gantt ──
    gridColor: isDark ? colors.textMuted : colors.border,
    doneTaskBkgColor: c.green,
    doneTaskBorderColor: isDark ? colors.border : colors.textMuted,
    activeTaskBkgColor: colors.secondary,
    activeTaskBorderColor: colors.primary,
    critBkgColor: c.orange,
    critBorderColor: c.red,
    taskBkgColor: colors.surface,
    taskBorderColor: isDark ? colors.border : colors.textMuted,
    taskTextColor: contrastText(colors.surface, colors.text, colors.bg),
    taskTextDarkColor: colors.bg,
    taskTextLightColor: colors.text,
    taskTextOutsideColor: colors.text,
    doneTaskTextColor: contrastText(c.green, colors.text, colors.bg),
    activeTaskTextColor: contrastText(colors.secondary, colors.text, colors.bg),
    critTaskTextColor: contrastText(c.orange, colors.text, colors.bg),
    sectionBkgColor: isDark
      ? shade(colors.primary, colors.bg, 0.6)
      : tint(colors.primary, 0.6),
    altSectionBkgColor: colors.bg,
    sectionBkgColor2: isDark
      ? shade(colors.primary, colors.bg, 0.6)
      : tint(colors.primary, 0.6),
    todayLineColor: c.yellow,

    // ── Quadrant ──
    quadrant1Fill: isDark
      ? shade(c.green, colors.bg, 0.75)
      : tint(c.green, 0.75),
    quadrant2Fill: isDark ? shade(c.blue, colors.bg, 0.75) : tint(c.blue, 0.75),
    quadrant3Fill: isDark ? shade(c.red, colors.bg, 0.75) : tint(c.red, 0.75),
    quadrant4Fill: isDark
      ? shade(c.yellow, colors.bg, 0.75)
      : tint(c.yellow, 0.75),
    quadrant1TextFill: colors.text,
    quadrant2TextFill: colors.text,
    quadrant3TextFill: colors.text,
    quadrant4TextFill: colors.text,
    quadrantPointFill: isDark ? c.cyan : c.blue,
    quadrantPointTextFill: colors.text,
    quadrantXAxisTextFill: colors.text,
    quadrantYAxisTextFill: colors.text,
    quadrantTitleFill: colors.text,
    quadrantInternalBorderStrokeFill: colors.border,
    quadrantExternalBorderStrokeFill: colors.border,
  };
}

// ============================================================
// Mermaid Theme CSS Generator
// ============================================================

/**
 * Generates custom CSS overrides for Mermaid SVGs.
 * Handles git graph label backgrounds and dark-mode text readability.
 */
export function buildThemeCSS(palette: PaletteColors, isDark: boolean): string {
  const base = `
  .branchLabelBkg { fill: transparent !important; stroke: transparent !important; }
  .commit-label-bkg { fill: transparent !important; stroke: transparent !important; }
  .tag-label-bkg { fill: transparent !important; stroke: transparent !important; }

  /* GitGraph: ensure commit and branch label text matches palette */
  .commit-label { fill: ${palette.text} !important; }
  .branch-label { fill: ${palette.text} !important; }
  .tag-label { fill: ${palette.text} !important; }
`;

  if (!isDark) return base;

  return (
    base +
    `
  /* Flowchart: ensure node and edge label text is readable */
  .nodeLabel, .label { color: ${palette.text} !important; fill: ${palette.text} !important; }
  .edgeLabel { color: ${palette.text} !important; fill: ${palette.text} !important; }
  .edgeLabel .label { color: ${palette.text} !important; fill: ${palette.text} !important; }
`
  );
}

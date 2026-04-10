// ============================================================
// Shared legend rendering constants
// All renderers import from here to stay in sync.
// ============================================================

export const LEGEND_HEIGHT = 28;
export const LEGEND_PILL_PAD = 16;
export const LEGEND_PILL_FONT_SIZE = 11;
export const LEGEND_CAPSULE_PAD = 4;
export const LEGEND_DOT_R = 4;
export const LEGEND_ENTRY_FONT_SIZE = 10;
export const LEGEND_ENTRY_DOT_GAP = 4;
export const LEGEND_ENTRY_TRAIL = 8;
export const LEGEND_GROUP_GAP = 12;
export const LEGEND_EYE_SIZE = 14;
export const LEGEND_EYE_GAP = 6;
export const LEGEND_ICON_W = 20;

// ── Spacing constants (centralized legend system) ───────────
export const LEGEND_TOP_PAD = 12;
export const LEGEND_TITLE_GAP = 8;
export const LEGEND_CONTENT_GAP = 12;
export const LEGEND_MAX_ENTRY_ROWS = 3;

// ── Proportional text measurement ────────────────────────────
// Helvetica character width ratios (fraction of fontSize).
// Replaces the naive `chars * 0.6 * fontSize` estimate with
// per-character proportional widths for accurate legend sizing.
// prettier-ignore
const CHAR_W: Record<string, number> = {
  ' ':.28,'!': .28,'"': .36,'#': .56,'$': .56,'%': .89,'&': .67,"'":.19,
  '(':.33,')':.33,'*': .39,'+':.58,',':.28,'-':.33,'.':.28,'/':.28,
  '0':.56,'1':.56,'2':.56,'3':.56,'4':.56,'5':.56,'6':.56,'7':.56,'8':.56,'9':.56,
  ':':.28,';':.28,'<':.58,'=':.58,'>':.58,'?':.56,'@':1.02,
  A:.67,B:.67,C:.72,D:.72,E:.67,F:.61,G:.78,H:.72,I:.28,J:.50,K:.67,L:.56,M:.83,
  N:.72,O:.78,P:.67,Q:.78,R:.72,S:.67,T:.61,U:.72,V:.67,W:.94,X:.67,Y:.67,Z:.61,
  a:.56,b:.56,c:.50,d:.56,e:.56,f:.28,g:.56,h:.56,i:.22,j:.22,k:.50,l:.22,m:.83,
  n:.56,o:.56,p:.56,q:.56,r:.33,s:.50,t:.28,u:.56,v:.50,w:.72,x:.50,y:.50,z:.50,
};
const DEFAULT_W = 0.56;

/** Estimate rendered text width using Helvetica proportional character widths. */
export function measureLegendText(text: string, fontSize: number): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    w += (CHAR_W[text[i]] ?? DEFAULT_W) * fontSize;
  }
  return w;
}

// Eye icon SVG paths (14×14 viewBox)
// Present only in org and sitemap legends (metadata visibility toggle)
export const EYE_OPEN_PATH =
  'M1 7s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z M7 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z';
export const EYE_CLOSED_PATH =
  'M2.5 2.5l9 9 M1.5 7s2.2-4 5.5-4c1.2 0 2.2.5 3 1.1 M12.5 7s-2.2 4-5.5 4c-1.2 0-2.2-.5-3-1.1';

// ── Controls group constants ────────────────────────────────
// Gear/cog icon (14×14 viewBox) — 6 flat teeth with center hole
// Computed from polar coordinates: outerR=5.5, innerR=3.5, holeR=2, center=(7,7)
// Uses evenodd fill-rule for the center hole
export const CONTROLS_ICON_PATH =
  'M5.6 1.7L8.4 1.7L7.9 3.6L9.5 4.5L10.9 3.1L12.3 5.6L10.4 6.1L10.4 7.9L12.3 8.4L10.9 10.9L9.5 9.5L7.9 10.4L8.4 12.3L5.6 12.3L6.1 10.4L4.5 9.5L3.1 10.9L1.7 8.4L3.6 7.9L3.6 6.1L1.7 5.6L3.1 3.1L4.5 4.5L6.1 3.6Z' +
  'M5 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0Z';
export const LEGEND_TOGGLE_DOT_R = LEGEND_DOT_R;
export const LEGEND_TOGGLE_OFF_OPACITY = 0.4;
export const LEGEND_GEAR_PILL_W = 14 + LEGEND_PILL_PAD; // gear icon (14) + padding

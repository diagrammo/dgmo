// ============================================================
// Router
// ============================================================

export {
  parseDgmoChartType,
  getDgmoFramework,
  DGMO_CHART_TYPE_MAP,
} from './dgmo-router';
export type { DgmoFramework } from './dgmo-router';

// ============================================================
// Parsers
// ============================================================

export { parseChart } from './chart';
export type {
  ParsedChart,
  ChartType,
  ChartDataPoint,
} from './chart';

export { parseEChart } from './echarts';
export type { ParsedEChart, EChartsChartType } from './echarts';

export {
  parseD3,
  orderArcNodes,
  parseTimelineDate,
  addDurationToDate,
  computeTimeTicks,
  formatDateLabel,
} from './d3';
export type { ParsedD3, D3ChartType, D3ExportDimensions, ArcLink, ArcNodeGroup } from './d3';

export {
  parseSequenceDgmo,
  looksLikeSequence,
  isSequenceBlock,
} from './sequence/parser';
export type {
  ParsedSequenceDgmo,
  SequenceParticipant,
  SequenceMessage,
  SequenceBlock,
  ElseIfBranch,
  SequenceSection,
  SequenceElement,
  SequenceGroup,
  ParticipantType,
} from './sequence/parser';

export {
  inferParticipantType,
  RULE_COUNT,
} from './sequence/participant-inference';

export { parseQuadrant } from './dgmo-mermaid';
export type { ParsedQuadrant } from './dgmo-mermaid';

// ============================================================
// Config Builders (produce framework-specific config objects)
// ============================================================

export { buildEChartsOption, buildEChartsOptionFromChart, renderEChartsForExport } from './echarts';
export { buildMermaidQuadrant } from './dgmo-mermaid';

// ============================================================
// Renderers (produce SVG output)
// ============================================================

export {
  renderSlopeChart,
  renderArcDiagram,
  renderTimeline,
  renderWordCloud,
  renderVenn,
  renderQuadrant,
  renderD3ForExport,
} from './d3';

export {
  renderSequenceDiagram,
  buildRenderSequence,
  computeActivations,
  applyPositionOverrides,
  applyGroupOrdering,
  groupMessagesBySection,
} from './sequence/renderer';
export type {
  RenderStep,
  Activation,
  SectionMessageGroup,
  SequenceRenderOptions,
} from './sequence/renderer';

// ============================================================
// Colors & Palettes
// ============================================================

export { resolveColor, colorNames, nord, seriesColors } from './colors';

export {
  // Registry
  getPalette,
  getAvailablePalettes,
  registerPalette,
  isValidHex,
  // Utilities
  hexToHSL,
  hslToHex,
  hexToHSLString,
  mute,
  tint,
  shade,
  getSeriesColors,
  contrastText,
  // Palette definitions
  nordPalette,
  solarizedPalette,
  catppuccinPalette,
  rosePinePalette,
  gruvboxPalette,
  tokyoNightPalette,
  oneDarkPalette,
  boldPalette,
  // Mermaid bridge
  buildMermaidThemeVars,
  buildThemeCSS,
} from './palettes';

export type { PaletteConfig, PaletteColors } from './palettes';

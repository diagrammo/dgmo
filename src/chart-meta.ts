// ============================================================
// Chart metadata + light helpers — the LIGHT public subpath
// (`@diagrammo/dgmo/chart-meta`).
// ============================================================
//
// Everything here re-exports from parser/data modules only — no renderers,
// no d3, no dagre. Eager app surfaces (status bar, deep links, share URL
// building, docs context, window title) import from THIS entry so the
// startup graph never pulls the full `/advanced` render pipeline.
//
// Rule: only re-export symbols whose defining module (and its transitive
// imports) is renderer-free. Anything that drags a render pipeline stays
// on `/advanced`.

// ── Chart-type registry (data only) ──────────────────────────
export { chartTypes } from './chart-types';
export type { ChartTypeMeta, ChartTypeId } from './chart-types';

// ── First-line parsing + chart-type detection ────────────────
export { parseFirstLine, ALL_CHART_TYPES } from './utils/parsing';
// From './chart-type-detect', NOT './dgmo-router'. Same function, and the
// router still re-exports it for everyone else — but the router materialises
// the parser table at module scope, so importing it from there made this
// "light" entry cost 1.1 MB (#638).
export { parseDgmoChartType } from './chart-type-detect';

// ── Sharing (URL encoding/decoding, lz-string only) ──────────
export {
  encodeDiagramUrl,
  decodeDiagramUrl,
  encodeViewState,
  decodeViewState,
} from './sharing';
export type {
  EncodeDiagramUrlOptions,
  EncodeDiagramUrlResult,
  CompactViewState,
  DecodedDiagramUrl,
} from './sharing';

// ── Share-time source normalization + import resolution ──────
export { normalizePertSourceForShare } from './pert/share-normalize';
export { parseOrg } from './org/parser';
export type { ParsedOrg, OrgNode } from './org/parser';
export { resolveOrgImports } from './org/resolver';
export { parseRaci } from './raci/parser';

// ── Palette registry (color data + utils, renderer-free) ─────
export { getPalette, getAvailablePalettes, hexToHSLString } from './palettes';
export type { PaletteColors } from './palettes';

// ============================================================
// SWOT Diagnostic Catalog
// ============================================================
//
// Every coded diagnostic the SWOT parser emits. The parser reaches these
// through `emit(SWOT_DX.<KEY>, line, params)`, so catalog consumers can list
// them without re-typing the wording. Every message builder tolerates `{}`.

import type { DiagnosticSpec } from '../diagnostics';

export const SWOT_DX = {
  UNKNOWN_SECTION: {
    code: 'E_SWOT_UNKNOWN_SECTION',
    severity: 'error',
    chartType: 'swot',
    title: 'Unknown section',
    message: (p) =>
      `Unknown section '${(p.word as string) ?? 'word'}'. Did you mean '${(p.nearest as string) ?? 'strengths'}'?`,
    hint: 'A line at indent 0 opens one of: strengths, weaknesses, opportunities, threats. There are no brackets.',
    example: `swot\n\n[Strengths]\n  Loyal crew`,
  },
  DUPLICATE_SECTION: {
    code: 'E_SWOT_DUPLICATE_SECTION',
    severity: 'error',
    chartType: 'swot',
    title: 'Duplicate section',
    message: (p) =>
      `Section '${(p.section as string) ?? 'strengths'}' appears more than once.`,
    hint: 'Merge the items under one section line.',
    example: `swot\n\nstrengths\n  Loyal crew\nstrengths\n  Fast ship`,
  },
  EMPTY_SECTION: {
    code: 'W_SWOT_EMPTY_SECTION',
    severity: 'warning',
    chartType: 'swot',
    title: 'Empty section',
    message: (p) =>
      `Section '${(p.section as string) ?? 'threats'}' has no items, so its panel says "None listed".`,
    hint: 'Indent at least one item under the section line.',
    example: `swot\n\nstrengths\n  Loyal crew\nweaknesses\n  Old sails\nopportunities\n  New trade route`,
  },
  ORPHAN_ITEM: {
    code: 'E_SWOT_ORPHAN_ITEM',
    severity: 'error',
    chartType: 'swot',
    title: 'Item before a section',
    message: (p) =>
      `Item '${(p.item as string) ?? 'item'}' comes before any section.`,
    hint: 'Put a section line above it: strengths, weaknesses, opportunities or threats.',
    example: `swot\n\n  Loyal crew\nstrengths\n  Fast ship`,
  },
  TOO_DEEP: {
    code: 'E_SWOT_TOO_DEEP',
    severity: 'error',
    chartType: 'swot',
    title: 'Nested too deep',
    message: (p) =>
      `'${(p.item as string) ?? 'line'}' is nested too deep. An item takes one detail level.`,
    hint: 'Move the line up to the detail level, or make it an item of its own.',
    example: `swot\n\nstrengths\n  Loyal crew\n    Sworn in\n      At Tortuga`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const SWOT_DIAGNOSTICS: DiagnosticSpec[] = Object.values(SWOT_DX);

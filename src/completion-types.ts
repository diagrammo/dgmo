// ============================================================
// Completion / symbol-extraction shared types
// ============================================================
//
// Lives in its own leaf module so chart-type parsers (Class, ER,
// Flowchart, Infra, Pert) can `import type { DiagramSymbols }` here
// without depending on completion.ts — which itself imports those
// parsers' extractSymbols() functions, producing a cycle hub.
//
// Keep this file dependency-free.

// ChartType is just a string — alias for documentation clarity.
export type ChartType = string;

export interface DiagramSymbols {
  kind: ChartType;
  entities: string[]; // table names, node IDs, class names, etc.
  /**
   * Map of alias-literal → canonical entity name, collected from
   * `Name as <alias>` declarations in the document. Editor surfaces
   * both forms in autocomplete; selecting an alias inserts the alias
   * literal (the alias is input convenience, not a display name).
   */
  aliases?: Record<string, string>;
}

export type ExtractFn = (docText: string) => DiagramSymbols;

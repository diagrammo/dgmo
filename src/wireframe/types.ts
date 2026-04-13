// ============================================================
// Wireframe Diagram Types
// ============================================================

import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';

/**
 * All wireframe element types.
 * Visual-mnemonic elements are inferred from bracket syntax;
 * keyword elements use a small vocabulary (9 keywords).
 */
export type WireframeElementType =
  | 'group'
  | 'textInput'
  | 'button'
  | 'dropdown'
  | 'checkbox'
  | 'radio'
  | 'heading'
  | 'divider'
  | 'text'
  | 'listItem'
  | 'nav'
  | 'tabs'
  | 'table'
  | 'image'
  | 'modal'
  | 'skeleton'
  | 'alert'
  | 'progress'
  | 'chart';

/**
 * Single flat interface for all wireframe elements (ADR-8).
 * No separate WireframeGroup — all elements carry group fields
 * with sensible defaults (isContainer=false, orientation='vertical', isSkeleton=false).
 */
export interface WireframeElement {
  id: string;
  type: WireframeElementType;
  /** Display label / placeholder text / heading text */
  label: string;
  /** Child elements (non-empty only when isContainer=true) */
  children: WireframeElement[];
  /** Pipe metadata key-value pairs */
  metadata: Record<string, string>;
  /** State keywords: disabled, active, ghost, destructive, etc. */
  states: string[];
  /** Free-text annotations from pipe metadata */
  annotations: string[];
  /** 1-based line number in source */
  lineNumber: number;
  /** Measured indentation (column) */
  indent: number;
  /** True when element has children (set during parse via indent stack) */
  isContainer: boolean;
  /** Stacking direction for group children */
  orientation: 'vertical' | 'horizontal';
  /** True when inside a skeleton block */
  isSkeleton: boolean;

  // ── Type-specific fields ─────────────────────────────────
  /** Heading level: 1 for `#`, 2 for `##` */
  headingLevel?: number;
  /** Dropdown options (for type='dropdown') */
  options?: string[];
  /** Checked state (for type='checkbox') */
  checked?: boolean;
  /** Selected state (for type='radio') */
  selected?: boolean;
  /** Image hint: 'default' | 'round' | 'wide' */
  imageHint?: 'default' | 'round' | 'wide';
  /** Progress value 0-100 (for type='progress') */
  progressValue?: number;
  /** Chart hint: 'line' | 'bar' | 'pie' */
  chartHint?: 'line' | 'bar' | 'pie';
  /** Table dimensions for skeleton shorthand (for type='table') */
  tableRows?: number;
  tableCols?: number;
  /** Table header row labels (for type='table') */
  tableHeaders?: string[];
  /** Table data rows — each row is an array of cell content strings (for type='table') */
  tableData?: string[][];
  /** Inline elements on the same line (multi-element line) */
  inlineElements?: WireframeElement[];
  /** Label element for label-field pairing */
  labelFor?: WireframeElement;
  /** Color from tag system */
  color?: string;
  /** Field variant: password, textarea */
  fieldVariant?: 'password' | 'textarea';
}

/** Form factor / layout mode */
export type WireframeFormFactor = 'desktop' | 'mobile';

export interface ParsedWireframe {
  title: string | null;
  titleLineNumber: number | null;
  formFactor: WireframeFormFactor;
  /** Top-level elements (roots of the hierarchy) */
  roots: WireframeElement[];
  /** Modal elements (rendered separately below main) */
  modals: WireframeElement[];
  tagGroups: TagGroup[];
  options: Record<string, string>;
  diagnostics: DgmoError[];
  error: string | null;
}

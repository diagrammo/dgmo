// ============================================================
// Wireframe Diagram Types
// ============================================================

import type { DgmoError } from '../diagnostics';

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
  readonly id: string;
  readonly type: WireframeElementType;
  /** Display label / placeholder text / heading text */
  readonly label: string;
  /** Child elements (non-empty only when isContainer=true) */
  readonly children: readonly WireframeElement[];
  /** Pipe metadata key-value pairs */
  readonly metadata: Readonly<Record<string, string>>;
  /** State keywords: disabled, active, ghost, destructive, etc. */
  readonly states: readonly string[];
  /** Free-text annotations from pipe metadata */
  readonly annotations: readonly string[];
  /** 1-based line number in source */
  readonly lineNumber: number;
  /** Measured indentation (column) */
  readonly indent: number;
  /** True when element has children (set during parse via indent stack) */
  readonly isContainer: boolean;
  /** Stacking direction for group children */
  readonly orientation: 'vertical' | 'horizontal';
  /** True when inside a skeleton block */
  readonly isSkeleton: boolean;

  // ── Type-specific fields ─────────────────────────────────
  /** Heading level: 1 for `#`, 2 for `##` */
  readonly headingLevel?: number;
  /** Dropdown options (for type='dropdown') */
  readonly options?: readonly string[];
  /** Checked state (for type='checkbox') */
  readonly checked?: boolean;
  /** Selected state (for type='radio') */
  readonly selected?: boolean;
  /** Image hint: 'default' | 'round' | 'wide' */
  readonly imageHint?: 'default' | 'round' | 'wide';
  /** Progress value 0-100 (for type='progress') */
  readonly progressValue?: number;
  /** Chart hint: 'line' | 'bar' | 'pie' */
  readonly chartHint?: 'line' | 'bar' | 'pie';
  /** Table dimensions for skeleton shorthand (for type='table') */
  readonly tableRows?: number;
  readonly tableCols?: number;
  /** Table header row labels (for type='table') */
  readonly tableHeaders?: readonly string[];
  /** Table data rows — each row is an array of cell content strings (for type='table') */
  readonly tableData?: ReadonlyArray<readonly string[]>;
  /** Inline elements on the same line (multi-element line) */
  readonly inlineElements?: readonly WireframeElement[];
  /** Label element for label-field pairing */
  readonly labelFor?: WireframeElement;
  /** Color from tag system */
  readonly color?: string;
  /** Field variant: password, textarea */
  readonly fieldVariant?: 'password' | 'textarea';
}

/** Form factor / layout mode */
export type WireframeFormFactor = 'desktop' | 'mobile';

export interface ParsedWireframe {
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  readonly formFactor: WireframeFormFactor;
  /** Top-level elements (roots of the hierarchy) */
  readonly roots: readonly WireframeElement[];
  /** Modal elements (rendered separately below main) */
  readonly modals: readonly WireframeElement[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}

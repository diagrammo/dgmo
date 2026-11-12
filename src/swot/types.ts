import type { DgmoError } from '../diagnostics';
import type { ChartFrame } from '../utils/chart-frame-parse';
import type { TagGroup } from '../utils/tag-groups';

export type SwotSectionKey =
  | 'strengths'
  | 'weaknesses'
  | 'opportunities'
  | 'threats';

export interface SwotItem {
  readonly id: string;
  readonly title: string;
  readonly tags: Readonly<Record<string, string>>; // tag group key → value
  readonly details: readonly string[]; // the one nesting level under an item
  readonly lineNumber: number;
  readonly endLineNumber: number;
}

export interface SwotSection {
  readonly key: SwotSectionKey;
  readonly label: string;
  readonly color: string;
  readonly items: readonly SwotItem[];
  /** 0 when the source never wrote this section; its panel is still drawn. */
  readonly lineNumber: number;
}

export interface ParsedSwot {
  readonly type: 'swot';
  /** `subtitle`, `source`, `footnote`, `byline` (#1827). */
  readonly frame?: ChartFrame;
  readonly title?: string;
  readonly titleLineNumber?: number;
  /** Always all four, in S W O T order, whatever the source order. */
  readonly sections: readonly SwotSection[];
  readonly tagGroups: readonly TagGroup[];
  readonly options: Readonly<Record<string, string>>;
  readonly xLabels: readonly [string, string];
  readonly yLabels: readonly [string, string];
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}

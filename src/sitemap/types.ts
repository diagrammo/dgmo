// ============================================================
// Sitemap Diagram Types
// ============================================================

import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';

export interface SitemapNode {
  readonly id: string;
  readonly label: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly children: readonly SitemapNode[];
  readonly parentId: string | null;
  readonly description?: readonly string[];
  /** True for [Group Name] container nodes */
  readonly isContainer: boolean;
  readonly lineNumber: number;
  readonly color?: string;
}

export interface SitemapEdge {
  readonly sourceId: string;
  readonly targetId: string;
  readonly label?: string;
  readonly lineNumber: number;
}

export type SitemapDirection = 'TB' | 'LR';

export interface ParsedSitemap {
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  readonly direction: SitemapDirection;
  /** Top-level nodes (roots of the hierarchy) */
  readonly roots: readonly SitemapNode[];
  /** All cross-link edges */
  readonly edges: readonly SitemapEdge[];
  readonly tagGroups: readonly TagGroup[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}

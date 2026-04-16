// ============================================================
// Sitemap Diagram Types
// ============================================================

import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';

export interface SitemapNode {
  id: string;
  label: string;
  metadata: Record<string, string>;
  children: SitemapNode[];
  parentId: string | null;
  description?: string[];
  /** True for [Group Name] container nodes */
  isContainer: boolean;
  lineNumber: number;
  color?: string;
}

export interface SitemapEdge {
  sourceId: string;
  targetId: string;
  label?: string;
  color?: string;
  lineNumber: number;
}

export type SitemapDirection = 'TB' | 'LR';

export interface ParsedSitemap {
  title: string | null;
  titleLineNumber: number | null;
  direction: SitemapDirection;
  /** Top-level nodes (roots of the hierarchy) */
  roots: SitemapNode[];
  /** All cross-link edges */
  edges: SitemapEdge[];
  tagGroups: TagGroup[];
  options: Record<string, string>;
  diagnostics: DgmoError[];
  error: string | null;
}

import type { DgmoError } from '../diagnostics';
import { makeDgmoError } from '../diagnostics';

// ============================================================
// Types
// ============================================================

/**
 * Async or sync file reader. Receives an absolute path, returns content.
 * Throwing means "file not found".
 */
export type ReadFileFn = (path: string) => string | Promise<string>;

export interface ResolveImportsResult {
  content: string;
  diagnostics: DgmoError[];
}

// ============================================================
// Constants
// ============================================================

const MAX_DEPTH = 10;
const IMPORT_RE = /^(\s+)import:\s+(.+\.dgmo)\s*$/i;
const TAGS_RE = /^tags:\s+(.+\.dgmo)\s*$/i;
const HEADER_RE = /^(chart|title)\s*:/i;
const OPTION_RE = /^[a-z][a-z0-9-]*\s*:/i;
const GROUP_HEADING_RE = /^##\s+/;

// ============================================================
// Path Helpers (pure string ops — no Node `path` dependency)
// ============================================================

function dirname(filePath: string): string {
  const last = filePath.lastIndexOf('/');
  return last > 0 ? filePath.substring(0, last) : '/';
}

function resolvePath(base: string, relative: string): string {
  const parts = dirname(base).split('/');
  for (const seg of relative.split('/')) {
    if (seg === '..') {
      if (parts.length > 1) parts.pop();
    } else if (seg !== '.' && seg !== '') {
      parts.push(seg);
    }
  }
  return parts.join('/') || '/';
}

// ============================================================
// Tag Group Extraction
// ============================================================

interface TagGroupBlock {
  name: string; // lowercased for comparison
  lines: string[]; // raw lines including heading + entries
}

/**
 * Extract ## tag group blocks from content lines.
 * Returns blocks in order, each with its heading + indented entries.
 */
function extractTagGroups(lines: string[]): TagGroupBlock[] {
  const blocks: TagGroupBlock[] = [];
  let current: TagGroupBlock | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (GROUP_HEADING_RE.test(trimmed)) {
      // Extract group name (everything after "## " up to optional alias/color)
      const nameMatch = trimmed.match(/^##\s+(.+?)(?:\s+alias\s+\w+)?(?:\s*\([^)]+\))?\s*$/);
      const name = nameMatch ? nameMatch[1].trim().toLowerCase() : trimmed.substring(3).trim().toLowerCase();
      current = { name, lines: [line] };
      blocks.push(current);
    } else if (current) {
      if (trimmed === '' || trimmed.startsWith('//')) {
        // Blank line or comment ends the tag group
        current = null;
      } else if (line.match(/^\s+/)) {
        // Indented = tag entry
        current.lines.push(line);
      } else {
        // Non-indented non-heading = end of tag group
        current = null;
      }
    }
  }

  return blocks;
}

// ============================================================
// Header Stripping
// ============================================================

interface ParsedHeader {
  /** Lines that are NOT header/tags/tag-groups — the "content" body */
  contentLines: string[];
  tagGroups: TagGroupBlock[];
  tagsDirective: string | null;
}

/**
 * Separate an imported file into header (stripped) and content body.
 * Also extracts tag groups and tags: directive for merging.
 */
function parseFileHeader(lines: string[]): ParsedHeader {
  const tagGroups = extractTagGroups(lines);
  const tagGroupLineSet = new Set<number>();
  for (const group of tagGroups) {
    // Find where this group starts in lines
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === group.lines[0]) {
        for (let j = 0; j < group.lines.length; j++) {
          tagGroupLineSet.add(i + j);
        }
        break;
      }
    }
  }

  let tagsDirective: string | null = null;
  const contentLines: string[] = [];
  let headerDone = false;

  for (let i = 0; i < lines.length; i++) {
    // Skip tag group lines
    if (tagGroupLineSet.has(i)) continue;

    const trimmed = lines[i].trim();

    // Skip blank/comment lines in header region
    if (!headerDone && (trimmed === '' || trimmed.startsWith('//'))) continue;

    // Header lines
    if (!headerDone) {
      if (HEADER_RE.test(trimmed)) continue;

      const tagsMatch = trimmed.match(TAGS_RE);
      if (tagsMatch) {
        tagsDirective = tagsMatch[1].trim();
        continue;
      }

      // Other option-like header lines (non-indented key: value)
      if (OPTION_RE.test(trimmed) && !trimmed.startsWith('##') && !lines[i].match(/^\s/)) {
        // Check it's not a content line (node with metadata)
        const key = trimmed.split(':')[0].trim().toLowerCase();
        if (key !== 'chart' && key !== 'title' && !trimmed.includes('|')) {
          continue;
        }
      }

      headerDone = true;
    }

    contentLines.push(lines[i]);
  }

  return { contentLines, tagGroups, tagsDirective };
}

// ============================================================
// Main Resolver
// ============================================================

/**
 * Pre-processes org chart content, resolving `tags:` and `import:` directives.
 *
 * @param content   - Raw .dgmo file content
 * @param filePath  - Absolute path of the file (for relative path resolution)
 * @param readFileFn - Function to read files (sync or async)
 * @returns Merged content with all imports resolved + diagnostics
 */
export async function resolveOrgImports(
  content: string,
  filePath: string,
  readFileFn: ReadFileFn,
): Promise<ResolveImportsResult> {
  const diagnostics: DgmoError[] = [];
  const result = await resolveFile(content, filePath, readFileFn, diagnostics, new Set([filePath]), 0);
  return { content: result, diagnostics };
}

async function resolveFile(
  content: string,
  filePath: string,
  readFileFn: ReadFileFn,
  diagnostics: DgmoError[],
  ancestorChain: Set<string>,
  depth: number,
): Promise<string> {
  const lines = content.split('\n');

  // ---- Step 1: Identify header, tags directive, inline tag groups ----
  const headerLines: string[] = [];
  let tagsDirective: string | null = null;
  const inlineTagGroups = extractTagGroups(lines);
  const bodyStartIndex = findBodyStart(lines);

  // Collect header lines (chart:, title:, options, tags:)
  for (let i = 0; i < bodyStartIndex; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('//')) {
      headerLines.push(lines[i]);
      continue;
    }
    if (GROUP_HEADING_RE.test(trimmed)) continue; // skip inline tag group headings
    if (lines[i] !== trimmed) continue; // skip tag group entries (indented lines)

    const tagsMatch = trimmed.match(TAGS_RE);
    if (tagsMatch) {
      tagsDirective = tagsMatch[1].trim();
      continue;
    }

    headerLines.push(lines[i]);
  }

  // ---- Step 2: Resolve tags: directive ----
  let tagsFileGroups: TagGroupBlock[] = [];
  if (tagsDirective) {
    const tagsPath = resolvePath(filePath, tagsDirective);
    try {
      const tagsContent = await readFileFn(tagsPath);
      const tagsLines = tagsContent.split('\n');
      tagsFileGroups = extractTagGroups(tagsLines);
    } catch {
      diagnostics.push(
        makeDgmoError(0, `Tags file not found: ${tagsDirective}`)
      );
    }
  }

  // ---- Step 3: Resolve import: directives in body ----
  const bodyLines = lines.slice(bodyStartIndex);
  const resolvedBodyLines: string[] = [];
  const importedTagGroups: TagGroupBlock[] = [];

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    const lineNumber = bodyStartIndex + i + 1; // 1-based for diagnostics
    const importMatch = line.match(IMPORT_RE);

    if (!importMatch) {
      // Pass through — skip inline tag group lines (already extracted above)
      const trimmed = line.trim();
      if (GROUP_HEADING_RE.test(trimmed) || (inlineTagGroups.length > 0 && isTagGroupEntry(line, bodyLines, i))) {
        continue;
      }
      resolvedBodyLines.push(line);
      continue;
    }

    const indent = importMatch[1];
    const importRelPath = importMatch[2].trim();
    const importAbsPath = resolvePath(filePath, importRelPath);

    // Depth check
    if (depth >= MAX_DEPTH) {
      diagnostics.push(
        makeDgmoError(lineNumber, `Import depth limit exceeded (${MAX_DEPTH}): ${importRelPath}`)
      );
      continue;
    }

    // Circular check
    if (ancestorChain.has(importAbsPath)) {
      const chain = [...ancestorChain, importAbsPath].map(p => p.split('/').pop()).join(' -> ');
      diagnostics.push(
        makeDgmoError(lineNumber, `Circular import detected: ${chain}`)
      );
      continue;
    }

    // Read imported file
    let importedContent: string;
    try {
      importedContent = await readFileFn(importAbsPath);
    } catch {
      diagnostics.push(
        makeDgmoError(lineNumber, `Import file not found: ${importRelPath}`)
      );
      continue;
    }

    // Recurse to resolve nested imports
    const nestedChain = new Set(ancestorChain);
    nestedChain.add(importAbsPath);
    const resolved = await resolveFile(
      importedContent,
      importAbsPath,
      readFileFn,
      diagnostics,
      nestedChain,
      depth + 1,
    );

    // Strip header, extract tag groups from resolved content
    const resolvedLines = resolved.split('\n');
    const parsed = parseFileHeader(resolvedLines);

    // Collect tag groups from imported file (lowest priority)
    for (const group of parsed.tagGroups) {
      importedTagGroups.push(group);
    }

    // Re-indent and insert content lines
    const importedContentLines = parsed.contentLines.filter(
      (l) => l.trim() !== ''  // skip trailing blank lines
    );

    // Trim trailing empty lines but keep internal structure
    let lastNonEmpty = importedContentLines.length - 1;
    while (lastNonEmpty >= 0 && importedContentLines[lastNonEmpty].trim() === '') {
      lastNonEmpty--;
    }
    const trimmedImported = importedContentLines.slice(0, lastNonEmpty + 1);

    for (const importedLine of trimmedImported) {
      if (importedLine.trim() === '') {
        resolvedBodyLines.push('');
      } else {
        resolvedBodyLines.push(indent + importedLine);
      }
    }
  }

  // ---- Step 4: Merge tag groups with precedence ----
  // Priority: inline > tags file > imported files
  const mergedGroups = mergeTagGroups(inlineTagGroups, tagsFileGroups, importedTagGroups);

  // ---- Step 5: Rebuild output ----
  const outputLines: string[] = [];

  // Header lines (chart:, title:, options — no tags: or tag groups)
  for (const line of headerLines) {
    outputLines.push(line);
  }

  // Merged tag groups
  if (mergedGroups.length > 0) {
    // Ensure blank line before tag groups if header has content
    if (outputLines.length > 0 && outputLines[outputLines.length - 1].trim() !== '') {
      outputLines.push('');
    }
    for (const group of mergedGroups) {
      for (const line of group.lines) {
        outputLines.push(line);
      }
      outputLines.push(''); // blank line between groups
    }
  }

  // Body content
  // Ensure blank line separator
  if (resolvedBodyLines.length > 0 && outputLines.length > 0 && outputLines[outputLines.length - 1].trim() !== '') {
    outputLines.push('');
  }
  for (const line of resolvedBodyLines) {
    outputLines.push(line);
  }

  return outputLines.join('\n');
}

// ============================================================
// Helpers
// ============================================================

/**
 * Find the index where the body (non-header, non-tag-group content) starts.
 */
function findBodyStart(lines: string[]): number {
  let inTagGroup = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (trimmed === '' || trimmed.startsWith('//')) {
      if (inTagGroup) inTagGroup = false;
      continue;
    }

    // Tag group heading
    if (GROUP_HEADING_RE.test(trimmed)) {
      inTagGroup = true;
      continue;
    }

    // Tag group entry (indented under heading)
    if (inTagGroup && lines[i].match(/^\s+/)) {
      continue;
    }

    if (inTagGroup) {
      inTagGroup = false;
    }

    // Header directives
    if (HEADER_RE.test(trimmed)) continue;
    if (TAGS_RE.test(trimmed)) continue;

    // Option-like lines (non-indented key: value before content)
    if (OPTION_RE.test(trimmed) && !lines[i].match(/^\s/) && !trimmed.includes('|')) {
      const key = trimmed.split(':')[0].trim().toLowerCase();
      if (key !== 'chart' && key !== 'title') {
        continue;
      }
    }

    // This is the first body line
    return i;
  }

  return lines.length;
}

/**
 * Check if a line is a tag group entry (indented line under a ## heading).
 */
function isTagGroupEntry(line: string, allLines: string[], index: number): boolean {
  if (!line.match(/^\s+/)) return false;
  // Walk backwards to find the nearest non-blank, non-comment, non-entry line
  for (let i = index - 1; i >= 0; i--) {
    const prev = allLines[i].trim();
    if (prev === '' || prev.startsWith('//')) continue;
    if (GROUP_HEADING_RE.test(prev)) return true;
    if (allLines[i].match(/^\s+/)) continue; // another entry
    return false;
  }
  return false;
}

/**
 * Merge tag groups from three sources with priority:
 * inline (highest) > tags file > imported files (lowest).
 *
 * On name conflict (case-insensitive), higher priority wins.
 * New groups from lower priority are added.
 */
function mergeTagGroups(
  inline: TagGroupBlock[],
  tagsFile: TagGroupBlock[],
  imported: TagGroupBlock[],
): TagGroupBlock[] {
  const seen = new Map<string, TagGroupBlock>();

  // Inline first (highest priority)
  for (const group of inline) {
    seen.set(group.name, group);
  }

  // Tags file (medium priority — only add if not overridden)
  for (const group of tagsFile) {
    if (!seen.has(group.name)) {
      seen.set(group.name, group);
    }
  }

  // Imported files (lowest priority — only add if not present)
  for (const group of imported) {
    if (!seen.has(group.name)) {
      seen.set(group.name, group);
    }
  }

  return Array.from(seen.values());
}

import type { DgmoError } from '../diagnostics';
import { makeDgmoError } from '../diagnostics';
import { isTagBlockHeading, matchTagBlockHeading } from '../utils/tag-groups';

// ============================================================
// Types
// ============================================================

/**
 * Async or sync file reader. Receives an absolute path, returns content.
 * Throwing means "file not found".
 */
export type ReadFileFn = (path: string) => string | Promise<string>;

/** Tracks the original source file and line for an imported line. */
export interface ImportSource {
  /** Absolute path of the file this line originates from */
  filePath: string;
  /** 1-based line number in the original (pre-resolution) source file */
  sourceLine: number;
}

export interface ResolveImportsResult {
  content: string;
  diagnostics: DgmoError[];
  /** resolvedLine (1-based index) → originalLine (1-based) or null for inserted lines */
  lineMap: (number | null)[];
  /** resolvedLine (1-based index) → import source info or null for non-imported lines */
  importSourceMap: (ImportSource | null)[];
}

// ============================================================
// Constants
// ============================================================

const MAX_DEPTH = 10;
const IMPORT_RE = /^(\s+)import:?\s+(.+\.dgmo)\s*$/i;
const TAGS_RE = /^tags:?\s+(.+\.dgmo)\s*$/i;
/** Matches new-style first line: `org ...` or `kanban ...` or `title: ...` */
const HEADER_RE = /^(org|kanban|title\s*:)/i;
/**
 * Known option keys that can appear in org chart headers (space-separated).
 * Only these are stripped from imported files — avoids eating content like "Alice Chen".
 * MUST stay in sync with `KNOWN_OPTIONS` + `KNOWN_BOOLEANS` in `parser.ts`; otherwise
 * an unknown header keyword causes the resolver to misidentify body-start, which
 * pushes downstream `tags` / `import` directives into the body as garbage.
 */
const KNOWN_HEADER_OPTIONS = new Set([
  'direction-tb',
  'direction-lr',
  'sub-node-label',
  'hide',
  'show-sub-node-count',
  'color-off',
  'fill-tint',
  'fill-solid',
  'fill-outline',
  'active-tag',
]);

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
    const headingMatch = matchTagBlockHeading(trimmed);
    if (headingMatch) {
      const name = headingMatch.name.toLowerCase();
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
  /** For each contentLine, its 0-based index in the input lines[] array */
  contentLineIndices: number[];
  tagGroups: TagGroupBlock[];
  tagsDirective: string | null;
}

/**
 * Separate an imported file into header (stripped) and content body.
 * Also extracts tag groups and tags directive for merging.
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
  const contentLineIndices: number[] = [];
  let headerDone = false;

  for (let i = 0; i < lines.length; i++) {
    // Skip tag group lines
    if (tagGroupLineSet.has(i)) continue;

    // In-bounds by loop guard.
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();

    // Skip blank/comment lines in header region
    if (!headerDone && (trimmed === '' || trimmed.startsWith('//'))) continue;

    // Header lines
    if (!headerDone) {
      if (HEADER_RE.test(trimmed)) continue;

      const tagsMatch = trimmed.match(TAGS_RE);
      if (tagsMatch) {
        // Capture group 1 guaranteed by TAGS_RE match.
        tagsDirective = tagsMatch[1]!.trim();
        continue;
      }

      // Known option header lines (space-separated `key value` or bare boolean)
      if (
        !rawLine.match(/^\s/) &&
        !isTagBlockHeading(trimmed) &&
        !trimmed.includes('|')
      ) {
        // String.split always returns at least one element.
        const firstToken = trimmed.split(/\s/)[0]!.toLowerCase();
        if (KNOWN_HEADER_OPTIONS.has(firstToken)) {
          continue;
        }
      }

      headerDone = true;
    }

    contentLines.push(rawLine);
    contentLineIndices.push(i);
  }

  return { contentLines, contentLineIndices, tagGroups, tagsDirective };
}

// ============================================================
// Main Resolver
// ============================================================

/**
 * Pre-processes org chart content, resolving `tags` and `import` directives.
 *
 * @param content   - Raw .dgmo file content
 * @param filePath  - Absolute path of the file (for relative path resolution)
 * @param readFileFn - Function to read files (sync or async)
 * @returns Merged content with all imports resolved + diagnostics
 */
export async function resolveOrgImports(
  content: string,
  filePath: string,
  readFileFn: ReadFileFn
): Promise<ResolveImportsResult> {
  const diagnostics: DgmoError[] = [];
  const result = await resolveFile(
    content,
    filePath,
    readFileFn,
    diagnostics,
    new Set([filePath]),
    0
  );
  return {
    content: result.content,
    diagnostics,
    lineMap: result.lineMap,
    importSourceMap: result.importSourceMap,
  };
}

async function resolveFile(
  content: string,
  filePath: string,
  readFileFn: ReadFileFn,
  diagnostics: DgmoError[],
  ancestorChain: Set<string>,
  depth: number
): Promise<{
  content: string;
  lineMap: (number | null)[];
  importSourceMap: (ImportSource | null)[];
}> {
  const lines = content.split('\n');

  // ---- Step 1: Identify header, tags directive, inline tag groups ----
  const headerLines: { text: string; originalLine: number }[] = [];
  let tagsDirective: string | null = null;
  const inlineTagGroups = extractTagGroups(lines);
  const bodyStartIndex = findBodyStart(lines);

  // Collect header lines (chart:, title:, options, tags:)
  let tagsLineNumber = 0; // 1-based line number of the tags directive
  for (let i = 0; i < bodyStartIndex; i++) {
    // In-bounds: bodyStartIndex <= lines.length by construction.
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('//')) {
      headerLines.push({ text: rawLine, originalLine: i + 1 });
      continue;
    }
    if (isTagBlockHeading(trimmed)) continue; // skip inline tag group headings
    if (/^\s/.test(rawLine)) continue; // skip tag group entries (indented lines)

    const tagsMatch = trimmed.match(TAGS_RE);
    if (tagsMatch) {
      // Capture group 1 guaranteed by TAGS_RE match.
      tagsDirective = tagsMatch[1]!.trim();
      tagsLineNumber = i + 1; // 1-based
      continue;
    }

    headerLines.push({ text: rawLine, originalLine: i + 1 });
  }

  // ---- Step 2: Resolve tags directive ----
  let tagsFileGroups: TagGroupBlock[] = [];
  if (tagsDirective) {
    const tagsPath = resolvePath(filePath, tagsDirective);
    try {
      const tagsContent = await readFileFn(tagsPath);
      const tagsLines = tagsContent.split('\n');
      tagsFileGroups = extractTagGroups(tagsLines);
    } catch {
      diagnostics.push(
        makeDgmoError(tagsLineNumber, `Tags file not found: ${tagsDirective}`)
      );
    }
  }

  // ---- Step 3: Resolve import directives in body ----
  const bodyLines = lines.slice(bodyStartIndex);
  const resolvedBodyLines: {
    text: string;
    originalLine: number | null;
    importSource: ImportSource | null;
  }[] = [];
  const importedTagGroups: TagGroupBlock[] = [];

  for (let i = 0; i < bodyLines.length; i++) {
    // In-bounds by loop guard.
    const line = bodyLines[i]!;
    const lineNumber = bodyStartIndex + i + 1; // 1-based for diagnostics
    const importMatch = line.match(IMPORT_RE);

    if (!importMatch) {
      // Pass through — skip inline tag group lines (already extracted above)
      const trimmed = line.trim();
      if (
        isTagBlockHeading(trimmed) ||
        (inlineTagGroups.length > 0 && isTagGroupEntry(line, bodyLines, i))
      ) {
        continue;
      }
      resolvedBodyLines.push({
        text: line,
        originalLine: lineNumber,
        importSource: null,
      });
      continue;
    }

    // Capture groups 1 and 2 guaranteed by IMPORT_RE match.
    const indent = importMatch[1]!;
    const importRelPath = importMatch[2]!.trim();
    const importAbsPath = resolvePath(filePath, importRelPath);

    // Depth check
    if (depth >= MAX_DEPTH) {
      diagnostics.push(
        makeDgmoError(
          lineNumber,
          `Import depth limit exceeded (${MAX_DEPTH}): ${importRelPath}`
        )
      );
      continue;
    }

    // Circular check
    if (ancestorChain.has(importAbsPath)) {
      const chain = [...ancestorChain, importAbsPath]
        .map((p) => p.split('/').pop())
        .join(' -> ');
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
      depth + 1
    );

    // Strip header, extract tag groups from resolved content
    const resolvedLines = resolved.content.split('\n');
    const parsed = parseFileHeader(resolvedLines);

    // Collect tag groups from imported file (lowest priority)
    for (const group of parsed.tagGroups) {
      importedTagGroups.push(group);
    }

    // Re-indent and insert content lines, computing import source for each
    const importedContentLines: { text: string; index: number }[] = [];
    for (let j = 0; j < parsed.contentLines.length; j++) {
      // In-bounds by loop guard; contentLineIndices is parallel by construction.
      const cText = parsed.contentLines[j]!;
      const cIndex = parsed.contentLineIndices[j]!;
      if (cText.trim() !== '') {
        importedContentLines.push({
          text: cText,
          index: cIndex,
        });
      }
    }

    // Trim trailing empty lines but keep internal structure
    let lastNonEmpty = importedContentLines.length - 1;
    while (
      lastNonEmpty >= 0 &&
      importedContentLines[lastNonEmpty]!.text.trim() === ''
    ) {
      lastNonEmpty--;
    }
    const trimmedImported = importedContentLines.slice(0, lastNonEmpty + 1);

    for (const entry of trimmedImported) {
      // Compute import source: which file and line does this content originate from?
      // entry.index is the 0-based index in resolved.content.split('\n')
      const resolvedLineNum = entry.index + 1; // 1-based line in the resolved imported content

      // Check if this line itself came from a deeper import
      let importSource: ImportSource | null = null;
      if (resolved.importSourceMap[resolvedLineNum]) {
        // Nested import — use the deepest source
        importSource = resolved.importSourceMap[resolvedLineNum];
      } else {
        // Direct content from this imported file
        const origLine = resolved.lineMap[resolvedLineNum];
        if (origLine != null) {
          importSource = { filePath: importAbsPath, sourceLine: origLine };
        }
      }

      if (entry.text.trim() === '') {
        resolvedBodyLines.push({
          text: '',
          originalLine: lineNumber,
          importSource,
        });
      } else {
        resolvedBodyLines.push({
          text: indent + entry.text,
          originalLine: lineNumber,
          importSource,
        });
      }
    }
  }

  // ---- Step 4: Merge tag groups with precedence ----
  // Priority: inline > tags file > imported files
  const mergedGroups = mergeTagGroups(
    inlineTagGroups,
    tagsFileGroups,
    importedTagGroups
  );

  // ---- Step 5: Rebuild output ----
  const outputLines: string[] = [];
  // lineMap[i] maps resolved line i (1-based) to original line (1-based) or null
  // importSourceMap[i] maps resolved line i (1-based) to import source or null
  // Index 0 is unused padding so indices align with 1-based line numbers
  const lineMap: (number | null)[] = [null];
  const importSourceMap: (ImportSource | null)[] = [null];

  // Header lines (chart:, title:, options — no tags or tag groups)
  for (const entry of headerLines) {
    outputLines.push(entry.text);
    lineMap.push(entry.originalLine);
    importSourceMap.push(null);
  }

  // Merged tag groups
  if (mergedGroups.length > 0) {
    // Ensure blank line before tag groups if header has content
    if (
      outputLines.length > 0 &&
      // In-bounds by length guard.
      outputLines[outputLines.length - 1]!.trim() !== ''
    ) {
      outputLines.push('');
      lineMap.push(null);
      importSourceMap.push(null);
    }
    for (const group of mergedGroups) {
      // Find original line for inline tag groups, null for external
      const inlineMatch = inlineTagGroups.find((g) => g.name === group.name);
      for (const line of group.lines) {
        outputLines.push(line);
        // Inline tag groups map to their original line, external ones map to null
        if (inlineMatch) {
          // Find the original line index of this tag group in the source
          const srcIdx = lines.indexOf(line);
          lineMap.push(srcIdx >= 0 ? srcIdx + 1 : null);
        } else {
          lineMap.push(null);
        }
        importSourceMap.push(null);
      }
      outputLines.push(''); // blank line between groups
      lineMap.push(null);
      importSourceMap.push(null);
    }
  }

  // Body content
  // Ensure blank line separator
  if (
    resolvedBodyLines.length > 0 &&
    outputLines.length > 0 &&
    // In-bounds by length guard.
    outputLines[outputLines.length - 1]!.trim() !== ''
  ) {
    outputLines.push('');
    lineMap.push(null);
    importSourceMap.push(null);
  }
  for (const entry of resolvedBodyLines) {
    outputLines.push(entry.text);
    lineMap.push(entry.originalLine);
    importSourceMap.push(entry.importSource);
  }

  return { content: outputLines.join('\n'), lineMap, importSourceMap };
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
    // In-bounds by loop guard.
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();

    if (trimmed === '' || trimmed.startsWith('//')) {
      if (inTagGroup) inTagGroup = false;
      continue;
    }

    // Tag group heading
    if (isTagBlockHeading(trimmed)) {
      inTagGroup = true;
      continue;
    }

    // Tag group entry (indented under heading)
    if (inTagGroup && rawLine.match(/^\s+/)) {
      continue;
    }

    if (inTagGroup) {
      inTagGroup = false;
    }

    // Header directives
    if (HEADER_RE.test(trimmed)) continue;
    if (TAGS_RE.test(trimmed)) continue;

    // Known option lines (space-separated `key value` or bare boolean before content)
    if (
      !rawLine.match(/^\s/) &&
      !trimmed.includes('|') &&
      !isTagBlockHeading(trimmed)
    ) {
      // String.split always returns at least one element.
      const firstToken = trimmed.split(/\s/)[0]!.toLowerCase();
      if (KNOWN_HEADER_OPTIONS.has(firstToken)) {
        continue;
      }
    }

    // This is the first body line
    return i;
  }

  return lines.length;
}

/**
 * Check if a line is a tag group entry (indented line under a tag block heading).
 */
function isTagGroupEntry(
  line: string,
  allLines: string[],
  index: number
): boolean {
  if (!line.match(/^\s+/)) return false;
  // Walk backwards to find the nearest non-blank, non-comment, non-entry line
  for (let i = index - 1; i >= 0; i--) {
    // In-bounds by reverse-for loop guard.
    const prevRaw = allLines[i]!;
    const prev = prevRaw.trim();
    if (prev === '' || prev.startsWith('//')) continue;
    if (isTagBlockHeading(prev)) return true;
    if (prevRaw.match(/^\s+/)) continue; // another entry
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
  imported: TagGroupBlock[]
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

// ============================================================
// The `palette` line — a diagram names its own palette (#1035, #1037)
// ============================================================
//
// `palette` is a reserved keyword on EVERY chart type. `render()` and
// `parseDgmo()` lift it out of the source before any chart parser sees it,
// so no parser has to know it exists — on most chart types the bare line
// used to be read as a node, a task or an element.
//
//   palette nord          a built-in, in the reader's own light/dark
//   palette nord dark     a built-in, pinned to one mode
//
// Each lifted line is replaced by an empty `//` comment, never removed, so
// every later line keeps its number and every diagnostic still points at the
// line the author wrote. Comments are inert on every chart type (spec §1.2).
//
// An indented block under the line (`palette Dracula` + `light` / `dark`
// sections) is the embedded custom palette of the same design. It is lifted
// with its line, so it never reaches a parser, but it is not drawn yet: the
// render warns and falls back to the caller's palette.

import { makeDgmoError, type DgmoError } from '../diagnostics';
import { BUILT_IN_PALETTE_IDS } from './theme-file';

export type PaletteMode = 'light' | 'dark';

export interface PaletteDirective {
  /** The source with every palette line (and its block) turned into `//`. */
  content: string;
  /** The built-in palette the file names, when it names a valid one. */
  paletteId?: string;
  /** The mode word, when the line carries a valid one. */
  mode?: PaletteMode;
  diagnostics: DgmoError[];
}

const PALETTE_LINE_RE = /^palette(?:\s+(.*))?$/i;
const MODES: ReadonlySet<string> = new Set(['light', 'dark']);

function builtInList(): string {
  return [...BUILT_IN_PALETTE_IDS].sort().join(', ');
}

/**
 * Lift the `palette` line(s) out of `content`. The last valid line wins, as
 * the last of the `fill-*` family does. A file with no palette line comes back
 * unchanged, and the same string.
 */
export function extractPaletteDirective(content: string): PaletteDirective {
  if (!/^palette\b/im.test(content)) return { content, diagnostics: [] };

  const lines = content.split('\n');
  const diagnostics: DgmoError[] = [];
  let paletteId: string | undefined;
  let mode: PaletteMode | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, '');
    const match = PALETTE_LINE_RE.exec(line);
    if (!match) continue;
    const lineNumber = i + 1;
    lines[i] = '//';

    // The indented block that follows, blank lines inside it included.
    let blockEnd = i;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!.replace(/\r$/, '');
      if (next.trim() === '') continue;
      if (!/^\s/.test(next)) break;
      blockEnd = j;
    }
    for (let j = i + 1; j <= blockEnd; j++) lines[j] = '//';
    const hasBlock = blockEnd > i;
    i = blockEnd;

    const words = (match[1] ?? '').trim().split(/\s+/).filter(Boolean);
    const name = words[0];
    if (!name) {
      diagnostics.push(
        makeDgmoError(
          lineNumber,
          `"palette" needs a palette name — one of ${builtInList()}.`,
          'warning',
          'W_PALETTE_UNKNOWN'
        )
      );
      continue;
    }
    const id = name.toLowerCase();
    if (hasBlock || !BUILT_IN_PALETTE_IDS.has(id)) {
      diagnostics.push(
        makeDgmoError(
          lineNumber,
          hasBlock
            ? `An embedded palette block ("palette ${name}") is not drawn yet — this diagram uses the default palette.`
            : `"${name}" is not a built-in palette — this diagram uses the default palette. Built-in palettes: ${builtInList()}.`,
          'warning',
          'W_PALETTE_UNKNOWN'
        )
      );
      continue;
    }

    const modeWord = words[1]?.toLowerCase();
    if (words.length > 2 || (modeWord !== undefined && !MODES.has(modeWord))) {
      diagnostics.push(
        makeDgmoError(
          lineNumber,
          `"palette ${name}" takes one optional mode word, light or dark — the rest of the line is ignored.`,
          'warning',
          'W_PALETTE_MODE_UNKNOWN'
        )
      );
    }
    paletteId = id;
    mode =
      modeWord !== undefined && MODES.has(modeWord)
        ? (modeWord as PaletteMode)
        : undefined;
  }

  return {
    content: lines.join('\n'),
    ...(paletteId !== undefined && { paletteId }),
    ...(mode !== undefined && { mode }),
    diagnostics,
  };
}

export type RenderTheme = 'light' | 'dark' | 'transparent';

/**
 * Who wins, highest first: the caller's `paletteOverride` (a deliberate
 * per-embed choice such as a fence attribute or an explicit CLI `--palette`),
 * the file's own line, the caller's default `palette`, Slate.
 *
 * The mode word travels with the file's palette and applies only when that
 * palette is the one drawn. `light` keeps a caller's `transparent`, which
 * already draws the light colours with no background; `dark` has no
 * transparent form, so it draws dark.
 */
export function choosePalette(
  directive: PaletteDirective,
  caller: { palette?: string; paletteOverride?: string; theme?: RenderTheme }
): { paletteId: string; theme: RenderTheme } {
  const callerTheme = caller.theme ?? 'light';
  if (caller.paletteOverride !== undefined) {
    return { paletteId: caller.paletteOverride, theme: callerTheme };
  }
  if (directive.paletteId !== undefined) {
    const theme =
      directive.mode === 'dark'
        ? 'dark'
        : directive.mode === 'light' && callerTheme !== 'transparent'
          ? 'light'
          : callerTheme;
    return { paletteId: directive.paletteId, theme };
  }
  return { paletteId: caller.palette ?? 'slate', theme: callerTheme };
}

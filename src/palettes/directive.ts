// ============================================================
// The `palette` line — a diagram names or carries its palette (#1035, #1037)
// ============================================================
//
// `palette` is a reserved keyword on EVERY chart type. `render()` and
// `parseDgmo()` lift it out of the source before any chart parser sees it,
// so no parser has to know it exists — on most chart types the bare line
// used to be read as a node, a task or an element.
//
//   palette nord          a built-in, in the reader's own light/dark
//   palette nord dark     a built-in, pinned to one mode
//   palette Dracula       an embedded palette: an indented block holding a
//     dark                `light` and/or `dark` section, each with the twelve
//       bg #282a36        role keys in kebab case and a `colors` section with
//       …                 the eleven colour names. Hex only, and only here.
//       colors            A block with one section is that mode only.
//         red #ff5555
//
// Each lifted line is replaced by an empty `//` comment, never removed, so
// every later line keeps its number and every diagnostic still points at the
// line the author wrote. Comments are inert on every chart type (spec §1.2).
//
// An embedded block is checked by `validateThemeFile`, the theme folder's own
// rules (every key, hex only, contrast floors, built-in names reserved). A
// block that fails draws in the next palette down, with a warning on the line
// each problem names. It is used for this render only — never registered.

import { makeDgmoError, type DgmoError } from '../diagnostics';
import { COLOR_KEYS, SEMANTIC_KEYS } from './registry';
import { BUILT_IN_PALETTE_IDS } from './built-in-ids';
import { validateThemeFile } from './theme-file';
import type { PaletteConfig } from './types';

export type PaletteMode = 'light' | 'dark';

export interface PaletteDirective {
  /** The source with every palette line (and its block) turned into `//`. */
  content: string;
  /** The built-in palette the file names, when it names a valid one. */
  paletteId?: string;
  /** The embedded palette the file carries, when its block validated. */
  palette?: PaletteConfig;
  /** The mode word, or the one mode an embedded block defines. */
  mode?: PaletteMode;
  diagnostics: DgmoError[];
}

const PALETTE_LINE_RE = /^palette(?:\s+(.*))?$/;
const MODES: ReadonlySet<string> = new Set(['light', 'dark']);
const COLOR_NAMES: ReadonlySet<string> = new Set(COLOR_KEYS);

const kebab = (key: string) =>
  key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const camel = (key: string) =>
  key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
/** Theme style keys as the block spells them (diagrammo/diagrammo#1836). */
const STYLE_EXAMPLE: Readonly<Record<string, string>> = {
  radius: 'radius 0',
  'stroke-weight': 'stroke-weight 1',
  background: 'background transparent',
};
const STYLE_KEYS: ReadonlySet<string> = new Set(Object.keys(STYLE_EXAMPLE));
/** Role keys as the block spells them: `text-muted`, `text-on-fill-light`. */
const ROLE_KEYS: ReadonlySet<string> = new Set(SEMANTIC_KEYS.map(kebab));

function builtInList(): string {
  return [...BUILT_IN_PALETTE_IDS].sort().join(', ');
}

function warn(line: number, message: string, code: string): DgmoError {
  return makeDgmoError(line, message, 'warning', code);
}

interface BlockLine {
  line: number;
  text: string;
}

/**
 * Read an embedded block into a theme-file object and validate it. Returns the
 * palette, or the warnings that refuse it, each on the line it names.
 */
function readBlock(
  name: string,
  headerLine: number,
  block: readonly BlockLine[]
): { palette: PaletteConfig; mode: PaletteMode | null } | DgmoError[] {
  const diagnostics: DgmoError[] = [];
  const sections: Partial<
    Record<
      PaletteMode,
      { roles: Record<string, string>; colors: Record<string, string> }
    >
  > = {};
  // `<mode>.<camelKey>` or `<mode>.colors.<name>` → the line that set it.
  const where = new Map<string, number>();
  let section: PaletteMode | undefined;
  const style: Record<string, unknown> = {};

  for (const { line, text } of block) {
    const [key = '', value, ...rest] = text.trim().split(/\s+/);
    if (MODES.has(key) && value === undefined) {
      section = key as PaletteMode;
      if (sections[section]) {
        diagnostics.push(
          warn(
            line,
            `The "${section}" section appears twice in palette "${name}".`,
            'W_PALETTE_INVALID'
          )
        );
      }
      sections[section] = { roles: {}, colors: {} };
      where.set(section, line);
      continue;
    }
    if (key === 'colors' && value === undefined) continue;
    // Theme style (diagrammo/diagrammo#1836) is one value for both modes, so
    // it may sit above the sections or inside one — it is never a colour.
    if (STYLE_KEYS.has(key)) {
      if (value === undefined || rest.length > 0) {
        diagnostics.push(
          warn(
            line,
            `Write "${key}" as one key and one value, e.g. "${STYLE_EXAMPLE[key]}".`,
            'W_PALETTE_INVALID'
          )
        );
        continue;
      }
      const field = camel(key);
      const num = Number(value);
      style[field] =
        field === 'background' || !Number.isFinite(num) ? value : num;
      where.set(`style.${field}`, line);
      continue;
    }
    if (!section) {
      diagnostics.push(
        warn(
          line,
          `"${key}" sits outside a light or dark section of palette "${name}".`,
          'W_PALETTE_INVALID'
        )
      );
      continue;
    }
    if (value === undefined || rest.length > 0) {
      diagnostics.push(
        warn(
          line,
          `Write "${key}" as one key and one hex colour, e.g. "${key} #282a36".`,
          'W_PALETTE_INVALID'
        )
      );
      continue;
    }
    if (COLOR_NAMES.has(key)) {
      sections[section]!.colors[key] = value;
      where.set(`${section}.colors.${key}`, line);
    } else {
      // An unknown key goes through too, so validateThemeFile names it.
      const field = ROLE_KEYS.has(key) ? camel(key) : key;
      sections[section]!.roles[field] = value;
      where.set(`${section}.${field}`, line);
    }
  }
  if (diagnostics.length > 0) return diagnostics;

  const modes = Object.keys(sections) as PaletteMode[];
  const input: Record<string, unknown> = {
    id: name.toLowerCase(),
    name,
    ...(modes.length === 1 && { mode: modes[0] }),
    ...style,
  };
  for (const mode of modes) {
    const { roles, colors } = sections[mode]!;
    input[mode] = { ...roles, colors };
  }

  const result = validateThemeFile(input);
  if (result.ok) return { palette: result.palette, mode: result.mode };

  return result.errors.map((error) => {
    // `dark.textMuted: invalid hex`, `dark.colors.red: …`, or a contrast
    // line `dark: textOnFillDark #… on the …` — the field names the line.
    const styleField = /^(radius|strokeWeight|background):/.exec(error);
    const field =
      /^(light|dark)(?:\.colors)?\.(\w+)/.exec(error) ??
      /^(light|dark)\b[^:]*: (\w+) /.exec(error);
    const at = styleField
      ? where.get(`style.${styleField[1]}`)
      : field
        ? (where.get(`${field[1]}.colors.${field[2]}`) ??
          where.get(`${field[1]}.${field[2]}`) ??
          where.get(field[1]!))
        : undefined;
    return warn(
      at ?? headerLine,
      `Palette "${name}" is not drawn — ${error.replace(/\b(text[A-Z]\w*|[a-z]+[A-Z]\w*)\b/g, kebab)}.`,
      'W_PALETTE_INVALID'
    );
  });
}

/**
 * Lift the `palette` line(s) out of `content`. The last valid line wins, as
 * the last of the `fill-*` family does. A file with no palette line comes back
 * unchanged, and the same string.
 */
export function extractPaletteDirective(content: string): PaletteDirective {
  if (!/^palette\b/m.test(content)) return { content, diagnostics: [] };

  const lines = content.split('\n');
  const diagnostics: DgmoError[] = [];
  let paletteId: string | undefined;
  let palette: PaletteConfig | undefined;
  let mode: PaletteMode | undefined;

  for (let i = 0; i < lines.length; i++) {
    const match = PALETTE_LINE_RE.exec(lines[i]!.replace(/\r$/, ''));
    if (!match) continue;
    const lineNumber = i + 1;
    lines[i] = '//';

    // The indented block that follows, blank lines inside it included.
    const block: BlockLine[] = [];
    let blockEnd = i;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!.replace(/\r$/, '');
      if (next.trim() === '') continue;
      if (!/^\s/.test(next)) break;
      blockEnd = j;
      block.push({ line: j + 1, text: next });
    }
    for (let j = i + 1; j <= blockEnd; j++) lines[j] = '//';
    i = blockEnd;

    const words = (match[1] ?? '').trim().split(/\s+/).filter(Boolean);
    const name = words[0];
    if (!name) {
      diagnostics.push(
        warn(
          lineNumber,
          `"palette" needs a palette name — one of ${builtInList()}.`,
          'W_PALETTE_UNKNOWN'
        )
      );
      continue;
    }

    if (block.length > 0) {
      if (words.length > 1) {
        diagnostics.push(
          warn(
            lineNumber,
            `An embedded palette takes its name only — its sections say which modes it has.`,
            'W_PALETTE_MODE_UNKNOWN'
          )
        );
      }
      const read = readBlock(name, lineNumber, block);
      if (Array.isArray(read)) {
        diagnostics.push(...read);
        continue;
      }
      paletteId = undefined;
      palette = read.palette;
      mode = read.mode ?? undefined;
      continue;
    }

    const id = name.toLowerCase();
    if (!BUILT_IN_PALETTE_IDS.has(id)) {
      diagnostics.push(
        warn(
          lineNumber,
          `"${name}" is not a built-in palette — this diagram uses the default palette. Built-in palettes: ${builtInList()}. An embedded palette needs its colours in an indented block.`,
          'W_PALETTE_UNKNOWN'
        )
      );
      continue;
    }

    const modeWord = words[1];
    if (words.length > 2 || (modeWord !== undefined && !MODES.has(modeWord))) {
      diagnostics.push(
        warn(
          lineNumber,
          `"palette ${name}" takes one optional mode word, light or dark — the rest of the line is ignored.`,
          'W_PALETTE_MODE_UNKNOWN'
        )
      );
    }
    paletteId = id;
    palette = undefined;
    mode =
      modeWord !== undefined && MODES.has(modeWord)
        ? (modeWord as PaletteMode)
        : undefined;
  }

  return {
    content: lines.join('\n'),
    ...(paletteId !== undefined && { paletteId }),
    ...(palette !== undefined && { palette }),
    ...(mode !== undefined && { mode }),
    diagnostics,
  };
}

/**
 * Run a chart type's parser with the `palette` block lifted out first (#2110).
 * `render()` and `parseDgmo()` lift it before dispatch, but the app's per-type
 * previews call a parser directly on raw source, where each row of the block
 * would read as an unexpected line. Lifting is idempotent — a lifted line is
 * `//` — so the block's own warnings are raised once, by whoever lifts first.
 */
export function withPaletteLifted<
  R extends { readonly diagnostics?: readonly DgmoError[] },
>(content: string, parse: (content: string) => R): R {
  const directive = extractPaletteDirective(content);
  if (directive.content === content) return parse(content);
  const result = parse(directive.content);
  if (directive.diagnostics.length === 0) return result;
  return {
    ...result,
    diagnostics: [...directive.diagnostics, ...(result.diagnostics ?? [])],
  };
}

export type RenderTheme = 'light' | 'dark' | 'transparent';

/**
 * Who wins, highest first: the caller's `paletteOverride` (a deliberate
 * per-embed choice such as a fence attribute or an explicit CLI `--palette`),
 * the file's own line or block, the caller's default `palette`, Slate.
 *
 * The mode — the mode word, or the one mode a block defines — travels with
 * the file's palette and applies only when that palette is the one drawn.
 * `light` keeps a caller's `transparent`, which already draws the light
 * colours with no background; `dark` with a caller's `transparent` draws the
 * dark colours with no background (`transparentDark`, diagrammo/diagrammo#1836).
 *
 * `palette` is set when the file's embedded palette wins; it is in no
 * registry, so a caller draws from it rather than looking `paletteId` up.
 */
export function choosePalette(
  directive: PaletteDirective,
  caller: { palette?: string; paletteOverride?: string; theme?: RenderTheme }
): {
  paletteId: string;
  palette?: PaletteConfig;
  theme: RenderTheme;
  /**
   * Set when the caller asked for `transparent` and the file pinned `dark`:
   * the dark colours are drawn with no canvas (diagrammo/diagrammo#1836).
   */
  transparentDark?: true;
} {
  const callerTheme = caller.theme ?? 'light';
  if (caller.paletteOverride !== undefined) {
    return { paletteId: caller.paletteOverride, theme: callerTheme };
  }
  const fileId = directive.palette?.id ?? directive.paletteId;
  if (fileId !== undefined) {
    const theme =
      directive.mode === 'dark'
        ? 'dark'
        : directive.mode === 'light' && callerTheme !== 'transparent'
          ? 'light'
          : callerTheme;
    return {
      paletteId: fileId,
      ...(directive.palette && { palette: directive.palette }),
      theme,
      ...(theme === 'dark' &&
        callerTheme === 'transparent' && { transparentDark: true as const }),
    };
  }
  return { paletteId: caller.palette ?? 'slate', theme: callerTheme };
}

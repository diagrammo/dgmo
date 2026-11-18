// ============================================================
// Goal chart — Parser
// ============================================================
//
// Syntax:
//   goal <Title with unit>          // trailing color token ok (§1.5)
//   [thermometer | gauge]           // bare-flag mode (omit = progress bar)
//   bands                           // optional block (#1973)
//     4000 Poor red                 //   N [Label] [colour]; N may be `80%`
//     7000 Good                     //   an edge is where a band STARTS
//     12000                         //   a last bare number closes the scale
//   actual <number>
//   target <number>
//   [Measure color]                 // optional rows — the bullet chart (#1851)
//   actual / target / bands         //   per-measure lines
//   note <text>                     // optional free-text caption/description
//   [no-percent] [no-value] [fill-*] [no-title] [no-auto-color] [no-notes]
//   [no-ribbon] [no-ribbon-labels] [shared-scale]
//
// Unit lives in the title (treemap rule §24C); values accept `_` separators.

import type { PaletteColors } from '../palettes';
import { withPaletteLifted } from '../palettes/directive';
import { makeDgmoError, makeFail } from '../diagnostics';
import type { Writable } from '../utils/brand';
import { resolveColor } from '../colors';
import {
  parseChartFrameLine,
  takeFootnoteBlock,
} from '../utils/chart-frame-parse';
import {
  extractColor,
  measureIndent,
  parseFirstLine,
  tryParseSharedOption,
  fillModeFromOptions,
  normalizeNumericToken,
} from '../utils/parsing';
import type { GoalBand, GoalMeasure, GoalOptions, ParsedGoal } from './types';

/**
 * Parse a numeric value token, honoring `,` and `_` grouping separators.
 * A token carrying separators must normalize cleanly — `parseFloat('1,5')`
 * would otherwise silently yield `1`.
 */
function parseGoalNumber(token: string): number | null {
  const normalized = normalizeNumericToken(token);
  if (normalized === null && /[,_]/.test(token)) return null;
  const n = parseFloat(normalized ?? token);
  return Number.isFinite(n) ? n : null;
}

/** One `bands` line as written: a value or a percent of target. */
interface BandSpec {
  value: number;
  percent: boolean;
  label: string | null;
  color: string | null;
  /** True for a line with only a number — a band with no name. */
  bare: boolean;
  lineNumber: number;
}

interface BandBlock {
  lines: BandSpec[];
}

/** Lines collected for one measure (or the top level) before resolution. */
interface MeasureDraft {
  name: string | null;
  lineNumber: number | null;
  color?: string;
  actual: number | null;
  target: number | null;
  bands: BandBlock | null;
  /** Line of a `note` met inside this measure, for the misplaced-note warning. */
  noteLine: number | null;
  noteWarned: boolean;
}

function newDraft(
  name: string | null,
  lineNumber: number | null
): MeasureDraft {
  return {
    name,
    lineNumber,
    actual: null,
    target: null,
    bands: null,
    noteLine: null,
    noteWarned: false,
  };
}

/** Today's hidden traffic light, written as bands (§34.5). No ribbon. */
const DEFAULT_BANDS: readonly { pct: number; color: string }[] = [
  { pct: 0, color: 'red' },
  { pct: 0.5, color: 'orange' },
  { pct: 0.8, color: 'green' },
];

const BAND_LINE_RE = /^(-?[\d.,_]+)(%?)(?:\s+(.*))?$/;

export function parseGoal(
  content: string,
  palette?: PaletteColors
): ParsedGoal {
  return withPaletteLifted(content, (lifted) => parseGoalRaw(lifted, palette));
}

function parseGoalRaw(content: string, palette?: PaletteColors): ParsedGoal {
  const options: Writable<GoalOptions> = {
    noPercent: false,
    noValue: false,
    fillMode: undefined,
    noTitle: false,
    noAutoColor: false,
    noNote: false,
    noRibbon: false,
    noRibbonLabels: false,
    sharedScale: false,
  };
  const result: Writable<ParsedGoal> = {
    type: 'goal',
    title: null,
    titleLineNumber: null,
    description: null,
    mode: 'bar',
    multi: false,
    measures: [],
    options,
    diagnostics: [],
    error: null,
  };

  const fail = makeFail(result);
  const warn = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };
  // Error-severity but NON-fatal: appended so consumers surface it, while the
  // renderer still draws a 0% shell (§3). Does NOT set result.error.
  const softError = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'error'));
  };

  if (!content?.trim()) return fail(0, 'No content provided');

  const lines = content.split('\n');
  // The footnote block and its markdown body (#2093), before any line is read.
  takeFootnoteBlock(result, lines, result.diagnostics);
  let headerParsed = false;
  let sharedScaleLine: number | null = null;
  const sharedOpts: Record<string, string> = {};
  const top = newDraft(null, null);
  const drafts: MeasureDraft[] = [];
  let current: MeasureDraft = top;
  const seenNames = new Set<string>();
  const reportedBandLines = new Set<number>();

  /** Read the indented lines under a `bands` header starting at `start`. */
  const readBands = (start: number): { block: BandBlock; next: number } => {
    const block: BandBlock = { lines: [] };
    let j = start;
    while (j + 1 < lines.length) {
      const nextRaw = lines[j + 1]!;
      const t = nextRaw.trim();
      if (!t || t.startsWith('//')) {
        // A blank line ends the block only if the next content is unindented.
        j++;
        continue;
      }
      if (measureIndent(nextRaw) === 0) break;
      j++;
      const lineNum = j + 1;
      const m = t.match(BAND_LINE_RE);
      const value = m ? parseGoalNumber(m[1]!) : null;
      if (!m || value === null) {
        softError(
          lineNum,
          `A band line is "<number> [Label] [colour]" (got "${t}").`
        );
        continue;
      }
      const rest = m[3]?.trim() ?? '';
      let label: string | null = null;
      let color: string | null = null;
      if (rest) {
        // Prefix the number so a lone colour word reads as a trailing token.
        const ex = extractColor(
          `${m[1]} ${rest}`,
          palette,
          result.diagnostics,
          lineNum
        );
        label = ex.label.slice(m[1]!.length).trim() || null;
        color = ex.color ?? null;
      }
      block.lines.push({
        value: m[2] ? value / 100 : value,
        percent: !!m[2],
        label,
        color,
        bare: !rest,
        lineNumber: lineNum,
      });
    }
    // Trailing blank/comment lines were skipped; rewind to the last band line.
    let end = j;
    while (end > start && !lines[end]!.trim()) end--;
    return { block, next: end };
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    // ── First line: `goal [Title]` ──
    if (!headerParsed) {
      const first = parseFirstLine(trimmed);
      if (first?.chartType !== 'goal') {
        return fail(lineNum, 'Expected "goal [Title]" as the first line.');
      }
      if (first.title) {
        const { label, color } = extractColor(
          first.title,
          palette,
          result.diagnostics,
          lineNum
        );
        result.title = label || null;
        if (color !== undefined) top.color = color;
      }
      result.titleLineNumber = lineNum;
      headerParsed = true;
      continue;
    }

    // Chart frame: subtitle, source, footnote, byline (#1827), column 1.
    if (
      parseChartFrameLine(result, raw, lineNum, result.diagnostics, {
        heroTitle: 'Goal',
      })
    )
      continue;

    // ── `note` — free-text caption for the whole chart. Either inline
    //    (`note <text>`) or a block header followed by indented body lines. ──
    const noteHeader = trimmed.match(/^note(?:\s+(.+))?$/i);
    if (noteHeader && measureIndent(raw) === 0) {
      const body: string[] = [];
      if (noteHeader[1]) body.push(noteHeader[1].trim());
      while (i + 1 < lines.length && measureIndent(lines[i + 1]!) > 0) {
        body.push(lines[i + 1]!.trim());
        i++;
      }
      result.description = body.length ? body.join('\n') : null;
      if (current !== top) current.noteLine = lineNum;
      continue;
    }

    // ── `bands` block ──
    if (/^bands$/i.test(trimmed) && measureIndent(raw) === 0) {
      const { block, next } = readBands(i);
      i = next;
      if (current.bands) {
        softError(lineNum, 'A second "bands" block — only one per measure.');
      } else {
        current.bands = block;
      }
      if (block.lines.length === 0) {
        warn(lineNum, '"bands" has no band lines under it.');
        current.bands = null;
      }
      checkNoteOrder(current);
      continue;
    }

    // Other indented content has no home.
    if (measureIndent(raw) > 0) {
      warn(lineNum, `Indented content "${trimmed}" ignored.`);
      continue;
    }

    // ── `[Measure]` header ──
    const header = trimmed.match(/^\[(.+)\]$/);
    if (header) {
      const { label, color } = extractColor(
        header[1]!.trim(),
        palette,
        result.diagnostics,
        lineNum
      );
      const draft = newDraft(label, lineNum);
      if (color !== undefined) draft.color = color;
      const key = label.toLowerCase();
      if (seenNames.has(key)) {
        softError(lineNum, `Duplicate measure "${label}".`);
      }
      seenNames.add(key);
      drafts.push(draft);
      current = draft;
      continue;
    }

    const lower = trimmed.toLowerCase();

    // ── Bare-flag mode directives ──
    if (lower === 'thermometer' || lower === 'gauge') {
      result.mode = lower;
      continue;
    }

    // ── Bare-flag display toggles ──
    if (lower === 'no-percent') {
      options.noPercent = true;
      continue;
    }
    if (lower === 'no-value') {
      options.noValue = true;
      continue;
    }
    if (lower === 'no-auto-color') {
      options.noAutoColor = true;
      continue;
    }
    if (lower === 'no-ribbon') {
      options.noRibbon = true;
      continue;
    }
    if (lower === 'no-ribbon-labels') {
      options.noRibbonLabels = true;
      continue;
    }
    if (lower === 'shared-scale') {
      options.sharedScale = true;
      sharedScaleLine = lineNum;
      continue;
    }
    // `no-notes` is canonical (decision #48); `no-note` is the legacy alias.
    if (lower === 'no-notes' || lower === 'no-note') {
      options.noNote = true;
      continue;
    }

    // ── Shared cross-cutting flags: fill family / no-title ──
    if (tryParseSharedOption(trimmed, sharedOpts)) {
      options.fillMode = fillModeFromOptions(sharedOpts);
      if (sharedOpts['no-title'] === 'on') options.noTitle = true;
      continue;
    }

    // ── `actual <n>` / `target <n>` (space-separated key value) ──
    const kv = trimmed.match(/^(now|actual|target)\s+(.+)$/i);
    if (kv) {
      let key = kv[1]!.toLowerCase();
      if (key === 'now') {
        softError(
          lineNum,
          '"now" is renamed "actual" — write "actual <number>".'
        );
        key = 'actual';
      }
      const value = parseGoalNumber(kv[2]!.trim());
      if (value === null) {
        softError(lineNum, `"${key}" needs a number (got "${kv[2]!.trim()}").`);
        continue;
      }
      if (key === 'actual') {
        current.actual = value;
      } else if (value <= 0) {
        softError(lineNum, '"target" must be greater than 0.');
      } else {
        current.target = value;
      }
      checkNoteOrder(current);
      continue;
    }

    warn(lineNum, `Unrecognized line "${trimmed}".`);
  }

  /** A `note` followed by more of the same measure's lines sits inside it. */
  function checkNoteOrder(d: MeasureDraft): void {
    if (d === top || d.noteLine === null || d.noteWarned) return;
    d.noteWarned = true;
    warn(
      d.noteLine,
      `"note" inside measure "${d.name}" — a note belongs to the whole chart; put it before the first [Measure] or at the end.`
    );
  }

  const titleLine = result.titleLineNumber ?? 1;
  const multi = drafts.length > 0;
  result.multi = multi;

  if (multi) {
    if (top.actual !== null) {
      warn(
        titleLine,
        '"actual" above the first [Measure] is ignored — each measure has its own.'
      );
    }
    const ms: GoalMeasure[] = [];
    for (const d of drafts) {
      const line = d.lineNumber ?? titleLine;
      if (d.actual === null) {
        softError(line, `Measure "${d.name}" has no "actual" — treating as 0.`);
      }
      const target = d.target ?? top.target;
      if (target === null) {
        softError(
          line,
          `Measure "${d.name}" has no "target", and there is no top-level target.`
        );
      }
      ms.push(
        resolveMeasure(
          d.name,
          d.lineNumber,
          d.actual ?? 0,
          target,
          d.color,
          d.bands ?? top.bands,
          !!d.bands
        )
      );
    }
    result.measures = ms;
  } else {
    if (top.actual === null) {
      warn(titleLine, 'Missing "actual" value — treating as 0.');
    }
    if (top.target === null) {
      softError(
        titleLine,
        'Missing or invalid "target" — a goal needs a target > 0.'
      );
    }
    result.measures = [
      resolveMeasure(
        null,
        null,
        top.actual ?? 0,
        top.target,
        top.color,
        top.bands,
        !!top.bands
      ),
    ];
    if (sharedScaleLine !== null) {
      warn(
        sharedScaleLine,
        '"shared-scale" needs several [Measure] rows — ignored.'
      );
    }
  }

  return result;

  // ── Band resolution ────────────────────────────────────────
  function resolveMeasure(
    name: string | null,
    lineNumber: number | null,
    actual: number,
    target: number | null,
    color: string | undefined,
    block: BandBlock | null,
    ownBands: boolean
  ): GoalMeasure {
    const hasTarget = target !== null;
    const t = target ?? 0;
    let bands: GoalBand[];
    let closeEdge: number | null = null;
    if (block) {
      const specs = [...block.lines];
      // A last line with only a number closes the last band (needs ≥ 2 lines).
      let close: BandSpec | null = null;
      if (specs.length >= 2 && specs[specs.length - 1]!.bare) {
        close = specs.pop()!;
      }
      const abs = (s: BandSpec): number | null => {
        if (!s.percent) return s.value;
        if (!hasTarget) {
          bandError(
            s.lineNumber,
            `"${s.value * 100}%" is a percent of the target, and there is no target.`
          );
          return null;
        }
        return s.value * t;
      };
      bands = [];
      for (const s of specs) {
        const start = abs(s);
        if (start === null) continue;
        const prev = bands[bands.length - 1];
        if (prev && start <= prev.start) {
          bandError(
            s.lineNumber,
            'Band edges must ascend — each edge starts a band above the one before.'
          );
          continue;
        }
        bands.push({
          start,
          label: s.label,
          color: s.color,
          lineNumber: s.lineNumber,
        });
      }
      if (close) {
        const end = abs(close);
        const last = bands[bands.length - 1];
        if (end !== null && last && end <= last.start) {
          bandError(
            close.lineNumber,
            "The closing edge must sit above the last band's start."
          );
        } else if (end !== null) {
          closeEdge = end;
        }
      }
    } else {
      bands = DEFAULT_BANDS.map((b) => ({
        start: b.pct * t,
        label: null,
        color: resolveColor(b.color, palette) ?? b.color,
        lineNumber: 0,
      }));
    }
    const explicit = !!block;
    // Rows of a bullet chart always run to their actual (#1851 rule 6).
    const scaleEnd =
      explicit || result.multi ? Math.max(t, closeEdge ?? 0, actual) : t;
    return {
      name,
      lineNumber,
      actual,
      target: t,
      hasTarget,
      ...(color !== undefined ? { color } : {}),
      bands,
      explicitBands: explicit,
      ownBands,
      scaleEnd,
    };
  }

  /** One diagnostic per band line, though a top-level block resolves per measure. */
  function bandError(line: number, message: string): void {
    if (reportedBandLines.has(line)) return;
    reportedBandLines.add(line);
    softError(line, message);
  }
}

// ============================================================
// Event Line — Parser (spec §28)
// ============================================================
//
// Consistency-locked syntax (decision #16) — every token reuses an idiom:
//   - event + date  = timeline §15 line-prefix (`2012-02-05 XLVI`), date optional
//   - tag           = trailing same-line metadata (`… XLVI  g: Pop`)
//   - description    = pyramid/ring bare indented body (`- ` bullets + markdown)
//   - directives     = `no-scale` / `no-box` / `side above|below`
//
// Structure mirrors treemap's header/tag-block/content phases and pyramid's
// bare-body description collection.

import type { PaletteColors } from '../palettes';
import {
  emit,
  formatDgmoError,
  makeDgmoError,
  makeFail,
  suggest,
} from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import { EVENT_LINE_DX } from './diagnostics';
import type { Writable } from '../utils/brand';
import type { TagGroup } from '../utils/tag-groups';
import {
  matchTagBlockHeading,
  validateTagValues,
  validateTagGroupNames,
  stripDefaultModifier,
  finalizeAutoTagColors,
  injectDefaultTagMetadata,
  AUTO_TAG_COLOR_SENTINEL,
  tagAttrKey,
} from '../utils/tag-groups';
import {
  measureIndent,
  extractColor,
  parseFirstLine,
  splitNameAndMeta,
  tryParseSharedOption,
  warnUnknownMetaKeys,
  fillModeFromToken,
} from '../utils/parsing';
import {
  EVENT_LINE_REGISTRY,
  withTagAliases,
} from '../utils/reserved-key-registry';
import {
  extractDatePrefix,
  parseTimelineDate,
  type DatePrefixCtx,
} from '../timeline/parser';
import {
  parseDateToken,
  makeYearContext,
  resolveTokenYear,
  type DateOrder,
} from '../utils/date';
import type {
  EventLineEra,
  EventLineEvent,
  EventLineNow,
  EventLineOptions,
  ParsedEventLine,
} from './types';

/** A non-ISO date attempt: leading digits with a slash or dot separator. */
const NON_ISO_DATE_RE = /^\d{1,4}[/.]\d/;
/** `TBD` date line-prefix (case-insensitive) — a future, unscheduled event. */
const TBD_RE = /^TBD\b/i;
/** `side above` / `side below` / `side alternate` — card placement. */
const SIDE_RE = /^side\s+(above|below|alternate)\b/i;
/** Era run delimiter `[Name]` (§28.6a) with optional trailing `collapsed`/color. */
const ERA_RE = /^\[([^\]]+)\]\s*(.*)$/;
/** `collapsed: true|false` inside an era's trailing metadata. */
const ERA_COLLAPSED_RE = /\bcollapsed:\s*(true|false)\b/i;
/** `now` marker directive (§28.6b): bare `now`, or `now <date> [Label]`. */
const NOW_RE = /^now\b\s*(.*)$/i;
/** Legacy `section <Name>` — superseded by `[Name]`; emits a guiding warning. */
const SECTION_SEAM_RE = /^section\b/i;
/** Legacy key+value `direction <X>` — only LR (horizontal) is supported;
 *  TB/BT are fast-follow. Canonical booleans (`direction-lr`/`direction-tb`,
 *  §1.9) are handled inline before this regex. */
const DIRECTION_RE = /^direction\s+(\w+)/i;

export function parseEventLine(
  content: string,
  palette?: PaletteColors
): ParsedEventLine {
  const options: Writable<EventLineOptions> = {
    scale: true,
    side: 'alternate',
    noTitle: false,
    noBox: false,
    noLegend: false,
    fillMode: undefined,
  };
  const result: Writable<ParsedEventLine> = {
    type: 'event-line',
    title: null,
    titleLineNumber: null,
    events: [],
    eras: [],
    now: null,
    tagGroups: [],
    options,
    diagnostics: [],
    error: null,
  };

  const fail = makeFail(result);
  const pushWarning = (line: number, message: string, code?: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning', code));
  };
  const pushError = (line: number, message: string, code?: string): void => {
    const diag = makeDgmoError(line, message, 'error', code);
    result.diagnostics.push(diag);
    if (!result.error) result.error = formatDgmoError(diag);
  };

  if (!content?.trim()) return fail(0, 'No content provided');

  const lines = content.split('\n');

  // ── BL-121: date directives + carry-forward year context ──
  // Pre-scan (directives can precede or follow the dates they govern) for
  // `date-order` / `no-current-year` / `year`, then the first explicit year to
  // anchor bare month-days that appear before any full date.
  let dateOrder: DateOrder = 'mdy';
  let noCurrentYear = false;
  let directiveYear: number | null = null;
  for (const raw of lines) {
    const t = raw.trim().toLowerCase();
    if (t === 'no-current-year') noCurrentYear = true;
    else if (t === 'date-order dmy') dateOrder = 'dmy';
    else if (t === 'date-order mdy') dateOrder = 'mdy';
    else {
      const ym = t.match(/^year\s+(\d{1,4})$/);
      if (ym) directiveYear = parseInt(ym[1]!, 10);
    }
  }
  let prescan: number | null = null;
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    const p = parseDateToken(t, { dateOrder });
    if (p?.token.year != null) {
      prescan = p.token.sign * p.token.year;
      break;
    }
  }
  const yearCtx = makeYearContext({
    order: dateOrder,
    directiveYear,
    prescanYear: prescan,
    noCurrentYear,
  });
  const dateCtx: DatePrefixCtx = {
    order: dateOrder,
    resolve: (tok) => resolveTokenYear(tok, yearCtx),
  };
  const isDateDirective = (t: string): boolean =>
    t === 'no-current-year' ||
    t === 'date-order dmy' ||
    t === 'date-order mdy' ||
    /^year\s+\d{1,4}$/.test(t);

  let contentStarted = false;
  let headerParsed = false;
  const sharedOptions: Record<string, string> = {};

  let currentTagGroup: Writable<TagGroup> | null = null;
  let currentEvent: Writable<EventLineEvent> | null = null;
  let currentEra: string | null = null;
  // Indent of the open era's `[Name]` bracket; events must be indented deeper
  // to belong to it. -1 ⇒ no era open (an indent-0 event is then era-less).
  let eraIndent = -1;
  // Indent of the current event; a line indented deeper is its description.
  let currentEventIndent = 0;
  // A blank line was seen; the next description line starts a new paragraph.
  let pendingDescBreak = false;
  const aliasMap = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNumber = i + 1;
    const trimmed = line.trim();

    if (!trimmed) {
      currentTagGroup = null;
      // A blank line inside a description body is a paragraph break. Recorded
      // as pending rather than pushed, so trailing blank lines (and the blank
      // line before the *next* event) never leave an empty line on a card.
      pendingDescBreak = true;
      continue;
    }
    if (trimmed.startsWith('//')) continue;

    const indent = measureIndent(line);

    // ── First line: `event-line [Title]` ──
    if (!headerParsed) {
      const firstLine = parseFirstLine(trimmed);
      if (firstLine?.chartType === 'event-line') {
        result.title = firstLine.title ?? null;
        result.titleLineNumber = lineNumber;
        headerParsed = true;
        continue;
      }
      let msg = 'Expected "event-line [Title]" as the first line.';
      const hint = suggest(firstLine?.chartType ?? trimmed, ['event-line']);
      if (hint) msg += ` ${hint}`;
      return fail(lineNumber, msg);
    }

    // ── Tag group heading: `tag Genre as g` (before content) ──
    const tagBlockMatch = matchTagBlockHeading(trimmed);
    if (tagBlockMatch) {
      if (contentStarted) {
        pushError(
          lineNumber,
          'Tag groups must appear before event-line content',
          'E_TAG_DECLARED_AFTER_CONTENT'
        );
        continue;
      }
      currentTagGroup = {
        name: tagBlockMatch.name,
        ...(tagBlockMatch.alias !== undefined && {
          alias: tagBlockMatch.alias,
        }),
        entries: [],
        lineNumber,
      };
      if (tagBlockMatch.alias) {
        aliasMap.set(
          tagBlockMatch.alias.toLowerCase(),
          tagAttrKey(tagBlockMatch.name)
        );
      }
      aliasMap.set(
        tagAttrKey(tagBlockMatch.name),
        tagAttrKey(tagBlockMatch.name)
      );
      result.tagGroups.push(currentTagGroup);
      continue;
    }

    // ── Tag entries (indented `Value color` under a heading) ──
    if (currentTagGroup && !contentStarted && indent > 0) {
      const { text: cleanEntry, isDefault } = stripDefaultModifier(trimmed);
      const { label, color } = extractColor(
        cleanEntry,
        palette,
        result.diagnostics,
        lineNumber
      );
      if (isDefault || currentTagGroup.entries.length === 0) {
        currentTagGroup.defaultValue = label;
      }
      currentTagGroup.entries.push({
        value: label,
        color: color ?? AUTO_TAG_COLOR_SENTINEL,
        lineNumber,
      });
      continue;
    }

    // ── Content phase: indentation classifies each line. ──
    //
    // Eras are top-level `[Name]` section headers whose member events are
    // INDENTED beneath them (the org §7 / version-control §29 idiom); an event
    // at indent 0 sits OUTSIDE any era. A line indented deeper than its event
    // is that event's description body (§28.4).

    // Description body — any line indented deeper than its event. Checked
    // before the era bracket so a bracketed prose line (`  [aside]`) under an
    // event stays a description rather than opening a spurious era.
    if (currentEvent && indent > currentEventIndent) {
      if (pendingDescBreak && currentEvent.description.length > 0)
        currentEvent.description.push('');
      pendingDescBreak = false;
      const descLine = trimmed.startsWith('- ')
        ? `• ${trimmed.substring(2)}`
        : trimmed;
      currentEvent.description.push(descLine);
      continue;
    }

    // ── Era run delimiter: `[Name]` (§28.6a) — a section header whose member
    //    events are indented beneath it. Dedenting to (or past) the bracket's
    //    own indent leaves the era. Optional trailing bare `collapsed` flag
    //    (canonical, §1.8; legacy `collapsed: true`) and/or
    //    a color name tint/fold the era.
    const eraMatch = trimmed.match(ERA_RE);
    if (eraMatch) {
      contentStarted = true;
      currentTagGroup = null;
      currentEvent = null;
      const name = eraMatch[1]!.trim();
      let rest = (eraMatch[2] ?? '').trim();
      let collapsed = false;
      // Legacy `collapsed: true|false` metadata form — consumed first so
      // the bare-token check below never grabs the key of `collapsed: x`.
      const cm = rest.match(ERA_COLLAPSED_RE);
      if (cm) {
        collapsed = cm[1]!.toLowerCase() === 'true';
        rest = (
          rest.slice(0, cm.index) + rest.slice(cm.index! + cm[0].length)
        ).trim();
      } else {
        // Canonical bare `collapsed` flag (§28.6a / §1.8, decision #48) —
        // a standalone lowercase token anywhere in the trailing tail, so
        // `[Era] collapsed`, `[Era] blue collapsed`, and
        // `[Era] collapsed blue` all fold. Case-sensitive; the era name
        // lives inside the brackets so it can never collide.
        const bare = rest.match(/(?:^|\s)collapsed(?=\s|$)/);
        if (bare) {
          collapsed = true;
          rest = (
            rest.slice(0, bare.index) +
            ' ' +
            rest.slice(bare.index! + bare[0].length)
          ).trim();
        }
      }
      let color: string | null = null;
      if (rest) {
        // A lone trailing color token tints the era (named colors only; a hex
        // value is flagged by extractColor and left uncolored). Prefix a
        // placeholder so extractColor's trailing-token rule sees it.
        const token = rest.split(/\s+/).pop()!;
        const ex = extractColor(
          `x ${token}`,
          palette,
          result.diagnostics,
          lineNumber
        );
        if (ex.color !== undefined) color = token;
      }
      const era: EventLineEra = { name, color, collapsed, lineNumber };
      result.eras.push(era);
      currentEra = name;
      eraIndent = indent;
      continue;
    }

    // ── Top-level (indent 0) directives and reserved seams. ──
    if (indent === 0) {
      currentTagGroup = null;
      if (isDateDirective(trimmed.toLowerCase())) {
        continue; // consumed in the BL-121 pre-scan above
      }
      if (trimmed.toLowerCase() === 'no-scale') {
        options.scale = false;
        continue;
      }
      const sideMatch = trimmed.match(SIDE_RE);
      if (sideMatch) {
        options.side = sideMatch[1]!.toLowerCase() as EventLineOptions['side'];
        continue;
      }
      if (trimmed.toLowerCase() === 'no-box') {
        options.noBox = true;
        continue;
      }
      if (trimmed.toLowerCase() === 'no-legend') {
        options.noLegend = true;
        continue;
      }
      if (trimmed.toLowerCase() === 'legend-inline') {
        options.legendInline = true;
        continue;
      }
      // §28.6b `now` marker — a single dashed vertical rule at "today". Bare
      // `now` is resolved at render time (computed); `now <date> [Label]` pins
      // it to an explicit ISO date. Last one wins if repeated.
      {
        const nowMatch = trimmed.match(NOW_RE);
        if (nowMatch) {
          const rest = nowMatch[1]!.trim();
          if (!rest) {
            result.now = {
              computed: true,
              date: null,
              dateValue: null,
              label: 'now',
              lineNumber,
            } satisfies EventLineNow;
          } else {
            const prefix = extractDatePrefix(rest, dateCtx);
            if (prefix) {
              const label = prefix.remainder?.trim() || 'now';
              result.now = {
                computed: false,
                date: prefix.startDate,
                dateValue: parseTimelineDate(prefix.startDate),
                label,
                lineNumber,
              } satisfies EventLineNow;
            } else {
              result.diagnostics.push(
                emit(EVENT_LINE_DX.BAD_DATE, lineNumber, {
                  token: rest.split(/\s+/)[0],
                })
              );
            }
          }
          continue;
        }
      }
      {
        const fm = fillModeFromToken(trimmed);
        if (fm !== null) {
          options.fillMode = fm === 'tint' ? undefined : fm;
          continue;
        }
      }
      // §1.9 booleans: `direction-lr` restates the horizontal default (the
      // only supported mode — accepted no-op); `direction-tb` is the reserved
      // vertical seam and gets the same unsupported diagnostic as the legacy
      // `direction TB`.
      if (/^direction-lr$/i.test(trimmed)) continue;
      if (/^direction-tb$/i.test(trimmed)) {
        result.diagnostics.push(
          emit(EVENT_LINE_DX.UNSUPPORTED, lineNumber, {
            reason:
              'event-line is horizontal-only in v1; `direction-tb` (vertical orientation) is a fast-follow.',
          })
        );
        continue;
      }
      const dirMatch = trimmed.match(DIRECTION_RE);
      if (dirMatch) {
        const dir = dirMatch[1]!.toUpperCase();
        if (dir !== 'LR') {
          result.diagnostics.push(
            emit(EVENT_LINE_DX.UNSUPPORTED, lineNumber, {
              reason: `event-line is horizontal-only in v1; \`direction ${dir}\` (vertical orientation) is a fast-follow.`,
            })
          );
        }
        continue;
      }
      if (tryParseSharedOption(trimmed, sharedOptions)) continue;
      if (SECTION_SEAM_RE.test(trimmed)) {
        result.diagnostics.push(
          emit(EVENT_LINE_DX.UNSUPPORTED, lineNumber, {
            reason:
              'Group events with `[Name]` era brackets (§28.6a), not `section`.',
          })
        );
        continue;
      }
    }

    // ── Event line ──
    // An event belongs to the open era only when indented beneath that era's
    // bracket; an indent-0 event sits outside any era and closes the run
    // (events outside eras are fully supported — they simply have `era: null`).
    const inEra = currentEra !== null && indent > eraIndent;
    if (!inEra) currentEra = null;
    contentStarted = true;
    const event = parseEventHeader(
      trimmed,
      lineNumber,
      currentEra,
      aliasMap,
      result.diagnostics,
      pushWarning,
      dateCtx
    );
    result.events.push(event);
    currentEvent = event;
    currentEventIndent = indent;
  }

  options.noTitle = sharedOptions['no-title'] === 'on';

  resolveFutureEvents(result.events as Writable<EventLineEvent>[]);

  // Finalize tag colors + validate (flat topology → no cascade).
  finalizeAutoTagColors(result.tagGroups as Writable<TagGroup>[], palette);
  if (result.tagGroups.length > 0) {
    validateTagValues(result.events, result.tagGroups, pushWarning, suggest);
    validateTagGroupNames(result.tagGroups, pushWarning);
    // A tag group's first value is its implicit default (§28.5): an event with
    // no explicit value belongs to it. Materialize that into metadata — like
    // org/boxes-and-lines/pert — so color AND legend focus treat the default as
    // a real category (e.g. hovering "Scope" lights every untagged event).
    injectDefaultTagMetadata(result.events, result.tagGroups);
  }

  if (result.events.length === 0 && !result.error) {
    const diag = emit(EVENT_LINE_DX.NO_EVENTS, result.titleLineNumber ?? 1);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
  }

  // Eras render as date-spanning brackets, so an event dated outside its era's
  // chronological position makes adjacent era brackets overlap (§28.6a). Only
  // meaningful when the date scale drives x-position.
  const eraFlaggedLines = new Set<number>();
  if (options.scale) {
    validateEraDateOrder(result.events, result.eras, (err) => {
      eraFlaggedLines.add(err.line);
      result.diagnostics.push(err);
    });
  }

  // Any dated event listed before an earlier-dated one is out of chronological
  // order — a likely authoring slip (and, to-scale, it plots to the left of an
  // event listed above it). Era-spanning inversions already get the richer
  // ERA_DATE_ORDER message, so skip lines that check already flagged.
  validateEventDateOrder(result.events, eraFlaggedLines, result.diagnostics);

  // §28.6b: the `now` rule rides the date scale, so it only draws to-scale. Under
  // explicit `no-scale` (even spacing) there is no date axis to anchor it to.
  if (result.now && !options.scale) {
    result.diagnostics.push(
      emit(EVENT_LINE_DX.UNSUPPORTED, result.now.lineNumber, {
        reason:
          'the `now` marker needs a to-scale axis; it is ignored under `no-scale`.',
      })
    );
  }

  return result;
}

/**
 * Infer a position for every FUTURE (`TBD`) event from its source-order DATED
 * neighbors, so the to-scale axis can place it even though it has no authored
 * date. A TBD between two dated events is INTERPOLATED into that gap (a tentative
 * "somewhere in here" point, with `futureSpan` carrying the gap for the whisker
 * cue); a TBD after the last dated event is parked just past it (the open
 * horizon, `futureSpan = null` → dashed spine tail); a TBD before the first
 * dated event lands in a lead-in pad. Multiple TBDs sharing one gap fan evenly
 * across it in source order. With no dated events at all, TBDs keep `dateValue`
 * null and ride along under even spacing.
 */
function resolveFutureEvents(events: Writable<EventLineEvent>[]): void {
  const realVals = events
    .filter((e) => !e.future && e.dateValue !== null)
    .map((e) => e.dateValue!);
  if (realVals.length === 0) return;

  const hiAll = Math.max(...realVals);
  const loAll = Math.min(...realVals);
  const pad = hiAll > loAll ? (hiAll - loAll) * 0.15 : 1;

  // Nearest dated value before / after each event, in source order.
  const prevReal: (number | null)[] = [];
  let carry: number | null = null;
  for (const e of events) {
    prevReal.push(carry);
    if (!e.future && e.dateValue !== null) carry = e.dateValue;
  }
  const nextReal: (number | null)[] = new Array(events.length).fill(null);
  carry = null;
  for (let i = events.length - 1; i >= 0; i--) {
    nextReal[i] = carry;
    const e = events[i]!;
    if (!e.future && e.dateValue !== null) carry = e.dateValue;
  }

  // Group consecutive futures sharing the same (prev, next) bounds; fan evenly.
  let i = 0;
  while (i < events.length) {
    if (!events[i]!.future) {
      i++;
      continue;
    }
    const lo = prevReal[i]!;
    const hi = nextReal[i]!;
    let j = i;
    while (
      j < events.length &&
      events[j]!.future &&
      prevReal[j] === lo &&
      nextReal[j] === hi
    )
      j++;
    const group = events.slice(i, j);
    const g = group.length;
    if (lo !== null && hi !== null) {
      group.forEach((e, k) => {
        e.dateValue = lo + ((hi - lo) * (k + 1)) / (g + 1);
        e.futureSpan = [lo, hi];
      });
    } else if (lo === null && hi !== null) {
      const left = hi - pad;
      group.forEach((e, k) => {
        e.dateValue = left + ((hi - left) * (k + 1)) / (g + 1);
        e.futureSpan = [left, hi];
      });
    } else {
      // Trailing: park past the last dated event — the open horizon — evenly
      // spaced by `pad`, so a row of TBDs reads as a uniform march into the
      // future (the first sits `pad` past the last real date, each next `pad` on).
      group.forEach((e, k) => {
        e.dateValue = hiAll + pad * (k + 1);
        e.futureSpan = null;
      });
    }
    i = j;
  }
}

/**
 * Warn when dated events are listed out of chronological order — a later-listed
 * event dated before the dated event just above it. event-line reads
 * left-to-right by date, so a descending pair is almost always an authoring
 * slip. Undated events are skipped; coincident dates are in order.
 */
function validateEventDateOrder(
  events: readonly EventLineEvent[],
  skipLines: ReadonlySet<number>,
  diagnostics: DgmoError[]
): void {
  let prev: EventLineEvent | null = null;
  for (const ev of events) {
    // Future (TBD) events carry an inferred dateValue, not an authored one —
    // never flag them (or use them as the reference) for chronological order.
    if (ev.future || ev.dateValue === null) continue;
    if (
      prev &&
      ev.dateValue < prev.dateValue! &&
      !skipLines.has(ev.lineNumber)
    ) {
      diagnostics.push(
        emit(EVENT_LINE_DX.DATE_ORDER, ev.lineNumber, {
          label: ev.label,
          date: ev.date,
          prevLabel: prev.label,
          prevDate: prev.date,
        })
      );
    }
    prev = ev;
  }
}

/**
 * Warn when a dated event sits in an era whose chronological run it breaks —
 * i.e. it is dated after a later era begins, or before an earlier era ends.
 * Eras are left-to-right date bands; a straggler makes their brackets overlap.
 */
function validateEraDateOrder(
  events: readonly EventLineEvent[],
  eras: readonly EventLineEra[],
  emitWarn: (err: DgmoError) => void
): void {
  if (eras.length < 2) return;
  const order = new Map(eras.map((e, i) => [e.name, i]));
  const dated = events.filter(
    (e) =>
      !e.future && e.dateValue !== null && e.era !== null && order.has(e.era)
  );
  if (dated.length === 0) return;

  // Earliest and latest dated event per era index.
  const perEra = new Map<
    number,
    { min: EventLineEvent; max: EventLineEvent }
  >();
  for (const ev of dated) {
    const idx = order.get(ev.era!)!;
    const cur = perEra.get(idx);
    if (!cur) {
      perEra.set(idx, { min: ev, max: ev });
    } else {
      if (ev.dateValue! < cur.min.dateValue!) cur.min = ev;
      if (ev.dateValue! > cur.max.dateValue!) cur.max = ev;
    }
  }

  const n = eras.length;
  // prefixMax[k] = the latest-dated event across eras with index < k.
  // suffixMin[k] = the earliest-dated event across eras with index > k.
  const prefixMax: (EventLineEvent | null)[] = new Array(n).fill(null);
  const suffixMin: (EventLineEvent | null)[] = new Array(n).fill(null);
  for (let k = 1; k < n; k++) {
    const prev = perEra.get(k - 1)?.max ?? null;
    const carried = prefixMax[k - 1] ?? null;
    prefixMax[k] =
      prev && (!carried || prev.dateValue! > carried.dateValue!)
        ? prev
        : carried;
  }
  for (let k = n - 2; k >= 0; k--) {
    const next = perEra.get(k + 1)?.min ?? null;
    const carried = suffixMin[k + 1] ?? null;
    suffixMin[k] =
      next && (!carried || next.dateValue! < carried.dateValue!)
        ? next
        : carried;
  }

  for (const ev of dated) {
    const k = order.get(ev.era!)!;
    const ahead = suffixMin[k];
    const behind = prefixMax[k];
    if (ahead && ev.dateValue! > ahead.dateValue!) {
      emitWarn(
        emit(EVENT_LINE_DX.ERA_DATE_ORDER, ev.lineNumber, {
          label: ev.label,
          date: ev.date,
          era: ev.era,
          rel: 'after',
          otherEra: ahead.era,
          edge: 'begins',
          otherDate: ahead.date,
        })
      );
    } else if (behind && ev.dateValue! < behind.dateValue!) {
      emitWarn(
        emit(EVENT_LINE_DX.ERA_DATE_ORDER, ev.lineNumber, {
          label: ev.label,
          date: ev.date,
          era: ev.era,
          rel: 'before',
          otherEra: behind.era,
          edge: 'ends',
          otherDate: behind.date,
        })
      );
    }
  }
}

function parseEventHeader(
  trimmed: string,
  lineNumber: number,
  era: string | null,
  aliasMap: Map<string, string>,
  diagnostics: DgmoError[],
  pushWarning: (line: number, message: string, code?: string) => void,
  dateCtx: DatePrefixCtx
): Writable<EventLineEvent> {
  // Peel an optional ISO date line-prefix (timeline §15 idiom).
  let date: string | null = null;
  let dateValue: number | null = null;
  let future = false;
  let remainder = trimmed;

  // `TBD` line-prefix = a FUTURE, not-yet-scheduled event. Captioned verbatim;
  // its numeric position is resolved after parsing (just past the latest event).
  const tbdMatch = trimmed.match(TBD_RE);
  if (tbdMatch) {
    date = 'TBD';
    future = true;
    remainder = trimmed.slice(tbdMatch[0].length).trimStart();
  }

  const prefix = future ? null : extractDatePrefix(trimmed, dateCtx);
  if (prefix) {
    date = prefix.startDate;
    dateValue = parseTimelineDate(prefix.startDate);
    remainder = prefix.remainder || '';
    if (prefix.endDate) {
      diagnostics.push(
        emit(EVENT_LINE_DX.UNSUPPORTED, lineNumber, {
          reason:
            'event-line events are points; a date range (`->`) is not supported — using the start date.',
        })
      );
    }
  } else if (!future && NON_ISO_DATE_RE.test(trimmed)) {
    const firstToken = trimmed.split(/\s+/)[0]!;
    diagnostics.push(
      emit(EVENT_LINE_DX.BAD_DATE, lineNumber, { token: firstToken })
    );
  }

  const registry = withTagAliases(
    EVENT_LINE_REGISTRY,
    new Set(aliasMap.keys())
  );
  const split = splitNameAndMeta(
    remainder,
    registry,
    aliasMap,
    undefined,
    diagnostics,
    lineNumber
  );
  warnUnknownMetaKeys(
    split.meta,
    registry,
    (msg) => pushWarning(lineNumber, msg),
    split.name
  );

  const metadata: Record<string, string> = { ...split.meta };
  if (split.color !== undefined) metadata['color'] = split.color;

  return {
    label: split.name || remainder.trim(),
    lineNumber,
    date,
    dateValue,
    future,
    futureSpan: null,
    metadata,
    description: [],
    era,
  };
}

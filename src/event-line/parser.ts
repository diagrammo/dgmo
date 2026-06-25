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
  formatDgmoError,
  makeDgmoError,
  makeFail,
  suggest,
} from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import type { Writable } from '../utils/brand';
import type { TagGroup } from '../utils/tag-groups';
import {
  matchTagBlockHeading,
  emitTagLegacyDiagnostic,
  validateTagValues,
  validateTagGroupNames,
  stripDefaultModifier,
  finalizeAutoTagColors,
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
} from '../utils/parsing';
import {
  EVENT_LINE_REGISTRY,
  withTagAliases,
} from '../utils/reserved-key-registry';
import { extractDatePrefix, parseTimelineDate } from '../timeline/parser';
import type {
  EventLineEra,
  EventLineEvent,
  EventLineOptions,
  ParsedEventLine,
} from './types';

export const EVENT_LINE_DIAGNOSTIC_CODES = {
  NO_EVENTS: 'E_EVENT_LINE_NO_EVENTS',
  BAD_DATE: 'E_EVENT_LINE_BAD_DATE',
  UNSUPPORTED: 'E_EVENT_LINE_UNSUPPORTED',
} as const;

/** A non-ISO date attempt: leading digits with a slash or dot separator. */
const NON_ISO_DATE_RE = /^\d{1,4}[/.]\d/;
/** `side above` / `side below` / `side alternate` — card placement. */
const SIDE_RE = /^side\s+(above|below|alternate)\b/i;
/** Era run delimiter `[Name]` (§28.6a) with optional trailing `collapsed`/color. */
const ERA_RE = /^\[([^\]]+)\]\s*(.*)$/;
/** `collapsed: true|false` inside an era's trailing metadata. */
const ERA_COLLAPSED_RE = /\bcollapsed:\s*(true|false)\b/i;
/** Legacy `section <Name>` — superseded by `[Name]`; emits a guiding warning. */
const SECTION_SEAM_RE = /^section\b/i;
/** `direction <X>` — only LR (horizontal) is supported; TB/BT are fast-follow. */
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
  };
  const result: Writable<ParsedEventLine> = {
    type: 'event-line',
    title: null,
    titleLineNumber: null,
    events: [],
    eras: [],
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
  let contentStarted = false;
  let headerParsed = false;
  const sharedOptions: Record<string, string> = {};

  let currentTagGroup: Writable<TagGroup> | null = null;
  let currentEvent: Writable<EventLineEvent> | null = null;
  let currentEra: string | null = null;
  const aliasMap = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNumber = i + 1;
    const trimmed = line.trim();

    if (!trimmed) {
      currentTagGroup = null;
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
      emitTagLegacyDiagnostic(tagBlockMatch, lineNumber, result.diagnostics);
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

    // ── Indented line in content phase = description body ──
    if (indent > 0) {
      if (!currentEvent) {
        pushWarning(
          lineNumber,
          `Indented description "${trimmed}" has no event above it — add an event line first. (§28)`
        );
        continue;
      }
      const descLine = trimmed.startsWith('- ')
        ? `• ${trimmed.substring(2)}`
        : trimmed;
      currentEvent.description.push(descLine);
      continue;
    }

    // ── Indent-0 line: directive, reserved seam, or event ──
    currentTagGroup = null;

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
    const dirMatch = trimmed.match(DIRECTION_RE);
    if (dirMatch) {
      const dir = dirMatch[1]!.toUpperCase();
      if (dir !== 'LR') {
        pushWarning(
          lineNumber,
          `event-line is horizontal-only in v1; \`direction ${dir}\` (vertical orientation) is a fast-follow.`,
          EVENT_LINE_DIAGNOSTIC_CODES.UNSUPPORTED
        );
      }
      continue;
    }
    if (tryParseSharedOption(trimmed, sharedOptions)) continue;

    // ── Era run delimiter: `[Name]` opens a section that runs to the next
    //    `[Name]` or EOF (§28.6a). NOT an indentation container — events stay at
    //    indent 0, so flat bare-body descriptions are preserved. Optional trailing
    //    `collapsed: true` and/or a color name tint/fold the era.
    const eraMatch = trimmed.match(ERA_RE);
    if (eraMatch) {
      contentStarted = true;
      currentEvent = null;
      const name = eraMatch[1]!.trim();
      let rest = (eraMatch[2] ?? '').trim();
      let collapsed = false;
      const cm = rest.match(ERA_COLLAPSED_RE);
      if (cm) {
        collapsed = cm[1]!.toLowerCase() === 'true';
        rest = (rest.slice(0, cm.index) + rest.slice(cm.index! + cm[0].length)).trim();
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
      continue;
    }

    if (SECTION_SEAM_RE.test(trimmed)) {
      pushWarning(
        lineNumber,
        'Group events with `[Name]` era brackets (§28.6a), not `section`.',
        EVENT_LINE_DIAGNOSTIC_CODES.UNSUPPORTED
      );
      continue;
    }

    // ── Event line ──
    contentStarted = true;
    const event = parseEventHeader(
      trimmed,
      lineNumber,
      currentEra,
      aliasMap,
      result.diagnostics,
      pushWarning
    );
    result.events.push(event);
    currentEvent = event;
  }

  options.noTitle = sharedOptions['no-title'] === 'on';

  // Finalize tag colors + validate (flat topology → no cascade).
  finalizeAutoTagColors(result.tagGroups as Writable<TagGroup>[], palette);
  if (result.tagGroups.length > 0) {
    validateTagValues(result.events, result.tagGroups, pushWarning, suggest);
    validateTagGroupNames(result.tagGroups, pushWarning);
  }

  if (result.events.length === 0 && !result.error) {
    pushError(
      result.titleLineNumber ?? 1,
      'event-line has no events.',
      EVENT_LINE_DIAGNOSTIC_CODES.NO_EVENTS
    );
  }

  return result;
}

function parseEventHeader(
  trimmed: string,
  lineNumber: number,
  era: string | null,
  aliasMap: Map<string, string>,
  diagnostics: DgmoError[],
  pushWarning: (line: number, message: string, code?: string) => void
): Writable<EventLineEvent> {
  // Peel an optional ISO date line-prefix (timeline §15 idiom).
  let date: string | null = null;
  let dateValue: number | null = null;
  let remainder = trimmed;

  const prefix = extractDatePrefix(trimmed);
  if (prefix) {
    date = prefix.startDate;
    dateValue = parseTimelineDate(prefix.startDate);
    remainder = prefix.remainder || '';
    if (prefix.endDate) {
      pushWarning(
        lineNumber,
        'event-line events are points; a date range (`->`) is not supported — using the start date.',
        EVENT_LINE_DIAGNOSTIC_CODES.UNSUPPORTED
      );
    }
  } else if (NON_ISO_DATE_RE.test(trimmed)) {
    const firstToken = trimmed.split(/\s+/)[0]!;
    pushWarning(
      lineNumber,
      `Use ISO dates (YYYY, YYYY-MM, or YYYY-MM-DD). Got '${firstToken}'.`,
      EVENT_LINE_DIAGNOSTIC_CODES.BAD_DATE
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
    metadata,
    description: [],
    era,
  };
}

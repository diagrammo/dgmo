// ============================================================
// Visualization parser — Story 109.2 (arch-review).
//
// The unified parse state machine, relocated verbatim out of d3.ts. Moving it
// here breaks the d3 -> dgmo-router -> chart-type-registry -> d3 cycle that
// Story 109.1 left behind: dgmo-router + chart-type-registry now import
// parseVisualization from this module, not from d3.ts. Behavior is identical.
// ============================================================

import type { PaletteColors } from '../palettes';
import { resolveColorWithDiagnostic } from '../colors';
import {
  ALIAS_DIAGNOSTIC_CODES,
  METADATA_DIAGNOSTIC_CODES,
  dataCommaRemovedMessage,
  formatDgmoError,
  makeDgmoError,
  suggest,
  vennAliasKeywordRemovedMessage,
} from '../diagnostics';
import {
  collectIndentedValues,
  extractColor,
  measureIndent,
  normalizeNumericToken,
  parseFirstLine,
  peelTrailingColorName,
  splitNameAndMeta,
} from '../utils/parsing';
import {
  TIMELINE_REGISTRY,
  withTagAliases,
} from '../utils/reserved-key-registry';
import {
  matchTagBlockHeading,
  stripDefaultModifier,
  validateTagGroupNames,
  validateTagValues,
} from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import type { Writable } from '../utils/brand';
import { parseTimelineEventLine } from '../timeline/parser';
import {
  DEFAULT_CLOUD_OPTIONS,
  type ParsedVisualization,
  type QuadrantLabel,
  type VennOverlap,
  type WordCloudWord,
  type ParsedVizFull,
} from './types';

/**
 * Parses D3 chart text format into structured data. Returns the discriminated
 * {@link ParsedVisualization} union; internally the single state machine fills a
 * fat {@link ParsedVizFull} accumulator, which is a structural superset of every
 * variant, so the narrowing is sound and runtime-identical.
 */
export function parseVisualization(
  content: string,
  palette?: PaletteColors
): ParsedVisualization {
  return parseVisualizationFull(content, palette) as ParsedVisualization;
}

function parseVisualizationFull(
  content: string,
  palette?: PaletteColors
): ParsedVizFull {
  const result: ParsedVizFull = {
    type: null,
    title: null,
    titleLineNumber: null,
    orientation: 'horizontal',
    periods: [],
    data: [],
    words: [],
    cloudOptions: { ...DEFAULT_CLOUD_OPTIONS },
    links: [],
    arcOrder: 'appearance',
    arcNodeGroups: [],
    timelineEvents: [],
    timelineGroups: [],
    timelineEras: [],
    timelineMarkers: [],
    timelineTagGroups: [],
    timelineSort: null,
    timelineScale: true,
    timelineSwimlanes: false,
    vennSets: [],
    vennOverlaps: [],
    quadrantLabels: {
      topRight: null,
      topLeft: null,
      bottomLeft: null,
      bottomRight: null,
    },
    quadrantPoints: [],
    quadrantXAxis: null,
    quadrantXAxisLineNumber: null,
    quadrantYAxis: null,
    quadrantYAxisLineNumber: null,
    quadrantTitleLineNumber: null,
    diagnostics: [],
    error: null,
  };

  const fail = (line: number, message: string): ParsedVizFull => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  const warn = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  // 1.0 freeze: data-row value commas (separator + thousands grouping) are
  // removed. Emit an error but parse best-effort so the diagram still renders.
  const flagDataComma = (line: number, canonical: string): void => {
    result.diagnostics.push(
      makeDgmoError(
        line,
        dataCommaRemovedMessage(canonical),
        'error',
        METADATA_DIAGNOSTIC_CODES.DATA_COMMA_REMOVED
      )
    );
  };

  if (!content?.trim()) {
    return fail(0, 'Empty content');
  }

  const lines = content.split('\n');
  const freeformLines: string[] = [];
  let currentArcGroup: string | null = null;
  let currentTimelineGroup: string | null = null;
  let currentTimelineGroupMeta: Record<string, string> = {};
  let currentTimelineTagGroup: Writable<TagGroup> | null = null;
  let inTimelineEraBlock = false;
  let timelineEraBlockIndent = 0;
  let inTimelineMarkerBlock = false;
  let timelineMarkerBlockIndent = 0;
  let inSlopePeriodBlock = false;
  const timelineAliasMap = new Map<string, string>();
  const VALID_D3_TYPES = new Set([
    'slope',
    'wordcloud',
    'arc',
    'timeline',
    'venn',
    'quadrant',
    'sequence',
  ]);
  let firstLineParsed = false;

  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const rawLine = lines[i]!;
    const line = rawLine.trim();
    const indent = measureIndent(rawLine);
    const lineNumber = i + 1;

    // Skip empty lines
    if (!line) continue;

    // Skip comments
    if (line.startsWith('//')) continue;

    // First non-empty, non-comment line: chart type + optional title
    if (!firstLineParsed) {
      firstLineParsed = true;
      const firstLineResult = parseFirstLine(line);
      if (firstLineResult && VALID_D3_TYPES.has(firstLineResult.chartType)) {
        result.type = firstLineResult.chartType as ParsedVisualization['type'];
        if (firstLineResult.title) {
          result.title = firstLineResult.title;
          result.titleLineNumber = lineNumber;
        }
        continue;
      }
      // Not a bare chart type — fall through to normal parsing
    }

    // Timeline tag group heading: `tag Name [alias X]`
    if (result.type === 'timeline' && indent === 0) {
      const tagBlockMatch = matchTagBlockHeading(line);
      if (tagBlockMatch) {
        const newGroup: Writable<TagGroup> = {
          name: tagBlockMatch.name,
          ...(tagBlockMatch.alias !== undefined && {
            alias: tagBlockMatch.alias,
          }),
          entries: [],
          lineNumber,
        };
        currentTimelineTagGroup = newGroup;
        if (tagBlockMatch.alias) {
          timelineAliasMap.set(
            tagBlockMatch.alias.toLowerCase(),
            tagBlockMatch.name.toLowerCase()
          );
        } else {
          timelineAliasMap.set(
            tagBlockMatch.name.toLowerCase(),
            tagBlockMatch.name.toLowerCase()
          );
        }
        result.timelineTagGroups.push(newGroup);
        continue;
      }
    }

    // Timeline tag group entries (indented under tag heading)
    if (currentTimelineTagGroup && indent > 0) {
      const { text: entryText, isDefault } = stripDefaultModifier(line);
      const { label, color } = extractColor(
        entryText,
        palette,
        result.diagnostics,
        lineNumber
      );
      if (color) {
        if (isDefault) {
          currentTimelineTagGroup.defaultValue = label;
        } else if (currentTimelineTagGroup.entries.length === 0) {
          currentTimelineTagGroup.defaultValue = label;
        }
        currentTimelineTagGroup.entries.push({
          value: label,
          color,
          lineNumber,
        });
        continue;
      }
    }

    // End tag group on non-indented line
    if (currentTimelineTagGroup && indent === 0) {
      currentTimelineTagGroup = null;
    }

    // [Group] container headers for arc / timeline (§1.5 trailing-token):
    //   `[Group]`           — no color
    //   `[Group] color`     — trailing-token color (recognized palette word)
    //   `[Group] key: value`  — timeline group metadata
    if (result.type === 'timeline') {
      const tlGroupMatch = line.match(/^\[(.+?)\]\s*(.*?)\s*$/);
      if (tlGroupMatch) {
        const name = tlGroupMatch[1]!.trim();
        const trailing = tlGroupMatch[2] ?? '';
        let color: string | null = null;
        let groupMeta: Record<string, string> = {};

        if (trailing) {
          const { label: peeled, colorName } = peelTrailingColorName(
            ' ' + trailing
          );
          if (colorName && peeled.trim() === '') {
            color =
              resolveColorWithDiagnostic(
                colorName,
                lineNumber,
                result.diagnostics,
                palette
              ) ?? null;
          } else {
            const tlRegistry = withTagAliases(
              TIMELINE_REGISTRY,
              new Set([
                ...timelineAliasMap.keys(),
                ...timelineAliasMap.values(),
              ])
            );
            const split = splitNameAndMeta(
              trailing,
              tlRegistry,
              timelineAliasMap
            );
            if (split.color) {
              color =
                resolveColorWithDiagnostic(
                  split.color,
                  lineNumber,
                  result.diagnostics,
                  palette
                ) ?? null;
            }
            groupMeta = { ...split.meta };
            if (groupMeta['color']) {
              color =
                resolveColorWithDiagnostic(
                  groupMeta['color'],
                  lineNumber,
                  result.diagnostics,
                  palette
                ) ?? null;
              delete groupMeta['color'];
            }
          }
        }

        result.timelineGroups.push({
          name,
          color,
          metadata: groupMeta,
          lineNumber,
        });
        currentTimelineGroup = name;
        currentTimelineGroupMeta = groupMeta;
        continue;
      }
    }

    // [Group] for arc (original narrow regex)
    const groupMatch = line.match(
      /^\[(.+?)\](?:\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white))?\s*$/
    );
    if (groupMatch) {
      if (result.type === 'arc') {
        const name = groupMatch[1]!.trim();
        const color = groupMatch[2]
          ? (resolveColorWithDiagnostic(
              groupMatch[2].trim(),
              lineNumber,
              result.diagnostics,
              palette
            ) ?? null)
          : null;
        result.arcNodeGroups.push({ name, nodes: [], color, lineNumber });
        currentArcGroup = name;
      }
      continue;
    }

    // Reject legacy ## group syntax
    if (
      /^#{2,}\s+/.test(line) &&
      (result.type === 'arc' || result.type === 'timeline')
    ) {
      const name = line
        .replace(/^#{2,}\s+/, '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim();
      result.diagnostics.push(
        makeDgmoError(
          lineNumber,
          `'## ${name}' is no longer supported. Use '[${name}]' instead`,
          'warning'
        )
      );
      continue;
    }

    // Clear group context on un-indented lines (except [Group] already handled above)
    if (indent === 0) {
      currentArcGroup = null;
      currentTimelineGroup = null;
      currentTimelineGroupMeta = {};
    }

    // Arc link line (§1.5 trailing-token):
    //   `source -> target [color] [weight]` — color before weight
    if (result.type === 'arc') {
      const linkMatch = line.match(
        /^(.+?)\s*->\s*(.+?)(?:\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white))?(?:\s+(-?[\d,_]+(?:\.[\d]+)?))?$/
      );
      if (linkMatch) {
        // Capture groups 1 and 2 are guaranteed by the regex match.
        const source = linkMatch[1]!.trim();
        const target = linkMatch[2]!.trim();
        if (source.endsWith(':') || target.endsWith(':')) {
          result.diagnostics.push(
            makeDgmoError(
              lineNumber,
              `Trailing colon is not valid in arc edges — write '${source.replace(/:$/, '')} -> ${target.replace(/:$/, '')}' instead`
            )
          );
          continue;
        }
        const linkColor = linkMatch[3]
          ? (resolveColorWithDiagnostic(
              linkMatch[3].trim(),
              lineNumber,
              result.diagnostics,
              palette
            ) ?? null)
          : null;
        const arcValue = linkMatch[4]
          ? parseFloat(normalizeNumericToken(linkMatch[4]) ?? linkMatch[4])
          : 1;
        // 1.0 freeze: a thousands comma in the arc weight (`A -> B 1,000`) is a
        // removed data-row value comma. Underscores (`1_000`) remain valid.
        if (linkMatch[4]?.includes(',')) {
          flagDataComma(lineNumber, `${source} -> ${target} ${arcValue}`);
        }
        result.links.push({
          source,
          target,
          value: arcValue,
          color: linkColor,
          lineNumber,
        });
        // Assign nodes to current group (first-appearance wins)
        if (currentArcGroup !== null) {
          const group = result.arcNodeGroups.find(
            (g) => g.name === currentArcGroup
          );
          if (group) {
            const allGrouped = new Set(
              result.arcNodeGroups.flatMap((g) => g.nodes)
            );
            if (!allGrouped.has(source)) group.nodes.push(source);
            if (!allGrouped.has(target)) group.nodes.push(target);
          }
        }
        continue;
      }
    }

    // Timeline era block entries (indented under bare `era`)
    if (result.type === 'timeline' && inTimelineEraBlock) {
      if (indent <= timelineEraBlockIndent) {
        inTimelineEraBlock = false;
        // fall through to process this line normally
      } else {
        if (line.startsWith('//')) continue;
        // Timeline era block entry (\u00a71.5 trailing-token):
        //   `<start> -> <end> Label`           (no color)
        //   `<start> -> <end> Label color`     (trailing color word)
        // Color (group 4) must be a recognized lowercase palette word.
        const eraEntryMatch = line.match(
          /^(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s*(?:->|\u2013>)\s*(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s+(.+?)(?:\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white))?\s*$/
        );
        if (eraEntryMatch) {
          const colorAnnotation = eraEntryMatch[4]?.trim() || null;
          result.timelineEras.push({
            // Capture groups 1-3 guaranteed by the regex match.
            startDate: eraEntryMatch[1]!,
            endDate: eraEntryMatch[2]!,
            label: eraEntryMatch[3]!.trim(),
            color: colorAnnotation
              ? (resolveColorWithDiagnostic(
                  colorAnnotation,
                  lineNumber,
                  result.diagnostics,
                  palette
                ) ?? null)
              : null,
            lineNumber,
          });
        } else {
          warn(lineNumber, `Unrecognized era entry: "${line}"`);
        }
        continue;
      }
    }

    // Timeline marker block entries (indented under bare `marker`)
    if (result.type === 'timeline' && inTimelineMarkerBlock) {
      if (indent <= timelineMarkerBlockIndent) {
        inTimelineMarkerBlock = false;
        // fall through to process this line normally
      } else {
        if (line.startsWith('//')) continue;
        // Timeline marker block entry (§1.5 trailing-token).
        const markerEntryMatch = line.match(
          /^(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s+(.+?)(?:\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white))?\s*$/
        );
        if (markerEntryMatch) {
          const colorAnnotation = markerEntryMatch[3]?.trim() || null;
          result.timelineMarkers.push({
            // Capture groups 1-2 guaranteed by the regex match.
            date: markerEntryMatch[1]!,
            label: markerEntryMatch[2]!.trim(),
            color: colorAnnotation
              ? (resolveColorWithDiagnostic(
                  colorAnnotation,
                  lineNumber,
                  result.diagnostics,
                  palette
                ) ?? null)
              : null,
            lineNumber,
          });
        } else {
          warn(lineNumber, `Unrecognized marker entry: "${line}"`);
        }
        continue;
      }
    }

    // Timeline era/marker block starters and inline forms
    if (result.type === 'timeline') {
      // Bare `era` keyword starts a block
      if (line.toLowerCase() === 'era') {
        inTimelineEraBlock = true;
        timelineEraBlockIndent = indent;
        continue;
      }

      // Bare `marker` keyword starts a block
      if (line.toLowerCase() === 'marker') {
        inTimelineMarkerBlock = true;
        timelineMarkerBlockIndent = indent;
        continue;
      }

      // Timeline era lines, inline (\u00a71.5 trailing-token):
      //   `era YYYY->YYYY Label`        \u2014 no color
      //   `era YYYY->YYYY Label color`  \u2014 trailing-token color (recognized palette word)
      const eraMatch = line.match(
        /^era\s+(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s*(?:->|\u2013>)\s*(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s+(.+?)(?:\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white))?\s*$/
      );
      if (eraMatch) {
        const colorAnnotation = eraMatch[4]?.trim() || null;
        result.timelineEras.push({
          // Capture groups 1-3 guaranteed by the regex match.
          startDate: eraMatch[1]!,
          endDate: eraMatch[2]!,
          label: eraMatch[3]!.trim(),
          color: colorAnnotation
            ? (resolveColorWithDiagnostic(
                colorAnnotation,
                lineNumber,
                result.diagnostics,
                palette
              ) ?? null)
            : null,
          lineNumber,
        });
        continue;
      }

      // Timeline marker lines, inline (§1.5 trailing-token):
      //   `marker YYYY Label`        — no color
      //   `marker YYYY Label color`  — trailing-token color
      const markerMatch = line.match(
        /^marker\s+(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s+(.+?)(?:\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white))?\s*$/
      );
      if (markerMatch) {
        const colorAnnotation = markerMatch[3]?.trim() || null;
        result.timelineMarkers.push({
          // Capture groups 1-2 guaranteed by the regex match.
          date: markerMatch[1]!,
          label: markerMatch[2]!.trim(),
          color: colorAnnotation
            ? (resolveColorWithDiagnostic(
                colorAnnotation,
                lineNumber,
                result.diagnostics,
                palette
              ) ?? null)
            : null,
          lineNumber,
        });
        continue;
      }
    }

    // Timeline sort directive: `sort time | group | tag:X`
    if (result.type === 'timeline') {
      const sortMatch = line.match(/^sort\s+(time|group|tag:(.+))$/i);
      if (sortMatch) {
        const kind = sortMatch[1]!.toLowerCase();
        if (kind === 'time') result.timelineSort = 'time';
        else if (kind === 'group') result.timelineSort = 'group';
        else {
          result.timelineSort = 'tag';
          result.timelineDefaultSwimlaneTG = sortMatch[2]!.trim();
        }
        continue;
      }
    }

    // Timeline display directives (§15.6, space-separated, no colon):
    //   no-scale         — drop the date axis/scale
    //   swimlanes        — force lane backgrounds
    //   active-tag <X>   — authored active tag group / `none` / value-ramp label
    if (result.type === 'timeline') {
      const lower = line.toLowerCase();
      if (lower === 'no-scale') {
        result.timelineScale = false;
        continue;
      }
      if (lower === 'swimlanes') {
        result.timelineSwimlanes = true;
        continue;
      }
      const activeTagMatch = line.match(/^active-tag\s+(.+)$/i);
      if (activeTagMatch) {
        result.timelineActiveTag = activeTagMatch[1]!.trim();
        continue;
      }
    }

    // Timeline event lines: date-first syntax
    if (result.type === 'timeline') {
      const tlRegistry = withTagAliases(
        TIMELINE_REGISTRY,
        new Set([...timelineAliasMap.keys(), ...timelineAliasMap.values()])
      );

      const eventResult = parseTimelineEventLine(
        line,
        lineNumber,
        currentTimelineGroup,
        currentTimelineGroupMeta,
        timelineAliasMap,
        tlRegistry
      );

      if (eventResult) {
        result.diagnostics.push(...eventResult.diagnostics);
        if (eventResult.event) {
          result.timelineEvents.push(eventResult.event);
        }
        continue;
      }

      // Bare name with no date prefix (not a keyword)
      if (
        !/^(era|marker|tag|sort|active-tag|swimlanes|no-scale)\b/i.test(line) &&
        !line.startsWith('[')
      ) {
        warn(lineNumber, `Expected a date at the start — e.g., '1718 ${line}'`);
        continue;
      }
    }

    // Venn diagram DSL
    if (result.type === 'venn') {
      // Skip cross-chart bare-keyword options so they don't get parsed as
      // a 4th set name (the bare-keyword block at line ~1132 runs AFTER
      // type-specific parsing).
      if (/^(solid-fill|no-name|no-value|no-percent|no-title)$/i.test(line)) {
        // Fall through to the bare-keyword block below.
      } else if (/\+/.test(line)) {
        // Build lookup of known set names and aliases for label extraction
        const knownSetRefs = new Set<string>();
        for (const s of result.vennSets) {
          knownSetRefs.add(s.name.toLowerCase());
          if (s.alias) knownSetRefs.add(s.alias.toLowerCase());
        }

        const segments = line
          .split('+')
          .map((s) => s.trim())
          .filter(Boolean);
        if (segments.length >= 2) {
          // All segments except the last are pure set references
          const rawSets = segments.slice(0, -1);
          // In-bounds by length check (segments.length >= 2).
          const lastSeg = segments[segments.length - 1]!;

          // For the last segment, extract set reference and optional label.
          // Find where the set reference ends and label begins.
          // Try progressively shorter prefixes against known set names/aliases.
          const words = lastSeg.split(/\s+/);
          let matchLen = 0;
          for (let w = words.length; w >= 1; w--) {
            const candidate = words.slice(0, w).join(' ');
            if (knownSetRefs.has(candidate.toLowerCase())) {
              matchLen = w;
              break;
            }
          }
          let lastSetRef: string;
          let label: string | null;
          if (matchLen > 0) {
            lastSetRef = words.slice(0, matchLen).join(' ');
            label =
              words.length > matchLen ? words.slice(matchLen).join(' ') : null;
          } else {
            // No known set matched — assume first word is the set ref, rest is label
            // words is non-empty (split always returns at least one).
            lastSetRef = words[0]!;
            label = words.length > 1 ? words.slice(1).join(' ') : null;
          }
          rawSets.push(lastSetRef);
          result.vennOverlaps.push({ sets: rawSets, label, lineNumber });
          continue;
        }
      }

      // Set declaration (§1.5 universal trailing-token, §2A.2 modifier order):
      //   `Name` / `Name color` / `Name as <alias>` / `Name as <alias> color`
      // Color is the line-trailing token, peeled first; alias follows the name.
      // Legacy `Name alias <token>` emits E_VENN_ALIAS_KEYWORD_REMOVED.
      // Only attempt set parsing if the line wasn't a bare-keyword option (handled above).
      if (!/^(solid-fill|no-name|no-value|no-percent|no-title)$/i.test(line)) {
        // Peel a trailing color word from the whole line first so the
        // remaining text is `Name [alias <alias>]` / `Name [as <alias>]`.
        const { label: lineWithoutColor, colorName } =
          peelTrailingColorName(line);
        let color: string | null = null;
        if (colorName) {
          color =
            resolveColorWithDiagnostic(
              colorName,
              lineNumber,
              result.diagnostics,
              palette
            ) ?? null;
        }

        // Detect legacy `alias` keyword first — graceful degradation parses
        // the rest of the line so the set still appears.
        const legacyAliasMatch = lineWithoutColor.match(
          /^(.+?)\s+alias\s+(\S+)\s*$/i
        );
        if (legacyAliasMatch) {
          // Capture groups 1-2 guaranteed by the regex match.
          const name = legacyAliasMatch[1]!.trim();
          const aliasToken = legacyAliasMatch[2]!.trim();
          result.diagnostics.push(
            makeDgmoError(
              lineNumber,
              vennAliasKeywordRemovedMessage({ name, alias: aliasToken }),
              'error',
              ALIAS_DIAGNOSTIC_CODES.VENN_ALIAS_KEYWORD_REMOVED
            )
          );
          result.vennSets.push({ name, alias: aliasToken, color, lineNumber });
          continue;
        }

        const setDeclMatch = lineWithoutColor.match(
          /^(.+?)(?:\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11}))?\s*$/i
        );
        if (setDeclMatch) {
          // Capture group 1 guaranteed by the regex match.
          const name = setDeclMatch[1]!.trim();
          const alias = setDeclMatch[2]?.trim() ?? null;
          result.vennSets.push({ name, alias, color, lineNumber });
          continue;
        }
      }
    }

    // Quadrant-specific parsing
    if (result.type === 'quadrant') {
      // x-label Low, High  — or indented multi-line
      const xAxisMatch = line.match(/^x-label\s+(.*)/i);
      if (xAxisMatch) {
        // Capture group 1 guaranteed by the regex match.
        const val = xAxisMatch[1]!.trim();
        let parts: string[];
        if (val) {
          parts = val.split(',').map((s) => s.trim());
        } else {
          const collected = collectIndentedValues(lines, i);
          i = collected.newIndex;
          parts = collected.values;
        }
        if (parts.length >= 2) {
          // In-bounds by length check above.
          result.quadrantXAxis = [parts[0]!, parts[1]!];
          result.quadrantXAxisLineNumber = lineNumber;
        }
        continue;
      }

      // y-label Low, High  — or indented multi-line
      const yAxisMatch = line.match(/^y-label\s+(.*)/i);
      if (yAxisMatch) {
        // Capture group 1 guaranteed by the regex match.
        const val = yAxisMatch[1]!.trim();
        let parts: string[];
        if (val) {
          parts = val.split(',').map((s) => s.trim());
        } else {
          const collected = collectIndentedValues(lines, i);
          i = collected.newIndex;
          parts = collected.values;
        }
        if (parts.length >= 2) {
          // In-bounds by length check above.
          result.quadrantYAxis = [parts[0]!, parts[1]!];
          result.quadrantYAxisLineNumber = lineNumber;
        }
        continue;
      }

      // Quadrant position labels (§1.5 trailing-token):
      //   `top-right Label`        — no color
      //   `top-right Label color`  — trailing-token color (recognized palette word)
      const quadrantLabelRe =
        /^(top-right|top-left|bottom-left|bottom-right)\s+(.+)/i;
      const quadrantMatch = line.match(quadrantLabelRe);
      if (quadrantMatch) {
        // Capture groups 1-2 guaranteed by the regex match.
        const position = quadrantMatch[1]!.toLowerCase();
        const labelPart = quadrantMatch[2]!.trim();
        // Peel trailing recognized color word from the label.
        const { label: text, colorName } = peelTrailingColorName(labelPart);
        const color = colorName
          ? (resolveColorWithDiagnostic(
              colorName,
              lineNumber,
              result.diagnostics,
              palette
            ) ?? null)
          : null;
        const label: QuadrantLabel = { text, color, lineNumber };

        if (position === 'top-right') result.quadrantLabels.topRight = label;
        else if (position === 'top-left') result.quadrantLabels.topLeft = label;
        else if (position === 'bottom-left')
          result.quadrantLabels.bottomLeft = label;
        else if (position === 'bottom-right')
          result.quadrantLabels.bottomRight = label;
        continue;
      }

      // Data points: Label x, y  OR  Label x y
      const pointMatch = line.match(
        /^(.+?)\s+(-?[0-9][0-9,_]*(?:\.[0-9]+)?)\s*([,\s])\s*(-?[0-9][0-9,_]*(?:\.[0-9]+)?)\s*$/
      );
      if (pointMatch) {
        // Capture groups 1-4 guaranteed by the regex match.
        const label = pointMatch[1]!.trim();
        // Skip if it looks like a quadrant position keyword
        const lowerLabel = label.toLowerCase();
        if (
          lowerLabel !== 'top-right' &&
          lowerLabel !== 'top-left' &&
          lowerLabel !== 'bottom-left' &&
          lowerLabel !== 'bottom-right'
        ) {
          const x = parseFloat(
            normalizeNumericToken(pointMatch[2]!) ?? pointMatch[2]!
          );
          const y = parseFloat(
            normalizeNumericToken(pointMatch[4]!) ?? pointMatch[4]!
          );
          // 1.0 freeze: a comma as the x/y separator (`Label x, y`) or a
          // thousands comma inside either coordinate is a removed data-row
          // value comma. Underscores (`1_000`) remain valid.
          if (
            pointMatch[3] === ',' ||
            pointMatch[2]!.includes(',') ||
            pointMatch[4]!.includes(',')
          ) {
            flagDataComma(lineNumber, `${label} ${x} ${y}`);
          }
          result.quadrantPoints.push({
            label,
            x,
            y,
            lineNumber,
          });
        }
        continue;
      }
    }

    // ── Space-separated options (no colon) ──────────────────
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx >= 0) {
      const firstToken = line.substring(0, spaceIdx).toLowerCase();
      const restValue = line.substring(spaceIdx + 1).trim();

      if (
        firstToken === 'chart' &&
        VALID_D3_TYPES.has(restValue.toLowerCase())
      ) {
        result.type = restValue.toLowerCase() as ParsedVisualization['type'];
        continue;
      }

      if (firstToken === 'title') {
        result.title = restValue;
        result.titleLineNumber = lineNumber;
        if (result.type === 'quadrant') {
          result.quadrantTitleLineNumber = lineNumber;
        }
        continue;
      }

      if (firstToken === 'order') {
        const v = restValue.toLowerCase();
        if (v === 'name' || v === 'group' || v === 'degree') {
          result.arcOrder = v;
        }
        continue;
      }

      if (firstToken === 'rotate') {
        const v = restValue.toLowerCase();
        if (v === 'none' || v === 'mixed' || v === 'angled') {
          result.cloudOptions.rotate = v;
        }
        continue;
      }

      if (firstToken === 'max') {
        const v = parseInt(restValue, 10);
        if (!isNaN(v) && v > 0) {
          result.cloudOptions.max = v;
        }
        continue;
      }

      if (firstToken === 'size') {
        const parts = restValue.split(',').map((s) => parseInt(s.trim(), 10));
        if (
          parts.length === 2 &&
          parts.every((n) => !isNaN(n) && n > 0) &&
          // In-bounds by length === 2 check.
          parts[0]! < parts[1]!
        ) {
          // In-bounds by length === 2 check.
          result.cloudOptions.minSize = parts[0]!;
          result.cloudOptions.maxSize = parts[1]!;
        }
        continue;
      }
    }

    // ── Bare-keyword no-* flags (show-everything default) ──────
    {
      const bareToken = line.toLowerCase();
      if (bareToken === 'no-name') {
        result.noName = true;
        continue;
      }
      if (bareToken === 'no-value') {
        result.noValue = true;
        continue;
      }
      if (bareToken === 'no-percent') {
        result.noPercent = true;
        continue;
      }
      if (bareToken === 'solid-fill') {
        result.solidFill = true;
        continue;
      }
      if (bareToken === 'no-title') {
        result.noTitle = true;
        continue;
      }
      // Silent-ignore unrecognized no-* flags (typos, future flags).
      if (bareToken.startsWith('no-')) {
        continue;
      }
    }

    // ── Slope chart: period directive + right-scan data rows ──
    if (result.type === 'slope') {
      // Period block: indented lines inside `period` block
      // (blank lines are pre-filtered at loop top, so only non-indented lines close the block)
      if (inSlopePeriodBlock) {
        if (indent > 0) {
          result.periods.push(line);
          continue;
        }
        // Non-indented line → close block, fall through to process normally
        inSlopePeriodBlock = false;
      }

      // Period directive: `period Label1 Label2` or bare `period` (block open)
      // Only accept before data rows start (F4: prevent keyword shadowing labels)
      if (result.data.length === 0) {
        const periodMatch = line.match(/^period\b(.*)$/i);
        if (periodMatch) {
          if (result.periods.length > 0 && !inSlopePeriodBlock) {
            // F5: warn on duplicate period directives
            warn(
              lineNumber,
              `Duplicate 'period' directive — periods are already defined`
            );
          }
          // Capture group 1 guaranteed by the regex match.
          const rest = periodMatch[1]!.trim();
          if (rest) {
            // One-line: `period 1715 1725`
            const periodLabels = rest.split(/\s+/);
            result.periods.push(...periodLabels);
          } else {
            // Block open: bare `period`
            inSlopePeriodBlock = true;
          }
          continue;
        }
      }

      // Migration error: bare period line (old syntax — comma-separated, no keyword)
      // F1: Only fire when ALL comma-separated tokens are short (≤20 chars) and non-empty
      if (
        result.periods.length === 0 &&
        line.includes(',') &&
        !line.includes(':')
      ) {
        const tokens = line
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        const looksLikePeriods =
          tokens.length >= 2 && tokens.every((t) => t.length <= 20);
        if (looksLikePeriods) {
          return fail(
            lineNumber,
            `Period lines require the 'period' keyword — use 'period ${tokens.join(' ')}'`
          );
        }
      }

      // Migration error: old colon syntax in data rows
      // F2: Only fire when content after colon is predominantly numeric (old "Label: val1, val2" pattern)
      if (line.includes(':')) {
        const colonPos = line.indexOf(':');
        const afterColon = line.substring(colonPos + 1).trim();
        const numericTokens = afterColon
          .split(/[,\s]+/)
          .filter((v) => /^-?\d/.test(v));
        // Only trigger if most tokens after the colon are numeric (old data pattern)
        if (numericTokens.length >= 1) {
          const allTokens = afterColon.split(/[,\s]+/).filter(Boolean);
          if (numericTokens.length >= allTokens.length * 0.5) {
            const label = line.substring(0, colonPos).trim();
            return fail(
              lineNumber,
              `Colons are no longer used in slope data rows — use '${label} ${numericTokens.join(' ')}'`
            );
          }
        }
      }

      // Right-scan data row parsing (requires periods to be known)
      if (result.periods.length >= 2) {
        const P = result.periods.length;
        const tokens = line.split(/\s+/);
        const values: number[] = [];
        let sawComma = false;

        // Scan from right, capped at P values
        let rightIdx = tokens.length - 1;
        while (rightIdx >= 0 && values.length < P) {
          // In-bounds by while condition (rightIdx >= 0 && < tokens.length).
          const tok = tokens[rightIdx]!;
          const raw = normalizeNumericToken(tok) ?? tok;
          const num = parseFloat(raw);
          if (!isNaN(num) && /^-?\d/.test(raw)) {
            // A comma in a consumed value token is a removed data-row value
            // comma — either thousands grouping (`1,000`) or a separator with
            // the comma glued to the token (`40,`). Underscores stay valid.
            if (tok.includes(',')) sawComma = true;
            values.unshift(num);
            rightIdx--;
          } else {
            break;
          }
        }

        if (values.length < P) {
          warn(
            lineNumber,
            `Data row has ${values.length} numeric value(s) but ${P} period(s) are defined — expected ${P} values`
          );
          continue;
        }

        // Remaining left tokens = label
        const labelTokens = tokens.slice(0, rightIdx + 1);
        const joinedLabel = labelTokens.join(' ');
        if (sawComma) {
          flagDataComma(lineNumber, `${joinedLabel} ${values.join(' ')}`);
        }

        if (!joinedLabel) {
          warn(
            lineNumber,
            `Data row has no label — add a label before the numeric values`
          );
          continue;
        }

        // Color annotation (§1.5 trailing-token): `Label color` → split.
        const { label: labelPart, colorName: colorWord } =
          peelTrailingColorName(joinedLabel);
        const colorPart = colorWord
          ? (resolveColorWithDiagnostic(
              colorWord,
              lineNumber,
              result.diagnostics,
              palette
            ) ?? null)
          : null;

        if (!labelPart) {
          warn(
            lineNumber,
            `Data row has no label — add a label before the numeric values`
          );
          continue;
        }

        // F3: Warn on purely numeric labels — likely a mistake
        if (/^\d[\d,.]*$/.test(labelPart)) {
          warn(
            lineNumber,
            `Label '${labelPart}' looks numeric — this may indicate too many values or a missing label`
          );
        }

        result.data.push({
          label: labelPart,
          values,
          color: colorPart,
          lineNumber,
        });
        continue;
      }

      // If we get here in a slope chart, it's an unrecognized line
      if (firstLineParsed) {
        warn(lineNumber, `Unexpected line: '${line}'.`);
      }
      continue;
    }

    // ── Colon-separated metadata / options (legacy + data lines) ──
    const colonIndex = line.indexOf(':');

    if (colonIndex !== -1) {
      const rawKey = line.substring(0, colonIndex).trim();
      const key = rawKey.toLowerCase();

      // Check for color annotation in raw key: "Label(color)"
      const colorMatch = rawKey.match(/^(.+?)\(([^)]+)\)\s*$/);

      if (key === 'title') {
        result.title = line.substring(colonIndex + 1).trim();
        result.titleLineNumber = lineNumber;
        if (result.type === 'quadrant') {
          result.quadrantTitleLineNumber = lineNumber;
        }
        continue;
      }

      if (key === 'order') {
        const v = line
          .substring(colonIndex + 1)
          .trim()
          .toLowerCase();
        if (v === 'name' || v === 'group' || v === 'degree') {
          result.arcOrder = v;
        }
        continue;
      }

      if (key === 'rotate') {
        const v = line
          .substring(colonIndex + 1)
          .trim()
          .toLowerCase();
        if (v === 'none' || v === 'mixed' || v === 'angled') {
          result.cloudOptions.rotate = v;
        }
        continue;
      }

      if (key === 'max') {
        const v = parseInt(line.substring(colonIndex + 1).trim(), 10);
        if (!isNaN(v) && v > 0) {
          result.cloudOptions.max = v;
        }
        continue;
      }

      if (key === 'size') {
        const v = line.substring(colonIndex + 1).trim();
        const parts = v.split(',').map((s) => parseInt(s.trim(), 10));
        if (
          parts.length === 2 &&
          parts.every((n) => !isNaN(n) && n > 0) &&
          // In-bounds by length === 2 check.
          parts[0]! < parts[1]!
        ) {
          // In-bounds by length === 2 check.
          result.cloudOptions.minSize = parts[0]!;
          result.cloudOptions.maxSize = parts[1]!;
        }
        continue;
      }

      // Data line: "Label: value1, value2" or "Label(color): value1, value2"
      // Capture groups 1-2 guaranteed by the regex match.
      const labelPart = colorMatch ? colorMatch[1]!.trim() : rawKey;
      const colorPart = colorMatch
        ? (resolveColorWithDiagnostic(
            colorMatch[2]!.trim(),
            lineNumber,
            result.diagnostics,
            palette
          ) ?? null)
        : null;
      const valuePart = line.substring(colonIndex + 1).trim();
      const values = valuePart.split(',').map((v) => v.trim());

      // Check if this looks like a data line (values should be numeric)
      const numericValues: number[] = [];
      let allNumeric = true;
      for (const v of values) {
        const num = parseFloat(v);
        if (isNaN(num)) {
          allNumeric = false;
          break;
        }
        numericValues.push(num);
      }

      if (allNumeric && numericValues.length > 0) {
        // Wordcloud does not use colon data format — skip to freeform handling
        if (result.type !== 'wordcloud') {
          result.data.push({
            label: labelPart,
            values: numericValues,
            color: colorPart,
            lineNumber,
          });
          continue;
        }
      }
    }

    // For wordcloud: collect non-metadata lines for freeform fallback
    if (result.type === 'wordcloud') {
      if (colonIndex === -1 && !line.includes(' ')) {
        // Single bare word — structured mode
        result.words.push({ text: line, weight: 10, lineNumber });
      } else if (colonIndex === -1) {
        // Try "word weight" or "multi-word-label weight" space-separated format
        const lastSpace = line.lastIndexOf(' ');
        const rawWeight = lastSpace >= 0 ? line.substring(lastSpace + 1) : '';
        const maybeWeight =
          lastSpace >= 0
            ? parseFloat(normalizeNumericToken(rawWeight) ?? rawWeight)
            : NaN;
        if (lastSpace >= 0 && !isNaN(maybeWeight) && maybeWeight > 0) {
          const wordText = line.substring(0, lastSpace).trim();
          // 1.0 freeze: a thousands comma in the wordcloud weight
          // (`BigWord 1,000`) is a removed data-row value comma.
          if (rawWeight.includes(',')) {
            flagDataComma(lineNumber, `${wordText} ${maybeWeight}`);
          }
          result.words.push({
            text: wordText,
            weight: maybeWeight,
            lineNumber,
          });
        } else {
          freeformLines.push(line);
        }
      } else {
        // Non-numeric colon line — freeform text
        freeformLines.push(line);
      }
      continue;
    }

    // Catch-all: nothing matched this line
    // Skip on first line — chart type suggestion is handled post-loop
    if (firstLineParsed) {
      warn(lineNumber, `Unexpected line: '${line}'.`);
    }
  }

  // Validation
  if (!result.type) {
    const validD3Types = [...VALID_D3_TYPES];
    const firstNonEmpty =
      lines.find((l) => l.trim() && !l.trim().startsWith('//'))?.trim() ?? '';
    // split always returns at least one element.
    const hint = suggest(
      firstNonEmpty.split(/\s/)[0]!.toLowerCase(),
      validD3Types
    );
    let msg = `Unsupported chart type: "${firstNonEmpty.split(/\s/)[0]}". Supported types: ${validD3Types.join(', ')}`;
    if (hint) msg += `. ${hint}`;
    return fail(1, msg);
  }

  // Sequence diagrams are parsed by their own dedicated parser
  if (result.type === 'sequence') {
    return result;
  }

  if (result.type === 'wordcloud') {
    // If no structured words were found, parse freeform text as word frequencies
    if (result.words.length === 0 && freeformLines.length > 0) {
      result.words = tokenizeFreeformText(freeformLines.join(' '));
    }
    if (result.words.length === 0) {
      warn(
        1,
        'No words found. Add words as "word weight" (space-separated), one per line, or paste freeform text'
      );
    }
    // Apply max word limit (words are already sorted by weight desc for freeform)
    if (
      result.cloudOptions.max > 0 &&
      result.words.length > result.cloudOptions.max
    ) {
      result.words = result.words
        .slice()
        .sort((a, b) => b.weight - a.weight)
        .slice(0, result.cloudOptions.max);
    }
    return result;
  }

  if (result.type === 'arc') {
    if (result.links.length === 0) {
      warn(
        1,
        'No links found. Add links as "Source -> Target weight" (e.g., "Alice -> Bob 5")'
      );
    }
    // Validate arc ordering vs groups
    if (result.arcNodeGroups.length > 0) {
      if (result.arcOrder === 'name' || result.arcOrder === 'degree') {
        warn(
          1,
          `Cannot use "order ${result.arcOrder}" with [Group] headers. Use "order group" or remove group headers.`
        );
        result.arcOrder = 'group';
      }
      if (result.arcOrder === 'appearance') {
        result.arcOrder = 'group';
      }
    }
    return result;
  }

  if (result.type === 'timeline') {
    if (result.timelineEvents.length === 0) {
      warn(
        1,
        'No events found. Add events like "1718 Event Name" or "1716 -> 1717 Event Name"'
      );
    }
    // Validate tag values and inject defaults
    if (result.timelineTagGroups.length > 0) {
      validateTagValues(
        result.timelineEvents,
        result.timelineTagGroups,
        (line, msg) =>
          result.diagnostics.push(makeDgmoError(line, msg, 'warning')),
        suggest
      );
      validateTagGroupNames(
        result.timelineTagGroups,
        (line, msg) =>
          result.diagnostics.push(makeDgmoError(line, msg, 'warning')),
        (line, msg) => {
          const diag = makeDgmoError(line, msg);
          result.diagnostics.push(diag);
          if (!result.error) result.error = formatDgmoError(diag);
        }
      );
      for (const group of result.timelineTagGroups) {
        if (!group.defaultValue) continue;
        const key = group.name.toLowerCase();
        for (const event of result.timelineEvents) {
          if (!event.metadata[key]) {
            event.metadata[key] = group.defaultValue;
          }
        }
      }
    }

    return result;
  }

  if (result.type === 'venn') {
    if (result.vennSets.length < 2) {
      return fail(
        1,
        'At least 2 sets are required. Add set names (e.g., "Apples", "Oranges")'
      );
    }
    if (result.vennSets.length > 3) {
      return fail(1, 'Venn diagrams support 2–3 sets');
    }
    // Build lookup: full name (lowercase) and alias → canonical name
    const setNameLower = new Map<string, string>(
      result.vennSets.map((s) => [s.name.toLowerCase(), s.name])
    );
    const aliasLower = new Map<string, string>();
    for (const s of result.vennSets) {
      if (s.alias) aliasLower.set(s.alias.toLowerCase(), s.name);
    }
    const resolveSetRef = (ref: string): string | null =>
      setNameLower.get(ref.toLowerCase()) ??
      aliasLower.get(ref.toLowerCase()) ??
      null;

    // Resolve intersection set references; drop invalid ones with a diagnostic
    const validOverlaps: VennOverlap[] = [];
    for (const ov of result.vennOverlaps) {
      const resolvedSets: string[] = [];
      let valid = true;
      for (const ref of ov.sets) {
        const resolved = resolveSetRef(ref);
        if (!resolved) {
          result.diagnostics.push(
            makeDgmoError(
              ov.lineNumber,
              `Intersection references unknown set or alias "${ref}"`
            )
          );
          if (!result.error)
            // diagnostics non-empty: we just pushed to it.
            result.error = formatDgmoError(
              result.diagnostics[result.diagnostics.length - 1]!
            );
          valid = false;
          break;
        }
        resolvedSets.push(resolved);
      }
      if (valid) validOverlaps.push({ ...ov, sets: resolvedSets.sort() });
    }
    result.vennOverlaps = validOverlaps;
    return result;
  }

  if (result.type === 'quadrant') {
    if (result.quadrantPoints.length === 0) {
      warn(
        1,
        'No data points found. Add points as "Label x, y" (e.g., "Item A 0.5, 0.7")'
      );
    }
    return result;
  }

  // Slope chart validation
  if (result.periods.length < 2) {
    return fail(
      1,
      "Missing 'period' directive. Add 'period 2020 2024' before data rows (minimum 2 periods required)"
    );
  }

  if (result.data.length === 0) {
    warn(
      1,
      "No data lines found. Add data as 'Label value1 value2' (e.g., 'Blackbeard 40 4')"
    );
  }

  // Validate value counts match period count — warn and skip mismatched items
  for (const item of result.data) {
    if (item.values.length !== result.periods.length) {
      warn(
        item.lineNumber,
        `Data item "${item.label}" has ${item.values.length} value(s) but ${result.periods.length} period(s) are defined`
      );
    }
  }
  result.data = result.data.filter(
    (item) => item.values.length === result.periods.length
  );

  return result;
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'is',
  'am',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'i',
  'me',
  'my',
  'we',
  'us',
  'our',
  'you',
  'your',
  'he',
  'him',
  'his',
  'she',
  'her',
  'they',
  'them',
  'their',
  'what',
  'which',
  'who',
  'whom',
  'how',
  'when',
  'where',
  'why',
  'not',
  'no',
  'nor',
  'so',
  'if',
  'then',
  'than',
  'too',
  'very',
  'just',
  'about',
  'up',
  'out',
  'from',
  'into',
  'over',
  'after',
  'before',
  'between',
  'under',
  'again',
  'there',
  'here',
  'all',
  'each',
  'every',
  'both',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'only',
  'own',
  'same',
  'also',
  'as',
  'because',
  'until',
  'while',
  'during',
  'through',
]);

function tokenizeFreeformText(text: string): WordCloudWord[] {
  const counts = new Map<string, number>();

  // Split on non-letter/non-apostrophe chars, lowercase everything
  const tokens = text
    .toLowerCase()
    .split(/[^a-zA-Z']+/)
    .filter(Boolean);

  for (const raw of tokens) {
    // Strip leading/trailing apostrophes
    const word = raw.replace(/^'+|'+$/g, '');
    if (word.length < 2 || STOP_WORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([text, count]) => ({ text, weight: count, lineNumber: 0 }))
    .sort((a, b) => b.weight - a.weight);
}

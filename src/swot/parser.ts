import type { PaletteColors } from '../palettes';
import { resolveColorWithDiagnostic } from '../colors';
import {
  emit,
  formatDgmoError,
  makeDgmoError,
  makeFail,
  suggest,
} from '../diagnostics';
import type {
  DgmoError,
  DiagnosticParams,
  DiagnosticSpec,
} from '../diagnostics';
import { normalizeName } from '../utils/name-normalize';
import { SWOT_REGISTRY, withTagAliases } from '../utils/reserved-key-registry';
import {
  extractColor,
  measureIndent,
  parseFirstLine,
  peelQuotedName,
  splitNameAndMeta,
  warnUnknownMetaKeys,
} from '../utils/parsing';
import {
  activeTagNoMatchMessage,
  AUTO_TAG_COLOR_SENTINEL,
  finalizeAutoTagColors,
  matchTagBlockHeading,
  stripDefaultModifier,
  tagAttrKey,
  validateTagGroupNames,
} from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import type { Writable } from '../utils/brand';
import { parseChartFrameLine } from '../utils/chart-frame-parse';
import { SWOT_DX } from './diagnostics';
import type {
  ParsedSwot,
  SwotItem,
  SwotSection,
  SwotSectionKey,
} from './types';

// Source order never matters: this table is the drawing order, S W O T.
const SECTION_DEFAULTS: readonly {
  key: SwotSectionKey;
  label: string;
  color: string;
}[] = [
  { key: 'strengths', label: 'Strengths', color: 'green' },
  { key: 'weaknesses', label: 'Weaknesses', color: 'yellow' },
  { key: 'opportunities', label: 'Opportunities', color: 'blue' },
  { key: 'threats', label: 'Threats', color: 'red' },
];
const SECTION_KEYS = SECTION_DEFAULTS.map((s) => s.key) as readonly string[];

const VALUE_OPTIONS = new Set(['active-tag', 'palette']);
const BOOLEAN_OPTIONS = new Set([
  'no-axes',
  'no-tint-items',
  'no-title',
  'no-legend',
  'legend-inline',
]);
const DEFAULT_X_LABELS: readonly [string, string] = ['Helpful', 'Harmful'];
const DEFAULT_Y_LABELS: readonly [string, string] = ['Internal', 'External'];

/**
 * Edit distance, for the one place `suggest()` will not do: the unknown-section
 * ruling names the nearest keyword always, and `suggest()` stays silent when
 * nothing is close.
 */
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next.push(Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + cost));
    }
    row = next;
  }
  return row[b.length]!;
}

function nearestSection(word: string): string {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  let best = SECTION_KEYS[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const key of SECTION_KEYS) {
    const distance = editDistance(clean, key);
    if (distance < bestDistance) {
      best = key;
      bestDistance = distance;
    }
  }
  return best;
}

type MutableSwot = Omit<Writable<ParsedSwot>, 'xLabels' | 'yLabels'> & {
  xLabels: readonly [string, string];
  yLabels: readonly [string, string];
};

function parseItemLine(
  trimmed: string,
  lineNumber: number,
  counter: number,
  metaAliasMap: Map<string, string>,
  diagnostics: DgmoError[]
): Writable<SwotItem> {
  // A list habit, not syntax: the dash goes without a word.
  const text = trimmed.startsWith('- ') ? trimmed.slice(2).trim() : trimmed;
  const registry = withTagAliases(SWOT_REGISTRY, new Set(metaAliasMap.keys()));
  // `peelAlias: false`: an item is prose with no reference grammar, so
  // "Known as Bob" keeps its last two words.
  const split = splitNameAndMeta(
    text,
    registry,
    metaAliasMap,
    undefined,
    diagnostics,
    lineNumber,
    { peelAlias: false }
  );
  warnUnknownMetaKeys(
    split.meta,
    registry,
    (msg) => diagnostics.push(makeDgmoError(lineNumber, msg, 'warning')),
    split.name
  );
  const name = peelQuotedName(split.name);
  // Items have no colour slot, so the §1.5 trailing-token peel gives back what
  // it took: "Margins are in the red" keeps "red".
  const title = split.color !== undefined ? `${name} ${split.color}` : name;
  return {
    id: `item-${counter}`,
    title,
    tags: { ...split.meta },
    details: [],
    lineNumber,
    endLineNumber: lineNumber,
  };
}

export function parseSwot(
  content: string,
  palette?: PaletteColors
): ParsedSwot {
  const options: Record<string, string> = {};
  const sectionsByKey = new Map<SwotSectionKey, Writable<SwotSection>>();
  const result: MutableSwot = {
    type: 'swot',
    sections: [],
    tagGroups: [],
    options,
    xLabels: DEFAULT_X_LABELS,
    yLabels: DEFAULT_Y_LABELS,
    diagnostics: [],
    error: null,
  };
  const diagnostics = result.diagnostics;
  const fail = makeFail(result);

  const report = (
    spec: DiagnosticSpec,
    line: number,
    params: DiagnosticParams
  ): void => {
    const diag = emit(spec, line, params);
    diagnostics.push(diag);
    if (diag.severity === 'error') result.error ??= formatDgmoError(diag);
  };
  const warn = (line: number, message: string, code?: string): void => {
    diagnostics.push(makeDgmoError(line, message, 'warning', code));
  };
  const defaultColor = (word: string, line: number): string =>
    resolveColorWithDiagnostic(word, line, diagnostics, palette) ?? word;

  if (!content?.trim()) {
    return fail(0, 'No content provided');
  }

  const lines = content.split('\n');
  const metaAliasMap = new Map<string, string>();
  const tagGroups = result.tagGroups as Writable<TagGroup>[];
  let firstLineSeen = false;
  let contentStarted = false;
  let activeTagLine = 0;
  let currentTagGroup: Writable<TagGroup> | null = null;
  let currentSection: Writable<SwotSection> | null = null;
  let currentItem: Writable<SwotItem> | null = null;
  let itemIndent = 0;
  let detailIndent: number | null = null;
  let itemCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNumber = i + 1;
    const trimmed = line.trim();

    if (!trimmed) {
      currentTagGroup = null;
      continue;
    }
    if (trimmed.startsWith('//')) continue;

    if (!firstLineSeen) {
      firstLineSeen = true;
      const firstLine = parseFirstLine(trimmed);
      if (firstLine) {
        if (firstLine.chartType !== 'swot') {
          let msg = `Expected chart type "swot", got "${firstLine.chartType}"`;
          const hint = suggest(firstLine.chartType, ['swot']);
          if (hint) msg += `. ${hint}`;
          return fail(lineNumber, msg);
        }
        if (firstLine.title) {
          result.title = firstLine.title;
          result.titleLineNumber = lineNumber;
        }
        continue;
      }
    }

    // Chart frame: subtitle, source, footnote, byline (#1827), column 1.
    // A column-1 line closes the open tag group and item.
    if (parseChartFrameLine(result, line, lineNumber, diagnostics)) {
      currentTagGroup = null;
      currentItem = null;
      continue;
    }

    const indent = measureIndent(line);

    if (currentTagGroup && !contentStarted) {
      if (indent > 0) {
        const { text, isDefault } = stripDefaultModifier(trimmed);
        const { label, color } = extractColor(
          text,
          palette,
          diagnostics,
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
      currentTagGroup = null;
    }

    if (indent === 0) {
      if (!contentStarted) {
        const heading = matchTagBlockHeading(trimmed);
        if (heading) {
          currentTagGroup = {
            name: heading.name,
            ...(heading.alias !== undefined && { alias: heading.alias }),
            entries: [],
            lineNumber,
          };
          if (heading.alias) {
            metaAliasMap.set(
              normalizeName(heading.alias),
              tagAttrKey(heading.name)
            );
          }
          metaAliasMap.set(
            normalizeName(heading.name),
            tagAttrKey(heading.name)
          );
          tagGroups.push(currentTagGroup);
          continue;
        }
      }

      const space = trimmed.search(/\s/);
      const word = space < 0 ? trimmed : trimmed.slice(0, space);
      const rest = space < 0 ? '' : trimmed.slice(space + 1).trim();
      const keyword = word.toLowerCase();

      if (SECTION_KEYS.includes(keyword)) {
        contentStarted = true;
        currentItem = null;
        const key = keyword as SwotSectionKey;
        const existing = sectionsByKey.get(key);
        if (existing) {
          report(SWOT_DX.DUPLICATE_SECTION, lineNumber, { section: keyword });
          // Items that follow still land somewhere, so one slip reports once.
          currentSection = existing;
          continue;
        }
        // Prefixed with the keyword so a lone colour word (`weaknesses yellow`)
        // still has the leading space the §1.5 trailing-token peel looks for.
        const { label, color } = extractColor(
          `${keyword} ${rest}`.trim(),
          palette,
          diagnostics,
          lineNumber
        );
        const defaults = SECTION_DEFAULTS.find((s) => s.key === key)!;
        const written = peelQuotedName(label.slice(keyword.length).trim());
        currentSection = {
          key,
          label: written || defaults.label,
          color: color ?? defaultColor(defaults.color, lineNumber),
          items: [],
          lineNumber,
        };
        sectionsByKey.set(key, currentSection);
        continue;
      }

      if (BOOLEAN_OPTIONS.has(keyword) && !rest) {
        options[keyword] = 'on';
        continue;
      }
      if (VALUE_OPTIONS.has(keyword) && rest) {
        options[keyword] = rest;
        if (keyword === 'active-tag') activeTagLine = lineNumber;
        continue;
      }
      if (keyword === 'x-label' || keyword === 'y-label') {
        const parts = rest
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (parts.length === 2) {
          const pair: [string, string] = [parts[0]!, parts[1]!];
          if (keyword === 'x-label') result.xLabels = pair;
          else result.yLabels = pair;
        } else {
          warn(
            lineNumber,
            `'${keyword}' takes two labels, like '${keyword} A, B'. Using the defaults.`
          );
        }
        continue;
      }

      report(SWOT_DX.UNKNOWN_SECTION, lineNumber, {
        word,
        nearest: nearestSection(word),
      });
      // The items under it belong to the mistyped section; do not also report
      // each one as an orphan.
      currentSection = null;
      currentItem = null;
      contentStarted = true;
      continue;
    }

    if (!currentSection) {
      if (result.error === null) {
        report(SWOT_DX.ORPHAN_ITEM, lineNumber, { item: trimmed });
      }
      continue;
    }

    if (currentItem && indent > itemIndent) {
      if (detailIndent === null || indent <= detailIndent) {
        currentItem.details.push(trimmed);
        currentItem.endLineNumber = lineNumber;
        detailIndent = indent;
      } else {
        report(SWOT_DX.TOO_DEEP, lineNumber, { item: trimmed });
      }
      continue;
    }

    itemCounter++;
    currentItem = parseItemLine(
      trimmed,
      lineNumber,
      itemCounter,
      metaAliasMap,
      diagnostics
    );
    itemIndent = indent;
    detailIndent = null;
    currentSection.items.push(currentItem);
  }

  // Tag validation, the same way kanban does it.
  const tagValueSets = new Map(
    tagGroups.map((group) => [
      tagAttrKey(group.name),
      new Set(group.entries.map((e) => e.value.toLowerCase())),
    ])
  );
  result.sections = SECTION_DEFAULTS.map((defaults) => {
    const section = sectionsByKey.get(defaults.key);
    if (section) return section;
    return {
      key: defaults.key,
      label: defaults.label,
      color: defaultColor(defaults.color, 1),
      items: [],
      lineNumber: 0,
    };
  });
  for (const section of result.sections) {
    if (section.items.length === 0) {
      report(SWOT_DX.EMPTY_SECTION, section.lineNumber || 1, {
        section: section.key,
      });
    }
    for (const item of section.items) {
      for (const [tagKey, tagValue] of Object.entries(item.tags)) {
        const groupKey = metaAliasMap.get(tagKey.toLowerCase()) ?? tagKey;
        const valid = tagValueSets.get(groupKey);
        if (valid && !valid.has(tagValue.toLowerCase())) {
          const entries = tagGroups
            .find((g) => tagAttrKey(g.name) === groupKey)
            ?.entries.map((e) => e.value);
          let msg = `Unknown tag value "${tagValue}" for group "${groupKey}"`;
          const hint = entries ? suggest(tagValue, entries) : null;
          if (hint) msg += `. ${hint}`;
          warn(item.lineNumber, msg);
        }
      }
    }
  }

  finalizeAutoTagColors(tagGroups, palette);
  validateTagGroupNames(tagGroups, warn, (line, msg) => {
    const diag = makeDgmoError(line, msg);
    diagnostics.push(diag);
    result.error ??= formatDgmoError(diag);
  });
  const activeTagWarning = activeTagNoMatchMessage(
    options['active-tag'],
    tagGroups
  );
  if (activeTagWarning) {
    warn(activeTagLine || 1, activeTagWarning, 'W_ACTIVE_TAG_NO_MATCH');
  }

  return result;
}

// ============================================================
// Body chart — Parser (vertical slice: male-front muscle)
// ============================================================
//
// Zero net-new syntax — every token reuses an existing DGMO idiom:
//   - header      = bare chart-type line (`body [Title]`)
//   - form/sex/view = bare directives (`muscle` / `male` / `front`)
//   - tag group    = `tag Effort as e` + indented `Value color` (event-line §28)
//   - part + tag   = catalog name + trailing metadata (`chest  e: Primary`)
//   - description   = pyramid/ring bare indented body (`- ` bullets)
//
// Structure mirrors event-line's header / tag-block / content phases.

import type { PaletteColors } from '../palettes';
import { emit } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import type { Writable } from '../utils/brand';
import type { TagGroup } from '../utils/tag-groups';
import {
  matchTagBlockHeading,
  stripDefaultModifier,
  finalizeAutoTagColors,
  AUTO_TAG_COLOR_SENTINEL,
  tagAttrKey,
} from '../utils/tag-groups';
import { measureIndent, extractColor, parseFirstLine } from '../utils/parsing';
import { BODY_DX } from './diagnostics';
import { BODY_TERMS, getFigure, resolvePartKey } from './catalog';
import type { BodyOptions, BodyPart, BodyView, ParsedBody } from './types';

const FORM_RE = /^(muscle|skin|skeletal)$/i;
const SEX_RE = /^(male|female)$/i;
const VIEW_RE = /^(front|back)$/i;
/** A part line: a catalog name (letters/hyphens) + optional trailing metadata. */
const PART_RE = /^([a-zA-Z][\w-]*)\s*(.*)$/;
/** One `key: value` metadata pair (comma-separated on the trailing region). */
const META_PAIR_RE = /([a-zA-Z][\w-]*)\s*:\s*([^,]+)/g;

export function parseBody(
  content: string,
  palette?: PaletteColors
): ParsedBody {
  const lines = content.split('\n');
  const diagnostics: DgmoError[] = [];

  const views: BodyView[] = [];
  const options: Writable<BodyOptions> = {
    form: 'muscle',
    sex: 'male',
    views,
    noLegend: false,
    noTitle: false,
  };
  const tagGroups: Writable<TagGroup>[] = [];
  const parts: Writable<BodyPart>[] = [];
  const aliasMap = new Map<string, string>();

  let title: string | null = null;
  let titleLineNumber: number | null = null;
  let headerParsed = false;
  let currentTagGroup: Writable<TagGroup> | null = null;
  let currentPart: Writable<BodyPart> | null = null;
  let contentStarted = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (!trimmed) {
      currentTagGroup = null;
      continue;
    }
    if (trimmed.startsWith('//')) continue;

    const indent = measureIndent(line);
    const lineNumber = i + 1;

    // ── First line: `body [Title]` ──
    if (!headerParsed) {
      const firstLine = parseFirstLine(trimmed);
      if (firstLine?.chartType === 'body') {
        title = firstLine.title ?? null;
        titleLineNumber = lineNumber;
        headerParsed = true;
        continue;
      }
      return {
        title: null,
        titleLineNumber: null,
        options,
        tagGroups: [],
        parts: [],
        diagnostics,
        error: emit(BODY_DX.EXPECTED_HEADER, lineNumber),
      };
    }

    // ── Bare directives (before content) ──
    if (indent === 0 && !contentStarted) {
      if (FORM_RE.test(trimmed)) {
        options.form = trimmed.toLowerCase() as BodyOptions['form'];
        currentTagGroup = null;
        continue;
      }
      if (SEX_RE.test(trimmed)) {
        options.sex = trimmed.toLowerCase() as BodyOptions['sex'];
        currentTagGroup = null;
        continue;
      }
      if (VIEW_RE.test(trimmed)) {
        const v = trimmed.toLowerCase() as BodyView;
        if (!views.includes(v)) views.push(v);
        currentTagGroup = null;
        continue;
      }
      if (/^no-legend$/i.test(trimmed)) {
        options.noLegend = true;
        continue;
      }
      if (/^no-title$/i.test(trimmed)) {
        options.noTitle = true;
        continue;
      }
    }

    // ── Tag group heading: `tag Effort as e` (before content) ──
    const tagBlockMatch = matchTagBlockHeading(trimmed);
    if (tagBlockMatch && !contentStarted) {
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
      tagGroups.push(currentTagGroup);
      currentPart = null;
      continue;
    }

    // ── Tag entries (indented `Value color` under a heading) ──
    if (currentTagGroup && !contentStarted && indent > 0) {
      const { text: cleanEntry, isDefault } = stripDefaultModifier(trimmed);
      const { label, color } = extractColor(
        cleanEntry,
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

    // ── Bare-body description under the current part ──
    if (indent > 0 && currentPart) {
      currentPart.notes = [
        ...currentPart.notes,
        trimmed.replace(/^[-*]\s*/, ''),
      ];
      continue;
    }

    // ── Part line: `chest  e: Primary` ──
    if (indent === 0) {
      const m = trimmed.match(PART_RE);
      if (m) {
        contentStarted = true;
        currentTagGroup = null;
        let name = m[1]!;
        let rest = m[2] ?? '';
        // A bare leading `left`/`right` is an anatomical-side modifier (no
        // catalog part is named that), e.g. `right pec`. Peel it off and take
        // the next token as the real part name.
        let side: 'left' | 'right' | undefined;
        if (/^(left|right)$/i.test(name)) {
          const m2 = rest.match(PART_RE);
          if (m2) {
            side = name.toLowerCase() as 'left' | 'right';
            name = m2[1]!;
            rest = m2[2] ?? '';
          }
        }
        const metadata: Record<string, string> = {};
        for (const pair of rest.matchAll(META_PAIR_RE)) {
          const key =
            aliasMap.get(pair[1]!.toLowerCase()) ?? tagAttrKey(pair[1]!);
          metadata[key] = pair[2]!.trim();
        }
        currentPart = {
          name,
          metadata,
          notes: [],
          lineNumber,
          ...(side && { side }),
        };
        parts.push(currentPart);
        continue;
      }
    }
  }

  finalizeAutoTagColors(tagGroups, palette);

  // Default to the front view when none is named.
  if (views.length === 0) views.push('front');

  // A part is unknown only if it resolves in NONE of the requested figures
  // (a back-only muscle is legal when `back` is one of the views, and vice-versa).
  const figures = views.map((v) => getFigure(options.sex, v));
  for (const part of parts) {
    if (!figures.some((f) => resolvePartKey(f, part.name))) {
      diagnostics.push(
        emit(BODY_DX.UNKNOWN_PART, part.lineNumber, { name: part.name })
      );
    }
  }

  return {
    title,
    titleLineNumber,
    options,
    tagGroups,
    parts,
    diagnostics,
  };
}

/**
 * Completion vocabulary for the active figure(s): every catalog muscle,
 * surface landmark, and alias that resolves in a requested view, plus the
 * `left`/`right` side modifier. Powers editor autocomplete + highlighting.
 */
export function extractSymbols(docText: string): {
  kind: 'body';
  entities: string[];
} {
  const parsed = parseBody(docText);
  const figures = (
    parsed.options.views.length ? parsed.options.views : ['front']
  ).map((v) => getFigure(parsed.options.sex, v as BodyView));
  const entities = BODY_TERMS.filter(
    (t) =>
      t === 'left' || t === 'right' || figures.some((f) => resolvePartKey(f, t))
  );
  return { kind: 'body', entities };
}

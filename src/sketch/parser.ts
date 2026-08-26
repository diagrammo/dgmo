// ============================================================
// Sketch diagram — Parser (spec §31)
// ============================================================
//
// GUI-generated markup, hand-author-tolerant. Grammar is deliberately zero
// net-new except the headless line forms (`-label-`, `--`, `~~`):
//   - shapes: bare names + same-line `key: value` metadata (infra idiom)
//   - `[Brackets]` mean exactly one thing — a box (one level only)
//   - edges indented under their source, six forms (3 head-configs × solid/dashed)
//   - tag groups §1.3/§1.5 verbatim; box tags cascade, child overrides
//   - `at: C R` half-slot coords, OPTIONAL (missing → flow auto-place at layout)
//
// Leniency contract: never render broken. Unknown shapes fall back to
// rectangle; unknown/ambiguous edge targets drop the edge with a diagnostic;
// nested boxes flatten. Only an empty sketch or a non-sketch first line is
// fatal.

import type { PaletteColors } from '../palettes';
import type { DgmoError } from '../diagnostics';
import {
  NAME_DIAGNOSTIC_CODES,
  formatDgmoError,
  makeDgmoError,
  makeFail,
  nameMergedMessage,
  suggest,
} from '../diagnostics';
import type { Writable } from '../utils/brand';
import type { TagGroup } from '../utils/tag-groups';
import {
  AUTO_TAG_COLOR_SENTINEL,
  finalizeAutoTagColors,
  injectDefaultTagMetadata,
  matchTagBlockHeading,
  stripDefaultModifier,
  tagAttrKey,
  validateTagGroupNames,
  validateTagValues,
} from '../utils/tag-groups';
import {
  extractColor,
  measureIndent,
  parseFirstLine,
  splitNameAndMeta,
  stripQuotes,
  warnUnknownMetaKeys,
  fillModeFromToken,
} from '../utils/parsing';
import { normalizeName } from '../utils/name-normalize';
import { parseInArrowLabel } from '../utils/arrows';
import {
  SKETCH_REGISTRY,
  withTagAliases,
} from '../utils/reserved-key-registry';
import { SKETCH_DIAGNOSTIC_CODES } from './diagnostics';
import type {
  ParsedSketch,
  SketchAt,
  SketchBox,
  SketchEdge,
  SketchEdgeHeads,
  SketchNode,
} from './types';
import { isSketchShapeKind } from './types';

// ── Edge grammar (spec §31.4) ───────────────────────────────
// Order matters: arrow forms before headless-labeled, so `-label-> x` never
// half-matches as a headless `-label-`. There is NO left-pointing form.

interface EdgeForm {
  readonly re: RegExp;
  readonly heads: SketchEdgeHeads;
  readonly dashed: boolean;
  readonly labeled: boolean;
}

const EDGE_FORMS: readonly EdgeForm[] = [
  { re: /^<-(.+?)->\s*(.+)$/, heads: 'both', dashed: false, labeled: true },
  { re: /^<~(.+?)~>\s*(.+)$/, heads: 'both', dashed: true, labeled: true },
  { re: /^<->\s*(.+)$/, heads: 'both', dashed: false, labeled: false },
  { re: /^<~>\s*(.+)$/, heads: 'both', dashed: true, labeled: false },
  { re: /^-(.+?)->\s*(.+)$/, heads: 'one', dashed: false, labeled: true },
  { re: /^~(.+?)~>\s*(.+)$/, heads: 'one', dashed: true, labeled: true },
  { re: /^->\s*(.+)$/, heads: 'one', dashed: false, labeled: false },
  { re: /^~>\s*(.+)$/, heads: 'one', dashed: true, labeled: false },
  { re: /^--\s+(.+)$/, heads: 'none', dashed: false, labeled: false },
  { re: /^~~\s+(.+)$/, heads: 'none', dashed: true, labeled: false },
  { re: /^-(.+?)-\s+(.+)$/, heads: 'none', dashed: false, labeled: true },
  { re: /^~(.+?)~\s+(.+)$/, heads: 'none', dashed: true, labeled: true },
];

const EDGE_START_RE = /^[<\-~]/;
const LEFT_ARROW_RE = /^<[-~](?![-~]?>)/;
const BOX_RE = /^\[([^\]]*)\]\s*(.*)$/;
const BOX_TAIL_ALIAS_RE =
  /^as\s+([A-Za-z][A-Za-z0-9_]{0,11})(?=\s|,|$)\s*,?\s*/;
const AT_VALUE_RE = /^(-?\d+)\s+(-?\d+)$/;
// Sane bound for authored half-slot coords. Even a large hand-placed sketch
// stays within a few hundred half-slots; anything past this is a garbage value
// (e.g. a canvas-drag coord that ran away) and would blow the SVG viewBox up
// past what a browser can render. A half-slot is 64–104px, so 2000 already
// spans a ~128k–208k px canvas — far beyond any real diagram.
const SKETCH_AT_MAX = 2000;

interface PendingEdge {
  sourceId: string;
  targetRaw: string;
  label?: string;
  heads: SketchEdgeHeads;
  dashed: boolean;
  metadata: Record<string, string>;
  lineNumber: number;
}

type WritableNode = Writable<SketchNode> & { metadata: Record<string, string> };
type WritableBox = Writable<SketchBox> & {
  metadata: Record<string, string>;
  children: string[];
  childBoxes: string[];
};

/**
 * Sketch boxes nest to depth 2 — language decision #58, matching
 * `boxes-and-lines` (§14), which is the chart type that already does this.
 * (The decision record said "matching infra" until 2026-08-26; §4 Infrastructure
 * says "No nesting" outright.)
 */
const MAX_BOX_DEPTH = 2;

export function parseSketch(
  content: string,
  palette?: PaletteColors
): ParsedSketch {
  const options = {
    noLegend: false,
    legendInline: false,
    fillMode: undefined as 'solid' | 'outline' | undefined,
    noDescriptions: false,
  };
  const result: Writable<ParsedSketch> = {
    type: 'sketch',
    title: null,
    titleLineNumber: null,
    nodes: [],
    edges: [],
    boxes: [],
    tagGroups: [],
    options,
    diagnostics: [],
    error: null,
  };

  const fail = makeFail(result);
  const pushError = (line: number, message: string, code?: string): void => {
    // Non-fatal error: diagnostic squiggle without killing the render —
    // sketch's leniency contract degrades gracefully instead.
    result.diagnostics.push(makeDgmoError(line, message, 'error', code));
  };
  const warn = (line: number, message: string, code?: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning', code));
  };

  if (!content?.trim()) {
    return fail(0, 'No content provided');
  }

  const lines = content.split('\n');

  // ── Indexes ─────────────────────────────────────────────────
  const nodes: WritableNode[] = [];
  const boxes: WritableBox[] = [];
  const nodeById = new Map<string, WritableNode>();
  const aliasIndex = new Map<string, string>(); // alias literal → node/box id
  const labelIndex = new Map<string, string[]>(); // normalized label → node ids
  const boxByNorm = new Map<string, WritableBox>();
  const pendingEdges: PendingEdge[] = [];
  const tagAliasMap = new Map<string, string>(); // tag alias → tagAttrKey
  let idCounter = 0;

  const registryFor = () =>
    withTagAliases(SKETCH_REGISTRY, new Set(tagAliasMap.keys()));

  // ── Parse helpers ───────────────────────────────────────────

  const parseAt = (
    raw: string | undefined,
    lineNumber: number
  ): SketchAt | null => {
    if (raw === undefined) return null;
    const m = raw.trim().match(AT_VALUE_RE);
    if (!m) {
      warn(
        lineNumber,
        `Invalid at: value "${raw}" — expected two integers (at: C R); shape will flow-place`
      );
      return null;
    }
    const c = parseInt(m[1]!, 10);
    const r = parseInt(m[2]!, 10);
    // Reject absurd coords (e.g. a garbage value from a canvas drag). A huge
    // coordinate flows straight into the layout extent and blows the SVG
    // viewBox up to ~1e20, which browsers refuse to render — flow-place instead.
    if (
      !Number.isSafeInteger(c) ||
      !Number.isSafeInteger(r) ||
      Math.abs(c) > SKETCH_AT_MAX ||
      Math.abs(r) > SKETCH_AT_MAX
    ) {
      warn(
        lineNumber,
        `at: coordinate "${raw}" is out of range — half-slot coords must be whole numbers within ±${SKETCH_AT_MAX}; shape will flow-place`,
        SKETCH_DIAGNOSTIC_CODES.AT_OUT_OF_RANGE
      );
      return null;
    }
    return { c, r };
  };

  /** Lift sketch-reserved keys out of metadata, leaving only tag values. */
  const liftReserved = (
    meta: Record<string, string>,
    lineNumber: number
  ): { shape: SketchNode['shape']; at: SketchAt | null } => {
    let shape: SketchNode['shape'] = 'rectangle';
    const shapeRaw = meta['shape'];
    if (shapeRaw !== undefined) {
      const kind = shapeRaw.trim().toLowerCase();
      if (kind === 'rectangle' || isSketchShapeKind(kind)) {
        shape = kind as SketchNode['shape'];
      } else {
        warn(
          lineNumber,
          `Unknown shape "${shapeRaw}" — rendered as a rectangle (valid: database, queue, person, document, note)`,
          SKETCH_DIAGNOSTIC_CODES.UNKNOWN_SHAPE
        );
      }
      delete meta['shape'];
    }
    const at = parseAt(meta['at'], lineNumber);
    delete meta['at'];
    delete meta['collapsed']; // boxes handle the bare flag; ignore on shapes
    return { shape, at };
  };

  const addShape = (
    trimmed: string,
    lineNumber: number,
    box: WritableBox | null
  ): WritableNode | null => {
    const snm = splitNameAndMeta(
      trimmed,
      registryFor(),
      tagAliasMap,
      palette,
      result.diagnostics as DgmoError[],
      lineNumber
    );
    // Sketch has no manual colors — a peeled trailing color token is part of
    // the name ("Code Red" stays "Code Red").
    let label = stripQuotes(snm.name.trim()).trim();
    if (snm.color) label = `${label} ${snm.color}`.trim();
    if (!label) {
      warn(lineNumber, `Shape line has no name — ignored`);
      return null;
    }
    const meta = { ...snm.meta };
    warnUnknownMetaKeys(
      meta,
      registryFor(),
      (m) => warn(lineNumber, m),
      snm.name
    );
    const { shape, at } = liftReserved(meta, lineNumber);
    const norm = normalizeName(label);

    if (snm.alias !== undefined && aliasIndex.has(snm.alias)) {
      warn(
        lineNumber,
        `Duplicate alias "${snm.alias}" — the first declaration keeps it`
      );
    }
    const alias =
      snm.alias !== undefined && !aliasIndex.has(snm.alias)
        ? snm.alias
        : undefined;

    // Bare duplicate labels merge (standard dgmo semantics, I_NAME_MERGED);
    // an alias forces a DISTINCT shape (spec §31.2 duplicate-label rule).
    if (alias === undefined && snm.alias === undefined) {
      const existing = labelIndex.get(norm);
      if (existing && existing.length > 0) {
        const first = nodeById.get(existing[0]!)!;
        for (const [k, v] of Object.entries(meta)) {
          if (!(k in first.metadata)) first.metadata[k] = v;
        }
        if (first.at === null && at !== null) first.at = at;
        if (first.shape === 'rectangle' && shape !== 'rectangle') {
          first.shape = shape;
        }
        warn(
          lineNumber,
          nameMergedMessage({
            incomingDisplay: label,
            incomingLine: lineNumber,
            existingDisplay: first.label,
            existingLine: first.lineNumber,
          }),
          NAME_DIAGNOSTIC_CODES.NAME_MERGED
        );
        return first;
      }
    }

    const id = `sketch-node-${++idCounter}`;
    const node: WritableNode = {
      id,
      label,
      ...(alias !== undefined && { alias }),
      shape,
      at,
      metadata: meta,
      ...(box !== null && { boxLabel: box.label }),
      lineNumber,
    };
    nodes.push(node);
    nodeById.set(id, node);
    if (alias !== undefined) aliasIndex.set(alias, id);
    const list = labelIndex.get(norm);
    if (list) list.push(id);
    else labelIndex.set(norm, [id]);
    if (box !== null) box.children.push(id);
    return node;
  };

  /** Parse a box tail: `as alias at: C R, collapsed, crew: Hold`. */
  const parseBoxTail = (
    tail: string,
    lineNumber: number
  ): {
    alias?: string;
    at: SketchAt | null;
    collapsed: boolean;
    meta: Record<string, string>;
  } => {
    let rest = tail.trim();
    let alias: string | undefined;
    const aliasMatch = rest.match(BOX_TAIL_ALIAS_RE);
    if (aliasMatch) {
      alias = aliasMatch[1]!;
      rest = rest.slice(aliasMatch[0].length);
    }
    let collapsed = false;
    rest = rest.replace(/(^|,|\s)collapsed(?=\s|,|$)/i, (_m, pre: string) => {
      collapsed = true;
      return pre === ',' ? ',' : pre;
    });
    const meta: Record<string, string> = {};
    let at: SketchAt | null = null;
    for (const seg of rest.split(',')) {
      const t = seg.trim();
      if (!t) continue;
      const colonIdx = t.indexOf(':');
      if (colonIdx < 0) {
        warn(lineNumber, `Unrecognized box metadata "${t}" — ignored`);
        continue;
      }
      const rawKey = t.slice(0, colonIdx).trim().toLowerCase();
      const value = t.slice(colonIdx + 1).trim();
      if (rawKey === 'at') {
        at = parseAt(value, lineNumber);
      } else if (value) {
        meta[tagAliasMap.get(rawKey) ?? rawKey] = value;
      }
    }
    return { ...(alias !== undefined && { alias }), at, collapsed, meta };
  };

  const openBox = (
    label: string,
    tail: string,
    lineNumber: number,
    parentBoxId: string | null
  ): WritableBox => {
    const norm = normalizeName(label);
    const existing = boxByNorm.get(norm);
    const { alias, at, collapsed, meta } = parseBoxTail(tail, lineNumber);
    if (existing) {
      warn(
        lineNumber,
        `Box "${label}" already declared on line ${existing.lineNumber} — shapes are added to it`
      );
      return existing;
    }
    const box: WritableBox = {
      id: `[${norm}]`,
      label: label.trim(),
      ...(alias !== undefined && { alias }),
      at,
      metadata: meta,
      collapsed,
      children: [],
      childBoxes: [],
      parentBoxId,
      lineNumber,
    };
    boxes.push(box);
    if (parentBoxId !== null) {
      boxByNorm
        .get(normalizeName(parentBoxId.slice(1, -1)))
        ?.childBoxes.push(box.id);
    }
    boxByNorm.set(norm, box);
    if (alias !== undefined) {
      if (aliasIndex.has(alias)) {
        warn(
          lineNumber,
          `Duplicate alias "${alias}" — the first declaration keeps it`
        );
      } else {
        aliasIndex.set(alias, box.id);
      }
    }
    return box;
  };

  const addEdge = (
    trimmed: string,
    lineNumber: number,
    sourceId: string
  ): void => {
    for (const form of EDGE_FORMS) {
      const m = trimmed.match(form.re);
      if (!m) continue;
      let label: string | undefined;
      let targetRegion: string;
      if (form.labeled) {
        const labelResult = parseInArrowLabel(m[1]!, lineNumber);
        result.diagnostics.push(...labelResult.diagnostics);
        label = labelResult.label;
        targetRegion = m[2]!;
      } else {
        targetRegion = m[1]!;
      }
      const snm = splitNameAndMeta(
        targetRegion.trim(),
        registryFor(),
        tagAliasMap,
        palette,
        result.diagnostics as DgmoError[],
        lineNumber,
        { peelAlias: false }
      );
      let targetRaw = snm.name.trim();
      if (snm.color) targetRaw = `${targetRaw} ${snm.color}`.trim();
      const meta = { ...snm.meta };
      delete meta['at'];
      delete meta['shape'];
      warnUnknownMetaKeys(meta, registryFor(), (msg) => warn(lineNumber, msg));
      if (!targetRaw) {
        warn(lineNumber, `Edge has no target — ignored`);
        return;
      }
      pendingEdges.push({
        sourceId,
        targetRaw,
        ...(label !== undefined && { label }),
        heads: form.heads,
        dashed: form.dashed,
        metadata: meta,
        lineNumber,
      });
      return;
    }
    if (LEFT_ARROW_RE.test(trimmed)) {
      pushError(
        lineNumber,
        `Left-pointing arrows are not supported — write the edge from the other side (B -> A instead of A <- B)`
      );
      return;
    }
    warn(lineNumber, `Malformed edge "${trimmed}" — ignored`);
  };

  // ── Line loop ───────────────────────────────────────────────

  let firstLineConsumed = false;
  let contentStarted = false;
  let currentTagGroup: Writable<TagGroup> | null = null;
  const boxStack: Array<{ box: WritableBox; indent: number }> = [];
  /**
   * Pop every box this line has stepped back out of, then hand back the innermost
   * one still open — the box a shape or edge at this indent belongs to.
   * Replaces the old single-slot `currentBox`, which is what limited sketch to
   * one level (decision #58).
   */
  const boxAt = (
    indent: number
  ): { box: WritableBox; indent: number } | null => {
    while (
      boxStack.length > 0 &&
      indent <= boxStack[boxStack.length - 1]!.indent
    ) {
      boxStack.pop();
    }
    return boxStack[boxStack.length - 1] ?? null;
  };
  let currentShape: { id: string; indent: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineNumber = i + 1;
    const trimmed = raw.trim();

    if (!trimmed) {
      currentTagGroup = null;
      continue;
    }
    if (trimmed.startsWith('//')) continue;

    const indent = measureIndent(raw);

    // First line declares `sketch [Title]`.
    if (!firstLineConsumed) {
      firstLineConsumed = true;
      const firstLine = parseFirstLine(trimmed);
      if (firstLine?.chartType !== 'sketch') {
        let msg = `Expected chart type "sketch", got "${firstLine?.chartType ?? trimmed.split(/\s+/)[0]}"`;
        const hint = suggest(firstLine?.chartType ?? '', ['sketch']);
        if (hint) msg += `. ${hint}`;
        return fail(lineNumber, msg);
      }
      result.title = firstLine.title ?? null;
      result.titleLineNumber = lineNumber;
      continue;
    }

    // Tag group heading (header phase, indent 0).
    if (indent === 0) {
      const tagBlockMatch = matchTagBlockHeading(trimmed);
      if (tagBlockMatch) {
        if (contentStarted) {
          pushError(
            lineNumber,
            'Tag groups must appear before sketch content',
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
          tagAliasMap.set(
            tagBlockMatch.alias.toLowerCase(),
            tagAttrKey(tagBlockMatch.name)
          );
        }
        tagAliasMap.set(
          tagAttrKey(tagBlockMatch.name),
          tagAttrKey(tagBlockMatch.name)
        );
        if (tagBlockMatch.inlineValues) {
          for (const entry of tagBlockMatch.inlineValues) {
            const { text: cleanEntry, isDefault } = stripDefaultModifier(entry);
            const { label, color } = extractColor(
              cleanEntry,
              palette,
              result.diagnostics as DgmoError[],
              lineNumber
            );
            if (isDefault) currentTagGroup.defaultValue = label;
            currentTagGroup.entries.push({
              value: label,
              color: color ?? AUTO_TAG_COLOR_SENTINEL,
              // When a color resolved, the recognized name is the entry's last
              // token — keep it so a reparse can tell authored from auto.
              ...(color !== undefined && {
                authoredColor: cleanEntry.trim().split(/\s+/).pop()!,
              }),
              lineNumber,
            });
          }
        }
        result.tagGroups.push(currentTagGroup);
        continue;
      }
    }

    // Tag group entries (indented under the heading).
    if (currentTagGroup && indent > 0) {
      const { text: cleanEntry, isDefault } = stripDefaultModifier(trimmed);
      const { label, color } = extractColor(
        cleanEntry,
        palette,
        result.diagnostics as DgmoError[],
        lineNumber
      );
      if (isDefault) currentTagGroup.defaultValue = label;
      currentTagGroup.entries.push({
        value: label,
        color: color ?? AUTO_TAG_COLOR_SENTINEL,
        // When a color resolved, the recognized name is the entry's last token
        // — keep it so a reparse can tell authored from auto.
        ...(color !== undefined && {
          authoredColor: cleanEntry.trim().split(/\s+/).pop()!,
        }),
        lineNumber,
      });
      continue;
    }
    currentTagGroup = null;

    // Directives (indent 0).
    if (indent === 0 && /^legend-inline\s*$/i.test(trimmed)) {
      options.legendInline = true;
      continue;
    }
    if (indent === 0 && /^no-legend\s*$/i.test(trimmed)) {
      options.noLegend = true;
      continue;
    }
    if (indent === 0 && fillModeFromToken(trimmed) !== null) {
      const fm = fillModeFromToken(trimmed)!;
      options.fillMode = fm === 'tint' ? undefined : fm;
      continue;
    }
    if (indent === 0 && /^no-descriptions\s*$/i.test(trimmed)) {
      options.noDescriptions = true;
      continue;
    }

    // ── Content ─────────────────────────────────────────────
    contentStarted = true;

    // Description line — an indented `>` block under a shape. Markdown text;
    // preserve the content after `> ` verbatim (incl. its own leading spaces
    // for nested bullets). Multiple lines newline-join.
    if (trimmed.startsWith('>')) {
      const descLine = trimmed.slice(1).replace(/^ /, '');
      if (indent > 0 && currentShape && indent > currentShape.indent) {
        const node = nodeById.get(currentShape.id) as WritableNode | undefined;
        if (node) {
          node.description =
            node.description === undefined
              ? descLine
              : `${node.description}\n${descLine}`;
        }
      } else {
        warn(
          lineNumber,
          `Description "${trimmed}" has no shape — indent it under the shape it describes`
        );
      }
      continue;
    }

    // Edge line — attaches to the innermost open context.
    if (EDGE_START_RE.test(trimmed)) {
      if (indent > 0 && currentShape && indent > currentShape.indent) {
        addEdge(trimmed, lineNumber, currentShape.id);
      } else if (indent > 0 && boxAt(indent)) {
        addEdge(trimmed, lineNumber, boxAt(indent)!.box.id);
      } else {
        warn(
          lineNumber,
          `Edge "${trimmed}" has no source shape — indent it under the shape it leaves from`
        );
      }
      continue;
    }

    // Box line.
    const boxMatch = trimmed.match(BOX_RE);
    if (boxMatch) {
      const label = boxMatch[1]!.trim();
      if (!label) {
        warn(lineNumber, 'Box has no label — ignored');
        continue;
      }
      // Close any open boxes this line has stepped back out of.
      while (
        boxStack.length > 0 &&
        indent <= boxStack[boxStack.length - 1]!.indent
      ) {
        boxStack.pop();
      }
      const depth = boxStack.length + 1;
      if (depth > MAX_BOX_DEPTH) {
        // Deeper than the bound: diagnose and hang its shapes on the box above,
        // which is what the reader sees. Never silent — six producers write
        // sketch source (tech-spec-sketch-rebuild.md §2), so the grammar checks.
        pushError(
          lineNumber,
          `Box "${label}" is nested ${depth} levels deep — sketch boxes nest to depth ${MAX_BOX_DEPTH} (decision #58); its shapes join the box above it`,
          SKETCH_DIAGNOSTIC_CODES.BOX_DEPTH
        );
        continue;
      }
      const parent = boxStack[boxStack.length - 1] ?? null;
      const box = openBox(
        label,
        boxMatch[2] ?? '',
        lineNumber,
        parent ? parent.box.id : null
      );
      boxStack.push({ box, indent });
      currentShape = null;
      continue;
    }

    // Shape line.
    if (indent === 0) {
      boxStack.length = 0;
      const node = addShape(trimmed, lineNumber, null);
      currentShape = node ? { id: node.id, indent } : null;
      continue;
    }
    const owner = boxAt(indent);
    if (owner) {
      const node = addShape(trimmed, lineNumber, owner.box);
      currentShape = node ? { id: node.id, indent } : currentShape;
      continue;
    }
    // Indented shape with no box context — lenient: treat as a root shape.
    warn(
      lineNumber,
      `Indented line "${trimmed}" has no parent box — treated as a top-level shape`
    );
    const node = addShape(trimmed, lineNumber, null);
    currentShape = node ? { id: node.id, indent } : currentShape;
  }

  // ── Resolve edges (two-pass: forward references are legal) ──
  const allTargets = [
    ...aliasIndex.keys(),
    ...nodes.map((n) => n.label),
    ...boxes.map((b) => b.label),
  ];
  for (const pe of pendingEdges) {
    let targetId: string | null;
    const bracketMatch = pe.targetRaw.match(/^\[([^\]]*)\]$/);
    if (bracketMatch) {
      targetId = boxByNorm.get(normalizeName(bracketMatch[1]!))?.id ?? null;
    } else if (aliasIndex.has(pe.targetRaw)) {
      targetId = aliasIndex.get(pe.targetRaw)!;
    } else {
      const norm = normalizeName(stripQuotes(pe.targetRaw).trim());
      const labelHits = labelIndex.get(norm) ?? [];
      if (labelHits.length > 1) {
        pushError(
          pe.lineNumber,
          `Edge target "${pe.targetRaw}" matches more than one shape — give each duplicate an alias (as x) and target the alias`,
          SKETCH_DIAGNOSTIC_CODES.AMBIGUOUS_TARGET
        );
        continue;
      }
      targetId = labelHits[0] ?? boxByNorm.get(norm)?.id ?? null;
    }
    if (targetId === null) {
      let msg = `Unknown edge target "${pe.targetRaw}"`;
      const hint = suggest(pe.targetRaw, allTargets);
      if (hint) msg += `. ${hint}`;
      warn(pe.lineNumber, msg);
      continue;
    }
    if (targetId === pe.sourceId) {
      warn(pe.lineNumber, `Edge from "${pe.targetRaw}" to itself — ignored`);
      continue;
    }
    result.edges.push({
      sourceId: pe.sourceId,
      targetId,
      ...(pe.label !== undefined && { label: pe.label }),
      heads: pe.heads,
      dashed: pe.dashed,
      metadata: pe.metadata,
      lineNumber: pe.lineNumber,
    } satisfies SketchEdge);
  }

  // ── Tags: auto-colors → box cascade → defaults → validation ─
  finalizeAutoTagColors(result.tagGroups as Writable<TagGroup>[], palette);
  if (result.tagGroups.length > 0) {
    const tagKeys = result.tagGroups.map((g) => tagAttrKey(g.name));
    for (const box of boxes) {
      for (const childId of box.children) {
        const child = nodeById.get(childId);
        if (!child) continue;
        for (const k of tagKeys) {
          if (!(k in child.metadata) && box.metadata[k] !== undefined) {
            child.metadata[k] = box.metadata[k]!;
          }
        }
      }
    }
    injectDefaultTagMetadata(
      [...nodes, ...boxes],
      result.tagGroups as TagGroup[]
    );
    validateTagValues(
      [...nodes, ...boxes, ...(result.edges as Writable<SketchEdge>[])],
      result.tagGroups,
      (line, message) => warn(line, message),
      suggest
    );
    validateTagGroupNames(result.tagGroups, (line, message) =>
      warn(line, message)
    );
  }

  result.nodes = nodes;
  result.boxes = boxes;

  if (nodes.length === 0 && boxes.length === 0 && !result.error) {
    const diag = makeDgmoError(1, 'No shapes found in sketch');
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
  }

  return result;
}

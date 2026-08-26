// ============================================================
// Sketch diagram — emitter (scene → DGMO source)
// ============================================================
//
// The counterpart of `parseSketch`. It exists so that a canvas which AUTHORS a
// sketch has something to write with, and so that writing can be checked
// continuously rather than at the end of a build:
//
//     const src  = emitSketch(scene);
//     const back = parseSketch(src);
//     assert(sameSketch(scene, back));          // round-trip
//     assert(back.diagnostics.length === 0);    // emitter cleanliness
//
// See `_bmad-output/implementation-artifacts/tech-spec-sketch-rebuild.md` §8
// (the standing invariant) and §2 (the generator obligation this discharges:
// *the emitter never needs to produce a shape the parser would have to
// repair*).
//
// 🔴 This is the FAITHFUL emitter: it writes everything the parser can read,
// including constructs the rebuilt canvas will never author (`shape:`,
// `>` description lines, `collapsed`). That is deliberate and is what makes it
// testable — it round-trips the real corpus, not just canvas output. The
// canvas's emitter is a RESTRICTION of this one, not a different thing: emit
// from a scene that never carries those fields and they never appear.

import type { ParsedSketch, SketchBox, SketchEdge, SketchNode } from './types';

/** Metadata keys the parser lifts out of `metadata` and back onto the shape. */
const LIFTED_KEYS = new Set(['shape', 'at', 'as']);

function atText(at: { c: number; r: number } | null): string | null {
  return at ? `at: ${String(at.c)} ${String(at.r)}` : null;
}

/**
 * Same-line metadata is `key: value, key2: value2`, so a comma inside a value
 * silently truncates it and invents keys from the rest — the parse succeeds and
 * the picture is wrong. Never emit one.
 */
function safeValue(value: string): string {
  return value.includes(',') ? value.replace(/,/g, ' —') : value;
}

function tailFor(
  thing: { alias?: string; metadata: Record<string, string> },
  at: { c: number; r: number } | null,
  extra: readonly string[] = []
): string {
  // 🔴 `as <alias>` is a POSTFIX separated by a space, not another comma-joined
  // metadata item (§2A). Emitting `as pot, at: 2 0` makes the alias literally
  // `pot,`, it fails E_ALIAS_INVALID_FORMAT, and every edge naming it dangles.
  // Found by the standing invariant on its first run over the real corpus.
  const alias = thing.alias !== undefined ? ` as ${thing.alias}` : '';

  const parts: string[] = [];
  const atPart = atText(at);
  if (atPart) parts.push(atPart);
  for (const [k, v] of Object.entries(thing.metadata)) {
    if (LIFTED_KEYS.has(k)) continue;
    parts.push(`${k}: ${safeValue(v)}`);
  }
  parts.push(...extra);
  return `${alias}${parts.length > 0 ? ` ${parts.join(', ')}` : ''}`;
}

function shapeLine(node: SketchNode, indent: string): string[] {
  const extra: string[] = [];
  if (node.shape !== 'rectangle') extra.push(`shape: ${node.shape}`);
  const out = [`${indent}${node.label}${tailFor(node, node.at, extra)}`];
  if (node.description !== undefined && node.description !== '') {
    for (const line of node.description.split('\n')) {
      out.push(`${indent}  > ${line}`);
    }
  }
  return out;
}

function boxLine(box: SketchBox, indent: string): string {
  const extra = box.collapsed ? ['collapsed'] : [];
  return `${indent}[${box.label}]${tailFor(box, box.at, extra)}`;
}

/**
 * §31.4 — three head configurations, solid or dashed, six forms in all. There
 * is no source-head-only form: left-pointing arrows are banned language-wide,
 * so a canvas offering per-end toggles normalizes by swapping the ends before
 * it ever reaches here.
 */
function edgeText(edge: SketchEdge, target: string): string {
  const d = edge.dashed;
  const label = edge.label ?? '';
  if (label === '') {
    if (edge.heads === 'none') return `${d ? '~~' : '--'} ${target}`;
    if (edge.heads === 'both') return `${d ? '<~>' : '<->'} ${target}`;
    return `${d ? '~>' : '->'} ${target}`;
  }
  const l = safeValue(label);
  if (edge.heads === 'none')
    return `${d ? '~' : '-'}${l}${d ? '~' : '-'} ${target}`;
  if (edge.heads === 'both')
    return `${d ? '<~' : '<-'}${l}${d ? '~>' : '->'} ${target}`;
  return `${d ? '~' : '-'}${l}${d ? '~>' : '->'} ${target}`;
}

/**
 * Emit DGMO source for a parsed sketch.
 *
 * The output re-parses to an equivalent scene (`sameSketch`) and raises no
 * diagnostics. It is not pretty-printed: this is the correctness emitter, whose
 * only reader is the parser. Presentation — stable aliases, ordering,
 * whitespace — is a separate job.
 */
export function emitSketch(parsed: ParsedSketch): string {
  const lines: string[] = [];
  lines.push(parsed.title ? `sketch ${parsed.title}` : 'sketch');

  const o = parsed.options;
  if (o.noLegend) lines.push('no-legend');
  if (o.legendInline === true) lines.push('legend-inline');
  if (o.fillMode === 'solid') lines.push('fill-solid');
  if (o.fillMode === 'outline') lines.push('fill-outline');
  if (o.noDescriptions) lines.push('no-descriptions');

  for (const group of parsed.tagGroups) {
    lines.push('');
    lines.push(
      group.alias !== undefined
        ? `tag ${group.name} as ${group.alias}`
        : `tag ${group.name}`
    );
    for (const entry of group.entries) {
      const isDefault =
        group.defaultValue !== undefined && entry.value === group.defaultValue;
      lines.push(`  ${entry.value}${isDefault ? ' default' : ''}`);
    }
  }

  // A shape is reachable by alias if it has one, else by its label. Edges are
  // written under their source, which is how the parser reads them.
  const refOf = (id: string): string => {
    const node = parsed.nodes.find((n) => n.id === id);
    if (node) return node.alias ?? node.label;
    const box = parsed.boxes.find((b) => b.id === id);
    if (box) return box.alias ?? `[${box.label}]`;
    return id;
  };

  const edgesBySource = new Map<string, SketchEdge[]>();
  for (const edge of parsed.edges) {
    const list = edgesBySource.get(edge.sourceId);
    if (list) list.push(edge);
    else edgesBySource.set(edge.sourceId, [edge]);
  }

  const emitEdgesFor = (id: string, indent: string): void => {
    for (const edge of edgesBySource.get(id) ?? []) {
      lines.push(`${indent}${edgeText(edge, refOf(edge.targetId))}`);
    }
  };

  const nodesByBox = new Map<string, SketchNode[]>();
  const rootNodes: SketchNode[] = [];
  for (const node of parsed.nodes) {
    if (node.boxLabel === undefined) {
      rootNodes.push(node);
      continue;
    }
    const list = nodesByBox.get(node.boxLabel);
    if (list) list.push(node);
    else nodesByBox.set(node.boxLabel, [node]);
  }

  const emitBox = (box: SketchBox, depth: number): void => {
    const indent = '  '.repeat(depth);
    lines.push('');
    lines.push(boxLine(box, indent));
    emitEdgesFor(box.id, `${indent}  `);
    for (const node of nodesByBox.get(box.label) ?? []) {
      lines.push(...shapeLine(node, `${indent}  `));
      emitEdgesFor(node.id, `${indent}    `);
    }
    // Decision #58 — a box may hold boxes, to depth 2.
    for (const childId of box.childBoxes) {
      const child = parsed.boxes.find((b) => b.id === childId);
      if (child) emitBox(child, depth + 1);
    }
  };

  for (const node of rootNodes) {
    lines.push('');
    lines.push(...shapeLine(node, ''));
    emitEdgesFor(node.id, '  ');
  }

  for (const box of parsed.boxes) {
    if (box.parentBoxId !== null) continue; // emitted by its parent
    emitBox(box, 0);
  }

  return `${lines.join('\n')}\n`;
}

// ── Canonical comparison ────────────────────────────────────

interface CanonicalScene {
  title: string | null;
  options: string;
  tags: string;
  nodes: string[];
  boxes: string[];
  edges: string[];
}

/**
 * A scene reduced to what the PICTURE says, so two scenes that draw the same
 * thing compare equal. Ids and line numbers are dropped (they are parse
 * artifacts), sets are sorted (declaration order is not meaning), and edges are
 * keyed by resolved endpoint names rather than ids.
 */
export function canonicalSketch(parsed: ParsedSketch): CanonicalScene {
  const nameOf = (id: string): string => {
    const node = parsed.nodes.find((n) => n.id === id);
    if (node) return `n:${node.label}`;
    const box = parsed.boxes.find((b) => b.id === id);
    if (box) return `b:${box.label}`;
    return `?:${id}`;
  };
  const meta = (m: Record<string, string>): string =>
    Object.entries(m)
      .filter(([k]) => !LIFTED_KEYS.has(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(';');

  return {
    title: parsed.title,
    options: JSON.stringify({
      noLegend: parsed.options.noLegend,
      legendInline: parsed.options.legendInline === true,
      fillMode: parsed.options.fillMode ?? null,
      noDescriptions: parsed.options.noDescriptions,
    }),
    tags: parsed.tagGroups
      .map(
        (g) =>
          `${g.name}[${g.entries.map((e) => e.value).join('|')}]${g.defaultValue ?? ''}`
      )
      .sort()
      .join(','),
    nodes: parsed.nodes
      .map(
        (n) =>
          `${n.label}|${n.shape}|${n.at ? `${String(n.at.c)},${String(n.at.r)}` : '-'}|${n.boxLabel ?? '-'}|${n.description ?? ''}|${meta(n.metadata)}`
      )
      .sort(),
    boxes: parsed.boxes
      .map(
        (b) =>
          `${b.label}|${b.at ? `${String(b.at.c)},${String(b.at.r)}` : '-'}|${String(b.collapsed)}|${
            b.parentBoxId === null
              ? '-'
              : (parsed.boxes.find((x) => x.id === b.parentBoxId)?.label ?? '?')
          }|${meta(b.metadata)}`
      )
      .sort(),
    edges: parsed.edges
      .map(
        (e) =>
          `${nameOf(e.sourceId)}->${nameOf(e.targetId)}|${e.label ?? ''}|${e.heads}|${String(e.dashed)}`
      )
      .sort(),
  };
}

/** True when two parses describe the same picture. */
export function sameSketch(a: ParsedSketch, b: ParsedSketch): boolean {
  return (
    JSON.stringify(canonicalSketch(a)) === JSON.stringify(canonicalSketch(b))
  );
}

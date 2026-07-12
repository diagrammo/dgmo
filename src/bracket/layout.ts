// ============================================================
// Bracket chart — Layout
// ============================================================
//
// Turns the parsed match/seed/side lists into positioned match nodes.
//
// SEEDED mode: from the seed count build the standard single-elimination
// skeleton (recursive 1-vs-N seeding: top seeds bye, 3v6 / 4v5 pairings). Every
// slot is a node; `beats` results overwrite TBD winners and propagate upward.
//
// CASUAL mode: each `beats`/`vs` line is a node. A match "feeds" a later match
// when its winner reappears there; a match's round = 1 + the deepest feeding
// round. A competitor first seen at a later round has no feeder → a bye.
//
// Placement: round-1 matches take vertical slots top→bottom (source order);
// each parent sits at the mean y of its feeders (classic bracket midpoint).
// Two `[Side]` columns mirror around a center championship node.

import { makeDgmoError } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import { measureText } from '../utils/text-measure';
import type { ParsedBracket, RawMatch, RawSeed, RoundDef } from './types';

// ── Geometry (virtual coords; the renderer scales to fit) ────
export const BOX_W = 176;
export const BOX_H = 30;
/** Vertical gap between the two participant boxes of one match. */
export const PAIR_GAP = 8;
/** Center-to-center vertical spacing of adjacent round-1 matches. */
export const ROW = 82;
/** Center-to-center horizontal spacing of adjacent rounds. */
export const COL_W = 220;
/** Max width a commentary caption wraps to — a hair under the box width, so a
 *  wrapped line stays strictly inside its column band (never the connectors). */
export const COMMENT_W = BOX_W - 14;

const HALF_SPAN = (BOX_H + PAIR_GAP) / 2;

/** Drop inline-markdown markers so wrap widths match the RENDERED text. */
function stripInline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*|__|\*|_|`/g, '');
}

/** Greedy word-wrap `text` to `maxW` at font size `fs`. */
export function wrapText(text: string, maxW: number, fs: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const attempt = cur ? `${cur} ${w}` : w;
    // Measure without markers, with a small bold-safety factor.
    if (!cur || measureText(stripInline(attempt), fs) * 1.06 <= maxW)
      cur = attempt;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/** Total wrapped line count for a match's commentary. */
function commentaryLineCount(commentary: readonly string[]): number {
  return commentary.reduce((s, l) => s + wrapText(l, COMMENT_W, 11).length, 0);
}

export interface ConnectorPoint {
  readonly x: number;
  readonly y: number;
}

export interface LaidMatch {
  readonly round: number;
  readonly side: string | null;
  /** Center x of this match's two boxes. */
  readonly x: number;
  /** Center y between the two boxes. */
  readonly y: number;
  readonly top: string | null;
  readonly bot: string | null;
  readonly winner: 'top' | 'bot' | null;
  readonly score: string | null;
  /** Both participants known but undecided (`vs`). */
  readonly pending: boolean;
  readonly isChampionship: boolean;
  /** Origin point of the connector into the top box (child winner), or null. */
  readonly topFrom: ConnectorPoint | null;
  readonly botFrom: ConnectorPoint | null;
  /** Prose commentary lines rendered under the match. */
  readonly commentary: readonly string[];
  /** Explicit home competitor (`@ Name`), or null. */
  readonly home: string | null;
  readonly lineNumber: number | null;
}

export interface ColumnLabel {
  readonly x: number;
  readonly label: string;
  /** Round color — tints the label and shades the column. */
  readonly color?: string;
}

export interface BracketLayout {
  readonly matches: readonly LaidMatch[];
  readonly columns: readonly ColumnLabel[];
  readonly sideLabels: readonly {
    x0: number;
    x1: number;
    label: string;
    color?: string;
  }[];
  readonly width: number;
  readonly height: number;
  readonly champion: string | null;
  readonly diagnostics: readonly DgmoError[];
}

// ── Internal mutable node ────────────────────────────────────
interface Node {
  id: number;
  round: number;
  side: string | null;
  topSeedName: string | null;
  botSeedName: string | null;
  topChildId: number | null;
  botChildId: number | null;
  // Resolved participant names (null = TBD / not-yet-known).
  topName: string | null;
  botName: string | null;
  winner: 'top' | 'bot' | null;
  score: string | null;
  commentary: string[];
  homeName: string | null;
  lineNumber: number | null;
  isChampionship: boolean;
  y: number; // slot units, set by positioning
  x: number; // absolute px, set by assembly
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return Math.max(2, p);
}

/** Standard single-elim seeding order for a bracket of size B (power of 2). */
function seedOrder(b: number): number[] {
  let order = [1];
  while (order.length < b) {
    const n = order.length * 2;
    const next: number[] = [];
    for (const s of order) {
      next.push(s);
      next.push(n + 1 - s);
    }
    order = next;
  }
  return order;
}

// ============================================================
// Name resolution + result application
// ============================================================

function winnerNameOf(n: Node): string | null {
  if (n.winner === 'top') return n.topName;
  if (n.winner === 'bot') return n.botName;
  return null;
}

/** Recompute every node's participant names from its children (round-ascending). */
function resolveNames(nodes: Node[]): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ordered = [...nodes].sort((a, b) => a.round - b.round);
  for (const n of ordered) {
    const tc = n.topChildId !== null ? byId.get(n.topChildId) : undefined;
    const bc = n.botChildId !== null ? byId.get(n.botChildId) : undefined;
    n.topName = tc ? winnerNameOf(tc) : n.topSeedName;
    n.botName = bc ? winnerNameOf(bc) : n.botSeedName;
  }
}

/** Apply decided results to a side's nodes, resolving out-of-order lines. */
function applyResults(
  nodes: Node[],
  results: RawMatch[],
  diagnostics: DgmoError[]
): void {
  const pending = results.filter((r) => r.decided);
  const done = new Set<RawMatch>();
  // Fixpoint: a round-2 result can't resolve until its round-1 feeders do.
  for (let guard = 0; guard < pending.length + 2; guard++) {
    resolveNames(nodes);
    let progressed = false;
    for (const r of pending) {
      if (done.has(r)) continue;
      const node = [...nodes]
        .sort((a, b) => a.round - b.round)
        .find(
          (n) =>
            n.winner === null &&
            ((n.topName === r.p1 && n.botName === r.p2) ||
              (n.topName === r.p2 && n.botName === r.p1))
        );
      if (node) {
        node.winner = node.topName === r.p1 ? 'top' : 'bot';
        node.score = r.score;
        node.commentary = [...r.commentary];
        node.homeName = r.home;
        done.add(r);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  resolveNames(nodes);
  for (const r of pending) {
    if (!done.has(r)) {
      diagnostics.push(
        makeDgmoError(
          r.lineNumber,
          `No open matchup between "${r.p1}" and "${r.p2}" — check the seeding or earlier results.`,
          'warning'
        )
      );
    }
  }
  // Pending (`vs`) lines create no seeded node; note the unmatched ones softly.
  for (const r of results) {
    if (r.decided) continue;
    const has = nodes.some(
      (n) =>
        (n.topName === r.p1 && n.botName === r.p2) ||
        (n.topName === r.p2 && n.botName === r.p1)
    );
    if (!has) {
      diagnostics.push(
        makeDgmoError(
          r.lineNumber,
          `Pending matchup "${r.p1} vs ${r.p2}" doesn't line up with the seeded bracket.`,
          'warning'
        )
      );
    }
  }
}

// ============================================================
// Seeded builder — one side
// ============================================================

interface BuiltSide {
  nodes: Node[];
  rootId: number | null;
  rounds: number;
}

function buildSeededSide(
  seeds: RawSeed[],
  results: RawMatch[],
  side: string | null,
  nextId: () => number,
  diagnostics: DgmoError[]
): BuiltSide {
  const seedByNum = new Map<number, string>();
  for (const s of seeds)
    if (!seedByNum.has(s.seed)) seedByNum.set(s.seed, s.name);
  const n = seeds.length;
  const nodes: Node[] = [];
  if (n < 2) {
    // Degenerate: 0-1 seeds. Still apply any results as a single ladder.
    return buildCasualSide(results, side, nextId, diagnostics);
  }
  const b = nextPow2(n);
  const order = seedOrder(b);

  type Carrier =
    | { kind: 'seed'; seedNo: number; name: string | null; phantom: boolean }
    | { kind: 'match'; id: number };

  let level: Carrier[] = order.map((seedNo) => ({
    kind: 'seed' as const,
    seedNo,
    name: seedNo <= n ? (seedByNum.get(seedNo) ?? null) : null,
    phantom: seedNo > n,
  }));

  const carrierName = (c: Carrier): string | null =>
    c.kind === 'seed' ? c.name : null;
  const carrierChild = (c: Carrier): number | null =>
    c.kind === 'match' ? c.id : null;

  let round = 1;
  while (level.length > 1) {
    const next: Carrier[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]!;
      const bb = level[i + 1]!;
      const aPhantom = a.kind === 'seed' && a.phantom;
      const bPhantom = bb.kind === 'seed' && bb.phantom;
      if (aPhantom && !bPhantom) {
        next.push(bb); // bye: promote unchanged
      } else if (bPhantom && !aPhantom) {
        next.push(a);
      } else if (aPhantom && bPhantom) {
        next.push(a); // both phantom — degenerate; keep something
      } else {
        const id = nextId();
        nodes[id] = {
          id,
          round,
          side,
          topSeedName: carrierName(a),
          botSeedName: carrierName(bb),
          topChildId: carrierChild(a),
          botChildId: carrierChild(bb),
          topName: null,
          botName: null,
          winner: null,
          score: null,
          commentary: [],
          homeName: null,
          lineNumber: null,
          isChampionship: false,
          y: 0,
          x: 0,
        };
        next.push({ kind: 'match', id });
      }
    }
    level = next;
    round++;
  }

  const rootId = level[0]?.kind === 'match' ? level[0].id : null;
  const compact = nodes.filter(Boolean);
  applyResults(compact, results, diagnostics);
  const rounds = compact.reduce((m, x) => Math.max(m, x.round), 0);
  return { nodes: compact, rootId, rounds };
}

// ============================================================
// Casual builder — one side (or single ladder)
// ============================================================

function buildCasualSide(
  matches: RawMatch[],
  side: string | null,
  nextId: () => number,
  diagnostics: DgmoError[]
): BuiltSide {
  // One node per match, indexed by position in this side's list.
  const nodes: Node[] = matches.map((m) => {
    const id = nextId();
    return {
      id,
      round: 1,
      side,
      topSeedName: m.p1,
      botSeedName: m.p2,
      topChildId: null,
      botChildId: null,
      topName: m.p1,
      botName: m.p2,
      winner: m.decided ? ('top' as const) : null,
      score: m.score,
      commentary: [...m.commentary],
      homeName: m.home,
      lineNumber: m.lineNumber,
      isChampionship: false,
      y: 0,
      x: 0,
    };
  });

  const winnerOf = (idx: number): string | null =>
    matches[idx]!.decided ? matches[idx]!.p1 : null;

  // feeder(p, idx) = the most-recent EARLIER decided match won by p (a
  // competitor advancing). Backward-only: a later win can't feed an earlier
  // match, and searching forward would wrongly wire the final as a round-1 feeder.
  const feeder = (p: string, idx: number): number | null => {
    for (let j = idx - 1; j >= 0; j--) {
      if (winnerOf(j) === p) return j;
    }
    return null;
  };

  // Wire children (local indices → node ids share the same order here).
  const baseId = nodes.length ? nodes[0]!.id : 0;
  for (let idx = 0; idx < matches.length; idx++) {
    const m = matches[idx]!;
    const tf = feeder(m.p1, idx);
    const bf = feeder(m.p2, idx);
    nodes[idx]!.topChildId = tf !== null ? baseId + tf : null;
    nodes[idx]!.botChildId = bf !== null ? baseId + bf : null;
  }

  // Round = 1 + deepest feeder round (memoized, cycle-guarded).
  const roundMemo = new Array<number>(matches.length).fill(0);
  const inProgress = new Set<number>();
  const roundOf = (idx: number): number => {
    if (roundMemo[idx]) return roundMemo[idx]!;
    if (inProgress.has(idx)) return 1;
    inProgress.add(idx);
    const m = matches[idx]!;
    const rs: number[] = [];
    const tf = feeder(m.p1, idx);
    const bf = feeder(m.p2, idx);
    if (tf !== null) rs.push(roundOf(tf));
    if (bf !== null) rs.push(roundOf(bf));
    inProgress.delete(idx);
    const r = rs.length ? 1 + Math.max(...rs) : 1;
    roundMemo[idx] = r;
    return r;
  };
  for (let idx = 0; idx < matches.length; idx++)
    nodes[idx]!.round = roundOf(idx);

  // Ambiguous advancement: a winner feeding two later matches.
  const winnerFutureCount = new Map<string, number>();
  for (let idx = 0; idx < matches.length; idx++) {
    const w = winnerOf(idx);
    if (!w) continue;
    let count = 0;
    for (let j = 0; j < matches.length; j++) {
      if (j === idx) continue;
      if (matches[j]!.p1 === w || matches[j]!.p2 === w) count++;
    }
    if (count > 1) winnerFutureCount.set(w, count);
  }
  for (const [w] of winnerFutureCount) {
    const first = matches.findIndex((_, i) => winnerOf(i) === w);
    diagnostics.push(
      makeDgmoError(
        matches[first]?.lineNumber ?? 1,
        `"${w}" advances into more than one later match — using the first in source order.`,
        'warning'
      )
    );
  }

  // Roots = nodes not used as a child by any other node in this side.
  const childIds = new Set<number>();
  for (const nd of nodes) {
    if (nd.topChildId !== null) childIds.add(nd.topChildId);
    if (nd.botChildId !== null) childIds.add(nd.botChildId);
  }
  const roots = nodes.filter((nd) => !childIds.has(nd.id));
  // Single ladder root = the deepest-round root (the final).
  roots.sort((a, b) => b.round - a.round || a.id - b.id);
  const rootId = roots.length ? roots[0]!.id : null;
  const rounds = nodes.reduce((m, x) => Math.max(m, x.round), 0);
  return { nodes, rootId, rounds };
}

// ============================================================
// Positioning (slot assignment) — shared by both builders
// ============================================================

function positionSide(built: BuiltSide): void {
  const byId = new Map(built.nodes.map((n) => [n.id, n]));
  let slot = 0;
  const place = (id: number): number => {
    const n = byId.get(id)!;
    const ys: number[] = [];
    ys.push(n.topChildId !== null ? place(n.topChildId) : slot++);
    ys.push(n.botChildId !== null ? place(n.botChildId) : slot++);
    n.y = mean(ys);
    return n.y;
  };
  // Place all roots (a well-formed side has one; casual ladders may have more).
  const childIds = new Set<number>();
  for (const n of built.nodes) {
    if (n.topChildId !== null) childIds.add(n.topChildId);
    if (n.botChildId !== null) childIds.add(n.botChildId);
  }
  const roots = built.nodes
    .filter((n) => !childIds.has(n.id))
    .sort((a, b) => a.id - b.id);
  for (const r of roots) place(r.id);
}

// ============================================================
// Round-label helpers
// ============================================================

function roundLabel(
  r: number,
  rounds: number,
  defs: readonly RoundDef[],
  twoSide: boolean
): { label: string; color?: string } {
  const d = defs[r - 1];
  if (d)
    return d.color !== undefined
      ? { label: d.name, color: d.color }
      : { label: d.name };
  if (!twoSide && r === rounds) return { label: 'Final' };
  return { label: `Round ${r}` };
}

// ============================================================
// Assembly — place sides, mirror, add championship, emit
// ============================================================

export function layoutBracket(parsed: ParsedBracket): BracketLayout {
  const diagnostics: DgmoError[] = [...parsed.diagnostics];
  let idCounter = 0;
  const nextId = (): number => idCounter++;

  const groups: { label: string | null; color?: string; built: BuiltSide }[] =
    [];

  const buildFor = (label: string | null, color: string | undefined): void => {
    const sideSeeds = parsed.seeds.filter((s) => s.side === label);
    const sideMatches = parsed.matches.filter((m) => m.side === label);
    const built = parsed.seeded
      ? buildSeededSide(sideSeeds, sideMatches, label, nextId, diagnostics)
      : buildCasualSide(sideMatches, label, nextId, diagnostics);
    positionSide(built);
    groups.push(
      color !== undefined ? { label, color, built } : { label, built }
    );
  };

  if (parsed.sides.length === 0) {
    buildFor(null, undefined);
  } else {
    for (const s of parsed.sides) buildFor(s.label, s.color);
  }

  // Championship results: indent-0 lines when sides exist.
  const champResults = parsed.matches.filter(
    (m) => m.side === null && parsed.sides.length >= 1
  );

  const twoSide = groups.length === 2;
  const allNodes: Node[] = [];
  const nodeById = new Map<number, Node>();
  const columnLabels: ColumnLabel[] = [];
  const sideLabelOut: {
    x0: number;
    x1: number;
    label: string;
    color?: string;
  }[] = [];
  const pushSide = (
    x0: number,
    x1: number,
    label: string,
    color: string | undefined
  ): void => {
    sideLabelOut.push(
      color !== undefined ? { x0, x1, label, color } : { x0, x1, label }
    );
  };
  const seenColX = new Set<number>();

  const addColLabel = (
    x: number,
    rl: { label: string; color?: string }
  ): void => {
    if (parsed.noRounds) return;
    if (seenColX.has(x)) return;
    seenColX.add(x);
    columnLabels.push(
      rl.color !== undefined
        ? { x, label: rl.label, color: rl.color }
        : { x, label: rl.label }
    );
  };

  let champion: string | null = null;

  // Row spacing grows to fit commentary so captions never overlap the next
  // match. A match's own footprint is its two boxes; commentary sits below.
  const maxComment = Math.max(
    0,
    ...groups.flatMap((g) =>
      g.built.nodes.map((n) => commentaryLineCount(n.commentary))
    )
  );
  const COMMENT_LH = 15;
  const rowScale =
    maxComment > 0
      ? Math.max(ROW, 2 * BOX_H + PAIR_GAP + maxComment * COMMENT_LH + 16)
      : ROW;

  if (!twoSide) {
    // Stack sides vertically (single ladder = one group). No mirroring.
    let yOffset = 0;
    for (const g of groups) {
      const rounds = g.built.rounds;
      for (const n of g.built.nodes) {
        n.x = (n.round - 1) * COL_W + BOX_W / 2;
        n.y = n.y * rowScale + yOffset;
        allNodes.push(n);
        nodeById.set(n.id, n);
        addColLabel(n.x, roundLabel(n.round, rounds, parsed.roundNames, false));
      }
      if (g.label) {
        pushSide(0, (rounds - 1) * COL_W + BOX_W, g.label, g.color);
      }
      const slotSpan = Math.max(0, ...g.built.nodes.map((n) => n.y)) + rowScale; // px already
      yOffset = slotSpan + rowScale;
    }
    // Champion = deepest root winner across groups.
    const rootWinners = groups
      .map((g) =>
        g.built.rootId !== null ? nodeById.get(g.built.rootId) : null
      )
      .filter(Boolean) as Node[];
    if (rootWinners.length) {
      const finalNode = rootWinners.sort((a, b) => b.round - a.round)[0]!;
      champion = winnerNameOf(finalNode);
    }
  } else {
    const left = groups[0]!;
    const right = groups[1]!;
    const L = left.built.rounds;
    const R = right.built.rounds;
    const centerX = L * COL_W + BOX_W / 2;

    for (const n of left.built.nodes) {
      n.x = (n.round - 1) * COL_W + BOX_W / 2;
      n.y = n.y * rowScale;
      allNodes.push(n);
      nodeById.set(n.id, n);
      addColLabel(n.x, roundLabel(n.round, L, parsed.roundNames, true));
    }
    for (const n of right.built.nodes) {
      // Mirror: round 1 is farthest right, the final nearest center.
      n.x = centerX + (R - n.round + 1) * COL_W;
      n.y = n.y * rowScale;
      allNodes.push(n);
      nodeById.set(n.id, n);
      addColLabel(n.x, roundLabel(n.round, R, parsed.roundNames, true));
    }

    // Side bars span each half's columns (entry round → the side final).
    if (left.label)
      pushSide(0, (L - 1) * COL_W + BOX_W, left.label, left.color);
    if (right.label)
      pushSide(
        centerX + COL_W - BOX_W / 2,
        centerX + R * COL_W + BOX_W / 2,
        right.label,
        right.color
      );

    // Championship node links the two side finals.
    const leftRoot =
      left.built.rootId !== null ? nodeById.get(left.built.rootId)! : null;
    const rightRoot =
      right.built.rootId !== null ? nodeById.get(right.built.rootId)! : null;
    const cid = nextId();
    const champNode: Node = {
      id: cid,
      round: 0,
      side: null,
      topSeedName: null,
      botSeedName: null,
      topChildId: leftRoot ? leftRoot.id : null,
      botChildId: rightRoot ? rightRoot.id : null,
      topName: leftRoot ? winnerNameOf(leftRoot) : null,
      botName: rightRoot ? winnerNameOf(rightRoot) : null,
      winner: null,
      score: null,
      commentary: [],
      homeName: null,
      lineNumber: null,
      isChampionship: true,
      x: centerX,
      y: mean([leftRoot?.y ?? 0, rightRoot?.y ?? 0]),
    };
    // Apply the championship result.
    for (const r of champResults) {
      if (!r.decided) continue;
      if (champNode.topName === r.p1 && champNode.botName === r.p2) {
        champNode.winner = 'top';
        champNode.score = r.score;
        champNode.commentary = [...r.commentary];
        champNode.homeName = r.home;
      } else if (champNode.topName === r.p2 && champNode.botName === r.p1) {
        champNode.winner = 'bot';
        champNode.score = r.score;
        champNode.commentary = [...r.commentary];
        champNode.homeName = r.home;
      }
    }
    allNodes.push(champNode);
    nodeById.set(cid, champNode);
    // The center column is a distinct round — take the round def AFTER the
    // per-side rounds if the author supplied one, else fall back to the title.
    const centerDef = parsed.roundNames[L];
    addColLabel(
      centerX,
      centerDef
        ? centerDef.color !== undefined
          ? { label: centerDef.name, color: centerDef.color }
          : { label: centerDef.name }
        : { label: parsed.title ?? 'Final' }
    );
    champion = winnerNameOf(champNode);
  }

  // ── Emit LaidMatch list with connector origins ──
  const half = HALF_SPAN;
  const winnerBoxCy = (n: Node): number => {
    if (n.winner === 'bot') return n.y + half;
    if (n.winner === 'top') return n.y - half;
    return n.y;
  };
  const matches: LaidMatch[] = allNodes.map((n) => {
    const topChild = n.topChildId !== null ? nodeById.get(n.topChildId) : null;
    const botChild = n.botChildId !== null ? nodeById.get(n.botChildId) : null;
    return {
      round: n.round,
      side: n.side,
      x: n.x,
      y: n.y,
      top: n.topName,
      bot: n.botName,
      winner: n.winner,
      score: n.score,
      pending: n.winner === null && n.topName !== null && n.botName !== null,
      isChampionship: n.isChampionship,
      topFrom: topChild ? { x: topChild.x, y: winnerBoxCy(topChild) } : null,
      botFrom: botChild ? { x: botChild.x, y: winnerBoxCy(botChild) } : null,
      commentary: n.commentary,
      home: n.homeName,
      lineNumber: n.lineNumber,
    };
  });

  // ── Bounds ──
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const m of matches) {
    minX = Math.min(minX, m.x - BOX_W / 2);
    maxX = Math.max(maxX, m.x + BOX_W / 2);
    minY = Math.min(minY, m.y - half - BOX_H / 2);
    maxY = Math.max(maxY, m.y + half + BOX_H / 2);
    // Commentary extends right of (and below) the box — include it so the
    // scale-to-fit accounts for the caption instead of clipping it off-canvas.
    if (m.commentary.length) {
      const commentX = m.x - BOX_W / 2 + 2;
      maxX = Math.max(maxX, commentX + COMMENT_W);
      const wl = commentaryLineCount(m.commentary);
      maxY = Math.max(
        maxY,
        m.y + half + BOX_H / 2 + 13 + (wl - 1) * COMMENT_LH + 4
      );
    }
  }
  // Side bars extend a few px past the outer columns — keep them in bounds.
  for (const s of sideLabelOut) {
    minX = Math.min(minX, s.x0 - 8);
    maxX = Math.max(maxX, s.x1 + 8);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = BOX_W;
    minY = 0;
    maxY = BOX_H;
  }

  // Top region: an optional side-bar band, then the round-title band (with
  // breathing room above the titles), then the boxes.
  const SIDE_BAR = sideLabelOut.length ? 30 : 0;
  const LABEL_BAND = columnLabels.length ? 30 : 0;
  const topBand = SIDE_BAR + LABEL_BAND;

  // Shift everything into a >=0 box, leaving room for the top label band.
  const shiftX = -minX;
  const shiftY = -minY + topBand;
  const shifted: LaidMatch[] = matches.map((m) => ({
    ...m,
    x: m.x + shiftX,
    y: m.y + shiftY,
    topFrom: m.topFrom
      ? { x: m.topFrom.x + shiftX, y: m.topFrom.y + shiftY }
      : null,
    botFrom: m.botFrom
      ? { x: m.botFrom.x + shiftX, y: m.botFrom.y + shiftY }
      : null,
  }));
  const shiftedCols = columnLabels.map((c) => ({ ...c, x: c.x + shiftX }));
  const shiftedSides = sideLabelOut.map((s) => ({
    ...s,
    x0: s.x0 + shiftX,
    x1: s.x1 + shiftX,
  }));

  return {
    matches: shifted,
    columns: shiftedCols,
    sideLabels: shiftedSides,
    width: maxX - minX,
    height: maxY - minY + topBand,
    champion,
    diagnostics,
  };
}

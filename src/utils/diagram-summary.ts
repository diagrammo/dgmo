// ============================================================
// Diagram summaries — the root <svg>'s <desc>
// ============================================================
//
// The root `aria-label` names the diagram; this says what it SHOWS, in one or
// two sentences a screen reader reads after the name. Built from the parsed
// model, never the SVG: the SVG holds positions and paint, and reading meaning
// back out of it is how a summary goes wrong in silence.
//
// One summarizer per chart type, required by the table's type: a generic
// sentence that says nothing is not a summary (diagrammo/diagrammo#954).

import { parseArc } from '../arc/parser';
import { parseBlock } from '../block/parser';
import type { BlockGrid } from '../block/types';
import { isBlockNode } from '../block/types';
import { parseClock } from '../clock/parser';
import { parseCountdown } from '../countdown/parser';
import type { RecurRule } from '../countdown/resolve';
import { parseCycle } from '../cycle/parser';
import {
  parseFunctionChart,
  parseFunnel,
  parseHeatmap,
  parseSankey,
  parseScatter,
} from '../data-chart-parser';
import { parseEventLine } from '../event-line/parser';
import { parseGoal } from '../goal/parser';
import { parseMap } from '../map/parser';
import type { PoiPos } from '../map/types';
import { parsePyramid } from '../pyramid/parser';
import { parseQuadrant } from '../quadrant/parser';
import { parseRing } from '../ring/parser';
import { parseSlope } from '../slope/parser';
import { parseTechRadar } from '../tech-radar/parser';
import { parseTimelineDate } from '../timeline/parser';
import { parseTimeline } from '../timeline/viz-parser';
import { parseTreemap } from '../treemap/parser';
import type { TreemapNode } from '../treemap/types';
import { parseVenn } from '../venn/parser';
import { parseWordcloud } from '../wordcloud/parser';
import { parseBody } from '../body/parser';
import { parseBoxesAndLines } from '../boxes-and-lines/parser';
import { layoutBracket } from '../bracket/layout';
import { parseBracket } from '../bracket/parser';
import { parseC4 } from '../c4/parser';
import type { C4Element } from '../c4/types';
import { parseChart } from '../chart';
import type { ParsedChart } from '../chart';
import type { ChartTypeId } from '../chart-types';
import { parseClassDiagram } from '../class/parser';
import { parseERDiagram } from '../er/parser';
import { parseFamily } from '../family/parser';
import { parseGantt } from '../gantt/parser';
import type { GanttNode } from '../gantt/types';
import { parseFlowchart } from '../graph/flowchart-parser';
import { parseState } from '../graph/state-parser';
import { parseInfra } from '../infra/parser';
import { parseJourneyMap } from '../journey-map/parser';
import { parseKanban } from '../kanban/parser';
import { parseLiveLink } from '../live-link/parser';
import { parseMindmap } from '../mindmap/parser';
import type { MindmapNode } from '../mindmap/types';
import { parseOrg } from '../org/parser';
import type { OrgNode } from '../org/parser';
import { parsePert } from '../pert/parser';
import { parseRaci } from '../raci/parser';
import { parseSequenceDgmo } from '../sequence/parser';
import { parseSitemap } from '../sitemap/parser';
import type { SitemapNode } from '../sitemap/types';
import { parseSketch } from '../sketch/parser';
import { parseWhiteboard } from '../whiteboard/parser';
import { parseSwimlane } from '../swimlane/parser';
import { parseVersionControl } from '../version-control/parser';
import { parseWireframe } from '../wireframe/parser';
import { compactNumber } from './number-format';

type Summarizer = (content: string) => string | null;

/** How many names a summary lists before it says "and N more". */
const MAX_NAMES = 5;

/** `A`, `A and B`, `A, B and C`, `A, B, C, D, E and 3 more` — never
 *  "and 1 more", which costs as much as the name it hides. */
function listNames(names: readonly string[]): string {
  const shown =
    names.length > MAX_NAMES + 1 ? names.slice(0, MAX_NAMES) : names.slice();
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
  if (shown.length <= 1) return shown.join('');
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** `Polar area chart` from `polar-area`. */
function chartNoun(type: string): string {
  const words = type.replace(/-/g, ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} chart`;
}

/** Every plotted value: the first series, then each extra series' values. */
function allValues(parsed: ParsedChart): number[] {
  return parsed.data.flatMap((d) => [d.value, ...(d.extraValues ?? [])]);
}

function seriesNames(parsed: ParsedChart): string[] {
  if (parsed.seriesNames && parsed.seriesNames.length > 0) {
    return parsed.seriesNames;
  }
  return parsed.series ? [parsed.series] : [];
}

/** `of Revenue` / `of 2 series, A and B` / `` when nothing names the data. */
function seriesPhrase(parsed: ParsedChart): string {
  const names = seriesNames(parsed);
  if (names.length > 1) {
    return ` of ${plural(names.length, 'series', 'series')}, ${listNames(names)},`;
  }
  const one = names[0] ?? parsed.ylabel;
  return one ? ` of ${one}` : '';
}

function rangePhrase(values: readonly number[]): string {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi
    ? `every value is ${compactNumber(lo)}`
    : `values range from ${compactNumber(lo)} to ${compactNumber(hi)}`;
}

function summarizeChart(content: string): string | null {
  const parsed = parseChart(content);
  if (parsed.error) return null;
  const noun = chartNoun(parsed.type);
  const points = parsed.data;
  if (points.length === 0) return `${noun} with no data.`;

  switch (parsed.type) {
    case 'pie':
    case 'polar-area': {
      const total = points.reduce((sum, d) => sum + d.value, 0);
      const parts = plural(
        points.length,
        parsed.type === 'pie' ? 'slice' : 'wedge',
        parsed.type === 'pie' ? 'slices' : 'wedges'
      );
      const largest = points.reduce((a, b) => (b.value > a.value ? b : a));
      if (total <= 0) return `${noun} with ${parts}, all zero.`;
      const pct = Math.round((largest.value / total) * 100);
      return `${noun} with ${parts} totalling ${compactNumber(total)}; the largest is ${largest.label} at ${pct}%.`;
    }
    case 'radar':
      return `${noun}${seriesPhrase(parsed)} across ${plural(points.length, 'axis', 'axes')}; ${rangePhrase(allValues(parsed))}.`;
    case 'line': {
      const first = points[0]!.label;
      const last = points[points.length - 1]!.label;
      const span =
        points.length === 1 ? `at ${first}` : `from ${first} to ${last}`;
      return `${noun}${seriesPhrase(parsed)} over ${plural(points.length, 'point', 'points')}, ${span}; ${rangePhrase(allValues(parsed))}.`;
    }
    case 'bar': {
      const head = `${noun}${seriesPhrase(parsed)} for ${plural(points.length, 'category', 'categories')}`;
      if (seriesNames(parsed).length > 1 || points.length === 1) {
        return `${head}; ${rangePhrase(allValues(parsed))}.`;
      }
      const lo = points.reduce((a, b) => (b.value < a.value ? b : a));
      const hi = points.reduce((a, b) => (b.value > a.value ? b : a));
      return `${head}, from ${lo.label} at ${compactNumber(lo.value)} to ${hi.label} at ${compactNumber(hi.value)}.`;
    }
  }
}

function summarizeSequence(content: string): string | null {
  const parsed = parseSequenceDgmo(content);
  if (parsed.error) return null;
  const names = parsed.participants.map((p) => p.label);
  if (names.length === 0) return 'Sequence diagram with no participants.';
  const messages = parsed.messages.length;
  const exchange =
    messages === 0
      ? 'with no messages'
      : `exchanging ${plural(messages, 'message', 'messages')}`;
  return `Sequence diagram of ${plural(names.length, 'participant', 'participants')}, ${listNames(names)}, ${exchange}.`;
}

/** Non-container nodes under (and including) each of `nodes`. */
function countPeople(nodes: readonly OrgNode[]): number {
  return nodes.reduce(
    (n, node) => n + (node.isContainer ? 0 : 1) + countPeople(node.children),
    0
  );
}

function summarizeOrg(content: string): string | null {
  const parsed = parseOrg(content);
  if (parsed.error) return null;
  const people = countPeople(parsed.roots);
  if (parsed.roots.length === 0) return 'Org chart with no one in it.';
  const head = `Org chart of ${plural(people, 'person', 'people')}`;
  if (parsed.roots.length === 1) {
    const root = parsed.roots[0]!;
    const role = root.metadata['role'];
    return `${head}, headed by ${root.label}${role ? ` (${role})` : ''}.`;
  }
  const tops = parsed.roots.map((r) => r.label);
  return `${head} under ${plural(tops.length, 'top-level entry', 'top-level entries')}, ${listNames(tops)}.`;
}

/** Every node in a tree, counted through `children`. */
function countTree(nodes: readonly { children: readonly unknown[] }[]): number {
  return nodes.reduce(
    (n, node) =>
      n +
      1 +
      countTree(node.children as readonly { children: readonly unknown[] }[]),
    0
  );
}

/** `of 3 kinds, A, B and C` — the count, then the names. */
function namedCount(
  names: readonly string[],
  one: string,
  many: string
): string {
  return names.length === 0
    ? `no ${many}`
    : `${plural(names.length, one, many)}, ${listNames(names)}`;
}

function summarizeFlowchart(content: string): string | null {
  const parsed = parseFlowchart(content);
  if (parsed.error) return null;
  if (parsed.nodes.length === 0) return 'Flowchart with no steps.';
  const decisions = parsed.nodes.filter((n) => n.shape === 'decision').length;
  const steps = `${plural(parsed.nodes.length, 'step', 'steps')}${decisions > 0 ? ` (${plural(decisions, 'decision', 'decisions')})` : ''}`;
  // Where the flow starts is a step nothing leads into — not the first one
  // written, which a source may put anywhere. A flow that is all loop has none.
  const entered = new Set(parsed.edges.map((e) => e.target));
  const starts = parsed.nodes
    .filter((n) => !entered.has(n.id))
    .map((n) => n.label);
  const start = starts.length > 0 ? `, starting at ${listNames(starts)}` : '';
  return `Flowchart of ${steps} and ${plural(parsed.edges.length, 'connection', 'connections')}${start}.`;
}

function summarizeState(content: string): string | null {
  const parsed = parseState(content);
  if (parsed.error) return null;
  const states = parsed.nodes
    .filter((n) => n.shape !== 'pseudostate')
    .map((n) => n.label);
  return `State diagram of ${namedCount(states, 'state', 'states')}, with ${plural(parsed.edges.length, 'transition', 'transitions')}.`;
}

function summarizeClass(content: string): string | null {
  const parsed = parseClassDiagram(content);
  if (parsed.error) return null;
  const names = parsed.classes.map((c) => c.name);
  return `Class diagram of ${namedCount(names, 'class', 'classes')}, with ${plural(parsed.relationships.length, 'relationship', 'relationships')}.`;
}

function summarizeEr(content: string): string | null {
  const parsed = parseERDiagram(content);
  if (parsed.error) return null;
  const names = parsed.tables.map((t) => t.name);
  return `Entity-relationship diagram of ${namedCount(names, 'table', 'tables')}, with ${plural(parsed.relationships.length, 'relationship', 'relationships')}.`;
}

function summarizeKanban(content: string): string | null {
  const parsed = parseKanban(content);
  if (parsed.error) return null;
  const cards = parsed.columns.reduce((n, c) => n + c.cards.length, 0);
  const columns = parsed.columns.map((c) => c.name);
  return `Kanban board with ${plural(cards, 'card', 'cards')} across ${namedCount(columns, 'column', 'columns')}.`;
}

/** Every element in a C4 model, and every relationship any of them declares. */
function c4Counts(elements: readonly C4Element[]): {
  elements: number;
  relationships: number;
} {
  return elements.reduce(
    (acc, el) => {
      const below = c4Counts(el.children);
      return {
        elements: acc.elements + 1 + below.elements,
        relationships:
          acc.relationships + el.relationships.length + below.relationships,
      };
    },
    { elements: 0, relationships: 0 }
  );
}

function summarizeC4(content: string): string | null {
  const parsed = parseC4(content);
  if (parsed.error) return null;
  const counts = c4Counts(parsed.elements);
  const relationships = counts.relationships + parsed.relationships.length;
  const top = parsed.elements.map((e) => e.name);
  const nested = counts.elements - top.length;
  return `C4 diagram of ${namedCount(top, 'top-level element', 'top-level elements')}${nested > 0 ? `, holding ${nested} more` : ''}, with ${plural(relationships, 'relationship', 'relationships')}.`;
}

/** Pages in a sitemap tree; a container groups pages and is not one. */
function countPages(nodes: readonly SitemapNode[]): number {
  return nodes.reduce(
    (n, node) => n + (node.isContainer ? 0 : 1) + countPages(node.children),
    0
  );
}

function summarizeSitemap(content: string): string | null {
  const parsed = parseSitemap(content);
  if (parsed.error) return null;
  const tops = parsed.roots.map((r) => r.label);
  return `Sitemap of ${plural(countPages(parsed.roots), 'page', 'pages')} under ${namedCount(tops, 'top-level entry', 'top-level entries')}.`;
}

function summarizeInfra(content: string): string | null {
  const parsed = parseInfra(content);
  if (parsed.error) return null;
  const names = parsed.nodes.map((n) => n.label);
  return `Infrastructure diagram of ${namedCount(names, 'component', 'components')}, with ${plural(parsed.edges.length, 'connection', 'connections')}.`;
}

/** Task labels and group count through a gantt tree's groups and parallel blocks. */
function ganttTasks(
  nodes: readonly GanttNode[],
  acc: { tasks: string[]; groups: number }
): { tasks: string[]; groups: number } {
  for (const node of nodes) {
    if (node.kind === 'task') acc.tasks.push(node.label);
    else {
      if (node.kind === 'group') acc.groups += 1;
      ganttTasks(node.children, acc);
    }
  }
  return acc;
}

function summarizeGantt(content: string): string | null {
  const parsed = parseGantt(content);
  if (parsed.error) return null;
  const { tasks, groups } = ganttTasks(parsed.nodes, { tasks: [], groups: 0 });
  return `Gantt chart of ${namedCount(tasks, 'task', 'tasks')}${groups > 0 ? `, in ${plural(groups, 'group', 'groups')}` : ''}.`;
}

function summarizePert(content: string): string | null {
  const parsed = parsePert(content);
  if (parsed.error) return null;
  const names = parsed.activities.map((a) => a.name);
  return `PERT chart of ${namedCount(names, 'activity', 'activities')}, with ${plural(parsed.edges.length, 'dependency', 'dependencies')}.`;
}

function summarizeBoxesAndLines(content: string): string | null {
  const parsed = parseBoxesAndLines(content);
  if (parsed.error) return null;
  const names = parsed.nodes.map((n) => n.label);
  return `Boxes and lines diagram of ${namedCount(names, 'box', 'boxes')}, with ${plural(parsed.edges.length, 'line', 'lines')}.`;
}

function summarizeSketch(content: string): string | null {
  const parsed = parseSketch(content);
  if (parsed.error) return null;
  const names = parsed.nodes.map((n) => n.label);
  return `Sketch of ${namedCount(names, 'shape', 'shapes')}, with ${plural(parsed.edges.length, 'connection', 'connections')}.`;
}

function summarizeWhiteboard(content: string): string | null {
  const parsed = parseWhiteboard(content);
  if (parsed.error) return null;
  const names: string[] = [];
  let strokes = 0;
  let images = 0;
  for (const el of parsed.elements) {
    if (el.kind === 'shape' && el.label) names.push(el.label);
    else if (el.kind === 'text') names.push(el.text);
    else if (el.kind === 'ink') strokes++;
    else if (el.kind === 'image') images++;
  }
  return `Whiteboard with ${namedCount(names, 'labelled item', 'labelled items')}, ${plural(strokes, 'ink stroke', 'ink strokes')} and ${plural(images, 'image', 'images')}.`;
}

function summarizeSwimlane(content: string): string | null {
  const parsed = parseSwimlane(content);
  if (parsed.error) return null;
  const lanes = parsed.lanes.map((l) => l.label);
  return `Swimlane diagram of ${plural(parsed.nodes.length, 'step', 'steps')} across ${namedCount(lanes, 'lane', 'lanes')}, with ${plural(parsed.edges.length, 'connection', 'connections')}.`;
}

function summarizeFamily(content: string): string | null {
  const parsed = parseFamily(content);
  if (parsed.error) return null;
  return `Family tree of ${plural(parsed.persons.size, 'person', 'people')} in ${plural(parsed.unions.length, 'union', 'unions')}.`;
}

function summarizeVersionControl(content: string): string | null {
  const parsed = parseVersionControl(content);
  if (parsed.error) return null;
  const branches = parsed.branches.map((b) => b.name);
  return `Version control graph of ${plural(parsed.nodes.length, 'commit', 'commits')} on ${namedCount(branches, 'branch', 'branches')}.`;
}

/** Mind map nodes drawn under `nodes`, and those a source-collapsed
 *  ancestor folds away — the renderer hides a `collapsed` node's subtree. */
function mindmapCounts(nodes: readonly MindmapNode[]): {
  shown: number;
  folded: number;
} {
  return nodes.reduce(
    (acc, node) => {
      if (node.collapsed) {
        return {
          shown: acc.shown + 1,
          folded: acc.folded + countTree(node.children),
        };
      }
      const below = mindmapCounts(node.children);
      return {
        shown: acc.shown + 1 + below.shown,
        folded: acc.folded + below.folded,
      };
    },
    { shown: 0, folded: 0 }
  );
}

function summarizeMindmap(content: string): string | null {
  const parsed = parseMindmap(content);
  if (parsed.error) return null;
  if (parsed.roots.length === 0) return 'Mind map with no ideas.';
  const { shown, folded } = mindmapCounts(parsed.roots);
  const ideas = shown - parsed.roots.length;
  const centres = parsed.roots.map((r) => r.label);
  const hidden = folded > 0 ? `, with ${folded} more folded away` : '';
  return `Mind map of ${plural(ideas, 'idea', 'ideas')} around ${listNames(centres)}${hidden}.`;
}

function summarizeWireframe(content: string): string | null {
  const parsed = parseWireframe(content);
  if (parsed.error) return null;
  const elements = countTree(parsed.roots);
  const tops = parsed.roots.map((r) => r.label).filter((l) => l.length > 0);
  const modals =
    parsed.modals.length > 0
      ? `, plus ${plural(parsed.modals.length, 'modal', 'modals')}`
      : '';
  const noun = `${parsed.formFactor.charAt(0).toUpperCase()}${parsed.formFactor.slice(1)} wireframe`;
  return `${noun} of ${plural(elements, 'element', 'elements')}${tops.length > 0 ? `, in ${listNames(tops)}` : ''}${modals}.`;
}

function summarizeJourneyMap(content: string): string | null {
  const parsed = parseJourneyMap(content);
  if (parsed.error) return null;
  const steps =
    parsed.steps.length + parsed.phases.reduce((n, p) => n + p.steps.length, 0);
  const phases = parsed.phases.map((p) => p.name);
  const who = parsed.persona ? ` for ${parsed.persona.name}` : '';
  return `Journey map${who} of ${plural(steps, 'step', 'steps')}${phases.length > 0 ? ` across ${namedCount(phases, 'phase', 'phases')}` : ''}.`;
}

function summarizeRaci(content: string): string | null {
  const parsed = parseRaci(content);
  if (parsed.error) return null;
  const tasks =
    parsed.tasksWithoutPhase.length +
    parsed.phases.reduce((n, p) => n + p.tasks.length, 0);
  return `${parsed.variant.toUpperCase()} matrix of ${plural(tasks, 'task', 'tasks')} across ${namedCount(parsed.roleDisplayNames, 'role', 'roles')}.`;
}

function summarizeBody(content: string): string | null {
  const parsed = parseBody(content);
  if (parsed.error) return null;
  const parts = parsed.parts.map((p) => p.name);
  return `Body diagram marking ${namedCount(parts, 'part', 'parts')}.`;
}

function summarizeBracket(content: string): string | null {
  const parsed = parseBracket(content);
  if (parsed.error) return null;
  // The matches DRAWN, from the layout: a seeded bracket draws its whole
  // skeleton before any result line is written, so the authored lines
  // miss most of it.
  const layout = layoutBracket(parsed);
  const competitors =
    parsed.seeds.length > 0
      ? parsed.seeds.length
      : new Set(
          layout.matches.flatMap((m) =>
            [m.top, m.bot].filter((n): n is string => n !== null)
          )
        ).size;
  const decided = layout.matches.filter((m) => m.winner !== null).length;
  const champion = layout.champion ? `; ${layout.champion} won` : '';
  return `Tournament bracket of ${plural(competitors, 'competitor', 'competitors')} in ${plural(layout.matches.length, 'match', 'matches')}, ${decided} decided${champion}.`;
}

function summarizeLiveLink(content: string): string | null {
  const parsed = parseLiveLink(content);
  if (parsed.error || !parsed.id) return null;
  return `Card linking to the shared diagram ${parsed.title ?? parsed.id}.`;
}

/** `Funding ($M) ranges from 3.5 to 60` — the axis named by its label, else `x`. */
function axisRange(name: string, values: readonly number[]): string {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi
    ? `${name} is ${compactNumber(lo)} throughout`
    : `${name} ranges from ${compactNumber(lo)} to ${compactNumber(hi)}`;
}

function summarizeScatter(content: string): string | null {
  const parsed = parseScatter(content);
  if (parsed.error) return null;
  const points = parsed.scatterPoints ?? [];
  if (points.length === 0) return 'Scatter chart with no points.';
  const categories = [
    ...new Set(points.map((p) => p.category).filter((c): c is string => !!c)),
  ];
  const groups =
    categories.length > 0
      ? ` in ${namedCount(categories, 'category', 'categories')}`
      : '';
  const x = axisRange(
    parsed.xlabel ?? 'x',
    points.map((p) => p.x)
  );
  const y = axisRange(
    parsed.ylabel ?? 'y',
    points.map((p) => p.y)
  );
  return `Scatter chart of ${plural(points.length, 'point', 'points')}${groups}; ${x} and ${y}.`;
}

function summarizeSankey(content: string): string | null {
  const parsed = parseSankey(content);
  if (parsed.error) return null;
  const links = parsed.links ?? [];
  if (links.length === 0) return 'Sankey diagram with no flows.';
  const nodes = new Set(links.flatMap((l) => [l.source, l.target]));
  // Where the flow comes from: the nodes nothing flows into.
  const entered = new Set(links.map((l) => l.target));
  const sources = [...nodes].filter((n) => !entered.has(n));
  const from = sources.length > 0 ? `, flowing from ${listNames(sources)}` : '';
  return `Sankey diagram of ${plural(links.length, 'flow', 'flows')} between ${plural(nodes.size, 'node', 'nodes')}${from}.`;
}

function summarizeHeatmap(content: string): string | null {
  const parsed = parseHeatmap(content);
  if (parsed.error) return null;
  const rows = parsed.heatmapRows ?? [];
  const columns = parsed.columns ?? [];
  if (rows.length === 0) return 'Heatmap with no rows.';
  let hot = { row: rows[0]!.label, col: 0, value: -Infinity };
  for (const row of rows) {
    row.values.forEach((value, col) => {
      if (value > hot.value) hot = { row: row.label, col, value };
    });
  }
  const head = `Heatmap of ${plural(rows.length, 'row', 'rows')} by ${plural(columns.length, 'column', 'columns')}`;
  if (hot.value === -Infinity) return `${head}, with no values.`;
  const where = columns[hot.col] ? `${hot.row}, ${columns[hot.col]}` : hot.row;
  return `${head}; ${rangePhrase(rows.flatMap((r) => r.values))}, highest at ${where}.`;
}

function summarizeFunnel(content: string): string | null {
  const parsed = parseFunnel(content);
  if (parsed.error) return null;
  const stages = parsed.data;
  if (stages.length === 0) return 'Funnel chart with no stages.';
  const first = stages[0]!;
  const last = stages[stages.length - 1]!;
  if (stages.length === 1) {
    return `Funnel chart of 1 stage, ${first.label} at ${compactNumber(first.value)}.`;
  }
  const kept =
    first.value > 0
      ? ` (${Math.round((last.value / first.value) * 100)}% of the first)`
      : '';
  return `Funnel chart of ${plural(stages.length, 'stage', 'stages')}, from ${first.label} at ${compactNumber(first.value)} to ${last.label} at ${compactNumber(last.value)}${kept}.`;
}

function summarizeFunction(content: string): string | null {
  const parsed = parseFunctionChart(content);
  if (parsed.error) return null;
  const names = (parsed.functions ?? []).map((f) => f.name);
  const range = parsed.xRange
    ? ` for x from ${compactNumber(parsed.xRange.min)} to ${compactNumber(parsed.xRange.max)}`
    : '';
  return `Function plot of ${namedCount(names, 'function', 'functions')}${range && names.length > 0 ? `,${range}` : range}.`;
}

/** ` from A to B` / ` on A` over date captions ranked by `toValue`; `` when none parse. */
function dateSpan(
  dates: readonly string[],
  toValue: (d: string) => number
): string {
  const ranked = dates
    .map((d) => ({ d, t: toValue(d) }))
    .filter(({ t }) => Number.isFinite(t))
    .sort((a, b) => a.t - b.t);
  if (ranked.length === 0) return '';
  const first = ranked[0]!;
  const last = ranked[ranked.length - 1]!;
  return first.t === last.t
    ? ` on ${first.d}`
    : ` from ${first.d} to ${last.d}`;
}

function summarizeTimeline(content: string): string | null {
  const parsed = parseTimeline(content);
  if (parsed.error) return null;
  const events = parsed.timelineEvents;
  if (events.length === 0) return 'Timeline with no events.';
  const dates = events.flatMap((e) =>
    e.endDate ? [e.date, e.endDate] : [e.date]
  );
  const groups = parsed.timelineGroups.map((g) => g.name);
  const span = dateSpan(dates, parseTimelineDate);
  const head =
    groups.length > 0
      ? `Timeline of ${plural(events.length, 'event', 'events')} in ${namedCount(groups, 'group', 'groups')}${span ? `,${span}` : ''}`
      : `Timeline of ${plural(events.length, 'event', 'events')}${span}`;
  const marks = [
    parsed.timelineEras.length > 0
      ? plural(parsed.timelineEras.length, 'era', 'eras')
      : null,
    parsed.timelineMarkers.length > 0
      ? plural(parsed.timelineMarkers.length, 'marker', 'markers')
      : null,
  ].filter((x): x is string => x !== null);
  return `${head}${marks.length > 0 ? `, marking ${marks.join(' and ')}` : ''}.`;
}

function summarizeEventLine(content: string): string | null {
  const parsed = parseEventLine(content);
  if (parsed.error) return null;
  const events = parsed.events;
  if (events.length === 0) return 'Event line with no events.';
  // A collapsed era draws one summary card in place of its events.
  const folded = new Set(
    parsed.eras.filter((e) => e.collapsed).map((e) => e.name)
  );
  const hidden = events.filter((e) => e.era !== null && folded.has(e.era));
  const shown = events.length - hidden.length;
  const byValue = new Map(
    events
      .filter((e) => e.date !== null && !e.future && e.dateValue !== null)
      .map((e) => [e.date!, e.dateValue!])
  );
  const span = dateSpan([...byValue.keys()], (d) => byValue.get(d)!);
  const eras =
    parsed.eras.length > 0
      ? `, in ${plural(parsed.eras.length, 'era', 'eras')}`
      : '';
  const away =
    hidden.length > 0 ? `, with ${hidden.length} more folded away` : '';
  return `Event line of ${plural(shown, 'event', 'events')}${span}${eras}${away}.`;
}

function summarizeTechRadar(content: string): string | null {
  const parsed = parseTechRadar(content);
  if (parsed.error) return null;
  const blips = parsed.quadrants.reduce((n, q) => n + q.blips.length, 0);
  const quadrants = parsed.quadrants.map((q) => q.name);
  const rings = parsed.rings.map((r) => r.name);
  return `Tech radar of ${plural(blips, 'entry', 'entries')} across ${namedCount(quadrants, 'quadrant', 'quadrants')}, in ${namedCount(rings, 'ring', 'rings')}.`;
}

function summarizeCycle(content: string): string | null {
  const parsed = parseCycle(content);
  if (parsed.error) return null;
  const stages = parsed.nodes.map((n) => n.label);
  return `Cycle of ${namedCount(stages, 'stage', 'stages')}.`;
}

function summarizePyramid(content: string): string | null {
  const parsed = parsePyramid(content);
  if (parsed.error) return null;
  const layers = parsed.layers.map((l) => l.label);
  const noun = parsed.inverted ? 'Inverted pyramid' : 'Pyramid';
  if (layers.length === 0) return `${noun} with no layers.`;
  return `${noun} of ${plural(layers.length, 'layer', 'layers')}, top to bottom: ${listNames(layers)}.`;
}

function summarizeRing(content: string): string | null {
  const parsed = parseRing(content);
  if (parsed.error) return null;
  const layers = parsed.layers.map((l) => l.label);
  if (layers.length === 0) return 'Ring diagram with no layers.';
  return `Ring diagram of ${plural(layers.length, 'layer', 'layers')}, centre outward: ${listNames(layers)}.`;
}

function treemapLeaves(nodes: readonly TreemapNode[]): TreemapNode[] {
  return nodes.flatMap((n) =>
    n.children.length > 0 ? treemapLeaves(n.children) : [n]
  );
}

function summarizeTreemap(content: string): string | null {
  const parsed = parseTreemap(content);
  if (parsed.error) return null;
  const leaves = treemapLeaves(parsed.roots);
  if (leaves.length === 0) return 'Treemap with no items.';
  const total = leaves.reduce((sum, n) => sum + (n.value ?? 0), 0);
  const largest = leaves.reduce((a, b) =>
    (b.value ?? 0) > (a.value ?? 0) ? b : a
  );
  // Groups only when every top-level tile is one; a loose leaf beside them
  // would be counted as an item but sit in no group.
  const groups = parsed.roots.every((r) => r.children.length > 0)
    ? parsed.roots
    : [];
  const head =
    groups.length > 0
      ? `Treemap of ${plural(leaves.length, 'item', 'items')} in ${namedCount(
          groups.map((g) => g.label),
          'group',
          'groups'
        )}, totalling ${compactNumber(total)}`
      : `Treemap of ${plural(leaves.length, 'item', 'items')} totalling ${compactNumber(total)}`;
  return `${head}; the largest is ${largest.label} at ${compactNumber(largest.value ?? 0)}.`;
}

/** Blocks drawn, and blocks inside a collapsed container that are not. */
function blockCounts(grid: BlockGrid): { shown: number; folded: number } {
  let shown = 0;
  let folded = 0;
  for (const cell of grid.rows.flat()) {
    if (!isBlockNode(cell)) continue;
    shown += 1;
    if (!cell.grid) continue;
    const inner = blockCounts(cell.grid);
    if (cell.collapsed) folded += inner.shown + inner.folded;
    else {
      shown += inner.shown;
      folded += inner.folded;
    }
  }
  return { shown, folded };
}

function summarizeBlock(content: string): string | null {
  const parsed = parseBlock(content);
  if (parsed.error) return null;
  const { shown, folded } = blockCounts(parsed.top);
  if (shown === 0) return 'Block diagram with no blocks.';
  const tops = parsed.top.rows
    .flat()
    .filter(isBlockNode)
    .map((b) => b.label);
  const away = folded > 0 ? `, with ${folded} more folded away` : '';
  return `Block diagram of ${plural(shown, 'block', 'blocks')}, in ${listNames(tops)}${away}.`;
}

function summarizeGoal(content: string): string | null {
  const parsed = parseGoal(content);
  if (parsed.error) return null;
  const now = compactNumber(parsed.now);
  if (!parsed.hasTarget) return `Progress of ${now}, with no target set.`;
  const pct = Math.round((parsed.now / parsed.target) * 100);
  return `Progress toward a target of ${compactNumber(parsed.target)}: ${now} so far, ${pct}%.`;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];

/** `every year on August 21` / `every month on the third Tuesday` / … */
function cadencePhrase(rule: RecurRule): string {
  const weekday = WEEKDAYS[rule.weekday ?? -1] ?? 'the same day';
  switch (rule.kind) {
    case 'month-day':
      return `every year on ${MONTHS[rule.month ?? -1] ?? 'the same date'} ${rule.day ?? ''}`.trimEnd();
    case 'nth-weekday':
      return `every month on the ${ORDINALS[(rule.nth ?? 0) - 1] ?? 'same'} ${weekday}`;
    case 'last-weekday':
      return `every month on the last ${weekday}`;
    case 'weekly':
      return `every week on ${weekday}`;
    case 'interval': {
      const n = rule.intervalN ?? 1;
      const unit = rule.intervalUnit ?? 'day';
      return n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
    }
  }
}

function summarizeCountdown(content: string): string | null {
  const parsed = parseCountdown(content);
  if (parsed.error) return null;
  if (parsed.rule)
    return `Countdown to an event that recurs ${cadencePhrase(parsed.rule)}.`;
  return parsed.target
    ? `Countdown to ${parsed.target}.`
    : 'Countdown with no date set.';
}

function summarizeClock(content: string): string | null {
  const parsed = parseClock(content);
  if (parsed.error) return null;
  const places = parsed.entries.map((e) => e.label);
  return `World clock of ${namedCount(places, 'place', 'places')}.`;
}

function poiName(pos: PoiPos): string {
  return pos.kind === 'name' ? pos.name : `${pos.lat}, ${pos.lon}`;
}

function summarizeMap(content: string): string | null {
  const parsed = parseMap(content);
  if (parsed.error) return null;
  const parts: string[] = [];
  if (parsed.regions.length > 0) {
    parts.push(
      namedCount(
        parsed.regions.map((r) => r.name),
        'region',
        'regions'
      )
    );
  }
  if (parsed.pois.length > 0) {
    // An `as` alias is a handle for connectors, never drawn; the place is.
    const names = parsed.pois.map((p) => p.label ?? poiName(p.pos));
    parts.push(namedCount(names, 'marked place', 'marked places'));
  }
  for (const route of parsed.routes) {
    const from = route.originLabel ?? poiName(route.origin);
    parts.push(
      `a route of ${plural(route.legs.length, 'leg', 'legs')} from ${from}`
    );
  }
  if (parsed.edges.length > 0) {
    parts.push(plural(parsed.edges.length, 'connection', 'connections'));
  }
  if (parts.length === 0) return 'Map with nothing marked on it.';
  return `Map showing ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join('; ')}; and ${parts[parts.length - 1]}`}.`;
}

function summarizeQuadrant(content: string): string | null {
  const parsed = parseQuadrant(content);
  if (parsed.error) return null;
  const items = plural(parsed.quadrantPoints.length, 'item', 'items');
  const { topLeft, topRight, bottomLeft, bottomRight } = parsed.quadrantLabels;
  const names = [topLeft, topRight, bottomLeft, bottomRight]
    .filter((q): q is NonNullable<typeof q> => q !== null)
    .map((q) => q.text);
  return names.length > 0
    ? `Quadrant chart of ${items} across ${listNames(names)}.`
    : `Quadrant chart of ${items}.`;
}

function summarizeVenn(content: string): string | null {
  const parsed = parseVenn(content);
  if (parsed.error) return null;
  const sets = parsed.vennSets.map((s) => s.name);
  const named = parsed.vennOverlaps.filter((o) => o.label).length;
  const overlaps =
    named > 0
      ? `, with ${plural(named, 'named overlap', 'named overlaps')}`
      : '';
  return `Venn diagram of ${namedCount(sets, 'set', 'sets')}${overlaps}.`;
}

function summarizeSlope(content: string): string | null {
  const parsed = parseSlope(content);
  if (parsed.error) return null;
  const periods = parsed.periods;
  const span =
    periods.length > 1
      ? `, from ${periods[0]} to ${periods[periods.length - 1]}`
      : '';
  return `Slope chart of ${plural(parsed.data.length, 'item', 'items')} across ${plural(periods.length, 'period', 'periods')}${span}.`;
}

function summarizeArc(content: string): string | null {
  const parsed = parseArc(content);
  if (parsed.error) return null;
  const nodes = new Set(parsed.links.flatMap((l) => [l.source, l.target]));
  const noun = parsed.layout === 'chord' ? 'Chord diagram' : 'Arc diagram';
  const groups = parsed.arcNodeGroups.map((g) => g.name);
  const inGroups =
    groups.length > 0 ? ` in ${namedCount(groups, 'group', 'groups')}` : '';
  return `${noun} of ${plural(parsed.links.length, 'link', 'links')} between ${plural(nodes.size, 'node', 'nodes')}${inGroups}.`;
}

/** How many of a word cloud's heaviest words its summary names. */
const TOP_WORDS = 3;

function summarizeWordcloud(content: string): string | null {
  const parsed = parseWordcloud(content);
  if (parsed.error) return null;
  const words = parsed.words;
  if (words.length === 0) return 'Word cloud with no words.';
  const top = [...words]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, TOP_WORDS)
    .map((w) => w.text);
  return `Word cloud of ${plural(words.length, 'word', 'words')}; the largest ${top.length === 1 ? 'is' : 'are'} ${listNames(top)}.`;
}

// Every chart type has one: a new type without a summarizer is a compile
// error here, not a diagram that silently ships with no <desc>.
const SUMMARIZERS: Record<ChartTypeId, Summarizer> = {
  sequence: summarizeSequence,
  org: summarizeOrg,
  flowchart: summarizeFlowchart,
  state: summarizeState,
  class: summarizeClass,
  er: summarizeEr,
  kanban: summarizeKanban,
  c4: summarizeC4,
  sitemap: summarizeSitemap,
  infra: summarizeInfra,
  gantt: summarizeGantt,
  pert: summarizePert,
  'boxes-and-lines': summarizeBoxesAndLines,
  sketch: summarizeSketch,
  whiteboard: summarizeWhiteboard,
  swimlane: summarizeSwimlane,
  family: summarizeFamily,
  'version-control': summarizeVersionControl,
  mindmap: summarizeMindmap,
  wireframe: summarizeWireframe,
  'journey-map': summarizeJourneyMap,
  raci: summarizeRaci,
  body: summarizeBody,
  bracket: summarizeBracket,
  'live-link': summarizeLiveLink,
  bar: summarizeChart,
  line: summarizeChart,
  pie: summarizeChart,
  radar: summarizeChart,
  'polar-area': summarizeChart,
  scatter: summarizeScatter,
  sankey: summarizeSankey,
  heatmap: summarizeHeatmap,
  funnel: summarizeFunnel,
  function: summarizeFunction,
  timeline: summarizeTimeline,
  'event-line': summarizeEventLine,
  'tech-radar': summarizeTechRadar,
  cycle: summarizeCycle,
  pyramid: summarizePyramid,
  ring: summarizeRing,
  treemap: summarizeTreemap,
  block: summarizeBlock,
  goal: summarizeGoal,
  countdown: summarizeCountdown,
  clock: summarizeClock,
  map: summarizeMap,
  quadrant: summarizeQuadrant,
  venn: summarizeVenn,
  slope: summarizeSlope,
  arc: summarizeArc,
  wordcloud: summarizeWordcloud,
};

/**
 * One or two sentences saying what a diagram shows, from its parsed model —
 * or null when the chart type is unknown or the source does not parse.
 */
export function summarizeDiagram(
  content: string,
  chartType: string | null | undefined
): string | null {
  if (!chartType) return null;
  const summarize: Summarizer | undefined =
    SUMMARIZERS[chartType as ChartTypeId];
  return summarize ? summarize(content) : null;
}

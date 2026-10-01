// ============================================================
// Diagram summaries — the root <svg>'s <desc>
// ============================================================
//
// The root `aria-label` names the diagram; this says what it SHOWS, in one or
// two sentences a screen reader reads after the name. Built from the parsed
// model, never the SVG: the SVG holds positions and paint, and reading meaning
// back out of it is how a summary goes wrong in silence.
//
// One summarizer per chart type. A chart type without one gets no <desc> —
// the gap is the table below, not a generic sentence that says nothing. The
// row filling it in is diagrammo/diagrammo#954, landed by chart type.

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

const SUMMARIZERS: Partial<Record<ChartTypeId, Summarizer>> = {
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
};

/**
 * One or two sentences saying what a diagram shows, from its parsed model —
 * or null when its chart type has no summarizer yet or the source does not
 * parse.
 */
export function summarizeDiagram(
  content: string,
  chartType: string | null | undefined
): string | null {
  if (!chartType) return null;
  const summarize = SUMMARIZERS[chartType as ChartTypeId];
  return summarize ? summarize(content) : null;
}

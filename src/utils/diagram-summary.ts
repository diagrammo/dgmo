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

import { parseChart } from '../chart';
import type { ParsedChart } from '../chart';
import type { ChartTypeId } from '../chart-types';
import { parseOrg } from '../org/parser';
import type { OrgNode } from '../org/parser';
import { parseSequenceDgmo } from '../sequence/parser';
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

const SUMMARIZERS: Partial<Record<ChartTypeId, Summarizer>> = {
  sequence: summarizeSequence,
  org: summarizeOrg,
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

import { parseDgmo } from './dgmo-router';
import { parseSequenceDgmo } from './sequence/parser';
import { parseRaci, allTasks } from './raci/parser';
import { parseMindmap } from './mindmap/parser';
import { parseTechRadar } from './tech-radar/parser';
import { parseExtendedChart } from './echarts';
import { parseVisualization } from './d3';
import { parseOrg } from './org/parser';
import { parseGantt } from './gantt/parser';
import { parseKanban } from './kanban/parser';
import { parseERDiagram } from './er/parser';
import { parseClassDiagram } from './class/parser';
import { parseFlowchart } from './graph/flowchart-parser';
import { parseState } from './graph/state-parser';
import { parsePert } from './pert/parser';
import { parseInfra } from './infra/parser';
import { computeMinDimensions, type ContentCounts } from './utils/scaling';

export function getMinDimensions(content: string): {
  width: number;
  height: number;
} {
  const { chartType } = parseDgmo(content);
  if (!chartType) return { width: 300, height: 200 };

  const counts = extractContentCounts(content, chartType);
  return computeMinDimensions(chartType, counts);
}

function extractContentCounts(
  content: string,
  chartType: string
): ContentCounts {
  switch (chartType) {
    case 'sequence':
      return extractSequenceCounts(content);
    case 'raci':
    case 'rasci':
    case 'daci':
      return extractRaciCounts(content);
    case 'mindmap':
      return extractMindmapCounts(content);
    case 'tech-radar':
      return extractTechRadarCounts(content);
    case 'heatmap':
      return extractHeatmapCounts(content);
    case 'arc':
      return extractArcCounts(content);
    case 'org':
      return extractOrgCounts(content);
    case 'gantt':
      return extractGanttCounts(content);
    case 'kanban':
      return extractKanbanCounts(content);
    case 'er':
      return extractERCounts(content);
    case 'class':
      return extractClassCounts(content);
    case 'flowchart':
    case 'state':
      return extractFlowchartCounts(content, chartType);
    case 'pert':
      return extractPertCounts(content);
    case 'infra':
      return extractInfraCounts(content);
    default:
      return {};
  }
}

function extractSequenceCounts(content: string): ContentCounts {
  const parsed = parseSequenceDgmo(content);
  return {
    participants: parsed.participants.length,
    messages: parsed.messages.length,
  };
}

function extractRaciCounts(content: string): ContentCounts {
  const parsed = parseRaci(content);
  let taskCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _task of allTasks(parsed)) taskCount++;
  return {
    roles: parsed.roles.length,
    tasks: taskCount,
  };
}

function extractMindmapCounts(content: string): ContentCounts {
  const parsed = parseMindmap(content);
  let nodeCount = 0;
  let maxDepth = 0;

  function walk(
    nodes: readonly { children: readonly unknown[] }[],
    depth: number
  ): void {
    for (const node of nodes) {
      nodeCount++;
      if (depth > maxDepth) maxDepth = depth;
      walk(
        node.children as readonly { children: readonly unknown[] }[],
        depth + 1
      );
    }
  }

  walk(parsed.roots, 1);
  return { nodes: nodeCount, depth: maxDepth };
}

function extractTechRadarCounts(content: string): ContentCounts {
  const parsed = parseTechRadar(content);
  let blipCount = 0;
  for (const q of parsed.quadrants) blipCount += q.blips.length;
  return { blips: blipCount };
}

function extractHeatmapCounts(content: string): ContentCounts {
  const parsed = parseExtendedChart(content);
  return {
    columns: parsed.columns?.length ?? 0,
    rows: parsed.heatmapRows?.length ?? parsed.rows?.length ?? 0,
  };
}

function extractArcCounts(content: string): ContentCounts {
  const parsed = parseVisualization(content);
  const allNodes = new Set<string>();
  for (const g of parsed.arcNodeGroups) {
    for (const n of g.nodes) allNodes.add(n);
  }
  return { nodes: allNodes.size };
}

function extractOrgCounts(content: string): ContentCounts {
  const parsed = parseOrg(content);
  let nodeCount = 0;
  let maxDepth = 0;
  function walk(
    nodes: readonly { children: readonly unknown[] }[],
    depth: number
  ): void {
    for (const node of nodes) {
      nodeCount++;
      if (depth > maxDepth) maxDepth = depth;
      walk(
        node.children as readonly { children: readonly unknown[] }[],
        depth + 1
      );
    }
  }
  walk(parsed.roots, 1);
  return { nodes: nodeCount, depth: maxDepth };
}

function extractGanttCounts(content: string): ContentCounts {
  const parsed = parseGantt(content);
  const taskCount = parsed.nodes.filter(
    (n: { kind: string }) => n.kind === 'task'
  ).length;
  return { tasks: taskCount };
}

function extractKanbanCounts(content: string): ContentCounts {
  const parsed = parseKanban(content);
  return { columns: parsed.columns.length };
}

function extractERCounts(content: string): ContentCounts {
  const parsed = parseERDiagram(content);
  return { nodes: parsed.tables.length };
}

function extractClassCounts(content: string): ContentCounts {
  const parsed = parseClassDiagram(content);
  return { nodes: parsed.classes.length };
}

function extractFlowchartCounts(
  content: string,
  chartType: string
): ContentCounts {
  const parsed =
    chartType === 'state' ? parseState(content) : parseFlowchart(content);
  return { nodes: parsed.nodes.length };
}

function extractPertCounts(content: string): ContentCounts {
  const parsed = parsePert(content);
  return { tasks: parsed.activities.length };
}

function extractInfraCounts(content: string): ContentCounts {
  const parsed = parseInfra(content);
  return { nodes: parsed.nodes.length };
}

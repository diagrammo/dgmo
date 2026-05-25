import { parseDgmo } from './dgmo-router';
import { parseSequenceDgmo } from './sequence/parser';
import { parseRaci, allTasks } from './raci/parser';
import { parseMindmap } from './mindmap/parser';
import { parseTechRadar } from './tech-radar/parser';
import { parseExtendedChart } from './echarts';
import { parseVisualization } from './d3';
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

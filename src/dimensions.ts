import { parseDgmo } from './dgmo-router';
import { computeMinDimensions, type ContentCounts } from './utils/scaling';
import { REGISTRY_BY_ID } from './chart-type-registry';

export function getMinDimensions(content: string): {
  width: number;
  height: number;
} {
  const { chartType } = parseDgmo(content);
  if (!chartType) return { width: 300, height: 200 };

  const counts = extractContentCounts(content, chartType);
  return computeMinDimensions(chartType, counts);
}

// Content-count extraction is owned by each chart type's descriptor
// (`measure`) in chart-type-registry.ts. Types without a meaningful count omit
// `measure` and fall back to `{}` — the previous silent `default:` switch arm.
function extractContentCounts(
  content: string,
  chartType: string
): ContentCounts {
  return REGISTRY_BY_ID.get(chartType)?.measure?.(content) ?? {};
}

import { parseDgmo } from './dgmo-router';
import type { ContentCounts } from './utils/scaling';
import { REGISTRY_BY_ID } from './chart-type-registry';

export function getMinDimensions(content: string): {
  width: number;
  height: number;
} {
  const { chartType } = parseDgmo(content);
  if (!chartType) return { width: 300, height: 200 };

  const counts = extractContentCounts(content, chartType);
  // Both halves of sizing are owned by each chart type's descriptor in
  // chart-type-registry.ts: `measure` (content → counts, above) and `minDims`
  // (counts → min size, here). Types without a `minDims` fall back to {300,200}
  // — the previous silent `default:` arm of computeMinDimensions.
  return (
    REGISTRY_BY_ID.get(chartType)?.minDims?.(counts) ?? {
      width: 300,
      height: 200,
    }
  );
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

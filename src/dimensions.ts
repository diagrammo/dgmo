import { parseDgmo } from './dgmo-router';
import type { ContentCounts } from './utils/scaling';
import { REGISTRY_BY_ID } from './chart-type-registry';

export function getMinDimensions(content: string): {
  width: number;
  height: number;
} {
  const { chartType } = parseDgmo(content);
  if (!chartType) return { width: 300, height: 200 };

  // Both halves of sizing are owned by the chart type's descriptor in
  // chart-type-registry.ts: `measure` (content → counts) and `minDims`
  // (counts → min size). One lookup serves both. Types without a `minDims`
  // fall back to {300,200} — the previous silent `default:` arm of
  // computeMinDimensions; `measure`-less types contribute `{}` counts.
  const descriptor = REGISTRY_BY_ID.get(chartType);
  const counts: ContentCounts = descriptor?.measure?.(content) ?? {};
  return descriptor?.minDims?.(counts) ?? { width: 300, height: 200 };
}

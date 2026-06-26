// SPIKE — drop-in replacement for EChartsPreview's data-chart rendering with
// the hand-built D3 engine (no ECharts). Lives in this spike folder for review;
// move to diagrammo-app/src/features/preview/components/ to wire it in.
//
// It is a thin wrapper over dgmo's framework-agnostic mountD3DataChart
// controller (which is unit-tested in dgmo/tests/charts-d3-mount.test.ts).
// Props mirror EChartsPreview exactly so DgmoPreview can swap components with
// identical call sites.
//
// PREREQUISITE: dgmo must export mountD3DataChart (done on the spike branch)
// and be built so packages/dgmo/dist carries it.

import { useEffect, useRef } from 'react';
import { mountD3DataChart, type MountedD3Chart } from '@diagrammo/dgmo';
import { useColorScheme } from '@/hooks/useColorScheme';

interface D3ChartPreviewProps {
  content: string;
  isDark?: boolean; // accepted for prop-parity with EChartsPreview; theme is
  // resolved from useColorScheme below (same source EChartsPreview uses)
  filePath?: string;
  onNavigateToLine?: (line: number) => void;
  currentLine?: number;
}

export function D3ChartPreview({
  content,
  onNavigateToLine,
}: D3ChartPreviewProps) {
  const { paletteId, isDark } = useColorScheme();
  const theme = isDark ? 'dark' : 'light';
  const hostRef = useRef<HTMLDivElement>(null);
  const ctrl = useRef<MountedD3Chart | null>(null);

  // Mount once; the controller owns render + interaction lifecycle.
  useEffect(() => {
    if (!hostRef.current) return;
    ctrl.current = mountD3DataChart(hostRef.current, content, {
      theme,
      palette: paletteId,
      ...(onNavigateToLine && { onNavigate: onNavigateToLine }),
    });
    return () => {
      ctrl.current?.destroy();
      ctrl.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render on content / theme / palette changes (stale paints are dropped
  // by the controller's internal token).
  useEffect(() => {
    void ctrl.current?.update(content, { theme, palette: paletteId });
  }, [content, theme, paletteId]);

  return <div ref={hostRef} className="h-full w-full overflow-auto p-4" />;
}

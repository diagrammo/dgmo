// ============================================================
// Framework-agnostic mount controller for hand-built data charts — SPIKE.
//
// The imperative glue a host (React preview, Obsidian, plain DOM) wraps to get
// a live, interactive D3 data-chart with NO ECharts: render the SVG, inject it,
// attach the DOM interaction adapter, and expose update()/destroy() for the
// host's lifecycle. Keeping this here (not in the React component) means it is
// testable headlessly and reusable across every consumer.
//
// A React wrapper is ~15 lines:
//   useEffect(() => {
//     const c = mountD3DataChart(ref.current, content, { theme, palette, onNavigate });
//     return () => c.destroy();
//   }, []);
//   useEffect(() => { ctrl.update(content, { theme, palette }); }, [content, theme, palette]);
// ============================================================

import { render } from '../render';
import { getPalette } from '../palettes';
import {
  attachDataChartInteractions,
  type DataChartInteractionOpts,
} from './interactions';

export interface MountD3Opts {
  theme?: 'light' | 'dark' | 'transparent';
  palette?: string;
  /** Forwarded to the interaction adapter: source-line navigation on click. */
  onNavigate?: (line: number) => void;
  mutedColor?: string;
  surface?: string;
  text?: string;
}

export interface MountedD3Chart {
  /** Re-render with new content and/or theme/palette; re-attaches interactions. */
  update: (content: string, opts?: Partial<MountD3Opts>) => Promise<void>;
  /** Tear down listeners + overlays and clear the container. */
  destroy: () => void;
}

function interactionOpts(o: MountD3Opts): DataChartInteractionOpts {
  const theme = o.theme ?? 'light';
  const pal = getPalette(o.palette ?? 'slate')[theme === 'dark' ? 'dark' : 'light'];
  return {
    ...(o.onNavigate && { onNavigate: o.onNavigate }),
    mutedColor: o.mutedColor ?? pal.border,
    surface: o.surface ?? pal.surface,
    text: o.text ?? pal.text,
  };
}

/**
 * Render + mount an interactive D3 data chart into `container`. Returns a
 * controller; call `destroy()` on unmount. No-op interactions if the rendered
 * type carries no interactive markup.
 */
export function mountD3DataChart(
  container: HTMLElement,
  content: string,
  opts: MountD3Opts = {}
): MountedD3Chart {
  let detach: (() => void) | null = null;
  let current: MountD3Opts = { ...opts };
  let token = 0;

  const paint = async (text: string, o: MountD3Opts): Promise<void> => {
    const mine = ++token;
    const { svg } = await render(text, {
      engine: 'd3',
      ...(o.theme && { theme: o.theme }),
      ...(o.palette && { palette: o.palette }),
    });
    if (mine !== token) return; // a newer update() superseded this render
    if (detach) {
      detach();
      detach = null;
    }
    container.innerHTML = svg;
    const el = container.querySelector('svg');
    if (el) detach = attachDataChartInteractions(el, interactionOpts(o));
  };

  void paint(content, current);

  return {
    update: async (text: string, patch?: Partial<MountD3Opts>) => {
      current = { ...current, ...patch };
      await paint(text, current);
    },
    destroy: () => {
      token++;
      if (detach) detach();
      detach = null;
      container.innerHTML = '';
    },
  };
}

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
import { renderDataChartD3 } from './index';
import { attachDataChartInteractions } from './interactions';

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

/**
 * Render + mount an interactive D3 data chart into `container`. Returns a
 * controller; call `destroy()` on unmount. No-op interactions if the rendered
 * type carries no interactive markup.
 */
function paletteOf(o: MountD3Opts) {
  const theme = o.theme ?? 'light';
  return getPalette(o.palette ?? 'slate')[theme === 'dark' ? 'dark' : 'light'];
}

export function mountD3DataChart(
  container: HTMLElement,
  content: string,
  opts: MountD3Opts = {}
): MountedD3Chart {
  let detach: (() => void) | null = null;
  let current: MountD3Opts = { ...opts };
  let text = content;
  let token = 0;
  let lastW = 0;
  let lastH = 0;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  const paint = async (): Promise<void> => {
    const mine = ++token;
    // Render at the container's actual size so the chart fills the pane and
    // re-lays-out (not CSS-scales) — matching ECharts' resize behavior. When
    // unmeasured (no layout yet / headless), renderDataChartD3 falls back to
    // its default export dimensions and the ResizeObserver repaints once sized.
    const width = container.clientWidth;
    const height = container.clientHeight;
    lastW = width;
    lastH = height;
    const dims = width > 0 && height > 0 ? { width, height } : undefined;

    let svg = await renderDataChartD3(
      text,
      current.theme ?? 'light',
      paletteOf(current),
      dims
    );
    // Fallback (parse error / unsupported type) → error card via render().
    if (!svg) {
      const r = await render(text, {
        ...(current.theme && { theme: current.theme }),
        ...(current.palette && { palette: current.palette }),
      });
      svg = r.svg;
    }
    if (mine !== token) return; // a newer paint superseded this one

    if (detach) {
      detach();
      detach = null;
    }
    container.innerHTML = svg;
    const el = container.querySelector('svg');
    if (el) {
      const pal = paletteOf(current);
      detach = attachDataChartInteractions(el, {
        ...(current.onNavigate && { onNavigate: current.onNavigate }),
        mutedColor: current.mutedColor ?? pal.border,
        surface: current.surface ?? pal.surface,
        text: current.text ?? pal.text,
      });
    }
  };

  // Re-render (debounced) when the pane size changes.
  const ro =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          const w = container.clientWidth;
          const h = container.clientHeight;
          if (w === lastW && h === lastH) return;
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => void paint(), 120);
        })
      : null;
  ro?.observe(container);

  void paint();

  return {
    update: async (nextContent: string, patch?: Partial<MountD3Opts>) => {
      text = nextContent;
      current = { ...current, ...patch };
      await paint();
    },
    destroy: () => {
      token++;
      if (resizeTimer) clearTimeout(resizeTimer);
      ro?.disconnect();
      if (detach) detach();
      detach = null;
      container.innerHTML = '';
    },
  };
}

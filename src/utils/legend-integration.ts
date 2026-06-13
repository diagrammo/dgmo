// ============================================================
// Legend integration door (Story 110.6)
// ============================================================
//
// ~15 renderers hand-rolled the same `build LegendConfig + LegendState (+
// callbacks) → renderLegendD3(...)` integration, re-deriving the position
// default and the 7-positional-arg call each time. This door owns that
// assembly: a renderer creates its wrapper `<g>` and the legend's own data
// (groups, callbacks, any controls), then makes one call. The D3-vs-SVG choice
// (ECharts uses the SVG-string path) and the renderLegendD3 call convention live
// here, not at every call site.
//
// Output is byte-identical to the prior inline code: optional config/state
// fields are spread conditionally exactly as the renderers did, and the
// position default matches the value every D3 renderer used.

import { renderLegendD3 } from './legend-d3';
import type {
  ControlsGroupConfig,
  D3Sel,
  LegendCallbacks,
  LegendControl,
  LegendGroupData,
  LegendHandle,
  LegendMode,
  LegendPalette,
  LegendPosition,
} from './legend-types';

/** The default placement every D3 renderer used inline. */
const DEFAULT_POSITION: LegendPosition = {
  placement: 'top-center',
  titleRelation: 'below-title',
};

export interface IntegratedLegendOptions {
  /** Legend group data (often a single tag group; `[]` for controls-only legends). */
  groups: readonly LegendGroupData[];
  palette: LegendPalette;
  isDark: boolean;
  /** Container width passed through to layout (px). */
  width: number;
  mode: LegendMode;
  /** Defaults to top-center / below-title (the value all D3 renderers used). */
  position?: LegendPosition;
  activeGroup?: string | null;
  callbacks?: LegendCallbacks;
  // ── Optional config passthroughs (spread only when provided) ──
  controls?: LegendControl[];
  controlsGroup?: ControlsGroupConfig;
  controlsHost?: 'app' | 'inline';
  titleWidth?: number;
  capsulePillAddonWidth?: number;
  showEmptyGroups?: boolean;
  showInactivePills?: boolean;
  // ── Optional state passthroughs ──
  hiddenAttributes?: Set<string>;
  controlsExpanded?: boolean;
}

/**
 * Build the legend config/state and render it into `container` (the renderer's
 * wrapper `<g>`). Returns the `LegendHandle` from `renderLegendD3`.
 */
export function renderIntegratedLegend(
  container: D3Sel,
  opts: IntegratedLegendOptions
): LegendHandle {
  return renderLegendD3(
    container,
    {
      groups: opts.groups,
      position: opts.position ?? DEFAULT_POSITION,
      mode: opts.mode,
      ...(opts.controls !== undefined && { controls: opts.controls }),
      ...(opts.controlsGroup !== undefined && {
        controlsGroup: opts.controlsGroup,
      }),
      ...(opts.controlsHost !== undefined && {
        controlsHost: opts.controlsHost,
      }),
      ...(opts.titleWidth !== undefined && { titleWidth: opts.titleWidth }),
      ...(opts.capsulePillAddonWidth !== undefined && {
        capsulePillAddonWidth: opts.capsulePillAddonWidth,
      }),
      ...(opts.showEmptyGroups !== undefined && {
        showEmptyGroups: opts.showEmptyGroups,
      }),
      ...(opts.showInactivePills !== undefined && {
        showInactivePills: opts.showInactivePills,
      }),
    },
    {
      activeGroup: opts.activeGroup ?? null,
      ...(opts.hiddenAttributes !== undefined && {
        hiddenAttributes: opts.hiddenAttributes,
      }),
      ...(opts.controlsExpanded !== undefined && {
        controlsExpanded: opts.controlsExpanded,
      }),
    },
    opts.palette,
    opts.isDark,
    opts.callbacks,
    opts.width
  );
}

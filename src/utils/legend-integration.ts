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

import { LEGEND_PILL_TOGGLE_CLASS, renderLegendD3 } from './legend-d3';
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

/** Marks an interactive swimlane icon, so a re-render can find it again. */
const SWIMLANE_TOGGLE_CLASS = 'dgmo-swimlane-toggle';

/**
 * Wires a legend pill's swimlane ("Group by") icon (#952). Before, the icon
 * took only a click and was named only by a hover `<title>`, so Tab never
 * reached it and a screen reader had nothing to call it.
 *
 * Every icon gets the `<title>` and the click. Only an `interactive` one — a
 * render whose caller can act on the toggle — is also a button: focusable,
 * named, pressed or not, with Enter or Space doing what a click does. A static
 * render (export, docs embed) stays inert, so it never announces a control
 * that does nothing.
 */
export function wireSwimlaneToggle(
  iconEl: D3Sel,
  groupName: string,
  isActive: boolean,
  interactive: boolean,
  activate: () => void
): void {
  const label = `Group by ${groupName}`;
  iconEl.append('title').text(label);
  iconEl.style('cursor', 'pointer').on('click', (event: Event) => {
    event.stopPropagation();
    activate();
  });
  if (!interactive) return;
  iconEl
    .classed(SWIMLANE_TOGGLE_CLASS, true)
    .attr('role', 'button')
    .attr('tabindex', '0')
    .attr('aria-label', label)
    .attr('aria-pressed', isActive ? 'true' : 'false')
    .on('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      activate();
    });
}

/** Every legend control a re-render must hand focus back to. */
const KEPT_FOCUS_CLASSES = [SWIMLANE_TOGGLE_CLASS, LEGEND_PILL_TOGGLE_CLASS];

/**
 * Runs `render`, which replaces `container`'s chart or legend, and puts
 * keyboard focus back on the legend control that held it before — a swimlane
 * toggle (#952) or a tag-group pill (#1060). Enter on either re-renders, and
 * without this the focused element is removed, focus drops to the page, and
 * the new pressed state is never announced.
 */
export function keepLegendFocus(container: Element, render: () => void): void {
  const active = container.ownerDocument.activeElement;
  const held =
    active && container.contains(active)
      ? KEPT_FOCUS_CLASSES.find((c) => active.classList.contains(c))
      : undefined;
  const label = held ? active?.getAttribute('aria-label') : null;
  render();
  if (!held || label == null) return;
  for (const el of container.querySelectorAll<SVGElement>(`.${held}`)) {
    if (el.getAttribute('aria-label') === label) {
      el.focus();
      return;
    }
  }
}

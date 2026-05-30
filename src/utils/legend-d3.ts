// ============================================================
// Centralized legend D3 renderer
// Thin adapter: layout engine → D3 DOM
// ============================================================

import {
  LEGEND_HEIGHT,
  LEGEND_PILL_FONT_SIZE,
  LEGEND_DOT_R,
  LEGEND_ENTRY_FONT_SIZE,
  LEGEND_ENTRY_DOT_GAP,
  LEGEND_TOGGLE_DOT_R,
  LEGEND_TOGGLE_OFF_OPACITY,
  CONTROLS_ICON_PATH,
  measureLegendText,
} from './legend-constants';
import { computeLegendLayout } from './legend-layout';
import { mix } from '../palettes/color-utils';
import { FONT_FAMILY } from '../fonts';
import type {
  LegendConfig,
  LegendState,
  LegendCallbacks,
  LegendHandle,
  LegendPalette,
  LegendLayout,
  LegendPillLayout,
  LegendCapsuleLayout,
  LegendControlLayout,
  ControlsGroupLayout,
  D3Sel,
} from './legend-types';

// ── Main renderer ───────────────────────────────────────────

export function renderLegendD3(
  container: D3Sel,
  config: LegendConfig,
  state: LegendState,
  palette: LegendPalette,
  isDark: boolean,
  callbacks?: LegendCallbacks,
  containerWidth?: number
): LegendHandle {
  const width = containerWidth ?? parseFloat(container.attr('width') || '800');
  let currentState = { ...state };
  let currentLayout: LegendLayout;

  const legendG = container
    .append('g')
    .attr('class', 'dgmo-legend')
    .attr('data-legend-title-relation', config.position.titleRelation)
    .attr(
      'data-legend-capsule-addon-width',
      String(config.capsulePillAddonWidth ?? 0)
    );

  function render() {
    currentLayout = computeLegendLayout(config, currentState, width);
    legendG.selectAll('*').remove();

    if (currentLayout.height === 0) return;

    // Set active attribute on container
    if (currentState.activeGroup) {
      legendG.attr(
        'data-legend-active',
        currentState.activeGroup.toLowerCase()
      );
    } else {
      legendG.attr('data-legend-active', null);
    }

    const groupBg = isDark
      ? mix(palette.surface, palette.bg, 50)
      : mix(palette.surface, palette.bg, 30);
    const pillBorder = mix(palette.textMuted, palette.bg, 50);

    // Render active capsule
    if (currentLayout.activeCapsule) {
      renderCapsule(
        legendG,
        currentLayout.activeCapsule,
        palette,
        groupBg,
        pillBorder,
        isDark,
        callbacks
      );
    }

    // Render collapsed pills
    for (const pill of currentLayout.pills) {
      renderPill(legendG, pill, palette, groupBg, callbacks);
    }

    // Render controls group (gear pill / capsule)
    if (currentLayout.controlsGroup) {
      renderControlsGroup(
        legendG,
        currentLayout.controlsGroup,
        palette,
        groupBg,
        pillBorder,
        callbacks,
        config
      );
    }

    // Render controls
    for (const ctrl of currentLayout.controls) {
      renderControl(
        legendG,
        ctrl,
        palette,
        groupBg,
        pillBorder,
        isDark,
        config.controls
      );
    }
  }

  render();

  return {
    setState(newState: LegendState) {
      currentState = { ...newState };
      render();
    },
    destroy() {
      legendG.remove();
    },
    getHeight() {
      return currentLayout?.height ?? 0;
    },
    getLayout() {
      return currentLayout;
    },
  };
}

// ── Capsule (active group) ──────────────────────────────────

function renderCapsule(
  parent: D3Sel,
  capsule: LegendCapsuleLayout,
  palette: LegendPalette,
  groupBg: string,
  pillBorder: string,
  _isDark: boolean,
  callbacks?: LegendCallbacks
): void {
  const g = parent
    .append('g')
    .attr('transform', `translate(${capsule.x},${capsule.y})`)
    .attr('data-legend-group', capsule.groupName.toLowerCase())
    .style('cursor', 'pointer');

  // Outer capsule background
  g.append('rect')
    .attr('width', capsule.width)
    .attr('height', capsule.height)
    .attr('rx', LEGEND_HEIGHT / 2)
    .attr('fill', groupBg);

  // Inner pill
  const pill = capsule.pill;
  g.append('rect')
    .attr('x', pill.x)
    .attr('y', pill.y)
    .attr('width', pill.width)
    .attr('height', pill.height)
    .attr('rx', pill.height / 2)
    .attr('fill', palette.bg);

  // Pill border
  g.append('rect')
    .attr('x', pill.x)
    .attr('y', pill.y)
    .attr('width', pill.width)
    .attr('height', pill.height)
    .attr('rx', pill.height / 2)
    .attr('fill', 'none')
    .attr('stroke', pillBorder)
    .attr('stroke-width', 0.75);

  // Pill text
  g.append('text')
    .attr('x', pill.x + pill.width / 2)
    .attr('y', LEGEND_HEIGHT / 2)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('font-size', LEGEND_PILL_FONT_SIZE)
    .attr('font-weight', 500)
    .attr('fill', palette.text)
    .attr('pointer-events', 'none')
    .attr('font-family', FONT_FAMILY)
    .text(capsule.groupName);

  // Continuous ramp (choropleth group): min | gradient | max, in place of dots.
  if (capsule.gradient) {
    const gr = capsule.gradient;
    const gradId = `dgmo-legend-ramp-${capsule.groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const def = g.append('defs').append('linearGradient').attr('id', gradId);
    def
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', mix(gr.hue, gr.base, 15));
    def.append('stop').attr('offset', '100%').attr('stop-color', gr.hue);
    g.append('text')
      .attr('x', gr.minX)
      .attr('y', gr.textY)
      .attr('dominant-baseline', 'central')
      .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
      .attr('fill', palette.textMuted)
      .attr('pointer-events', 'none')
      .attr('font-family', FONT_FAMILY)
      .text(gr.minText);
    // Class + raw min/max so the app can scrub the ramp (x → value) and
    // highlight the regions whose score lands near the cursor.
    g.append('rect')
      .attr('class', 'dgmo-legend-gradient-ramp')
      .attr('data-ramp-min', gr.min)
      .attr('data-ramp-max', gr.max)
      .attr('x', gr.rampX)
      .attr('y', gr.rampY)
      .attr('width', gr.rampW)
      .attr('height', gr.rampH)
      .attr('rx', 2)
      .attr('fill', `url(#${gradId})`);
    g.append('text')
      .attr('x', gr.maxX)
      .attr('y', gr.textY)
      .attr('dominant-baseline', 'central')
      .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
      .attr('fill', palette.textMuted)
      .attr('pointer-events', 'none')
      .attr('font-family', FONT_FAMILY)
      .text(gr.maxText);
  }

  // Entry dots + labels
  for (const entry of capsule.entries) {
    const entryG = g
      .append('g')
      .attr('data-legend-entry', entry.value.toLowerCase())
      .attr('data-series-name', entry.value)
      .style('cursor', 'pointer');

    entryG
      .append('circle')
      .attr('cx', entry.dotCx)
      .attr('cy', entry.dotCy)
      .attr('r', LEGEND_DOT_R)
      .attr('fill', entry.color);

    entryG
      .append('text')
      .attr('x', entry.textX)
      .attr('y', entry.textY)
      .attr('dominant-baseline', 'central')
      .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
      .attr('fill', palette.textMuted)
      .attr('font-family', FONT_FAMILY)
      .text(entry.displayValue ?? entry.value);

    // Entry hover callback for chart-level highlighting
    if (callbacks?.onEntryHover) {
      const groupName = capsule.groupName;
      const entryValue = entry.value;
      const onHover = callbacks.onEntryHover;
      entryG
        .on('mouseenter', () => onHover(groupName, entryValue))
        .on('mouseleave', () => onHover(groupName, null));
    }
  }

  // Click handler on pill
  if (callbacks?.onGroupToggle) {
    const cb = callbacks.onGroupToggle;
    const name = capsule.groupName;
    g.on('click', () => cb(name));
  }

  // Post-render callback for chart-specific addons
  if (callbacks?.onGroupRendered) {
    callbacks.onGroupRendered(capsule.groupName, g, true);
  }
}

// ── Collapsed pill ──────────────────────────────────────────

function renderPill(
  parent: D3Sel,
  pill: LegendPillLayout,
  palette: LegendPalette,
  groupBg: string,
  callbacks?: LegendCallbacks
): void {
  // Collapsed tag-group pills are hidden in export mode
  // (`LegendConfig.mode === 'export'`) — the layout engine filters them
  // in `computeLegendLayout`. See
  // tech-spec-hide-inactive-tag-pills-in-exports.md.
  const g = parent
    .append('g')
    .attr('transform', `translate(${pill.x},${pill.y})`)
    .attr('data-legend-group', pill.groupName.toLowerCase())
    .style('cursor', 'pointer');

  g.append('rect')
    .attr('width', pill.width)
    .attr('height', pill.height)
    .attr('rx', pill.height / 2)
    .attr('fill', groupBg);

  g.append('text')
    .attr('x', pill.width / 2)
    .attr('y', pill.height / 2)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('font-size', LEGEND_PILL_FONT_SIZE)
    .attr('font-weight', 500)
    .attr('fill', palette.textMuted)
    .attr('pointer-events', 'none')
    .attr('font-family', FONT_FAMILY)
    .text(pill.groupName);

  if (callbacks?.onGroupToggle) {
    const cb = callbacks.onGroupToggle;
    const name = pill.groupName;
    g.on('click', () => cb(name));
  }

  if (callbacks?.onGroupRendered) {
    callbacks.onGroupRendered(pill.groupName, g, false);
  }
}

// ── Control (right-aligned) ─────────────────────────────────

function renderControl(
  parent: D3Sel,
  ctrl: LegendControlLayout,
  palette: LegendPalette,
  _groupBg: string,
  pillBorder: string,
  _isDark: boolean,
  configControls?: LegendConfig['controls']
): void {
  const g = parent
    .append('g')
    .attr('transform', `translate(${ctrl.x},${ctrl.y})`)
    .attr('data-legend-control', ctrl.id)
    .style('cursor', 'pointer');

  if (ctrl.exportBehavior === 'strip') {
    g.attr('data-export-ignore', 'true');
  }

  // Outline pill style for controls
  g.append('rect')
    .attr('width', ctrl.width)
    .attr('height', ctrl.height)
    .attr('rx', ctrl.height / 2)
    .attr('fill', 'none')
    .attr('stroke', pillBorder)
    .attr('stroke-width', 0.75);

  // Icon + label
  let textX = ctrl.width / 2;
  if (ctrl.icon && ctrl.label) {
    // Icon on left, label on right
    const iconG = g
      .append('g')
      .attr('transform', `translate(8,${(ctrl.height - 14) / 2})`);
    iconG.html(ctrl.icon);
    textX =
      8 +
      14 +
      LEGEND_ENTRY_DOT_GAP +
      measureLegendText(ctrl.label, LEGEND_PILL_FONT_SIZE) / 2;
  }

  if (ctrl.label) {
    g.append('text')
      .attr('x', textX)
      .attr('y', ctrl.height / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', LEGEND_PILL_FONT_SIZE)
      .attr('font-weight', 500)
      .attr('fill', palette.textMuted)
      .attr('pointer-events', 'none')
      .attr('font-family', FONT_FAMILY)
      .text(ctrl.label);
  }

  // Children (e.g., speed badges)
  if (ctrl.children) {
    let cx = ctrl.width + 4;
    for (const child of ctrl.children) {
      const childG = g
        .append('g')
        .attr('transform', `translate(${cx},0)`)
        .style('cursor', 'pointer');

      childG
        .append('rect')
        .attr('width', child.width)
        .attr('height', ctrl.height)
        .attr('rx', ctrl.height / 2)
        .attr(
          'fill',
          child.isActive ? (palette.primary ?? palette.text) : 'none'
        )
        .attr('stroke', pillBorder)
        .attr('stroke-width', 0.75);

      childG
        .append('text')
        .attr('x', child.width / 2)
        .attr('y', ctrl.height / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
        .attr('fill', child.isActive ? palette.bg : palette.textMuted)
        .attr('font-family', FONT_FAMILY)
        .text(child.label);

      // Click handler for child
      const configCtrl = configControls?.find((c) => c.id === ctrl.id);
      const configChild = configCtrl?.children?.find((c) => c.id === child.id);
      if (configChild?.onClick) {
        const onClick = configChild.onClick;
        childG.on('click', () => onClick());
      }

      cx += child.width + 4;
    }
  }

  // Click handler
  const configCtrl = configControls?.find((c) => c.id === ctrl.id);
  if (configCtrl?.onClick) {
    const onClick = configCtrl.onClick;
    g.on('click', () => onClick());
  }
}

// ── Controls group (gear pill / capsule) ───────────────────

function renderControlsGroup(
  parent: D3Sel,
  layout: ControlsGroupLayout,
  palette: LegendPalette,
  groupBg: string,
  pillBorder: string,
  callbacks?: LegendCallbacks,
  config?: LegendConfig
): void {
  const g = parent
    .append('g')
    .attr('transform', `translate(${layout.x},${layout.y})`)
    .attr('data-legend-controls', layout.expanded ? 'expanded' : 'collapsed')
    .attr('data-export-ignore', 'true')
    .style('cursor', 'pointer');

  if (!layout.expanded) {
    // Collapsed: gear pill. Subtle stroke so the affordance reads
    // even when the pill sits alone on an empty canvas (PERT, etc.) —
    // a fill-only pill blends into bg and looks like nothing.
    g.append('rect')
      .attr('width', layout.width)
      .attr('height', layout.height)
      .attr('rx', layout.height / 2)
      .attr('fill', groupBg)
      .attr('stroke', pillBorder)
      .attr('stroke-width', 0.75);

    // Gear icon centered
    const iconSize = 14;
    const iconX = (layout.width - iconSize) / 2;
    const iconY = (layout.height - iconSize) / 2;
    g.append('path')
      .attr('d', CONTROLS_ICON_PATH)
      .attr('transform', `translate(${iconX},${iconY})`)
      .attr('fill', palette.textMuted)
      .attr('fill-rule', 'evenodd')
      .attr('pointer-events', 'none');

    if (callbacks?.onControlsExpand) {
      const cb = callbacks.onControlsExpand;
      g.on('click', () => cb());
    }
  } else {
    // Expanded: capsule with gear pill + toggle entries
    const pill = layout.pill;

    // Outer capsule background
    g.append('rect')
      .attr('width', layout.width)
      .attr('height', layout.height)
      .attr('rx', LEGEND_HEIGHT / 2)
      .attr('fill', groupBg);

    // Inner gear pill
    const pillG = g
      .append('g')
      .attr('class', 'controls-gear-pill')
      .style('cursor', 'pointer');

    pillG
      .append('rect')
      .attr('x', pill.x)
      .attr('y', pill.y)
      .attr('width', pill.width)
      .attr('height', pill.height)
      .attr('rx', pill.height / 2)
      .attr('fill', palette.bg);

    pillG
      .append('rect')
      .attr('x', pill.x)
      .attr('y', pill.y)
      .attr('width', pill.width)
      .attr('height', pill.height)
      .attr('rx', pill.height / 2)
      .attr('fill', 'none')
      .attr('stroke', pillBorder)
      .attr('stroke-width', 0.75);

    // Gear icon inside pill
    const iconSize = 14;
    const iconX = pill.x + (pill.width - iconSize) / 2;
    const iconY = pill.y + (pill.height - iconSize) / 2;
    pillG
      .append('path')
      .attr('d', CONTROLS_ICON_PATH)
      .attr('transform', `translate(${iconX},${iconY})`)
      .attr('fill', palette.text)
      .attr('fill-rule', 'evenodd')
      .attr('pointer-events', 'none');

    // Click on gear pill collapses
    if (callbacks?.onControlsExpand) {
      const cb = callbacks.onControlsExpand;
      pillG.on('click', (event: Event) => {
        event.stopPropagation();
        cb();
      });
    }

    // Toggle entries
    const toggles = config?.controlsGroup?.toggles ?? [];
    for (const tl of layout.toggles) {
      const toggle = toggles.find((t) => t.id === tl.id);
      const entryG = g
        .append('g')
        .attr('data-controls-toggle', tl.id)
        .style('cursor', 'pointer');

      if (tl.active) {
        // Filled dot
        entryG
          .append('circle')
          .attr('cx', tl.dotCx)
          .attr('cy', tl.dotCy)
          .attr('r', LEGEND_TOGGLE_DOT_R)
          .attr('fill', palette.primary ?? palette.text);
      } else {
        // Hollow dot
        entryG
          .append('circle')
          .attr('cx', tl.dotCx)
          .attr('cy', tl.dotCy)
          .attr('r', LEGEND_TOGGLE_DOT_R)
          .attr('fill', 'none')
          .attr('stroke', palette.textMuted)
          .attr('stroke-width', 1);
      }

      // Label
      entryG
        .append('text')
        .attr('x', tl.textX)
        .attr('y', tl.textY)
        .attr('dominant-baseline', 'central')
        .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
        .attr('fill', palette.textMuted)
        .attr('opacity', tl.active ? 1 : LEGEND_TOGGLE_OFF_OPACITY)
        .attr('font-family', FONT_FAMILY)
        .text(tl.label);

      // Click on toggle entry
      if (callbacks?.onControlsToggle && toggle) {
        const cb = callbacks.onControlsToggle;
        const id = tl.id;
        const newActive = !tl.active;
        entryG.on('click', (event: Event) => {
          event.stopPropagation();
          cb(id, newActive);
        });
      }
    }
  }
}

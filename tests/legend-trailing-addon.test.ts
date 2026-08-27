import { describe, expect, it } from 'vitest';

import {
  LEGEND_CAPSULE_PAD,
  LEGEND_HEIGHT,
  LEGEND_MAX_ENTRY_ROWS,
} from '../src/utils/legend-constants';
import {
  computeLegendLayout,
  legendEntryWidth,
} from '../src/utils/legend-layout';
import type { LegendConfig, LegendGroupData } from '../src/utils/legend-types';

const GROUP: LegendGroupData = {
  name: 'Crew',
  entries: [
    { value: 'Deck', color: '#c0504d' },
    { value: 'Hold', color: '#5b9357' },
  ],
};

function config(trail?: number): LegendConfig {
  return {
    groups: [GROUP],
    position: { placement: 'top-center', titleRelation: 'inline-with-title' },
    mode: 'preview',
    ...(trail === undefined ? {} : { capsuleTrailingAddonWidth: trail }),
  };
}

const STATE = { activeGroup: 'Crew' };

describe('capsuleTrailingAddonWidth', () => {
  it('changes nothing when it is not set', () => {
    // 🔴 Every existing caller omits it. If this ever fails, the field has
    // stopped being additive and ~28 renderers moved with it.
    const before = computeLegendLayout(config(), STATE, 1200);
    expect(before.activeCapsule?.trailingAddon).toBeUndefined();
  });

  it('reserves the width inside the capsule, after the last entry', () => {
    const trail = legendEntryWidth('add a value');
    const plain = computeLegendLayout(config(), STATE, 1200).activeCapsule!;
    const withTrail = computeLegendLayout(
      config(trail),
      STATE,
      1200
    ).activeCapsule!;

    expect(withTrail.width).toBe(plain.width + trail);
    const last = plain.entries[plain.entries.length - 1]!;
    expect(withTrail.trailingAddon).toEqual({
      x: last.x + last.width!,
      y: last.y,
      width: trail,
    });
    // Inside the capsule, with the usual right padding.
    expect(withTrail.trailingAddon!.x + trail).toBe(
      withTrail.width - LEGEND_CAPSULE_PAD
    );
  });

  it('does not shift the entries it follows', () => {
    // It is a TRAILING addon; `capsulePillAddonWidth` is the one that pushes
    // entries right, and the two must not be confused.
    const trail = legendEntryWidth('add a value');
    const plain = computeLegendLayout(config(), STATE, 1200).activeCapsule!;
    const withTrail = computeLegendLayout(
      config(trail),
      STATE,
      1200
    ).activeCapsule!;
    expect(withTrail.entries.map((e) => e.x)).toEqual(
      plain.entries.map((e) => e.x)
    );
  });

  it('survives a group long enough to wrap and overflow', () => {
    // 🔴 The reason it is reserved during packing rather than added after: on a
    // group that wraps past LEGEND_MAX_ENTRY_ROWS the layout drops TRAILING
    // entries, so an addon appended as one would be the single thing removed.
    // For an authoring affordance that means having too many values deletes the
    // control that adds one.
    const trail = legendEntryWidth('add a value');
    const many: LegendGroupData = {
      name: 'Crew',
      entries: Array.from({ length: 60 }, (_, i) => ({
        value: `Watch station number ${String(i)}`,
        color: '#c0504d',
      })),
    };
    const layout = computeLegendLayout(
      {
        groups: [many],
        position: {
          placement: 'top-center',
          titleRelation: 'inline-with-title',
        },
        mode: 'preview',
        capsuleTrailingAddonWidth: trail,
      },
      STATE,
      600
    );
    const capsule = layout.activeCapsule!;
    expect(capsule.moreCount).toBeGreaterThan(0);
    expect(capsule.height).toBe(LEGEND_MAX_ENTRY_ROWS * LEGEND_HEIGHT);
    expect(capsule.trailingAddon).toBeDefined();
    expect(capsule.trailingAddon!.x + trail).toBeLessThanOrEqual(capsule.width);
  });
});

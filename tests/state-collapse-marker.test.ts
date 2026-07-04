import { describe, expect, it } from 'vitest';

import { parseState } from '../src/graph/state-parser';
import { render } from '../src/render';

const SRC = `state Order Flow

[Fulfillment] collapsed: true
  Processing
    -pack-> Shipping
  Shipping

[Resolution]
  Delivered
    -return request-> Returning

[*] -> Processing`;

describe('state `[Group] collapsed: true` marker', () => {
  it('parses the marker into a typed group field', () => {
    const groups = parseState(SRC).groups ?? [];
    const fulfillment = groups.find((g) => g.label === 'Fulfillment')!;
    const resolution = groups.find((g) => g.label === 'Resolution')!;
    expect(fulfillment.collapsed).toBe(true);
    expect(resolution.collapsed).toBeUndefined();
  });

  it('accepts a color word before the marker', () => {
    const groups =
      parseState('state\n[Fulfillment] blue collapsed: true\n  Processing')
        .groups ?? [];
    const g = groups.find((gr) => gr.label === 'Fulfillment')!;
    expect(g.collapsed).toBe(true);
    expect(g.color).toBeDefined();
  });

  it('tolerates the comma form written by the app marker helper', () => {
    // applyCollapsedMarker emits `[Group] blue, collapsed: true` when a color
    // is present — the parser must round-trip that spelling.
    const groups =
      parseState('state\n[Fulfillment] blue, collapsed: true\n  Processing')
        .groups ?? [];
    expect(groups.find((g) => g.label === 'Fulfillment')!.collapsed).toBe(true);
  });

  it('is case-insensitive on the value', () => {
    const groups =
      parseState('state\n[Fulfillment] collapsed: TRUE\n  Processing').groups ??
      [];
    expect(groups.find((g) => g.label === 'Fulfillment')!.collapsed).toBe(true);
  });

  it('render() honors the marker — collapsed group hides its inner state', async () => {
    const collapsed = await render(SRC, { palette: 'slate' });
    const expanded = await render(SRC.replace(' collapsed: true', ''), {
      palette: 'slate',
    });
    expect(expanded.svg).toContain('>Shipping<');
    expect(collapsed.svg).not.toContain('>Shipping<');
    expect(collapsed.svg).toContain('>Delivered<'); // Resolution stays expanded
  });
});

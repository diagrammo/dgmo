// live-link reference card — spec §38.7, decision #53.

import { describe, it, expect } from 'vitest';
import { parseLiveLink } from '../src/live-link/parser';
import { renderLiveLinkCard } from '../src/live-link/renderer';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;
const card = (src: string) =>
  renderLiveLinkCard(parseLiveLink(src), palette, 'light');

const TITLED = `live-link Platform architecture
url https://online.diagrammo.app/d/dgm_7f2a91`;
const SHORTHAND = 'live-link dgm_7f2a91';

describe('live-link reference card', () => {
  it('AC3: the titled form renders a card carrying title and id', () => {
    const svg = card(TITLED);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('Platform architecture');
    expect(svg).toContain('dgm_7f2a91');
    expect(svg).toContain('Live link published at Diagrammo Cloud');
  });

  it('AC3: the shorthand form headlines the id — never a blank headline', () => {
    const svg = card(SHORTHAND);
    expect(svg).toContain('dgm_7f2a91');
    // The id is the headline, so it appears exactly once — not repeated below
    // a title that isn't there.
    expect(svg.match(/dgm_7f2a91/g)).toHaveLength(1);
    expect(svg).toContain('Live link published at Diagrammo Cloud');
  });

  it('AC3: never the empty string, in either form', () => {
    for (const src of [TITLED, SHORTHAND]) {
      expect(card(src).length, src).toBeGreaterThan(200);
    }
  });

  it('renders a card even when the pointer is broken', () => {
    // The card is the file's normal appearance; an unresolvable id is the
    // resolver's story, not a reason to hand back nothing.
    const svg = card('live-link Platform architecture');
    expect(svg).toContain('<svg');
    expect(svg).toContain('Platform architecture');
  });

  it('AC4: every color in the output came from the palette', () => {
    // Palette values ARE hex — they are pre-resolved because resvg has no
    // color-mix(). So "no hex" cannot mean "no `#` in the markup"; it means no
    // color the renderer invented. This asserts the thing that actually
    // matters, and fails the moment someone hardcodes a shade.
    const fromPalette = new Set<string>();
    const collect = (v: unknown) => {
      if (typeof v === 'string' && v.startsWith('#'))
        fromPalette.add(v.toLowerCase());
      else if (v && typeof v === 'object') Object.values(v).forEach(collect);
    };
    collect(palette);

    for (const src of [TITLED, SHORTHAND]) {
      const used = card(src).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      expect(used.length, src).toBeGreaterThan(0);
      for (const color of used) {
        expect(
          fromPalette.has(color.toLowerCase()),
          `${color} is not a palette color — the card invented it`
        ).toBe(true);
      }
    }
  });

  it('scales into the canvas it is handed', () => {
    // The handler table hands every diagram type a 1200x800 sheet by default;
    // without this the card sits as a sliver in the middle of it.
    expect(card(TITLED)).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it('escapes markup in a title', () => {
    const svg = card('live-link <script>x</script> plan\nurl dgm_7f2a91');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});

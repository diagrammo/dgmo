import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  emojiIn,
  stripEmoji,
  stripEmojiFromSvg,
  emojiOmittedWarning,
} from '../src/font-coverage';
import { svgToPng } from '../src/svg-to-png';

/**
 * resvg 2.6.2 cannot draw a colour-bitmap emoji font (diagrammo/diagrammo#1423).
 * On macOS one emoji in a `<text>` turned every glyph of it — CJK and Latin —
 * into missing-glyph boxes; on Linux the emoji drew nothing. PNG export now
 * drops emoji before rasterising, and SVG output keeps them.
 */

describe('stripEmoji', () => {
  it.each([
    ['東京オフィス 🏢', '東京オフィス'],
    ['A 🏢 B', 'A B'],
    ['🏢 Office', 'Office'],
    ['x 🏢 🌸 y', 'x y'],
    ['👩‍💻 dev', 'dev'], // ZWJ sequence
    ['1️⃣ first', 'first'], // keycap
    ['🇯🇵 Japan', 'Japan'], // flag
    ['👍🏽ok', 'ok'], // skin tone
    ['☀️ sun', 'sun'], // text-default pictograph asked for emoji style (VS16)
    ['x 🏴󠁧󠁢󠁳󠁣󠁴󠁿 y', 'x y'], // subdivision flag (tag run)
  ])('%j → %j', (input, output) => {
    expect(stripEmoji(input)).toBe(output);
  });

  it.each(['©2026 ™ ★ ✔ ↔', '☀ sun', 'plain 123 #1', 'क्‍ष'])(
    'leaves text-style symbols, digits and a lone joiner alone: %j',
    (input) => {
      expect(stripEmoji(input)).toBe(input);
    }
  );
});

describe('emojiIn', () => {
  it('returns each emoji once, whole sequences intact', () => {
    expect(emojiIn('🇯🇵 👩‍💻 🏢 🏢')).toEqual(['🇯🇵', '👩‍💻', '🏢']);
  });
});

describe('stripEmojiFromSvg', () => {
  it('touches only drawn text, and keeps words apart across a tspan', () => {
    const svg =
      '<svg aria-label="a 🏢"><title>a 🏢</title>' +
      '<text x="1">東京 🏢<tspan>🌸 x</tspan></text><text>no</text></svg>';
    expect(stripEmojiFromSvg(svg)).toBe(
      '<svg aria-label="a 🏢"><title>a 🏢</title>' +
        '<text x="1">東京 <tspan> x</tspan></text><text>no</text></svg>'
    );
  });
});

describe('emojiOmittedWarning', () => {
  it('says emoji are left out of PNG', () => {
    expect(emojiOmittedWarning('a 🏢 🌸')).toMatch(
      /^Emoji are left out of PNG output \(🏢🌸\)/
    );
    expect(emojiOmittedWarning('plain')).toBeUndefined();
  });
});

describe('svgToPng drops emoji before rasterising', () => {
  const svg = (text: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40">` +
    `<text x="10" y="28" font-size="20" font-family="Inter, sans-serif">${text}</text></svg>`;
  const png = (text: string) => Buffer.from(svgToPng(svg(text), '#ffffff'));
  const PUA = '';

  let spy: ReturnType<typeof vi.spyOn>;
  beforeAll(() => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterAll(() => spy.mockRestore());

  it('Latin plus an emoji rasterises as the Latin alone', () => {
    expect(png('ABC 🏢').equals(png('ABC'))).toBe(true);
  });

  it('CJK plus an emoji rasterises as the CJK alone, not as missing glyphs', (ctx) => {
    if (png('東京オフィス').equals(png(PUA))) {
      ctx.skip(
        'no CJK system font on this machine — cannot tell CJK from boxes'
      );
    }
    expect(png('東京オフィス 🏢').equals(png('東京オフィス'))).toBe(true);
    expect(png('東京オフィス 🏢').equals(png(`${PUA} 🏢`))).toBe(false);
  });
});

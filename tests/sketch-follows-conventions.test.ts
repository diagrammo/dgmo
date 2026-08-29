import { describe, expect, it } from 'vitest';

import { getPalette } from '../src/palettes';
import { contrastText } from '../src/palettes/color-utils';
import { sketchColors, sketchContainerFill } from '../src/sketch/colors';
import { TITLE_FONT_WEIGHT } from '../src/utils/title-constants';
import { SKETCH_VISUALS } from '../src/sketch/visuals';
import {
  CONTAINER_LABEL_FONT_SIZE,
  EDGE_STROKE_WIDTH,
  HEADER_HEIGHT,
  LABEL_FONT_SIZE,
  META_FONT_SIZE,
  NODE_STROKE_WIDTH,
} from '../src/utils/visual-conventions';

// 🔴 SKETCH IS NOT A LOOK OF ITS OWN.
//
// It had drifted off the shared conventions in six places at once — stroke
// widths 2 against 1.5, a card name up to 30 against 13, a 34px header against
// 28, a 12px meta row against 11, and a container label at 19/800/0.55 against
// 13 — plus the only tag-COLOURED label in the product. Put beside a
// boxes-and-lines or an org chart of the same content it did not read as the
// same product (reported 2026-08-27).
//
// Only `nodeStrokeWidth`/`edgeStrokeWidth` were ever documented as deliberate
// ("a bolder, less-washed look"), and sketch is absent from the deviation list
// `visual-conventions.ts` keeps — so the rest was drift nobody had decided.
// This file is what makes a future deviation a decision instead.

const P = getPalette('slate').light;

describe('sketch takes the shared visual conventions', () => {
  it('uses the shared strokes, sizes and header height', () => {
    expect(SKETCH_VISUALS.nodeStrokeWidth).toBe(NODE_STROKE_WIDTH);
    expect(SKETCH_VISUALS.edgeStrokeWidth).toBe(EDGE_STROKE_WIDTH);
    expect(SKETCH_VISUALS.nodeLabelFontSize).toBe(LABEL_FONT_SIZE);
    expect(SKETCH_VISUALS.cardMetaFontSize).toBe(META_FONT_SIZE);
    expect(SKETCH_VISUALS.cardHeaderHeight).toBe(HEADER_HEIGHT);
    expect(SKETCH_VISUALS.bandLabelFontSize).toBe(CONTAINER_LABEL_FONT_SIZE);
  });

  it('does not print a container’s name louder than a node’s', () => {
    // It was 19 at weight 800 — bigger than any card's name — and faded to
    // 0.55, the only container label in the product wearing an opacity.
    expect(SKETCH_VISUALS.bandLabelFontSize).toBeLessThanOrEqual(
      SKETCH_VISUALS.nodeLabelFontSize
    );
    expect(SKETCH_VISUALS.bandLabelOpacity).toBe(1);
  });

  it('never tints a container by its tag', () => {
    // 🔴 A group used to be a wash of its own tag colour at 0.4, with everything
    // inside it swimming in that wash. `boxes-and-lines` never tints a group and
    // this is its expression — a sketch beside one of the same content has to
    // read as the same product.
    const colours = sketchColors({
      palette: P,
      isDark: false,
      tagGroups: [
        {
          name: 'Crew',
          entries: [{ value: 'Deck', lineNumber: 1 }],
          lineNumber: 1,
        } as never,
      ],
      activeTagGroup: 'Crew',
      fillMode: undefined,
    });
    const tagged = colours({ crew: 'Deck' }, true);
    const bare = colours({}, true);
    expect(tagged.fill).toBe(bare.fill);
    expect(tagged.fill).toBe(sketchContainerFill(P, false));
    expect(tagged.stroke).toBe(P.textMuted);
    // A NODE still carries its tag — only the group stopped.
    expect(colours({ crew: 'Deck' }).fill).not.toBe(bare.fill);
  });

  it('derives a label colour from its fill, like every other chart type', () => {
    // 🔴 The loudest one. `boxes-and-lines` and `org` both land on one of two
    // neutral tokens; sketch used to hand the label the TAG hue, which on the
    // 25% blend a card is filled with is pale-green text on a pale-green card.
    const colours = sketchColors({
      palette: P,
      isDark: false,
      tagGroups: [
        {
          name: 'Crew',
          entries: [{ value: 'Deck', lineNumber: 1 }],
          lineNumber: 1,
        } as never,
      ],
      activeTagGroup: 'Crew',
      fillMode: undefined,
    });
    const tagged = colours({ crew: 'Deck' });
    expect(tagged.text).toBe(
      contrastText(tagged.fill, P.textOnFillLight, P.textOnFillDark)
    );
    expect(tagged.text).not.toBe(tagged.stroke);
  });
});

describe('every visual constant is a value, not a word coerced to one', () => {
  // 🔴 `titleFontWeight` was `Number(TITLE_FONT_WEIGHT)` and the shared constant
  // is the STRING `bold`, so it shipped as `NaN`. Every other consumer writes
  // that constant straight into an SVG attribute, where the word is valid; this
  // one is read as a value by the desktop canvas, which puts it on an attribute
  // AND on an input's inline style. The result was `font-weight="NaN"` on every
  // sketch title, silently rendered at the default weight — so a sketch's name
  // was the one title in the product that was not bold, and nothing failed.
  it('SKETCH_VISUALS holds no NaN', () => {
    for (const [key, value] of Object.entries(SKETCH_VISUALS)) {
      if (typeof value === 'number') {
        expect(Number.isFinite(value), `${key} is ${String(value)}`).toBe(true);
      }
    }
  });

  it('the sketch title is bold, at the shared weight', () => {
    expect(SKETCH_VISUALS.titleFontWeight).toBe(700);
    expect(TITLE_FONT_WEIGHT).toBe('bold');
  });
});

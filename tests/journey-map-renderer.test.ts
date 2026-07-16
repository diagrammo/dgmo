import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseJourneyMap } from '../src/journey-map/parser';
import {
  renderJourneyMap,
  renderJourneyMapForExport,
} from '../src/journey-map/renderer';
import { getPalette } from '../src/palettes';
import { themeBaseBg } from '../src/palettes/color-utils';

// Set up jsdom globals
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  Object.defineProperty(globalThis, 'document', {
    value: win.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: win.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    value: win.SVGElement,
    configurable: true,
  });
});

const palette = getPalette('nord');

function renderToContainer(content: string) {
  const parsed = parseJourneyMap(content, palette.light);
  const container = document.createElement('div');
  renderJourneyMap(container, parsed, palette.light, false);
  return { container, parsed };
}

// ── SVG structure ─────────────────────────────────────────

describe('journey-map renderer', () => {
  const fullInput = `journey-map Buying a Laptop

persona Tech-Savvy Shopper
  28yo developer

tag Channel as ch
  Web blue
  Mobile purple

[Research]
  Compare specs score: 4, ch: Web
  Watch reviews score: 5, emotion: Engaged, ch: Mobile

[Purchase]
  Add to cart score: 3, ch: Web
  Forced account creation score: 1, emotion: Frustrated, ch: Web
    pain: Wants guest checkout
  Complete payment score: 3, ch: Web`;

  describe('SVG structure', () => {
    it('renders SVG element', () => {
      const { container } = renderToContainer(fullInput);
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('renders phase groups', () => {
      const { container } = renderToContainer(fullInput);
      const phases = container.querySelectorAll('.journey-phase');
      expect(phases).toHaveLength(2);
    });

    it('renders step groups', () => {
      const { container } = renderToContainer(fullInput);
      const steps = container.querySelectorAll('.journey-step');
      expect(steps).toHaveLength(5);
    });

    it('renders curve area', () => {
      const { container } = renderToContainer(fullInput);
      const curveArea = container.querySelector('.journey-curve-area');
      expect(curveArea).toBeTruthy();
    });

    it('renders emotion curve path', () => {
      const { container } = renderToContainer(fullInput);
      const paths = container.querySelectorAll('.journey-curve-area path');
      // Area fill + line stroke
      expect(paths.length).toBeGreaterThanOrEqual(2);
      // Area fill path should have a non-empty d attribute
      const areaPath = paths[0];
      expect(areaPath.getAttribute('d')).toBeTruthy();
    });
  });

  // ── Emotion labels ──────────────────────────────────────

  describe('emotion labels', () => {
    const emoInput = `journey-map Checkout

[Flow]
  Browse score: 5, emotion: Delighted
  Forced login score: 1, emotion: Frustrated
  No feeling score: 3`;

    it('captions each scored step that has an emotion label', () => {
      const { container } = renderToContainer(emoInput);
      const labels = container.querySelectorAll('.journey-emotion-label');
      const texts = [...labels].map((l) => l.textContent);
      expect(texts).toContain('Delighted');
      expect(texts).toContain('Frustrated');
      // Step without an emotion gets no caption
      expect(labels).toHaveLength(2);
    });

    it('always places captions below the face (clear of the hover bubble above)', () => {
      const { container } = renderToContainer(emoInput);
      const faces = [...container.querySelectorAll('.journey-face')];
      const labelY = (emotion: string): number => {
        const g = faces.find(
          (f) =>
            f.querySelector('.journey-emotion-label')?.textContent === emotion
        )!;
        const cy = parseFloat(g.querySelector('circle')!.getAttribute('cy')!);
        const ly = parseFloat(
          g.querySelector('.journey-emotion-label')!.getAttribute('y')!
        );
        return ly - cy;
      };
      // The thought bubble always pops above the face, so captions sit below
      // (positive offset) for both high and low scores to stay visible on hover.
      expect(labelY('Delighted')).toBeGreaterThan(0);
      expect(labelY('Frustrated')).toBeGreaterThan(0);
    });
  });

  // ── Grid lines ──────────────────────────────────────────

  describe('grid lines', () => {
    it('renders 5 grid lines at score levels', () => {
      const { container } = renderToContainer(fullInput);
      const gridLines = container.querySelectorAll('.journey-curve-area line');
      expect(gridLines).toHaveLength(5);
    });
  });

  // ── Legend ──────────────────────────────────────────────

  describe('legend', () => {
    it('renders tag legend when tag groups exist', () => {
      const { container } = renderToContainer(fullInput);
      const tagLegend = container.querySelector('.journey-legend');
      expect(tagLegend).toBeTruthy();
    });
  });

  // ── Persona ─────────────────────────────────────────────

  describe('persona', () => {
    it('renders persona header', () => {
      const { container } = renderToContainer(fullInput);
      const persona = container.querySelector('.journey-persona');
      expect(persona).toBeTruthy();
    });
  });

  // ── data-line-number ────────────────────────────────────

  describe('data-line-number', () => {
    it('steps have data-line-number', () => {
      const { container } = renderToContainer(fullInput);
      const steps = container.querySelectorAll(
        '.journey-step[data-line-number]'
      );
      expect(steps.length).toBeGreaterThan(0);
    });

    it('phases have data-line-number', () => {
      const { container } = renderToContainer(fullInput);
      const phases = container.querySelectorAll(
        '.journey-phase[data-line-number]'
      );
      expect(phases.length).toBeGreaterThan(0);
    });
  });

  // ── Flat mode ──────────────────────────────────────────

  describe('flat mode', () => {
    it('renders steps without phase wrappers', () => {
      const input = `journey-map Quick
Opened app score: 4
Searched score: 3
Hit error score: 1`;
      const { container } = renderToContainer(input);
      const phases = container.querySelectorAll('.journey-phase');
      expect(phases).toHaveLength(0);
      const steps = container.querySelectorAll('.journey-step');
      expect(steps).toHaveLength(3);
    });
  });

  // ── Single step edge case ─────────────────────────────

  describe('edge cases', () => {
    it('single scored step: card and face icon, no curve area path', () => {
      const input = `journey-map Test

[Phase]
  Only step score: 4`;
      const { container } = renderToContainer(input);
      const steps = container.querySelectorAll('.journey-step');
      expect(steps).toHaveLength(1);
      // Face icon renders on the curve (has a mouth path) but no area fill path
      const faces = container.querySelectorAll(
        '.journey-curve-area .journey-face'
      );
      expect(faces).toHaveLength(1);
      // No area fill or line stroke paths (only the face mouth path)
      const areaPaths = container.querySelectorAll(
        '.journey-curve-area > path'
      );
      expect(areaPaths).toHaveLength(0);
    });

    it('empty phase renders header only', () => {
      const input = `journey-map Test

[Empty]

[Full]
  Step score: 3`;
      const { container } = renderToContainer(input);
      const phases = container.querySelectorAll('.journey-phase');
      expect(phases).toHaveLength(2);
      // First phase has no step children
      const emptyPhaseSteps = phases[0].querySelectorAll('.journey-step');
      expect(emptyPhaseSteps).toHaveLength(0);
    });
  });

  // ── Interactive: focus scaling + thought-bubble placement ──

  describe('interactive', () => {
    it('focus scales only the face icon, never the emotion caption', () => {
      const input = `journey-map Focus

[Phase]
  Calm score: 5, emotion: Happy
  Crash score: 1, emotion: Terrified`;
      const { container } = renderToContainer(input);
      const face = container.querySelector(
        '.journey-curve-area .journey-face[data-score="1"]'
      )!;
      face.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

      // The inner icon group carries the scale transform...
      const icon = face.querySelector('.journey-face-icon')!;
      expect(icon.getAttribute('transform')).toContain('scale');
      // ...while the caption stays at its base size/position (no transform).
      const label = face.querySelector('.journey-emotion-label')!;
      expect(label.getAttribute('transform')).toBeNull();
    });

    it('keeps the expanded thought bubble above the face and clear of the persona card', () => {
      const input = `journey-map Bubble

persona Sam color: blue
  Greenhorn cabin boy, first time at sea
  Sworn to the crew but quietly terrified

[Phase]
  Dip score: 1, emotion: Sad
  Climb score: 4, emotion: Hopeful
  Peak score: 5, emotion: Proud
    thought: Three doubloons hidden where only he can find them`;
      const { container } = renderToContainer(input);

      const face = container.querySelector('.journey-face[data-thought]')!;
      face.dispatchEvent(
        new window.MouseEvent('mouseenter', { bubbles: true })
      );

      const bubble = container.querySelector('.journey-thought-hover rect')!;
      const persona = container.querySelector('.journey-persona rect')!;
      const num = (el: Element, a: string) => parseFloat(el.getAttribute(a)!);

      const bx = num(bubble, 'x');
      const by = num(bubble, 'y');
      const bw = num(bubble, 'width');
      const bh = num(bubble, 'height');
      const px = num(persona, 'x');
      const py = num(persona, 'y');
      const pw = num(persona, 'width');
      const ph = num(persona, 'height');

      // Bubble sits above the face and clears the persona card (the layout
      // reserves top headroom to make room).
      const fcy = num(face, 'data-cy');
      expect(by).toBeLessThan(fcy);
      const overlaps =
        bx < px + pw && bx + bw > px && by < py + ph && by + bh > py;
      expect(overlaps).toBe(false);
    });
  });

  // ── fill-outline (§1.9 fill family) ───────────────────

  describe('fill-outline', () => {
    const outlineInput = `journey-map Outline Voyage
fill-outline

persona Sam
  Greenhorn cabin boy

[Flow]
  Set sail score: 5, emotion: Thrilled
  Storm hits score: 1, emotion: Terrified`;

    const tintInput = outlineInput.replace('\nfill-outline', '');
    const lightBase = themeBaseBg(palette.light, false);

    it('emotion faces render hollow: theme-bg disc, colored ring intact', () => {
      const { container } = renderToContainer(outlineInput);
      // The ring is the only stroked circle per face (halo + eyes have no stroke).
      const rings = container.querySelectorAll(
        '.journey-face-icon circle[stroke]'
      );
      expect(rings.length).toBeGreaterThan(0);
      for (const ring of rings) {
        expect(ring.getAttribute('fill')).toBe(lightBase);
        const stroke = ring.getAttribute('stroke');
        expect(stroke).toBeTruthy();
        expect(stroke).not.toBe(lightBase);
      }
    });

    it('default (tint) faces keep the tinted disc', () => {
      const { container } = renderToContainer(tintInput);
      const ring = container.querySelector(
        '.journey-face-icon circle[stroke]'
      )!;
      expect(ring.getAttribute('fill')).not.toBe(lightBase);
    });

    it('dark mode hollows the face to surface (theme base bg), not page bg', () => {
      const parsed = parseJourneyMap(outlineInput, palette.dark);
      const container = document.createElement('div');
      renderJourneyMap(container, parsed, palette.dark, true);
      const ring = container.querySelector(
        '.journey-face-icon circle[stroke]'
      )!;
      expect(ring.getAttribute('fill')).toBe(themeBaseBg(palette.dark, true));
      expect(themeBaseBg(palette.dark, true)).toBe(palette.dark.surface);
    });

    it('persona silhouette renders hollow: theme-bg fill, colored stroke', () => {
      const { container } = renderToContainer(outlineInput);
      // Torso + head paths live in the clipped group inside the persona card.
      const silPaths = container.querySelectorAll(
        '.journey-persona g[clip-path] path'
      );
      expect(silPaths).toHaveLength(2);
      for (const p of silPaths) {
        expect(p.getAttribute('fill')).toBe(lightBase);
        // No persona color declared → silhouette stroke is textMuted.
        expect(p.getAttribute('stroke')).toBe(palette.light.textMuted);
      }
    });

    it('persona silhouette keeps its 70% mix fill in default mode', () => {
      const { container } = renderToContainer(tintInput);
      const silPath = container.querySelector(
        '.journey-persona g[clip-path] path'
      )!;
      expect(silPath.getAttribute('fill')).not.toBe(lightBase);
    });

    it('emotion gradient band drops to theme base bg; curve stroke carries the color', () => {
      const { container } = renderToContainer(outlineInput);
      // Direct-child paths of the curve group: [area, frame, curve line].
      const paths = container.querySelectorAll('.journey-curve-area > path');
      expect(paths).toHaveLength(3);
      expect(paths[0].getAttribute('fill')).toBe(lightBase);
      const line = paths[2];
      expect(line.getAttribute('stroke')).toBe(palette.light.primary);
      expect(
        parseFloat(line.getAttribute('stroke-width')!)
      ).toBeGreaterThanOrEqual(2);
    });

    it('default render keeps the gradient url fill on the area band', () => {
      const { container } = renderToContainer(tintInput);
      const areaPath = container.querySelector('.journey-curve-area > path')!;
      expect(areaPath.getAttribute('fill')).toBe(
        'url(#journey-curve-gradient)'
      );
    });
  });

  // ── Export function ───────────────────────────────────

  describe('export', () => {
    it('returns valid SVG string', () => {
      const svg = renderJourneyMapForExport(fullInput, 'light', palette.light);
      expect(svg).toBeTruthy();
      expect(svg.startsWith('<svg')).toBe(true);
    });

    it('returns empty string for invalid input', () => {
      const svg = renderJourneyMapForExport('', 'light', palette.light);
      expect(svg).toBe('');
    });
  });
});

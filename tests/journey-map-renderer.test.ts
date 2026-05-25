import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseJourneyMap } from '../src/journey-map/parser';
import {
  renderJourneyMap,
  renderJourneyMapForExport,
} from '../src/journey-map/renderer';
import { getPalette } from '../src/palettes';

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

tag Channel ch
  Web blue
  Mobile purple

[Research]
  Compare specs | 4, ch: Web
  Watch reviews | 5 Engaged, ch: Mobile

[Purchase]
  Add to cart | 3, ch: Web
  Forced account creation | 1 Frustrated, ch: Web
    pain: Wants guest checkout
  Complete payment | 3, ch: Web`;

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
Opened app | 4
Searched | 3
Hit error | 1`;
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
  Only step | 4`;
      const { container } = renderToContainer(input);
      const steps = container.querySelectorAll('.journey-step');
      expect(steps).toHaveLength(1);
      // Face icon renders on the curve (has a mouth path) but no area fill path
      // 5 score-label faces + 1 curve-point face = 6
      const faces = container.querySelectorAll(
        '.journey-curve-area .journey-face'
      );
      expect(faces).toHaveLength(6);
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
  Step | 3`;
      const { container } = renderToContainer(input);
      const phases = container.querySelectorAll('.journey-phase');
      expect(phases).toHaveLength(2);
      // First phase has no step children
      const emptyPhaseSteps = phases[0].querySelectorAll('.journey-step');
      expect(emptyPhaseSteps).toHaveLength(0);
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

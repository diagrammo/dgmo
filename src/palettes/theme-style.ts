// ============================================================
// Theme style — corner radius, line weight, canvas (diagrammo/diagrammo#1836)
// ============================================================
//
// A theme file may carry three fields beside its colours: `radius`,
// `strokeWeight` and `background`. They are applied to the FINISHED SVG, once,
// in `render()`, rather than threaded into fifty renderers: every chart type
// writes its corners as `<rect rx>` and its lines as `stroke-width`, so one
// rewrite reaches all of them and no renderer has to know themes exist.
//
// 🔴 Absent means byte-identical. `applyThemeStyle` returns its input string
// untouched when no field asks for a change, and a field set to its own
// default (radius = CARD_RADIUS, strokeWeight = NODE_STROKE_WIDTH) is no
// change. `tests/theme-style.test.ts` holds both.
//
// Scaling, not replacing: a theme states the value for the STANDARD card
// corner and the STANDARD line, and every other corner and line moves by the
// same ratio. A pill (rx = height / 2) stays a pill, because SVG clamps an rx
// past half the side; a hairline stays thinner than an emphasis edge.
//
// Left alone on purpose: text strokes (halos keep their legibility whatever the
// line weight), `<ellipse>` and `<circle>` (their rx is the shape, not a
// corner), `<style>` blocks (hover rules), and strokes that never wrote a width
// (the SVG default of 1 has nothing to scale).

import { CARD_RADIUS, NODE_STROKE_WIDTH } from '../utils/visual-conventions';
import type { PaletteConfig } from './types';

/** Accepted range of each numeric field, in px. */
export const THEME_STYLE_RANGES = {
  radius: { min: 0, max: 32 },
  strokeWeight: { min: 0.25, max: 6 },
} as const;

export type ThemeStyle = Pick<
  PaletteConfig,
  'radius' | 'strokeWeight' | 'background'
>;

/** A start tag, its attributes quoted (a `>` inside a label stays inside). */
const TAG_RE =
  /<([a-zA-Z][\w:-]*)((?:\s+[^\s=>"'/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)(\s*\/?)>/g;

const TEXT_TAGS: ReadonlySet<string> = new Set(['text', 'tspan', 'textPath']);

function scaled(value: string, factor: number): string {
  return String(Number((Number(value) * factor).toFixed(3)));
}

function scaleAttrs(attrs: string, names: RegExp, factor: number): string {
  return attrs.replace(
    names,
    (_m, lead: string, name: string, q: string, v: string) =>
      `${lead}${name}=${q}${scaled(v, factor)}${q}`
  );
}

const STROKE_ATTR_RE = /(\s)(stroke-width)=(["'])([\d.]+)\3/g;
const STROKE_STYLE_RE = /(stroke-width\s*:\s*)([\d.]+)/g;
const RADIUS_ATTR_RE = /(\s)(rx|ry)=(["'])([\d.]+)\3/g;
const STYLE_ATTR_RE = /(\sstyle=)(["'])([^"']*)\2/;

/**
 * Apply a theme's style fields to a finished SVG. Returns `svg` itself when
 * nothing applies, so a theme without the fields is byte-identical.
 */
export function applyThemeStyle(
  svg: string,
  style: ThemeStyle | undefined
): string {
  if (!style) return svg;
  const radiusFactor =
    style.radius !== undefined && style.radius !== CARD_RADIUS
      ? style.radius / CARD_RADIUS
      : 1;
  const strokeFactor =
    style.strokeWeight !== undefined && style.strokeWeight !== NODE_STROKE_WIDTH
      ? style.strokeWeight / NODE_STROKE_WIDTH
      : 1;
  let out = svg;
  if (radiusFactor !== 1 || strokeFactor !== 1) {
    out = out.replace(
      TAG_RE,
      (tag: string, name: string, attrs: string, end: string) => {
        let next = attrs;
        if (radiusFactor !== 1 && name === 'rect') {
          next = scaleAttrs(next, RADIUS_ATTR_RE, radiusFactor);
        }
        if (strokeFactor !== 1 && !TEXT_TAGS.has(name)) {
          next = scaleAttrs(next, STROKE_ATTR_RE, strokeFactor);
          next = next.replace(
            STYLE_ATTR_RE,
            (_m, lead: string, q: string, css: string) =>
              `${lead}${q}${css.replace(
                STROKE_STYLE_RE,
                (_s, k: string, v: string) => `${k}${scaled(v, strokeFactor)}`
              )}${q}`
          );
        }
        return next === attrs ? tag : `<${name}${next}${end}>`;
      }
    );
  }
  if (style.background === 'transparent') out = stripCanvas(out);
  return out;
}

/**
 * Remove the canvas: the `dgmo-canvas-bg` rect `paintRootBackground` paints,
 * and the root `<svg>`'s CSS background — what a `transparent` render leaves
 * out, while every other colour stays the mode's own.
 */
export function stripCanvas(svg: string): string {
  return svg
    .replace(
      /<rect\b[^>]*\bclass="[^"]*\bdgmo-canvas-bg\b[^"]*"[^>]*>(?:<\/rect>)?/g,
      ''
    )
    .replace(/<svg\b[^>]*>/, (root) =>
      root.replace(
        /(\sstyle="[^"]*?)background(?:-color)?\s*:[^;"]*/,
        '$1background: none'
      )
    );
}

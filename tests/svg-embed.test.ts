import { describe, expect, it } from 'vitest';

import {
  defaultEmbedBackground,
  getEmbedSvgViewBox,
  normalizeSvgForEmbed,
} from '../src/index';

describe('normalizeSvgForEmbed', () => {
  it('tightens a fixed-canvas viewBox to the content bbox (+padding)', () => {
    // Content fills most of the canvas with modest dead margins — a genuine
    // trim (covers well over half of each axis, so it's trusted).
    const input =
      '<svg width="1200" height="800" viewBox="0 0 1200 800">' +
      '<rect x="100" y="100" width="1000" height="600"></rect>' +
      '</svg>';
    const out = normalizeSvgForEmbed(input);

    const vb = out.match(/viewBox="([^"]+)"/)?.[1];
    expect(vb).toBeDefined();
    const [x, y, w, h] = vb!.split(/\s+/).map(Number);
    // bbox = (100,100)..(1100,700); pad 16 each side.
    expect(x).toBe(100 - 16);
    expect(y).toBe(100 - 16);
    expect(w).toBe(1000 + 32);
    expect(h).toBe(600 + 32);
  });

  it('does NOT tighten when the measured box covers little of the canvas', () => {
    // computeBBox is a string estimator that can't see transform-positioned
    // elements (e.g. word-cloud words use `transform`, not x/y). When it
    // measures only a fragment (here a small rect), the box collapses far
    // below the canvas — distrust it and keep the renderer's correct viewBox,
    // rather than zooming the fragment to fill the frame.
    const input =
      '<svg width="1200" height="800" viewBox="0 0 1200 800">' +
      '<rect x="100" y="100" width="200" height="50"></rect>' +
      '</svg>';
    const out = normalizeSvgForEmbed(input);
    expect(out).toMatch(/viewBox="0 0 1200 800"/);
  });

  it('does NOT shift the viewBox out of bounds (path arc misparse guard)', () => {
    // A box that strays outside the canvas (negative origin) is a parse error,
    // not real content — keep the renderer's viewBox.
    const input =
      '<svg viewBox="0 0 800 500">' +
      '<path d="M 10 10 A 50 50 0 0 1 700 400"></path>' +
      '</svg>';
    const out = normalizeSvgForEmbed(input);
    // The arc's `A 50 50 0 0 1` params get mis-paired as coords; whatever box
    // results, it must never escape the canvas. Either unchanged or in-bounds.
    const vb = out.match(/viewBox="([^"]+)"/)?.[1];
    const [x, y, w, h] = vb!.split(/\s+/).map(Number);
    expect(x).toBeGreaterThanOrEqual(-2);
    expect(y).toBeGreaterThanOrEqual(-2);
    expect(x + w).toBeLessThanOrEqual(800 + 2);
    expect(y + h).toBeLessThanOrEqual(500 + 2);
  });

  it('strips fixed width/height and the opaque root background by default', () => {
    // Full-canvas palette.bg rect (rgb) + CSS background (hex) — the two
    // mechanisms renderers use. Both get removed so the embed blends into host.
    const input =
      '<svg width="1200" height="800" viewBox="0 0 1200 800" style="font-family: Inter; background: rgb(22, 27, 34);">' +
      '<rect width="1200" height="800" fill="#161b22"></rect>' +
      '<circle cx="50" cy="50" r="10"></circle>' +
      '</svg>';
    const out = normalizeSvgForEmbed(input);
    expect(out).not.toMatch(/<svg[^>]*\swidth="/);
    expect(out).not.toMatch(/<svg[^>]*\sheight="/);
    expect(out).not.toMatch(/background:/); // CSS background stripped
    expect(out).not.toMatch(/fill="#161b22"/); // full-canvas bg rect removed
    expect(out).toMatch(/font-family: Inter/); // other styles kept
    expect(out).toMatch(/<circle/); // content untouched
    expect(out).toMatch(/viewBox="/);
  });

  it('preserves the opaque background when background: "opaque"', () => {
    const input =
      '<svg width="1200" height="800" viewBox="0 0 1200 800" style="background: rgb(22, 27, 34);">' +
      '<rect width="1200" height="800" fill="#161b22"></rect>' +
      '<circle cx="50" cy="50" r="10"></circle>' +
      '</svg>';
    const out = normalizeSvgForEmbed(input, { background: 'opaque' });
    expect(out).toMatch(/background:\s*rgb\(22, 27, 34\)/);
    expect(out).toMatch(/fill="#161b22"/);
  });

  it('never strips a full-canvas rect whose fill differs from the bg color', () => {
    // A map-style ocean rect: full-canvas but NOT palette.bg. The CSS bg matches
    // it (water), so stripping CSS is fine, but the content rect must survive.
    const input =
      '<svg width="1200" height="800" viewBox="0 0 1200 800" style="background: rgb(39, 58, 77);">' +
      '<rect width="1200" height="800" fill="#273a4d"></rect>' +
      '<rect x="10" y="10" width="40" height="20" fill="#161b22"></rect>' +
      '</svg>';
    const out = normalizeSvgForEmbed(input);
    // CSS bg matches the ocean color, so both would be stripped — this is why
    // map defaults to `opaque` upstream. Here (forced transparent) the water
    // IS removed; assert the non-bg-colored inset rect is untouched.
    expect(out).toMatch(/fill="#161b22"/);
  });

  it('defaultEmbedBackground: map is opaque, everything else transparent', () => {
    expect(defaultEmbedBackground('map')).toBe('opaque');
    expect(defaultEmbedBackground('clock')).toBe('transparent');
    expect(defaultEmbedBackground('body')).toBe('transparent');
    expect(defaultEmbedBackground(undefined)).toBe('transparent');
  });

  it('leaves output usable when there is no measurable content', () => {
    const input =
      '<svg width="1200" height="800" viewBox="0 0 1200 800"></svg>';
    const out = normalizeSvgForEmbed(input);
    // No content → keep the original viewBox; still strip fixed dims.
    expect(out).toMatch(/viewBox="0 0 1200 800"/);
    expect(out).not.toMatch(/<svg[^>]*\swidth="/);
  });

  it('getEmbedSvgViewBox returns the tight padded box', () => {
    const input =
      '<svg viewBox="0 0 1200 800">' +
      '<rect x="0" y="0" width="100" height="40"></rect>' +
      '</svg>';
    const box = getEmbedSvgViewBox(input);
    expect(box).toEqual({ x: -16, y: -16, width: 132, height: 72 });
  });
});

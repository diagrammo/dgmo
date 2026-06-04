import { describe, expect, it } from 'vitest';

import { getEmbedSvgViewBox, normalizeSvgForEmbed } from '../src/index';

describe('normalizeSvgForEmbed', () => {
  it('tightens a fixed-canvas viewBox to the content bbox (+padding)', () => {
    // Content occupies y 100..150 within an 800-tall canvas — the classic
    // "short diagram, tons of dead space" case.
    const input =
      '<svg width="1200" height="800" viewBox="0 0 1200 800">' +
      '<rect x="100" y="100" width="200" height="50"></rect>' +
      '</svg>';
    const out = normalizeSvgForEmbed(input);

    const vb = out.match(/viewBox="([^"]+)"/)?.[1];
    expect(vb).toBeDefined();
    const [x, y, w, h] = vb!.split(/\s+/).map(Number);
    // bbox = (100,100)..(300,150); pad 16 each side.
    expect(x).toBe(100 - 16);
    expect(y).toBe(100 - 16);
    expect(w).toBe(200 + 32);
    expect(h).toBe(50 + 32);
    // Content aspect, not the 1200/800 canvas aspect.
    expect(w / h).toBeCloseTo(232 / 82, 5);
  });

  it('strips fixed width/height and inline background', () => {
    const input =
      '<svg width="1200" height="800" viewBox="0 0 1200 800" style="background:#fff;">' +
      '<circle cx="50" cy="50" r="10"></circle>' +
      '</svg>';
    const out = normalizeSvgForEmbed(input);
    expect(out).not.toMatch(/<svg[^>]*\swidth="/);
    expect(out).not.toMatch(/<svg[^>]*\sheight="/);
    expect(out).not.toMatch(/background:/);
    expect(out).toMatch(/viewBox="/);
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

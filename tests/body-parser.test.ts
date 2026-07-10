import { describe, it, expect } from 'vitest';
import { parseBody } from '../src/body/parser';

const codes = (src: string): string[] =>
  parseBody(src).diagnostics.map((d) => d.code ?? '');

describe('body parser — header + figure defaults', () => {
  it('parses the title from the header line', () => {
    const p = parseBody('body Push Day');
    expect(p.error).toBeFalsy();
    expect(p.title).toBe('Push Day');
    expect(p.diagnostics).toHaveLength(0);
  });

  it('defaults to muscle / male / front when no directives are given', () => {
    const p = parseBody('body');
    expect(p.options.form).toBe('muscle');
    expect(p.options.sex).toBe('male');
    expect(p.options.views).toEqual(['front']);
    expect(p.parts).toHaveLength(0);
  });
});

describe('body parser — bare directives', () => {
  it('`skin`, `female`, `back` set form / sex / view', () => {
    const p = parseBody(`body
skin
female
back`);
    expect(p.options.form).toBe('skin');
    expect(p.options.sex).toBe('female');
    expect(p.options.views).toEqual(['back']);
  });

  it('naming both `front` and `back` yields both views', () => {
    const p = parseBody(`body
front
back`);
    expect(p.options.views).toEqual(['front', 'back']);
  });
});

describe('body parser — parts', () => {
  it('a catalog name becomes a part', () => {
    const p = parseBody(`body
muscle
chest`);
    expect(p.parts).toHaveLength(1);
    expect(p.parts[0]!.name).toBe('chest');
    expect(
      codes(`body
muscle
chest`)
    ).not.toContain('W_BODY_UNKNOWN_PART');
  });

  it('gym aliases resolve without an unknown-part warning', () => {
    const src = `body
muscle
pecs
quads`;
    const p = parseBody(src);
    expect(p.parts.map((x) => x.name)).toEqual(['pecs', 'quads']);
    expect(codes(src)).not.toContain('W_BODY_UNKNOWN_PART');
  });

  it('trailing tag metadata attaches to the part', () => {
    const p = parseBody(`body
chest e: Primary`);
    expect(p.parts[0]!.metadata['e']).toBe('Primary');
  });

  it('an indented note under a part is captured', () => {
    const p = parseBody(`body
chest
  Primary mover in the bench press`);
    expect(p.parts[0]!.notes).toEqual(['Primary mover in the bench press']);
  });

  it('an unknown part warns without throwing and the rest still parses', () => {
    const src = `body
chest
bogus-muscle-xyz`;
    const p = parseBody(src);
    expect(p.error).toBeFalsy();
    expect(codes(src)).toContain('W_BODY_UNKNOWN_PART');
    expect(p.parts.map((x) => x.name)).toEqual(['chest', 'bogus-muscle-xyz']);
  });
});

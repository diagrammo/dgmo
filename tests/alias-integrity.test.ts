// The eight TD-18 alias integrity rules — issue #200.
//
// Spec §2A.2 locked these rules; §2A.6 recorded, on 2026-08-12, that NONE of
// them was enforced anywhere in the library. A collision, an out-of-order
// reference, an alias-of-alias and an over-length alias all parsed without a
// single diagnostic, and the over-length one additionally failed the `as` peel
// silently, so `Alice as thirteencharss` produced an entity literally named
// "Alice as thirteencharss".
//
// Two halves are tested here, because the enforcement has two halves:
//
//   - the SYNTAX rules ride in the shared peel, so they fire for every chart
//     type — including the ones with no alias namespace to speak of;
//   - the NAMESPACE rules need a whole source, so they fire in the parsers
//     that keep an `AliasRegistry`.
//
// The false-positive cases at the bottom are the load-bearing half of this
// file. Enforcement that fires on valid diagrams is worse than none: the four
// shapes below all appear in real diagrams, and three of them were caught by
// running the workspace's 1,533 `.dgmo` files through the rules before the
// first commit.

import { describe, it, expect } from 'vitest';
import { parseDgmo } from '../src/dgmo-router';
import { AliasRegistry, checkAliasSyntax } from '../src/utils/alias-registry';

const codes = (src: string): string[] =>
  parseDgmo(src)
    .diagnostics.filter((d) => d.code?.startsWith('E_ALIAS_'))
    .map((d) => `${d.code}@${d.line}`);

describe('alias syntax rules — every chart type', () => {
  it('reports an over-length alias instead of folding it into the name', () => {
    expect(codes('org\nAlice as thirteencharss\n')).toEqual([
      'E_ALIAS_INVALID_FORMAT@2',
    ]);
  });

  it('reports a hyphen and a digit start', () => {
    expect(codes('org\nAlice as pm-cluster\n')).toEqual([
      'E_ALIAS_INVALID_FORMAT@2',
    ]);
    expect(codes('org\nAlice as 1pm\n')).toEqual(['E_ALIAS_INVALID_FORMAT@2']);
  });

  it('reports a grammar keyword and a chart-type token', () => {
    expect(codes('org\nAlice as tag\n')).toEqual([
      'E_ALIAS_RESERVED_KEYWORD@2',
    ]);
    expect(codes('org\nAlice as venn\n')).toEqual([
      'E_ALIAS_RESERVED_KEYWORD@2',
    ]);
  });

  it('leaves an article alone — `Alice as a` is valid (§2A.2)', () => {
    expect(codes('org\nAlice as a\n')).toEqual([]);
    expect(codes('org\nAlice as an\n')).toEqual([]);
  });

  it('fires on a chart type with no alias namespace of its own', () => {
    // mindmap peels aliases through the shared cut and keeps no registry, so
    // this is the case the syntax half exists to cover.
    expect(codes('mindmap\nRoot\n  Child as pm-cluster\n')).toEqual([
      'E_ALIAS_INVALID_FORMAT@3',
    ]);
  });
});

describe('alias namespace rules', () => {
  it('reports one alias bound to two names', () => {
    expect(codes('boxes-and-lines\nAlice as a\nBob as a\n')).toEqual([
      'E_ALIAS_COLLISION@3',
    ]);
  });

  it('reports one name carrying two aliases', () => {
    expect(codes('boxes-and-lines\nAlice as a\nAlice as al\n')).toEqual([
      'E_ALIAS_REBINDING@3',
    ]);
  });

  it('reports an alias that shadows another entity’s name', () => {
    expect(codes('boxes-and-lines\nAlice as Bob\nBob\n')).toEqual([
      'E_ALIAS_SHADOWS_NAME@2',
    ]);
  });

  it('reports an alias of an alias', () => {
    expect(codes('boxes-and-lines\nAlice as a\na as b\n')).toEqual([
      'E_ALIAS_OF_ALIAS@3',
    ]);
  });

  it('reports a reference above its declaration', () => {
    expect(codes('boxes-and-lines\nAlice\na -> b\nBob as b\n')).toEqual([
      'E_ALIAS_BEFORE_DECL@3',
    ]);
  });

  it('reports an alias declared after the name was already used', () => {
    expect(codes('boxes-and-lines\nAlice\nBob\nAlice as a\n')).toEqual([
      'E_ALIAS_AFTER_CANONICAL@4',
    ]);
  });

  it('reaches the other parsers that own an alias namespace', () => {
    expect(
      codes('sequence\nAlice is an actor as a\nBob is a database as a\n')
    ).toEqual(['E_ALIAS_COLLISION@3']);
    expect(
      codes('er\nusers as u\n  id int pk\norders as u\n  id int pk\n')
    ).toEqual(['E_ALIAS_COLLISION@4']);
    expect(codes('infra\nGateway as gw\nOrigin as gw\n')).toEqual([
      'E_ALIAS_COLLISION@3',
    ]);
  });
});

describe('valid diagrams stay silent', () => {
  it('accepts a declaration and a reference in order', () => {
    expect(codes('boxes-and-lines\nAlice as a\nBob as b\na -> b\n')).toEqual(
      []
    );
  });

  it('accepts an alias that is a slug of its own name', () => {
    // `CDN as cdn` binds the alias to the node id, which IS `cdn` — so the
    // alias equals its own canonical. Reported as an alias-of-alias and then
    // as a shadow until both rules learned to exclude the declaration under
    // test; caught on a real diagram, not in review.
    expect(codes('infra\nCDN as cdn\n  t: Edge\n')).toEqual([]);
  });

  it('leaves SaaS naming alone', () => {
    // The alias token has to reach end-of-line, which is what makes these
    // names safe (§2A.2).
    expect(codes('boxes-and-lines\nStorage as a Service\n')).toEqual([]);
    expect(codes('boxes-and-lines\nBackend as a Service\n')).toEqual([]);
  });

  it('leaves prose in a metadata value alone', () => {
    // The check runs on the NAME region, after the metadata cut — a value
    // ending in `… as a boy` is not an alias attempt.
    expect(
      codes(
        'journey-map\nA Trip\n  Stage One\n    opportunity: signs on as a boy\n'
      )
    ).toEqual([]);
  });
});

describe('AliasRegistry, directly', () => {
  it('dates a reference by the cursor when no line is given', () => {
    const aliases = new AliasRegistry();
    aliases.at(9);
    aliases.resolve('a');
    aliases.declare('a', 'Alice', 12);
    expect(aliases.finish().map((d) => `${d.code}@${d.line}`)).toEqual([
      'E_ALIAS_BEFORE_DECL@9',
    ]);
  });

  it('does not record a reference for a lookup', () => {
    const aliases = new AliasRegistry();
    aliases.at(9);
    aliases.lookup('a');
    aliases.declare('a', 'Alice', 12);
    expect(aliases.finish()).toEqual([]);
  });

  it('reports nothing for a name region with no alias attempt', () => {
    expect(checkAliasSyntax('Alice Park', undefined, 1)).toEqual([]);
  });
});

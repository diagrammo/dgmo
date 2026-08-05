// live-link parser — spec §38, decision #53.
//
// One case per row of the diagnostics table, both happy-path forms, a file
// carrying the generated comment block, and the empty-content exemption — which
// is the first test `detectEmptyContent` has ever had (it is module-private, so
// it can only be reached through `parseDgmo`).

import { describe, it, expect } from 'vitest';
import { parseLiveLink } from '../src/live-link/parser';
import { parseDgmo } from '../src/dgmo-router';

const errors = (r: { diagnostics: readonly { severity: string }[] }) =>
  r.diagnostics.filter((d) => d.severity === 'error');
const warnings = (r: { diagnostics: readonly { severity: string }[] }) =>
  r.diagnostics.filter((d) => d.severity === 'warning');

describe('live-link — happy paths', () => {
  it('AC1: the titled form resolves title and id with no diagnostics', () => {
    const r = parseLiveLink(
      `live-link Platform architecture
url https://online.diagrammo.app/d/dgm_7f2a91`
    );
    expect(r.type).toBe('live-link');
    expect(r.title).toBe('Platform architecture');
    expect(r.id).toBe('dgm_7f2a91');
    expect(r.error).toBeNull();
    expect(r.diagnostics).toEqual([]);
  });

  it('AC1a: the generated comment block is inert', () => {
    const bare = parseLiveLink(
      `live-link Platform architecture
url https://online.diagrammo.app/d/dgm_7f2a91`
    );
    const withBlock = parseLiveLink(
      `live-link Platform architecture
url https://online.diagrammo.app/d/dgm_7f2a91

// A live link to a diagram published by someone else.
// It always shows their latest version — delete this file to stop keeping it.
//
// Added 1 August 2026
// Published by Dave Ellery in Foo-bar`
    );
    expect(withBlock).toEqual(bare);
  });

  it('AC1b: a bare id in the url slot resolves the same as a full link', () => {
    const byId = parseLiveLink(`live-link Roadmap plan\nurl dgm_7f2a91`);
    const byUrl = parseLiveLink(
      `live-link Roadmap plan\nurl https://online.diagrammo.app/d/dgm_7f2a91`
    );
    expect(byId.id).toBe('dgm_7f2a91');
    expect(byId).toEqual(byUrl);
  });

  it('accepts the /view and public-source link forms too', () => {
    for (const url of [
      'https://online.diagrammo.app/view/dgm_7f2a91',
      'https://api.diagrammo.app/public/diagrams/dgm_7f2a91/source',
    ]) {
      const r = parseLiveLink(`live-link Roadmap plan\nurl ${url}`);
      expect(r.id, url).toBe('dgm_7f2a91');
      expect(r.diagnostics, url).toEqual([]);
    }
  });

  it('AC2: the shorthand form has a null title and no diagnostics', () => {
    const r = parseLiveLink('live-link dgm_7f2a91');
    expect(r.title).toBeNull();
    expect(r.id).toBe('dgm_7f2a91');
    expect(r.diagnostics).toEqual([]);
  });

  it('AC2 (through the router): the shorthand gets NO empty-content warning', () => {
    // `detectEmptyContent` warns on any file with one non-comment line, and the
    // shorthand form legitimately IS one line. The router exempts this type.
    const r = parseDgmo('live-link dgm_7f2a91');
    expect(r.chartType).toBe('live-link');
    expect(r.diagnostics).toEqual([]);
  });

  it('the exemption survives a file that is only a declaration + comments', () => {
    const r = parseDgmo(
      `live-link dgm_7f2a91

// A live link to a diagram published by someone else.
// Added 1 August 2026`
    );
    expect(r.diagnostics).toEqual([]);
  });

  it('every OTHER chart type still gets the empty-content warning', () => {
    // Guards the exemption against being widened by accident.
    const r = parseDgmo('pie Treasure split');
    expect(
      r.diagnostics.some((d) =>
        d.message.includes('No content after chart type declaration')
      )
    ).toBe(true);
  });

  it('the global directives are accepted silently', () => {
    const r = parseLiveLink(
      `live-link Roadmap plan\nurl dgm_7f2a91\npalette nord\ntheme dark`
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.id).toBe('dgm_7f2a91');
  });
});

describe('live-link — the diagnostics inventory (§38.4)', () => {
  it('row 1 / AC5: `live-link` alone names both spellings', () => {
    const r = parseLiveLink('live-link');
    expect(errors(r)).toHaveLength(1);
    expect(r.error).toBeTruthy();
    expect(errors(r)[0]!.message).toContain('url');
    expect(errors(r)[0]!.message).toContain('live-link <id>');
  });

  it('row 2 / AC8b: an unparseable url names the value and shows an example', () => {
    // Note the host is deliberately NOT checked — `/d/:id` on another origin is
    // how self-host and staging work. What fails is a path that is no diagram.
    for (const bad of ['not a link', 'https://example.com/blog/post']) {
      const r = parseLiveLink(`live-link Roadmap plan\nurl ${bad}`);
      expect(errors(r), bad).toHaveLength(1);
      expect(errors(r)[0]!.message, bad).toContain(bad);
      expect(errors(r)[0]!.message, bad).toContain(
        'https://online.diagrammo.app/d/'
      );
      expect(r.id, bad).toBeNull();
    }
  });

  it('row 3 / AC8c: a whitespace title with no url line is an error', () => {
    const r = parseLiveLink('live-link Platform architecture');
    expect(errors(r)).toHaveLength(1);
    expect(errors(r)[0]!.message).toContain('url');
    expect(r.id).toBeNull();
  });

  it('row 4 / AC7: a url line AND a single-token title names both targets', () => {
    const r = parseLiveLink('live-link dgm_abc\nurl dgm_xyz');
    expect(errors(r)).toHaveLength(1);
    expect(errors(r)[0]!.message).toContain('dgm_abc');
    expect(errors(r)[0]!.message).toContain('dgm_xyz');
    // Never silently resolved by precedence — neither target wins.
    expect(r.id).toBeNull();
  });

  it('row 4: two url lines are the same "two targets" error', () => {
    const r = parseLiveLink('live-link Roadmap plan\nurl dgm_abc\nurl dgm_xyz');
    expect(errors(r)).toHaveLength(1);
    expect(errors(r)[0]!.message).toContain('dgm_abc');
    expect(errors(r)[0]!.message).toContain('dgm_xyz');
    expect(r.id).toBeNull();
  });

  it('row 5 / AC8: a pinned revision explains itself, never floats to latest', () => {
    const r = parseLiveLink(
      'live-link Roadmap plan\nurl https://online.diagrammo.app/d/dgm_7f2a91?at=2026-03-12'
    );
    expect(errors(r)).toHaveLength(1);
    expect(errors(r)[0]!.message).toContain('?at=');
    expect(r.id).toBeNull();
  });

  it('row 6 / AC8a: any other directive is a warning and the file still parses', () => {
    const r = parseLiveLink(
      'live-link Roadmap plan\nurl dgm_7f2a91\nrefresh hourly'
    );
    expect(errors(r)).toHaveLength(0);
    expect(warnings(r)).toHaveLength(1);
    expect(warnings(r)[0]!.message).toContain('refresh');
    expect(r.error).toBeNull();
    expect(r.id).toBe('dgm_7f2a91');
  });

  it('an empty `url` value reports once, and never asks for what was written', () => {
    // The failure this guards: the url line errors, drops out of `urls`, and
    // the "nothing to point at" fallback then tells the author on line 1 to add
    // a `url` line they are looking at.
    const r = parseLiveLink('live-link Roadmap plan\nurl');
    expect(errors(r)).toHaveLength(1);
    expect(errors(r)[0]!.line).toBe(2);
    expect(errors(r)[0]!.message).toContain('"url" needs a diagram');
  });

  it('a TAB between `url` and its value is a separator, not part of the name', () => {
    const r = parseLiveLink('live-link Roadmap plan\nurl\tdgm_7f2a91');
    expect(r.diagnostics).toEqual([]);
    expect(r.id).toBe('dgm_7f2a91');
  });

  it('a `#` line is content, not a comment (§1.2), so it warns', () => {
    // `#` is a comment ONLY in pert. Silently dropping the line here would make
    // this the second chart type where it is, without anyone deciding so.
    const r = parseLiveLink('live-link Roadmap plan\nurl dgm_7f2a91\n# note');
    expect(errors(r)).toHaveLength(0);
    expect(warnings(r)).toHaveLength(1);
    expect(warnings(r)[0]!.message).toContain('#');
  });

  it('a pinned revision is only reported when stripping it WOULD resolve', () => {
    // Not "does it have ?at=" — otherwise any old URL with that query gets told
    // to remove a pin it never had, sending its author after the wrong problem.
    const notADiagram = parseLiveLink(
      'live-link Roadmap plan\nurl https://example.com/blog?at=1'
    );
    expect(errors(notADiagram)[0]!.message).not.toContain('pinned revision');
    expect(errors(notADiagram)[0]!.message).toContain(
      'not a Diagrammo diagram'
    );
  });

  it('the `@` pin spelling gets the pin message too, in both forms', () => {
    for (const src of [
      'live-link Roadmap plan\nurl dgm_7f2a91@2026-03-12',
      'live-link dgm_7f2a91@v7',
    ]) {
      const r = parseLiveLink(src);
      expect(errors(r), src).toHaveLength(1);
      expect(errors(r)[0]!.message, src).toContain('pinned revision');
    }
  });

  it('the other two spellings are not accepted inside the `url` slot', () => {
    // `url live-link abc` and `url ![[live-link:abc]]` are copy-paste mistakes.
    // Resolving them silently teaches the wrong shape.
    for (const bad of ['live-link dgm_7f2a91', '![[live-link:dgm_7f2a91]]']) {
      const r = parseLiveLink(`live-link Roadmap plan\nurl ${bad}`);
      expect(errors(r), bad).toHaveLength(1);
      expect(r.id, bad).toBeNull();
    }
  });

  it('a bare `url` line with no declaration is read, not swallowed', () => {
    // Only reachable through the exported parser, but there it must not report
    // "add a `url` line" one line after reading one.
    const r = parseLiveLink('url dgm_7f2a91');
    expect(r.id).toBe('dgm_7f2a91');
    expect(errors(r)).toHaveLength(0);
  });

  it('AC8d: a one-word title with no url line resolves as an id, silently', () => {
    // 🔴 The parser cannot tell a one-word title from an id — ids are a SHAPE
    // check, not a format check — so it must not guess. "no diagram with id
    // Roadmap" belongs to the resolver, the only layer that knows.
    const r = parseLiveLink('live-link Roadmap');
    expect(r.diagnostics).toEqual([]);
    expect(r.title).toBeNull();
    expect(r.id).toBe('Roadmap');
  });
});

describe('live-link — §38.6, the other two spellings as the whole line', () => {
  // These reached the visualization parser and came back as "Unsupported chart
  // type" on EVERY surface — the app, the web editor and all five docs wrappers
  // — until 2026-08-04. The spec has said the three spellings "parse
  // identically" since it was written; only `live-link <id>` ever did.
  const SPELLINGS: [label: string, source: string][] = [
    ['a pasted share link', 'https://online.diagrammo.app/d/dgm_7f2a91'],
    [
      'the source endpoint',
      'https://api.diagrammo.app/public/diagrams/dgm_7f2a91/source',
    ],
    ['the legacy view page', 'https://online.diagrammo.app/view/dgm_7f2a91'],
  ];

  it.each(SPELLINGS)('%s routes to live-link', (_label, source) => {
    expect(parseDgmo(source).chartType).toBe('live-link');
  });

  it.each(SPELLINGS)(
    '%s resolves to the id with no diagnostics',
    (_label, source) => {
      const r = parseLiveLink(source);
      expect(r.id).toBe('dgm_7f2a91');
      expect(r.title).toBeNull();
      expect(r.diagnostics).toEqual([]);
      expect(r.error).toBeNull();
    }
  );

  it.each(SPELLINGS)(
    '%s reports no error through parseDgmo either',
    (_label, source) => {
      // The router path is the one every host actually uses; the parser passing
      // in isolation is not evidence the fence renders.
      expect(errors(parseDgmo(source))).toEqual([]);
    }
  );

  it('🔴 the NOTE spelling is not valid in a fence', () => {
    // `![[live-link:<id>]]` is host markdown, and a fence's content is DGMO.
    // Accepting it nested markdown inside a code fence that is itself inside
    // markdown — a category error however cleanly it parsed. Removed 2026-08-05,
    // one day after it was added; the note BODY is still its home.
    const src = '![[live-link:dgm_7f2a91]]';
    expect(parseDgmo(src).chartType).not.toBe('live-link');
    expect(parseLiveLink(src).id).toBeNull();
  });

  it('the generated comment block stays inert after a whole-line pointer', () => {
    const r = parseLiveLink(
      `https://online.diagrammo.app/d/dgm_7f2a91

// You're watching someone else's diagram.
// Watching since 1 August 2026`
    );
    expect(r.id).toBe('dgm_7f2a91');
    expect(r.diagnostics).toEqual([]);
  });

  it('a whole-line pointer plus a `url` line is two targets, not a precedence rule', () => {
    const r = parseLiveLink(
      `https://online.diagrammo.app/d/dgm_7f2a91
url dgm_0000zz`
    );
    expect(errors(r)).toHaveLength(1);
    expect(errors(r)[0]!.message).toContain('Two targets');
    expect(r.id).toBeNull();
  });

  it('a pinned share link is refused BY NAME, not silently unpinned', () => {
    // The router claims it precisely so the pin gets its own message. Falling
    // through to "Unsupported chart type" would send the author after a typo
    // in a line whose only problem is the `?at=`.
    const src = 'https://online.diagrammo.app/d/dgm_7f2a91?at=2026-03-12';
    const r = parseDgmo(src);
    expect(r.chartType).toBe('live-link');
    expect(errors(r)).toHaveLength(1);
    expect(errors(r)[0]!.message).toContain('pinned revision');
    expect(errors(r)[0]!.message).not.toContain('Unsupported chart type');
    expect(parseLiveLink(src).id).toBeNull();
  });

  it('an ordinary first-line URL does not become a live link', () => {
    // The path shapes are what identify a pointer. A fence that merely opens
    // with a link is not one, and claiming it would break real diagrams.
    for (const src of [
      'https://example.com/blog/post',
      'https://online.diagrammo.app/pricing',
    ]) {
      expect(parseDgmo(src).chartType, src).not.toBe('live-link');
    }
  });

  it('a whole-line pointer below the first line is left alone', () => {
    // Only the DECLARATION line can be the pointer. A link sitting inside
    // another chart type's content is that chart type's business.
    const src = `sequence
Alice -> Bob: see https://online.diagrammo.app/d/dgm_7f2a91`;
    expect(parseDgmo(src).chartType).toBe('sequence');
  });
});

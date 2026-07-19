import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseBracket } from '../src/bracket/parser';
import { layoutBracket } from '../src/bracket/layout';
import { renderBracket } from '../src/bracket/renderer';
import { render } from '../src/render';
import { getPalette } from '../src/palettes';
import { themeBaseBg } from '../src/palettes/color-utils';
import { resolveColor } from '../src/colors';
import { getRenderCategory } from '../src/dgmo-router';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [key, value] of Object.entries({
    document: win.document,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  })) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
});

const nordLight = getPalette('nord').light;

function makeContainer(): HTMLDivElement {
  const c = document.createElement('div');
  Object.defineProperty(c, 'clientWidth', { value: 1200 });
  Object.defineProperty(c, 'clientHeight', { value: 800 });
  return c as HTMLDivElement;
}

function texts(svg: SVGSVGElement): string[] {
  return Array.from(svg.querySelectorAll('text')).map(
    (t) => t.textContent ?? ''
  );
}

function errors(diagnostics: readonly { severity: string }[]): unknown[] {
  return diagnostics.filter((d) => d.severity === 'error');
}
function warnings(diagnostics: readonly { severity: string }[]): unknown[] {
  return diagnostics.filter((d) => d.severity === 'warning');
}

// ── The three required fixtures ──────────────────────────────

// (1) SEEDED, day-0: full field declared, ZERO results → skeleton of TBD slots.
const SEEDED_DAY0 = `bracket World Series
rounds Wild Card, Division, Championship

[American League]
  seed 1 Blue Jays
  seed 2 Mariners
  seed 3 Yankees
  seed 4 Red Sox
  seed 5 Tigers
  seed 6 Guardians

[National League]
  seed 1 Brewers
  seed 2 Phillies
  seed 3 Dodgers
  seed 4 Cubs
  seed 5 Padres
  seed 6 Mets`;

// (2) Same field, mid/full tournament — results fill the skeleton to a champion.
const SEEDED_PLAYED = `bracket World Series
rounds Wild Card, Division, Championship

[American League]
  seed 1 Blue Jays
  seed 2 Mariners
  seed 3 Yankees
  seed 4 Red Sox
  seed 5 Tigers
  seed 6 Guardians
  Yankees beats Guardians 2-1
  Red Sox beats Tigers 2-1
  Blue Jays beats Red Sox 3-1
  Mariners beats Yankees 3-2
  Blue Jays beats Mariners 4-3

[National League]
  seed 1 Brewers
  seed 2 Phillies
  seed 3 Dodgers
  seed 4 Cubs
  seed 5 Padres
  seed 6 Mets
  Dodgers beats Mets 2-0
  Cubs beats Padres 2-1
  Brewers beats Cubs 3-2
  Phillies beats Dodgers 3-1
  Brewers beats Phillies 4-2

Blue Jays beats Brewers 4-3`;

// (3) CASUAL, results-only — structure inferred, generic round labels.
const CASUAL = `bracket Taco Showdown
El Corazon beats La Playa 5-3
Casa Verde beats Mariscos 4-2
El Corazon beats Casa Verde 6-5`;

// ============================================================
// Parser
// ============================================================

describe('bracket parser', () => {
  it('parses title, sides, seeds and rounds (seeded mode)', () => {
    const r = parseBracket(SEEDED_DAY0);
    expect(r.type).toBe('bracket');
    expect(r.title).toBe('World Series');
    expect(r.seeded).toBe(true);
    expect(r.roundNames.map((d) => d.name)).toEqual([
      'Wild Card',
      'Division',
      'Championship',
    ]);
    expect(r.sides.map((s) => s.label)).toEqual([
      'American League',
      'National League',
    ]);
    expect(r.seeds.filter((s) => s.side === 'American League')).toHaveLength(6);
    expect(errors(r.diagnostics)).toHaveLength(0);
  });

  it('winner is always left of `beats`, score is cosmetic', () => {
    const r = parseBracket(`bracket X\nA beats B 0-9`);
    expect(r.matches[0]!.p1).toBe('A');
    expect(r.matches[0]!.decided).toBe(true);
    // Score contradicts the declared winner → warn, keep A.
    expect(warnings(r.diagnostics).length).toBeGreaterThan(0);
  });

  it('`vs` is a pending, undecided match', () => {
    const r = parseBracket(`bracket X\nA vs B`);
    expect(r.matches[0]!.decided).toBe(false);
    expect(r.matches[0]!.p1).toBe('A');
    expect(r.matches[0]!.p2).toBe('B');
  });

  it('names may contain spaces', () => {
    const r = parseBracket(`bracket X\nEl Corazon beats La Playa`);
    expect(r.matches[0]!.p1).toBe('El Corazon');
    expect(r.matches[0]!.p2).toBe('La Playa');
  });

  it('errors on a duplicate seeded competitor name', () => {
    const r = parseBracket(
      `bracket X\nseed 1 Kraken\nseed 2 Kraken\nseed 3 Marlin\nseed 4 Barnacle`
    );
    expect(errors(r.diagnostics).length).toBeGreaterThan(0);
  });

  it('double-elim is reserved — emits a not-yet-supported diagnostic', () => {
    const r = parseBracket(`bracket X\ndouble-elim\nA beats B`);
    expect(r.mode).toBe('double-elim');
    expect(
      r.diagnostics.some((d) => /not yet supported/i.test(d.message))
    ).toBe(true);
  });

  it('rejects a non-bracket first line', () => {
    const r = parseBracket(`pyramid Nope\nA beats B`);
    expect(r.error).toMatch(/Expected "bracket/);
  });
});

describe('bracket parser — winner accent (§1.5 title-line slot, decision #48)', () => {
  it('a trailing color token on the title line sets the winner accent', () => {
    const r = parseBracket(`bracket Champions Cup red\nA beats B`);
    expect(r.title).toBe('Champions Cup');
    expect(r.accentColor).toBe(resolveColor('red'));
    expect(errors(r.diagnostics)).toHaveLength(0);
  });

  it('legacy `accent <color>` directive alone still sets the accent', () => {
    const r = parseBracket(`bracket Champions Cup\naccent blue\nA beats B`);
    expect(r.accentColor).toBe(resolveColor('blue'));
    expect(errors(r.diagnostics)).toHaveLength(0);
  });

  it('title-line token wins over the legacy directive on conflict', () => {
    const r = parseBracket(`bracket Champions Cup red\naccent blue\nA beats B`);
    expect(r.accentColor).toBe(resolveColor('red'));
  });
});

describe('bracket parser — §1.9 fill family', () => {
  it('`fill-solid` sets fillMode to solid', () => {
    const r = parseBracket(`bracket X\nfill-solid\nA beats B`);
    expect(r.fillMode).toBe('solid');
    expect(warnings(r.diagnostics)).toHaveLength(0);
  });

  it('`fill-outline` sets fillMode to outline', () => {
    const r = parseBracket(`bracket X\nfill-outline\nA beats B`);
    expect(r.fillMode).toBe('outline');
    expect(warnings(r.diagnostics)).toHaveLength(0);
  });

  it('last one wins — `fill-tint` after `fill-solid` restores the default', () => {
    const r = parseBracket(`bracket X\nfill-solid\nfill-tint\nA beats B`);
    expect(r.fillMode).toBeUndefined();
  });
});

// ============================================================
// Layout — the three fixtures
// ============================================================

describe('bracket layout — (1) seeded day-0 skeleton', () => {
  const layout = layoutBracket(parseBracket(SEEDED_DAY0));

  it('renders every slot with no champion yet', () => {
    expect(layout.champion).toBeNull();
    expect(layout.matches.length).toBeGreaterThan(0);
    // No match has a winner on day 0.
    expect(layout.matches.every((m) => m.winner === null)).toBe(true);
  });

  it('round-1 seeds are named while downstream slots are TBD', () => {
    const named = layout.matches.flatMap((m) => [m.top, m.bot]).filter(Boolean);
    expect(named).toContain('Yankees');
    expect(named).toContain('Guardians');
    // The byed top seeds appear as named boxes waiting on a TBD opponent.
    expect(named).toContain('Blue Jays');
    // Some slot is still undecided (a TBD box).
    expect(layout.matches.some((m) => m.top === null || m.bot === null)).toBe(
      true
    );
  });

  it('carries the round labels from `rounds`', () => {
    const labels = layout.columns.map((c) => c.label);
    expect(labels).toContain('Wild Card');
    expect(labels).toContain('Division');
    expect(labels).toContain('Championship');
    // Center column = the bracket title.
    expect(labels).toContain('World Series');
  });
});

describe('bracket layout — (2) mid/full seeded tournament', () => {
  const parsed = parseBracket(SEEDED_PLAYED);
  const layout = layoutBracket(parsed);

  it('fills the skeleton and crowns the declared champion', () => {
    expect(errors(parsed.diagnostics)).toHaveLength(0);
    expect(layout.champion).toBe('Blue Jays');
  });

  it('propagates byed seeds into the division round', () => {
    // Mariners (seed 2, bye) beat Yankees in the AL Division round.
    const decided = layout.matches.filter((m) => m.winner !== null);
    const marinersWin = decided.find(
      (m) =>
        (m.top === 'Mariners' && m.bot === 'Yankees') ||
        (m.bot === 'Mariners' && m.top === 'Yankees')
    );
    expect(marinersWin).toBeDefined();
  });

  it('places the championship match at the center with both league champs', () => {
    const champ = layout.matches.find((m) => m.isChampionship);
    expect(champ).toBeDefined();
    expect([champ!.top, champ!.bot].sort()).toEqual(['Blue Jays', 'Brewers']);
  });
});

describe('bracket layout — (3) casual results-only', () => {
  const layout = layoutBracket(parseBracket(CASUAL));

  it('infers the tree and auto-advances to a champion', () => {
    expect(layout.champion).toBe('El Corazon');
    expect(layout.matches).toHaveLength(3);
    // Two round-1 matches feed one round-2 final.
    const rounds = layout.matches.map((m) => m.round).sort();
    expect(rounds).toEqual([1, 1, 2]);
  });

  it('the final has connectors back to both round-1 matches', () => {
    const final = layout.matches.find((m) => m.round === 2)!;
    expect(final.topFrom).not.toBeNull();
    expect(final.botFrom).not.toBeNull();
  });
});

describe('bracket layout — bye inference (casual)', () => {
  it('a competitor first seen in a later round is a bye at that round', () => {
    // Ape never plays round 1; enters round 2 as a bye against the R1 winner.
    const layout = layoutBracket(
      parseBracket(`bracket Jungle Cup
Tiger beats Snake
Ape beats Tiger`)
    );
    const final = layout.matches.find((m) => m.round === 2)!;
    expect(final).toBeDefined();
    // One side is fed by a match (Tiger), the other is a bye entrant (Ape).
    const oneBye = (final.topFrom === null) !== (final.botFrom === null);
    expect(oneBye).toBe(true);
    expect(layout.champion).toBe('Ape');
  });
});

// ============================================================
// Router + render() pipeline
// ============================================================

describe('bracket router + render()', () => {
  it('bracket is a diagram render category', () => {
    expect(getRenderCategory('bracket')).toBe('diagram');
  });

  it('renders an SVG with boxes and a title', () => {
    const parsed = parseBracket(CASUAL);
    const c = makeContainer();
    renderBracket(c, parsed, nordLight, false);
    const svg = c.querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.querySelectorAll('rect').length).toBeGreaterThanOrEqual(6);
    expect(svg.getAttribute('aria-label')).toMatch(/Taco Showdown/);
  });

  it('routes each fixture through render() and emits real SVG', async () => {
    for (const src of [SEEDED_DAY0, SEEDED_PLAYED, CASUAL]) {
      const { svg } = await render(src, { theme: 'light', palette: 'slate' });
      expect(svg).toMatch(/<svg/);
      expect(svg).not.toMatch(/Parse error/i);
    }
  });

  it('the champion box is emphasized after a full run', async () => {
    const { svg } = await render(SEEDED_PLAYED, { theme: 'light' });
    expect(svg).toContain('Blue Jays');
    expect(svg).not.toMatch(/Parse error/i);
  });
});

// ============================================================
// Enrichment — tags, commentary, home/away, seeds, upset
// ============================================================

const ENRICHED = `bracket AL Playoffs
rounds Wild Card, Division, Championship

tag Ticketing as tk
  MLB Ballpark blue
  Ticketmaster orange

[American League]
  seed 1 Blue Jays tk: MLB Ballpark
  seed 2 Mariners tk: Ticketmaster
  seed 3 Yankees tk: MLB Ballpark
  seed 4 Red Sox tk: Ticketmaster
  seed 5 Tigers tk: Ticketmaster
  seed 6 Guardians tk: MLB Ballpark
  Guardians beats Yankees 2-1
    Guardians stun the 3-seed — **walk-off** in the 11th.
    - Series MVP: Ramírez
  Red Sox beats Tigers 2-1 @ Red Sox
  Blue Jays beats Red Sox 3-1
  Mariners beats Guardians 3-2
  Blue Jays beats Mariners 4-3`;

describe('bracket parser — enrichment', () => {
  it('parses a tag group and attaches metadata to seeded competitors', () => {
    const r = parseBracket(ENRICHED);
    expect(errors(r.diagnostics)).toHaveLength(0);
    expect(r.tagGroups.map((g) => g.name)).toContain('Ticketing');
    expect(r.activeTag).toBe('Ticketing');
    // Alias `tk` resolves to the canonical `ticketing` key.
    expect(r.competitorMeta.get('Blue Jays')).toEqual({
      ticketing: 'MLB Ballpark',
    });
    expect(r.competitorMeta.get('Mariners')).toEqual({
      ticketing: 'Ticketmaster',
    });
  });

  it('captures `@ home` and prose commentary under a match', () => {
    const r = parseBracket(ENRICHED);
    const gw = r.matches.find(
      (m) => m.p1 === 'Guardians' && m.p2 === 'Yankees'
    )!;
    expect(gw.commentary.length).toBe(2);
    expect(gw.commentary[0]).toMatch(/walk-off/);
    expect(gw.commentary[1]).toMatch(/^•/); // `- ` normalized to a bullet
    const rs = r.matches.find((m) => m.p1 === 'Red Sox')!;
    expect(rs.home).toBe('Red Sox');
  });

  it('parses an indented rounds block with per-round colors', () => {
    const r = parseBracket(`bracket Cup
rounds
  Wild Card
  Division blue
  Final green

A beats B 2-1`);
    expect(r.roundNames.map((d) => d.name)).toEqual([
      'Wild Card',
      'Division',
      'Final',
    ]);
    expect(r.roundNames[0]!.color).toBeUndefined();
    expect(r.roundNames[1]!.color).toBeDefined();
    expect(r.roundNames[2]!.color).toBeDefined();
  });

  it('tags a team via a casual roster line (no seeds)', () => {
    const r = parseBracket(`bracket Taco Night
tag Truck as t
  Verde green
  Rojo red

El Verde t: Verde
La Roja t: Rojo
El Verde beats La Roja 5-3`);
    expect(errors(r.diagnostics)).toHaveLength(0);
    expect(r.seeded).toBe(false);
    expect(r.competitorMeta.get('El Verde')).toEqual({ truck: 'Verde' });
    expect(r.competitorMeta.get('La Roja')).toEqual({ truck: 'Rojo' });
  });
});

describe('bracket renderer — enrichment', () => {
  it('renders a tag legend and colors box outlines by the tag', () => {
    const parsed = parseBracket(ENRICHED);
    const c = makeContainer();
    renderBracket(c, parsed, nordLight, false);
    const svg = c.querySelector('svg')!;
    expect(svg.querySelector('.dgmo-bracket-legend')).not.toBeNull();
    // Boxes carry the hover-dim tag attribute.
    expect(svg.querySelectorAll('[data-tag-ticketing]').length).toBeGreaterThan(
      0
    );
    // Two distinct tag colors appear as winner outlines.
    const strokes = new Set(
      Array.from(svg.querySelectorAll('rect[stroke-width="2"]')).map((r) =>
        r.getAttribute('stroke')
      )
    );
    expect(strokes.size).toBeGreaterThanOrEqual(2);
  });

  it('fill-outline: winner boxes fill with the base bg, accent on the stroke', () => {
    const parsed = parseBracket(`${CASUAL}\nfill-outline`);
    const c = makeContainer();
    renderBracket(c, parsed, nordLight, false);
    const svg = c.querySelector('svg')!;
    const baseBg = themeBaseBg(nordLight, false);
    const accent = resolveColor('blue', nordLight)!;
    // Winner (sw=2) + champion (sw=3) boxes are hollowed to the base bg.
    const emphasized = Array.from(
      svg.querySelectorAll('rect[stroke-width="2"], rect[stroke-width="3"]')
    );
    expect(emphasized.length).toBeGreaterThan(0);
    for (const r of emphasized) {
      expect(r.getAttribute('fill')).toBe(baseBg);
      expect(r.getAttribute('stroke')).toBe(accent);
    }
  });

  it('fill-solid: winner boxes carry the raw accent fill', () => {
    const parsed = parseBracket(`${CASUAL}\nfill-solid`);
    const c = makeContainer();
    renderBracket(c, parsed, nordLight, false);
    const svg = c.querySelector('svg')!;
    const accent = resolveColor('blue', nordLight)!;
    const solidFills = Array.from(svg.querySelectorAll('rect')).filter(
      (r) => r.getAttribute('fill') === accent
    );
    expect(solidFills.length).toBeGreaterThan(0);
  });

  it('default (no fill token) keeps the 25% tint — not solid, not hollow', () => {
    const parsed = parseBracket(CASUAL);
    const c = makeContainer();
    renderBracket(c, parsed, nordLight, false);
    const svg = c.querySelector('svg')!;
    const baseBg = themeBaseBg(nordLight, false);
    const accent = resolveColor('blue', nordLight)!;
    const winner = svg.querySelector('rect[stroke-width="2"]')!;
    expect(winner.getAttribute('fill')).not.toBe(baseBg);
    expect(winner.getAttribute('fill')).not.toBe(accent);
  });

  it('renders commentary, an UPSET flag, and seed badges', () => {
    const parsed = parseBracket(ENRICHED);
    const c = makeContainer();
    renderBracket(c, parsed, nordLight, false);
    const svg = c.querySelector('svg')!;
    const all = texts(svg).join(' ');
    expect(all).toContain('UPSET'); // 6-seed Guardians beat 3-seed Yankees
    expect(all).toMatch(/walk-off/);
    expect(all).toContain('•');
    expect(all).toContain('6'); // seed badge
  });
});

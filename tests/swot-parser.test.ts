import { describe, expect, it } from 'vitest';
import { parseSwot } from '../src/swot/parser';
import { getPalette } from '../src/palettes';

const FULL = `swot T
strengths
  A
weaknesses
  B
opportunities
  C
threats
  D
`;

const codes = (src: string): (string | undefined)[] =>
  parseSwot(src).diagnostics.map((d) => d.code);
const section = (src: string, key: string) =>
  parseSwot(src).sections.find((s) => s.key === key)!;

describe('parseSwot — syntax', () => {
  it('parses the spec example', () => {
    const parsed = parseSwot(`swot Tortuga Rum Co.
tag Priority as p
  High red
  Low gray
active-tag Priority
x-label Helpful, Harmful
y-label Internal, External

strengths
  Oldest still on the island p: Low
  Crew of 40 sworn tasters
    Trained in three ports
weaknesses Soft spots yellow
  One barrel supplier p: High
opportunities
  Navy rum ration contract
threats
  Royal Navy blockade
`);
    expect(parsed.error).toBeNull();
    expect(parsed.title).toBe('Tortuga Rum Co.');
    expect(parsed.options['active-tag']).toBe('Priority');
    expect(parsed.sections[0]!.items[0]!.tags).toEqual({ priority: 'Low' });
    expect(parsed.sections[0]!.items[1]!.details).toEqual([
      'Trained in three ports',
    ]);
    expect(parsed.sections[1]!.label).toBe('Soft spots');
    expect(parsed.diagnostics).toEqual([]);
  });

  it('section keywords are case-insensitive', () => {
    const parsed = parseSwot('swot\nSTRENGTHS\n  A\nThreats\n  B\n');
    expect(parsed.error).toBeNull();
    expect(parsed.sections[0]!.items[0]!.title).toBe('A');
    expect(parsed.sections[3]!.items[0]!.title).toBe('B');
  });

  it('defaults labels and colours in S W O T order', () => {
    const palette = getPalette('nord').light;
    const parsed = parseSwot(FULL, palette);
    expect(parsed.sections.map((s) => s.label)).toEqual([
      'Strengths',
      'Weaknesses',
      'Opportunities',
      'Threats',
    ]);
    expect(parsed.sections.map((s) => s.color)).toEqual([
      palette.colors.green,
      palette.colors.yellow,
      palette.colors.blue,
      palette.colors.red,
    ]);
  });

  it('takes a label and a colour from the section line', () => {
    const palette = getPalette('nord').light;
    const labelled = parseSwot(
      'swot\nweaknesses Soft spots teal\n  A\n',
      palette
    ).sections[1]!;
    expect(labelled.label).toBe('Soft spots');
    expect(labelled.color).toBe(palette.colors.teal);
    const colourOnly = parseSwot('swot\nweaknesses teal\n  A\n', palette)
      .sections[1]!;
    expect(colourOnly.label).toBe('Weaknesses');
    expect(colourOnly.color).toBe(palette.colors.teal);
  });

  it('axis labels default, and x-label / y-label replace them', () => {
    expect(parseSwot(FULL).xLabels).toEqual(['Helpful', 'Harmful']);
    expect(parseSwot(FULL).yLabels).toEqual(['Internal', 'External']);
    const parsed = parseSwot(
      `swot\nx-label A, B\ny-label C, D\n${FULL.slice(7)}`
    );
    expect(parsed.xLabels).toEqual(['A', 'B']);
    expect(parsed.yLabels).toEqual(['C', 'D']);
  });

  it('warns on an axis option without exactly two labels', () => {
    const parsed = parseSwot(`swot\nx-label Only\n${FULL.slice(7)}`);
    expect(parsed.xLabels).toEqual(['Helpful', 'Harmful']);
    expect(parsed.diagnostics.map((d) => d.severity)).toEqual(['warning']);
  });

  it('records no-axes alongside the label options', () => {
    const parsed = parseSwot(`swot\nno-axes\nx-label A, B\n${FULL.slice(7)}`);
    expect(parsed.options['no-axes']).toBe('on');
  });

  it('accepts an option after the sections', () => {
    const parsed = parseSwot(`${FULL}no-axes\n`);
    expect(parsed.error).toBeNull();
    expect(parsed.options['no-axes']).toBe('on');
  });
});

describe('parseSwot — rulings', () => {
  it('placement: S W O T whatever the source order', () => {
    const parsed = parseSwot(
      'swot\nthreats\n  T\nopportunities\n  O\nweaknesses\n  W\nstrengths\n  S\n'
    );
    expect(parsed.sections.map((s) => s.key)).toEqual([
      'strengths',
      'weaknesses',
      'opportunities',
      'threats',
    ]);
    expect(parsed.sections.map((s) => s.items[0]!.title)).toEqual([
      'S',
      'W',
      'O',
      'T',
    ]);
  });

  it.each([
    ['[Strengths]', 'strengths'],
    ['strength', 'strengths'],
    ['threat', 'threats'],
    ['Opportunity', 'opportunities'],
    ['zzz', undefined],
  ])(
    'unknown word %s at indent 0 is an error naming a keyword',
    (word, near) => {
      const parsed = parseSwot(`swot\n${word}\n  A\n`);
      expect(parsed.diagnostics[0]!.code).toBe('E_SWOT_UNKNOWN_SECTION');
      expect(parsed.diagnostics[0]!.severity).toBe('error');
      expect(parsed.error).not.toBeNull();
      const keywords = near
        ? [near]
        : ['strengths', 'weaknesses', 'opportunities', 'threats'];
      expect(
        keywords.some((k) => parsed.diagnostics[0]!.message.includes(`'${k}'`))
      ).toBe(true);
    }
  );

  it('unknown section does not also report its items as orphans', () => {
    expect(codes('swot\n[Strengths]\n  A\n  B\n')).not.toContain(
      'E_SWOT_ORPHAN_ITEM'
    );
  });

  it('same section twice is an error', () => {
    const parsed = parseSwot(`${FULL}strengths\n  Again\n`);
    expect(parsed.diagnostics.map((d) => d.code)).toContain(
      'E_SWOT_DUPLICATE_SECTION'
    );
    expect(parsed.error).not.toBeNull();
  });

  it('a missing section warns and is still present', () => {
    const parsed = parseSwot(
      'swot\nstrengths\n  A\nweaknesses\n  B\nopportunities\n  C\n'
    );
    expect(parsed.error).toBeNull();
    expect(
      codes('swot\nstrengths\n  A\nweaknesses\n  B\nopportunities\n  C\n')
    ).toEqual(['W_SWOT_EMPTY_SECTION']);
    expect(parsed.sections).toHaveLength(4);
    expect(parsed.sections[3]!.lineNumber).toBe(0);
  });

  it('an empty section warns at its own line', () => {
    const parsed = parseSwot(
      `swot\nstrengths\nweaknesses\n  B\nopportunities\n  C\nthreats\n  D\n`
    );
    expect(parsed.error).toBeNull();
    const warning = parsed.diagnostics[0]!;
    expect(warning.code).toBe('W_SWOT_EMPTY_SECTION');
    expect(warning.severity).toBe('warning');
    expect(warning.line).toBe(2);
  });

  it('an item before a section is an error', () => {
    const parsed = parseSwot(`swot\n  Early\n${FULL.slice(7)}`);
    expect(parsed.diagnostics[0]!.code).toBe('E_SWOT_ORPHAN_ITEM');
    expect(parsed.error).not.toBeNull();
  });

  it('a colour word ending an item is literal', () => {
    const palette = getPalette('nord').light;
    const parsed = parseSwot(
      'swot\nthreats\n  Margins are in the red\n',
      palette
    );
    expect(parsed.sections[3]!.items[0]!.title).toBe('Margins are in the red');
  });

  it.each([
    'Cost: 20% below rivals, margins thin',
    'Due: Friday, or else',
    'color: a poor one',
    'Known as Bob',
  ])('stays whole: %s', (text) => {
    const parsed = parseSwot(`swot\nstrengths\n  ${text}\n`);
    expect(parsed.sections[0]!.items[0]!.title).toBe(text);
    expect(parsed.sections[0]!.items[0]!.tags).toEqual({});
  });

  it('a declared tag alias does cut metadata, and only it', () => {
    const parsed = parseSwot(
      'swot\ntag Priority as p\n  High red\n\nstrengths\n  Cost: low, really p: High\n'
    );
    const item = parsed.sections[0]!.items[0]!;
    expect(item.title).toBe('Cost: low, really');
    expect(item.tags).toEqual({ priority: 'High' });
  });

  it('a leading dash is removed silently', () => {
    const parsed = parseSwot(`swot\nstrengths\n  - Loyal crew\n`);
    expect(parsed.sections[0]!.items[0]!.title).toBe('Loyal crew');
    expect(parsed.diagnostics.map((d) => d.severity)).not.toContain('error');
  });

  it('nesting: one detail level, deeper is an error', () => {
    const parsed = parseSwot(
      'swot\nstrengths\n  Item\n    Detail one\n    Detail two\n'
    );
    expect(parsed.sections[0]!.items[0]!.details).toEqual([
      'Detail one',
      'Detail two',
    ]);
    const deep = parseSwot(
      'swot\nstrengths\n  Item\n    Detail\n      Deeper\n'
    );
    expect(deep.diagnostics.map((d) => d.code)).toContain('E_SWOT_TOO_DEEP');
    expect(deep.error).not.toBeNull();
  });

  it('an untagged item carries no tag, so it keeps the section colour', () => {
    const parsed = parseSwot(
      'swot\ntag Priority as p\n  High red\n  Low gray\n\nstrengths\n  A\n  B p: Low\n'
    );
    expect(parsed.sections[0]!.items[0]!.tags).toEqual({});
    expect(parsed.sections[0]!.items[1]!.tags).toEqual({ priority: 'Low' });
  });

  it('warns on an unknown tag value and an unknown active-tag', () => {
    const parsed = parseSwot(
      'swot\ntag Priority as p\n  High red\nactive-tag Nope\n\nstrengths\n  A p: Hgih\n'
    );
    const messages = parsed.diagnostics.map((d) => d.message).join('\n');
    expect(messages).toContain('Unknown tag value "Hgih"');
    expect(parsed.diagnostics.map((d) => d.code)).toContain(
      'W_ACTIVE_TAG_NO_MATCH'
    );
  });
});

describe('parseSwot — the two layout rulings', () => {
  // Phone width has no parser side: there is no stacking option to parse, and
  // tests/swot-renderer.test.ts pins the 2×2. Long lists are capped nowhere here.
  it('keeps every item of a long list, untruncated', () => {
    const long = 'word '.repeat(60).trim();
    const items = Array.from({ length: 40 }, (_, i) => `  ${i} ${long}`);
    const parsed = parseSwot(`swot\nstrengths\n${items.join('\n')}\n`);
    expect(parsed.sections[0]!.items).toHaveLength(40);
    expect(parsed.sections[0]!.items[39]!.title).toBe(`39 ${long}`);
  });
});

describe('parseSwot — shape', () => {
  it('fails on empty content', () => {
    expect(parseSwot('').error).not.toBeNull();
  });

  it('a bare declaration still gives four empty panels', () => {
    const parsed = parseSwot('swot Nothing yet\n');
    expect(parsed.error).toBeNull();
    expect(parsed.sections).toHaveLength(4);
    expect(section('swot\n', 'threats').items).toEqual([]);
  });

  it('records line numbers on sections and items', () => {
    const parsed = parseSwot('swot\n\nstrengths\n  A\n    Detail\n  B\n');
    expect(parsed.sections[0]!.lineNumber).toBe(3);
    expect(parsed.sections[0]!.items[0]!.lineNumber).toBe(4);
    expect(parsed.sections[0]!.items[0]!.endLineNumber).toBe(5);
    expect(parsed.sections[0]!.items[1]!.lineNumber).toBe(6);
  });
});

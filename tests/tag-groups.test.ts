import { describe, it, expect, vi } from 'vitest';
import {
  TAG_BLOCK_NOCOLON_RE,
  isTagBlockHeading,
  matchTagBlockHeading,
  parseTagDeclaration,
  resolveTagColor,
  validateTagValues,
  validateTagGroupNames,
  injectDefaultTagMetadata,
  stripDefaultModifier,
  resolveActiveTagGroup,
  assignAutoTagColors,
  finalizeAutoTagColors,
  autoTagColorCycle,
  AUTO_TAG_COLOR_SENTINEL,
  tagAttrKey,
} from '../src/utils/tag-groups';
import type { TagGroup, TagEntry } from '../src/utils/tag-groups';
import type { Writable } from '../src/utils/brand';
import { resolveColor } from '../src/colors';

// ============================================================
// stripDefaultModifier
// ============================================================

describe('stripDefaultModifier', () => {
  it('strips trailing default keyword', () => {
    expect(stripDefaultModifier('NA gray default')).toEqual({
      text: 'NA gray',
      isDefault: true,
    });
  });

  it('handles default with extra trailing whitespace', () => {
    expect(stripDefaultModifier('NA gray default  ')).toEqual({
      text: 'NA gray',
      isDefault: true,
    });
  });

  it('returns original text when no default keyword', () => {
    expect(stripDefaultModifier('Done green')).toEqual({
      text: 'Done green',
      isDefault: false,
    });
  });

  it('does not match default in the middle of a string', () => {
    expect(stripDefaultModifier('default blue')).toEqual({
      text: 'default blue',
      isDefault: false,
    });
  });

  it('matches bare default at end without color', () => {
    expect(stripDefaultModifier('NA default')).toEqual({
      text: 'NA',
      isDefault: true,
    });
  });
});

describe('isTagBlockHeading', () => {
  it('returns true for tag syntax (no colon)', () => {
    expect(isTagBlockHeading('tag Location')).toBe(true);
    expect(isTagBlockHeading('Tag Location loc')).toBe(true);
    expect(isTagBlockHeading('TAG Rank blue')).toBe(true);
  });

  it('returns false for tag: syntax (deprecated)', () => {
    expect(isTagBlockHeading('tag: Location')).toBe(false);
    expect(isTagBlockHeading('Tag: Location loc')).toBe(false);
  });

  it('returns false for ## syntax (deprecated)', () => {
    expect(isTagBlockHeading('## Location')).toBe(false);
    expect(isTagBlockHeading('## Location alias loc')).toBe(false);
  });

  it('returns false for other lines', () => {
    expect(isTagBlockHeading('title: My Chart')).toBe(false);
    expect(isTagBlockHeading('tags: file.dgmo')).toBe(false);
    expect(isTagBlockHeading('Hello World')).toBe(false);
    expect(isTagBlockHeading('')).toBe(false);
  });
});

describe('matchTagBlockHeading', () => {
  it('parses tag heading (no colon)', () => {
    const result = matchTagBlockHeading('tag Location');
    expect(result).toEqual({
      name: 'Location',
      alias: undefined,
      colorHint: undefined,
      inlineValues: undefined,
    });
  });

  it('parses canonical `as` form (Tag mixed-case)', () => {
    const result = matchTagBlockHeading('Tag Rank as r');
    expect(result).toEqual({
      name: 'Rank',
      alias: 'r',
      colorHint: undefined,
      inlineValues: undefined,
    });
  });

  it('does not infer a trailing bare token as an alias (Tag Rank r)', () => {
    // `as` is the only alias form; a bare trailing token is part of the name.
    const result = matchTagBlockHeading('Tag Rank r');
    expect(result?.name).toBe('Rank r');
    expect(result?.alias).toBeUndefined();
  });

  it('returns null for tag: syntax (deprecated)', () => {
    expect(matchTagBlockHeading('tag: Location')).toBeNull();
  });

  it('returns null for ## syntax (deprecated)', () => {
    expect(matchTagBlockHeading('## Location')).toBeNull();
  });

  it('returns null for non-matching lines', () => {
    expect(matchTagBlockHeading('title: My Chart')).toBeNull();
    expect(matchTagBlockHeading('Hello World')).toBeNull();
    expect(matchTagBlockHeading('')).toBeNull();
  });
});

// ============================================================
// New no-colon syntax: parseTagDeclaration
// ============================================================

describe('TAG_BLOCK_NOCOLON_RE', () => {
  it('matches tag keyword with space', () => {
    expect(TAG_BLOCK_NOCOLON_RE.test('tag Priority')).toBe(true);
    expect(TAG_BLOCK_NOCOLON_RE.test('Tag Priority')).toBe(true);
    expect(TAG_BLOCK_NOCOLON_RE.test('TAG Priority')).toBe(true);
  });
  it('does not match tag: (with colon)', () => {
    expect(TAG_BLOCK_NOCOLON_RE.test('tag: Priority')).toBe(false);
  });
  it('does not match tags (with s)', () => {
    expect(TAG_BLOCK_NOCOLON_RE.test('tags val')).toBe(false);
  });
});

describe('parseTagDeclaration', () => {
  it('parses simple tag name', () => {
    const r = parseTagDeclaration('tag Priority');
    expect(r).toEqual({
      name: 'Priority',
      alias: undefined,
      colorHint: undefined,
      inlineValues: undefined,
    });
  });

  it('parses canonical `tag Name as alias` form', () => {
    const r = parseTagDeclaration('tag Priority as p');
    expect(r?.name).toBe('Priority');
    expect(r?.alias).toBe('p');
  });

  it('does not infer a trailing bare token as an alias', () => {
    // `tag Priority p` — `p` is part of the name, not an alias.
    const r = parseTagDeclaration('tag Priority p');
    expect(r?.name).toBe('Priority p');
    expect(r?.alias).toBeUndefined();
  });

  it('does not infer a multi-char trailing token as an alias', () => {
    const r = parseTagDeclaration('tag Engineering eng');
    expect(r?.name).toBe('Engineering eng');
    expect(r?.alias).toBeUndefined();
  });

  it('does not treat `alias` as a keyword separator', () => {
    // The legacy `alias` keyword is gone — only `as` declares an alias.
    const r = parseTagDeclaration('tag Priority alias p');
    expect(r?.name).toBe('Priority alias p');
    expect(r?.alias).toBeUndefined();
  });

  it('parses quoted tag name', () => {
    const r = parseTagDeclaration('tag "Marketing mktg"');
    expect(r?.name).toBe('Marketing mktg');
    expect(r?.alias).toBeUndefined();
  });

  it('parses quoted tag name with `as` alias (canonical)', () => {
    const r = parseTagDeclaration('tag "A Team" as at');
    expect(r?.name).toBe('A Team');
    expect(r?.alias).toBe('at');
  });

  it('parses single-line values (canonical `as` form)', () => {
    const r = parseTagDeclaration('tag Priority as p High red, Low blue');
    expect(r?.name).toBe('Priority');
    expect(r?.alias).toBe('p');
    expect(r?.inlineValues).toEqual(['High red', 'Low blue']);
  });

  it('parses single-line values with multi-word name (canonical)', () => {
    const r = parseTagDeclaration('tag Risk Level as lo High red, Low blue');
    expect(r?.name).toBe('Risk Level');
    expect(r?.alias).toBe('lo');
    expect(r?.inlineValues).toEqual(['High red', 'Low blue']);
  });

  it('parses inline values with no alias', () => {
    const r = parseTagDeclaration('tag Priority High red, Low blue');
    expect(r?.name).toBe('Priority');
    expect(r?.alias).toBeUndefined();
    expect(r?.inlineValues).toEqual(['High red', 'Low blue']);
  });

  it('parses tag with color hint on name', () => {
    const r = parseTagDeclaration('tag Location blue');
    expect(r?.name).toBe('Location');
    expect(r?.colorHint).toBe('blue');
  });

  it('parses values without alias', () => {
    const r = parseTagDeclaration(
      'tag Phase Planning blue, Execution green, Review purple'
    );
    expect(r?.name).toBe('Phase');
    expect(r?.alias).toBeUndefined();
    // 'Planning blue' starts the inline-value span (first comma-delimited value)
    expect(r?.inlineValues).toEqual([
      'Planning blue',
      'Execution green',
      'Review purple',
    ]);
  });

  it('returns null for non-tag lines', () => {
    expect(parseTagDeclaration('title My Title')).toBeNull();
    expect(parseTagDeclaration('direction-tb')).toBeNull();
    expect(parseTagDeclaration('')).toBeNull();
  });

  it('returns null for tag: (colon syntax)', () => {
    expect(parseTagDeclaration('tag: Priority')).toBeNull();
  });

  it('returns null for bare tag keyword', () => {
    expect(parseTagDeclaration('tag')).toBeNull();
    expect(parseTagDeclaration('tag ')).toBeNull();
  });
});

describe('matchTagBlockHeading (via parseTagDeclaration)', () => {
  it('matches canonical `as` form via matchTagBlockHeading', () => {
    const r = matchTagBlockHeading('tag Priority as p');
    expect(r?.name).toBe('Priority');
    expect(r?.alias).toBe('p');
  });

  it('does not infer a trailing bare token as an alias', () => {
    const r = matchTagBlockHeading('tag Priority p');
    expect(r?.name).toBe('Priority p');
    expect(r?.alias).toBeUndefined();
  });

  it('rejects old colon syntax', () => {
    expect(matchTagBlockHeading('tag: Location loc')).toBeNull();
  });

  it('rejects legacy ## syntax', () => {
    expect(matchTagBlockHeading('## Location')).toBeNull();
  });
});

describe('isTagBlockHeading (no-colon only)', () => {
  it('returns true for no-colon syntax', () => {
    expect(isTagBlockHeading('tag Priority')).toBe(true);
    expect(isTagBlockHeading('tag Priority p High red, Low blue')).toBe(true);
  });

  it('returns false for old syntaxes', () => {
    expect(isTagBlockHeading('tag: Priority')).toBe(false);
    expect(isTagBlockHeading('## Priority')).toBe(false);
  });
});

// ============================================================
// resolveTagColor
// ============================================================

describe('resolveTagColor', () => {
  const groups: TagGroup[] = [
    {
      name: 'Role',
      entries: [
        { value: 'Engineer', color: '#5e81ac', lineNumber: 3 },
        { value: 'Manager', color: '#a3be8c', lineNumber: 4 },
      ],
      defaultValue: 'Engineer',
      lineNumber: 2,
    },
    {
      name: 'Location',
      entries: [
        { value: 'NY', color: '#bf616a', lineNumber: 7 },
        { value: 'SF', color: '#ebcb8b', lineNumber: 8 },
      ],
      lineNumber: 6,
    },
  ];

  it('returns undefined when no group is active', () => {
    expect(resolveTagColor({ role: 'Engineer' }, groups, null)).toBeUndefined();
  });

  it('returns undefined when active group does not exist', () => {
    expect(
      resolveTagColor({ role: 'Engineer' }, groups, 'Nonexistent')
    ).toBeUndefined();
  });

  it('returns matching entry color', () => {
    expect(resolveTagColor({ role: 'Engineer' }, groups, 'Role')).toBe(
      '#5e81ac'
    );
  });

  it('is case-insensitive for group name and value', () => {
    expect(resolveTagColor({ role: 'manager' }, groups, 'role')).toBe(
      '#a3be8c'
    );
  });

  it('returns default value color when metadata key is missing', () => {
    expect(resolveTagColor({}, groups, 'Role')).toBe('#5e81ac');
  });

  it('returns #999999 when metadata key is missing and no default', () => {
    expect(resolveTagColor({}, groups, 'Location')).toBe('#999999');
  });

  it('returns #999999 for unknown metadata value', () => {
    expect(resolveTagColor({ location: 'London' }, groups, 'Location')).toBe(
      '#999999'
    );
  });

  it('skips default for containers', () => {
    expect(resolveTagColor({}, groups, 'Role', true)).toBe('#999999');
  });

  it('still uses explicit metadata on containers', () => {
    expect(resolveTagColor({ role: 'Manager' }, groups, 'Role', true)).toBe(
      '#a3be8c'
    );
  });
});

// ============================================================
// validateTagValues
// ============================================================

describe('validateTagValues', () => {
  const groups: TagGroup[] = [
    {
      name: 'Role',
      entries: [
        { value: 'Engineer', color: '#5e81ac', lineNumber: 3 },
        { value: 'Manager', color: '#a3be8c', lineNumber: 4 },
      ],
      lineNumber: 2,
    },
  ];

  it('emits no warnings for valid values', () => {
    const warn = vi.fn();
    validateTagValues(
      [{ metadata: { role: 'Engineer' }, lineNumber: 10 }],
      groups,
      warn
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('emits warning for unknown value', () => {
    const warn = vi.fn();
    validateTagValues(
      [{ metadata: { role: 'Intern' }, lineNumber: 10 }],
      groups,
      warn
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toBe(10);
    expect(warn.mock.calls[0][1]).toContain("Unknown value 'Intern'");
    expect(warn.mock.calls[0][1]).toContain('Role');
  });

  it('uses suggest function when provided', () => {
    const warn = vi.fn();
    const suggest = vi.fn().mockReturnValue('Did you mean "Engineer"?');
    validateTagValues(
      [{ metadata: { role: 'Enginere' }, lineNumber: 5 }],
      groups,
      warn,
      suggest
    );
    expect(suggest).toHaveBeenCalledWith('Enginere', ['Engineer', 'Manager']);
    expect(warn.mock.calls[0][1]).toContain('Did you mean "Engineer"?');
  });

  it('lists defined values when no suggest match', () => {
    const warn = vi.fn();
    const suggest = vi.fn().mockReturnValue(null);
    validateTagValues(
      [{ metadata: { role: 'Intern' }, lineNumber: 5 }],
      groups,
      warn,
      suggest
    );
    expect(warn.mock.calls[0][1]).toContain('Engineer, Manager');
  });

  it('ignores metadata keys not matching any tag group', () => {
    const warn = vi.fn();
    validateTagValues(
      [{ metadata: { team: 'Platform' }, lineNumber: 5 }],
      groups,
      warn
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('does nothing when tag groups are empty', () => {
    const warn = vi.fn();
    validateTagValues(
      [{ metadata: { role: 'Engineer' }, lineNumber: 5 }],
      [],
      warn
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

// ============================================================
// injectDefaultTagMetadata
// ============================================================

describe('injectDefaultTagMetadata', () => {
  const groups: TagGroup[] = [
    {
      name: 'Role',
      entries: [{ value: 'Engineer', color: '#5e81ac', lineNumber: 3 }],
      defaultValue: 'Engineer',
      lineNumber: 2,
    },
    {
      name: 'Location',
      entries: [{ value: 'NY', color: '#bf616a', lineNumber: 7 }],
      lineNumber: 6,
      // no defaultValue
    },
  ];

  it('injects default when key is missing', () => {
    const entities = [{ metadata: {} }];
    injectDefaultTagMetadata(entities, groups);
    expect(entities[0].metadata).toEqual({ role: 'Engineer' });
  });

  it('does not overwrite existing value', () => {
    const entities = [{ metadata: { role: 'Manager' } }];
    injectDefaultTagMetadata(entities, groups);
    expect(entities[0].metadata.role).toBe('Manager');
  });

  it('skips entities matching skip predicate', () => {
    const entities = [
      { metadata: {}, isContainer: true },
      { metadata: {}, isContainer: false },
    ];
    injectDefaultTagMetadata(
      entities,
      groups,
      (e) =>
        (e as { metadata: Record<string, string>; isContainer: boolean })
          .isContainer
    );
    expect(entities[0].metadata).toEqual({});
    expect(entities[1].metadata).toEqual({ role: 'Engineer' });
  });

  it('does nothing when no groups have defaults', () => {
    const noDefaults: TagGroup[] = [
      {
        name: 'Location',
        entries: [{ value: 'NY', color: '#bf616a', lineNumber: 7 }],
        lineNumber: 6,
      },
    ];
    const entities = [{ metadata: {} }];
    injectDefaultTagMetadata(entities, noDefaults);
    expect(entities[0].metadata).toEqual({});
  });

  it('is idempotent', () => {
    const entities = [{ metadata: {} }];
    injectDefaultTagMetadata(entities, groups);
    injectDefaultTagMetadata(entities, groups);
    expect(entities[0].metadata).toEqual({ role: 'Engineer' });
  });
});

// ============================================================
// validateTagGroupNames
// ============================================================

describe('validateTagGroupNames', () => {
  it('warns when a tag group is named "none" (case-insensitive)', () => {
    const warn = vi.fn();
    validateTagGroupNames(
      [
        { name: 'none', lineNumber: 5 },
        { name: 'Priority', lineNumber: 10 },
      ],
      warn
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toBe(5);
    expect(warn.mock.calls[0][1]).toContain('reserved keyword');
  });

  it('warns for mixed-case None', () => {
    const warn = vi.fn();
    validateTagGroupNames([{ name: 'None', lineNumber: 3 }], warn);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('warns for NONE', () => {
    const warn = vi.fn();
    validateTagGroupNames([{ name: 'NONE', lineNumber: 3 }], warn);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('does not warn for normal group names', () => {
    const warn = vi.fn();
    validateTagGroupNames(
      [
        { name: 'Priority', lineNumber: 2 },
        { name: 'Team', lineNumber: 8 },
      ],
      warn
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('does nothing with empty tag groups', () => {
    const warn = vi.fn();
    validateTagGroupNames([], warn);
    expect(warn).not.toHaveBeenCalled();
  });

  describe('tagAttrKey (DOM-safe key)', () => {
    it('is byte-identical to toLowerCase for single-identifier names', () => {
      expect(tagAttrKey('Team')).toBe('team');
      expect(tagAttrKey('Trust_Zone')).toBe('trust_zone');
      expect(tagAttrKey('Read-Path')).toBe('read-path');
    });
    it('slugs a multi-word (quoted) name to a hyphenated key', () => {
      expect(tagAttrKey('Trust Zone')).toBe('trust-zone');
      expect(tagAttrKey('  Data   Store ')).toBe('data-store');
    });
  });

  it('a multi-word group name keys its metadata by the slug, label kept', () => {
    const group: TagGroup = {
      name: 'Trust Zone',
      entries: [
        { value: 'client', color: '#11f', lineNumber: 2 },
        { value: 'provider', color: '#1f1', lineNumber: 3 },
      ],
      lineNumber: 1,
    };
    // Entity metadata is keyed by the slug (what every renderer now writes/reads).
    const color = resolveTagColor(
      { 'trust-zone': 'provider' },
      [group],
      'Trust Zone' // active-tag references the display name; matching slugs both sides
    );
    expect(color).toBe('#1f1');
  });

  describe('missing-`as` alias mistake (`tag Status s`)', () => {
    it('warns when a spaced name with no alias ends in an alias-shaped word', () => {
      const warn = vi.fn();
      validateTagGroupNames([{ name: 'Status s', lineNumber: 2 }], warn);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toBe(2);
      expect(warn.mock.calls[0][1]).toContain('tag Status as s');
      expect(warn.mock.calls[0][1]).toContain('tag "Status s"');
    });

    it('warns for a longer alias-shaped trailing word (tag Priority prio)', () => {
      const warn = vi.fn();
      validateTagGroupNames([{ name: 'Priority prio', lineNumber: 4 }], warn);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][1]).toContain('tag Priority as prio');
    });

    it('does not warn when an alias was declared', () => {
      const warn = vi.fn();
      validateTagGroupNames(
        [{ name: 'Trust Zone', alias: 'tz', lineNumber: 4 }],
        warn
      );
      expect(warn).not.toHaveBeenCalled();
    });

    it('does not warn when the trailing word is capitalized (a display name)', () => {
      const warn = vi.fn();
      validateTagGroupNames([{ name: 'Trust Zone', lineNumber: 4 }], warn);
      expect(warn).not.toHaveBeenCalled();
    });

    it('does not warn for a single-word name', () => {
      const warn = vi.fn();
      validateTagGroupNames([{ name: 'status', lineNumber: 4 }], warn);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it('accepts a multi-word name (quoted) — it slugs to a DOM-safe key', () => {
    const warn = vi.fn();
    const error = vi.fn();
    validateTagGroupNames([{ name: 'Trust Zone', lineNumber: 4 }], warn, error);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports an error when a name cannot form a valid key', () => {
    const warn = vi.fn();
    const error = vi.fn();
    // All-punctuation slugs to an empty key; a leading digit is also invalid.
    validateTagGroupNames([{ name: '!!!', lineNumber: 4 }], warn, error);
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toBe(4);
    expect(error.mock.calls[0][1]).toContain('valid key');
  });

  it('reports an error when alias contains a space', () => {
    const warn = vi.fn();
    const error = vi.fn();
    validateTagGroupNames(
      [{ name: 'Priority', alias: 'bad alias', lineNumber: 7 }],
      warn,
      error
    );
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][1]).toContain('alias');
  });

  it('falls back to warn when pushError is not supplied', () => {
    const warn = vi.fn();
    validateTagGroupNames([{ name: '!!!', lineNumber: 2 }], warn);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][1]).toContain('valid key');
  });

  it('accepts names with hyphens, underscores, and digits', () => {
    const warn = vi.fn();
    const error = vi.fn();
    validateTagGroupNames(
      [
        { name: 'risk-level', lineNumber: 1 },
        { name: 'team_2', lineNumber: 2 },
        { name: 'Priority', alias: 'p', lineNumber: 3 },
      ],
      warn,
      error
    );
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

// ============================================================
// resolveActiveTagGroup
// ============================================================
describe('resolveActiveTagGroup', () => {
  const groups = [{ name: 'Priority' }, { name: 'Team' }];

  // -- Programmatic override (highest priority) --

  it('programmatic override wins over everything', () => {
    expect(resolveActiveTagGroup(groups, 'Team', 'Priority')).toBe('Priority');
  });

  it('programmatic null means no coloring', () => {
    expect(resolveActiveTagGroup(groups, 'Team', null)).toBeNull();
  });

  it('programmatic empty string treated as null', () => {
    expect(resolveActiveTagGroup(groups, 'Team', '')).toBeNull();
  });

  it('programmatic "none" (case-insensitive) returns null', () => {
    expect(resolveActiveTagGroup(groups, 'Team', 'none')).toBeNull();
    expect(resolveActiveTagGroup(groups, 'Team', 'None')).toBeNull();
    expect(resolveActiveTagGroup(groups, 'Team', 'NONE')).toBeNull();
    expect(resolveActiveTagGroup(groups, 'Team', 'nOnE')).toBeNull();
  });

  // -- Diagram-level active-tag option --

  it('explicit active-tag selects that group', () => {
    expect(resolveActiveTagGroup(groups, 'Team')).toBe('Team');
  });

  it('explicit active-tag "none" (case-insensitive) returns null', () => {
    expect(resolveActiveTagGroup(groups, 'none')).toBeNull();
    expect(resolveActiveTagGroup(groups, 'None')).toBeNull();
    expect(resolveActiveTagGroup(groups, 'NONE')).toBeNull();
  });

  // -- Auto-activate first group (default colored rendering) --

  it('explicit empty string → auto-activates first group', () => {
    expect(resolveActiveTagGroup(groups, '')).toBe('Priority');
  });

  it('no explicit tag + tag groups present → auto-activates first group', () => {
    expect(resolveActiveTagGroup(groups, undefined)).toBe('Priority');
  });

  it('no explicit tag + no tag groups → null', () => {
    expect(resolveActiveTagGroup([], undefined)).toBeNull();
  });

  // -- Edge cases --

  it('explicit active-tag names nonexistent group → returns name anyway', () => {
    expect(resolveActiveTagGroup(groups, 'Nonexistent')).toBe('Nonexistent');
  });

  it('programmatic undefined falls through to explicit', () => {
    expect(resolveActiveTagGroup(groups, 'Team', undefined)).toBe('Team');
  });

  it('programmatic undefined + no explicit → auto-activates first group', () => {
    expect(resolveActiveTagGroup(groups, undefined, undefined)).toBe(
      'Priority'
    );
  });
});

// ============================================================
// assignAutoTagColors — auto-pick palette colors for bare values
// ============================================================

describe('assignAutoTagColors', () => {
  const mkGroup = (
    entries: Array<{ value: string; color: string }>
  ): Writable<TagGroup> => ({
    name: 'Priority',
    entries: entries.map((e, i) => ({ ...e, lineNumber: i + 1 })),
    lineNumber: 1,
  });

  it('assigns a deterministic palette color to a bare value', () => {
    const g = mkGroup([{ value: 'High', color: AUTO_TAG_COLOR_SENTINEL }]);
    assignAutoTagColors(g);
    const [e] = g.entries as TagEntry[];
    expect(e!.color).not.toBe(AUTO_TAG_COLOR_SENTINEL);
    expect(e!.color).toMatch(/^#/);
    // First free cycle color is the first cycle name (red).
    expect(e!.color).toBe(resolveColor(autoTagColorCycle[0]!));
  });

  it('leaves explicit colors untouched (explicit wins)', () => {
    const explicit = resolveColor('blue')!;
    const g = mkGroup([{ value: 'High', color: explicit }]);
    assignAutoTagColors(g);
    expect((g.entries as TagEntry[])[0]!.color).toBe(explicit);
  });

  it('skips a color used by an explicit entry that appears AFTER the bare one', () => {
    // High is bare, Low is explicit red below it. High must NOT get red.
    const red = resolveColor('red')!;
    const g = mkGroup([
      { value: 'High', color: AUTO_TAG_COLOR_SENTINEL },
      { value: 'Low', color: red },
    ]);
    assignAutoTagColors(g);
    const entries = g.entries as TagEntry[];
    expect(entries[1]!.color).toBe(red); // explicit untouched
    expect(entries[0]!.color).not.toBe(red); // bare skipped red
    expect(entries[0]!.color).toMatch(/^#/);
  });

  it('does not collide two bare values while names remain', () => {
    const g = mkGroup([
      { value: 'A', color: AUTO_TAG_COLOR_SENTINEL },
      { value: 'B', color: AUTO_TAG_COLOR_SENTINEL },
      { value: 'C', color: AUTO_TAG_COLOR_SENTINEL },
    ]);
    assignAutoTagColors(g);
    const colors = (g.entries as TagEntry[]).map((e) => e.color);
    expect(new Set(colors).size).toBe(3);
  });

  it('is deterministic — same input yields same colors', () => {
    const build = () =>
      mkGroup([
        { value: 'A', color: AUTO_TAG_COLOR_SENTINEL },
        { value: 'B', color: resolveColor('green')! },
        { value: 'C', color: AUTO_TAG_COLOR_SENTINEL },
      ]);
    const g1 = build();
    const g2 = build();
    assignAutoTagColors(g1);
    assignAutoTagColors(g2);
    expect((g1.entries as TagEntry[]).map((e) => e.color)).toEqual(
      (g2.entries as TagEntry[]).map((e) => e.color)
    );
  });

  it('wraps the cycle when there are more bare values than free names', () => {
    const n = autoTagColorCycle.length + 2;
    const g = mkGroup(
      Array.from({ length: n }, (_, i) => ({
        value: `V${i}`,
        color: AUTO_TAG_COLOR_SENTINEL,
      }))
    );
    assignAutoTagColors(g);
    const colors = (g.entries as TagEntry[]).map((e) => e.color);
    // Every entry gets a real color; first cycle-length are distinct.
    expect(colors.every((c) => c.startsWith('#'))).toBe(true);
    expect(new Set(colors.slice(0, autoTagColorCycle.length)).size).toBe(
      autoTagColorCycle.length
    );
  });

  it('is a no-op when no bare values are present', () => {
    const g = mkGroup([{ value: 'High', color: resolveColor('red')! }]);
    const before = (g.entries as TagEntry[])[0]!.color;
    assignAutoTagColors(g);
    expect((g.entries as TagEntry[])[0]!.color).toBe(before);
  });

  it('resolves names against the supplied palette', () => {
    const palette = { colors: { red: '#ff0000' } };
    const g = mkGroup([{ value: 'High', color: AUTO_TAG_COLOR_SENTINEL }]);
    assignAutoTagColors(g, palette);
    expect((g.entries as TagEntry[])[0]!.color).toBe('#ff0000');
  });

  it('autoTagColorCycle excludes the neutral names', () => {
    expect(autoTagColorCycle).not.toContain('gray');
    expect(autoTagColorCycle).not.toContain('black');
    expect(autoTagColorCycle).not.toContain('white');
  });

  it('finalizeAutoTagColors runs over every group', () => {
    const groups: Writable<TagGroup>[] = [
      mkGroup([{ value: 'High', color: AUTO_TAG_COLOR_SENTINEL }]),
      mkGroup([{ value: 'Low', color: AUTO_TAG_COLOR_SENTINEL }]),
    ];
    finalizeAutoTagColors(groups);
    for (const g of groups) {
      expect((g.entries as TagEntry[])[0]!.color).toMatch(/^#/);
    }
  });
});

describe('quoting in tag groups (§2.2)', () => {
  const mkGroup = (
    entries: Array<{ value: string; color: string }>
  ): Writable<TagGroup> => ({
    name: 'Priority',
    entries: entries.map((e, i) => ({ ...e, lineNumber: i + 1 })),
    lineNumber: 1,
  });

  it('peels quotes from a tag value at finalize', () => {
    const groups = [
      mkGroup([
        { value: '"High | Risk"', color: '#ff0000' },
        { value: 'Low', color: '#0000ff' },
      ]),
    ];
    finalizeAutoTagColors(groups);
    expect((groups[0]!.entries as TagEntry[]).map((e) => e.value)).toEqual([
      'High | Risk',
      'Low',
    ]);
  });

  it('peels quotes from the group default value too', () => {
    const groups = [mkGroup([{ value: '"High | Risk"', color: '#ff0000' }])];
    groups[0]!.defaultValue = '"High | Risk"';
    finalizeAutoTagColors(groups);
    expect(groups[0]!.defaultValue).toBe('High | Risk');
  });

  it('leaves an interior quote alone — there is no escape form', () => {
    const groups = [mkGroup([{ value: 'say "hi" loudly', color: '#ff0000' }])];
    finalizeAutoTagColors(groups);
    expect((groups[0]!.entries as TagEntry[])[0]!.value).toBe(
      'say "hi" loudly'
    );
  });
});

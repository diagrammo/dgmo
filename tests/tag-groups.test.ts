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
} from '../src/utils/tag-groups';
import type { TagGroup } from '../src/utils/tag-groups';

// ============================================================
// stripDefaultModifier
// ============================================================

describe('stripDefaultModifier', () => {
  it('strips trailing default keyword', () => {
    expect(stripDefaultModifier('NA(gray) default')).toEqual({
      text: 'NA(gray)',
      isDefault: true,
    });
  });

  it('handles default with extra trailing whitespace', () => {
    expect(stripDefaultModifier('NA(gray) default  ')).toEqual({
      text: 'NA(gray)',
      isDefault: true,
    });
  });

  it('returns original text when no default keyword', () => {
    expect(stripDefaultModifier('Done(green)')).toEqual({
      text: 'Done(green)',
      isDefault: false,
    });
  });

  it('does not match default in the middle of a string', () => {
    expect(stripDefaultModifier('default(blue)')).toEqual({
      text: 'default(blue)',
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
    expect(isTagBlockHeading('TAG Rank(blue)')).toBe(true);
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
      legacyForm: undefined,
    });
  });

  it('parses canonical `as` form (Tag mixed-case)', () => {
    const result = matchTagBlockHeading('Tag Rank as r');
    expect(result).toEqual({
      name: 'Rank',
      alias: 'r',
      colorHint: undefined,
      inlineValues: undefined,
      legacyForm: undefined,
    });
  });

  it('parses legacy bare-shorthand and flags it (Tag Rank r)', () => {
    const result = matchTagBlockHeading('Tag Rank r');
    expect(result).toEqual({
      name: 'Rank',
      alias: 'r',
      colorHint: undefined,
      inlineValues: undefined,
      legacyForm: 'bare-shorthand',
    });
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
      legacyForm: undefined,
    });
  });

  it('parses canonical `tag Name as alias` form', () => {
    const r = parseTagDeclaration('tag Priority as p');
    expect(r?.name).toBe('Priority');
    expect(r?.alias).toBe('p');
    expect(r?.legacyForm).toBeUndefined();
  });

  it('flags legacy `tag Name alias` form', () => {
    const r = parseTagDeclaration('tag Priority alias p');
    expect(r?.name).toBe('Priority');
    expect(r?.alias).toBe('p');
    expect(r?.legacyForm).toBe('alias-keyword');
  });

  it('flags legacy bare-shorthand (1-4 lowercase)', () => {
    const r = parseTagDeclaration('tag Priority p');
    expect(r?.name).toBe('Priority');
    expect(r?.alias).toBe('p');
    expect(r?.legacyForm).toBe('bare-shorthand');
  });

  it('flags legacy multi-char shorthand', () => {
    const r = parseTagDeclaration('tag Engineering eng');
    expect(r?.name).toBe('Engineering');
    expect(r?.alias).toBe('eng');
    expect(r?.legacyForm).toBe('bare-shorthand');
  });

  it('widened universal-alias regex accepts 5+ chars and uppercase as legacy bare-shorthand', () => {
    // Post-TD-18: widened to [A-Za-z][A-Za-z0-9_]{0,11}. Tokens like
    // `level` and `High` now pass the alias regex; the bare form is
    // still flagged as legacy so the parser can emit a diagnostic.
    const a = parseTagDeclaration('tag Priority level');
    expect(a?.name).toBe('Priority');
    expect(a?.alias).toBe('level');
    expect(a?.legacyForm).toBe('bare-shorthand');

    const b = parseTagDeclaration('tag Priority High');
    expect(b?.name).toBe('Priority');
    expect(b?.alias).toBe('High');
    expect(b?.legacyForm).toBe('bare-shorthand');
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
    expect(r?.legacyForm).toBeUndefined();
  });

  it('parses quoted tag name with legacy bare alias', () => {
    const r = parseTagDeclaration('tag "A Team" at');
    expect(r?.name).toBe('A Team');
    expect(r?.alias).toBe('at');
    expect(r?.legacyForm).toBe('bare-shorthand');
  });

  it('parses single-line values (canonical `as` form)', () => {
    const r = parseTagDeclaration('tag Priority as p High(red), Low(blue)');
    expect(r?.name).toBe('Priority');
    expect(r?.alias).toBe('p');
    expect(r?.inlineValues).toEqual(['High(red)', 'Low(blue)']);
    expect(r?.legacyForm).toBeUndefined();
  });

  it('parses single-line values with multi-word name (canonical)', () => {
    const r = parseTagDeclaration('tag Risk Level as lo High(red), Low(blue)');
    expect(r?.name).toBe('Risk Level');
    expect(r?.alias).toBe('lo');
    expect(r?.inlineValues).toEqual(['High(red)', 'Low(blue)']);
    expect(r?.legacyForm).toBeUndefined();
  });

  it('parses single-line values with legacy multi-word bare shorthand', () => {
    const r = parseTagDeclaration('tag Risk Level lo High(red), Low(blue)');
    expect(r?.name).toBe('Risk Level');
    expect(r?.alias).toBe('lo');
    expect(r?.legacyForm).toBe('bare-shorthand');
  });

  it('parses tag with color hint on name', () => {
    const r = parseTagDeclaration('tag Location(blue)');
    expect(r?.name).toBe('Location');
    expect(r?.colorHint).toBe('blue');
  });

  it('parses values without alias', () => {
    const r = parseTagDeclaration(
      'tag Phase Planning(blue), Execution(green), Review(purple)'
    );
    expect(r?.name).toBe('Phase');
    expect(r?.alias).toBeUndefined();
    // 'Planning(blue)' starts inline values due to `(`
    expect(r?.inlineValues).toEqual([
      'Planning(blue)',
      'Execution(green)',
      'Review(purple)',
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
    expect(r?.legacyForm).toBeUndefined();
  });

  it('matches legacy bare shorthand and flags it', () => {
    const r = matchTagBlockHeading('tag Priority p');
    expect(r?.name).toBe('Priority');
    expect(r?.alias).toBe('p');
    expect(r?.legacyForm).toBe('bare-shorthand');
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
    expect(isTagBlockHeading('tag Priority p High(red), Low(blue)')).toBe(true);
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

  it('reports an error when tag name contains a space', () => {
    const warn = vi.fn();
    const error = vi.fn();
    validateTagGroupNames(
      [{ name: 'Layer alias', lineNumber: 4 }],
      warn,
      error
    );
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toBe(4);
    expect(error.mock.calls[0][1]).toContain('invalid characters');
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
    validateTagGroupNames([{ name: 'Layer alias', lineNumber: 2 }], warn);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][1]).toContain('invalid characters');
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

  // -- Collapsed-by-default (no auto-activation; coloring is opt-in per spec §1.3) --

  it('explicit empty string → null (no auto-activation)', () => {
    expect(resolveActiveTagGroup(groups, '')).toBeNull();
  });

  it('no explicit tag + tag groups present → null (collapsed-by-default)', () => {
    expect(resolveActiveTagGroup(groups, undefined)).toBeNull();
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

  it('programmatic undefined + no explicit → null (collapsed-by-default)', () => {
    expect(resolveActiveTagGroup(groups, undefined, undefined)).toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  TAG_BLOCK_RE,
  GROUP_HEADING_RE,
  isTagBlockHeading,
  matchTagBlockHeading,
  resolveTagColor,
  validateTagValues,
  injectDefaultTagMetadata,
} from '../src/utils/tag-groups';
import type { TagGroup } from '../src/utils/tag-groups';

describe('TAG_BLOCK_RE', () => {
  it('matches simple tag: heading', () => {
    const m = 'tag: Location'.match(TAG_BLOCK_RE);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('Location');
  });

  it('matches tag: with alias', () => {
    const m = 'tag: Location alias loc'.match(TAG_BLOCK_RE);
    expect(m![1]).toBe('Location');
    expect(m![2]).toBe('loc');
  });

  it('matches tag: with color hint', () => {
    const m = 'tag: Location(blue)'.match(TAG_BLOCK_RE);
    expect(m![1]).toBe('Location');
    expect(m![3]).toBe('blue');
  });

  it('matches tag: with alias and color hint', () => {
    const m = 'tag: Location alias loc(blue)'.match(TAG_BLOCK_RE);
    expect(m![1]).toBe('Location');
    expect(m![2]).toBe('loc');
    expect(m![3]).toBe('blue');
  });

  it('is case-insensitive', () => {
    expect('Tag: Rank'.match(TAG_BLOCK_RE)).not.toBeNull();
    expect('TAG: Rank'.match(TAG_BLOCK_RE)).not.toBeNull();
    expect('tAg: Rank'.match(TAG_BLOCK_RE)).not.toBeNull();
  });

  it('does not match tags: (with s — different directive)', () => {
    expect('tags: file.dgmo'.match(TAG_BLOCK_RE)).toBeNull();
  });

  it('does not match non-tag lines', () => {
    expect('title: My Chart'.match(TAG_BLOCK_RE)).toBeNull();
    expect('## Location'.match(TAG_BLOCK_RE)).toBeNull();
  });
});

describe('GROUP_HEADING_RE', () => {
  it('matches ## heading', () => {
    const m = '## Location'.match(GROUP_HEADING_RE);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('Location');
  });

  it('matches ## with alias', () => {
    const m = '## Location alias loc'.match(GROUP_HEADING_RE);
    expect(m![1]).toBe('Location');
    expect(m![2]).toBe('loc');
  });

  it('does not match tag: syntax', () => {
    expect('tag: Location'.match(GROUP_HEADING_RE)).toBeNull();
  });
});

describe('isTagBlockHeading', () => {
  it('returns true for tag: syntax', () => {
    expect(isTagBlockHeading('tag: Location')).toBe(true);
    expect(isTagBlockHeading('Tag: Location alias loc')).toBe(true);
    expect(isTagBlockHeading('TAG: Rank(blue)')).toBe(true);
  });

  it('returns true for ## syntax', () => {
    expect(isTagBlockHeading('## Location')).toBe(true);
    expect(isTagBlockHeading('## Location alias loc')).toBe(true);
  });

  it('returns false for other lines', () => {
    expect(isTagBlockHeading('title: My Chart')).toBe(false);
    expect(isTagBlockHeading('tags: file.dgmo')).toBe(false);
    expect(isTagBlockHeading('Hello World')).toBe(false);
    expect(isTagBlockHeading('')).toBe(false);
  });
});

describe('matchTagBlockHeading', () => {
  it('parses tag: heading as non-deprecated', () => {
    const result = matchTagBlockHeading('tag: Location');
    expect(result).toEqual({
      name: 'Location',
      alias: undefined,
      colorHint: undefined,
      deprecated: false,
    });
  });

  it('parses Tag: (mixed case) as non-deprecated', () => {
    const result = matchTagBlockHeading('Tag: Rank alias r');
    expect(result).toEqual({
      name: 'Rank',
      alias: 'r',
      colorHint: undefined,
      deprecated: false,
    });
  });

  it('parses ## heading as deprecated', () => {
    const result = matchTagBlockHeading('## Location');
    expect(result).toEqual({
      name: 'Location',
      alias: undefined,
      colorHint: undefined,
      deprecated: true,
    });
  });

  it('parses ## with alias and color as deprecated', () => {
    const result = matchTagBlockHeading('## Location alias loc(blue)');
    expect(result).toEqual({
      name: 'Location',
      alias: 'loc',
      colorHint: 'blue',
      deprecated: true,
    });
  });

  it('returns null for non-matching lines', () => {
    expect(matchTagBlockHeading('title: My Chart')).toBeNull();
    expect(matchTagBlockHeading('Hello World')).toBeNull();
    expect(matchTagBlockHeading('')).toBeNull();
  });

  it('prefers tag: syntax over ## when both would match', () => {
    // tag: syntax is checked first — this line only matches tag:
    const result = matchTagBlockHeading('tag: Rank alias r');
    expect(result!.deprecated).toBe(false);
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
    expect(resolveTagColor({ role: 'Engineer' }, groups, 'Nonexistent')).toBeUndefined();
  });

  it('returns matching entry color', () => {
    expect(resolveTagColor({ role: 'Engineer' }, groups, 'Role')).toBe('#5e81ac');
  });

  it('is case-insensitive for group name and value', () => {
    expect(resolveTagColor({ role: 'manager' }, groups, 'role')).toBe('#a3be8c');
  });

  it('returns default value color when metadata key is missing', () => {
    expect(resolveTagColor({}, groups, 'Role')).toBe('#5e81ac');
  });

  it('returns #999999 when metadata key is missing and no default', () => {
    expect(resolveTagColor({}, groups, 'Location')).toBe('#999999');
  });

  it('returns #999999 for unknown metadata value', () => {
    expect(resolveTagColor({ location: 'London' }, groups, 'Location')).toBe('#999999');
  });

  it('skips default for containers', () => {
    expect(resolveTagColor({}, groups, 'Role', true)).toBe('#999999');
  });

  it('still uses explicit metadata on containers', () => {
    expect(resolveTagColor({ role: 'Manager' }, groups, 'Role', true)).toBe('#a3be8c');
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
      warn,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('emits warning for unknown value', () => {
    const warn = vi.fn();
    validateTagValues(
      [{ metadata: { role: 'Intern' }, lineNumber: 10 }],
      groups,
      warn,
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
      suggest,
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
      suggest,
    );
    expect(warn.mock.calls[0][1]).toContain('Engineer, Manager');
  });

  it('ignores metadata keys not matching any tag group', () => {
    const warn = vi.fn();
    validateTagValues(
      [{ metadata: { team: 'Platform' }, lineNumber: 5 }],
      groups,
      warn,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('does nothing when tag groups are empty', () => {
    const warn = vi.fn();
    validateTagValues(
      [{ metadata: { role: 'Engineer' }, lineNumber: 5 }],
      [],
      warn,
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
      entries: [
        { value: 'Engineer', color: '#5e81ac', lineNumber: 3 },
      ],
      defaultValue: 'Engineer',
      lineNumber: 2,
    },
    {
      name: 'Location',
      entries: [
        { value: 'NY', color: '#bf616a', lineNumber: 7 },
      ],
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
    injectDefaultTagMetadata(entities, groups, (e) => (e as any).isContainer);
    expect(entities[0].metadata).toEqual({});
    expect(entities[1].metadata).toEqual({ role: 'Engineer' });
  });

  it('does nothing when no groups have defaults', () => {
    const noDefaults: TagGroup[] = [
      { name: 'Location', entries: [{ value: 'NY', color: '#bf616a', lineNumber: 7 }], lineNumber: 6 },
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

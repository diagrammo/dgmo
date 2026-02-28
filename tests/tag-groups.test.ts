import { describe, it, expect } from 'vitest';
import {
  TAG_BLOCK_RE,
  GROUP_HEADING_RE,
  isTagBlockHeading,
  matchTagBlockHeading,
} from '../src/utils/tag-groups';

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

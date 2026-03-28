import { describe, it, expect } from 'vitest';
import {
  propagateGroupTags,
  computeReceiverInheritance,
  resolveSequenceTags,
} from '../src/sequence/tag-resolution';
import type {
  ParsedSequenceDgmo,
  SequenceParticipant,
  SequenceMessage,
  SequenceGroup,
} from '../src/sequence/parser';
import type { TagGroup } from '../src/utils/tag-groups';

// ============================================================
// Helper factories
// ============================================================

function makeParticipant(
  id: string,
  metadata?: Record<string, string>,
  lineNumber = 1
): SequenceParticipant {
  return { id, label: id, type: 'default', lineNumber, metadata };
}

function makeMessage(
  from: string,
  to: string,
  lineNumber: number,
  metadata?: Record<string, string>
): SequenceMessage {
  return { from, to, label: 'msg', lineNumber, metadata };
}

function makeGroup(
  name: string,
  participantIds: string[],
  metadata?: Record<string, string>,
  lineNumber = 1
): SequenceGroup {
  return { name, participantIds, lineNumber, metadata };
}

function makeTagGroup(
  name: string,
  entries: Array<{ value: string; color: string }>,
  defaultValue?: string
): TagGroup {
  return {
    name,
    entries: entries.map((e) => ({ value: e.value, color: e.color })),
    defaultValue: defaultValue ?? null,
    lineNumber: 1,
  };
}

function makeParsed(
  overrides: Partial<ParsedSequenceDgmo> = {}
): ParsedSequenceDgmo {
  return {
    title: null,
    titleLineNumber: null,
    participants: [],
    messages: [],
    elements: [],
    groups: [],
    sections: [],
    tagGroups: [],
    options: {},
    diagnostics: [],
    error: null,
    ...overrides,
  };
}

// ============================================================
// propagateGroupTags()
// ============================================================

describe('propagateGroupTags()', () => {
  it('propagates group metadata to contained participants', () => {
    const participantMeta = new Map<string, Record<string, string>>([
      ['API', {}],
      ['DB', {}],
    ]);
    const groups = [
      makeGroup('Backend', ['API', 'DB'], { concern: 'Product' }),
    ];

    propagateGroupTags(participantMeta, groups);

    expect(participantMeta.get('API')).toEqual({ concern: 'Product' });
    expect(participantMeta.get('DB')).toEqual({ concern: 'Product' });
  });

  it('does not overwrite explicit participant metadata', () => {
    const participantMeta = new Map<string, Record<string, string>>([
      ['API', { concern: 'Platform' }],
      ['DB', {}],
    ]);
    const groups = [
      makeGroup('Backend', ['API', 'DB'], { concern: 'Product' }),
    ];

    propagateGroupTags(participantMeta, groups);

    expect(participantMeta.get('API')).toEqual({ concern: 'Platform' });
    expect(participantMeta.get('DB')).toEqual({ concern: 'Product' });
  });

  it('skips groups without metadata', () => {
    const participantMeta = new Map<string, Record<string, string>>([
      ['API', {}],
    ]);
    const groups = [makeGroup('Backend', ['API'])]; // no metadata

    propagateGroupTags(participantMeta, groups);

    expect(participantMeta.get('API')).toEqual({});
  });

  it('skips participants not in the meta map', () => {
    const participantMeta = new Map<string, Record<string, string>>([
      ['API', {}],
    ]);
    const groups = [
      makeGroup('Backend', ['API', 'Unknown'], { concern: 'Product' }),
    ];

    propagateGroupTags(participantMeta, groups);

    expect(participantMeta.get('API')).toEqual({ concern: 'Product' });
    expect(participantMeta.has('Unknown')).toBe(false);
  });

  it('propagates multiple metadata keys', () => {
    const participantMeta = new Map<string, Record<string, string>>([
      ['API', {}],
    ]);
    const groups = [
      makeGroup('Backend', ['API'], { concern: 'Product', team: 'Alpha' }),
    ];

    propagateGroupTags(participantMeta, groups);

    expect(participantMeta.get('API')).toEqual({
      concern: 'Product',
      team: 'Alpha',
    });
  });
});

// ============================================================
// computeReceiverInheritance()
// ============================================================

describe('computeReceiverInheritance()', () => {
  it('inherits from a single incoming tagged message', () => {
    const participants = [makeParticipant('API'), makeParticipant('DB')];
    const messages = [makeMessage('API', 'DB', 10, { concern: 'Caching' })];
    const participantMeta = new Map<string, Record<string, string>>([
      ['API', {}],
      ['DB', {}],
    ]);

    const result = computeReceiverInheritance(
      participants,
      messages,
      'concern',
      participantMeta
    );

    expect(result.get('DB')).toBe('Caching');
    expect(result.has('API')).toBe(false);
  });

  it('inherits when multiple messages agree on the same value', () => {
    const participants = [
      makeParticipant('User'),
      makeParticipant('API'),
      makeParticipant('DB'),
    ];
    const messages = [
      makeMessage('User', 'DB', 10, { concern: 'Caching' }),
      makeMessage('API', 'DB', 11, { concern: 'Caching' }),
    ];
    const participantMeta = new Map<string, Record<string, string>>([
      ['User', {}],
      ['API', {}],
      ['DB', {}],
    ]);

    const result = computeReceiverInheritance(
      participants,
      messages,
      'concern',
      participantMeta
    );

    expect(result.get('DB')).toBe('Caching');
  });

  it('does not inherit when messages conflict (different values)', () => {
    const participants = [
      makeParticipant('User'),
      makeParticipant('API'),
      makeParticipant('DB'),
    ];
    const messages = [
      makeMessage('User', 'DB', 10, { concern: 'Caching' }),
      makeMessage('API', 'DB', 11, { concern: 'Persistence' }),
    ];
    const participantMeta = new Map<string, Record<string, string>>([
      ['User', {}],
      ['API', {}],
      ['DB', {}],
    ]);

    const result = computeReceiverInheritance(
      participants,
      messages,
      'concern',
      participantMeta
    );

    expect(result.has('DB')).toBe(false);
  });

  it('skips participant that already has a value for the key', () => {
    const participants = [makeParticipant('API'), makeParticipant('DB')];
    const messages = [makeMessage('API', 'DB', 10, { concern: 'Caching' })];
    const participantMeta = new Map<string, Record<string, string>>([
      ['API', {}],
      ['DB', { concern: 'Persistence' }],
    ]);

    const result = computeReceiverInheritance(
      participants,
      messages,
      'concern',
      participantMeta
    );

    expect(result.has('DB')).toBe(false);
  });

  it('ignores messages without metadata for the group key', () => {
    const participants = [makeParticipant('API'), makeParticipant('DB')];
    const messages = [
      makeMessage('API', 'DB', 10), // no metadata
      makeMessage('API', 'DB', 11, { other: 'value' }), // wrong key
    ];
    const participantMeta = new Map<string, Record<string, string>>([
      ['API', {}],
      ['DB', {}],
    ]);

    const result = computeReceiverInheritance(
      participants,
      messages,
      'concern',
      participantMeta
    );

    expect(result.has('DB')).toBe(false);
  });

  it('handles self-call — participant inherits from own tagged message', () => {
    const participants = [makeParticipant('API')];
    const messages = [makeMessage('API', 'API', 10, { concern: 'Caching' })];
    const participantMeta = new Map<string, Record<string, string>>([
      ['API', {}],
    ]);

    const result = computeReceiverInheritance(
      participants,
      messages,
      'concern',
      participantMeta
    );

    expect(result.get('API')).toBe('Caching');
  });
});

// ============================================================
// resolveSequenceTags() — full resolution
// ============================================================

describe('resolveSequenceTags()', () => {
  it('returns all undefined when no matching tag group', () => {
    const parsed = makeParsed({
      participants: [makeParticipant('A'), makeParticipant('B')],
      messages: [makeMessage('A', 'B', 10)],
      tagGroups: [
        makeTagGroup('concern', [{ value: 'Caching', color: 'blue' }]),
      ],
    });

    const result = resolveSequenceTags(parsed, 'nonexistent');

    expect(result.participants.get('A')).toBeUndefined();
    expect(result.participants.get('B')).toBeUndefined();
    expect(result.messages.get(10)).toBeUndefined();
  });

  it('resolves explicit participant metadata', () => {
    const parsed = makeParsed({
      participants: [
        makeParticipant('API', { concern: 'Caching' }),
        makeParticipant('DB'),
      ],
      messages: [],
      tagGroups: [
        makeTagGroup('concern', [{ value: 'Caching', color: 'blue' }]),
      ],
    });

    const result = resolveSequenceTags(parsed, 'concern');

    expect(result.participants.get('API')).toBe('Caching');
    expect(result.participants.get('DB')).toBeUndefined();
  });

  it('resolves message metadata', () => {
    const parsed = makeParsed({
      participants: [makeParticipant('A'), makeParticipant('B')],
      messages: [makeMessage('A', 'B', 10, { concern: 'Caching' })],
      tagGroups: [
        makeTagGroup('concern', [{ value: 'Caching', color: 'blue' }]),
      ],
    });

    const result = resolveSequenceTags(parsed, 'concern');

    expect(result.messages.get(10)).toBe('Caching');
  });

  it('group tag propagation sets contained participants', () => {
    const parsed = makeParsed({
      participants: [makeParticipant('API'), makeParticipant('DB')],
      messages: [],
      groups: [makeGroup('Backend', ['API', 'DB'], { concern: 'Product' })],
      tagGroups: [
        makeTagGroup('concern', [{ value: 'Product', color: 'teal' }]),
      ],
    });

    const result = resolveSequenceTags(parsed, 'concern');

    expect(result.participants.get('API')).toBe('Product');
    expect(result.participants.get('DB')).toBe('Product');
  });

  it('explicit metadata overrides group propagation', () => {
    const parsed = makeParsed({
      participants: [
        makeParticipant('API', { concern: 'Platform' }),
        makeParticipant('DB'),
      ],
      messages: [],
      groups: [makeGroup('Backend', ['API', 'DB'], { concern: 'Product' })],
      tagGroups: [
        makeTagGroup('concern', [
          { value: 'Product', color: 'teal' },
          { value: 'Platform', color: 'purple' },
        ]),
      ],
    });

    const result = resolveSequenceTags(parsed, 'concern');

    expect(result.participants.get('API')).toBe('Platform');
    expect(result.participants.get('DB')).toBe('Product');
  });

  it('receiver inheritance sets untagged receiver', () => {
    const parsed = makeParsed({
      participants: [makeParticipant('API'), makeParticipant('DB')],
      messages: [makeMessage('API', 'DB', 10, { concern: 'Caching' })],
      tagGroups: [
        makeTagGroup('concern', [{ value: 'Caching', color: 'blue' }]),
      ],
    });

    const result = resolveSequenceTags(parsed, 'concern');

    expect(result.participants.get('DB')).toBe('Caching');
  });

  it('group propagation overrides receiver inheritance', () => {
    const parsed = makeParsed({
      participants: [makeParticipant('API'), makeParticipant('DB')],
      messages: [makeMessage('API', 'DB', 10, { concern: 'Caching' })],
      groups: [makeGroup('Backend', ['DB'], { concern: 'Product' })],
      tagGroups: [
        makeTagGroup('concern', [
          { value: 'Caching', color: 'blue' },
          { value: 'Product', color: 'teal' },
        ]),
      ],
    });

    const result = resolveSequenceTags(parsed, 'concern');

    // DB gets Product from group, not Caching from receiver inheritance
    expect(result.participants.get('DB')).toBe('Product');
  });

  it('default value applies to truly untagged participants', () => {
    const parsed = makeParsed({
      participants: [
        makeParticipant('API', { concern: 'Caching' }),
        makeParticipant('DB'),
        makeParticipant('User'),
      ],
      messages: [],
      tagGroups: [
        makeTagGroup(
          'concern',
          [
            { value: 'Caching', color: 'blue' },
            { value: 'Other', color: 'gray' },
          ],
          'Other' // default
        ),
      ],
    });

    const result = resolveSequenceTags(parsed, 'concern');

    expect(result.participants.get('API')).toBe('Caching');
    expect(result.participants.get('DB')).toBe('Other');
    expect(result.participants.get('User')).toBe('Other');
  });

  it('receiver inheritance wins over default', () => {
    const parsed = makeParsed({
      participants: [makeParticipant('API'), makeParticipant('DB')],
      messages: [makeMessage('API', 'DB', 10, { concern: 'Caching' })],
      tagGroups: [
        makeTagGroup(
          'concern',
          [
            { value: 'Caching', color: 'blue' },
            { value: 'Other', color: 'gray' },
          ],
          'Other' // default
        ),
      ],
    });

    const result = resolveSequenceTags(parsed, 'concern');

    // DB inherits Caching from receiver, not Other from default
    expect(result.participants.get('DB')).toBe('Caching');
    // API has no incoming tagged messages → gets default
    expect(result.participants.get('API')).toBe('Other');
  });

  // ============================================================
  // Full priority chain
  // ============================================================

  it('full priority chain: explicit > group > receiver > default > neutral', () => {
    const parsed = makeParsed({
      participants: [
        makeParticipant('A', { concern: 'Auth' }, 1), // explicit
        makeParticipant('B', undefined, 2), // in group
        makeParticipant('C', undefined, 3), // receiver inherits
        makeParticipant('D', undefined, 4), // gets default
        makeParticipant('E', undefined, 5), // neutral (no tag group match)
      ],
      messages: [makeMessage('A', 'C', 10, { concern: 'Caching' })],
      groups: [makeGroup('Backend', ['B'], { concern: 'Product' })],
      tagGroups: [
        makeTagGroup(
          'concern',
          [
            { value: 'Auth', color: 'red' },
            { value: 'Product', color: 'teal' },
            { value: 'Caching', color: 'blue' },
            { value: 'Fallback', color: 'gray' },
          ],
          'Fallback'
        ),
      ],
    });

    const result = resolveSequenceTags(parsed, 'concern');

    expect(result.participants.get('A')).toBe('Auth'); // explicit
    expect(result.participants.get('B')).toBe('Product'); // group
    expect(result.participants.get('C')).toBe('Caching'); // receiver
    expect(result.participants.get('D')).toBe('Fallback'); // default
    // E also gets default since it has no value
    expect(result.participants.get('E')).toBe('Fallback');
  });

  // ============================================================
  // Edge cases
  // ============================================================

  it('no tag groups → all neutral', () => {
    const parsed = makeParsed({
      participants: [makeParticipant('A'), makeParticipant('B')],
      messages: [makeMessage('A', 'B', 10)],
      tagGroups: [],
    });

    const result = resolveSequenceTags(parsed, 'concern');

    expect(result.participants.get('A')).toBeUndefined();
    expect(result.participants.get('B')).toBeUndefined();
    expect(result.messages.get(10)).toBeUndefined();
  });

  it('self-call with tag → participant inherits via receiver', () => {
    const parsed = makeParsed({
      participants: [makeParticipant('API')],
      messages: [makeMessage('API', 'API', 10, { concern: 'Caching' })],
      tagGroups: [
        makeTagGroup('concern', [{ value: 'Caching', color: 'blue' }]),
      ],
    });

    const result = resolveSequenceTags(parsed, 'concern');

    expect(result.participants.get('API')).toBe('Caching');
    expect(result.messages.get(10)).toBe('Caching');
  });

  it('explicit participant tag overrides group tag for same key', () => {
    const parsed = makeParsed({
      participants: [makeParticipant('API', { concern: 'Platform' })],
      messages: [],
      groups: [makeGroup('Backend', ['API'], { concern: 'Product' })],
      tagGroups: [
        makeTagGroup('concern', [
          { value: 'Platform', color: 'purple' },
          { value: 'Product', color: 'teal' },
        ]),
      ],
    });

    const result = resolveSequenceTags(parsed, 'concern');

    expect(result.participants.get('API')).toBe('Platform');
  });

  it('case-insensitive tag group name matching', () => {
    const parsed = makeParsed({
      participants: [makeParticipant('API', { concern: 'Caching' })],
      messages: [],
      tagGroups: [
        makeTagGroup('Concern', [{ value: 'Caching', color: 'blue' }]),
      ],
    });

    const result = resolveSequenceTags(parsed, 'concern');

    expect(result.participants.get('API')).toBe('Caching');
  });

  it('empty groups (no metadata) → no propagation', () => {
    const parsed = makeParsed({
      participants: [makeParticipant('API')],
      messages: [],
      groups: [makeGroup('Backend', ['API'])], // no metadata
      tagGroups: [
        makeTagGroup('concern', [{ value: 'Caching', color: 'blue' }]),
      ],
    });

    const result = resolveSequenceTags(parsed, 'concern');

    expect(result.participants.get('API')).toBeUndefined();
  });

  it('does not mutate parsed data', () => {
    const participant = makeParticipant('API');
    const parsed = makeParsed({
      participants: [participant],
      messages: [makeMessage('X', 'API', 10, { concern: 'Caching' })],
      tagGroups: [
        makeTagGroup('concern', [{ value: 'Caching', color: 'blue' }]),
      ],
    });

    resolveSequenceTags(parsed, 'concern');

    // Original participant should not have metadata mutated
    expect(participant.metadata).toBeUndefined();
  });

  it('handles participants with no metadata (undefined)', () => {
    const parsed = makeParsed({
      participants: [makeParticipant('API')], // metadata is undefined
      messages: [],
      tagGroups: [makeTagGroup('concern', [{ value: 'X', color: 'red' }], 'X')],
    });

    const result = resolveSequenceTags(parsed, 'concern');

    expect(result.participants.get('API')).toBe('X'); // gets default
  });

  it('multiple independent tag groups resolve separately', () => {
    const parsed = makeParsed({
      participants: [
        makeParticipant('API', { concern: 'Caching', team: 'Alpha' }),
        makeParticipant('DB', { concern: 'Persistence' }),
      ],
      messages: [],
      tagGroups: [
        makeTagGroup('concern', [
          { value: 'Caching', color: 'blue' },
          { value: 'Persistence', color: 'green' },
        ]),
        makeTagGroup('team', [
          { value: 'Alpha', color: 'red' },
          { value: 'Beta', color: 'orange' },
        ]),
      ],
    });

    const concernResult = resolveSequenceTags(parsed, 'concern');
    const teamResult = resolveSequenceTags(parsed, 'team');

    expect(concernResult.participants.get('API')).toBe('Caching');
    expect(concernResult.participants.get('DB')).toBe('Persistence');

    expect(teamResult.participants.get('API')).toBe('Alpha');
    expect(teamResult.participants.get('DB')).toBeUndefined(); // no team tag
  });

  it('conflicting receiver inheritance → neutral (no value)', () => {
    const parsed = makeParsed({
      participants: [
        makeParticipant('User'),
        makeParticipant('API'),
        makeParticipant('DB'),
      ],
      messages: [
        makeMessage('User', 'DB', 10, { concern: 'Auth' }),
        makeMessage('API', 'DB', 11, { concern: 'Caching' }),
      ],
      tagGroups: [
        makeTagGroup('concern', [
          { value: 'Auth', color: 'red' },
          { value: 'Caching', color: 'blue' },
        ]),
      ],
    });

    const result = resolveSequenceTags(parsed, 'concern');

    // DB receives conflicting values → stays neutral
    expect(result.participants.get('DB')).toBeUndefined();
  });

  it('conflicting receiver inheritance with default → gets default', () => {
    const parsed = makeParsed({
      participants: [
        makeParticipant('User'),
        makeParticipant('API'),
        makeParticipant('DB'),
      ],
      messages: [
        makeMessage('User', 'DB', 10, { concern: 'Auth' }),
        makeMessage('API', 'DB', 11, { concern: 'Caching' }),
      ],
      tagGroups: [
        makeTagGroup(
          'concern',
          [
            { value: 'Auth', color: 'red' },
            { value: 'Caching', color: 'blue' },
            { value: 'Other', color: 'gray' },
          ],
          'Other'
        ),
      ],
    });

    const result = resolveSequenceTags(parsed, 'concern');

    // DB receives conflicting values, no inheritance → gets default
    expect(result.participants.get('DB')).toBe('Other');
  });
});

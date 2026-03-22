import { describe, it, expect } from 'vitest';
import { parseInitiativeStatus } from '../src/initiative-status/parser';
import { filterInitiativeStatusByTags } from '../src/initiative-status/filter';

function makeParsed(input: string) {
  return parseInitiativeStatus(input);
}

const FIXTURE = `chart: initiative-status
tag: Phase alias p
  Discovery(blue)
  Build(yellow)
  Launch(green)

[Identity]
  Auth | done, p: Discovery
  SSO | wip, p: Build
    -> Auth | done

[Payments]
  Gateway | wip, p: Build
  Billing | todo, p: Build
    -> Gateway | wip

[Search]
  SearchAPI | todo, p: Launch
  SearchUI | todo, p: Launch
    -> SearchAPI

Auth -> Gateway: validates | done
SSO -> SearchAPI: provides identity | todo`;

describe('filterInitiativeStatusByTags', () => {
  it('returns input unchanged when no hidden values', () => {
    const parsed = makeParsed(FIXTURE);
    const result = filterInitiativeStatusByTags(parsed, new Map());
    expect(result).toBe(parsed); // same reference
  });

  it('hides nodes with matching tag value', () => {
    const parsed = makeParsed(FIXTURE);
    const hidden = new Map([['phase', new Set(['launch'])]]);
    const result = filterInitiativeStatusByTags(parsed, hidden);
    expect(result.nodes.map((n) => n.label)).not.toContain('SearchAPI');
    expect(result.nodes.map((n) => n.label)).not.toContain('SearchUI');
    expect(result.nodes).toHaveLength(4); // Auth, SSO, Gateway, Billing
  });

  it('removes edges to/from hidden nodes', () => {
    const parsed = makeParsed(FIXTURE);
    const hidden = new Map([['phase', new Set(['launch'])]]);
    const result = filterInitiativeStatusByTags(parsed, hidden);
    // SSO -> SearchAPI edge should be removed (target hidden)
    expect(result.edges.some((e) => e.target === 'SearchAPI')).toBe(false);
    // Auth -> Gateway should remain
    expect(result.edges.some((e) => e.source === 'Auth' && e.target === 'Gateway')).toBe(true);
  });

  it('cleans group nodeLabels; removes empty groups', () => {
    const parsed = makeParsed(FIXTURE);
    const hidden = new Map([['phase', new Set(['launch'])]]);
    const result = filterInitiativeStatusByTags(parsed, hidden);
    // Search group had SearchAPI + SearchUI, both Launch → group removed
    expect(result.groups.map((g) => g.label)).not.toContain('Search');
    // Identity and Payments groups remain
    expect(result.groups.map((g) => g.label)).toContain('Identity');
    expect(result.groups.map((g) => g.label)).toContain('Payments');
  });

  it('keeps untagged nodes visible', () => {
    const input = `chart: initiative-status
tag: Phase alias p
  Build(yellow)

API | done, p: Build
Untagged | done`;
    const parsed = makeParsed(input);
    const hidden = new Map([['phase', new Set(['build'])]]);
    const result = filterInitiativeStatusByTags(parsed, hidden);
    expect(result.nodes.map((n) => n.label)).toContain('Untagged');
    expect(result.nodes.map((n) => n.label)).not.toContain('API');
  });

  it('handles multiple hidden values across multiple groups', () => {
    const input = `chart: initiative-status
tag: Phase alias p
  Build(yellow)
  Launch(green)
tag: Team alias t
  Frontend(purple)
  Backend(cyan)

A | done, p: Build, t: Frontend
B | done, p: Build, t: Backend
C | done, p: Launch, t: Frontend
D | done, p: Launch, t: Backend`;
    const parsed = makeParsed(input);
    // Hide Build phase AND Frontend team
    const hidden = new Map([
      ['phase', new Set(['build'])],
      ['team', new Set(['frontend'])],
    ]);
    const result = filterInitiativeStatusByTags(parsed, hidden);
    // A: Build+Frontend → hidden (Build match)
    // B: Build+Backend → hidden (Build match)
    // C: Launch+Frontend → hidden (Frontend match)
    // D: Launch+Backend → only remaining
    expect(result.nodes.map((n) => n.label)).toEqual(['D']);
  });

  it('returns empty arrays when all nodes hidden', () => {
    const input = `chart: initiative-status
tag: Phase alias p
  Build(yellow)

A | done, p: Build
B | wip, p: Build
A -> B | done`;
    const parsed = makeParsed(input);
    const hidden = new Map([['phase', new Set(['build'])]]);
    const result = filterInitiativeStatusByTags(parsed, hidden);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    // tagGroups preserved
    expect(result.tagGroups).toHaveLength(1);
  });

  it('does not mutate the original parsed object', () => {
    const parsed = makeParsed(FIXTURE);
    const originalNodeCount = parsed.nodes.length;
    const originalEdgeCount = parsed.edges.length;
    const originalGroupCount = parsed.groups.length;

    const hidden = new Map([['phase', new Set(['launch'])]]);
    filterInitiativeStatusByTags(parsed, hidden);

    expect(parsed.nodes).toHaveLength(originalNodeCount);
    expect(parsed.edges).toHaveLength(originalEdgeCount);
    expect(parsed.groups).toHaveLength(originalGroupCount);
  });

  it('partially empties group when some members hidden', () => {
    const parsed = makeParsed(FIXTURE);
    // Hide Discovery phase — only Auth (Discovery) in Identity group
    const hidden = new Map([['phase', new Set(['discovery'])]]);
    const result = filterInitiativeStatusByTags(parsed, hidden);
    const identity = result.groups.find((g) => g.label === 'Identity');
    expect(identity).toBeDefined();
    expect(identity!.nodeLabels).toEqual(['SSO']);
  });

  it('case-insensitive value matching', () => {
    const input = `chart: initiative-status
tag: Phase alias p
  Build(yellow)

API | done, p: Build`;
    const parsed = makeParsed(input);
    // Hidden set uses lowercase, metadata has "Build" (uppercase B)
    const hidden = new Map([['phase', new Set(['build'])]]);
    const result = filterInitiativeStatusByTags(parsed, hidden);
    expect(result.nodes).toHaveLength(0);
  });
});

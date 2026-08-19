import { describe, expect, it } from 'vitest';

import { parseC4 } from '../src/c4/parser';
import { parseKanban } from '../src/kanban/parser';
import { parseMindmap } from '../src/mindmap/parser';
import { parseOrg } from '../src/org/parser';
import { parseSitemap } from '../src/sitemap/parser';

// A top-level directive on the line immediately below the last tag entry —
// no blank line between them, which is what used to matter. Five parsers
// checked their option block before closing the tag group, so the group was
// still open when the directive arrived and the option branch skipped it.
// Kanban then dropped it in silence; org, mindmap and sitemap dropped it
// silently on a single-group source and blamed the *next* tag block when
// there was one; c4 rejected it as unexpected content (#301).
//
// A blank line between the two has always worked — these fixtures deliberately
// omit it.

describe('a directive on the line after a tag block', () => {
  it('kanban keeps `lane-by`', () => {
    const parsed = parseKanban(`kanban Board
tag Team
  Backend blue
  Frontend green
lane-by Team
[To Do]
  Task 1 team: Backend`);
    expect(parsed.options['lane-by']).toBe('Team');
    expect(parsed.error).toBeNull();
  });

  it('kanban keeps a bare boolean too', () => {
    const parsed = parseKanban(`kanban Board
tag Team
  Backend blue
no-legend
[To Do]
  Task 1 team: Backend`);
    expect(parsed.options['no-legend']).toBe('on');
  });

  it('kanban keeps `active-tag`', () => {
    const parsed = parseKanban(`kanban Board
tag Team
  Backend blue
active-tag Team
[To Do]
  Task 1 team: Backend`);
    expect(parsed.options['active-tag']).toBe('Team');
  });

  it('org keeps `active-tag`, and a second tag block still parses', () => {
    const parsed = parseOrg(`org Fleet
tag Rank
  Captain red
  Sailor blue
active-tag Rank
tag Ship
  Revenge blue
Ahab rank: Captain
  Smee rank: Sailor`);
    expect(parsed.options['active-tag']).toBe('Rank');
    expect(parsed.tagGroups).toHaveLength(2);
    expect(parsed.error).toBeNull();
  });

  it('mindmap keeps `active-tag`', () => {
    const parsed = parseMindmap(`mindmap Ideas
tag Worth
  High red
  Low blue
active-tag Worth
Ideas
  Ship it worth: High`);
    expect(parsed.options['active-tag']).toBe('Worth');
    expect(parsed.error).toBeNull();
  });

  it('sitemap keeps `active-tag`', () => {
    const parsed = parseSitemap(`sitemap Site
tag Access
  Public green
  Private red
active-tag Access
Home
  About access: Public`);
    expect(parsed.options['active-tag']).toBe('Access');
    expect(parsed.error).toBeNull();
  });

  it('c4 keeps `active-tag` instead of rejecting it as content', () => {
    const parsed = parseC4(`c4 System
tag Scope
  Internal blue
  External red
active-tag Scope
Web App is a container
Database is a container`);
    expect(parsed.options['active-tag']).toBe('Scope');
    expect(parsed.error).toBeNull();
  });
});

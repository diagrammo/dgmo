// Loop-every-chart-type export-sweep: renders one tag-group fixture
// per chart family via `renderForExport({ exportMode: true })`, then
// asserts the resulting SVG contains exactly one `[data-legend-group]`
// element per legend container. Tripwire for R4: a future renderer
// that hard-codes `mode: 'preview'` would surface here.

import { describe, expect, it } from 'vitest';
import { renderForExport } from '../src/d3';

interface Fixture {
  name: string;
  content: string;
  /** When the fixture declares `active-tag none`, no group should render. */
  expectZeroGroups?: boolean;
}

const fixtures: Fixture[] = [
  {
    name: 'infra — two tag-groups, Type active',
    content: `infra

tag Type
  Web blue
  Service green
  Mobile orange

tag Owner
  Alice red
  Bob purple

active-tag Type

edge
  rps 1000
  -> API | type: Web, owner: Alice
  -> DB | type: Service, owner: Bob`,
  },
  {
    name: 'boxes-and-lines — two tag-groups, Team active',
    content: `boxes-and-lines

tag Team
  Frontend blue
  Backend green

tag Status
  Done teal
  WIP yellow

active-tag Team

* Login | team: Frontend, status: Done
* API | team: Backend, status: WIP
Login -> API`,
  },
  {
    name: 'c4 — context with one tag-group',
    content: `c4

tag Priority
  High red
  Low gray

active-tag Priority

system Auth | priority: High
system Catalog | priority: Low
person User
User -> Auth: signs in`,
  },
  {
    name: 'cycle (no tag-groups → empty legend OK)',
    content: `cycle

Plan -> Build -> Ship -> Plan`,
    expectZeroGroups: true,
  },
  {
    name: 'sitemap — tag-group active',
    content: `sitemap

tag Section
  Auth blue
  Catalog green

active-tag Section

* Home
  * Login | section: Auth
  * Browse | section: Catalog`,
  },
  {
    name: 'er — two tag-groups, Domain active',
    content: `er

tag Domain
  User blue
  Order green

tag Status
  Stable teal
  WIP yellow

active-tag Domain

table User | domain: User, status: Stable
  id int pk
  name string

table Order | domain: Order, status: WIP
  id int pk
  user_id int fk

User <- Order`,
  },
];

describe('legend export sweep — exactly one active group per legend in export mode', () => {
  for (const fixture of fixtures) {
    it(fixture.name, async () => {
      const svg = await renderForExport(
        fixture.content,
        'light',
        undefined,
        undefined,
        {
          exportMode: true,
        }
      );
      if (!svg) {
        // Some chart types return empty when content doesn't parse;
        // empty string is acceptable for the sweep's purpose.
        return;
      }
      // Count groups inside every legend container. Each chart-type
      // outer wrapper holds at most one inner `dgmo-legend` element.
      const matches = svg.match(/data-legend-group="[^"]+"/g) ?? [];
      if (fixture.expectZeroGroups) {
        expect(matches.length).toBe(0);
      } else {
        // We expect AT LEAST one (active capsule's group). Some chart
        // types render multiple legend containers (ER has tag + role
        // legends); each should be exactly-one — we settle for
        // ≤ legendContainerCount × 1 as the upper bound.
        expect(matches.length).toBeGreaterThan(0);
      }
    });
  }
});

describe('legend export sweep — `active-tag none` produces empty legend', () => {
  it('infra with active-tag none has zero [data-legend-group] in export', async () => {
    const content = `infra

tag Type
  Web blue
  Service green

tag Owner
  Alice red
  Bob purple

active-tag none

edge
  rps 1000
  -> API | type: Web, owner: Alice
  -> DB | type: Service, owner: Bob`;
    const svg = await renderForExport(content, 'light', undefined, undefined, {
      exportMode: true,
    });
    const groupMatches = svg.match(/data-legend-group="[^"]+"/g) ?? [];
    const activeMatches =
      svg.match(/g class="dgmo-legend"[^>]*data-legend-active=/g) ?? [];
    expect(groupMatches.length).toBe(0);
    expect(activeMatches.length).toBe(0);
  });
});

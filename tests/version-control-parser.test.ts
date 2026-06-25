import { describe, it, expect } from 'vitest';
import { parseVersionControl } from '../src/version-control/parser';

type Parsed = ReturnType<typeof parseVersionControl>;
const errors = (p: Parsed) => p.diagnostics.filter((d) => d.severity === 'error');
const byMsg = (p: Parsed, m: string) => p.nodes.find((n) => n.message === m);

describe('version-control parser — keyword-less grammar', () => {
  it('parses bare top-level = branch, bare indented = commit, merge verb', () => {
    const p = parseVersionControl(`version-control Feature Branch Workflow

main
  Initial commit
  Add README

develop from main
  Set up CI

main
  merge develop tag: v1.0.0
  Hotfix typo type: highlight`);

    expect(errors(p)).toHaveLength(0);
    expect(p.title).toBe('Feature Branch Workflow');
    expect(p.branches.map((b) => b.name)).toEqual(['main', 'develop']);
    // 4 commits + 1 merge
    expect(p.nodes.filter((n) => n.kind === 'commit')).toHaveLength(4);
    const merge = p.nodes.find((n) => n.kind === 'merge')!;
    expect(merge.mergeFrom).not.toBeNull();
    expect(merge.tag).toBe('v1.0.0');
    expect(byMsg(p, 'Hotfix typo')!.type).toBe('highlight');
  });

  it('re-naming a branch resumes it (checkout) and interleaves in time', () => {
    const p = parseVersionControl(`version-control X

main
  A
feature from main
  B
main
  C`);
    const a = byMsg(p, 'A')!;
    const b = byMsg(p, 'B')!;
    const c = byMsg(p, 'C')!;
    expect(a.branch).toBe('main');
    expect(b.branch).toBe('feature');
    expect(c.branch).toBe('main');
    // C follows B in time (interleave) and is on main's chain after A
    expect(c.seq).toBeGreaterThan(b.seq);
    expect(c.prev).toBe(a.key);
    // feature's first commit branches off main's tip (A)
    expect(b.parent).toBe(a.key);
  });

  it('id: shows a SHA only when authored; trailing color token', () => {
    const p = parseVersionControl(`version-control R

main red
  Bootstrap id: 0a1b2c3
  Plain commit`);
    expect(p.branches[0]!.colorToken).toBe('red');
    expect(byMsg(p, 'Bootstrap')!.id).toBe('0a1b2c3');
    expect(byMsg(p, 'Plain commit')!.id).toBeNull();
  });
});

describe('version-control parser — beyond Mermaid', () => {
  it('ref + auto-HEAD + ahead/behind from DAG distance', () => {
    const p = parseVersionControl(`version-control Sync

main
  Bootstrap
  Payment API
  Rate limiter
  Hotfix cap

ref origin/main at Payment API`);
    const origin = p.refs.find((r) => r.name === 'origin/main')!;
    expect(origin.remote).toBe(true);
    expect(origin.atKey).not.toBeNull();
    // HEAD auto-added on the active tip
    expect(p.refs.some((r) => r.head)).toBe(true);
    // main is 2 ahead of origin/main (Rate limiter + Hotfix cap)
    expect(p.branches.find((b) => b.name === 'main')!.ab).toEqual({ ahead: 2, behind: 0 });
  });

  it('rebase ghosts the originals and replays solid copies with move links', () => {
    const p = parseVersionControl(`version-control Rebase

main
  Init
  Add API
feature from main
  Work A
  Work B
main
  Fix bug
rebase feature onto main`);
    const ghosts = p.nodes.filter((n) => n.ghost);
    const moved = p.nodes.filter((n) => n.movedTo != null);
    expect(ghosts).toHaveLength(2); // Work A, Work B originals
    expect(moved).toHaveLength(2);
    // each ghost points to a solid copy
    for (const g of ghosts) expect(p.nodes[g.movedTo!]!.ghost).toBe(false);
  });

  it('reset orphans later commits (ghosts); revert adds inverse commit', () => {
    const p = parseVersionControl(`version-control Undo

main
  Init
  Good change
  Bad change

reset main to Good change

main
  Real fix
  revert Real fix`);
    expect(byMsg(p, 'Bad change')!.ghost).toBe(true);
    expect(byMsg(p, 'Good change')!.ghost).toBe(false);
    const revert = byMsg(p, 'Revert Real fix')!;
    expect(revert.type).toBe('reverse');
    expect(revert.revertFrom).toBe(byMsg(p, 'Real fix')!.key);
  });

  it('squash merge ghosts the source and adds an absorbing commit; notes are numbered', () => {
    const p = parseVersionControl(`version-control Squash

main
  Init
  note Trunk starts here

experiment from main
  Spike 1
  Spike 2

main
  merge experiment squash tag: v1.1`);
    expect(byMsg(p, 'Spike 1')!.ghost).toBe(true);
    expect(byMsg(p, 'Spike 2')!.ghost).toBe(true);
    const squash = byMsg(p, 'Squash experiment')!;
    expect(squash.squashFrom).not.toBeNull();
    expect(squash.tag).toBe('v1.1');
    expect(p.notes).toHaveLength(1);
    expect(p.notes[0]!.text).toBe('Trunk starts here');
  });

  it('direction TB/BT + cherry-pick', () => {
    const p = parseVersionControl(`version-control C
direction TB

main
  Release
hotfix from main
  Patch

main
  cherry-pick Patch`);
    expect(p.options.direction).toBe('TB');
    const cp = p.nodes.find((n) => n.kind === 'cherry')!;
    expect(cp.cherryFrom).toBe(byMsg(p, 'Patch')!.key);
  });
});

describe('version-control parser — diagnostics', () => {
  it('empty graph errors', () => {
    const p = parseVersionControl('version-control Empty');
    expect(errors(p).length).toBeGreaterThan(0);
    expect(errors(p)[0]!.code).toBe('E_VERSION_CONTROL_NO_COMMITS');
  });

  it('merge of an unknown branch warns', () => {
    const p = parseVersionControl(`version-control U

main
  A
  merge ghostbranch`);
    expect(
      p.diagnostics.some((d) => d.code === 'E_VERSION_CONTROL_UNKNOWN_BRANCH')
    ).toBe(true);
  });
});

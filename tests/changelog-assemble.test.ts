// changelog.d/ fragments → CHANGELOG.md at release (diagrammo/diagrammo#2340).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble, assembleDir } from '../scripts/changelog-assemble.mjs';

const HEAD = '# Changelog\n\nIntro.\n\n';
const OLD = '## [0.1.0] - 2026-01-01\n\n### Added\n\n- old entry\n';

describe('assemble', () => {
  it('puts fragments under the new version, above the previous release, sections in Keep a Changelog order', () => {
    const out = assemble(
      HEAD + OLD,
      [
        '### Fixed\n\n- fix a\n',
        '### Added\n\n- add b\n\n### Fixed\n\n- fix c\n',
      ],
      '0.2.0',
      '2026-11-25'
    );
    expect(out).toBe(
      HEAD +
        '## [0.2.0] - 2026-11-25\n\n### Added\n\n- add b\n\n### Fixed\n\n- fix a\n\n- fix c\n\n' +
        OLD
    );
  });

  it('files text before any heading under Changed', () => {
    const out = assemble(
      HEAD + OLD,
      ['- bare entry\n'],
      '0.2.0',
      '2026-11-25'
    )!;
    expect(out).toContain(
      '## [0.2.0] - 2026-11-25\n\n### Changed\n\n- bare entry\n\n## [0.1.0]'
    );
  });

  it('folds a hand-written Unreleased section in first and drops its heading', () => {
    const out = assemble(
      HEAD + '## [Unreleased]\n\n### Added\n\n- by hand\n\n' + OLD,
      ['### Added\n\n- fragment\n'],
      '0.2.0',
      '2026-11-25'
    )!;
    expect(out).not.toContain('Unreleased');
    expect(out).toContain('### Added\n\n- by hand\n\n- fragment\n\n## [0.1.0]');
  });

  it('returns null when there are no fragments and no Unreleased text', () => {
    expect(assemble(HEAD + OLD, [], '0.2.0', '2026-11-25')).toBeNull();
  });

  it('appends after the intro when no release exists yet', () => {
    const out = assemble(
      HEAD,
      ['### Added\n\n- first\n'],
      '0.1.0',
      '2026-11-25'
    );
    expect(out).toBe(
      HEAD + '## [0.1.0] - 2026-11-25\n\n### Added\n\n- first\n'
    );
  });
});

describe('assembleDir', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'changelog-'));
    writeFileSync(join(dir, 'CHANGELOG.md'), HEAD + OLD);
    mkdirSync(join(dir, 'changelog.d'));
    writeFileSync(join(dir, 'changelog.d', 'README.md'), '# not a fragment\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes CHANGELOG.md, deletes the fragments in name order, keeps the README', () => {
    writeFileSync(join(dir, 'changelog.d', 'b.md'), '### Fixed\n\n- second\n');
    writeFileSync(join(dir, 'changelog.d', 'a.md'), '### Fixed\n\n- first\n');
    expect(assembleDir(dir, '0.2.0', '2026-11-25')).toEqual(['a.md', 'b.md']);
    expect(readdirSync(join(dir, 'changelog.d'))).toEqual(['README.md']);
    const text = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    expect(text).toContain(
      '## [0.2.0] - 2026-11-25\n\n### Fixed\n\n- first\n\n- second\n'
    );
    expect(text).not.toContain('not a fragment');
  });

  it('leaves CHANGELOG.md untouched when there are no fragments', () => {
    expect(assembleDir(dir, '0.2.0', '2026-11-25')).toEqual([]);
    expect(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8')).toBe(HEAD + OLD);
  });
});

describe('this repo', () => {
  it('keeps unreleased entries in changelog.d/, not an Unreleased section of CHANGELOG.md', () => {
    const text = readFileSync(join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
    expect(
      /^## \[Unreleased\]/im.test(text),
      'CHANGELOG.md has an [Unreleased] section. Move its entries into a new file in changelog.d/ (see changelog.d/README.md).'
    ).toBe(false);
  });
});

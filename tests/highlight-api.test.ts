import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { highlightDgmo, renderAnsi } from '../src/editor/highlight-api';

// ============================================================
// Lossless round-trip — over all gallery fixtures
// ============================================================

const fixturesDir = resolve(__dirname, '../gallery/fixtures');
const fixtureFiles = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.dgmo'))
  .sort();

describe('highlightDgmo — lossless round-trip', () => {
  it.each(fixtureFiles)('%s', (filename) => {
    const source = readFileSync(join(fixturesDir, filename), 'utf-8');
    const tokens = highlightDgmo(source);
    const reconstructed = tokens.map((t) => t.text).join('');
    expect(reconstructed).toBe(source);
  });
});

// ============================================================
// Unit tests — specific token roles
// ============================================================

describe('highlightDgmo — token roles', () => {
  it('assigns comment role to // comments', () => {
    const tokens = highlightDgmo('// this is a comment');
    const commentTokens = tokens.filter((t) => t.role === 'comment');
    expect(commentTokens.length).toBeGreaterThan(0);
    expect(commentTokens.map((t) => t.text).join('')).toContain(
      '// this is a comment'
    );
  });

  it('assigns chartType to first-line chart type', () => {
    const tokens = highlightDgmo('sequence\nA -> B');
    const chartTypeTokens = tokens.filter((t) => t.role === 'chartType');
    expect(chartTypeTokens.length).toBe(1);
    expect(chartTypeTokens[0].text).toBe('sequence');
  });

  it('assigns keyword to directive keywords', () => {
    const tokens = highlightDgmo('title: My Diagram');
    const keywordTokens = tokens.filter((t) => t.role === 'keyword');
    expect(keywordTokens.some((t) => t.text === 'title')).toBe(true);
  });

  it('assigns operator to arrows', () => {
    const tokens = highlightDgmo('A -> B');
    const opTokens = tokens.filter((t) => t.role === 'operator');
    expect(opTokens.some((t) => t.text === '->')).toBe(true);
  });

  it('assigns default to identifiers', () => {
    const tokens = highlightDgmo('A -> B');
    const aToken = tokens.find((t) => t.text === 'A');
    expect(aToken?.role).toBe('default');
  });

  it('assigns heading to section markers', () => {
    const tokens = highlightDgmo('== My Section ==');
    const headingTokens = tokens.filter((t) => t.role === 'heading');
    expect(headingTokens.length).toBeGreaterThan(0);
  });

  it('assigns number to numeric tokens', () => {
    const tokens = highlightDgmo('bar\nApples: 42');
    const numTokens = tokens.filter((t) => t.role === 'number');
    expect(numTokens.some((t) => t.text === '42')).toBe(true);
  });

  it('assigns bracket to [ and ]', () => {
    const tokens = highlightDgmo('[Group]');
    const bracketTokens = tokens.filter((t) => t.role === 'bracket');
    expect(bracketTokens.some((t) => t.text === '[')).toBe(true);
    expect(bracketTokens.some((t) => t.text === ']')).toBe(true);
  });

  it('assigns separator to pipe', () => {
    const tokens = highlightDgmo('A -msg-> B | key: val');
    const sepTokens = tokens.filter((t) => t.role === 'separator');
    expect(sepTokens.some((t) => t.text === '|')).toBe(true);
  });
});

// ============================================================
// Label override — keywords in labels become default
// ============================================================

describe('highlightDgmo — label override', () => {
  it('overrides keywords in message labels to default', () => {
    const tokens = highlightDgmo('sequence\nUser -loop request-> API');
    // "loop" is a ControlKeyword, but inside the label zone it should be default
    const loopToken = tokens.find((t) => t.text === 'loop');
    // In label position, loop should be overridden to default
    // (between first dash and last arrow)
    expect(loopToken?.role).toBe('default');
  });

  it('keeps keywords outside labels with their original role', () => {
    const tokens = highlightDgmo('sequence\nloop 3 times');
    const loopToken = tokens.find((t) => t.text === 'loop');
    expect(loopToken?.role).toBe('controlKeyword');
  });
});

// ============================================================
// Note content detection
// ============================================================

describe('highlightDgmo — note content', () => {
  it('marks indented lines after note as noteContent', () => {
    const tokens = highlightDgmo('sequence\nnote on API\n  This is note body');
    const noteTokens = tokens.filter((t) => t.role === 'noteContent');
    expect(noteTokens.length).toBeGreaterThan(0);
    expect(noteTokens.some((t) => t.text.includes('This'))).toBe(true);
  });

  it('does not mark non-indented lines as noteContent', () => {
    const tokens = highlightDgmo('sequence\nnote on API\n  Note body\nA -> B');
    const aToken = tokens.find((t) => t.text === 'A');
    expect(aToken?.role).not.toBe('noteContent');
  });
});

// ============================================================
// Snapshot tests — representative fixtures
// ============================================================

describe('highlightDgmo — snapshots', () => {
  const snapshotFixtures = [
    'sequence-basic.dgmo',
    'er-basic.dgmo',
    'infra-basic.dgmo',
    'gantt-basic.dgmo',
    'bar.dgmo',
    'flowchart-basic.dgmo',
  ];

  for (const filename of snapshotFixtures) {
    const filepath = join(fixturesDir, filename);
    // Only test if fixture exists
    let source: string;
    try {
      source = readFileSync(filepath, 'utf-8');
    } catch {
      continue;
    }

    it(`snapshot: ${filename}`, () => {
      const tokens = highlightDgmo(source);
      // Snapshot the role assignments (not text, to keep snapshots readable)
      const roleMap = tokens.map((t) => ({
        text: t.text.length > 40 ? t.text.slice(0, 40) + '...' : t.text,
        role: t.role,
      }));
      expect(roleMap).toMatchSnapshot();
    });
  }
});

// ============================================================
// renderAnsi tests
// ============================================================

describe('renderAnsi', () => {
  it('produces plain text when useColor is false', () => {
    const tokens = highlightDgmo('sequence\nA -> B');
    const plain = renderAnsi(tokens, false);
    expect(plain).toBe('sequence\nA -> B');
    expect(plain).not.toContain('\x1b');
  });

  it('includes ANSI codes when useColor is true', () => {
    const tokens = highlightDgmo('sequence\nA -> B');
    const colored = renderAnsi(tokens, true);
    expect(colored).toContain('\x1b[');
  });

  it('ends with ANSI reset code', () => {
    const tokens = highlightDgmo('sequence\nA -> B');
    const colored = renderAnsi(tokens, true);
    expect(colored.endsWith('\x1b[0m')).toBe(true);
  });

  it('applies bold yellow to chart type', () => {
    const tokens = highlightDgmo('sequence');
    const colored = renderAnsi(tokens, true);
    // chartType → \x1b[1;33m (bold yellow)
    expect(colored).toContain('\x1b[1;33m');
  });

  it('applies bold red to operators', () => {
    const tokens = highlightDgmo('A -> B');
    const colored = renderAnsi(tokens, true);
    // operator → \x1b[1;31m (bold red)
    expect(colored).toContain('\x1b[1;31m');
  });
});

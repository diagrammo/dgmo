// The `palette` line (#1037, design #1035): a diagram names its own palette.
// It is a reserved keyword on every chart type, lifted out of the source before
// any parser sees it — on main before this change a gantt refused the line as a
// task and org/mindmap drew "palette nord dark" as a node.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { CHART_TYPE_REGISTRY } from '../src/chart-type-registry';
import { render as renderInternal } from '../src/render';
import { render, validate } from '../src/index';
import { loadMapData } from '../src/map/load-data';
import {
  choosePalette,
  extractPaletteDirective,
} from '../src/palettes/directive';
import { setPinnedNow } from '../src/utils/now';
import { getPalette } from '../src/palettes';

// `__dirname`, not `import.meta.url`: the suite runs under jsdom.
const FIXTURE_DIR = join(__dirname, 'fixtures/conformance');
const read = (id: string) =>
  readFileSync(join(FIXTURE_DIR, `${id}.dgmo`), 'utf8');

const HOST: Record<string, { mapData?: typeof loadMapData }> = {
  map: { mapData: loadMapData },
};

// clock and countdown draw the current instant; two renders must see one.
beforeAll(() => setPinnedNow(Date.UTC(2026, 9, 7, 12)));
afterAll(() => setPinnedNow(null));

// Some ids come from module-level counters (`tl-band-clip-0`, a map's
// `__m1` instance suffix), so a second render of the same diagram numbers
// them on from the first. The number is not the drawing.
const sameIds = (svg: string) =>
  svg.replace(/__m\d+/g, '__mN').replace(/clip-\d+/g, 'clip-N');

const paletteDiagnostics = (ds: { line: number; code?: string }[]) =>
  ds
    .filter((d) => d.code?.startsWith('W_PALETTE'))
    .map((d) => [d.line, d.code]);

const paletteCodes = (ds: { code?: string }[]) =>
  ds.filter((d) => d.code?.startsWith('W_PALETTE')).map((d) => d.code);

describe.each(CHART_TYPE_REGISTRY.map((d) => d.id))(
  'palette line — %s',
  (id) => {
    it('`palette nord dark` at the bottom draws exactly what the caller asking for Nord dark gets', async () => {
      const source = read(id);
      const withLine = await renderInternal(
        `${source.trimEnd()}\n\npalette nord dark\n`,
        { ...HOST[id] }
      );
      const asked = await renderInternal(`${source.trimEnd()}\n\n\n`, {
        ...HOST[id],
        palette: 'nord',
        theme: 'dark',
      });
      expect(sameIds(withLine.svg)).toBe(sameIds(asked.svg));
      expect(withLine.svg).toMatch(/^\s*<svg/);
      expect(paletteCodes(withLine.diagnostics)).toEqual([]);
      expect(withLine.diagnostics).toEqual(asked.diagnostics);
    });
  }
);

describe('palette line — who wins', () => {
  const source = 'pie Share\nApples 30\nPears 70\n\npalette nord dark';
  const plain = 'pie Share\nApples 30\nPears 70\n\n';

  it('the file beats the caller default', async () => {
    const got = await render(source, { palette: 'catppuccin' });
    const nordDark = await render(plain, { palette: 'nord', theme: 'dark' });
    expect(got.svg).toBe(nordDark.svg);
  });

  it('paletteOverride beats the file, and the mode word goes with the file', async () => {
    const got = await render(source, {
      palette: 'catppuccin',
      paletteOverride: 'tidewater',
    });
    const tidewater = await render(plain, { palette: 'tidewater' });
    expect(got.svg).toBe(tidewater.svg);
  });

  it('with no mode word the caller keeps its own light or dark', async () => {
    const got = await render('pie Share\nApples 30\nPears 70\n\npalette nord', {
      theme: 'dark',
    });
    const nordDark = await render(plain, { palette: 'nord', theme: 'dark' });
    expect(got.svg).toBe(nordDark.svg);
  });

  it('with no palette line nothing changes', async () => {
    const got = await render(plain, { palette: 'catppuccin' });
    const before = await renderInternal(plain, { palette: 'catppuccin' });
    expect(got.svg).toBe(before.svg);
  });
});

describe('palette line — the mode word and the caller theme', () => {
  const plain = 'pie Share\nApples 30\nPears 70\n\n';

  it("a light pin keeps a caller's transparent background", async () => {
    const got = await render(`${plain}palette nord light`, {
      theme: 'transparent',
    });
    const asked = await render(plain, {
      palette: 'nord',
      theme: 'transparent',
    });
    expect(got.svg).toBe(asked.svg);
  });

  it('a dark pin draws dark, which has no transparent form', async () => {
    const got = await render(`${plain}palette nord dark`, {
      theme: 'transparent',
    });
    const asked = await render(plain, { palette: 'nord', theme: 'dark' });
    expect(got.svg).toBe(asked.svg);
  });

  it('the error card is drawn in the palette the diagram would have had', async () => {
    const broken = 'gantt Launch\nstart 2026-01-01\n\n???\n\npalette nord dark';
    const got = await render(broken);
    const slate = await render(broken.replace('palette nord dark', ''));
    // The card quotes the source, so the two cards differ in text; the
    // ground is what says which palette drew them.
    const nordDarkBg = getPalette('nord').dark.bg;
    expect(got.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(got.svg).toContain(nordDarkBg);
    expect(slate.svg).not.toContain(nordDarkBg);
  });
});

describe('palette line — an explicit choice beats the file', () => {
  const file = extractPaletteDirective('pie\nA 1\npalette nord dark');

  it("an override (an explicit CLI --palette) wins, and the file's mode word goes with the file", () => {
    expect(
      choosePalette(file, { paletteOverride: 'slate', theme: 'light' })
    ).toEqual({ paletteId: 'slate', theme: 'light' });
  });

  it('with no override the file beats the caller default', () => {
    expect(choosePalette(file, { palette: 'slate', theme: 'light' })).toEqual({
      paletteId: 'nord',
      theme: 'dark',
    });
  });

  it('with no palette line the caller default stands, then Slate', () => {
    const none = extractPaletteDirective('pie\nA 1');
    expect(choosePalette(none, { palette: 'catppuccin' })).toEqual({
      paletteId: 'catppuccin',
      theme: 'light',
    });
    expect(choosePalette(none, {})).toEqual({
      paletteId: 'slate',
      theme: 'light',
    });
  });
});

describe('palette line — what is not drawn warns on its own line', () => {
  it('an unknown name warns and draws the caller palette', async () => {
    const got = await render(
      'pie Share\nApples 30\nPears 70\n\npalette dracula',
      {
        palette: 'nord',
      }
    );
    const nord = await render('pie Share\nApples 30\nPears 70\n\n', {
      palette: 'nord',
    });
    expect(got.svg).toBe(nord.svg);
    const warning = got.diagnostics.find((d) => d.code === 'W_PALETTE_UNKNOWN');
    expect(warning?.line).toBe(5);
    expect(warning?.severity).toBe('warning');
  });

  it('an embedded block is lifted whole, so none of it reaches the parser', async () => {
    const block = [
      'org Team',
      'CEO',
      '  CTO',
      '',
      'palette Dracula',
      '  dark',
      '    bg #282a36',
      '',
      '    colors',
      '      red #ff5555',
    ].join('\n');
    const got = await render(block, { palette: 'nord' });
    const plain = await render('org Team\nCEO\n  CTO\n', { palette: 'nord' });
    expect(got.svg).toBe(plain.svg);
    expect(got.svg).not.toContain('Dracula');
    expect(got.svg).not.toContain('282a36');
    expect(
      got.diagnostics.filter((d) => d.code === 'W_PALETTE_UNKNOWN')
    ).toHaveLength(1);
    expect(
      got.diagnostics.find((d) => d.code === 'W_PALETTE_UNKNOWN')?.line
    ).toBe(5);
  });

  it('a bad mode word warns on its line and keeps the palette', async () => {
    const got = await render('pie Share\nApples 30\npalette nord dim');
    const nord = await render('pie Share\nApples 30\n', { palette: 'nord' });
    expect(got.svg).toBe(nord.svg);
    expect(paletteDiagnostics(got.diagnostics)).toEqual([
      [3, 'W_PALETTE_MODE_UNKNOWN'],
    ]);
  });
});

describe('palette line — lifting keeps every line number', () => {
  it('a later diagnostic still names the line the author wrote', () => {
    const withLine = validate(
      'gantt Launch\npalette nord\nstart 2026-01-01\nDesign 5d\n???'
    );
    const without = validate(
      'gantt Launch\n\nstart 2026-01-01\nDesign 5d\n???'
    );
    expect(without.diagnostics.length).toBeGreaterThan(0);
    expect(withLine.diagnostics).toEqual(without.diagnostics);
  });

  it('validate() reports nothing for a palette line on gantt, org, mindmap and flowchart', () => {
    const cases = [
      'gantt Launch\nstart 2026-01-01\n\nDesign 5d\nBuild 10d\n\npalette nord dark',
      'org Team\nCEO\n  CTO\n  CFO\n\npalette nord dark',
      'mindmap\nRoot\n  A\n  B\n\npalette nord dark',
      'flowchart Demo\n(Start) -> [Step] -> (End)\n\npalette nord dark',
    ];
    for (const source of cases) {
      expect(validate(source).diagnostics, source).toEqual([]);
    }
  });

  it('a palette inside a comment is only a comment', async () => {
    const got = await render('pie Share\nApples 30\n// palette nord dark');
    const plain = await render('pie Share\nApples 30\n// a comment');
    expect(got.svg).toBe(plain.svg);
  });
});

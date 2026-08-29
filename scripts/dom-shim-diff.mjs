#!/usr/bin/env node
/**
 * Render every gallery fixture under a chosen stand-in browser and write the
 * SVGs out, so two runs can be compared byte for byte.
 *
 * This is the acceptance test for issue #123 (replace jsdom with linkedom), and
 * it exists because **the test suite cannot answer this question**. `vitest.config.ts`
 * sets `environment: 'jsdom'`, so every test already runs inside a browser
 * stand-in that the library did not choose. The suite would stay green whichever
 * one ships. Only rendering real diagrams both ways can tell you anything.
 *
 * The swap needs no source change to measure, which is the point of doing it
 * this way first. `acquireDom()` in src/render.ts steps aside entirely when a
 * real `document` already exists — that is how the desktop app and the browser
 * avoid loading jsdom — so installing linkedom's globals before calling
 * `render()` makes the library use them without knowing anything happened.
 * If the comparison comes out clean, the production change is small and
 * informed; if it does not, nothing was touched.
 *
 *   node scripts/dom-shim-diff.mjs --shim jsdom    --out /tmp/base
 *   node scripts/dom-shim-diff.mjs --shim linkedom --out /tmp/cand
 *   node scripts/dom-shim-diff.mjs --compare /tmp/base /tmp/cand
 *
 * Maps are rendered with basemaps injected, the same way the CLI does it.
 * Without that they return an empty SVG and 18 fixtures compare equal by being
 * equally blank — which is exactly how a dead chart type hid twice this week.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'gallery/fixtures');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

// --------------------------------------------------------- compare pixels
//
// The byte comparison below is the strict bar, and linkedom does not meet it:
// it serialises attributes in the reverse order, self-closes empty elements,
// and leaves CSS as authored where jsdom expands it (`#eceff4` stays hex
// instead of becoming `rgb(236, 239, 244)`). None of that is a drawing
// difference — but "looks cosmetic" is not evidence. This rasterises both sets
// through the same renderer users get and compares the actual pixels, which is
// the only comparison that answers the question the issue asks.
if (argv[0] === '--compare-pixels') {
  const [a, b] = [argv[1], argv[2]].map((d) => resolve(d));
  const { Resvg } = await import('@resvg/resvg-js');
  const fontFiles = [
    join(ROOT, 'fonts/Inter-Regular.ttf'),
    join(ROOT, 'fonts/Inter-Bold.ttf'),
  ].filter((f) => existsSync(f));
  const png = (svg) =>
    new Resvg(svg, {
      font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Inter' },
    })
      .render()
      .asPng();
  let same = 0;
  const differ = [];
  const errs = [];
  for (const n of readdirSync(a).sort()) {
    try {
      const x = png(readFileSync(join(a, n), 'utf8'));
      const y = png(readFileSync(join(b, n), 'utf8'));
      if (x.equals(y)) same++;
      else differ.push(`${n} (${x.length} vs ${y.length} bytes of PNG)`);
    } catch (err) {
      errs.push(`${n}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`pixel-identical : ${same}`);
  console.log(`pixel-different : ${differ.length}`);
  if (errs.length) console.log(`raster errors   : ${errs.length}`);
  for (const d of differ) console.log(`  ≠ ${d}`);
  for (const e of errs) console.log(`  ✖ ${e}`);
  process.exit(differ.length || errs.length ? 1 : 0);
}

// ---------------------------------------------------------------- compare
if (argv[0] === '--compare') {
  const [a, b] = [argv[1], argv[2]].map((d) => resolve(d));
  const names = new Set([...readdirSync(a), ...readdirSync(b)]);
  const same = [];
  const differ = [];
  const onlyIn = [];
  for (const n of [...names].sort()) {
    const pa = join(a, n);
    const pb = join(b, n);
    if (!existsSync(pa) || !existsSync(pb)) {
      onlyIn.push(
        `${n} (only in ${existsSync(pa) ? 'baseline' : 'candidate'})`
      );
      continue;
    }
    const [x, y] = [readFileSync(pa), readFileSync(pb)];
    if (x.equals(y)) same.push(n);
    else differ.push(`${n}  ${x.length} B vs ${y.length} B`);
  }
  console.log(`identical : ${same.length}`);
  console.log(`different : ${differ.length}`);
  if (onlyIn.length) console.log(`missing   : ${onlyIn.length}`);
  for (const d of differ) console.log(`  ≠ ${d}`);
  for (const d of onlyIn) console.log(`  ! ${d}`);
  process.exit(differ.length || onlyIn.length ? 1 : 0);
}

// ---------------------------------------------------------------- render
const shim = flag('--shim') ?? 'jsdom';
const outDir = resolve(flag('--out') ?? join(ROOT, `.shim-${shim}`));

// Freeze the clock. `clock` draws the current time, so two runs taken minutes
// apart differ for reasons that have nothing to do with the DOM — which is
// exactly what happened on the first measurement and put `clock` on the
// differences list under false pretences. Anything comparing two renders has to
// pin this or it is measuring the wall clock.
const FIXED_NOW = Date.parse('2026-01-01T12:00:00Z');
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FIXED_NOW);
    else super(...args);
  }
  static now() {
    return FIXED_NOW;
  }
};

if (shim === 'linkedom') {
  // Install the globals BEFORE importing the library, so acquireDom() sees a
  // document and never reaches for jsdom. These five names are exactly what
  // installDom() in src/render.ts defines — keep the two in step.
  //
  // 🔴 An HTML document, deliberately, and do not "fix" this to
  // `parseFromString(…, 'image/svg+xml')`. That was tried on 2026-08-07: an
  // SVG document has no `document.body`, every renderer appends to it, and all
  // 92 fixtures fail with `Cannot read properties of undefined`. It looks like
  // the tidier choice and it renders nothing at all.
  //
  // The two defects an HTML document used to cause are both fixed in the
  // library now rather than worked around here — a bare `&` in an attribute
  // value (`escapeAttributeMarkupChars`) and `<linearGradient>` lowercased by
  // `innerHTML` (`src/body/renderer.ts` builds its gradients with DOM calls).
  const { parseHTML } = await import('linkedom');
  const win = parseHTML('<!DOCTYPE html><html><body></body></html>');
  const values = {
    document: win.document,
    window: win.window ?? win,
    navigator: win.navigator ?? { userAgent: 'linkedom' },
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      console.error(
        `✖ linkedom does not provide \`${key}\` — the swap cannot work as-is`
      );
      process.exit(1);
    }
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
}

const { render } = await import(
  pathToFileURL(join(ROOT, 'dist/index.js')).href
);
const { loadMapData } = await import(
  pathToFileURL(join(ROOT, 'dist/advanced.js')).href
);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const files = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.dgmo'))
  .sort();

let ok = 0;
const failed = [];
for (const f of files) {
  const source = readFileSync(join(FIXTURES, f), 'utf8');
  try {
    const { svg } = await render(source, {
      theme: 'light',
      palette: 'nord',
      mapData: loadMapData,
    });
    if (!svg) {
      failed.push(`${f} (empty svg)`);
      continue;
    }
    writeFileSync(join(outDir, `${basename(f, '.dgmo')}.svg`), svg);
    ok++;
  } catch (err) {
    failed.push(`${f} (${err instanceof Error ? err.message : String(err)})`);
  }
}

console.log(`${shim}: ${ok}/${files.length} fixtures rendered → ${outDir}`);
if (failed.length) {
  console.log(`${failed.length} failed:`);
  for (const f of failed) console.log(`  ✖ ${f}`);
}
process.exit(failed.length ? 1 : 0);

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { JSDOM } from 'jsdom';
import { Resvg } from '@resvg/resvg-js';
import { renderD3ForExport } from './d3';
import { renderEChartsForExport } from './echarts';
import { parseDgmoChartType, getDgmoFramework } from './dgmo-router';
import { getPalette } from './palettes/registry';
import { DEFAULT_FONT_NAME } from './fonts';

const PALETTES = [
  'nord',
  'solarized',
  'catppuccin',
  'rose-pine',
  'gruvbox',
  'tokyo-night',
  'one-dark',
  'bold',
];

const THEMES = ['light', 'dark', 'transparent'] as const;

function printHelp(): void {
  console.log(`Usage: dgmo <input> [options]
       cat input.dgmo | dgmo [options]

Render a .dgmo file to PNG (default) or SVG.

Options:
  -o <file>         Output file (default: <input>.png in cwd)
                    Format inferred from extension: .svg → SVG, else PNG
                    With stdin and no -o, PNG is written to stdout
  --theme <theme>   Theme: ${THEMES.join(', ')} (default: light)
  --palette <name>  Palette: ${PALETTES.join(', ')} (default: nord)
  --help            Show this help
  --version         Show version`);
}

function printVersion(): void {
  const pkg = JSON.parse(
    readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8')
  );
  console.log(pkg.version);
}

function parseArgs(argv: string[]): {
  input: string | undefined;
  output: string | undefined;
  theme: (typeof THEMES)[number];
  palette: string;
  help: boolean;
  version: boolean;
} {
  const result = {
    input: undefined as string | undefined,
    output: undefined as string | undefined,
    theme: 'light' as (typeof THEMES)[number],
    palette: 'nord',
    help: false,
    version: false,
  };

  const args = argv.slice(2); // skip node + script
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      result.help = true;
      i++;
    } else if (arg === '--version' || arg === '-v') {
      result.version = true;
      i++;
    } else if (arg === '-o') {
      result.output = args[++i];
      i++;
    } else if (arg === '--theme') {
      const val = args[++i];
      if (!THEMES.includes(val as (typeof THEMES)[number])) {
        console.error(
          `Error: Invalid theme "${val}". Valid themes: ${THEMES.join(', ')}`
        );
        process.exit(1);
      }
      result.theme = val as (typeof THEMES)[number];
      i++;
    } else if (arg === '--palette') {
      const val = args[++i];
      if (!PALETTES.includes(val)) {
        console.error(
          `Error: Unknown palette "${val}". Valid palettes: ${PALETTES.join(', ')}`
        );
        process.exit(1);
      }
      result.palette = val;
      i++;
    } else if (!result.input) {
      result.input = arg;
      i++;
    } else {
      console.error(`Error: Unexpected argument "${arg}"`);
      process.exit(1);
    }
  }

  return result;
}

function setupDom(): void {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;

  // Expose DOM globals needed by d3-selection and renderers
  Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
  Object.defineProperty(globalThis, 'HTMLElement', { value: win.HTMLElement, configurable: true });
  Object.defineProperty(globalThis, 'SVGElement', { value: win.SVGElement, configurable: true });
}

function inferFormat(outputPath: string | undefined): 'svg' | 'png' {
  if (outputPath && extname(outputPath).toLowerCase() === '.svg') {
    return 'svg';
  }
  return 'png';
}

function svgToPng(svg: string, background?: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: 2 },
    ...(background ? { background } : {}),
    font: {
      loadSystemFonts: true,
      defaultFontFamily: DEFAULT_FONT_NAME,
      sansSerifFamily: DEFAULT_FONT_NAME,
    },
  });
  const rendered = resvg.render();
  return rendered.asPng();
}

function noInput(): never {
  const samplePath = resolve('sample.dgmo');
  if (existsSync(samplePath)) {
    console.error('Error: No input file specified');
    console.error(`Try: dgmo ${basename(samplePath)}`);
    process.exit(1);
  }
  writeFileSync(
    samplePath,
    [
      'chart: sequence',
      'activations: off',
      '',
      '  Client -> API: POST /login',
      '  API -> Auth: validate credentials',
      '  Auth -> DB: SELECT user',
      '  DB -> Auth: user record',
      '  Auth -> API: JWT token',
      '  API -> Client: 200 OK { token }',
      '',
    ].join('\n'),
    'utf-8'
  );
  console.error(`Created ${samplePath}`);
  console.error('');
  console.error('  Render it:  dgmo sample.dgmo');
  console.error('  As SVG:     dgmo sample.dgmo -o sample.svg');
  console.error('');
  console.error(
    'Edit sample.dgmo to make it your own, or run dgmo --help for all options.'
  );
  process.exit(0);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    printHelp();
    return;
  }

  if (opts.version) {
    printVersion();
    return;
  }

  // Determine input source
  let content: string;
  let inputBasename: string | undefined;
  const stdinIsPiped = !process.stdin.isTTY;

  if (opts.input) {
    // File argument provided
    const inputPath = resolve(opts.input);
    try {
      content = readFileSync(inputPath, 'utf-8');
    } catch {
      console.error(`Error: Cannot read file "${inputPath}"`);
      process.exit(1);
    }
    // Strip extension for default output name
    const name = basename(opts.input);
    const ext = extname(name);
    inputBasename = ext ? name.slice(0, -ext.length) : name;
  } else if (stdinIsPiped) {
    // Read from stdin
    try {
      content = readFileSync(0, 'utf-8');
    } catch {
      noInput();
    }
  } else {
    noInput();
  }

  const isDark = opts.theme === 'dark';
  const paletteColors = isDark
    ? getPalette(opts.palette).dark
    : getPalette(opts.palette).light;

  // Determine which rendering framework to use
  const chartType = parseDgmoChartType(content);
  const framework = chartType ? getDgmoFramework(chartType) : null;

  let svg: string;

  if (framework === 'echart') {
    svg = await renderEChartsForExport(content, opts.theme, paletteColors);
  } else if (framework === 'd3' || framework === null) {
    // Set up jsdom before any d3/renderer code runs
    setupDom();
    svg = await renderD3ForExport(content, opts.theme, paletteColors);
  } else {
    console.error(`Error: Unknown chart framework "${framework}".`);
    process.exit(1);
  }

  if (!svg) {
    console.error(
      'Error: Failed to render diagram. The input may be empty, invalid, or use an unsupported chart type.'
    );
    process.exit(1);
  }

  // Determine output format and destination
  const format = inferFormat(opts.output);
  const pngBg = opts.theme === 'transparent' ? undefined : paletteColors.bg;

  if (opts.output) {
    // Explicit output path
    const outputPath = resolve(opts.output);
    if (format === 'svg') {
      writeFileSync(outputPath, svg, 'utf-8');
    } else {
      writeFileSync(outputPath, svgToPng(svg, pngBg));
    }
    console.error(`Wrote ${outputPath}`);
  } else if (inputBasename) {
    // File input, no -o → write <basename>.png in cwd
    const outputPath = resolve(`${inputBasename}.png`);
    writeFileSync(outputPath, svgToPng(svg, pngBg));
    console.error(`Wrote ${outputPath}`);
  } else {
    // Stdin input, no -o → write PNG to stdout
    process.stdout.write(svgToPng(svg, pngBg));
  }
}

main().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});

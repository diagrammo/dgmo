import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { renderD3ForExport } from './d3';
import { getPalette } from './palettes/registry';

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
  console.log(`Usage: dgmo render <input> [options]

Commands:
  render <input>    Render a .dgmo file to SVG

Options:
  -o <file>         Write SVG to file (default: stdout)
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
  command: string | undefined;
  input: string | undefined;
  output: string | undefined;
  theme: (typeof THEMES)[number];
  palette: string;
  help: boolean;
  version: boolean;
} {
  const result = {
    command: undefined as string | undefined,
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
    } else if (!result.command) {
      result.command = arg;
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

  if (opts.command !== 'render') {
    if (opts.command) {
      console.error(`Error: Unknown command "${opts.command}"`);
    } else {
      console.error('Error: No command specified');
    }
    console.error('Run "dgmo --help" for usage');
    process.exit(1);
  }

  if (!opts.input) {
    console.error('Error: No input file specified');
    console.error('Usage: dgmo render <input> [-o output.svg]');
    process.exit(1);
  }

  const inputPath = resolve(opts.input);
  let content: string;
  try {
    content = readFileSync(inputPath, 'utf-8');
  } catch {
    console.error(`Error: Cannot read file "${inputPath}"`);
    process.exit(1);
  }

  // Set up jsdom before any d3/renderer code runs
  setupDom();

  const isDark = opts.theme === 'dark';
  const paletteColors = isDark
    ? getPalette(opts.palette).dark
    : getPalette(opts.palette).light;

  const svg = await renderD3ForExport(content, opts.theme, paletteColors);

  if (!svg) {
    console.error(
      'Error: Failed to render diagram. The input may be empty, invalid, or use an unsupported chart type (e.g. Chart.js/ECharts charts require a browser).'
    );
    process.exit(1);
  }

  if (opts.output) {
    const outputPath = resolve(opts.output);
    writeFileSync(outputPath, svg, 'utf-8');
    console.error(`Wrote ${outputPath}`);
  } else {
    process.stdout.write(svg);
  }
}

main().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});

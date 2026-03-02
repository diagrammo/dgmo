import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, basename, extname } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { render } from './render';
import { parseDgmo, DGMO_CHART_TYPE_MAP } from './dgmo-router';
import { parseDgmoChartType } from './dgmo-router';
import { formatDgmoError } from './diagnostics';
import { getPalette } from './palettes/registry';
import { DEFAULT_FONT_NAME } from './fonts';
import { encodeDiagramUrl } from './sharing';
import { resolveOrgImports } from './org/resolver';

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

const CHART_TYPE_DESCRIPTIONS: Record<string, string> = {
  bar: 'Bar chart — categorical comparisons',
  line: 'Line chart — trends over time',
  'multi-line': 'Multi-line chart — multiple series trends',
  area: 'Area chart — filled line chart',
  pie: 'Pie chart — part-to-whole proportions',
  doughnut: 'Doughnut chart — ring-style pie chart',
  radar: 'Radar chart — multi-dimensional metrics',
  'polar-area': 'Polar area chart — radial bar chart',
  'bar-stacked': 'Stacked bar chart — multi-series categorical',
  scatter: 'Scatter plot — 2D data points or bubble chart',
  sankey: 'Sankey diagram — flow/allocation visualization',
  chord: 'Chord diagram — circular flow relationships',
  function: 'Function plot — mathematical expressions',
  heatmap: 'Heatmap — matrix intensity visualization',
  funnel: 'Funnel chart — conversion pipeline',
  slope: 'Slope chart — change between two periods',
  wordcloud: 'Word cloud — term frequency visualization',
  arc: 'Arc diagram — network relationships',
  timeline: 'Timeline — events, eras, and date ranges',
  venn: 'Venn diagram — set overlaps',
  quadrant: 'Quadrant chart — 2x2 positioning matrix',
  sequence: 'Sequence diagram — message/interaction flows',
  flowchart: 'Flowchart — decision trees and process flows',
  class: 'Class diagram — UML class hierarchies',
  er: 'ER diagram — database schemas and relationships',
  org: 'Org chart — hierarchical tree structures',
  kanban: 'Kanban board — task/workflow columns',
  c4: 'C4 diagram — system architecture (context, container, component, deployment)',
  'initiative-status': 'Initiative status — project roadmap with dependency tracking',
};

function printHelp(): void {
  console.log(`Usage: dgmo <input> [options]
       cat input.dgmo | dgmo [options]

Render a .dgmo file to PNG (default) or SVG.

Options:
  -o <file>            Output file (default: <input>.png in cwd)
                       Format inferred from extension: .svg → SVG, else PNG
                       Use -o url to output a shareable diagrammo.app URL
                       With stdin and no -o, PNG is written to stdout
  --theme <theme>      Theme: ${THEMES.join(', ')} (default: light)
  --palette <name>     Palette: ${PALETTES.join(', ')} (default: nord)
  --c4-level <level>   C4 render level: context (default), containers, components, deployment
  --c4-system <name>   System to drill into (with --c4-level containers or components)
  --c4-container <name> Container to drill into (with --c4-level components)
  --no-branding        Omit diagrammo.app branding from exports
  --copy               Copy URL to clipboard (only with -o url)
  --json               Output structured JSON to stdout
  --chart-types        List all supported chart types
  --help               Show this help
  --version            Show version`);
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
  noBranding: boolean;
  copy: boolean;
  json: boolean;
  chartTypes: boolean;
  c4Level: 'context' | 'containers' | 'components' | 'deployment';
  c4System: string | undefined;
  c4Container: string | undefined;
} {
  const result = {
    input: undefined as string | undefined,
    output: undefined as string | undefined,
    theme: 'light' as (typeof THEMES)[number],
    palette: 'nord',
    help: false,
    version: false,
    noBranding: false,
    copy: false,
    json: false,
    chartTypes: false,
    c4Level: 'context' as 'context' | 'containers' | 'components' | 'deployment',
    c4System: undefined as string | undefined,
    c4Container: undefined as string | undefined,
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
    } else if (arg === '--c4-level') {
      const val = args[++i];
      if (val !== 'context' && val !== 'containers' && val !== 'components' && val !== 'deployment') {
        console.error(
          `Error: Invalid C4 level "${val}". Valid levels: context, containers, components, deployment`
        );
        process.exit(1);
      }
      result.c4Level = val;
      i++;
    } else if (arg === '--c4-system') {
      result.c4System = args[++i];
      i++;
    } else if (arg === '--c4-container') {
      result.c4Container = args[++i];
      i++;
    } else if (arg === '--no-branding') {
      result.noBranding = true;
      i++;
    } else if (arg === '--json') {
      result.json = true;
      i++;
    } else if (arg === '--chart-types') {
      result.chartTypes = true;
      i++;
    } else if (arg === '--copy') {
      result.copy = true;
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

function inferFormat(outputPath: string | undefined): 'svg' | 'png' | 'url' {
  if (outputPath === 'url') {
    return 'url';
  }
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
      'Client -POST /login-> API',
      '  API -validate credentials-> Auth',
      '    Auth -SELECT user-> DB',
      '    Auth <-user record- DB',
      '  API <-JWT token- Auth',
      'Client <-200 OK- API',
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

  if (opts.chartTypes) {
    const types = Object.keys(DGMO_CHART_TYPE_MAP);
    if (opts.json) {
      const chartTypes = types.map((id) => ({
        id,
        description: CHART_TYPE_DESCRIPTIONS[id] ?? id,
      }));
      process.stdout.write(JSON.stringify({ chartTypes }, null, 2) + '\n');
    } else {
      for (const id of types) {
        const desc = CHART_TYPE_DESCRIPTIONS[id];
        console.log(desc ? `${id} — ${desc.split(' — ')[1]}` : id);
      }
    }
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

  // Strip any ANSI escape codes that may have leaked into input
  // (e.g. from shell aliases like cat=bat with --color always)
  // eslint-disable-next-line no-control-regex
  content = content.replace(/\x1b\[[0-9;]*m/g, '');

  // Resolve org chart imports (tags: and import: directives)
  if (opts.input && parseDgmoChartType(content) === 'org') {
    const inputPath = resolve(opts.input);
    const resolved = await resolveOrgImports(
      content,
      inputPath,
      (p) => readFileSync(p, 'utf-8'),
    );
    for (const diag of resolved.diagnostics) {
      console.error(formatDgmoError(diag));
    }
    content = resolved.content;
  }

  // Determine output format early to handle URL before rendering
  const format = inferFormat(opts.output);

  // Validate --copy flag
  if (opts.copy && format !== 'url') {
    console.error('Error: --copy can only be used with -o url');
    process.exit(1);
  }

  const chartType = parseDgmoChartType(content);

  // Helper for JSON error output
  function exitWithJsonError(error: string, line?: number): never {
    if (opts.json) {
      process.stdout.write(JSON.stringify({
        success: false,
        error,
        ...(line != null ? { line } : {}),
        ...(chartType ? { chartType } : {}),
      }, null, 2) + '\n');
    } else {
      console.error(error);
    }
    process.exit(1);
  }

  // URL output — encode DSL directly, no rendering needed
  if (format === 'url') {
    const result = encodeDiagramUrl(content);
    if (result.error) {
      exitWithJsonError(
        `Error: Diagram too large for URL sharing (${result.compressedSize} bytes, limit ${result.limit} bytes)`
      );
    }

    if (opts.copy) {
      try {
        const platform = process.platform;
        if (platform === 'darwin') {
          execSync('pbcopy', { input: result.url });
        } else if (platform === 'win32') {
          execSync('clip', { input: result.url });
        } else {
          execSync('xclip -selection clipboard', { input: result.url });
        }
        console.error('URL copied to clipboard');
      } catch {
        console.error('Warning: Could not copy to clipboard');
      }
    }

    if (opts.json) {
      process.stdout.write(JSON.stringify({
        success: true,
        url: result.url,
        ...(chartType ? { chartType } : {}),
      }, null, 2) + '\n');
    } else {
      process.stdout.write(result.url + '\n');
    }
    return;
  }

  const paletteColors = getPalette(opts.palette)[opts.theme === 'dark' ? 'dark' : 'light'];

  // Word clouds require Canvas APIs (HTMLCanvasElement.getContext('2d'))
  // which are unavailable in Node.js — check before attempting render.
  const wordcloudRe = /^\s*chart\s*:\s*wordcloud\b/im;
  if (wordcloudRe.test(content)) {
    exitWithJsonError(
      'Error: Word clouds are not supported in the CLI (requires Canvas). Use the desktop app or browser instead.'
    );
  }

  // Parse first to collect diagnostics
  const { diagnostics } = parseDgmo(content);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');

  // Print warnings even if rendering succeeds
  if (!opts.json) {
    for (const w of warnings) {
      console.error(`\u26A0 ${formatDgmoError(w)}`);
    }
  }

  // Print errors and exit
  if (errors.length > 0) {
    if (opts.json) {
      const firstError = errors[0];
      exitWithJsonError(
        formatDgmoError(firstError),
        firstError.line,
      );
    }
    for (const e of errors) {
      console.error(`\u2716 ${formatDgmoError(e)}`);
    }
  }

  // Validate C4 options
  if (opts.c4Level === 'containers' && !opts.c4System) {
    exitWithJsonError('Error: --c4-system is required when --c4-level is containers');
  }
  if (opts.c4Level === 'components') {
    if (!opts.c4System) {
      exitWithJsonError('Error: --c4-system is required when --c4-level is components');
    }
    if (!opts.c4Container) {
      exitWithJsonError('Error: --c4-container is required when --c4-level is components');
    }
  }

  const svg = await render(content, {
    theme: opts.theme,
    palette: opts.palette,
    branding: !opts.noBranding,
    c4Level: opts.c4Level,
    c4System: opts.c4System,
    c4Container: opts.c4Container,
  });

  if (!svg) {
    if (errors.length === 0) {
      exitWithJsonError(
        'Error: Failed to render diagram. The input may be empty, invalid, or use an unsupported chart type.'
      );
    }
    process.exit(1);
  }

  // Determine output destination
  const pngBg = opts.theme === 'transparent' ? undefined : paletteColors.bg;

  if (opts.json) {
    // JSON mode: write file as normal but output JSON result to stdout
    let outputPath: string | undefined;
    if (opts.output) {
      outputPath = resolve(opts.output);
      if (format === 'svg') {
        writeFileSync(outputPath, svg, 'utf-8');
      } else {
        writeFileSync(outputPath, svgToPng(svg, pngBg));
      }
    } else if (inputBasename) {
      outputPath = resolve(`${inputBasename}.png`);
      writeFileSync(outputPath, svgToPng(svg, pngBg));
    }
    process.stdout.write(JSON.stringify({
      success: true,
      ...(outputPath ? { output: outputPath } : {}),
      ...(chartType ? { chartType } : {}),
    }, null, 2) + '\n');
  } else if (opts.output) {
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

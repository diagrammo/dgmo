/* eslint-disable no-console */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { resolve, join, basename, extname } from 'node:path';
import { createInterface } from 'node:readline';
import { Resvg } from '@resvg/resvg-js';
import { render } from './render';
import {
  parseDgmo,
  getAllChartTypes,
  CHART_TYPE_DESCRIPTIONS,
} from './dgmo-router';
import { parseDgmoChartType } from './dgmo-router';
import { formatDgmoError } from './diagnostics';
import { getPalette, getAvailablePalettes } from './palettes';
import { DEFAULT_FONT_NAME } from './fonts';
import { encodeDiagramUrl } from './sharing';
import { resolveOrgImports } from './org/resolver';
import { normalizePertSourceForShare } from './pert/share-normalize';
import {
  collectDgmoFiles,
  collectEmbeddedFiles,
  formatLineDiff,
  migrateFile,
} from './migrate';
import { migrateEmbedded } from './migrate/embedded';
import { renderBanner } from './cli-banner';
import { searchMapLocations } from './map/completion';
import { loadMapData } from './map/load-data';

// Derived from the palette registry so new palettes are auto-included.
const PALETTES = getAvailablePalettes().map((p) => p.id);

const THEMES = ['light', 'dark', 'transparent'] as const;

// The Claude Code skill (~/.claude/commands/dgmo.md) and the Codex skill
// (SKILL.md — gen-ai-core covered, with a gate-enforced COMPLETE chart-type
// index) are SHIPPED in this package via the "files" allowlist and are the
// single source of truth. The installers below read those files rather than
// carrying inline copies, so the chart-type list and syntax can never drift
// from the maintained originals (the stale inline table was the root cause of
// agents wrongly reporting that a chart type "does not exist").
const PKG_ROOT = resolve(__dirname, '..');

function readPackagedFile(...parts: string[]): string {
  const p = join(PKG_ROOT, ...parts);
  try {
    return readFileSync(p, 'utf-8');
  } catch {
    console.error(`Could not read packaged file: ${p}`);
    console.error(
      'Your @diagrammo/dgmo install may be incomplete — try reinstalling it.'
    );
    process.exit(1);
  }
}

// Claude Code skill source. Carries NO static chart-type table — it directs the
// agent to query list_chart_types (MCP) / dgmo --chart-types (CLI) for the
// authoritative, complete list.
const readClaudeSkill = (): string =>
  readPackagedFile('.claude', 'commands', 'dgmo.md');

// Codex skill source. Already includes the dgmo-diagramming frontmatter and the
// gen-ai-core 45-type index.
const readCodexSkill = (): string => readPackagedFile('SKILL.md');

const CODEX_AGENTS_NOTE_MARKER = '<!-- dgmo-integration -->';
const CODEX_AGENTS_NOTE = `${CODEX_AGENTS_NOTE_MARKER}
## Diagrams

For architecture diagrams, sequence diagrams, flowcharts, and charts, use the \`dgmo-diagramming\` skill and the configured \`dgmo\` MCP tools (\`open_in_app\`, \`share_diagram\`, \`render_diagram\`, etc.).
`;

function printHelp(): void {
  console.log(renderBanner());
  console.log(`Usage: dgmo <input> [options]
       cat input.dgmo | dgmo [options]
       dgmo cat <file>          Display file with syntax highlighting
       dgmo migrate <path>      Convert legacy "|" metadata to §1.4 grammar
       dgmo map search <query>  Find the map place token (city or IATA code)

Render a .dgmo file to PNG (default) or SVG.

Options:
  -o <file>            Output file (default: <input>.png in cwd)
                       Format inferred from extension: .svg → SVG, else PNG
                       Use -o url to output a shareable diagrammo.app URL
                       With stdin and no -o, PNG is written to stdout
  --theme <theme>      Theme: ${THEMES.join(', ')} (default: light)
  --palette <name>     Palette: ${PALETTES.join(', ')} (default: slate)
  --copy               Copy URL to clipboard (only with -o url)
  --json               Output structured JSON to stdout
  --chart-types        List all supported chart types
  --install-claude-code-integration
                       Full Claude Code setup: install the /dgmo skill and configure
                       the dgmo MCP server — installs @diagrammo/dgmo-mcp if needed,
                       then writes .mcp.json (project) or ~/.claude/settings.json (global)
  --install-claude-skill  Install only the /dgmo skill to ~/.claude/commands/dgmo.md
  --install-codex-integration
                       Full Codex CLI setup: install the dgmo-diagramming skill at
                       ~/.codex/skills/dgmo-diagramming/SKILL.md, configure the dgmo MCP
                       server in .codex/config.toml (project) or ~/.codex/config.toml (global),
                       and append a non-destructive note to AGENTS.md if one already exists.
  --install-claude-desktop-integration
                       Full Claude Desktop setup: install @diagrammo/dgmo-mcp if needed,
                       then merge the dgmo MCP entry into Claude Desktop's config file
                       (~/Library/Application Support/Claude/claude_desktop_config.json on macOS,
                       %APPDATA%/Claude/... on Windows, ~/.config/Claude/... on Linux)
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
  copy: boolean;
  json: boolean;
  chartTypes: boolean;
  cat: boolean;
  noColor: boolean;
  installClaudeSkill: boolean;
  installClaudeCodeIntegration: boolean;
  installCodexIntegration: boolean;
  installClaudeDesktopIntegration: boolean;
} {
  const result = {
    input: undefined as string | undefined,
    output: undefined as string | undefined,
    theme: 'light' as (typeof THEMES)[number],
    palette: 'slate',
    help: false,
    version: false,
    copy: false,
    json: false,
    chartTypes: false,
    cat: false,
    noColor: false,
    installClaudeSkill: false,
    installClaudeCodeIntegration: false,
    installCodexIntegration: false,
    installClaudeDesktopIntegration: false,
  };

  const args = argv.slice(2); // skip node + script
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === 'cat' && !result.cat && !result.input) {
      result.cat = true;
      i++;
    } else if (arg === '--no-color') {
      result.noColor = true;
      i++;
    } else if (arg === '--help' || arg === '-h') {
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
      if (val === undefined || !PALETTES.includes(val)) {
        console.error(
          `Error: Unknown palette "${val}". Valid palettes: ${PALETTES.join(', ')}`
        );
        process.exit(1);
      }
      result.palette = val;
      i++;
    } else if (arg === '--json') {
      result.json = true;
      i++;
    } else if (arg === '--chart-types') {
      result.chartTypes = true;
      i++;
    } else if (arg === '--install-claude-code-integration') {
      result.installClaudeCodeIntegration = true;
      i++;
    } else if (arg === '--install-claude-skill') {
      result.installClaudeSkill = true;
      i++;
    } else if (arg === '--install-codex-integration') {
      result.installCodexIntegration = true;
      i++;
    } else if (arg === '--install-claude-desktop-integration') {
      result.installClaudeDesktopIntegration = true;
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

const BUNDLED_FONTS = [
  join(__dirname, '..', 'fonts', 'Inter-Regular.ttf'),
  join(__dirname, '..', 'fonts', 'Inter-Bold.ttf'),
];

function svgToPng(svg: string, background?: string): Buffer {
  const fontFiles = BUNDLED_FONTS.filter((f) => existsSync(f));
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: 2 },
    ...(background ? { background } : {}),
    font: {
      loadSystemFonts: fontFiles.length === 0,
      ...(fontFiles.length > 0 ? { fontFiles } : {}),
      defaultFontFamily: DEFAULT_FONT_NAME,
      sansSerifFamily: DEFAULT_FONT_NAME,
    },
  });
  const rendered = resvg.render();
  return rendered.asPng();
}

function noInput(): never {
  console.error(renderBanner());
  const samplePath = resolve('sample.dgmo');
  if (existsSync(samplePath)) {
    console.error('Error: No input file specified');
    console.error(`Try: dgmo ${basename(samplePath)}`);
    console.error('Run dgmo --help for all options.');
    process.exit(1);
  }
  writeFileSync(
    samplePath,
    [
      'sequence',
      'no-activations',
      '',
      'Client -POST /login-> API',
      '  API -validate credentials-> Auth',
      '    Auth -SELECT user-> DB',
      '    DB -user record-> Auth',
      '  Auth -JWT token-> API',
      'API -200 OK-> Client',
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

interface MigrateCommandOpts {
  path: string | undefined;
  dryRun: boolean;
  apply: boolean;
  diff: boolean;
  noBackup: boolean;
  embedded: boolean;
  help: boolean;
}

function parseMigrateArgs(args: string[]): MigrateCommandOpts {
  const opts: MigrateCommandOpts = {
    path: undefined,
    dryRun: true,
    apply: false,
    diff: false,
    noBackup: false,
    embedded: false,
    help: false,
  };
  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      i++;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
      opts.apply = false;
      i++;
    } else if (arg === '--apply') {
      opts.apply = true;
      opts.dryRun = false;
      i++;
    } else if (arg === '--diff') {
      opts.diff = true;
      i++;
    } else if (arg === '--backup') {
      opts.noBackup = false;
      i++;
    } else if (arg === '--no-backup') {
      opts.noBackup = true;
      i++;
    } else if (arg === '--embedded') {
      opts.embedded = true;
      i++;
    } else if (!opts.path) {
      opts.path = arg;
      i++;
    } else {
      console.error(`Error: Unexpected argument "${arg}"`);
      process.exit(1);
    }
  }
  return opts;
}

function printMigrateHelp(): void {
  console.log(`Usage: dgmo migrate <path> [options]

Convert legacy "|" metadata syntax to the unified §1.4 same-line form
("Foo k: v, k: v" — no pipe). Handles bare-positional promotions:
  - gantt   "| 80%"        → "progress: 80"
  - journey "| 4 Delighted" → "score: 4, emotion: Delighted"
  - pyramid "| description" → "description: ..."
  - ring    "| description" → "description: ..."

Wireframe option braces "{A | B}", arrow-label "|" characters (§1.10),
and quoted-string content are preserved.

Options:
  --dry-run        Print proposed changes; do not write (default)
  --apply          Write migrated files to disk
  --diff           Print per-file unified-style diffs
  --backup         Write "<file>.bak" before applying (default with --apply)
  --no-backup      Skip writing .bak sidecars
  --embedded       Walk .md/.mdx files; migrate fenced \`\`\`dgmo blocks
                   atomically per file (single parse-error block aborts file)
  -h, --help       Show this help`);
}

async function runMigrateCommand(args: string[]): Promise<void> {
  const opts = parseMigrateArgs(args);

  if (opts.help) {
    printMigrateHelp();
    return;
  }

  if (!opts.path) {
    console.error('Error: dgmo migrate requires a path argument');
    console.error('Try: dgmo migrate --help');
    process.exit(1);
  }

  const resolvedPath = resolve(opts.path);
  if (!existsSync(resolvedPath)) {
    console.error(`Error: Path not found: ${resolvedPath}`);
    process.exit(1);
  }

  if (opts.embedded) {
    const files = collectEmbeddedFiles(resolvedPath);
    if (files.length === 0) {
      console.error('No .md / .mdx files found at the given path.');
      process.exit(1);
    }
    let migrated = 0;
    let skipped = 0;
    let unchanged = 0;
    for (const file of files) {
      const result = migrateEmbedded(file, {
        dryRun: opts.dryRun,
        noBackup: opts.noBackup,
      });
      if (result.skipped) {
        console.log(`SKIP  ${file}  — ${result.skipReason}`);
        skipped++;
        continue;
      }
      if (!result.changed) {
        unchanged++;
        continue;
      }
      migrated++;
      const verb = result.written ? 'MIGRATE' : 'DRY-RUN';
      console.log(
        `${verb}  ${file}  — ${result.changedBlocks}/${result.blockCount} blocks changed`
      );
      if (opts.diff) {
        console.log(formatLineDiff(file, result.original, result.migrated));
      }
    }
    console.log('');
    console.log(
      `Done. ${migrated} file(s) ${opts.dryRun ? 'would migrate' : 'migrated'}; ${unchanged} unchanged; ${skipped} skipped.`
    );
    return;
  }

  const files = collectDgmoFiles(resolvedPath);
  if (files.length === 0) {
    console.error('No .dgmo files found at the given path.');
    process.exit(1);
  }
  let migrated = 0;
  let unchanged = 0;
  for (const file of files) {
    const result = migrateFile(file, {
      dryRun: opts.dryRun,
      noBackup: opts.noBackup,
    });
    if (!result.changed) {
      unchanged++;
      continue;
    }
    migrated++;
    const verb = result.written ? 'MIGRATE' : 'DRY-RUN';
    console.log(
      `${verb}  ${file}  — ${result.changedLines.length} line(s) changed`
    );
    if (opts.diff) {
      console.log(formatLineDiff(file, result.original, result.migrated));
    }
  }
  console.log('');
  console.log(
    `Done. ${migrated} file(s) ${opts.dryRun ? 'would migrate' : 'migrated'}; ${unchanged} unchanged.`
  );
  if (opts.dryRun && migrated > 0) {
    console.log('Re-run with --apply to write changes.');
  }
}

// `dgmo map search <query>` — discover the exact place token the map resolver
// expects (city name or bundled IATA airport code), so authors never guess
// (e.g. "New York" → `New York City`; "kennedy" → `JFK`). Searches cities +
// the bundled airport set; `--json` for machine output, `--limit N` to widen.
async function runMapCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const json = args.includes('--json');
  const limFlag = args.indexOf('--limit');
  const limit =
    limFlag >= 0 ? Math.max(1, Number(args[limFlag + 1]) || 20) : 20;
  // The query is the positional args (allow unquoted multi-word: `... New York`).
  const query = args
    .slice(1)
    .filter(
      (a, i, arr) =>
        a !== '--json' && a !== '--limit' && arr[i - 1] !== '--limit'
    )
    .join(' ')
    .trim();

  if (sub !== 'search' || !query) {
    console.log('Usage: dgmo map search <query> [--json] [--limit N]');
    console.log(
      '  Find the place token the map resolver expects (city or IATA airport code).'
    );
    console.log('  Examples:');
    console.log(
      '    dgmo map search "new york"     # → New York City (+ JFK/LGA/EWR airports)'
    );
    console.log('    dgmo map search kennedy        # → JFK by airport name');
    console.log('    dgmo map search heathrow --json');
    if (sub === 'search' && !query) process.exitCode = 1;
    return;
  }

  const data = await loadMapData();
  const results = searchMapLocations(query, data.gazetteer, {
    limit,
    ...(data.airports && { airports: data.airports }),
  });

  if (json) {
    process.stdout.write(JSON.stringify({ query, results }, null, 2) + '\n');
    return;
  }
  if (!results.length) {
    console.log(
      `No cities or airports match "${query}". Use coordinates: poi Name as <lat,lng>`
    );
    return;
  }
  console.log(
    `Places matching "${query}" — use the token column in your DGMO:`
  );
  for (const r of results) {
    const tag = r.kind === 'airport' ? '✈' : '•';
    console.log(`  ${tag} ${r.token.padEnd(22)} ${r.detail}`);
  }
}

async function main(): Promise<void> {
  // Subcommand dispatch — `dgmo migrate` is parsed independently from
  // the rendering flags so its surface doesn't pollute `parseArgs`.
  if (process.argv[2] === 'migrate') {
    await runMigrateCommand(process.argv.slice(3));
    return;
  }

  if (process.argv[2] === 'map') {
    await runMapCommand(process.argv.slice(3));
    return;
  }

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
    const types = getAllChartTypes();
    if (opts.json) {
      const chartTypes = types.map((id) => ({
        id,
        description: CHART_TYPE_DESCRIPTIONS[id] ?? id,
      }));
      process.stdout.write(JSON.stringify({ chartTypes }, null, 2) + '\n');
    } else {
      for (const id of types) {
        const desc = CHART_TYPE_DESCRIPTIONS[id];
        console.log(desc ? `${id} — ${desc}` : id);
      }
    }
    return;
  }

  if (opts.cat) {
    const useColor =
      !opts.noColor &&
      !process.env['NO_COLOR'] &&
      process.stdout.isTTY === true;

    let catContent: string;
    if (opts.input && opts.input !== '-') {
      const inputPath = resolve(opts.input);
      try {
        catContent = readFileSync(inputPath, 'utf-8');
      } catch {
        console.error(`Error: Cannot read file "${inputPath}"`);
        process.exit(1);
      }
    } else {
      // Read from stdin
      try {
        catContent = readFileSync(0, 'utf-8');
      } catch {
        console.error('Error: No input file specified');
        console.error('Usage: dgmo cat <file>');
        process.exit(1);
      }
    }

    const { highlightDgmo, renderAnsi } =
      await import('./editor/highlight-api');
    const tokens = highlightDgmo(catContent);
    process.stdout.write(renderAnsi(tokens, useColor));
    return;
  }

  if (
    opts.installClaudeCodeIntegration ||
    opts.installClaudeSkill ||
    opts.installCodexIntegration ||
    opts.installClaudeDesktopIntegration
  ) {
    console.log(renderBanner());
  }

  if (opts.installClaudeCodeIntegration) {
    const claudeDir = join(homedir(), '.claude');
    if (!existsSync(claudeDir)) {
      console.error('~/.claude directory not found.');
      console.error('Install Claude Code first: https://claude.ai/code');
      process.exit(1);
    }

    function ask(prompt: string): Promise<string> {
      return new Promise((resolve) => {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        rl.question(prompt, (answer) => {
          rl.close();
          resolve(answer);
        });
      });
    }

    // --- Step 1: Install skill ---
    const commandsDir = join(claudeDir, 'commands');
    const skillPath = join(commandsDir, 'dgmo.md');
    const skillExists = existsSync(skillPath);
    let installSkill = true;
    if (skillExists) {
      const ans = await ask(
        '~/.claude/commands/dgmo.md already exists. Overwrite? [y/N] '
      );
      installSkill = ans.toLowerCase() === 'y' || ans.toLowerCase() === 'yes';
    }
    if (installSkill) {
      if (!existsSync(commandsDir)) mkdirSync(commandsDir, { recursive: true });
      writeFileSync(skillPath, readClaudeSkill(), 'utf-8');
      console.log('✓ Skill installed: ~/.claude/commands/dgmo.md');
    } else {
      console.log('  Skipped skill install.');
    }

    // --- Step 2: Check / install dgmo-mcp binary ---
    let dgmoMcpInstalled = false;
    try {
      execSync('which dgmo-mcp', { stdio: 'pipe' });
      dgmoMcpInstalled = true;
    } catch {
      /* not found */
    }
    if (!dgmoMcpInstalled) {
      const ans = await ask(
        '\ndgmo-mcp not found. Install @diagrammo/dgmo-mcp globally now? [Y/n] '
      );
      const yes =
        ans === '' || ans.toLowerCase() === 'y' || ans.toLowerCase() === 'yes';
      if (yes) {
        console.log('Installing @diagrammo/dgmo-mcp...');
        execSync('npm install -g @diagrammo/dgmo-mcp', { stdio: 'inherit' });
        console.log('✓ @diagrammo/dgmo-mcp installed');
      } else {
        console.log(
          '  Skipped. Install later with: npm install -g @diagrammo/dgmo-mcp'
        );
      }
    } else {
      console.log('✓ dgmo-mcp already installed');
    }

    // --- Step 3: Configure MCP server ---
    console.log('\nWhere should the MCP server be configured?');
    console.log('  1) This project only — write .mcp.json here [default]');
    console.log(
      '  2) Globally — add to ~/.claude/settings.json (works in all projects)'
    );
    const scopeAns = await ask('\nChoice [1]: ');
    const useGlobal = scopeAns.trim() === '2';
    const mcpEntry = { command: 'dgmo-mcp' };

    if (useGlobal) {
      const settingsPath = join(claudeDir, 'settings.json');
      let settings: Record<string, unknown> = {};
      if (existsSync(settingsPath)) {
        try {
          settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        } catch {
          /* use empty */
        }
      }
      const mcpServers =
        (settings['mcpServers'] as Record<string, unknown> | undefined) ?? {};
      mcpServers['dgmo'] = mcpEntry;
      settings['mcpServers'] = mcpServers;
      writeFileSync(
        settingsPath,
        JSON.stringify(settings, null, 2) + '\n',
        'utf-8'
      );
      console.log('✓ MCP server added to ~/.claude/settings.json');
    } else {
      const mcpPath = join(process.cwd(), '.mcp.json');
      let mcp: Record<string, unknown> = {};
      if (existsSync(mcpPath)) {
        try {
          mcp = JSON.parse(readFileSync(mcpPath, 'utf-8'));
        } catch {
          /* use empty */
        }
      }
      const mcpServers =
        (mcp['mcpServers'] as Record<string, unknown> | undefined) ?? {};
      mcpServers['dgmo'] = mcpEntry;
      mcp['mcpServers'] = mcpServers;
      writeFileSync(mcpPath, JSON.stringify(mcp, null, 2) + '\n', 'utf-8');
      console.log(
        `✓ MCP server configured: ${join(process.cwd(), '.mcp.json')}`
      );
    }

    console.log('\nRestart Claude Code to activate the MCP server.');
    console.log('Then type /dgmo in any session to start creating diagrams.');
    return;
  }

  if (opts.installClaudeSkill) {
    const claudeDir = join(homedir(), '.claude');
    if (!existsSync(claudeDir)) {
      console.error('~/.claude directory not found.');
      console.error('Install Claude Code first: https://claude.ai/code');
      process.exit(1);
    }
    const commandsDir = join(claudeDir, 'commands');
    const destPath = join(commandsDir, 'dgmo.md');
    const alreadyExists = existsSync(destPath);
    const prompt = alreadyExists
      ? `~/.claude/commands/dgmo.md already exists. Overwrite? [y/N] `
      : `Install dgmo Claude Code skill to ~/.claude/commands/dgmo.md? [Y/n] `;
    await new Promise<void>((done) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(prompt, (answer) => {
        rl.close();
        const yes = alreadyExists
          ? answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
          : answer === '' ||
            answer.toLowerCase() === 'y' ||
            answer.toLowerCase() === 'yes';
        if (!yes) {
          console.error('Aborted.');
          process.exit(0);
        }
        done();
      });
    });
    if (!existsSync(commandsDir)) {
      mkdirSync(commandsDir, { recursive: true });
    }
    writeFileSync(destPath, readClaudeSkill(), 'utf-8');
    console.log(`Installed: ${destPath}`);
    console.log('Use /dgmo in Claude Code to activate the skill.');
    return;
  }

  if (opts.installCodexIntegration) {
    // Validate Codex CLI is installed
    try {
      execSync('which codex', { stdio: 'pipe' });
    } catch {
      console.error(
        'codex not found. Install Codex CLI first: https://openai.com/codex'
      );
      process.exit(1);
    }

    const ask = (prompt: string): Promise<string> =>
      new Promise((resolve) => {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        rl.question(prompt, (answer) => {
          rl.close();
          resolve(answer);
        });
      });

    // Check / install dgmo-mcp binary
    let dgmoMcpInstalled = false;
    try {
      execSync('which dgmo-mcp', { stdio: 'pipe' });
      dgmoMcpInstalled = true;
    } catch {
      /* not found */
    }
    if (!dgmoMcpInstalled) {
      const ans = await ask(
        '\ndgmo-mcp not found. Install @diagrammo/dgmo-mcp globally now? [Y/n] '
      );
      const yes =
        ans === '' || ans.toLowerCase() === 'y' || ans.toLowerCase() === 'yes';
      if (yes) {
        console.log('Installing @diagrammo/dgmo-mcp...');
        try {
          execSync('npm install -g @diagrammo/dgmo-mcp', { stdio: 'inherit' });
          console.log('✓ @diagrammo/dgmo-mcp installed');
        } catch {
          console.error('Error: Failed to install @diagrammo/dgmo-mcp.');
          console.error('Try manually: npm install -g @diagrammo/dgmo-mcp');
        }
      } else {
        console.log(
          '  Skipped. Install later with: npm install -g @diagrammo/dgmo-mcp'
        );
      }
    } else {
      console.log('✓ dgmo-mcp already installed');
    }

    // Configure MCP server
    console.log('\nWhere should the MCP server be configured?');
    console.log(
      '  1) This project only — write .codex/config.toml here [default]'
    );
    console.log(
      '  2) Globally — add to ~/.codex/config.toml (works in all projects)'
    );
    const scopeAns = await ask('\nChoice [1]: ');
    if (
      scopeAns.trim() !== '' &&
      scopeAns.trim() !== '1' &&
      scopeAns.trim() !== '2'
    ) {
      console.log(
        `  Unrecognized input "${scopeAns.trim()}", defaulting to option 1.`
      );
    }
    const useGlobal = scopeAns.trim() === '2';
    const tomlEntry = '[mcp_servers.dgmo]\ncommand = "dgmo-mcp"\n';

    if (useGlobal) {
      const configPath = join(homedir(), '.codex', 'config.toml');
      mkdirSync(join(homedir(), '.codex'), { recursive: true });
      const existing = existsSync(configPath)
        ? readFileSync(configPath, 'utf-8')
        : '';
      if (existing.includes('[mcp_servers.dgmo]')) {
        console.log('✓ MCP server already configured in ~/.codex/config.toml');
      } else {
        const separator = existing.length > 0 ? '\n' : '';
        writeFileSync(configPath, existing + separator + tomlEntry, 'utf-8');
        console.log('✓ MCP server added to ~/.codex/config.toml');
      }
    } else {
      const codexDir = join(process.cwd(), '.codex');
      const configPath = join(codexDir, 'config.toml');
      mkdirSync(codexDir, { recursive: true });
      const existing = existsSync(configPath)
        ? readFileSync(configPath, 'utf-8')
        : '';
      if (existing.includes('[mcp_servers.dgmo]')) {
        console.log(`✓ MCP server already configured in .codex/config.toml`);
      } else {
        const separator = existing.length > 0 ? '\n' : '';
        writeFileSync(configPath, existing + separator + tomlEntry, 'utf-8');
        console.log(`✓ MCP server configured: ${configPath}`);
      }
    }

    // Install the dgmo-diagramming skill at ~/.codex/skills/dgmo-diagramming/SKILL.md
    const skillDir = join(homedir(), '.codex', 'skills', 'dgmo-diagramming');
    const skillPath = join(skillDir, 'SKILL.md');
    const skillBody = readCodexSkill();
    if (existsSync(skillPath)) {
      const existingSkill = readFileSync(skillPath, 'utf-8');
      if (existingSkill === skillBody) {
        console.log('✓ dgmo-diagramming skill already up to date');
      } else {
        const ans = await ask(
          '\n~/.codex/skills/dgmo-diagramming/SKILL.md exists. Overwrite? [Y/n] '
        );
        const yes =
          ans === '' ||
          ans.toLowerCase() === 'y' ||
          ans.toLowerCase() === 'yes';
        if (yes) {
          writeFileSync(skillPath, skillBody, 'utf-8');
          console.log(`✓ Skill updated: ${skillPath}`);
        } else {
          console.log('  Skipped skill update.');
        }
      }
    } else {
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(skillPath, skillBody, 'utf-8');
      console.log(`✓ Skill installed: ${skillPath}`);
    }

    // Non-destructive AGENTS.md handling: append a marked note only if AGENTS.md
    // already exists and doesn't already contain the marker. Never create it.
    const agentsPath = join(process.cwd(), 'AGENTS.md');
    if (existsSync(agentsPath)) {
      const existingAgents = readFileSync(agentsPath, 'utf-8');
      if (existingAgents.includes(CODEX_AGENTS_NOTE_MARKER)) {
        console.log('✓ AGENTS.md already mentions dgmo');
      } else {
        const separator = existingAgents.endsWith('\n') ? '\n' : '\n\n';
        writeFileSync(
          agentsPath,
          existingAgents + separator + CODEX_AGENTS_NOTE,
          'utf-8'
        );
        console.log(`✓ Appended dgmo note to: ${agentsPath}`);
      }
    } else {
      console.log(
        '  No AGENTS.md found in cwd — skipped (the skill is enough).'
      );
    }

    console.log('\nRestart Codex to activate the skill and MCP server.');
    return;
  }

  if (opts.installClaudeDesktopIntegration) {
    const ask = (prompt: string): Promise<string> =>
      new Promise((resolve) => {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        rl.question(prompt, (answer) => {
          rl.close();
          resolve(answer);
        });
      });

    // Check / install dgmo-mcp binary
    let dgmoMcpInstalled = false;
    try {
      execSync('which dgmo-mcp', { stdio: 'pipe' });
      dgmoMcpInstalled = true;
    } catch {
      /* not found */
    }
    if (!dgmoMcpInstalled) {
      const ans = await ask(
        '\ndgmo-mcp not found. Install @diagrammo/dgmo-mcp globally now? [Y/n] '
      );
      const yes =
        ans === '' || ans.toLowerCase() === 'y' || ans.toLowerCase() === 'yes';
      if (yes) {
        console.log('Installing @diagrammo/dgmo-mcp...');
        try {
          execSync('npm install -g @diagrammo/dgmo-mcp', { stdio: 'inherit' });
          console.log('✓ @diagrammo/dgmo-mcp installed');
        } catch {
          console.error('Error: Failed to install @diagrammo/dgmo-mcp.');
          console.error('Try manually: npm install -g @diagrammo/dgmo-mcp');
        }
      } else {
        console.log(
          '  Skipped. Install later with: npm install -g @diagrammo/dgmo-mcp'
        );
      }
    } else {
      console.log('✓ dgmo-mcp already installed');
    }

    // Resolve the Claude Desktop config path for the current platform.
    // macOS and Windows use the documented Claude Desktop paths; Linux
    // doesn't have a first-party build yet, but community installs follow
    // the XDG config convention.
    const os = platform();
    let configPath: string;
    if (os === 'darwin') {
      configPath = join(
        homedir(),
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json'
      );
    } else if (os === 'win32') {
      const appData =
        process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
      configPath = join(appData, 'Claude', 'claude_desktop_config.json');
    } else {
      configPath = join(
        homedir(),
        '.config',
        'Claude',
        'claude_desktop_config.json'
      );
    }

    // Read existing config (or start fresh). Non-JSON contents are treated
    // as corruption and we bail — the user needs to resolve it manually so
    // we don't silently overwrite something they care about.
    type ClaudeDesktopConfig = {
      mcpServers?: Record<
        string,
        { command: string; args?: string[]; env?: Record<string, string> }
      >;
      [key: string]: unknown;
    };
    let config: ClaudeDesktopConfig = {};
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8');
      if (raw.trim().length > 0) {
        try {
          config = JSON.parse(raw) as ClaudeDesktopConfig;
        } catch {
          console.error(
            `Error: ${configPath} exists but is not valid JSON. Fix it manually and re-run, or remove the file to regenerate.`
          );
          process.exit(1);
        }
      }
    }

    const existingDgmo = config.mcpServers?.['dgmo'];
    if (existingDgmo?.command === 'dgmo-mcp') {
      console.log(`✓ dgmo MCP server already configured in ${configPath}`);
    } else {
      if (existingDgmo) {
        const ans = await ask(
          `\nA "dgmo" entry already exists in ${configPath}. Overwrite? [y/N] `
        );
        if (ans.toLowerCase() !== 'y' && ans.toLowerCase() !== 'yes') {
          console.log('  Skipped.');
          return;
        }
      }
      config.mcpServers = {
        ...(config.mcpServers ?? {}),
        dgmo: { command: 'dgmo-mcp' },
      };
      mkdirSync(join(configPath, '..'), { recursive: true });
      writeFileSync(
        configPath,
        JSON.stringify(config, null, 2) + '\n',
        'utf-8'
      );
      console.log(`✓ dgmo MCP server configured: ${configPath}`);
    }

    console.log('\nRestart Claude Desktop to activate the MCP server.');
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

  // Resolve org chart imports (tags and import directives)
  if (opts.input && parseDgmoChartType(content) === 'org') {
    const inputPath = resolve(opts.input);
    const resolved = await resolveOrgImports(content, inputPath, (p) =>
      readFileSync(p, 'utf-8')
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
      process.stdout.write(
        JSON.stringify(
          {
            success: false,
            error,
            ...(line != null ? { line } : {}),
            ...(chartType ? { chartType } : {}),
          },
          null,
          2
        ) + '\n'
      );
    } else {
      console.error(error);
    }
    process.exit(1);
  }

  // URL output — encode DSL directly, no rendering needed.
  // PERT diagrams may contain `start-date now`; resolve to today's
  // date BEFORE encoding so the share-link captures authoring intent
  // (per spec D9). Cheap to call on non-PERT content — the regex
  // matches nothing.
  if (format === 'url') {
    const sourceForUrl =
      chartType === 'pert' ? normalizePertSourceForShare(content) : content;
    const result = encodeDiagramUrl(sourceForUrl);
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
      process.stdout.write(
        JSON.stringify(
          {
            success: true,
            url: result.url,
            ...(chartType ? { chartType } : {}),
          },
          null,
          2
        ) + '\n'
      );
    } else {
      process.stdout.write(result.url + '\n');
    }
    return;
  }

  const paletteColors = getPalette(opts.palette)[
    opts.theme === 'dark' ? 'dark' : 'light'
  ];

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
      const firstError = errors[0]!; // In-bounds by length > 0 check above.
      exitWithJsonError(formatDgmoError(firstError), firstError.line);
    }
    for (const e of errors) {
      console.error(`\u2716 ${formatDgmoError(e)}`);
    }
  }

  const { svg } = await render(content, {
    theme: opts.theme,
    palette: opts.palette,
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
    process.stdout.write(
      JSON.stringify(
        {
          success: true,
          ...(outputPath ? { output: outputPath } : {}),
          ...(chartType ? { chartType } : {}),
        },
        null,
        2
      ) + '\n'
    );
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

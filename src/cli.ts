/* eslint-disable no-console */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { resolve, join, dirname, basename, extname } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { render } from './render';
import {
  parseDgmo,
  getAllChartTypes,
  CHART_TYPE_DESCRIPTIONS,
} from './dgmo-router';
import { parseDgmoChartType } from './dgmo-router';
import {
  isBetaChartType,
  withoutInternalChartTypes,
} from './utils/offered-types';
import { formatDgmoError } from './diagnostics';
import { renderErrorCard } from './error-card';
import { listDiagnosticCodes } from './diagnostics-registry';
import { getPalette, getAvailablePalettes } from './palettes';
import { DEFAULT_FONT_NAME } from './fonts';
import {
  textFromSvg,
  uncoveredCharacters,
  fontPortabilityWarning,
  type FontCoverage,
} from './font-coverage';
import { encodeDiagramUrl } from './sharing';
import { resolveOrgImports } from './org/resolver';
import { normalizePertSourceForShare } from './pert/share-normalize';
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
// agent to query list_chart_types (MCP) / dgmo types (CLI) for the
// authoritative, complete list.
const readClaudeSkill = (): string =>
  readPackagedFile('.claude', 'commands', 'dgmo.md');

// Codex skill source. Already includes the dgmo-diagramming frontmatter and the
// gen-ai-core 45-type index.
const readCodexSkill = (): string => readPackagedFile('SKILL.md');

// Sibling Claude Code slash-command files shipped alongside dgmo.md
// (dgmo-diagram-this, dgmo-document-project, dgmo-codebase-report, ...). dgmo.md
// is single-sourced via readClaudeSkill(); these are copied verbatim. Returns
// the *.md basenames in .claude/commands, dgmo.md excluded.
const listPackagedCommands = (): string[] => {
  try {
    return readdirSync(join(PKG_ROOT, '.claude', 'commands'))
      .filter((f) => f.endsWith('.md') && f !== 'dgmo.md')
      .sort();
  } catch {
    return [];
  }
};

// The /dgmo-codebase-report command, re-skinned as a Codex skill: same body,
// single-sourced from the Claude command file, with Codex frontmatter prepended
// so it never drifts from the maintained original.
const readCodexCodebaseReportSkill = (): string =>
  `---\nname: dgmo-codebase-report\ndescription: Use when the user wants an architecture or onboarding report for a codebase — a single Markdown document explaining how the system works, with embedded DGMO diagrams (module/dependency map, C4, sequence, ER, infra). Produces committable Markdown with \`\`\`dgmo fences, not images.\n---\n\n${readPackagedFile('.claude', 'commands', 'dgmo-codebase-report.md')}`;

const CODEX_AGENTS_NOTE_MARKER = '<!-- dgmo-integration -->';
const CODEX_AGENTS_NOTE = `${CODEX_AGENTS_NOTE_MARKER}
## Diagrams

For architecture diagrams, sequence diagrams, flowcharts, and charts, use the \`dgmo-diagramming\` skill and the configured \`dgmo\` MCP tools (\`open_in_app\`, \`share_diagram\`, \`render_diagram\`, etc.).
`;

function printHelp(): void {
  console.log(renderBanner());
  console.log(`Usage: dgmo <input> [options]          Render a .dgmo file to PNG (default) or SVG
       cat input.dgmo | dgmo [options]  Render from stdin

Commands:
  dgmo share <input>       Print a shareable diagrammo.app URL (copies to clipboard)
  dgmo types               List all supported chart types
  dgmo diagnostics         List every error/warning code (add --json for full catalog)
  dgmo install [target]    Set up AI assistants (auto-detects all if no target).
                           Targets: claude-code, codex, claude-desktop,
                           cursor, windsurf, copilot. --scope user|project
  dgmo mcp                 Run the MCP server (invoked by AI client configs)
  dgmo map-search <query>  Find the map place token (city or IATA code)

Render options:
  -o <file>            Output file (default: <input>.png in cwd)
                       Format inferred from extension: .svg → SVG, else PNG
                       With stdin and no -o, PNG is written to stdout
  --theme <theme>      Theme: ${THEMES.join(', ')} (default: light)
  --palette <name>     Palette: ${PALETTES.join(', ')} (default: slate)
  --json               Output structured JSON to stdout
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
  json: boolean;
} {
  const result = {
    input: undefined as string | undefined,
    output: undefined as string | undefined,
    theme: 'light' as (typeof THEMES)[number],
    palette: 'slate',
    help: false,
    version: false,
    json: false,
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

function inferFormat(outputPath: string | undefined): 'svg' | 'png' {
  if (outputPath && extname(outputPath).toLowerCase() === '.svg') {
    return 'svg';
  }
  return 'png';
}

const BUNDLED_FONTS = [
  join(__dirname, '..', 'fonts', 'Inter-Regular.ttf'),
  join(__dirname, '..', 'fonts', 'Inter-Bold.ttf'),
];

const BUNDLED_COVERAGE = join(__dirname, '..', 'fonts', 'coverage.json');

function svgToPng(svg: string, background?: string): Buffer {
  warnOnUncoveredGlyphs(svg);
  const fontFiles = BUNDLED_FONTS.filter((f) => existsSync(f));
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: 2 },
    ...(background ? { background } : {}),
    font: {
      // 🔴 Always on, even though the bundled Inter was found. It used to be
      // `fontFiles.length === 0` — system fonts off precisely BECAUSE we had
      // our own — which made the `system-ui, …, sans-serif` tail of
      // FONT_FAMILY inert and left every script Inter lacks drawing NOTHING:
      // no box, no warning, exit 0. Measured 2026-08-07, a bar labelled 日本語
      // rasterised identically to one labelled with an unassigned Private Use
      // codepoint. Turning it on costs nothing for Latin — Inter is still
      // loaded explicitly and named as both default and sans-serif family, and
      // the Latin output is byte-identical across the change.
      loadSystemFonts: true,
      ...(fontFiles.length > 0 ? { fontFiles } : {}),
      defaultFontFamily: DEFAULT_FONT_NAME,
      sansSerifFamily: DEFAULT_FONT_NAME,
    },
  });
  const rendered = resvg.render();
  return rendered.asPng();
}

/**
 * Warn when the diagram carries characters the bundled font cannot draw.
 *
 * System fallback above means these usually DID render here, off a font this
 * machine happens to have. The warning is about the next machine — a CI
 * container with no CJK font draws nothing and reports success.
 */
function warnOnUncoveredGlyphs(svg: string): void {
  let coverage: FontCoverage;
  try {
    coverage = JSON.parse(
      readFileSync(BUNDLED_COVERAGE, 'utf-8')
    ) as FontCoverage;
  } catch {
    return; // no manifest (a partial install) is not worth a warning of its own
  }
  const warning = fontPortabilityWarning(
    uncoveredCharacters(textFromSvg(svg), coverage)
  );
  if (warning) console.error(`Warning: ${warning}`);
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

// Best-effort clipboard copy across platforms. Returns true on success.
function copyToClipboard(text: string): boolean {
  try {
    if (process.platform === 'darwin') {
      execSync('pbcopy', { input: text });
    } else if (process.platform === 'win32') {
      execSync('clip', { input: text });
    } else {
      execSync('xclip -selection clipboard', { input: text });
    }
    return true;
  } catch {
    return false;
  }
}

// `dgmo map-search <query>` — discover the exact place token the map resolver
// expects (city name or bundled IATA airport code), so authors never guess
// (e.g. "New York" → `New York City`; "kennedy" → `JFK`). Searches cities +
// the bundled airport set; `--json` for machine output, `--limit N` to widen.
async function runMapSearchCommand(args: string[]): Promise<void> {
  const json = args.includes('--json');
  const limFlag = args.indexOf('--limit');
  const limit =
    limFlag >= 0 ? Math.max(1, Number(args[limFlag + 1]) || 20) : 20;
  // The query is the positional args (allow unquoted multi-word: `... New York`).
  const query = args
    .filter(
      (a, i, arr) =>
        a !== '--json' && a !== '--limit' && arr[i - 1] !== '--limit'
    )
    .join(' ')
    .trim();

  if (!query) {
    console.log('Usage: dgmo map-search <query> [--json] [--limit N]');
    console.log(
      '  Find the place token the map resolver expects (city or IATA airport code).'
    );
    console.log('  Examples:');
    console.log(
      '    dgmo map-search "new york"     # → New York City (+ JFK/LGA/EWR airports)'
    );
    console.log('    dgmo map-search kennedy        # → JFK by airport name');
    console.log('    dgmo map-search heathrow --json');
    process.exitCode = 1;
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

// `dgmo types [--json]` — list every supported chart type. Was the
// `--chart-types` render flag; promoted to a subcommand since it's a
// query, not a rendering option.
function runTypesCommand(args: string[]): void {
  const json = args.includes('--json');
  // `getAllChartTypes()` means "everything routable" and deliberately keeps
  // internal types. `CHART_TYPE_DESCRIPTIONS` is a bare Record and carries no
  // metadata, so the flag is only visible through the shared cross-lookup.
  const types = withoutInternalChartTypes(getAllChartTypes());
  if (json) {
    const listed = types.map((id) => ({
      id,
      description: CHART_TYPE_DESCRIPTIONS[id] ?? id,
      // Present on every entry rather than only the beta ones, so a consumer
      // can tell "not beta" from "this dgmo is too old to know" (issue #221).
      beta: isBetaChartType(id),
    }));
    process.stdout.write(
      JSON.stringify({ chartTypes: listed }, null, 2) + '\n'
    );
  } else {
    for (const id of types) {
      const desc = CHART_TYPE_DESCRIPTIONS[id];
      // Spelled out, not a glyph: this goes to a terminal that may be piped,
      // read by a screen reader, or copied into an issue.
      const mark = isBetaChartType(id) ? ' [beta]' : '';
      console.log(desc ? `${id}${mark} — ${desc}` : `${id}${mark}`);
    }
  }
}

// `dgmo diagnostics [--json]` — enumerate the diagnostic catalog: every
// error/warning code dgmo can emit, its severity, owning chart type,
// canonical message, fix hint, and a triggering example. Plain mode
// prints one line per code; `--json` emits the full catalog (consumed by
// the console error-review surface, MCP, and the language-spec docs).
function runDiagnosticsCommand(args: string[]): void {
  const json = args.includes('--json');
  const specs = listDiagnosticCodes();
  if (json) {
    const catalog = specs.map((s) => ({
      code: s.code,
      severity: s.severity,
      chartType: s.chartType,
      title: s.title,
      message: typeof s.message === 'function' ? s.message({}) : s.message,
      hint: s.hint,
      example: s.example,
    }));
    process.stdout.write(
      JSON.stringify({ diagnostics: catalog }, null, 2) + '\n'
    );
  } else {
    for (const s of specs) {
      const badge = s.severity === 'error' ? 'ERR ' : 'WARN';
      const chart = s.chartType ?? 'global';
      console.log(`${badge} ${s.code}  [${chart}]  ${s.title}`);
    }
  }
}

// `dgmo share <input> [--no-copy] [--json]` — encode the diagram into a
// shareable diagrammo.app URL. Replaces the old `-o url [--copy]` pair: the
// URL is printed to stdout (pipeable) and copied to the clipboard by default
// unless --no-copy is given.
async function runShareCommand(args: string[]): Promise<void> {
  const json = args.includes('--json');
  const noCopy = args.includes('--no-copy');
  const inputArg = args.find((a) => a !== '-' && !a.startsWith('-'));

  let content: string;
  if (inputArg) {
    try {
      content = readFileSync(resolve(inputArg), 'utf-8');
    } catch {
      console.error(`Error: Cannot read file "${resolve(inputArg)}"`);
      process.exit(1);
    }
  } else if (!process.stdin.isTTY) {
    try {
      content = readFileSync(0, 'utf-8');
    } catch {
      console.error('Error: No input provided to dgmo share');
      console.error('Usage: dgmo share <input> [--no-copy] [--json]');
      process.exit(1);
    }
  } else {
    console.error('Error: dgmo share requires an input file or piped stdin');
    console.error('Usage: dgmo share <input> [--no-copy] [--json]');
    process.exit(1);
  }

  // eslint-disable-next-line no-control-regex
  content = content.replace(/\x1b\[[0-9;]*m/g, '');

  const chartType = parseDgmoChartType(content);
  // PERT diagrams may contain `start-date now`; resolve to today before
  // encoding so the share-link captures authoring intent (spec D9).
  const sourceForUrl =
    chartType === 'pert' ? normalizePertSourceForShare(content) : content;
  const result = encodeDiagramUrl(sourceForUrl);

  if (result.error) {
    const msg = `Error: Diagram too large for URL sharing (${result.compressedSize} bytes, limit ${result.limit} bytes)`;
    if (json) {
      process.stdout.write(
        JSON.stringify({ success: false, error: msg }, null, 2) + '\n'
      );
    } else {
      console.error(msg);
    }
    process.exit(1);
  }

  if (!noCopy) {
    console.error(
      copyToClipboard(result.url)
        ? 'URL copied to clipboard'
        : 'Warning: Could not copy to clipboard'
    );
  }

  if (json) {
    process.stdout.write(
      JSON.stringify(
        { success: true, url: result.url, ...(chartType ? { chartType } : {}) },
        null,
        2
      ) + '\n'
    );
  } else {
    process.stdout.write(result.url + '\n');
  }
}

// Single source of truth for how every AI client launches the MCP server: the
// `dgmo` binary the user already has, plus the `mcp` subcommand. No generated
// config ever references a separate `dgmo-mcp` command — the user installs one
// binary and that's it. (The server itself still lives in the
// @diagrammo/dgmo-mcp package, which depends on this library; `dgmo mcp` locates
// and execs it, so there's no dependency cycle and no extra deps bundled here.)
const MCP_LAUNCH = { command: 'dgmo', args: ['mcp'] } as const;

const INSTALL_TARGETS = [
  'claude-code',
  'codex',
  'claude-desktop',
  'cursor',
  'windsurf',
  'copilot',
] as const;
type InstallTarget = (typeof INSTALL_TARGETS)[number];

interface InstallOpts {
  scope: 'user' | 'project';
  dryRun: boolean;
}

// `dgmo mcp` — run the MCP server. This is what AI client configs invoke. It
// runs the server bundled next to this CLI if present, otherwise fetches and
// runs it on demand via npx so a config pointing at `dgmo mcp` works even before
// the server package has been installed. stdio is inherited so the stdio MCP
// transport is fully transparent.
function runMcpCommand(args: string[]): never {
  const onWin = process.platform === 'win32';
  const run = (cmd: string, cmdArgs: string[]) =>
    spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: onWin });
  // npx path is pinned to @latest so the on-demand server is never stale.
  const npx = () => run('npx', ['-y', '@diagrammo/dgmo-mcp@latest', ...args]);
  // Default: prefer the server bundled next to this CLI (Homebrew installs both
  // into one prefix; a co-located npm-global lands it as a sibling too) — fast,
  // works offline, and `dgmo install` keeps it on @latest. Resolving it by
  // absolute path means the Homebrew formula never puts a `dgmo-mcp` binary on
  // PATH, so it can't collide with a stale `npm i -g @diagrammo/dgmo-mcp`
  // symlink and abort `brew link`. Fall back to a `dgmo-mcp` already on PATH
  // (older global installs), then npx. Set DGMO_MCP_LATEST=1 to always fetch
  // the newest server via npx instead (needs network; adds cold-start).
  const bundled = bundledMcpEntry();
  const res =
    process.env['DGMO_MCP_LATEST'] === '1'
      ? npx()
      : bundled
        ? run(process.execPath, [bundled, ...args])
        : commandExists('dgmo-mcp')
          ? run('dgmo-mcp', args)
          : npx();
  if (res.error) {
    console.error(
      'Could not launch the dgmo MCP server. Install it with: npm install -g @diagrammo/dgmo-mcp'
    );
    process.exit(1);
  }
  process.exit(res.status ?? 0);
}

// Cross-platform "is this command on PATH?" check.
function commandExists(cmd: string): boolean {
  try {
    const probe =
      process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(probe, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// Claude Desktop config path for the current platform. macOS/Windows use the
// documented locations; Linux follows the XDG convention community builds use.
function claudeDesktopConfigPath(): string {
  const os = platform();
  if (os === 'darwin') {
    return join(
      homedir(),
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json'
    );
  }
  if (os === 'win32') {
    const appData =
      process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'Claude', 'claude_desktop_config.json');
  }
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

// Best-effort, NON-fatal pre-install of the MCP server so the first tool call
// has no cold-start. Not required for correctness — `dgmo mcp` falls back to
// npx — so any failure is a note, not an error. Memoized: in auto mode we set
// up several surfaces in one run and only need to check once.
// True when this CLI is running from a Homebrew install (its files live under
// a Cellar prefix). Homebrew owns the MCP server in that case.
function isHomebrewManaged(): boolean {
  return PKG_ROOT.includes('/Cellar/') || PKG_ROOT.includes('/homebrew/');
}

// Absolute path to the MCP server, or null if it is not installed.
//
// `@diagrammo/dgmo-mcp` is an ordinary dependency of `@diagrammo/dgmo-cli`, so
// this is plain node resolution — no assumption about how a package manager
// laid out `node_modules`, and nothing to keep in step with the Homebrew
// formula. It replaced a `resolve(PKG_ROOT, '..', 'dgmo-mcp', …)` directory
// walk that only worked when the two packages happened to be siblings.
//
// npm links bins for the top-level install only, never a dependency's, so the
// server still never lands on PATH — which is the stale-symlink collision that
// aborts `brew link`, and it stays avoided.
function bundledMcpEntry(): string | null {
  try {
    return require.resolve('@diagrammo/dgmo-mcp/dist/index.js');
  } catch {
    return null;
  }
}

let mcpEnsured = false;
function ensureDgmoMcp(opts: InstallOpts): void {
  if (mcpEnsured) return;
  mcpEnsured = true;
  // Homebrew vendors and upgrades the MCP server alongside the CLI (the formula
  // installs it as a sibling in the same prefix). Don't npm-install a second
  // global copy — `brew upgrade dgmo` keeps it current.
  if (isHomebrewManaged()) {
    console.log(
      bundledMcpEntry()
        ? '✓ MCP server managed by Homebrew (upgrades with `brew upgrade dgmo`)'
        : '  MCP server not found — it will be fetched on first use via npx.'
    );
    return;
  }
  if (opts.dryRun) {
    console.log('  [dry-run] would install/upgrade @diagrammo/dgmo-mcp@latest');
    return;
  }
  // Always pull @latest, not just install-if-absent: the MCP tools live in a
  // separately-versioned package, so re-running `dgmo install` (e.g. after a
  // `dgmo` upgrade) is what refreshes the server. Non-fatal — `dgmo mcp` falls
  // back to `npx …@latest`.
  try {
    const verb = commandExists('dgmo-mcp') ? 'Updating' : 'Installing';
    console.log(`${verb} the MCP server (@diagrammo/dgmo-mcp@latest)…`);
    execSync('npm install -g @diagrammo/dgmo-mcp@latest', { stdio: 'inherit' });
    console.log('✓ MCP server up to date');
  } catch {
    console.log(
      '  Could not install now — it will be fetched on first use via npx.'
    );
  }
}

// Write helper that honors --dry-run and creates parent dirs.
function writeOut(
  opts: InstallOpts,
  path: string,
  content: string,
  label: string
): void {
  if (opts.dryRun) {
    console.log(`  [dry-run] would write ${label}`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
  console.log(`✓ ${label}`);
}

// Merge `{ mcpServers: { dgmo: dgmo mcp } }` into a JSON config (Claude Code /
// Claude Desktop style), preserving any other entries.
function upsertJsonMcp(opts: InstallOpts, path: string): void {
  let cfg: Record<string, unknown> = {};
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf-8');
    if (raw.trim().length > 0) {
      try {
        cfg = JSON.parse(raw);
      } catch {
        console.error(
          `Error: ${path} is not valid JSON — fix it and re-run (skipping it for now).`
        );
        return;
      }
    }
  }
  const servers =
    (cfg['mcpServers'] as Record<string, unknown> | undefined) ?? {};
  servers['dgmo'] = MCP_LAUNCH;
  cfg['mcpServers'] = servers;
  writeOut(
    opts,
    path,
    JSON.stringify(cfg, null, 2) + '\n',
    `MCP server → ${path}`
  );
}

// Which AI surfaces are present on this machine? Drives zero-prompt auto setup.
function detectSurfaces(): InstallTarget[] {
  const found: InstallTarget[] = [];
  if (existsSync(join(homedir(), '.claude'))) found.push('claude-code');
  if (existsSync(join(homedir(), '.codex')) || commandExists('codex'))
    found.push('codex');
  if (existsSync(dirname(claudeDesktopConfigPath())))
    found.push('claude-desktop');
  if (existsSync(join(homedir(), '.cursor'))) found.push('cursor');
  if (
    existsSync(join(homedir(), '.windsurf')) ||
    existsSync(join(homedir(), '.codeium'))
  )
    found.push('windsurf');
  // Copilot is project-scoped: only when the current repo has a .github dir.
  if (existsSync(join(process.cwd(), '.github'))) found.push('copilot');
  return found;
}

async function runOneInstall(
  target: InstallTarget,
  opts: InstallOpts
): Promise<void> {
  switch (target) {
    case 'claude-code':
      return installClaudeCode(opts);
    case 'codex':
      return installCodex(opts);
    case 'claude-desktop':
      return installClaudeDesktop(opts);
    case 'cursor':
      return installCursor(opts);
    case 'windsurf':
      return installWindsurf(opts);
    case 'copilot':
      return installCopilot(opts);
  }
}

function printInstallHelp(): void {
  console.log(`Usage: dgmo install [target] [--scope user|project] [--dry-run]

With no target, auto-detects every installed AI assistant and sets up each one
(no prompts). The only binary you ever install is \`dgmo\` — it provides the MCP
server via \`dgmo mcp\`.

Targets:   ${INSTALL_TARGETS.join(', ')}
--scope    user = configure globally for all projects (default)
           project = write config into the current directory
--dry-run  print what would change without writing anything`);
}

// `dgmo install [target] [--scope ...] [--dry-run]`. No target → auto-detect.
async function runInstallCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printInstallHelp();
    return;
  }
  const scopeIdx = args.indexOf('--scope');
  const scope: 'user' | 'project' =
    scopeIdx >= 0 && args[scopeIdx + 1] === 'project' ? 'project' : 'user';
  const opts: InstallOpts = { scope, dryRun: args.includes('--dry-run') };

  const positional = args.filter(
    (a, i) => !a.startsWith('-') && args[i - 1] !== '--scope'
  );
  const target = positional[0] as InstallTarget | undefined;

  console.log(renderBanner());

  if (target) {
    if (!INSTALL_TARGETS.includes(target)) {
      console.error(`Error: Unknown install target "${target}".`);
      console.error(`Valid targets: ${INSTALL_TARGETS.join(', ')}`);
      process.exit(1);
    }
    await runOneInstall(target, opts);
    console.log('\nRestart the assistant to activate the dgmo tools.');
    console.log('(Re-run `dgmo install` after upgrading dgmo to refresh.)');
    return;
  }

  const detected = detectSurfaces();
  if (detected.length === 0) {
    console.log(
      'No AI assistants detected (looked for Claude Code, Codex, Claude Desktop, Cursor, Windsurf, a .github dir).'
    );
    console.log('Install one and re-run `dgmo install`, or name a target:');
    console.log(`  dgmo install <${INSTALL_TARGETS.join('|')}>`);
    return;
  }
  console.log(`Detected: ${detected.join(', ')} — setting up each.\n`);
  for (const t of detected) {
    console.log(`── ${t} ──`);
    await runOneInstall(t, opts);
    console.log('');
  }
  console.log('Done. Restart your AI assistant(s) to activate the dgmo tools.');
  console.log('(Re-run `dgmo install` after upgrading dgmo to refresh.)');
}

async function installClaudeCode(opts: InstallOpts): Promise<void> {
  const claudeDir = join(homedir(), '.claude');
  // Skill — single-sourced and always refreshed to the maintained latest.
  writeOut(
    opts,
    join(claudeDir, 'commands', 'dgmo.md'),
    readClaudeSkill(),
    'Skill → ~/.claude/commands/dgmo.md'
  );
  // Sibling slash commands (/dgmo-codebase-report, /dgmo-diagram-this,
  // /dgmo-document-project). They ship in the package but were previously never
  // installed — copy them so the commands actually land for the user.
  for (const name of listPackagedCommands()) {
    writeOut(
      opts,
      join(claudeDir, 'commands', name),
      readPackagedFile('.claude', 'commands', name),
      `Command → ~/.claude/commands/${name}`
    );
  }
  ensureDgmoMcp(opts);
  if (opts.scope === 'user') {
    upsertJsonMcp(opts, join(claudeDir, 'settings.json'));
    console.log('  (scope: all projects)');
  } else {
    upsertJsonMcp(opts, join(process.cwd(), '.mcp.json'));
    console.log('  (scope: this project)');
  }
  console.log('  Then type /dgmo in any Claude Code session.');
}

async function installCodex(opts: InstallOpts): Promise<void> {
  ensureDgmoMcp(opts);

  // MCP config (TOML). The block migrates in place if a legacy entry exists.
  const tomlEntry = '[mcp_servers.dgmo]\ncommand = "dgmo"\nargs = ["mcp"]\n';
  const configPath =
    opts.scope === 'user'
      ? join(homedir(), '.codex', 'config.toml')
      : join(process.cwd(), '.codex', 'config.toml');
  const existing = existsSync(configPath)
    ? readFileSync(configPath, 'utf-8')
    : '';
  let next: string;
  if (existing.includes('[mcp_servers.dgmo]')) {
    next = existing.replace(/\[mcp_servers\.dgmo\][^[]*/, tomlEntry);
  } else {
    const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    next = existing + sep + tomlEntry;
  }
  writeOut(opts, configPath, next, `MCP server → ${configPath}`);

  // Skill — single-sourced, always refreshed.
  writeOut(
    opts,
    join(homedir(), '.codex', 'skills', 'dgmo-diagramming', 'SKILL.md'),
    readCodexSkill(),
    'Skill → ~/.codex/skills/dgmo-diagramming/SKILL.md'
  );

  // Codebase-report skill (single-sourced from the Claude command file).
  writeOut(
    opts,
    join(homedir(), '.codex', 'skills', 'dgmo-codebase-report', 'SKILL.md'),
    readCodexCodebaseReportSkill(),
    'Skill → ~/.codex/skills/dgmo-codebase-report/SKILL.md'
  );

  // Non-destructive AGENTS.md note: only append to an existing file, never create.
  const agentsPath = join(process.cwd(), 'AGENTS.md');
  if (!opts.dryRun && existsSync(agentsPath)) {
    const existingAgents = readFileSync(agentsPath, 'utf-8');
    if (!existingAgents.includes(CODEX_AGENTS_NOTE_MARKER)) {
      const separator = existingAgents.endsWith('\n') ? '\n' : '\n\n';
      writeFileSync(
        agentsPath,
        existingAgents + separator + CODEX_AGENTS_NOTE,
        'utf-8'
      );
      console.log('✓ Appended dgmo note to AGENTS.md');
    }
  }
}

async function installClaudeDesktop(opts: InstallOpts): Promise<void> {
  ensureDgmoMcp(opts);
  // Claude Desktop config is always the per-user app config (scope is N/A).
  upsertJsonMcp(opts, claudeDesktopConfigPath());
}

// Cursor speaks MCP via ~/.cursor/mcp.json (user) or .cursor/mcp.json (project),
// using the same { mcpServers } schema as Claude — so it gets the full tools,
// not just syntax guidance. We also drop the shipped .cursorrules so the model
// has inline context without a tool round-trip.
function installCursor(opts: InstallOpts): void {
  ensureDgmoMcp(opts);
  const path =
    opts.scope === 'project'
      ? join(process.cwd(), '.cursor', 'mcp.json')
      : join(homedir(), '.cursor', 'mcp.json');
  upsertJsonMcp(opts, path);
  writeOut(
    opts,
    join(process.cwd(), '.cursorrules'),
    readPackagedFile('.cursorrules'),
    'Cursor rules → .cursorrules'
  );
}

// Windsurf (Codeium) reads MCP from ~/.codeium/windsurf/mcp_config.json.
function installWindsurf(opts: InstallOpts): void {
  ensureDgmoMcp(opts);
  upsertJsonMcp(
    opts,
    join(homedir(), '.codeium', 'windsurf', 'mcp_config.json')
  );
  writeOut(
    opts,
    join(process.cwd(), '.windsurfrules'),
    readPackagedFile('.windsurfrules'),
    'Windsurf rules → .windsurfrules'
  );
}

// Copilot has no MCP path — ship the project-root instructions file it auto-loads.
function installCopilot(opts: InstallOpts): void {
  writeOut(
    opts,
    join(process.cwd(), '.github', 'copilot-instructions.md'),
    readPackagedFile('.github', 'copilot-instructions.md'),
    'Copilot context → .github/copilot-instructions.md'
  );
}

async function main(): Promise<void> {
  // Subcommand dispatch — each is parsed independently from the rendering
  // flags so their surface doesn't pollute `parseArgs`.
  const sub = process.argv[2];
  if (sub === 'map-search') {
    await runMapSearchCommand(process.argv.slice(3));
    return;
  }
  if (sub === 'share') {
    await runShareCommand(process.argv.slice(3));
    return;
  }
  if (sub === 'types') {
    runTypesCommand(process.argv.slice(3));
    return;
  }
  if (sub === 'diagnostics') {
    runDiagnosticsCommand(process.argv.slice(3));
    return;
  }
  if (sub === 'install') {
    await runInstallCommand(process.argv.slice(3));
    return;
  }
  if (sub === 'mcp') {
    runMcpCommand(process.argv.slice(3));
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

  // `-o url` was replaced by `dgmo share`; catch the old usage with a helpful
  // redirect instead of writing a file literally named "url".
  if (opts.output === 'url') {
    console.error('Error: `-o url` was replaced by `dgmo share <input>`.');
    console.error(`Try: dgmo share ${opts.input ?? '<input>'}`);
    process.exit(1);
  }

  const format = inferFormat(opts.output);

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
      console.error(`⚠ ${formatDgmoError(w)}`);
    }
  }

  // Print errors and exit
  if (errors.length > 0) {
    if (opts.json) {
      const firstError = errors[0]!; // In-bounds by length > 0 check above.
      exitWithJsonError(formatDgmoError(firstError), firstError.line);
    }
    for (const e of errors) {
      console.error(`✖ ${formatDgmoError(e)}`);
    }
  }

  const rendered = await render(content, {
    theme: opts.theme,
    palette: opts.palette,
    // The CLI is the Node host, so it supplies the fs loader `render()` no
    // longer reaches for itself. Passed as the function, not its result — it
    // runs only if the content turns out to be a map.
    mapData: loadMapData,
  });
  let svg = rendered.svg;
  const renderDiagnostics = rendered.diagnostics;

  // Error-severity diagnostics ⇒ the error card, never a partial chart — the
  // same contract as the library `render()` (index.ts) that embeds use. A
  // misleading half-diagram in a PNG is worse than a clear "here's what broke".
  if (errors.length > 0) {
    svg = renderErrorCard(
      errors,
      content,
      getPalette(opts.palette),
      opts.theme === 'dark' ? 'dark' : 'light'
    );
  }

  if (!svg) {
    if (errors.length === 0) {
      // 🔴 `errors` came from the PARSE pass, which cannot see everything that
      // stops a render: a place name that will not resolve, or a basemap the
      // host could not load. `render()` reports those in its own diagnostics,
      // and this branch used to throw them away and announce "the input may be
      // empty, invalid, or use an unsupported chart type" — blaming a diagram
      // that was fine. That sentence is what made #121 (a CLI package published
      // with no map data) read as a bad fixture for an afternoon. Say what the
      // renderer actually reported, and only fall back to guessing when it
      // reported nothing at all.
      const why = renderDiagnostics.filter((d) => d.severity === 'error');
      if (why.length > 0) {
        const first = why[0]!; // In-bounds by length > 0 check above.
        if (opts.json) exitWithJsonError(formatDgmoError(first), first.line);
        for (const d of why) console.error(`✖ ${formatDgmoError(d)}`);
        process.exit(1);
      }
      exitWithJsonError(
        'Error: Failed to render diagram, and nothing reported why. The input may be empty or use an unsupported chart type.'
      );
    }
    process.exit(1);
  }

  // Countdown is the only dynamic chart type — a rendered file is a snapshot
  // that can't tick. Warn (in-figure the "as of" stamp says the same). Skip in
  // JSON mode to keep stdout clean.
  if (chartType === 'countdown' && !opts.json) {
    const asof = new Date().toISOString().slice(0, 10);
    console.error(
      `⚠ countdown is dynamic — this file is a snapshot as of ${asof}. Use a live embed to keep it ticking.`
    );
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

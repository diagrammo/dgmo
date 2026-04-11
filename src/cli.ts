/* eslint-disable no-console */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve, join, basename, extname } from 'node:path';
import { createInterface } from 'node:readline';
import { Resvg } from '@resvg/resvg-js';
import { render } from './render';
import { parseDgmo, getAllChartTypes } from './dgmo-router';
import { parseDgmoChartType } from './dgmo-router';
import { formatDgmoError } from './diagnostics';
import { getPalette, getAvailablePalettes } from './palettes';
import { DEFAULT_FONT_NAME } from './fonts';
import { encodeDiagramUrl } from './sharing';
import { resolveOrgImports } from './org/resolver';

// Derived from the palette registry so new palettes are auto-included.
const PALETTES = getAvailablePalettes().map((p) => p.id);

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
  infra: 'Infra chart — infrastructure traffic flow with rps computation',
  'boxes-and-lines':
    'Boxes and lines — general-purpose node-edge diagrams with groups and tags',
};

const CLAUDE_SKILL_CONTENT = `# dgmo — Diagrammo Diagram Assistant

You are helping the user author, render, and share diagrams using the \`dgmo\` CLI and \`.dgmo\` file format.

## What is dgmo?

\`dgmo\` is a CLI tool and library that renders \`.dgmo\` diagram files to PNG, SVG, or shareable URLs. Diagrams are written in a plain-text DSL.

## Setup Check — Run This First

**Before doing anything else**, check whether the MCP tools are available in this session by attempting to call \`mcp__dgmo__list_chart_types\`. If that tool exists and succeeds, skip this section entirely.

If the MCP tools are **not** available, run the setup flow below — do not ask the user, just do it:

### Step 1 — Install the CLI (if missing)

\`\`\`bash
which dgmo || npm install -g @diagrammo/dgmo
\`\`\`

### Step 2 — Install the MCP server (if missing)

\`\`\`bash
which dgmo-mcp || npm install -g @diagrammo/dgmo-mcp
\`\`\`

### Step 3 — Configure the MCP server

Ask the user:

> "Where should I configure the MCP server?
> 1) This project only — write \`.mcp.json\` here [default]
> 2) Globally — add to \`~/.claude/settings.json\` (works in all projects)"

**Option 1 (default):** Create or update \`.mcp.json\` in the current working directory:

\`\`\`json
{
  "mcpServers": {
    "dgmo": {
      "command": "dgmo-mcp"
    }
  }
}
\`\`\`

If \`.mcp.json\` already exists and has other servers, merge the \`dgmo\` entry in — do not overwrite the file.

**Option 2 (global):** Add the \`dgmo\` entry to the \`mcpServers\` object in \`~/.claude/settings.json\`. Read the file first and merge — do not overwrite other keys.

### Step 4 — Prompt restart

Tell the user:

> "Done. **Restart Claude Code** to activate the MCP server — diagram preview and rendering will be available in the next session."

Then proceed with the user's original request using CLI fallback (see "Other output options" below).

> **Note for future users:** To set up in one step from the terminal before starting a Claude Code session, run \`dgmo --install-claude-code-integration\`. It handles everything: installs \`@diagrammo/dgmo-mcp\`, writes the skill, and configures the MCP server.

## Getting Syntax Help

**Always use the MCP tool first** if it's available in this session:

\`\`\`
mcp__dgmo__get_language_reference            // full reference
mcp__dgmo__get_language_reference("sequence") // specific chart type
\`\`\`

This is the authoritative, always-up-to-date syntax reference. Use it before guessing syntax.

## Your Workflow

When the user asks you to create or edit a diagram:

1. **Get syntax** — call \`mcp__dgmo__get_language_reference("<type>")\` if you're unsure of the syntax.
2. **Write the \`.dgmo\` content** — compose the markup.
3. **Save the source file** (if working in a project) — write it to \`<name>.dgmo\` so the user has an editable file.
4. **Render and show** — pick the right output based on what the user wants (see below).

### Output options — always offer these proactively after creating a diagram

| What the user wants | How to do it |
|---|---|
| **Quick look in the desktop app** | \`mcp__dgmo__open_in_app(dgmo)\` — opens directly in Diagrammo (macOS) |
| **Browser preview with theme toggle** | \`mcp__dgmo__preview_diagram([{dgmo, title}])\` — opens HTML in browser |
| **View in macOS Preview (or default image viewer)** | \`mcp__dgmo__render_diagram(dgmo, format:"png")\` → get temp path → \`open <path>\` |
| **View SVG in browser** | \`mcp__dgmo__render_diagram(dgmo, format:"svg")\` → write SVG to a temp \`.svg\` file → \`open <path>\` |
| **Save as PNG** | \`mcp__dgmo__render_diagram(dgmo, format:"png")\` → returns temp path; offer to copy to their preferred location. Or CLI: \`dgmo file.dgmo -o out.png\` |
| **Save as SVG** | \`mcp__dgmo__render_diagram(dgmo, format:"svg")\` returns SVG text — write it to the desired path. Or CLI: \`dgmo file.dgmo -o out.svg\` |
| **Shareable URL** | \`mcp__dgmo__share_diagram(dgmo)\` or CLI: \`dgmo file.dgmo -o url --copy\` |

**After creating a diagram, always present these options to the user** — don't just render silently and stop. A good response ends with something like: *"I've saved the file as \`diagram.dgmo\`. Want me to open it in the app, export it as a PNG, or generate a shareable link?"*

## CLI Reference

\`\`\`
dgmo <input.dgmo> [options]
cat input.dgmo | dgmo [options]
\`\`\`

Key options:
- \`-o <file>\` — output file; format inferred from extension (\`.svg\` → SVG, else PNG)
- \`-o url\` — output a shareable diagrammo.app URL
- \`--theme <theme>\` — \`light\` (default), \`dark\`, \`transparent\`
- \`--palette <name>\` — \`nord\` (default), \`solarized\`, \`catppuccin\`, \`rose-pine\`, \`gruvbox\`, \`tokyo-night\`, \`one-dark\`, \`bold\`
- \`--copy\` — copy the URL to clipboard (use with \`-o url\`)
- \`--branding\` — add diagrammo.app branding to exports
- \`--chart-types\` — list all supported chart types

## Supported Chart Types

| Type | Use case |
|------|----------|
| \`bar\` | Categorical comparisons |
| \`line\` / \`multi-line\` / \`area\` | Trends over time |
| \`pie\` / \`doughnut\` | Part-to-whole |
| \`radar\` / \`polar-area\` | Multi-dimensional metrics |
| \`bar-stacked\` | Multi-series categorical |
| \`scatter\` | 2D data points or bubble chart |
| \`sankey\` | Flow / allocation |
| \`chord\` | Circular flow relationships |
| \`function\` | Mathematical expressions |
| \`heatmap\` | Matrix intensity |
| \`funnel\` | Conversion pipeline |
| \`slope\` | Change between two periods |
| \`wordcloud\` | Term frequency |
| \`arc\` | Network relationships |
| \`timeline\` | Events, eras, date ranges |
| \`venn\` | Set overlaps |
| \`quadrant\` | 2x2 positioning matrix |
| \`sequence\` | Message / interaction flows |
| \`flowchart\` | Decision trees, process flows |
| \`state\` | State machine / lifecycle |
| \`class\` | UML class hierarchies |
| \`er\` | Database schemas |
| \`org\` | Hierarchical tree structures |
| \`kanban\` | Task / workflow columns |
| \`c4\` | System architecture (context → container → component → deployment) |
| \`sitemap\` | Website / app navigation structure |
| \`infra\` | Infrastructure traffic flow with rps computation |
| \`gantt\` | Project scheduling with dependencies |
| \`boxes-and-lines\` | General-purpose node-edge diagrams with groups and tags |

## Key Syntax Patterns

### Common to all diagrams

\`\`\`
sequence               // explicit type (optional — auto-detected)
title: My Diagram
palette: catppuccin    // override palette

// This is a comment (only // syntax — not #)
\`\`\`

Inline colors on most elements: append \`(colorname)\` — e.g. \`North(red): 850\`, \`[Process(blue)]\`.
Named colors: \`red\`, \`orange\`, \`yellow\`, \`green\`, \`blue\`, \`purple\`, \`teal\`, \`cyan\`, \`gray\`.

### sequence (most commonly used)

\`\`\`
chart: sequence
title: Auth Flow

// Participants auto-inferred, or declare explicitly:
User is an actor
API is a service
DB is a database

User -Login-> API
API -Find user-> DB
DB -user record-> API

if credentials valid
  API -200 OK + token-> User
else
  API -401 Unauthorized-> User

== Logout ==

User -Logout-> API
API -Delete session-> DB
\`\`\`

- Sync: \`A -label-> B\` · Async: \`A ~label~> B\` · Unlabeled: \`A -> B\`
- Blocks: \`if\` / \`else\`, \`loop\`, \`parallel\` — closed by indentation (no \`end\` keyword)
- Notes: \`note on API: text\` or \`note: text\`
- Sections: \`== Title ==\`
- Groups: \`[Group Name]\` with indented participants

### flowchart

\`\`\`
(Start) -> <Valid Input?>
  -yes-> [Process Data] -> (Done)
  -no-> /Get Input/ -> <Valid Input?>
\`\`\`

Shapes: \`(oval)\` \`[rect]\` \`<diamond>\` \`/parallelogram/\` \`[[subroutine]]\` \`[document~]\`

### bar / line / pie (data charts)

\`\`\`
// bar
title: Revenue by Region
series: Revenue
North: 850
South: 620

// line (multi-series)
series: Sales(red), Costs(blue)
Q1: 100, 50
Q2: 120, 55

// pie
chart: pie
labels: percent
Company A: 40
Company B: 35
\`\`\`

### er

\`\`\`
users
  id: int [pk]
  email: varchar [unique]
  1-writes-* posts

posts
  id: int [pk]
  author_id: int [fk]
\`\`\`

### org

\`\`\`
CEO
  VP Engineering
    [Platform Team]
      Lead
        Dev 1
        Dev 2
  VP Marketing
\`\`\`

### infra

\`\`\`
chart: infra
edge
  rps: 10000
  -> CDN

CDN
  cache-hit: 80%
  -> API

API
  instances: 3
  max-rps: 500
  latency-ms: 45
\`\`\`

## Anti-Patterns

\`\`\`
# comment          ❌  use // comment
async A -> B: msg  ❌  use A ~msg~> B
A <- B             ❌  left-pointing arrows removed — use B -> A
parallel else      ❌  not supported — use separate parallel blocks
== Foo(#ff0000) == ❌  hex colors not supported — use named colors: == Foo(red) ==
A -routes to /api-> B  ❌  -> inside a label is ambiguous — rephrase the label
end                ❌  not needed — indentation closes blocks in sequence diagrams
\`\`\`

## Tips

- Default theme: \`light\`, default palette: \`nord\` — ask the user their preference before a final export.
- Stdin mode for quick renders: \`echo "..." | dgmo -o out.png\`
- For C4, \`--c4-level\` drills from context → containers → components → deployment.
- When auto-detection picks the wrong chart type, add an explicit \`chart:\` directive.
- \`mcp__dgmo__preview_diagram\` accepts multiple diagrams at once — useful for showing variants side by side.
`;

const CODEX_AGENTS_CONTENT = `# DGMO Diagram Language — Codex Integration

Use dgmo tools to create, render, and share diagrams. dgmo is a text-based diagram markup language that renders to SVG/PNG.

## Quick setup

If the MCP server is not yet configured:

\`\`\`bash
dgmo --install-codex-integration
\`\`\`

This installs the MCP server and writes the dgmo config to \`.codex/config.toml\`. Restart Codex to activate.

## MCP Tools

When the \`dgmo\` MCP server is configured, use these tools directly:
- \`preview_diagram\` — renders diagram(s) and opens a live HTML preview in the browser (default for showing diagrams)
- \`render_diagram\` — renders to PNG or SVG, returns file path
- \`share_diagram\` — creates a shareable diagrammo.app URL
- \`open_in_app\` — opens diagram in Diagrammo desktop app (macOS)
- \`list_chart_types\` — lists all 32 supported chart types with descriptions
- \`get_language_reference\` — fetches full syntax for any chart type (call this before generating an unfamiliar chart type)
- \`generate_report\` — renders multiple diagrams into an HTML report with table of contents

## When to use dgmo

- Architecture diagrams, sequence diagrams, flowcharts
- Data charts (bar, line, pie, scatter, heatmap, etc.)
- ER diagrams, class diagrams, org charts
- Project roadmaps, kanban boards, timelines

## Quick syntax reference

### Sequence diagram
\`\`\`
sequence Auth Flow

User -Login-> API
API -Find user-> DB
DB -user-> API
  if valid
    API -200 OK-> User
  else
    API -401-> User
\`\`\`

### Flowchart
\`\`\`
flowchart Process

(Start) -> <Valid?>
  -yes-> [Process] -> (Done)
  -no-> /Get Input/ -> <Valid?>
\`\`\`

### Bar chart
\`\`\`
bar Revenue
series: USD

North: 850
South: 620
East: 1100
\`\`\`

### ER diagram
\`\`\`
er Schema

users
  id: int [pk]
  email: varchar [unique]

posts
  id: int [pk]
  user_id: int [fk]

users 1--* posts : writes
\`\`\`

### Org chart
\`\`\`
org

CEO
  VP Engineering
    Team Lead A
    Team Lead B
  VP Marketing
\`\`\`

### Infra chart
\`\`\`
infra

edge
  rps: 10000
  -> CDN

CDN
  cache-hit: 80%
  -> LB

LB
  -> API | split: 70%
  -> Web | split: 30%

API
  instances: 3
  max-rps: 500
  latency-ms: 45
\`\`\`

## All 31 chart types

bar, line, multi-line, area, pie, doughnut, radar, polar-area, bar-stacked, scatter, sankey, chord, function, heatmap, funnel, slope, wordcloud, arc, timeline, venn, quadrant, sequence, flowchart, state, class, er, org, kanban, c4, sitemap, infra

## Common patterns

- First line: chart type keyword (e.g. \`sequence\`, \`flowchart\`, \`bar\`) — auto-detected if unambiguous
- \`title: text\` — diagram title
- \`// comment\` — only \`//\` comments (not \`#\`)
- \`(colorname)\` — inline colors: \`Label(red): 100\`
- \`series: A(red), B(blue)\` — multi-series with colors

## Rendering via CLI

\`\`\`bash
dgmo file.dgmo -o output.svg       # SVG
dgmo file.dgmo -o url              # shareable link
dgmo file.dgmo --json              # structured JSON output
\`\`\`

## Mistakes to avoid

- Don't use \`#\` for comments — use \`//\`
- Don't use \`end\` to close sequence blocks — indentation closes them
- Don't use hex colors in section headers — use named colors
- Start the file with the chart type keyword when content is ambiguous
- Sequence arrows: \`->\` (sync), \`~>\` (async) — always left-to-right

Full reference: call \`get_language_reference\` MCP tool or visit diagrammo.app/docs
`;

function printHelp(): void {
  console.log(`Usage: dgmo <input> [options]
       cat input.dgmo | dgmo [options]
       dgmo cat <file>     Display file with syntax highlighting

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
  --tag-group <name>   Pre-select a tag group for static export coloring
  --branding           Add diagrammo.app branding to exports
  --copy               Copy URL to clipboard (only with -o url)
  --json               Output structured JSON to stdout
  --chart-types        List all supported chart types
  --install-claude-code-integration
                       Full Claude Code setup: install the /dgmo skill and configure
                       the dgmo MCP server — installs @diagrammo/dgmo-mcp if needed,
                       then writes .mcp.json (project) or ~/.claude/settings.json (global)
  --install-claude-skill  Install only the /dgmo skill to ~/.claude/commands/dgmo.md
  --install-codex-integration
                       Full Codex CLI setup: write AGENTS.md to the project and configure
                       the dgmo MCP server in .codex/config.toml (project) or ~/.codex/config.toml (global)
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
  branding: boolean;
  copy: boolean;
  json: boolean;
  chartTypes: boolean;
  cat: boolean;
  noColor: boolean;
  installClaudeSkill: boolean;
  installClaudeCodeIntegration: boolean;
  installCodexIntegration: boolean;
  c4Level: 'context' | 'containers' | 'components' | 'deployment';
  c4System: string | undefined;
  c4Container: string | undefined;
  tagGroup: string | undefined;
} {
  const result = {
    input: undefined as string | undefined,
    output: undefined as string | undefined,
    theme: 'light' as (typeof THEMES)[number],
    palette: 'nord',
    help: false,
    version: false,
    branding: false,
    copy: false,
    json: false,
    chartTypes: false,
    cat: false,
    noColor: false,
    installClaudeSkill: false,
    installClaudeCodeIntegration: false,
    installCodexIntegration: false,
    c4Level: 'context' as
      | 'context'
      | 'containers'
      | 'components'
      | 'deployment',
    c4System: undefined as string | undefined,
    c4Container: undefined as string | undefined,
    tagGroup: undefined as string | undefined,
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
      if (
        val !== 'context' &&
        val !== 'containers' &&
        val !== 'components' &&
        val !== 'deployment'
      ) {
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
    } else if (arg === '--tag-group') {
      result.tagGroup = args[++i];
      i++;
    } else if (arg === '--branding') {
      result.branding = true;
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
      'sequence',
      'activations off',
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
        console.log(desc ? `${id} — ${desc.split(' — ')[1]}` : id);
      }
    }
    return;
  }

  if (opts.cat) {
    const useColor =
      !opts.noColor && !process.env.NO_COLOR && process.stdout.isTTY === true;

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
      writeFileSync(skillPath, CLAUDE_SKILL_CONTENT, 'utf-8');
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
        (settings.mcpServers as Record<string, unknown> | undefined) ?? {};
      mcpServers['dgmo'] = mcpEntry;
      settings.mcpServers = mcpServers;
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
        (mcp.mcpServers as Record<string, unknown> | undefined) ?? {};
      mcpServers['dgmo'] = mcpEntry;
      mcp.mcpServers = mcpServers;
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
    writeFileSync(destPath, CLAUDE_SKILL_CONTENT, 'utf-8');
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
    const tomlEntry = '[mcp_servers.dgmo]\ncommand = ["dgmo-mcp"]\n';

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

    // Write AGENTS.md
    const agentsPath = join(process.cwd(), 'AGENTS.md');
    let writeAgents = true;
    if (existsSync(agentsPath)) {
      const ans = await ask('\nAGENTS.md already exists. Overwrite? [y/N] ');
      writeAgents = ans.toLowerCase() === 'y' || ans.toLowerCase() === 'yes';
    }
    if (writeAgents) {
      writeFileSync(agentsPath, CODEX_AGENTS_CONTENT, 'utf-8');
      console.log(`✓ AGENTS.md written to: ${agentsPath}`);
    } else {
      console.log('  Skipped AGENTS.md.');
    }

    console.log('\nRestart Codex to activate the MCP server.');
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
      exitWithJsonError(formatDgmoError(firstError), firstError.line);
    }
    for (const e of errors) {
      console.error(`\u2716 ${formatDgmoError(e)}`);
    }
  }

  // Validate C4 options
  if (opts.c4Level === 'containers' && !opts.c4System) {
    exitWithJsonError(
      'Error: --c4-system is required when --c4-level is containers'
    );
  }
  if (opts.c4Level === 'components') {
    if (!opts.c4System) {
      exitWithJsonError(
        'Error: --c4-system is required when --c4-level is components'
      );
    }
    if (!opts.c4Container) {
      exitWithJsonError(
        'Error: --c4-container is required when --c4-level is components'
      );
    }
  }

  const { svg } = await render(content, {
    theme: opts.theme,
    palette: opts.palette,
    branding: opts.branding,
    c4Level: opts.c4Level,
    c4System: opts.c4System,
    c4Container: opts.c4Container,
    tagGroup: opts.tagGroup,
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

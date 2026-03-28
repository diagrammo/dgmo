# dgmo — Diagrammo Diagram Assistant

You are helping the user author, render, and share diagrams using the `dgmo` CLI and `.dgmo` file format.

## What is dgmo?

`dgmo` is a CLI tool and library that renders `.dgmo` diagram files to PNG, SVG, or shareable URLs. Diagrams are written in a plain-text DSL.

## Setup Check — Run This First

**Before doing anything else**, check whether the MCP tools are available in this session by attempting to call `mcp__dgmo__list_chart_types`. If that tool exists and succeeds, skip this section entirely.

If the MCP tools are **not** available, run the setup flow below — do not ask the user, just do it:

### Step 1 — Install the CLI (if missing)

```bash
which dgmo || npm install -g @diagrammo/dgmo
```

### Step 2 — Install the MCP server (if missing)

```bash
which dgmo-mcp || npm install -g @diagrammo/dgmo-mcp
```

### Step 3 — Configure the MCP server

Ask the user:

> "Where should I configure the MCP server?
> 1) This project only — write `.mcp.json` here [default]
> 2) Globally — add to `~/.claude/settings.json` (works in all projects)"

**Option 1 (default):** Create or update `.mcp.json` in the current working directory:

```json
{
  "mcpServers": {
    "dgmo": {
      "command": "dgmo-mcp"
    }
  }
}
```

If `.mcp.json` already exists and has other servers, merge the `dgmo` entry in — do not overwrite the file.

**Option 2 (global):** Add the `dgmo` entry to the `mcpServers` object in `~/.claude/settings.json`. Read the file first and merge — do not overwrite other keys.

### Step 4 — Prompt restart

Tell the user:

> "Done. **Restart Claude Code** to activate the MCP server — diagram preview and rendering will be available in the next session."

Then proceed with the user's original request using CLI fallback (see "Other output options" below).

> **Note for future users:** To set up in one step from the terminal before starting a Claude Code session, run `dgmo --install-claude-code-integration`. It handles everything: installs `@diagrammo/dgmo-mcp`, writes the skill, and configures the MCP server.

## Getting Syntax Help

**Always use the MCP tool first** if it's available in this session:

```
mcp__dgmo__get_language_reference            // full reference
mcp__dgmo__get_language_reference("sequence") // specific chart type
```

This is the authoritative, always-up-to-date syntax reference. Use it before guessing syntax.

## Your Workflow

**Primary goal: get the user seeing a visualization as fast as possible.**

When the user asks you to create or edit a diagram:

1. **Get syntax** — call `mcp__dgmo__get_language_reference("<type>")` if you're unsure of the syntax.
2. **Write the `.dgmo` content** — compose the markup.
3. **Open in browser immediately** — call `mcp__dgmo__preview_diagram([{dgmo, title}])` without asking. This is always the right default. The browser preview includes the dgmo source collapsed at the bottom and a dark/light toggle.
4. **Save the source file** (if working in a project) — write it to `<name>.dgmo` so the user has an editable copy.

Do not ask the user how they want to view the diagram. Just open it. They can ask for other formats if they want.

### Other output options (only when explicitly requested)

| What the user wants | How to do it |
|---|---|
| **Quick look in the desktop app** | `mcp__dgmo__open_in_app(dgmo)` — opens directly in Diagrammo (macOS) |
| **View in macOS Preview** | `mcp__dgmo__render_diagram(dgmo, format:"png", theme:"dark", palette:"nord")` → get temp path → `open <path>` |
| **Save as PNG** | `mcp__dgmo__render_diagram(dgmo, format:"png", theme:"dark", palette:"nord")` → returns temp path; offer to copy to their preferred location. Or CLI: `dgmo file.dgmo -o out.png --theme dark --palette nord` |
| **Save as SVG** | `mcp__dgmo__render_diagram(dgmo, format:"svg", theme:"dark", palette:"nord")` returns SVG text — write it to the desired path. Or CLI: `dgmo file.dgmo -o out.svg --theme dark --palette nord` |
| **Shareable URL** | `mcp__dgmo__share_diagram(dgmo)` → returns a URL; immediately run `open <url>` — do NOT just display the URL |
| **Copy markup to clipboard** | Run `echo '<dgmo markup>' \| pbcopy` |

## CLI Reference

```
dgmo <input.dgmo> [options]
cat input.dgmo | dgmo [options]
```

Key options:
- `-o <file>` — output file; format inferred from extension (`.svg` → SVG, else PNG)
- `-o url` — output a shareable diagrammo.app URL
- `--theme <theme>` — `light` (default), `dark`, `transparent`
- `--palette <name>` — `nord` (default), `solarized`, `catppuccin`, `rose-pine`, `gruvbox`, `tokyo-night`, `one-dark`, `bold`
- `--copy` — copy the URL to clipboard (use with `-o url`)
- `--no-branding` — omit diagrammo.app branding from exports
- `--chart-types` — list all supported chart types

## Supported Chart Types

| Type | Use case |
|------|----------|
| `bar` | Categorical comparisons |
| `line` / `multi-line` / `area` | Trends over time |
| `pie` / `doughnut` | Part-to-whole |
| `radar` / `polar-area` | Multi-dimensional metrics |
| `bar-stacked` | Multi-series categorical |
| `scatter` | 2D data points or bubble chart |
| `sankey` | Flow / allocation |
| `chord` | Circular flow relationships |
| `function` | Mathematical expressions |
| `heatmap` | Matrix intensity |
| `funnel` | Conversion pipeline |
| `slope` | Change between two periods |
| `wordcloud` | Term frequency |
| `arc` | Network relationships |
| `timeline` | Events, eras, date ranges |
| `venn` | Set overlaps |
| `quadrant` | 2x2 positioning matrix |
| `sequence` | Message / interaction flows |
| `flowchart` | Decision trees, process flows |
| `state` | State machine / lifecycle |
| `class` | UML class hierarchies |
| `er` | Database schemas |
| `org` | Hierarchical tree structures |
| `kanban` | Task / workflow columns |
| `c4` | System architecture (context → container → component → deployment) |
| `initiative-status` | Project roadmap with dependency tracking |
| `sitemap` | Website / app navigation structure |
| `infra` | Infrastructure traffic flow with rps computation |
| `gantt` | Project scheduling with dependencies |

## Key Syntax Patterns

### Common to all diagrams

```
sequence Auth Flow     // first line: chart type + optional title
palette catppuccin     // directives are space-separated (no colon)

// This is a comment (only // syntax — not #)
```

Inline colors on most elements: append `(colorname)` — e.g. `North(red) 850`, `[Process(blue)]`.
Named colors: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `teal`, `cyan`, `gray`.

### sequence (most commonly used)

```
sequence Auth Flow

User -Login-> API
API -Find user-> DB
DB -user record-> API
note
  Indexed lookup on email column

if credentials valid
  API -200 OK + token-> User
else
  API -401 Unauthorized-> User

== Logout ==

note session cleanup
User -Logout-> API
API -Delete session-> DB
```

- Sync: `A -label-> B` · Async: `A ~label~> B` · Unlabeled: `A -> B`
- Blocks: `if` / `else`, `loop`, `parallel` — closed by indentation (no `end` keyword)
- Notes: place `note text` after a message — it naturally associates with that position.
  - Single-line: `note text`
  - Multi-line: `note` then indent continuation lines beneath it
  - Anchored: `note right of API` then indent continuation lines
- Sections: `== Title ==`
- Groups: `[Group Name]` with indented participants

### flowchart

```
(Start) -> <Valid Input?>
  -yes-> [Process Data] -> (Done)
  -no-> /Get Input/ -> <Valid Input?>
```

Shapes: `(oval)` `[rect]` `<diamond>` `/parallelogram/` `[[subroutine]]` `[document~]`

### bar / line / pie (data charts)

```
// bar
bar Revenue by Region
series Revenue
North 850
South 620

// line (multi-series)
series Sales(red), Costs(blue)
Q1 100, 50
Q2 120, 55

// pie
pie Market Share
labels percent
Company A 40
Company B 35
```

### er

```
users
  id int [pk]
  email varchar [unique]
  1-writes-* posts

posts
  id int [pk]
  author_id int [fk]
```

### org

```
CEO
  VP Engineering
    [Platform Team]
      Lead
        Dev 1
        Dev 2
  VP Marketing
```

### infra

```
infra

edge
  rps 10000
  -> CDN

CDN
  cache-hit 80%
  -> API

API
  instances 3
  max-rps 500
  latency-ms 45
```

## Anti-Patterns

```
# comment          ❌  use // comment
async A -> B: msg  ❌  use A ~msg~> B
A <- B             ❌  left-pointing arrows removed — use B -> A
parallel else      ❌  not supported — use separate parallel blocks
== Foo(#ff0000) == ❌  hex colors not supported — use named colors: == Foo(red) ==
A -routes to /api-> B  ❌  -> inside a label is ambiguous — rephrase the label
end                ❌  not needed — indentation closes blocks in sequence diagrams
chart: sequence    ❌  use `sequence Title` as the first line (no colon)
title: My Diagram  ❌  title goes on the first line after chart type
series: A, B       ❌  use `series A, B` (no colon)
Label: 100         ❌  use `Label 100` (no colon in data rows)
tag: Group         ❌  use `tag Group` (no colon)
note: text         ❌  use `note text` (no colon)
```

## Tips

- Default theme: `dark`, default palette: `nord` (nord dark mode) — use these unless the user requests otherwise.
- Stdin mode for quick renders: `echo "..." | dgmo -o out.png`
- For C4, `--c4-level` drills from context → containers → components → deployment.
- When auto-detection picks the wrong chart type, add an explicit type as the first word on the first line.
- `mcp__dgmo__preview_diagram` accepts multiple diagrams at once — useful for showing variants side by side.

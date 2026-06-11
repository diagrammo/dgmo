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

## Project Awareness

At the start of a session (or when the user first invokes `/dgmo`), scan for existing `.dgmo` files:

```bash
find . -name '*.dgmo' -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -20
```

If you find any, mention them briefly: "I see N diagrams in your project (e.g. `diagrams/auth-flow.dgmo`, `diagrams/er-schema.dgmo`). I can edit any of these or create new ones."

Don't block on this — if no files found, just proceed.

## Getting Syntax Help

**Always use the MCP tool first** if it's available in this session:

```
mcp__dgmo__get_language_reference            // full reference
mcp__dgmo__get_language_reference("sequence") // specific chart type
```

This is the authoritative, always-up-to-date syntax reference. Use it before guessing syntax.

For **examples** of real diagrams, call `mcp__dgmo__get_examples("<type>")` — these are curated gallery fixtures that show idiomatic DGMO patterns. Use them as few-shot references when generating.

## Your Workflow

**Primary goal: get the user seeing a visualization as fast as possible.**

### Creating a new diagram

1. **Pick the right chart type** — always call `mcp__dgmo__suggest_chart_type({ prompt: <user's request> })` first. It returns up to 3 ranked candidates with a confidence banner and matched trigger phrases. Use the top match unless you have a strong reason to override it. If the MCP tool is unavailable (Setup Check fallback path), run `dgmo --chart-types` in a terminal to list supported types and pick from that list.
2. **Get syntax + examples** — call `mcp__dgmo__get_language_reference("<type>")` and `mcp__dgmo__get_examples("<type>")`.
3. **Write the `.dgmo` content** — compose the markup.
4. **Validate first** — call `mcp__dgmo__validate_diagram(dgmo)` to catch syntax errors before rendering. If errors come back, fix them and validate again.
5. **Open on online.diagrammo.app** — the **default** visual output. Call `mcp__dgmo__share_diagram(dgmo)` to get a URL, then immediately run `open <url>` in the shell. This lands the user on the web editor where they see the chart AND the code side-by-side, can tweak the markup interactively, and can share the link as-is. Do NOT just print the URL — always `open` it.

   **Exception — image-output intent detected:** if the user's prompt explicitly asks for an image or saved file (phrases like "save as PNG", "export to SVG", "make an image", "render to a file", "give me a png", "I need an SVG"), skip the share URL and go straight to `mcp__dgmo__render_diagram` (see "Image output" below). The detection is intent-based, not keyword-strict — if in doubt, default to share URL and offer "Want me to save as PNG/SVG instead?"

   **Side-by-side variants** still use `mcp__dgmo__preview_diagram` (multi-diagram preview is its killer feature). See "Side-by-side variants" below.
6. **Save the source file** (if working in a project) — write it to `<name>.dgmo` so the user has an editable copy.

Do not ask the user how they want to view the diagram. Just open the share URL. They can ask for other formats if they want.

### Editing an existing diagram

When the user asks to modify a `.dgmo` file or says "update this diagram":

1. **Read the file** — use the Read tool to get the current content.
2. **Understand it** — identify the chart type, key elements, and structure.
3. **Make the change** — edit the file using the Edit tool. Preserve the user's style and organization.
4. **Validate** — call `mcp__dgmo__validate_diagram(dgmo)` on the updated content.
5. **Preview** — call `mcp__dgmo__share_diagram(dgmo)` and `open <url>` so the user sees the result on online.diagrammo.app. (Image-output intent exception applies — if the user asked for a PNG/SVG file explicitly, render to file instead.)

Keep the diff minimal — don't rewrite the whole file when adding one element.

### Diagramming from code

When the user says "diagram this", "diagram this file", or "show me how X works":

1. **Read the relevant source code** — the file, function, or module they're pointing at.
2. **Choose the best diagram type** based on what the code does:
   - API handler / controller → `sequence` showing the request flow
   - Database models / ORM entities → `er` showing relationships
   - State machine / status enum → `state` showing transitions
   - Module imports / service dependencies → `c4` or `flowchart`
   - Infrastructure config (Docker, k8s, terraform) → `infra`
3. **Extract real names** — use actual function names, service names, model names from the code.
4. **Generate, validate, preview** — same as creating a new diagram.

### Error recovery

When `validate_diagram` or `render_diagram` returns errors:

1. **Read the error messages** — they include line numbers and descriptions.
2. **Fix the specific issues** — don't regenerate from scratch unless there are many errors.
3. **Validate again** — loop until clean.
4. **Then render** — only call `share_diagram` (default), `preview_diagram` (variants), or `render_diagram` (files) after validation passes.

Common fixes:
- "Unknown directive" → check spelling, remove colons from directives
- "Expected number" → data rows use spaces not colons: `Label 100` not `Label: 100`
- Duplicate name → parentheses strip color from display name; `App (TS)` and `App (Rust)` both become `App`

### Side-by-side variants

When the user asks to compare layouts, themes, or approaches:

```
mcp__dgmo__preview_diagram([
  { title: "Option A — Detailed", dgmo: "..." },
  { title: "Option B — Simplified", dgmo: "..." }
])
```

This opens a single page with both diagrams. Use this for:
- Light vs dark theme comparisons
- Different levels of detail
- Alternative structures for the same data

### Image output (when the user explicitly asks for an image/file)

Trigger phrases: "save as PNG", "export to SVG", "make an image", "render to a file", "give me a PNG", "I need an SVG", "generate an image". For these, skip the share URL and go straight to file output:

| Intent | How to do it |
|---|---|
| **Save as PNG** | `mcp__dgmo__render_diagram(dgmo, format:"png", theme:"dark", palette:"nord")` → returns temp path; offer to copy to their preferred location. Or CLI: `dgmo file.dgmo -o out.png --theme dark --palette nord` |
| **Save as SVG** | `mcp__dgmo__render_diagram(dgmo, format:"svg", theme:"dark", palette:"nord")` returns SVG text — write it to the desired path. Or CLI: `dgmo file.dgmo -o out.svg --theme dark --palette nord` |
| **View in macOS Preview** | `mcp__dgmo__render_diagram(dgmo, format:"png", theme:"dark", palette:"nord")` → get temp path → `open <path>` |

### Other output options (when explicitly requested)

| What the user wants | How to do it |
|---|---|
| **Quick look in the desktop app** | `mcp__dgmo__open_in_app(dgmo)` — opens directly in Diagrammo (macOS) |
| **Local HTML preview (not online.diagrammo.app)** | `mcp__dgmo__preview_diagram([{dgmo, title}])` — useful when the user specifically wants a local file or is offline |
| **Copy markup to clipboard** | Run `echo '<dgmo markup>' \| pbcopy` |

(The share URL — `mcp__dgmo__share_diagram` + `open` — is the DEFAULT visual output, not an alternative. See "Creating a new diagram → step 5" above.)

### Embedding diagrams in docs

When the user wants a diagram in a README, PR description, or markdown file:

1. **Generate a share URL** — `mcp__dgmo__share_diagram(dgmo)` returns a `diagrammo.app` URL.
2. **Render a PNG** — `mcp__dgmo__render_diagram(dgmo, format:"png", theme:"light", palette:"nord")` returns a temp path.
3. **Insert into markdown** — either:
   - Copy the PNG to the project (e.g. `docs/images/auth-flow.png`) and reference it: `![Auth Flow](docs/images/auth-flow.png)`
   - Use the share URL directly: `![Auth Flow](https://diagrammo.app/d#...)`
4. **For PRs** — prefer share URLs (no binary file to commit). For README/docs — prefer committed PNGs (they work offline).

Always generate both light and dark variants if the doc will be viewed in both modes, or use `theme:"transparent"` for universal backgrounds.

### Batch rendering

When the user asks to render all diagrams in a directory:

```bash
for f in diagrams/*.dgmo; do dgmo "$f" -o "${f%.dgmo}.png" --theme dark --palette nord; done
```

Or for SVG: replace `.png` with `.svg` in the output.

### Share link to clipboard (when the user asks for the URL without opening)

If the user wants the link in clipboard rather than opened (e.g., they want to paste it into Slack themselves), after generating the share link:

```bash
echo '<url>' | pbcopy
```

Then tell the user it's been copied. Otherwise, the default is always `open <url>` — that's what step 5 of the main workflow does.

## CLI Reference

```
dgmo <input.dgmo> [options]
cat input.dgmo | dgmo [options]
```

Key options:
- `-o <file>` — output file; format inferred from extension (`.svg` → SVG, else PNG)
- `-o url` — output a shareable diagrammo.app URL
- `--theme <theme>` — `light` (default), `dark`, `transparent`
- `--palette <name>` — `slate` (default), `atlas`, `blueprint`, `catppuccin`, `nord`, `tidewater`, `tokyo-night`
- `--copy` — copy the URL to clipboard (use with `-o url`)
- `--chart-types` — list all supported chart types

## Supported Chart Types

Call `mcp__dgmo__list_chart_types` to see every supported type with descriptions, or `dgmo --chart-types` in a terminal as a CLI fallback. When picking for a new diagram, use `mcp__dgmo__suggest_chart_type` — it scores the full list against the user's prompt (see "Creating a new diagram → step 1").

## Key Syntax Patterns

### Common to all diagrams

```
sequence Auth Flow     // first line: chart type + optional title
palette catppuccin     // directives are space-separated (no colon)

// This is a comment (only // syntax — not #)
```

Inline colors on most elements: append `(colorname)` — e.g. `North(red) 850`, `[Process(blue)]`.
Named colors: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `teal`, `cyan`, `gray`.

### Per-chart-type syntax

For every specific chart type (sequence, flowchart, bar/line/pie, scatter, er, org, infra, slope, timeline, gantt, c4, class, venn, quadrant, sankey/chord, state, boxes-and-lines, and the rest), do not guess from prior knowledge — call the MCP tools:

```
mcp__dgmo__get_language_reference("<type>")   // authoritative grammar + directives
mcp__dgmo__get_examples("<type>")             // real starter templates from the gallery
```

Both ship inside `@diagrammo/dgmo` and always reflect the installed version, so they never drift from the actual parsers. This replaces the per-type sections that used to live here and went stale every time a chart type's syntax evolved.

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

**Data-chart style (back-compat tolerated, but not idiomatic — don't generate these):**

```
Q1 100, 200, 300                     ⚠  prefer space-separated: `Q1 100 200 300`
series A (red), B (blue), C (green)  ⚠  for ≥2 series, prefer the indented block:
                                         series
                                           A (red)
                                           B (blue)
                                           C (green)
```

## Tips

- Default palette: `slate` — use it unless the user requests otherwise.
- Always validate before rendering — `validate_diagram` is much faster than a failed render.
- Always call `get_examples` before generating an unfamiliar chart type — real examples beat guessing.
- Stdin mode for quick renders: `echo "..." | dgmo -o out.png`
- When auto-detection picks the wrong chart type, add an explicit type as the first word on the first line.
- `mcp__dgmo__preview_diagram` accepts multiple diagrams at once — useful for showing variants side by side.
- When the user says "diagram this" while looking at code, read the code first and pick the chart type yourself — don't ask.

## Related Commands

Tell the user about these when relevant:

- **`/dgmo-diagram-this`** — Point it at a file, function, or module and it generates the right diagram from the code. Use when the user says "diagram this" or "how does this work?"
- **`/dgmo-document-project`** — Scans the entire codebase and generates a suite of 3–6 architecture diagrams (C4, sequence, ER, infra) as an HTML report. Use when the user wants project documentation.

## AI Integrations Beyond Claude Code

DGMO works with other AI tools too. If the user asks about using Diagrammo with other editors or AI assistants, point them to **https://diagrammo.app/ai** which covers:

- **Cursor** — `.cursorrules` file provides DGMO syntax context to the AI
- **Windsurf** — `.windsurfrules` file works the same way with Cascade
- **GitHub Copilot** — `.github/copilot-instructions.md` teaches Copilot the syntax
- **OpenAI Codex CLI** — `AGENTS.md` + `.codex/config.toml` configuration

These context files are already included in the `@diagrammo/dgmo` npm package. For any project using dgmo as a dependency, the AI tool picks them up automatically.

The MCP server (`@diagrammo/dgmo-mcp`) also works with **Claude Desktop** and any MCP-compatible client — not just Claude Code.

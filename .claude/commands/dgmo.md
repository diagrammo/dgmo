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

### Step 2 — Run the one-step installer

```bash
dgmo install claude-code
```

That single command writes this skill, configures the MCP server in `~/.claude/settings.json` (entry: `{ "command": "dgmo", "args": ["mcp"] }`), and ensures the server is available — no prompts, no separate `dgmo-mcp` package to install. (Use `--scope project` to write `.mcp.json` in the current directory instead of the global settings.)

### Step 3 — Prompt restart

Tell the user:

> "Done. **Restart Claude Code** to activate the MCP server — diagram preview and rendering will be available in the next session."

Then proceed with the user's original request using CLI fallback (see "Other output options" below).

> **One-step from a fresh machine:** `dgmo install` with no target auto-detects and sets up every AI assistant you have (Claude Code, Codex, Claude Desktop, Cursor, Windsurf, Copilot) at once.

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

**Primary goal: get the user seeing a visualization as fast as possible — in the desktop app if they have it, otherwise on the web.**

### Where the diagram goes — decide this once per session

Before showing the first diagram, call `mcp__dgmo__check_app_installed()` **once** and remember the answer for the rest of the session. It decides your default visual output:

- **App installed → open the saved file live in the app.** Save the `.dgmo` source first (see "Always save the source"), then `mcp__dgmo__open_in_app({ dgmo, filePath: "<absolute path to the saved file>" })`. The app opens *that file*, so the user edits it in the app and changes autosave back to the same file — one source of truth, live re-render. Do NOT open an online URL and do NOT render a PNG.
- **App not installed → open the online editor.** `mcp__dgmo__share_diagram(dgmo)` then `open <url>` in the shell. This lands the user on online.diagrammo.app with the chart and the code side-by-side, tweakable and shareable. Don't just print the URL — always `open` it.

**Always save the source.** Whether or not the app is installed, write the diagram to `<name>.dgmo` in the current project/working directory so the user always has one editable artifact. Use a short kebab-case name from the diagram's title (e.g. `checkout-flow.dgmo`). This file IS the deliverable; the app or URL just displays it.

**Never render an image unless the user explicitly asks** (see "Image output"). A PNG/SVG is not a default output — don't create files the user didn't request.

Don't ask the user how they want to view the diagram — the check above decides it. They can ask for a PNG, the desktop app, or a share URL explicitly if they want something else.

### Creating a new diagram

1. **Pick the right chart type** — always call `mcp__dgmo__suggest_chart_type({ prompt: <user's request> })` first. It returns up to 3 ranked candidates with a confidence banner and matched trigger phrases. Use the top match unless you have a strong reason to override it. If the MCP tool is unavailable (Setup Check fallback path), run `dgmo types` in a terminal and pick from that list — do not pick from memory or assume a requested type is unsupported (see "Supported Chart Types" below).
2. **Get syntax + examples** — call `mcp__dgmo__get_language_reference("<type>")` and `mcp__dgmo__get_examples("<type>")`.
3. **Write the `.dgmo` content** — compose the markup.
4. **Validate first** — call `mcp__dgmo__validate_diagram(dgmo)` to catch syntax errors before rendering. If errors come back, fix them and validate again.
5. **Save the source** — write the validated markup to `<name>.dgmo` in the working directory.
6. **Show it** — per "Where the diagram goes": app installed → `mcp__dgmo__open_in_app({ dgmo, filePath })`; not installed → `mcp__dgmo__share_diagram(dgmo)` + `open <url>`.

**Exception — image-output intent detected:** if the user's prompt explicitly asks for an image or saved file (phrases like "save as PNG", "export to SVG", "make an image", "render to a file", "give me a png", "I need an SVG"), still save the `.dgmo` source, then go to `mcp__dgmo__render_diagram` (see "Image output") instead of step 6. Detection is intent-based — if in doubt, use the step-6 default and offer "Want me to save as PNG/SVG instead?"

**Side-by-side variants** use `mcp__dgmo__preview_diagram` (multi-diagram preview is its killer feature). See "Side-by-side variants" below.

### Editing an existing diagram

When the user asks to modify a `.dgmo` file or says "update this diagram":

1. **Read the file** — use the Read tool to get the current content.
2. **Understand it** — identify the chart type, key elements, and structure.
3. **Make the change** — edit the file using the Edit tool. Preserve the user's style and organization.
4. **Validate** — call `mcp__dgmo__validate_diagram(dgmo)` on the updated content.
5. **Show it** — per "Where the diagram goes": app installed → `mcp__dgmo__open_in_app({ dgmo, filePath: "<the file you just edited>" })` so it re-renders live in the app; not installed → `mcp__dgmo__share_diagram(dgmo)` + `open <url>`. (Image-output exception applies — if the user asked for a PNG/SVG file explicitly, render to file instead.)

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
| **Open in the desktop app (no saved file)** | `mcp__dgmo__open_in_app({ dgmo })` — deep-links an ephemeral copy into Diagrammo. Prefer the `filePath` form (open the saved file) whenever you've saved the source. |
| **Force the online editor even though the app is installed** | `mcp__dgmo__share_diagram(dgmo)` + `open <url>` |
| **Local HTML preview (not online.diagrammo.app)** | `mcp__dgmo__preview_diagram([{dgmo, title}])` — useful when the user specifically wants a local file or is offline |
| **Copy markup to clipboard** | Run `echo '<dgmo markup>' \| pbcopy` |

(The default visual output is decided by `check_app_installed` — open the saved file in the app when installed, otherwise the online share URL. See "Where the diagram goes" above. The options here are for when the user explicitly asks for something else.)

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

Then tell the user it's been copied. Otherwise, the default visual output is the app-aware behavior from "Where the diagram goes" (open the saved file in the app when installed, else `open <url>`).

## CLI Reference

```
dgmo <input.dgmo> [options]
cat input.dgmo | dgmo [options]
dgmo share <input.dgmo>          # shareable diagrammo.app URL (copies to clipboard)
dgmo types                       # list all supported chart types
```

Key options:
- `-o <file>` — output file; format inferred from extension (`.svg` → SVG, else PNG)
- `--theme <theme>` — `light` (default), `dark`, `transparent`
- `--palette <name>` — `slate` (default), `atlas`, `blueprint`, `catppuccin`, `nord`, `tidewater`, `tokyo-night`
- `--json` — output structured JSON

## Supported Chart Types

**There are ~45 chart types. The authoritative, complete list comes ONLY from the live tool — never from memory and never from any prose list in this skill.** Any chart types named elsewhere in this document (in examples, tips, or the "diagram this" table) are illustrative, NOT the full set. dgmo supports many specialized types people don't expect — including `journey-map`, `mindmap`, `pert`, `raci`, `pyramid`, `wireframe`, `ring`, `tech-radar`, `cycle`, and more.

**Hard rule:** before telling the user a chart type "doesn't exist," isn't supported, or that you'll use "the closest fit instead" — you MUST first query the live list:

- MCP active: `mcp__dgmo__list_chart_types` (full list + descriptions), and `mcp__dgmo__suggest_chart_type({ prompt })` to pick.
- MCP unavailable: run `dgmo types` in a terminal.

If the user asks for a named visualization (e.g. "user journey", "mind map", "RACI matrix"), assume dgmo supports it and verify against the live list — do not substitute a different type unless the list confirms the requested one is genuinely absent.

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

- Output target: call `mcp__dgmo__check_app_installed()` once per session. App installed → save the `.dgmo` and open that file live in the app (`open_in_app` with `filePath`); not installed → online share URL. Always save the source either way; never render a PNG unless asked.
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

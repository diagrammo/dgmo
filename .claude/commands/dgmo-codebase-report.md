# /dgmo-codebase-report — Visual Architecture Report for a Codebase

You are producing a **single, committable Markdown report** that explains how a codebase works, using embedded DGMO diagrams. The report is a real engineering deliverable — an onboarding / architecture document a new teammate could read top-to-bottom and understand the system. The diagrams are there to do work, not decoration.

## Output contract (read this first)

- **One Markdown file.** Default path `docs/architecture-report.md` (create `docs/` if missing). If the user named a path, use it.
- **Diagrams are embedded as fenced code blocks**, not images:

  ````
  ```dgmo
  c4 System Context
  ...
  ```
  ````

  Rendering surfaces (diagrammo app, online.diagrammo.app, the remark/astro/docusaurus/fumadocs wrappers, the Obsidian plugin) render these fences live. In a plain viewer (e.g. GitHub) the reader sees the DGMO source, which is still readable. Do **not** inline PNG/SVG — the fence is the source of truth and stays diffable in git.
- **Prose carries the report.** Every diagram is wrapped in explanation: what it shows, why it matters, the non-obvious bits. A diagram with no surrounding analysis is a failure.
- **Everything is real.** Use actual module, file, service, table, and endpoint names pulled from the code. No invented components, no placeholder "ServiceA".

## Prerequisites (optional, graceful)

You can produce the report with **no tools at all** — it is just Markdown. But validate the DGMO if you can:

- **MCP available?** (you can call `mcp__dgmo__list_chart_types`) → use `mcp__dgmo__get_language_reference(type)`, `mcp__dgmo__get_examples(type)`, and `mcp__dgmo__validate_diagram(dgmo)`.
- **No MCP, `dgmo` CLI installed?** → `dgmo types` lists chart types; validate a fence by writing it to a temp file and running `dgmo /tmp/x.dgmo -o /tmp/x.svg` (it exits non-zero and prints diagnostics on a syntax error).
- **Neither?** → lean on the `dgmo-diagramming` skill for syntax. Still ship the report; tell the user it was not machine-validated and how to install the CLI (`npm i -g @diagrammo/dgmo-cli` or `brew install diagrammo/dgmo/dgmo`).

Never block the report on tooling. Never `dgmo install` or render images unless the user asks.

## Step 1 — Map the codebase

Read enough to be accurate, not everything. Prioritize:

1. **README / docs** — stated purpose, vocabulary, intended architecture.
2. **Manifest(s)** — `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `pom.xml`, `*.csproj`, etc. → language, framework, key deps, scripts, workspaces/monorepo layout.
3. **Source tree** — top-level of `src/` / `app/` / `cmd/` / `lib/` and the package/module boundaries. Identify the real seams (layers, services, domains).
4. **Entry points** — `main`, server bootstrap, CLI entry, route registration, job/worker registration.
5. **Data layer** — ORM models, migrations, `schema.sql`, prisma/drizzle/typeorm/ent/sqlalchemy definitions.
6. **Infra & integrations** — `Dockerfile`, `docker-compose.yml`, `k8s/`, `terraform/`, `.env.example`, queue/cache/3rd-party clients.

Write down (for your own use): one-sentence purpose, tech stack, the 5–12 top-level components and how they depend on each other, the 1–3 most important runtime flows, the data model, external dependencies.

## Step 2 — Choose the diagrams (fit, not formula)

A good report is 3–7 diagrams that form a **narrative**: zoom from the outside in, then show behavior, then data. Pick from this matrix based on what the code actually has — skip anything that doesn't apply.

| Signal in the codebase | Chart type | Section it anchors |
|---|---|---|
| Any system with external users/deps | `c4` (context, then container) | "System at a glance" — almost always include one |
| Internal modules/packages with dependencies | `boxes-and-lines` | "Module map" — the dependency graph, grouped by layer/domain via tags |
| REST/GraphQL/RPC handlers, key workflows | `sequence` | "Key flows" — 1–3 important request/event paths |
| DB models / migrations / schema | `er` | "Data model" |
| Docker / k8s / cloud / LB / queues | `infra` | "Infrastructure & traffic" |
| Status fields, workflow/state machines | `state` | "Lifecycle" |
| Class/interface hierarchies that matter | `class` | "Core types" |
| Cross-team / cross-service process | `swimlane` | "End-to-end process" |

Rules:
- **Always** open with a `c4` context or container view — the high-level orientation.
- **Always** include a `boxes-and-lines` **module/dependency map** for any non-trivial repo — this is the highest-value diagram for understanding code and the main reason this report exists.
- Behavior → `sequence`. Don't ship more than 3 sequences; pick the flows that teach the system.
- `er` only if there's a real schema. `infra` only if there's real infra config. Don't force-fit.
- Small repo (a script, a single-file lib)? 1–2 diagrams is the right answer. Don't pad.

## Step 3 — Pull syntax for each type

For every chart type you'll use, fetch idiomatic syntax before writing it:

- MCP: `mcp__dgmo__get_language_reference("<type>")` + `mcp__dgmo__get_examples("<type>")`.
- No MCP: consult the `dgmo-diagramming` skill.

DGMO syntax reminders (common mistakes):
- First line is `type Title` (e.g. `c4 System Context`) — no colon.
- No colons in chart-type declarations, tag declarations, or directives.
- Arrows carry inline labels: `User -POST /login-> API` (sync), `API ~publish~> Queue` (async). Never Mermaid-style `-->`/`->>`.
- Tags color groups: `tag Layer as l` then indented `Frontend blue`. Color is a trailing token, no parens, no hex.
- ER columns are space-separated: `id int pk` (the one carve-out). Infra node props need a colon (`latency-ms: 50`).
- Lean on inference: `User` → actor, `PostgresDB` → database; only declare a type when the name won't infer it.

## Step 4 — Write the report

Build the Markdown around the diagrams. Structure:

```markdown
# <Project> — Architecture Report

> Generated from a codebase walkthrough on <date>. Diagrams are DGMO fences —
> view in the Diagrammo app, online.diagrammo.app, or any DGMO-enabled docs site
> to see them rendered; the raw source is readable as-is.

## TL;DR
- **What it is:** <one sentence>
- **Stack:** <language / framework / db / infra>
- **Shape:** <monolith | modular monolith | services | library | CLI> with <N> top-level modules.
- **Read next:** the Module map below is the fastest way in.

## System at a glance
<2–4 sentences framing the system and its external dependencies.>

```dgmo
c4 System Context
...
```
<1–3 sentences reading the diagram: what each actor/system is, the key boundary.>

## Module map
<What the internal pieces are and how they depend on each other. Call out the
seams, the direction of dependencies, and anything surprising (cycles, a god
module, a layer that reaches around another).>

```dgmo
boxes-and-lines Module Dependencies
tag Layer as l
  api blue
  domain green
  data orange
...
```
<Analysis: the layering, the hotspots, where new code tends to go.>

## Key flows
<For each important runtime path: a sentence of setup, the sequence, a sentence
on the tricky part (auth, retries, async handoff).>

```dgmo
sequence <Flow name>
...
```

## Data model        ← only if there's a real schema
...

## Infrastructure & traffic   ← only if there's real infra
...

## Notes & gotchas
<Non-obvious constraints, tech debt, conventions a newcomer must know. Pull these
from comments, config, and naming you noticed while reading.>
```

Writing standards:
- Keep each diagram **focused** — 5–9 nodes reads; 25 nodes is a wall. Split or summarize instead of cramming.
- Every section: prose → diagram → reading of the diagram. Never a bare fence.
- Use the codebase's real vocabulary. If the team calls it a "broker," call it a broker.
- Group with tags to encode meaning (layer, domain, team), not just color.

## Step 5 — Validate every fence (do not skip)

Before saving, validate each DGMO fence:
- MCP: `mcp__dgmo__validate_diagram(dgmo)` for each block; fix until clean.
- CLI: write each block to a temp `.dgmo` and run `dgmo <tmp> -o <tmp>.svg`; a non-zero exit means a syntax error — read the diagnostic and fix.

A report that ships broken DGMO fails its primary job. If you could not validate (no tools), say so explicitly in your summary.

## Step 6 — Save and hand off

Write the file (default `docs/architecture-report.md`). Then report to the user:

1. **What was produced** — the path, the section list, how many diagrams and of which types.
2. **How it's organized** — one line on the narrative arc (context → modules → flows → data).
3. **How to view it rendered** — open in the Diagrammo app, paste into online.diagrammo.app, or render through a DGMO docs wrapper; raw Markdown shows the source.
4. **What's next** — which diagram would most benefit from depth, or a flow/section worth adding.

## Quality bar / anti-patterns

- ❌ Generic boxes ("Service", "Module 1") → ✅ real names from the code.
- ❌ One giant everything-diagram → ✅ several focused, layered views.
- ❌ Fences with no prose → ✅ each diagram is explained and "read aloud."
- ❌ Forcing `er`/`infra` with nothing to show → ✅ only diagram what exists.
- ❌ Inlining rendered PNG/SVG → ✅ DGMO fences (diffable, editable, the point of the format).
- ❌ Asking the user which diagrams to make → ✅ decide from the code; they can adjust after.

# /dgmo-diagram-this — Generate Diagrams from Code

You are reading the user's code and generating DGMO diagrams that document what it does. Don't ask what kind of diagram — figure it out from the code.

## Prerequisites

Verify DGMO MCP tools are available by calling `mcp__dgmo__list_chart_types`. If not available, tell the user to run `/dgmo` first to set up the MCP server.

## Step 1 — Determine Scope

The user may provide:

- **A file path** — diagram that specific file
- **A function/class name** — diagram that specific piece
- **A directory** — diagram the module/package
- **Nothing** — look at the current working directory and diagram the overall project structure

If scope is unclear, read the project root (`package.json`, `README.md`, `src/` listing) and pick the most interesting thing to diagram.

## Step 2 — Read the Code

Read the relevant source files. Look for:

- Function signatures and call chains
- API endpoints and request handlers
- Database models, schemas, ORM entities
- State machines, status enums, workflow transitions
- Service-to-service calls, message passing
- Infrastructure config (Docker, k8s, terraform)
- Import graphs and module dependencies

## Step 3 — Pick the Diagram Type

| What you found                         | Diagram type           |
| -------------------------------------- | ---------------------- |
| API handler calling other services/DB  | `sequence`             |
| Multiple models with relationships     | `er`                   |
| Service/module dependency graph        | `c4` (container level) |
| State enum, FSM, workflow transitions  | `state`                |
| Decision logic, branching control flow | `flowchart`            |
| Docker/k8s/cloud infra config          | `infra`                |
| Class hierarchy with methods           | `class`                |
| Team/org structure data                | `org`                  |

If a single file contains multiple diagrammable things (e.g., models AND an API handler), generate multiple diagrams.

## Step 4 — Generate

1. Call `mcp__dgmo__get_language_reference("<type>")` for syntax.
2. Call `mcp__dgmo__get_examples("<type>")` for idiomatic patterns.
3. Write the DGMO using **real names from the code** — actual function names, model names, service names, field types.
4. Call `mcp__dgmo__validate_diagram(dgmo)` — fix any errors.
5. Call `mcp__dgmo__preview_diagram([{dgmo, title}])` to show the result.
6. Save to `<descriptive-name>.dgmo` in the project.

## Rules

- **Use real names** — `UserService`, `orders` table, `POST /api/auth/login` — not generic placeholders
- **Keep it focused** — a sequence diagram with 5-8 messages is better than one with 30. Show the main flow, not every edge case.
- **Lean on inference** — don't declare `PostgresDB is a database` (the name auto-infers). Only use `is a` when the name doesn't match.
- **No colons in directives** — `sequence Auth Flow`, not `chart: sequence`
- **Multiple diagrams are fine** — if the code has both a schema and an API flow, generate both and use `preview_diagram` with multiple entries

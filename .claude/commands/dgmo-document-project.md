# /dgmo-document-project — Generate Diagrams for a Codebase

You are generating a suite of DGMO diagrams that document the user's project. Your goal is to read the codebase, understand its architecture, and produce 3–6 diagrams that capture how the system works.

## Prerequisites

Before starting, verify that the DGMO MCP tools are available by calling `mcp__dgmo__list_chart_types`. If the tools are not available, tell the user to run `/dgmo` first to set up the MCP server, then come back to this command.

## Step 1 — Understand the Project

Read these files (skip any that don't exist):

1. **README.md** or **README** — project purpose and overview
2. **package.json** / **Cargo.toml** / **go.mod** / **pyproject.toml** / **requirements.txt** — tech stack and dependencies
3. **docker-compose.yml** / **Dockerfile** / **k8s/** / **terraform/** — infrastructure
4. **src/** or **app/** directory listing — code structure
5. **.env.example** or config files — external services and integrations

From this, determine:
- What the project does (one sentence)
- The tech stack (language, framework, database, message broker, etc.)
- Key modules or services
- External dependencies and integrations
- Data models (if database-backed)

## Step 2 — Decide Which Diagrams to Generate

Pick 3–6 diagrams based on what the project actually has. Don't force a diagram type that doesn't fit. Use this decision matrix:

| Signal in codebase | Diagram type | What to show |
|---|---|---|
| Multiple services, APIs, or modules | **c4** (context or container) | System components and their relationships |
| REST/GraphQL endpoints, API handlers | **sequence** | 1–2 key request flows (e.g., auth, main business operation) |
| Database models, ORM entities, schema files | **er** | Entity relationships and key fields |
| Docker, k8s, cloud infra, load balancers | **infra** | Traffic flow and infrastructure components |
| State machines, workflow engines, status fields | **state** | Key state transitions |
| Multiple packages or layers | **flowchart** | Request lifecycle or data flow |
| Microservices with message queues | **sequence** | Async event flow between services |

**Rules:**
- Always include a C4 context or container diagram — every project benefits from a high-level view
- Prefer sequence diagrams for showing **behavior** (how things interact at runtime)
- Prefer ER diagrams only if there's a real database schema to document
- Don't generate infra diagrams for projects without infrastructure config
- Don't generate more than 2 sequence diagrams — pick the most important flows

## Step 3 — Get Syntax Help

For each diagram type you'll generate, call:

```
mcp__dgmo__get_language_reference("<type>")
```

Also call `mcp__dgmo__get_examples("<type>")` to see real examples of that chart type. Use these as patterns — they show idiomatic DGMO style.

## Step 4 — Generate the Diagrams

Write the DGMO markup for each diagram. Follow these rules:

- **Keep diagrams focused** — a C4 diagram with 5–8 components is better than one with 20
- **Use real names from the codebase** — actual service names, model names, endpoint paths
- **Lean on inference** — don't declare participant types unless the name doesn't match (e.g., `User` auto-infers as actor, `PostgresDB` as database)
- **Add tags for color coding** when there are natural groupings (teams, domains, layers)
- **Title every diagram** — the title goes on the first line after the chart type

### Syntax reminders (no colons in directives or data):
```
sequence Auth Flow          // first line: type + title
tag Layer as l              // tag declaration (use `as`)
  Frontend blue             // color is trailing token (no parens)
  Backend green

User -POST /login-> API     // sync arrow
API ~publish~> Queue        // async arrow
note Validates JWT          // note (no colon)
```

## Step 5 — Validate Before Rendering

For each diagram, call `mcp__dgmo__validate_diagram(dgmo)` to check for errors. Fix any issues before proceeding.

## Step 6 — Generate the Report

Once all diagrams validate, bundle them into a report:

```
mcp__dgmo__generate_report({
  title: "<Project Name> — Architecture Diagrams",
  subtitle: "Auto-generated from codebase analysis",
  sections: [
    { title: "System Context (C4)", description: "High-level view of ...", dgmo: "..." },
    { title: "Auth Flow", description: "How authentication works", dgmo: "..." },
    ...
  ],
  theme: "dark",
  palette: "slate",
  include_source: true,
  open: true
})
```

## Step 7 — Save Source Files

Write each diagram to a `diagrams/` directory in the project root:

- `diagrams/c4-context.dgmo`
- `diagrams/sequence-auth.dgmo`
- `diagrams/er-schema.dgmo`
- etc.

Use descriptive filenames. Create the `diagrams/` directory if it doesn't exist.

## Step 8 — Report to the User

Summarize what was generated:

1. List each diagram with a one-line description
2. Mention the HTML report was opened in the browser
3. Note the saved `.dgmo` files in `diagrams/`
4. Suggest which diagrams might be worth expanding or adding next

## Important Notes

- This skill works with **any** project — not just TypeScript or JavaScript
- Don't ask the user what diagrams to generate — make the decision based on what you find in the code. They can request changes after.
- If the project is very small (single file, script), generate just 1–2 diagrams instead of forcing 6
- If you can't determine the project structure, ask the user to point you at the main source directory

---
name: dgmo-sequence
description: Generate a DGMO sequence diagram by analyzing a code flow, API interaction, or process description.
argument-hint: <flow or module to diagram>
allowed-tools: Read, Write, Bash, Glob, Grep
---

# Generate DGMO Sequence Diagram

Analyze a code flow, API interaction, or process and generate a `.dgmo` sequence diagram.

## Instructions

1. Understand what to diagram from `$ARGUMENTS` — this could be:
   - A description of an interaction ("the login flow")
   - A reference to code ("trace the checkout process in src/")
   - An API flow ("POST /orders end-to-end")
2. If referencing code, explore the codebase to trace the actual flow
3. Generate a valid DGMO sequence diagram

## Sequence Diagram Syntax

```
chart: sequence
title: Flow Title

// Participant declarations (optional — auto-inferred from messages)
User is an actor
API is a service
DB is a database
Queue is a queue

// Messages
User -Login-> API
API -Find user-> DB
DB -> API: <- user record

// Async messages
API ~event~> Queue

// Notes
note on DB:
  Indexed lookup on email column

// Conditional blocks (indentation-scoped, no "end" needed)
  if credentials valid
    API -> User: <- 200 OK
  else
    API -> User: <- 401 Unauthorized

// Loops
  loop retry 3 times
    API -> ExternalService: request

// Sections (phase dividers)
== Phase 2 ==

// Visual groups
## Authentication
```

**Participant types**: `actor`, `service`, `database`, `queue`, `cache`, `gateway`, `external`, `networking`, `frontend`

**Arrow types**:
- Sync: `A -> B: label` or `A -label-> B`
- Async: `A ~> B: label` or `A ~label~> B`
- Return: `B -> A: <- response`
- Bidirectional: `A <-> B: label`

**Key rules**:
- Indentation closes blocks (no `end` keyword)
- Use `//` for comments (not `#`)
- `aka` for display names: `PaymentGW aka Payment Gateway`
- `at position N` for ordering: `DB at position 3`

## Output

Write to a descriptive `.dgmo` file, then check if `dgmo` CLI is available (`command -v dgmo`). If not installed, tell the user:
- `brew install diagrammo/dgmo/dgmo` (macOS, recommended)
- `npm install -g @diagrammo/dgmo`
- Or: `npx @diagrammo/dgmo <file>.dgmo`

If available, offer to render: `dgmo <file>.dgmo -o <file>.svg` or `dgmo <file>.dgmo -o url`

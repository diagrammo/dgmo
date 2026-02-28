---
name: dgmo-flowchart
description: Generate a DGMO flowchart from a process description, decision tree, or code logic.
argument-hint: <process or logic to diagram>
allowed-tools: Read, Write, Bash, Glob, Grep
---

# Generate DGMO Flowchart

Analyze a process, decision tree, or code logic and generate a `.dgmo` flowchart.

## Instructions

1. Understand the process from `$ARGUMENTS`
2. If referencing code, explore the codebase to understand the logic
3. Generate a valid DGMO flowchart

## Flowchart Syntax

```
chart: flowchart
title: Process Name

(Start) -> <Decision?>
  -yes-> [Process A] -> [[Subroutine]]
  -no-> /Get Input/ -> <Decision?>
[[Subroutine]] -> [Document~] -> (Done)
```

**Node shapes**:
- `(Terminal)` — oval (start/end)
- `[Process]` — rectangle
- `<Decision?>` — diamond
- `/Input Output/` — parallelogram
- `[[Subroutine]]` — double-bordered rectangle
- `[Document~]` — document shape (wavy bottom, note the `~`)

**Arrows**:
- `-label-> Target` — labeled connection
- `-yes->`, `-no->` — decision branches
- `-(red)-> Target` — colored arrow
- `-label(red)-> Target` — labeled + colored

**Colors**: Append `(colorname)` to nodes: `[Process(blue)]`

**Chaining**: Multiple nodes on one line: `(Start) -> [A] -> [B] -> (End)`

**Key rules**:
- Use indentation for decision branches
- Each decision branch starts with `-label->`
- Node names can contain spaces
- Use named colors only (not hex)

## Output

Write to a descriptive `.dgmo` file and offer to render with `dgmo` CLI if available.

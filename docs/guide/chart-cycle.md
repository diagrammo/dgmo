# Cycle Diagram

```dgmo
cycle OODA Loop

Observe | color: blue
  Gather raw information from the environment
  Monitor unfolding circumstances
  -Unfold circumstances-> | color: blue

Orient | color: green
  Analyze and synthesize observations
  Form a mental model of the situation
  -Form hypothesis-> | color: green

Decide | color: orange
  Select a course of action
  -Commit to action-> | color: orange

Act | color: red
  Execute the chosen course of action
  Generate results that feed back
  -Generate feedback-> | color: red
```

## Overview

Cycle diagrams show a circular process flow where nodes are arranged on a circle and directed edges connect each to the next, with the last wrapping back to the first. They are ideal for OODA loops, PDCA cycles, product lifecycles, continuous improvement processes, and any workflow that repeats.

## Syntax

```
cycle Title

NodeLabel
NodeLabel | color: blue, span: 2
```

The first line declares the chart type and title. Each top-level line declares a node. Nodes are positioned around a circle in declaration order.

## Nodes

Every non-indented, non-directive line is a node:

```
cycle Seasons

Spring | color: green
Summer | color: yellow
Autumn | color: orange
Winter | color: blue
```

### Node Pipe Metadata

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `color` | palette name | auto | Node fill color |
| `span` | positive number | `1` | Relative arc distance to next node |
| `description` | string | — | One-liner shown below the label |

### Descriptions

Indented lines under a node add description text. Markdown inline formatting is supported (`**bold**`, `*italic*`, `` `code` ``, `[links](url)`). Bullet points with `- item` render as `• item`.

```
Observe | color: blue
  Gather raw information from the environment
  Monitor unfolding circumstances
```

If both `| description: text` and indented lines exist, they concatenate (pipe first, then indented).

## Edges

Edges are **implicit** — every node connects to the next, with the last wrapping to the first. The `->` syntax annotates edges with labels, descriptions, and styling:

```
Observe | color: blue
  -Unfold circumstances-> | color: blue
    Synthesize raw data into context

Orient | color: green
  -> | width: 4
```

Edge lines are indented under their source node. A label goes between `-` and `->`. Pipe metadata supports `color` and `width`.

### Edge Descriptions

Indented lines under an edge line add description text:

```
Observe
  -Analyze->
    Break down observations into components
    Identify **key patterns**
```

## Span

The `span` metadata controls relative arc distance between nodes. A node with `span: 2` gets twice the arc space to the next node:

```
cycle Weighted Process

Important Step | span: 2
Quick Step
Another Step | span: 1.5
```

## Directives

| Directive | Effect |
|-----------|--------|
| `direction-counterclockwise` | Reverse cycle direction (default: clockwise) |
| `no-descriptions` | Hide description text on all nodes and edges |
| `circle-nodes` | Render nodes as circles instead of rounded rectangles |

```
cycle Simple Loop

direction-counterclockwise

Plan
Do
Check
Act
```

## Complete Example

```dgmo
cycle PDCA Continuous Improvement

Plan | color: blue, span: 1.5
  Define objectives and processes
  Establish expected outcomes
  -Start implementation->

Do | color: green
  Execute the plan on a small scale
  Collect data for analysis
  -Gather results->

Check | color: orange
  Compare results against expectations
  Identify deviations and root causes
  -Propose changes-> | color: orange

Act | color: red
  Standardize successful changes
  Address remaining gaps
  -Feed back into planning-> | color: red
    Begin the next improvement cycle
```

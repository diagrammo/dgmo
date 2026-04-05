# Gantt Chart

```dgmo
gantt Product Launch 2024
start 2026-03-15
today-marker
critical-path
dependencies

holiday
  2024-02-19 Presidents Day
  2024-05-27 Memorial Day

tag Team alias t
  Engineering(blue)
  Design(purple)
  QA(orange)
  Marketing(green)

tag Phase alias p
  Foundation(teal)
  Build(blue)
  Launch(red)

era 2026-04-06 -> 2026-04-10 RSA Conference (purple)
marker 2026-03-27 Board Review
marker 2026-05-12 Trade Show Demo (orange)

parallel
  [Backend] | t: Engineering
    20bd Database Schema | p: Foundation, 100%
    15bd? Core API Endpoints | p: Foundation, 80%
      -> Frontend.API Integration
    10bd Auth & Permissions | p: Build, 40%
      -> E2E Testing
    parallel
      5bd Load Testing | t: QA, p: Build
      5bd Security Audit | t: QA, p: Build

  [Frontend] | t: Design
    10bd Wireframes & Prototypes | p: Foundation, 100%
    15bd Component Library | p: Build, 60%
    10bd API Integration | t: Engineering, p: Build
      // Blocked until Core API is stable
    5bd Polish & Animations | p: Launch, 10%

  [Marketing] | t: Marketing
    10bd? Brand Guidelines | p: Foundation, 100%
    15bd Landing Page | p: Build, 50%
    5bd? Launch Campaign Prep | p: Launch
      -> Launch Day

[Integration] | t: QA
  10bd E2E Testing | p: Launch, offset: 10bd
  3bd Staging Deploy | p: Launch
  0d Launch Day
```

## Overview

Gantt charts visualize project schedules as horizontal bars on a time axis. Tasks have durations, can be grouped, run in parallel, and linked with dependencies. The renderer automatically calculates dates from durations and shows critical path highlighting.

## Syntax

```
gantt Project Name
start 2024-01-15

[Group Name]
  30d Task label
  10bd Another task | tag: Value
```

## Settings

| Key             | Description                                             | Default   |
| --------------- | ------------------------------------------------------- | --------- |
| `chart`         | Must be `gantt`                                         | —         |
| `title`         | Chart title                                             | None      |
| `start`         | Project start date (`YYYY-MM-DD`)                       | Today     |
| `today-marker`  | Show today marker (bare keyword or a `YYYY-MM-DD` date) | off       |
| `critical-path` | Highlight the critical path                             | off       |
| `dependencies`  | Show dependency arrows                                  | off       |
| `sort`          | Task sorting: `default` or `tag` (swimlane by tag)      | `default` |

## Tasks

Tasks are defined with a duration followed by a space and label:

```
30d Database Layer
10bd Auth Module
5w Long Research Phase
```

### Duration Units

| Unit | Meaning       |
| ---- | ------------- |
| `d`  | Calendar days |
| `bd` | Business days |
| `w`  | Weeks         |
| `m`  | Months        |
| `q`  | Quarters      |
| `y`  | Years         |

### Explicit Start Dates

Pin a task to a specific start date:

```
2024-03-01 -> 15bd Task starting March 1st
```

### Milestones

Use `0d` for zero-duration milestones:

```
0d Release Candidate
```

### Uncertain Duration

Add `?` after the unit to indicate an uncertain end date. The bar fades out over the last 20%:

```
30bd? Estimated research phase
```

### Progress

Add a percentage to show task completion:

```
30bd Database Layer | 80%
10bd Auth Module | 100%
```

## Groups

Groups organize tasks into labeled sections using bracket syntax:

```
[Backend]
  30bd Database Layer
  10bd Auth Module

[Frontend]
  15bd Component Library
  10bd API Integration
```

Groups can be nested:

```
[Backend]
  [API]
    10bd REST endpoints
    5bd GraphQL layer
  [Data]
    15bd Schema design
```

### Group Colors

Add a color suffix or use pipe metadata:

```
[Backend](blue)
[Frontend] | t: Engineering
```

## Parallel Blocks

Use `parallel` to run groups or tasks concurrently instead of sequentially:

```
parallel
  [Backend]
    30bd Database Layer
    10bd Auth Module

  [Frontend]
    15bd Component Library
    10bd API Integration
```

Tasks inside a `parallel` block start at the same time. Without `parallel`, groups run sequentially.

## Dependencies

Use `-> TargetName` indented under a task to create a dependency. The target task won't start until the source finishes:

```
[Backend]
  10bd Auth Module
    -> Frontend.API Integration

[Frontend]
  15bd Component Library
  10bd API Integration
```

Cross-group references use dot notation: `GroupName.TaskName`.

Dependencies require `dependencies` in the chart options to render arrows.

### Dependency Offset

Add an **offset** to delay (or advance) the start of a dependent task relative to its predecessor. Use `| offset:` on a dependency line:

```
[Backend]
  10bd Auth Module
    -> Frontend.API Integration | offset: 3bd

[Frontend]
  15bd Component Library
  10bd API Integration
```

Here, "API Integration" starts **3 business days after** "Auth Module" finishes, instead of immediately.

Use a negative value for **lead time** (overlap with predecessor):

```
5bd Design Review
  -> Implementation | offset: -2d
```

Offset accepts any duration unit (`d`, `bd`, `w`, `m`, `q`, `y`).

### Task-Level Offset

Tasks can also have an `offset:` to shift their start date relative to where they'd normally begin (after the preceding task in their group):

```
[Backend]
  10bd API Layer
  5bd Auth Module | offset: 3bd
```

Here, "Auth Module" starts 3 business days after "API Layer" finishes instead of immediately.

## Holidays

Define non-working days inside a `holidays` block:

```
holiday
  2024-12-25 Christmas
  2024-12-31 -> 2025-01-01 New Year
```

Business day durations (`bd`) automatically skip holidays and non-workdays.

### Custom Workweek

Override the default Mon–Fri workweek:

```
workweek sun-thu
```

## Eras

Background shaded regions spanning a time range:

```
era 2024-01 -> 2024-06 Phase 1
era 2024-07 -> 2024-12 Phase 2 (green)
```

## Markers

Vertical date markers for key milestones:

```
marker 2024-03-01 Kickoff
marker 2024-06-30 Demo Day (red)
```

## Tag Groups

Tag groups categorize tasks with color-coded values:

```
tag Team alias t
  Engineering(blue)
  Design(purple)
  QA(orange)

tag Phase alias p
  Foundation(green)
  Growth(orange)

[Backend] | t: Engineering
  30bd Database Layer | p: Foundation
  10bd Auth Module | p: Foundation
```

## Swimlane Mode

Use `sort: tag` (or `sort: tag:GroupName`) to organize tasks into horizontal swimlanes grouped by tag value. Each tag value gets its own collapsible lane:

```
sort tag:Team

tag Team alias t
  Frontend(blue)
  Backend(green)
  QA(orange)

[Sprint 1]
  10bd API endpoints | t: Backend
  15bd UI components | t: Frontend
  5bd Integration tests | t: QA
```

In the app, click the swimlane icon on a tag pill to switch between swimlane groups.

## Comments

Lines starting with `//` are comments and are ignored:

```
[Backend]
  30bd Database Layer
  // This depends on schema finalization
  10bd Auth Module
```

## Complete Example

```dgmo
gantt Product Launch Plan
start 2024-01-15
today-marker 2024-03-01
critical-path
dependencies

tag Team alias t
  Engineering(blue)
  Design(purple)
  QA(orange)

era 2024-01 -> 2024-06 Phase 1
marker 2024-03-01 Kickoff

parallel
  [Backend] | t: Engineering
    30bd Database Layer | 80%
    10bd? Auth Module | 100%
      -> Frontend.API Integration | offset: 2bd
    parallel
      5bd Load Testing | t: QA
      5bd Security Audit | t: QA

  [Frontend] | t: Design
    15bd Component Library
    10bd API Integration | t: Engineering
    5bd Polish | 30%

[Integration] | t: QA
  10bd E2E Testing
  0d Release Candidate
```

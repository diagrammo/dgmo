# Kanban Board

```dgmo
kanban Plunder Sprint 7

tag Priority
  Urgent(red)
  High(orange)
  Low(green) default

tag Crew alias c
  Blackbeard(red)
  Anne Bonny(purple)
  Calico Jack(teal)

[Awaiting Orders](red)
  Recruit gunners at Tortuga | priority: High, c: Calico Jack
  Chart new trade route | priority: Urgent, c: Anne Bonny
    Scout the Windward Passage
    Avoid Royal Navy patrols
  Resupply rum and powder | priority: Low, c: Calico Jack

[Underway](orange) | wip: 2
  Forge letters of marque | priority: High, c: Anne Bonny
  Raid merchant convoy | priority: Urgent, c: Blackbeard
    Three ships spotted off Nassau

[Done](green)
  Bribe the harbour master | priority: High, c: Anne Bonny
  Repair hull damage | priority: Low, c: Blackbeard
```

## Overview

Kanban boards visualize work items as cards organized into columns. Columns typically represent workflow stages (To Do, In Progress, Done). Cards can carry tags for color-coded categorization and freeform detail text.

**Drag-and-drop:** In the app, drag cards between columns or reorder within a column. The editor text updates automatically.

## Syntax

```
kanban Board Title

[Column Name]
Card Title
Card Title | key: Value, key: Value
  Freeform detail text
  Another detail line
```

## Settings

| Key     | Description      | Default |
| ------- | ---------------- | ------- |
| `chart` | Must be `kanban` | —       |
| `title` | Board title      | None    |

## Columns

Columns are defined with `[Column Name]` syntax. All cards between one column header and the next belong to that column.

Kanban columns model a workflow pipeline. Cards move left to right as work progresses. Each column should answer "what stage is this work in?" If something isn't a stage — like acceptance criteria, decision gates, or definitions of done — model it as a tag on cards rather than a separate column.

```
[To Do]
[In Progress]
[Done]
```

### WIP Limits

Add `| wip: N` after a column header to set a work-in-progress limit. A warning appears when the limit is exceeded:

```
[In Progress] | wip: 3
```

## Cards

Each non-indented line within a column creates a card. Cards can have tags and detail lines.

### Tags

Tags follow the card title, separated by `|`. Multiple tags are comma-separated:

```
Build login | priority: High, assignee: Alice
```

### Detail Lines

Indented lines under a card are freeform detail text:

```
Build login | priority: High
  OAuth + email/password support
  Needs design review first
```

### Card Colors

Add a color suffix to a card title:

```
Urgent fix(red)
```

## Tag Groups

Tag groups define categories with color-coded values. They appear before columns and use the `tag` directive:

```
tag Priority
  High(red)
  Medium(yellow)
  Low(green) default

tag Assignee alias a
  Alice(blue)
  Bob(purple)
```

- `default` marks the fallback value for cards without an explicit tag
- `alias` provides a short name for the tag (e.g., `a` instead of `assignee`)
- Colors are shown as dots on each card

## Complete Example

```dgmo
kanban Product Roadmap

tag Status
  Blocked(red)
  Active(green) default

tag Team alias t
  Frontend(blue)
  Backend(purple)
  Design(yellow)

[Backlog]
Dark mode support | t: Frontend
API rate limiting | t: Backend
  Research token bucket vs sliding window

[In Progress] | wip: 3
User dashboard | t: Frontend, status: Active
  Charts and metrics overview
Auth refactor | t: Backend, status: Active

[Review]
Payment integration | t: Backend, status: Blocked
  Waiting on Stripe webhook setup

[Done]
Onboarding flow | t: Design
Landing page | t: Frontend
```

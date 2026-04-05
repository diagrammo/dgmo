# Org Chart

```dgmo
org The Dread Fleet
sub-node-label Crew
show-sub-node-count

tag Rank alias r
  Captain(red)
  FirstMate(orange)
  Quartermaster(yellow)
  Bosun(green)
  Gunner(teal)
  Sailor(blue) default
  Jester(cyan)
  Swab(purple)

tag Ship alias s
  Revenge(blue) default
  Serpent(green)
  Phantom(purple)

tag Status alias st
  Loyal(green) default
  Turncoat(red)
  NewRecruit(yellow)

Blackbeard| r: Captain, s: Revenge
  Anne Bonny| r: FirstMate
    [Gun Deck]
      Cannonball Pete| r: Gunner
      Smokey Jack| r: Gunner, st: NewRecruit
      Powder Meg| r: Swab, st: NewRecruit
    [Boarding Party]
      Cutlass Jim| r: Bosun
      Red Mary
      One-Eyed Dan| st: Turncoat
  Calico Rackham| r: Quartermaster
    [Cargo Hold]
      Barnacle Bob
      Slippery Sal| st: Turncoat
  Long John| r: FirstMate, s: Serpent
    [Rigging Crew]
      Monkey Fist| r: Bosun
      Pegleg Pete
      Crow Jane
    [Navigation]
      Stargazer Quinn| r: Quartermaster
      Compass Rose| st: NewRecruit
```

## Overview

Org charts use **indentation** to define reporting hierarchy. Each person is a line of text, and metadata like `role:` appears indented beneath them. Children are indented under their manager.

## Syntax

```
org Chart Title

Person Name
  role: Job Title

  Direct Report
    role: Job Title
```

## Settings

| Key     | Description   | Default |
| ------- | ------------- | ------- |
| `chart` | Must be `org` | Yes     |
| `title` | Chart title   | None    |

## Nodes

Each non-indented (or less-indented) text line creates a person node. Deeper indentation creates a child (direct report):

```
CEO
  VP of Engineering
    Senior Engineer
    Junior Engineer
  VP of Sales
    Account Executive
```

## Metadata

Add key-value pairs indented under a node:

```
Alice Park
  role: Senior Engineer
  location: New York
  focus: APIs
```

Metadata renders as secondary text on the node card.

### Compact Pipe Syntax

For concise entries, use `|` to put metadata on a single line:

```
Alice Park | role: Senior Engineer | location: NY
Bob Torres | role: Junior Engineer | location: CO
```

## Containers (Teams)

Use `[Team Name]` to create a container that groups its children visually:

```
Alex Chen
  role: CTO

  [Platform Team]
    goal: Core infrastructure and APIs

    Alice Park | role: Senior Engineer
    Bob Torres | role: Junior Engineer

  [Frontend Team]
    goal: Ship new design system by Q3

    Carol Wu | role: Senior Engineer
    Dave Kim | role: Junior Engineer
```

Containers render as labeled boxes. They can have metadata like `goal:` and `charter:` which display below the container label.

## Node Colors

Add a color name in parentheses:

```
[Platform Team(blue)]
[Frontend Team(green)]
```

## Tag Groups

Define color-coded tags for metadata values like location or status. Tag groups must appear before org content:

```
org Acme Corp

tag Location
  NY(blue)
  LA(yellow)
  Remote(purple)

tag Status
  FTE(green)
  Contractor(orange)

Jane Smith
  role: CEO
  location: NY
  status: FTE
```

- `tag GroupName` starts a tag group
- `alias` provides a shorthand for metadata keys (e.g., `tag Location alias l`)
- `default` marks the fallback value for nodes without that metadata
- When a node's metadata value matches a tag entry, it renders with that tag's color as a badge

## Comments

```
// This line is ignored by the parser
```

## Collapse / Expand

In the app, click a node that has children to focus it. Click again to collapse its subtree — a "+N hidden" label shows how many nodes are hidden. Click once more to expand. Containers can be collapsed independently.

Keyboard: Tab to focus a node, Enter or Space to toggle.

## Complete Example

```dgmo
org Engineering Division

Alex Chen
  role: CTO

  [Platform Team]
    goal: Core infrastructure and APIs
    charter: Platform reliability and developer experience

    Alice Park | role: Senior Engineer | location: NY
    Bob Torres | role: Junior Engineer | location: CO

  [Frontend Team]
    goal: Ship new design system by Q3

    Carol Wu
      role: Senior Engineer
    Dave Kim
      role: Junior Engineer

  [Data Team]
    goal: ML pipeline and analytics

    Eve Martinez
      role: Data Scientist
```

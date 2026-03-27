# DGMO Language Reference

DGMO is a text-based diagram markup language. Files use the `.dgmo` extension. Render with the `dgmo` CLI, the Diagrammo desktop app, or the `@diagrammo/dgmo` npm library.

## Migration Guide

Syntax changes introduced in the consistency cleanup. Old forms now produce errors.

| Old Syntax | New Syntax | Chart Types |
|---|---|---|
| `chart: TYPE` + `title: Text` | `TYPE Text` (single first line) | All |
| `chart: TYPE` (alone) | `TYPE` | All |
| `directive: value` | `directive value` (no colon) | All |
| `Label: value` (ECharts data) | `Label value` | bar, line, pie, etc. |
| `era YYYY->YYYY: Label` | `era YYYY->YYYY Label` | line, timeline, gantt |
| `marker YYYY: Label` | `marker YYYY Label` | timeline, gantt |
| `## Group` | `tag Group` | All |
| `== Column ==` | `[Column]` | Kanban |
| `person Name` | `Name is a person` | C4 |
| `-> Target : Desc [tech]` | `-Desc-> Target \| tech: val` | C4 |
| `A <-> B` | Two lines: `A -> B` + `B -> A` | C4 |
| `-> Target x5` | `-> Target \| fanout: 5` | Infra |
| `lag: 5d` / `lead: 3d` | `offset: 5d` / `offset: -3d` | Gantt |
| `Name(color)` | Use `tag` groups | Sequence |
| `scenario:` | (removed) | Infra |
| `wip` | `doing` (wip still accepted) | Init-status |
| `#ff0000` hex colors | Named colors only | All |
| `show-sub-node-count: yes` | `show-sub-node-count` (flag) | Org |
| `import: path` | `import path` | Org |
| `tags: path` | `tags path` | Org |

---

## Common Patterns

Every `.dgmo` file starts with a chart type keyword as the first line, optionally followed by a title. Directives follow on subsequent lines.

### First Line

```
bar Revenue by Region
```

The chart type keyword (`bar`, `sequence`, `gantt`, etc.) is the first token. Everything after it on the same line becomes the title. If the content is unambiguous, the chart type is auto-detected and can be omitted.

### Directives

```
palette nord
theme dark
xlabel Category
ylabel Count
```

Directives are `keyword value` (no colon). They appear after the first line, before data.

### Comments

```
// This is a comment (only // is supported)
```

### Inline Colors

Append `(colorname)` to labels, nodes, or data points:

```
Port Royal(red) 850
[Process(blue)]
```

Named colors only: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `teal`, `cyan`, `gray`. Palette-specific colors also available. Hex color codes (e.g. `#ff0000`) are **not** supported — use named colors instead.

### Palettes and Themes

8 palettes: `nord` (default), `solarized`, `catppuccin`, `rose-pine`, `gruvbox`, `tokyo-night`, `one-dark`, `bold`

3 themes per palette: `light`, `dark`, `transparent`

Set via CLI: `dgmo diagram.dgmo --palette catppuccin --theme dark`

### Inline Markdown

Text fields support: `*italic*`, `**bold**`, `` `code` ``, `[link text](url)`. Bare URLs are auto-linked.

### Multi-line Values

Properties that accept comma-separated lists (`series`, `columns`, `rows`, `x-axis`, `y-axis`) also accept an indented multi-line format. Leave the value empty and list each value on its own indented line:

```
// Single-line (still works)
series Rum, Spices, Silk, Gold

// Multi-line equivalent
series
  Rum
  Spices
  Silk
  Gold
```

Multi-line blocks support blank lines and `//` comments within the block. Trailing commas on values are stripped for convenience.

```
series
  Rum (red)
  Spices (green)
  // gold last
  Gold (yellow)
```

Works with `columns` and `rows` in heatmaps:

```
columns
  January
  February
  March
```

---

## Chart Types

### bar

**Syntax:** `bar [Title]`

**Options:** `series`, `xlabel`, `ylabel`, `orientation` (`horizontal`/`vertical`), `labels` (`name`/`value`/`percent`/`full`), `color`

**Data format:** `Label value` — one row per category

**Example:**

```
bar Revenue by Region
series Revenue

North 850
South 620
East 1100
West 430
```

Colors per item: `North(red) 850`

### line

**Syntax:** `line [Title]` or `multi-line [Title]`

**Options:** `series`, `xlabel`, `ylabel`, `labels`

**Data format:** `Label value` (single series) or `Label v1, v2, v3` (multi-series matching `series` list)

**Example:**

```
line Quarterly Performance
series Sales(red), Costs(blue)

Q1 100, 50
Q2 120, 55
Q3 110, 60
Q4 130, 58
```

Multi-series: comma-separated values matching the `series` list. Single series omits `series` directive. Also works as `multi-line`.

**Era bands** — annotate named time periods with background shading:

```
line U.S. Strategic Petroleum Reserve
ylabel Million Barrels

era '81 -> '89 Reagan (red)
era '89 -> '93 Bush (red)
era '93 -> '01 Clinton (blue)

'81 230
'85 493
'89 580
'93 587
'01 550
```

Syntax: `era <start> -> <end> <label> [(<color>)]`

- `start` and `end` must exactly match category labels in the data
- Color is optional; defaults to the palette's blue
- Band label is hidden if the era spans fewer than 3 category slots
- Works on `line`, `multi-line`, and `area` charts
- Era boundary labels are always pinned visible on the x-axis even when auto-skip is active

### area

**Syntax:** `area [Title]`

**Options:** same as `line`, including era bands

**Data format:** same as `line`

Same syntax as `line`, including era bands. Renders as a filled area chart.

### pie

**Syntax:** `pie [Title]`

**Options:** `labels` (`name`/`value`/`percent`/`full`)

**Data format:** `Label value`

**Example:**

```
pie Market Share
labels percent

Company A 40
Company B 35
Company C 25
```

### doughnut

**Syntax:** `doughnut [Title]`

**Options:** same as `pie`

**Data format:** same as `pie`

Same syntax as `pie`. Renders as a doughnut (ring) chart.

### polar-area

**Syntax:** `polar-area [Title]`

**Options:** same as `pie`

**Data format:** same as `pie`

Same syntax as `pie`. Renders as a polar area (rose) chart.

### radar

**Syntax:** `radar [Title]`

**Options:** (none)

**Data format:** `Label value`

**Example:**

```
radar Team Skills

Frontend 85
Backend 70
DevOps 60
Design 90
Testing 75
```

### bar-stacked

**Syntax:** `bar-stacked [Title]`

**Options:** `series` (required), `xlabel`, `ylabel`, `orientation`

**Data format:** `Label v1, v2, v3` — comma-separated values matching the `series` list

**Example:**

```
bar-stacked Budget Allocation
series Engineering, Marketing, Sales

Q1 100, 50, 30
Q2 110, 55, 35
Q3 105, 60, 40
```

### scatter

**Syntax:** `scatter [Title]`

**Options:** `labels` (`on`/`off`), `xlabel`, `ylabel`, `sizelabel`

**Data format:** `Label x, y` or `Label x, y, size` (bubble chart). Group with `[GroupName]` blocks.

**Example:**

```
scatter Performance Metrics
labels on
xlabel Experience (years)
ylabel Output

Alice 3, 85
Bob 7, 92
Carol 2, 70
```

Tag groups (`[GroupName](color)`) create colored clusters:

```
scatter Startup Funding vs Revenue
labels on
xlabel Funding ($M)
ylabel Annual Revenue ($M)

[SaaS](blue)
  Acme Cloud 12, 8.5
  DataSync 5.2, 3.1

[Fintech](green)
  PayFlow 45, 32
  LendTech 18, 12.5
```

### heatmap

**Syntax:** `heatmap [Title]`

**Options:** `columns` (required)

**Data format:** `Row Label v1, v2, v3` — comma-separated values matching the `columns` list

**Example:**

```
heatmap Activity by Month
columns Jan, Feb, Mar, Apr, May, Jun

Team A 5, 4, 5, 3, 4, 5
Team B 2, 3, 2, 4, 3, 2
Team C 3, 2, 1, 2, 3, 4
```

### sankey

**Syntax:** `sankey [Title]`

**Options:** (none)

**Data format:** Arrow syntax (`Source -> Target value`) or indentation syntax (`Target value` indented under parent)

**Arrow syntax:**

```
sankey Resource Flow

Source A -> Processing 300
Source B -> Processing 200
Processing -> Output X 350
Processing -> Output Y 150
```

**Indentation syntax:**

```
sankey Resource Flow

Source A
  Processing 300
Source B
  Processing 200
Processing
  Output X 350
  Output Y 150
```

Both syntaxes can be mixed in the same diagram.

**Node colors** — `(color)` after a node name:

```
Revenue (green)
  Costs (red) 600
  Profit (blue) 400

// or with arrows
Revenue (green) -> Costs (red) 600
```

**Link colors** — `(color)` after the value:

```
Revenue
  Costs 600 (orange)

// or with arrows
Revenue -> Costs 600 (orange)
```

### chord

**Syntax:** `chord [Title]`

**Options:** (none)

**Data format:** same as `sankey` (arrow syntax)

Same syntax as `sankey`. Renders as a circular chord diagram.

**Example:**

```
chord Inter-Department Collaboration

Engineering -> Design 85
Engineering -> Product 72
Design -> Marketing 45
Product -> Sales 42
```

### funnel

**Syntax:** `funnel [Title]`

**Options:** (none)

**Data format:** `Label value`

**Example:**

```
funnel Conversion Pipeline

Visitors 1000
Signups 500
Trials 200
Customers 100
```

### function

**Syntax:** `function [Title]`

**Options:** `x` (required, `start to end`), `xlabel`, `ylabel`

**Data format:** `Name (color) expression` — math expressions using `x`

**Example:**

```
function Mathematical Functions
xlabel x
ylabel f(x)

x -6 to 6
f(x) (blue) sin(x)
g(x) (red) x^2 / 10
h(x) (green) cos(x) * 2
```

Expressions support: `+`, `-`, `*`, `/`, `^`, `sin`, `cos`, `sqrt`, `abs`, `log`, `exp`, `pi`, `e`.

### slope

**Syntax:** `slope [Title]`

**Options:** `orientation` (`horizontal`/`vertical`)

**Data format:** First data line defines period labels. Subsequent lines: `Item (color) v1, v2, ...`

**Example:**

```
slope Programming Language Popularity

2020, 2022, 2025
Python (blue) 3, 1, 1
JavaScript (yellow) 1, 2, 2
TypeScript (cyan) 7, 4, 3
Rust (orange) 18, 12, 5
```

### wordcloud

**Syntax:** `wordcloud [Title]`

**Options:** `rotate` (`none`/`mixed`/`angled`), `max` (word limit), `size` (`min, max` font range)

**Data format:** `word weight` (higher = larger)

**Example:**

```
wordcloud Top Terms

kubernetes 95
docker 80
terraform 65
ansible 50
```

### arc

**Syntax:** `arc [Title]`

**Options:** `order:` (`appearance`/`name`/`group`/`degree`), `orientation`

**Data format:** `Source -> Target weight`. Group nodes with `[GroupName]` blocks.

**Example:**

```
arc Team Collaboration
order: group

[Frontend]
  WebApp -> API Gateway 5
  MobileApp -> API Gateway 3

[Core Services]
  API Gateway -> AuthService 4
  API Gateway -> UserService 5
```

### venn

**Syntax:** `venn [Title]`

**Options:** `values` (`on`/`off`)

**Data format:** Sets: `id(color) alias shortname`. Overlaps: `id1 + id2 Label`.

**Example:**

```
venn Skill Overlap

Frontend(blue) alias fe
Backend(green) alias be
DevOps(orange) alias de

fe + be Web Systems
be + de Platform Ops
fe + de Dev Tools
fe + be + de Full Stack
```

### quadrant

**Syntax:** `quadrant [Title]`

**Options:** `x-axis` (`low label, high label`), `y-axis` (`low label, high label`)

**Data format:** Quadrant labels: `top-right Label`, `top-left Label`, etc. Data points: `Label (color) x, y` where x,y are 0-1.

**Example:**

```
quadrant Priority Matrix
x-axis Low Impact, High Impact
y-axis Low Effort, High Effort

top-right Quick Wins(green)
top-left Big Bets(yellow)
bottom-left Skip(red)
bottom-right Reconsider(gray)

Task A 0.9, 0.8
Task B 0.2, 0.3
Task C 0.7, 0.4
```

### timeline

**Syntax:** `timeline [Title]`

**Options:** `scale` (`on`/`off`), `sort` (`time`/`group`/`tag`/`tag:GroupName`), `swimlanes` (`on`/`off`)

**Data format:** Ranges: `start->end Label | tag: Value`. Points: `date Label | tag: Value`.

**Example:**

```
timeline Project History

tag Team
  Team A(blue)
  Team B(green)

era 2023->2024 Phase 1
marker 2023-06 Launch(orange)

2023-01->2023-06 Planning | Team: Team A
2023-06->2024-01 Development | Team: Team A
2024-02 Release | Team: Team A

2023-03->2023-09 Research | Team: Team B
2023-09->2024-03? Implementation | Team: Team B
```

Date formats: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`. Ranges: `start->end`. Durations: `start->1y`, `start->6m`, `start->2w`, `start->30d`. Uncertain end: append `?` (e.g., `2024-03?`).

Elements: `era start->end Label(color)`, `marker date Label(color)`, `tag` groups for interactive coloring.

Tag groups for interactive coloring and swimlanes:

```
timeline Sprint Plan
sort tag:Team

tag Team
  Engineering(blue)
  Design(green)

2024-01->2024-06 Build API | Team: Engineering
2024-03->2024-05 UX Review | Team: Design
```

Tag groups add interactive color and swimlane controls. `sort tag` uses the first tag group for swimlanes; `sort tag:GroupName` specifies which group (aliases work: `sort tag:p` resolves to `sort tag:Pirate`).

---

## Diagram Types

### sequence

**Syntax:** `sequence [Title]`

**Options:** `activations` (`on`/`off`), `collapse-notes` (`yes`/`no`), `active-tag GroupName`

**Data format:** Messages between participants with arrow syntax

Minimal example:

```
User -login-> API
API -findUser-> DB
DB -user-> API
API -token-> User
```

Full example:

```
sequence Authentication Flow

// participant declarations (optional)
User is an actor
API is a service
DB is a database
NotifyQueue is a queue aka Notifications

User -Login request-> API
API -Find user by email-> DB
DB -user record-> API
note on DB
  Indexed lookup on email column

if credentials valid
  API -Create session-> DB
  DB -session token-> API
  API ~session.created~> NotifyQueue
  API -200 OK + token-> User
else
  API -401 Unauthorized-> User

== Logout ==

User -Logout-> API
API -Delete session-> DB
API -200 OK-> User
```

**Participants**: Auto-inferred from message names. Declare explicitly for type/positioning:
- `Name is a [actor|service|database|queue|cache|gateway|external|networking|frontend]`
- `Name aka Display Label` — alias for display
- `Name at position 2` — manual left-to-right ordering (0-based; negative from right)

**Messages**:
- Sync call: `A -label-> B` or `A -> B` (unlabeled) — always left-to-right
- Async call: `A ~label~> B` or `A ~> B` (unlabeled)

**Blocks** (indentation-scoped):
- `if condition` ... `else` ... (no explicit `end` needed — indentation closes blocks)
- `loop label` ...
- `parallel label` ...

**Notes**:
- `note text` — standalone
- `note on Participant` followed by indented text — anchored
- Multi-line: indent continuation lines under `note`

**Sections**: `== Section Title ==`

**Groups**: `[Group Name]` or `[Group Name | key: value]` — visual grouping box around participants

**Tag groups** — define color-coded metadata dimensions for interactive recoloring:

```
tag Concern alias c
  Caching(blue)
  Auth(green)
  BusinessLogic(purple) default
```

- `tag Name` declares a tag group; `alias x` adds a shorthand
- Each entry: `Value(color)` — named color for that value
- `default` on an entry applies it to untagged elements when the group is active

**Pipe metadata** — attach tag values to participants, messages, and groups:

```
API is a service | concern: Caching, team: Platform
User -login-> API | concern: Auth
[Backend | concern: BusinessLogic]
  OrderAPI
  DB
```

- `| key: value` after participant declarations, message lines, or group headers
- Multiple tags: `| key1: val1, key2: val2`
- Aliases work: `| c: Caching` (if `alias c` was declared)

**Tag resolution priority** (when a tag group is active):
1. Explicit metadata on the participant
2. Group propagation (participant inherits from its group)
3. Receiver inheritance (all incoming tagged messages agree on same value)
4. `default` entry value
5. Neutral (no color)

**Legend** — rendered automatically above participants when tag groups exist. The active group expands to show colored entry dots. Click a group pill to activate it (in the desktop app).

### flowchart

**Syntax:** `flowchart [Title]`

**Options:** (none beyond `palette`, `theme`)

**Data format:** Node chains with arrow connections

Minimal example:

```
(Start) -> [Process] -> (End)
```

Full example:

```
flowchart Decision Process

(Start) -> <Valid Input?>
  -yes-> [Process Data] -> [[Run Subroutine]]
  -no-> /Get User Input/ -> <Valid Input?>
[[Run Subroutine]] -> [Document~] -> (Done)
```

**Node shapes**:
- `(Terminal)` — oval
- `[Process]` — rectangle
- `<Decision?>` — diamond
- `/Input Output/` — parallelogram
- `[[Subroutine]]` — double-bordered rectangle
- `[Document~]` — document (wavy bottom)

**Arrows**: `-label-> Target`, `-(color)-> Target`, `-label(color)-> Target`

**Inferred arrow colors** — when a label matches a well-known keyword, the arrow color is set automatically:

| Label | Inferred Color |
|---|---|
| yes, success, ok, true | green |
| no, fail, error, false | red |
| maybe, warning | orange |

Colors on nodes: `[Process(blue)]`

### state

**Syntax:** `state [Title]`

**Options:** `direction` (`TB` or `LR`), `color` (`off` for monochrome)

**Data format:** States connected by transitions

Minimal example:

```
[*] -> Idle -> Active -> [*]
```

Full example:

```
state Order Lifecycle
direction LR

[Processing(blue)]
  Validating -valid-> Approved
  Validating -invalid-> Rejected(red)

[*] -> Pending -submit-> Validating
Approved -ship-> Shipped -> [*]
Rejected -> [*]
Shipped -return-> Pending
```

**States**: bare text — `Idle`, `Active`, `Processing`. Optional color suffix: `Active(green)`.

**Pseudostates**: `[*]` — rendered as a filled circle. Use for start and end points.

**Transitions**: `->`, `-label->`, `-(color)->`, `-label(color)->`.

**Chains**: `A -> B -> C` on a single line creates two transitions.

**Indentation**: indented lines use the parent as implicit source:

```
Idle
  -start-> Running
  -configure-> Configuring
```

is equivalent to `Idle -start-> Running` and `Idle -configure-> Configuring`.

**Groups**: `[GroupName]` or `[GroupName(color)]` — groups subsequent indented states visually.

**Self-loops**: `Running -retry-> Running` — a state transitioning to itself.

### class

**Syntax:** `class [Title]`

**Options:** (none beyond `palette`, `theme`)

**Data format:** Class declarations with indented members

Minimal example:

```
Animal
  + name: string
  + speak(): void

Dog extends Animal
  + breed: string

Cat extends Animal
  + indoor: boolean
```

Full example:

```
class Type Hierarchy

Printable [interface]
  + print(): void

Shape implements Printable [abstract]
  # x: number
  # y: number
  + area(): number
  count: number {static}

Circle extends Shape
  - radius: number
  + area(): number

Rectangle extends Shape
  - width: number
  - height: number

Shape *-- Circle : contains
```

**Class modifiers**: `[abstract]`, `[interface]`, `[enum]`

**Inheritance**: `ClassName extends Parent` or `ClassName implements Interface` — declared inline in the class header. Members are indented below.

**Member visibility**: `+` public, `#` protected, `-` private. Static: `{static}`.

**Relationships** (arrow syntax):
- Inheritance: `A --|> B`
- Implementation: `A ..|> B`
- Composition: `A *-- B`
- Aggregation: `A o-- B`
- Dependency: `A ..> B`
- Association: `A -> B`
- Optional label: `A *-- B : description`

### er

**Syntax:** `er [Title]`

**Options:** (none beyond `palette`, `theme`)

**Data format:** Entity declarations with indented columns and relationships

Minimal example:

```
users
  id: int [pk]
  name: varchar
  1-* posts

posts
  id: int [pk]
  user_id: int [fk]
```

Full example:

```
er Blog Schema

users
  id: int [pk]
  email: varchar [unique]
  name: varchar
  1-writes-* posts
  ?-moderates-* categories

posts
  id: int [pk]
  title: varchar
  body: text
  author_id: int [fk]
  category_id: int [fk, nullable]

categories
  id: int [pk]
  name: varchar [unique]
  1-* posts
```

**Columns**: `name: type [constraints]`. Constraints: `pk`, `fk`, `unique`, `nullable`. Multiple: `[fk, nullable]`.

**Relationships** — indented under the source table (preferred):
- `1-* target` — one-to-many
- `1-1 target` — one-to-one
- `?-1 target` — zero-or-one to one
- `?-* target` — zero-or-more
- Labeled: `1-writes-* target` (label between dashes)

Columns and relationships can be mixed under the same table. The parser distinguishes them by the leading cardinality character (`1`, `*`, `?`).

**Flat relationships** — at indent 0 (also supported):
- `table1 1--* table2` — one-to-many
- `table1 1--* table2 : label` — with label

### c4

**Syntax:** `c4 [Title]`

**Options:** (none beyond `palette`, `theme`)

**Data format:** Element declarations with `Name is a type`, relationships with arrows

Minimal example:

```
c4

User is a person
MyApp is a system | description: The main application
  -Uses-> User
```

Auto-detection: C4 diagrams are auto-detected when `Name is a person/system/container/component` declarations are present — `c4` is optional.

Full example:

```
c4 Banking System

tag Scope alias sc
  Internal(blue) default
  External(gray)

Customer is a person | description: A customer of the bank

Internet Banking is a system | description: Online banking portal
  -Delivers content-> Customer | tech: HTTPS
  -Sends emails-> Email | tech: SMTP

  containers
    Web App is a container | description: SPA, tech: React
      -API calls-> API | tech: JSON/HTTPS

    API is a container | description: Backend, tech: Node.js
      -Reads/writes-> Database | tech: SQL

    Database is a container | description: Data store, tech: PostgreSQL

Email is a system | description: Email delivery, sc: External
  ~Sends emails~> Customer

deployment
  Vercel is a cloud
    container Web App
  Railway
    container API
  Neon is a database
    container Database
```

**Element types** — declared with `Name is a <type>`:
- `Name is a person` — human actor
- `Name is a system` — software system
- `Name is a container` — application/service within a system
- `Name is a component` — component within a container
- `Name is a external` — external system
- `Name is a database` — database element

**Metadata** (pipe-delimited): `Name is a system | description: text, tech: stack, tagalias: value`

**Sections**: `containers` (inside system), `components` (inside container), `deployment`

**Deployment nodes**: `NodeName is a [cloud|database|cache|queue|external]`

**Relationships**:
- Sync: `-> Target` or `-label-> Target`
- Async: `~> Target` or `~label~> Target`
- With technology metadata: `-label-> Target | tech: HTTPS`

**Tag groups**: See tag group syntax below.

### org

**Syntax:** `org [Title]`

**Options:** `sub-node-label`, `show-sub-node-count` (flag, no value needed)

**Data format:** Hierarchy via indentation

Minimal example:

```
org

CEO
  VP Engineering
    Team Lead
  VP Marketing
```

Full example:

```
org Engineering Org
sub-node-label Reports
show-sub-node-count

tag Level alias lv
  Director(red)
  Manager(blue)
  IC(green) default

CTO | lv: Director
  VP Engineering | lv: Director
    [Platform]
      Lead | lv: Manager
        Dev 1
        Dev 2
    [Product]
      Lead | lv: Manager
        Dev 3
```

Hierarchy via indentation. `[Group Name]` creates collapsible sub-groups.

**Metadata**: `Name | tagalias: value, tag2: value2`

**Imports**: `import path/to/file.dgmo` (indented under a parent node), `tags path/to/tags.dgmo` (top-level).

### kanban

**Syntax:** `kanban [Title]`

**Options:** (none beyond `palette`, `theme`)

**Data format:** `[Column]` headers with card items below

Minimal example:

```
kanban

[To Do]
Task 1
Task 2

[Done]
Task 3
```

Full example:

```
kanban Sprint Board

tag Priority
  Critical(red)
  High(orange)
  Low(green) default

tag Owner alias o
  Alice(blue)
  Bob(green)

[Backlog(gray)]
Research API options | priority: High, o: Alice

[In Progress(orange)] | wip: 3
Build auth module | priority: Critical, o: Bob
  Integrate OAuth2
  Add session management

[Done(green)]
Setup CI pipeline | priority: High, o: Alice
```

**Columns**: `[Column Name]`, `[Column Name(color)]`, `[Column Name] | wip: N`

**Cards**: `Card Title | tag: value`. Indented lines below become card details.

**Group metadata cascading**: `[Column Name] | key: value` — pipe metadata on column headers cascades to all cards in the column.

### initiative-status

**Syntax:** `initiative-status [Title]`

**Options:** (none beyond `palette`, `theme`)

**Data format:** Nodes with status, connected by dependency arrows

Minimal example:

```
initiative-status

Auth | done
  -> UserService | doing
  -> NotifyService | todo
UserService | doing
NotifyService | todo
```

Full example:

```
initiative-status Platform Roadmap

Auth | done
  -depends-> UserService | doing
  -feeds-> Dashboard | todo
Dashboard | todo
UserService | doing
  -calls-> DBLayer | done
DBLayer | done

[External]
  PaymentGW | na
  EmailProvider | na
```

**Status values**: `done`, `doing`, `blocked`, `todo`, `na`

**Status aliases**: `wip` maps to `doing`; `paused` and `waiting` map to `blocked`. Aliases are accepted in input but the canonical values are preferred.

**Relationships**: `-label-> Target | status` or indented children.

**Groups**: `[Group Name]` for visual grouping. `[Group Name] | key: value` — pipe metadata cascades to contained nodes.

### sitemap

**Syntax:** `sitemap [Title]`

**Options:** `direction` (`TB` or `LR`), `orientation` (alias for `direction`)

**Data format:** Page labels with arrows and metadata

Minimal example:

```
sitemap

Home
  -about-> About
  -blog-> Blog

[Content]
  About
  Blog
    -read-> Post
  Post
```

Full example:

```
sitemap SaaS Platform
direction TB

tag Auth
  Public(green)
  Required(blue)
  Admin(red)

tag Type
  Landing(purple)
  Form(orange)
  Content(cyan)

Home
  Auth: Public
  Type: Landing
  -pricing-> Pricing
  -login-> Login
  -docs-> Docs

[Marketing]
  Pricing
    Auth: Public
    Type: Content
    -sign up-> Register

  Docs
    Auth: Public
    Type: Content

[Auth]
  Login
    Auth: Public
    Type: Form
    -success-> Dashboard
    -forgot-> Reset Password

  Register
    Auth: Public
    Type: Form
    -success-> Dashboard

  Reset Password
    Auth: Public
    Type: Form
    -submitted-> Login

[App]
  Dashboard
    Auth: Required
    Type: Landing
    -projects-> Projects
    -settings-> Settings

  Projects
    Auth: Required
    Type: Content

  Settings
    Auth: Required
    Type: Form
    -saved-> Dashboard
```

**Pages**: Plain labels at any indent level become page nodes.

**Groups**: `[Group Name]` wraps indented children in a container.

**Arrows**: `-label-> Target`, `-(color)-> Target`, `-label(color)-> Target` — cross-link between any pages. Arrow colors are inferred from well-known labels (see flowchart section).

**Metadata**: `Key: Value` lines attach to the parent page (displayed as card rows).

**Tag groups**: `tag Name` with colored entries — same syntax as org charts.

**Direction**: `direction TB` (top-to-bottom, default) or `direction LR` (left-to-right). `orientation` is accepted as an alias for `direction`.

**Group metadata cascading**: `[Group Name] | key: value` — pipe metadata on group headers cascades to all pages in the group.

**Collapsible groups**: Groups can be collapsed/expanded in the app — arrows to hidden pages re-terminate at the group boundary.

### infra

**Syntax:** `infra [Title]`

**Options:** `direction` (`LR` or `TB`), `orientation` (alias for `direction`)

**Data format:** Component declarations with indented properties and connections

Minimal example:

```
infra

edge
  rps: 1000
  -> CDN

CDN
  cache-hit: 80%
  -> API

API
  instances: 2
  max-rps: 400
  latency-ms: 30
```

Full example:

```
infra Production Traffic Flow
direction LR

tag Team alias t
  Backend(blue)
  Platform(teal)

edge
  rps: 10000
  -> CloudFront

CloudFront | t: Platform
  cache-hit: 80%
  -> CloudArmor

CloudArmor | t: Platform
  firewall-block: 5%
  -> ALB

ALB | t: Platform
  -/api-> [API Pods] | split: 60%
  -/purchase-> [Commerce Pods] | split: 30%
  -/static-> StaticServer | split: 10%

[API Pods]
  APIServer | t: Backend
    instances: 3
    max-rps: 500
    latency-ms: 45
    cb-error-threshold: 50%

[Commerce Pods]
  PurchaseMS
    instances: 1-8
    max-rps: 300
    latency-ms: 120

StaticServer | t: Platform
  latency-ms: 5
```

**Entry point**: The `edge` block declares the external traffic source with `rps:` (requests per second). All downstream rps are computed automatically.

**Components**: Bare labels at indent 0 define infrastructure components. Properties are indented below:
- `cache-hit: N%` — percentage of traffic served from cache (reduces downstream flow)
- `firewall-block: N%` — percentage of traffic blocked (reduces downstream flow)
- `ratelimit-rps: N` — maximum rps allowed through (excess dropped)
- `max-rps: N` — maximum rps capacity per instance
- `instances: N` or `instances: N-M` — fixed or auto-scaling instance count
- `latency-ms: N` — per-request latency in milliseconds
- `cb-error-threshold: N%` — circuit breaker opens when overload exceeds this ratio
- `cb-latency-threshold-ms: N` — circuit breaker opens when cumulative latency exceeds this

**Type declarations**: `NodeName is a <type>` — declare a component's infrastructure role:
- `database`, `cache`, `queue`, `service`, `gateway`, `storage`, `function`, `network`
- Example: `Redis is a cache`, `SQS is a queue`

**Connections**:
- Sync: `-> Target` (unlabeled), `-label-> Target` (labeled)
- Async: `~> Target` (unlabeled), `~label~> Target` (labeled)
- Pipe metadata for splits: `-> Target | split: N%`
- Fan-out multiplier: `-> Target | fanout: 5` or `-> Target | split: 50%, fanout: 5`

**Fan-out**: Use `| fanout: N` metadata to model request multiplication — one inbound request triggers N outbound calls to the target. The target receives `inbound x N` RPS. Fan-out is applied after split: `-> Shards | split: 60%, fanout: 8` means the target receives `inbound x 0.60 x 8` RPS. Fan-out compounds naturally through multi-hop chains.

**Branching**: Multiple outbound connections with `split: N%` metadata. Splits must sum to 100%. Undeclared splits are evenly distributed from the remaining percentage.

**Groups**: `[Group Name]` with indented children — rendered as dashed-border containers. Edges targeting a group route to all children.

**Roles**: Inferred automatically from behavior properties or `is a` type declarations. Components with `cache-hit` get a Cache role, `firewall-block` gets Firewall, etc. Explicit declarations (`Redis is a cache`) set the role directly. Roles appear as colored dots on nodes and in the legend.

**Overload**: When computed rps exceeds `max-rps x instances`, the node turns red. Dynamic scaling (`instances: 1-8`) auto-scales within the range before overloading.

**Group metadata cascading**: `[Group Name] | key: value` — pipe metadata on group headers cascades to all children, providing default tag values for contained nodes.

**Tag groups**: Same syntax as org/kanban/sitemap — `tag Name alias x` with colored entries.

### gantt

**Syntax:** `gantt [Title]`

**Options:** `start` (required, `YYYY-MM-DD`), `today-marker` (`on`/`off` or `YYYY-MM-DD`), `sort` (`time`/`group`/`tag`/`tag:GroupName`), `critical-path`, `dependencies`

**Data format:** `duration Task Name` — tasks with optional dependency arrows

Minimal example:

```
start 2024-01-01

10bd Design
  -> Implementation
20bd Implementation
  -> Testing
5bd Testing
```

Auto-detection: Gantt charts are auto-detected when duration patterns like `10bd Design` are present — `gantt` is optional.

Full example:

```
gantt Project Schedule
start 2024-01-01
today-marker on

tag Team alias t
  Frontend(blue)
  Backend(green)

holidays
  2024-01-15: MLK Day
  2024-02-19: Presidents Day

era 2024-01 -> 2024-03 Phase 1(blue)
marker 2024-02-15 Sprint Review(orange)

[Design]
  5bd UX Research | t: Frontend
  10bd Wireframes | t: Frontend
    -informs-> API Design

[Engineering]
  15bd API Design | t: Backend
    -> Frontend Build | offset: 2bd
  20bd Frontend Build | t: Frontend
  10bd Integration Testing
```

**Start date**: `start YYYY-MM-DD` (required) — project start date for computing all task dates.

**Tasks**: `<duration> <name>` — duration units: `bd` (business days), `d` (days), `w` (weeks), `m` (months), `q` (quarters), `y` (years), `h` (hours), `min` (minutes).

**Explicit dates**: `YYYY-MM-DD Task Name` or `YYYY-MM-DD -> 30d Task Name` (date with duration).

**Uncertain end**: Append `?` to duration (e.g., `10bd? Task`) — renders with a fading tail.

**Dependencies**: `-label-> Target` or `-> Target` — indented under the source task. The target task starts after the source completes.

**Dependency offsets**: `-> Target | offset: 2bd` — positive offset adds a gap; `-> Target | offset: -3d` — negative offset creates overlap (lead time).

**Labeled dependency arrows**: `-label-> Target` — the label text appears on the rendered arrow.

**Groups**: `[Group Name]` wraps indented tasks in a collapsible section.

**Group metadata cascading**: `[Group Name] | key: value` — pipe metadata cascades to all tasks in the group.

**Eras**: `era YYYY-MM -> YYYY-MM Label(color)` — background shading bands.

**Markers**: `marker YYYY-MM-DD Label(color)` — vertical milestone lines.

**Holidays**: `holidays` block with `YYYY-MM-DD: Name` entries or `YYYY-MM-DD -> YYYY-MM-DD: Name` ranges. Holiday dates skip business-day counting.

**Tag groups**: Same syntax as other diagrams — `tag Name alias x` with colored entries.

---

## Tag Groups

Define reusable metadata categories for sequence, org, kanban, C4, sitemap, infra, gantt, initiative-status, and timeline diagrams:

```
tag Priority
  Critical(red)
  High(orange)
  Medium(yellow)
  Low(green) default

tag Team alias t
  Frontend(blue)
  Backend(green)
```

- `tag` keyword (case-insensitive)
- Optional `alias` for shorthand in metadata: `| t: Frontend`
- `default` keyword marks the fallback value
- Indented entries with `Value(color)`

Assign to elements via pipe metadata: `Element Name | priority: High, t: Frontend`

---

## Anti-Patterns

**Common mistakes to avoid:**

- `# comment` — wrong. Use `// comment`
- `chart: bar` + `title: Revenue` — wrong. Use `bar Revenue` (single first line)
- `Label: value` in ECharts data — wrong. Use `Label value` (no colon)
- `async A -> B: msg` — wrong. Use `A ~msg~> B`
- `parallel else` — not supported. Use separate `parallel` blocks
- Hex colors `#ff0000` — wrong. Use named colors only: `red`, `green`, `blue`, etc.
- `->` inside labeled arrows `A -routes to /api-> B` — ambiguous. Rephrase the label
- Missing chart type for ambiguous content — when auto-detection picks the wrong type, add an explicit chart type keyword
- `end` keyword in sequence blocks — not needed. Indentation closes blocks
- `== Column ==` in kanban — removed. Use `[Column]`
- `person Name` in C4 — removed. Use `Name is a person`
- `A <-> B` bidirectional arrows — removed. Use two separate lines
- `-> Target x5` fan-out — removed. Use `-> Target | fanout: 5`
- `lag: 5d` / `lead: 3d` in gantt — removed. Use `offset: 5d` / `offset: -3d`
- `Name(color)` in sequence participants — removed. Use `tag` groups for coloring

---

## CLI Usage

```bash
dgmo diagram.dgmo                              # PNG output (default)
dgmo diagram.dgmo -o output.svg                # SVG output
dgmo diagram.dgmo -o url                        # Shareable URL
dgmo diagram.dgmo --palette catppuccin --theme dark
dgmo diagram.dgmo -o output.png --palette bold
```

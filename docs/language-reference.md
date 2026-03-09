# DGMO Language Reference

DGMO is a text-based diagram markup language. Files use the `.dgmo` extension. Render with the `dgmo` CLI, the Diagrammo desktop app, or the `@diagrammo/dgmo` npm library.

## Common Patterns

Every `.dgmo` file can start with optional directives, followed by content.

### Directives

```
chart: bar              // explicit chart type (optional — auto-detected)
title: My Diagram       // diagram title
palette: nord           // color palette
```

### Comments

```
// This is a comment (only // is supported)
```

### Inline Colors

Append `(colorname)` to labels, nodes, or data points:

```
Port Royal(red): 850
[Process(blue)]
person Customer(green)
```

Named colors: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `teal`, `cyan`, `gray`. Palette-specific colors also available.

### Palettes and Themes

8 palettes: `nord` (default), `solarized`, `catppuccin`, `rose-pine`, `gruvbox`, `tokyo-night`, `one-dark`, `bold`

3 themes per palette: `light`, `dark`, `transparent`

Set via CLI: `dgmo diagram.dgmo --palette catppuccin --theme dark`

### Inline Markdown

Text fields support: `*italic*`, `**bold**`, `` `code` ``, `[link text](url)`. Bare URLs are auto-linked.

### Multi-line Values

Properties that accept comma-separated lists (`series`, `columns`, `rows`, `x-axis`, `y-axis`) also accept an indented multi-line format. Leave the value after the colon empty and list each value on its own indented line:

```
// Single-line (still works)
series: Rum, Spices, Silk, Gold

// Multi-line equivalent
series:
  Rum
  Spices
  Silk
  Gold
```

Multi-line blocks support blank lines and `//` comments within the block. Trailing commas on values are stripped for convenience.

```
series:
  Rum (red)
  Spices (green)
  // gold last
  Gold (yellow)
```

Works with `columns:` and `rows:` in heatmaps:

```
columns:
  January
  February
  March
```

---

## Chart Types

### bar

```
chart: bar
title: Revenue by Region
series: Revenue

North: 850
South: 620
East: 1100
West: 430
```

Options: `series`, `xlabel`, `ylabel`, `orientation` (`horizontal`/`vertical`), `labels` (`name`/`value`/`percent`/`full`), `color`.

Colors per item: `North(red): 850`

### line

```
title: Quarterly Performance
series: Sales(red), Costs(blue)

Q1: 100, 50
Q2: 120, 55
Q3: 110, 60
Q4: 130, 58
```

Multi-series: comma-separated values matching the `series` list. Single series omits `series` directive. Also works as `chart: multi-line`.

Options: `series`, `xlabel`, `ylabel`, `labels`.

### area

Same syntax as `line`. Renders as a filled area chart.

### pie

```
chart: pie
title: Market Share
labels: percent

Company A: 40
Company B: 35
Company C: 25
```

Options: `labels` (`name`/`value`/`percent`/`full`).

### doughnut

Same syntax as `pie`. Renders as a doughnut (ring) chart.

### polar-area

Same syntax as `pie`. Renders as a polar area (rose) chart.

### radar

```
chart: radar
title: Team Skills

Frontend: 85
Backend: 70
DevOps: 60
Design: 90
Testing: 75
```

### bar-stacked

```
chart: bar-stacked
title: Budget Allocation
series: Engineering, Marketing, Sales

Q1: 100, 50, 30
Q2: 110, 55, 35
Q3: 105, 60, 40
```

Options: `series` (required), `xlabel`, `ylabel`, `orientation`.

### scatter

```
chart: scatter
title: Performance Metrics
labels: on
xlabel: Experience (years)
ylabel: Output

Alice: 3, 85
Bob: 7, 92
Carol: 2, 70
```

Data: `Label: x, y` or `Label: x, y, size` (bubble chart). Group with `## Category(color)` headers.

Options: `labels` (`on`/`off`), `xlabel`, `ylabel`, `sizelabel`.

### heatmap

```
chart: heatmap
title: Activity by Month
columns: Jan, Feb, Mar, Apr, May, Jun

Team A: 5, 4, 5, 3, 4, 5
Team B: 2, 3, 2, 4, 3, 2
Team C: 3, 2, 1, 2, 3, 4
```

Options: `columns` (required).

### sankey

**Arrow syntax:**

```
chart: sankey
title: Resource Flow

Source A -> Processing: 300
Source B -> Processing: 200
Processing -> Output X: 350
Processing -> Output Y: 150
```

**Indentation syntax:**

```
chart: sankey
title: Resource Flow

Source A
  Processing: 300
Source B
  Processing: 200
Processing
  Output X: 350
  Output Y: 150
```

Both syntaxes can be mixed in the same diagram.

**Node colors** — `(color)` after a node name:

```
Revenue (green)
  Costs (red): 600
  Profit (blue): 400

// or with arrows
Revenue (green) -> Costs (red): 600
```

**Link colors** — `(color)` after the value:

```
Revenue
  Costs: 600 (orange)

// or with arrows
Revenue -> Costs: 600 (orange)
```

### chord

Same syntax as `sankey`. Renders as a circular chord diagram.

### funnel

```
chart: funnel
title: Conversion Pipeline

Visitors: 1000
Signups: 500
Trials: 200
Customers: 100
```

### function

```
chart: function
title: Trajectories
xlabel: Distance (m)
ylabel: Height (m)
x: 0 to 250

Low(blue): -0.001*x^2 + 0.27*x
High(red): -0.003*x^2 + 0.75*x
```

Options: `x: start to end` (required), `xlabel`, `ylabel`.

Expressions support: `+`, `-`, `*`, `/`, `^`, `sin`, `cos`, `sqrt`, `abs`, `log`, `exp`, `pi`, `e`.

### slope

```
chart: slope
title: Before vs After

Period A, Period B

Item 1: 40, 80
Item 2: 30, 50
Item 3: 60, 40
```

First data line defines the two period labels. Options: `orientation` (`horizontal`/`vertical`).

### wordcloud

```
chart: wordcloud
title: Top Terms

kubernetes: 95
docker: 80
terraform: 65
ansible: 50
```

Data: `word: weight` (higher = larger). Options: `rotate` (`none`/`mixed`/`angled`), `max` (word limit), `size: min, max` (font range).

### arc

```
chart: arc
title: Team Collaboration

## Frontend(blue)
Alice -> Bob: 8
Alice -> Carol: 5

## Backend(green)
Dave -> Carol: 10
```

Data: `Source -> Target: weight`. Group nodes with `## Group(color)` headers.

Options: `order` (`appearance`/`name`/`group`/`degree`), `orientation`.

### venn

```
chart: venn
title: Skill Overlap

dev(blue): 120 "Development"
ops(green): 100 "Operations"
sec(red): 80 "Security"

dev & ops: 35 "DevOps"
ops & sec: 40 "SecOps"
dev & sec: 30 "DevSec"
dev & ops & sec: 10 "DevSecOps"
```

Sets: `id(color): size "label"`. Overlaps: `id1 & id2: size "label"`. Options: `values` (`on`/`off`).

### quadrant

```
chart: quadrant
title: Priority Matrix
x-axis: Low Impact, High Impact
y-axis: Low Effort, High Effort

top-right: Quick Wins(green)
top-left: Big Bets(yellow)
bottom-left: Skip(red)
bottom-right: Reconsider(gray)

Task A: 0.9, 0.8
Task B: 0.2, 0.3
Task C: 0.7, 0.4
```

Options: `x-axis: low, high`, `y-axis: low, high`. Quadrant labels: `top-right`, `top-left`, `bottom-left`, `bottom-right`. Data: `Label: x, y` where x,y are 0–1.

### timeline

```
chart: timeline
title: Project History

era 2023->2024: Phase 1
marker 2023-06: Launch(orange)

## Team A(blue)
2023-01->2023-06: Planning
2023-06->2024-01: Development
2024-02: Release

## Team B(green)
2023-03->2023-09: Research
2023-09->2024-03?: Implementation
```

Date formats: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`. Ranges: `start->end`. Durations: `start->1y`, `start->6m`, `start->2w`, `start->30d`. Uncertain end: append `?` (e.g., `2024-03?`).

Elements: `era start->end: Label(color)`, `marker date: Label(color)`, `## Group(color)` headers.

Tag groups for interactive coloring and swimlanes:

```
chart: timeline
sort: tag:Team

tag: Team
  Engineering(blue)
  Design(green)

2024-01->2024-06: Build API | Team: Engineering
2024-03->2024-05: UX Review | Team: Design
```

Options: `scale` (`on`/`off`), `sort` (`time`/`group`/`tag`/`tag:GroupName`), `swimlanes` (`on`/`off`).

Tag groups add interactive color and swimlane controls. `sort: tag` uses the first tag group for swimlanes; `sort: tag:GroupName` specifies which group (aliases work: `sort: tag:p` resolves to `sort: tag:Pirate`).

---

## Diagram Types

### sequence

Minimal example:

```
User -login-> API
API -findUser-> DB
DB -user-> API
API -token-> User
```

Full example:

```
chart: sequence
title: Authentication Flow

// participant declarations (optional)
User is an actor
API is a service
DB is a database
NotifyQueue is a queue aka Notifications

User -Login request-> API
API -Find user by email-> DB
DB -user record-> API
note on DB:
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
- `note: text` — standalone
- `note on Participant: text` — anchored
- Multi-line: indent continuation lines under `note:`

**Sections**: `== Section Title ==`

**Groups**: `[Group Name]` or `[Group Name | key: value]` — visual grouping box around participants

**Options**: `activations: off`, `collapse-notes: no`, `active-tag: GroupName`

**Tag groups** — define color-coded metadata dimensions for interactive recoloring:

```
tag: Concern alias c
  Caching(blue)
  Auth(green)
  BusinessLogic(purple) default
```

- `tag: Name` declares a tag group; `alias x` adds a shorthand
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

Minimal example:

```
(Start) -> [Process] -> (End)
```

Full example:

```
chart: flowchart
title: Decision Process

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

Colors on nodes: `[Process(blue)]`

### state

Minimal example:

```
[*] -> Idle -> Active -> [*]
```

Full example:

```
chart: state
title: Order Lifecycle
direction: LR

## Processing(blue)
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

**Groups**: `## GroupName` or `## GroupName(color)` — groups subsequent indented states visually.

**Self-loops**: `Running -retry-> Running` — a state transitioning to itself.

**Options**: `direction` (`TB` or `LR`), `title`, `color: off` (monochrome mode).

### class

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
chart: class
title: Type Hierarchy

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
chart: er
title: Blog Schema

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

Minimal example:

```
chart: c4

person User
system MyApp | description: The main application
  -Uses-> User
```

Full example:

```
chart: c4
title: Banking System

tag: Scope alias sc
  Internal(blue) default
  External(gray)

person Customer | description: A customer of the bank

system Internet Banking | description: Online banking portal
  -Delivers content [HTTPS]-> Customer
  -Sends emails [SMTP]-> Email

  containers:
    container Web App | description: SPA, tech: React
      -API calls [JSON/HTTPS]-> API

    container API | description: Backend, tech: Node.js
      -Reads/writes [SQL]-> Database

    container Database | description: Data store, tech: PostgreSQL

system Email | description: Email delivery, sc: External
  ~Sends emails~> Customer

deployment:
  Vercel is a cloud
    container Web App
  Railway
    container API
  Neon is a database
    container Database
```

**Element types**: `person`, `system`, `container`, `component`

**Metadata** (pipe-delimited): `element Name | description: text, tech: stack, tagalias: value`

**Sections**: `containers:` (inside system), `components:` (inside container), `deployment:`

**Deployment nodes**: `NodeName is a [cloud|database|cache|queue|external]`

**Relationships**:
- Sync: `-> Target` or `-label [tech]-> Target`
- Async: `~> Target` or `~label [tech]~> Target`
- Bidirectional: `<-> Target`, `<~> Target`

**Tag groups**: See tag group syntax below.

### org

Minimal example:

```
chart: org

CEO
  VP Engineering
    Team Lead
  VP Marketing
```

Full example:

```
chart: org
title: Engineering Org
sub-node-label: Reports
show-sub-node-count: yes

tag: Level alias lv
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

Options: `sub-node-label`, `show-sub-node-count` (`yes`/`no`).

**Imports**: `import: path/to/file.dgmo` (indented under a parent node), `tags: path/to/tags.dgmo` (top-level).

### kanban

Minimal example:

```
chart: kanban

== To Do ==
Task 1
Task 2

== Done ==
Task 3
```

Full example:

```
chart: kanban
title: Sprint Board

tag: Priority
  Critical(red)
  High(orange)
  Low(green) default

tag: Owner alias o
  Alice(blue)
  Bob(green)

== Backlog(gray) ==
Research API options | priority: High, o: Alice

== In Progress [wip: 3](orange) ==
Build auth module | priority: Critical, o: Bob
  Integrate OAuth2
  Add session management

== Done(green) ==
Setup CI pipeline | priority: High, o: Alice
```

**Columns**: `== Column Name ==`, `== Column Name(color) ==`, `== Column Name [wip: N] ==`

**Cards**: `Card Title | tag: value`. Indented lines below become card details.

### initiative-status

Minimal example:

```
chart: initiative-status

Auth | done
  -> UserService | wip
  -> NotifyService | todo
UserService | wip
NotifyService | todo
```

Full example:

```
chart: initiative-status
title: Platform Roadmap

Auth | done
  -depends-> UserService | wip
  -feeds-> Dashboard | todo
Dashboard | todo
UserService | wip
  -calls-> DBLayer | done
DBLayer | done

[External]
  PaymentGW | na
  EmailProvider | na
```

**Status values**: `done`, `wip`, `todo`, `na`

**Relationships**: `-label-> Target | status` or indented children.

**Groups**: `[Group Name]` for visual grouping.

### sitemap

Minimal example:

```
chart: sitemap

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
chart: sitemap
title: SaaS Platform
direction: TB

tag: Auth
  Public(green)
  Required(blue)
  Admin(red)

tag: Type
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

**Arrows**: `-label-> Target`, `-(color)-> Target`, `-label(color)-> Target` — cross-link between any pages.

**Metadata**: `Key: Value` lines attach to the parent page (displayed as card rows).

**Tag groups**: `tag: Name` with colored entries — same syntax as org charts.

**Direction**: `direction: TB` (top-to-bottom, default) or `direction: LR` (left-to-right).

**Collapsible groups**: Groups can be collapsed/expanded in the app — arrows to hidden pages re-terminate at the group boundary.

### infra

Minimal example:

```
chart: infra

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
chart: infra
title: Production Traffic Flow
direction: LR

tag: Team alias t
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

**Connections**: `-> Target` (unlabeled), `-label-> Target` (labeled). Pipe metadata for splits: `-> Target | split: N%`.

**Branching**: Multiple outbound connections with `split: N%` metadata. Splits must sum to 100%. Undeclared splits are evenly distributed from the remaining percentage.

**Groups**: `[Group Name]` with indented children — rendered as dashed-border containers. Edges targeting a group route to all children.

**Roles**: Inferred automatically from behavior properties — no type declarations needed. Components with `cache-hit` get a Cache role, `firewall-block` gets Firewall, etc. Roles appear as colored dots on nodes and in the legend.

**Overload**: When computed rps exceeds `max-rps × instances`, the node turns red. Dynamic scaling (`instances: 1-8`) auto-scales within the range before overloading.

**Direction**: `direction: LR` (left-to-right, default) or `direction: TB` (top-to-bottom).

**Tag groups**: Same syntax as org/kanban/sitemap — `tag: Name alias x` with colored entries.

---

## Tag Groups

Define reusable metadata categories for org charts, kanban boards, C4 diagrams, sitemaps, and infra charts:

```
tag: Priority
  Critical(red)
  High(orange)
  Medium(yellow)
  Low(green) default

tag: Team alias t
  Frontend(blue)
  Backend(green)
```

- `tag:` keyword (case-insensitive)
- Optional `alias` for shorthand in metadata: `| t: Frontend`
- `default` keyword marks the fallback value
- Indented entries with `Value(color)`

Assign to elements via pipe metadata: `Element Name | priority: High, t: Frontend`

---

## Anti-Patterns

**Common mistakes to avoid:**

- `# comment` — wrong. Use `// comment`
- `async A -> B: msg` — wrong. Use `A ~msg~> B`
- `parallel else` — not supported. Use separate `parallel` blocks
- Hex colors in sections `== Foo(#ff0000) ==` — wrong. Use named colors: `== Foo(red) ==`
- `->` inside labeled arrows `A -routes to /api-> B` — ambiguous. Rephrase the label
- Missing `chart:` for ambiguous content — when auto-detection picks the wrong type, add an explicit `chart:` directive
- `end` keyword in sequence blocks — not needed. Indentation closes blocks

---

## CLI Usage

```bash
dgmo diagram.dgmo                              # PNG output (default)
dgmo diagram.dgmo -o output.svg                # SVG output
dgmo diagram.dgmo -o url                        # Shareable URL
dgmo diagram.dgmo --palette catppuccin --theme dark
dgmo diagram.dgmo -o output.png --palette bold
```

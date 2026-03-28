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

## Table of Contents

1. [Universal Constructs](#1-universal-constructs)
2. [Sequence Diagrams](#2-sequence-diagrams)
3. [Infrastructure Diagrams](#3-infrastructure-diagrams)
4. [Flowchart Diagrams](#4-flowchart-diagrams)
5. [State Diagrams](#5-state-diagrams)
6. [Org Charts](#6-org-charts)
7. [C4 Architecture Diagrams](#7-c4-architecture-diagrams)
8. [Entity-Relationship Diagrams](#8-entity-relationship-diagrams)
9. [Class Diagrams](#9-class-diagrams)
10. [Kanban Boards](#10-kanban-boards)
11. [Initiative-Status Diagrams](#11-initiative-status-diagrams)
12. [Sitemap Diagrams](#12-sitemap-diagrams)
13. [Gantt Charts](#13-gantt-charts)
14. [Timeline Diagrams](#14-timeline-diagrams)
15. [Data Charts](#15-data-charts)
16. [Visualizations](#16-visualizations)
17. [Colon Usage Summary](#17-colon-usage-summary)

---

## 1. Universal Constructs

These patterns are shared across all or most diagram types.

### 1.1 Chart Type Declaration (First Line)

```
<chart-type> [Title]
```

- Space-separated, NO colon
- Title is optional
- Examples: `bar Treasure Hauls`, `sequence Auth Flow`, `gantt Product Launch`

### 1.2 Comments

```
// comment text
```

- Full-line only (no inline comments after code)
- `#` is NOT a comment character

### 1.3 Tag Declarations

```
tag GroupName [alias X]
  Value1(color)
  Value2(color) [default]
```

- `tag` keyword, NO colon
- Alias: 1-4 lowercase letters
- Inline values also supported: `tag Priority p Low(green), High(red)`
- First entry is default unless another is marked `default`
- Must appear before diagram content

**Diagram types that support tags**: sequence, infra, org, c4, er, kanban, gantt, initiative-status, sitemap, timeline

### 1.4 Pipe Metadata

```
EntityName | key: value, key2: value2
```

- Colons ARE required within pipe segments (`key: value`)
- Items separated by commas
- Tag aliases resolve: `| c: Caching` resolves to `concern: Caching` (if `tag Concern alias c` is defined)
- One pipe per line only

### 1.5 Color Suffixes

```
Label(colorName)
```

- Named palette colors only (no hex codes)
- Appears at end of labels, node names, tag values, series names
- Color is stripped from display text

### 1.6 Indentation

- Spaces or tabs (1 tab = 4 spaces)
- Determines hierarchy and block scope

### 1.7 Groups / Containers

```
[Group Name]
[Group Name](color)
[Group Name] | key: value
```

- Bracket-enclosed name
- Optional color suffix
- Optional pipe metadata (outside brackets)
- Indented content below belongs to the group

### 1.8 Boolean Options

```
option-name          // on
no-option-name       // off
```

- Bare keyword = on; `no-` prefix = off
- Must appear before diagram content

---

## 2. Sequence Diagrams

### 2.1 Participants

```
Name is a <type> [aka Alias] [position N]
Name | key: value
```

Types: `service`, `database`, `actor`, `queue`, `cache`, `gateway`, `external`, `networking`, `frontend`

**Inference rules** — the parser infers the type (and shape) from the participant name. Only use `is a` when the name does not match or you want to override:

| Inferred Type | Shape | Name Patterns (examples) |
|--------------|-------|--------------------------|
| actor | Stick figure | `User`, `Customer`, `Client`, `Admin`, `Agent`, `Person`, `Buyer`, `Seller`, `Guest`, `Visitor`, `Operator`, Alice, Bob, Charlie, `*User`, `*Actor`, `*Analyst`, `*Staff` |
| service | Rounded rectangle | `*Service`, `*Svc`, `*API`, Lambda, `*Function`, `*Fn`, `*Job`, Cron, Auth, SSO, OAuth, Stripe, Twilio, S3, Vercel, Docker, K8s, Vault, KMS, IAM, LLM, GPT, Claude, `*Pipeline`, `*Engine`, and many `-er`/`-or` suffixes (Scheduler, Handler, Processor, Worker, etc.) |
| database | Cylinder (vertical) | `*DB`, `Database`, `*Store`, `Storage`, `*Repo`, `SQL`, Postgres, MySQL, Mongo, Dynamo, Aurora, Spanner, Supabase, Firebase, BigQuery, Redshift, Snowflake, Cassandra, Neo4j, ClickHouse, Elastic, OpenSearch, Pinecone, Weaviate, `*Table` |
| cache | Dashed cylinder | `*Cache`, Redis, Memcache, KeyDB, Dragonfly, Hazelcast, Valkey |
| queue | Horizontal cylinder (pipe) | `*Queue`, `*MQ`, SQS, Kafka, RabbitMQ, `EventBus`, `*Bus`, `Topic`, `*Stream`, SNS, PubSub, NATS, Pulsar, Kinesis, EventBridge, Celery, Sidekiq, `*Channel`, `*Broker` |
| networking | Hexagon | `*Router`, `*Balancer`, `Gateway`, `Proxy`, `LB`, `CDN`, `Firewall`, `WAF`, `DNS`, `Ingress`, Nginx, Traefik, Envoy, Istio, Kong, Akamai, Cloudflare, `*Mesh` |
| frontend | Monitor (screen + stand) | `*App`, `Application`, `Mobile`, iOS, Android, `Web`, `Browser`, `Frontend`, `*UI`, `Dashboard`, `*CLI`, `Terminal`, React, Vue, Angular, Svelte, NextJS, Electron, Tauri, `*Widget`, `Portal`, `*Console`, SPA, PWA |
| gateway | Rectangle (same as default) | matched via `is a gateway` only |
| external | Dashed rectangle | `External`, `*Ext`, `ThirdParty`, `*3P`, `Vendor`, `Webhook`, `Upstream`, `Downstream`, `Callback`, AWS, GCP, Azure |
| default | Rectangle | Everything else (no `is a` needed) |

**Inference handles it (skip `is a`):**
```
AuthService          // service (matches *Service)
PostgresDB           // database (matches *DB)
Redis                // cache (exact match)
User                 // actor (exact match)
Kafka                // queue (exact match)
API Gateway          // networking (matches Gateway)
WebApp               // frontend (matches *App)
Stripe               // service (exact match)
```

**Inference would miss (use `is a`):**
```
Payments is a service       // "Payments" matches no rule
Vault is a database         // "Vault" infers as service, but you want database
Notifications is a queue    // "Notifications" matches no rule
Analytics is a frontend     // "Analytics" matches no rule
```

### 2.2 Participant Groups

```
[Group Name]
  Participant1
  Participant2
```

- Pipe metadata goes outside brackets: `[Backend] | t: Eng`
- Invalid: `[Backend | t: Eng]` (pipe inside brackets)

### 2.3 Messages (Arrows)

| Type | Syntax | Example |
|------|--------|---------|
| Sync (labeled) | `A -label-> B` | `Client -login-> API` |
| Sync (bare) | `A -> B` | `Client -> API` |
| Async (labeled) | `A ~label~> B` | `API ~notify~> Queue` |
| Async (bare) | `A ~> B` | `API ~> Queue` |

- Whitespace around arrows is optional: `A-label->B` works
- Labels can contain spaces, hyphens, special chars
- Labels cannot contain arrow chars (`->`, `~>`)
- Pipe metadata: `A -msg-> B | c: Caching`

### 2.4 Section Dividers

```
== Label ==
== Label
```

Trailing `==` is optional.

### 2.5 Notes

```
note Text
note right Text
note left of ParticipantID Text
```

**Multi-line notes** use an indented body below the `note` heading:

```
note right of API
  - First bullet point
  - Second bullet point
  **Bold text** and *italic text*
  `inline code`
  [link text](https://example.com)
  https://example.com
```

Content formatting:
- `- ` prefix on indented lines = bullet points
- Inline markdown: `**bold**`, `*italic*`, `` `code` ``
- Links: `[text](url)` and bare URLs (auto-truncated in display)

### 2.6 Structural Blocks

```
if condition
  messages...
else if condition
  messages...
else
  messages...

loop condition
  messages...

parallel label
  messages...
```

- `parallel` requires a label
- Blocks nest via indentation

### 2.7 Sequence Options

- `activations` / `no-activations`
- `collapse-notes` / `no-collapse-notes`
- `active-tag GroupName`

---

## 3. Infrastructure Diagrams

### 3.1 Declaration

```
infra [Title]
```

### 3.2 Nodes

```
NodeName
NodeName | key: value
```

Nodes are plain names. Capabilities come from properties (see 3.3), not type declarations.

### 3.3 Node Properties (Indented, Space-Separated, NO Colon)

```
NodeName
  latency-ms 50
  max-rps 8000
  uptime 99.99%
  cache-hit 75%
  description My API gateway
  firewall-block 10%
  instances 3
```

Properties use a known schema with space-separated values:

| Property | Capability | Effect |
|----------|-----------|--------|
| `cache-hit` | Cache | % requests served from cache, reduces downstream RPS |
| `firewall-block` | Firewall/WAF | % requests blocked, reduces downstream RPS |
| `ratelimit-rps` | Rate limiter | Max RPS passed through |
| `latency-ms` | Latency | Adds to path latency |
| `uptime` | Availability | Multiplied along path for SLO |
| `instances` | Horizontal scaling | Multiplies capacity |
| `max-rps` | Capacity ceiling | Max RPS node handles |
| `cb-error-threshold` | Circuit breaker | Error rate trip threshold |
| `cb-latency-threshold-ms` | Circuit breaker | Latency trip threshold |
| `concurrency` | Concurrency limit | Max concurrent requests |
| `duration-ms` | Processing time | Time spent processing |
| `cold-start-ms` | Serverless | Cold start penalty |
| `buffer` | Queue | Buffer size |
| `drain-rate` | Queue | Consumption rate |
| `retention-hours` | Queue | Message retention |
| `partitions` | Queue | Partition count |
| `description` | Display | Description text |

### 3.4 Connections

| Type | Syntax |
|------|--------|
| Sync (bare) | `-> Target` |
| Sync (labeled) | `-/api-> Target` |
| Async (bare) | `~> Target` |
| Async (labeled) | `~event~> Target` |

- Connection metadata: `| split: 50%, fanout: 3` (colons in pipe metadata)
- Indented under source node

### 3.5 Groups

```
[Group Name]
[Group Name](color)
[Group Name] | key: value
```

Bracket syntax only. Optional color and pipe metadata.

### 3.6 Infra Options (Space-Separated, NO Colon)

- `direction-tb` (boolean; default is LR)
- `default-latency-ms N`
- `default-rps N`
- `default-uptime DECIMAL`
- `slo-availability DECIMAL`
- `slo-p90-latency-ms N`
- `animate` / `no-animate`

### 3.7 Edge Nodes

```
edge
internet
```

Special top-level entry points. `internet` only accepts `rps` property.

---

## 4. Flowchart Diagrams

### 4.1 Declaration

```
flowchart [Title]
```

### 4.2 Node Shapes

| Shape | Syntax | Example |
|-------|--------|---------|
| Terminal | `(Label)` | `(Start)` |
| Process | `[Label]` | `[Do Task]` |
| Decision | `<Label>` | `<Check?>` |
| I/O | `/Label/` | `/Read Input/` |
| Subroutine | `[[Label]]` | `[[Validate]]` |
| Document | `[Label~]` | `[Report~]` |

- Color suffix: `(Start(green))`

### 4.3 Arrows

| Type | Syntax |
|------|--------|
| Unlabeled | `->` |
| Labeled | `-label->` |
| Colored | `-(color)->` |
| Labeled + colored | `-label(color)->` |

- Color inference: `yes/success/ok/true` infers green; `no/fail/error/false` infers red

### 4.4 Groups

```
[GroupName]
  [Child nodes...]
```

Bracket syntax only.

### 4.5 Inline Chains

```
(Start) -> [Step 1] -> [Step 2] -> (End)
```

### 4.6 Options

- `direction-lr` (boolean; default is TB)
- `orientation-vertical` (boolean; default is horizontal)

---

## 5. State Diagrams

### 5.1 Declaration

```
state [Title]
```

### 5.2 States

```
StateName
StateName(color)
[*]                    // initial/final pseudostate
```

### 5.3 Transitions

| Type | Syntax |
|------|--------|
| Unlabeled | `Idle -> Active` |
| Labeled | `Idle -submit-> Processing` |
| Colored | `Idle -(blue)-> Active` |

### 5.4 Groups

```
[Group Name]
[Group Name](color)
```

### 5.5 Options

- `direction-tb` (boolean; default is LR)

---

## 6. Org Charts

### 6.1 Declaration

```
org [Title]
```

### 6.2 Nodes (Indentation = Hierarchy)

```
CEO
  CTO
    Engineer1
    Engineer2
  CFO
```

- Color suffix: `Alice(blue)`
- Pipe metadata: `Alice | role: CEO, t: Exec`

### 6.3 Metadata (Indented, Colon REQUIRED)

```
Alice
  role: Senior Engineer
  location: NYC
```

This is key-value metadata assignment, consistent with pipe metadata syntax.

### 6.4 Containers

```
[Team Name]
  members...
```

### 6.5 Options

- `direction-tb` (boolean; default is LR)
- `sub-node-label Text`
- `show-sub-node-count`
- `hide`

---

## 7. C4 Architecture Diagrams

### 7.1 Declaration

```
c4 [Title]
```

### 7.2 Elements

```
Name is a <type>
Name is a container is a database     // shape override
```

Types: `person`, `system`, `container`, `component`
Shape overrides: `database`, `cache`, `queue`, `cloud`, `external`

### 7.3 Element Metadata (Indented, Colon REQUIRED)

```
Web App is a container
  description: SPA built with React
  tech: React
```

Indented metadata uses colon-separated `key: value`, consistent with org charts and pipe metadata.

### 7.4 Pipe Metadata (Colons in pipes)

```
Web App is a container | description: SPA, tech: React
```

### 7.5 Relationships

| Type | Syntax |
|------|--------|
| Sync labeled | `-Makes API calls-> API` |
| Sync with tech | `-Uses [HTTPS]-> API` |
| Async labeled | `~Sends emails~> Email` |

### 7.6 Sections

```
containers
  ...
components
  ...
deployment
  container Web App    // reference existing container
```

### 7.7 Options

- `direction-tb` (boolean; default is LR)

---

## 8. Entity-Relationship Diagrams

### 8.1 Declaration

```
er [Title]
```

### 8.2 Tables

```
users
users(blue)
users | domain: Core
```

- Pipe metadata on declaration line only
- Indented lines are columns or relationships

### 8.3 Columns (Indented, Space-Separated, NO Colon)

```
users
  id int pk
  name varchar
  email string unique
  created_at timestamp nullable
```

Format: `name [type] [constraints...]`
Constraints: `pk`, `fk`, `unique`, `nullable`

### 8.4 Relationships (Indented Under Source Table)

```
ships
  1-aboard-* crew_members
  ?-frequents-1 ports
```

Cardinality symbols: `1` (one), `*` (many), `?` (optional)

### 8.5 Options

- `notation chen` / `notation crow`

---

## 9. Class Diagrams

### 9.1 Declaration

```
class [Title]
```

### 9.2 Classes

```
Ship
abstract Vessel
interface Serializable
Ship extends Vessel
Galleon implements Serializable
ShipType enum
```

### 9.3 Members (Indented, Colon for Types)

**Fields:**
```
+ name: string
- speed: number
# protectedField: int
```

**Methods:**
```
+ sail(): void
- calculate(x: number): boolean
+ getName() {static}: string
```

Visibility: `+` public, `-` private, `#` protected

**Enum values:**
```
ShipType enum
  Galleon
  Sloop
```

### 9.4 Relationships (Indented Under Source Class)

| Relationship | Arrow |
|-------------|-------|
| Inheritance | `--|>` |
| Implementation | `..\|>` |
| Composition | `*--` |
| Aggregation | `o--` |
| Dependency | `..>` |
| Association | `->` |

Relationships are indented under the source class:

```
Ship
  --|> Vessel
  *-- Cannon
```

Optional label: `--|> Vessel : extends` (colon optional before label)

`extends` and `implements` on class declarations still work as part of the declaration syntax.

### 9.5 Options

- `no-auto-color` (boolean; auto-coloring is on by default)

---

## 10. Kanban Boards

### 10.1 Declaration

```
kanban [Title]
```

### 10.2 Columns

```
[Column Name]
[Column Name](color) | wip: 3
```

### 10.3 Cards (Indented Under Columns)

```
[To Do]
  Card title | priority: High, c: Owner
    Detail text (indented deeper)
```

### 10.4 Options

- `no-auto-color` (boolean; auto-coloring is on by default)
- `hide`

---

## 11. Initiative-Status Diagrams

### 11.1 Declaration

```
initiative-status [Title]
```

### 11.2 Nodes

```
NodeLabel | status, key: value
NodeLabel | done, t: Team1
```

Status values and equivalences:

| User writes | Canonical | Display |
|------------|-----------|---------|
| `done` | `done` | Done |
| `doing` | `doing` | In Progress |
| `wip` | `doing` | In Progress |
| `blocked` | `blocked` | Blocked |
| `paused` | `blocked` | Blocked |
| `waiting` | `blocked` | Blocked |
| `todo` | `todo` | To Do |
| `na` | `na` | N/A |
| (omitted) | `na` | N/A |

### 11.3 Edges

```
Source -> Target
Source -label-> Target
Source -> Target | status
```

Indented shorthand (source from preceding node):
```
Captain | t: Bridge
  -issueOrders-> CrewApp | na
```

### 11.4 Groups

```
[Group Name]
  indented nodes...
```

### 11.5 Options

- `active-tag GroupName`
- `hide phase:Planning, phase:Review` (colon syntax for tag:value)

---

## 12. Sitemap Diagrams

### 12.1 Declaration

```
sitemap [Title]
```

### 12.2 Pages (Indentation = Hierarchy)

```
Home
  About
  Pricing | Auth: Public
    Enterprise
  Blog
```

### 12.3 Arrows

```
Home
  -pricing-> Pricing
  -login-> Login
```

### 12.4 Containers

```
[Marketing]
  Pricing | Auth: Public
```

### 12.5 Options

- `direction-tb` (boolean; default is LR)

---

## 13. Gantt Charts

### 13.1 Declaration

```
gantt [Title]
```

### 13.2 Options (Space-Separated, NO Colon)

```
start 2026-03-15
today-marker
today-marker 2026-03-27
critical-path
no-dependencies
sort tag:Team
```

### 13.3 Holidays

```
holiday
  2024-02-19 Presidents Day
  2024-05-27 -> 2024-05-29 Memorial Weekend
```

### 13.4 Workweek

```
workweek mon-fri
workweek sun-thu
```

Top-level directive (not nested under `holiday`).

### 13.5 Eras

**Flat form:**
```
era 2026-04-06 -> 2026-04-10 Conference (purple)
```

**Block form:**
```
era
  2026-04-06 -> 2026-04-10 Conference (purple)
  2026-06-01 -> 2026-06-05 Sprint Review (blue)
```

### 13.6 Markers

**Flat form:**
```
marker 2026-03-27 Board Review
```

**Block form:**
```
marker
  2026-03-27 Board Review
  2026-06-15 Release (green)
```

### 13.7 Groups (Swimlanes)

```
[Backend] | t: Engineering
```

Bracket syntax only.

### 13.8 Tasks

```
20bd Database Schema | p: Foundation, 100%
10bd API Integration | t: Engineering
0d Launch Day
2026-03-15 -> 30d Setup
```

Duration units: `min`, `h`, `d`, `bd` (business days), `w`, `m`, `q`, `y`
Uncertain: `10bd?` (trailing `?`)
Progress: `| 80%` in pipe metadata

### 13.9 Dependencies (Indented Under Tasks)

```
10bd API Integration
  -> E2E Testing
  -> Launch Day | offset: 10bd
```

### 13.10 Parallel Block

```
parallel
  [Backend]
    20bd Schema
  [Frontend]
    10bd Wireframes
```

---

## 14. Timeline Diagrams

### 14.1 Declaration

```
timeline [Title]
```

### 14.2 Events

**Point event:**
```
1718-05 Blockades Charleston | p: Blackbeard
```

**Range event:**
```
1716 -> 1717 Sails under Hornigold | p: Blackbeard
```

**Duration event:**
```
2026-03-20 -> 30d Sprint 1
```

**Uncertain ending:**
```
1718 -> 1719? Rackham builds crew
```

Date formats: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, `YYYY-MM-DD HH:MM`
Duration units: `min`, `h`, `d`, `w`, `m`, `y`

### 14.3 Eras

**Flat form:**
```
era 1716 -> 1718 Nassau Republic
```

**Block form:**
```
era
  1716 -> 1718 Nassau Republic
  1718 -> 1720 Woodes Rogers Era (orange)
```

### 14.4 Markers

**Flat form:**
```
marker 1718-07 Woodes Rogers arrives (orange)
```

**Block form:**
```
marker
  1718-07 Woodes Rogers arrives (orange)
  1720-01 End of Golden Age (red)
```

### 14.5 Groups

```
[Royal Navy]
  1718-07 Woodes Rogers arrives
```

---

## 15. Data Charts

### 15.1 Simple Charts (bar, line, pie, doughnut, area, polar-area, radar, bar-stacked)

**Declaration:** `bar [Title]`, `line [Title]`, etc.

**Series:**
```
series Name1 Name2
series
  Name1
  Name2(color)
```

Commas between series names are optional.

**Data rows (space-separated, NO colon):**
```
Label 100
Label 100 200 300
Label(color) 100
```

Commas between values are optional. Thousands commas are supported (`3,984,078.65` is a valid number).

**Options (space-separated, NO colon):**
```
title My Chart
xlabel X Label
ylabel Y Label
orientation-horizontal
stacked
```

- `orientation-horizontal` (boolean; default is vertical bars)
- `stacked` (boolean; default is off)
- Legend is always shown (no option needed)

**Labels** default to showing all parts (name + value + percent for pie-family). Disable parts individually:
- `no-label-name` — hide name
- `no-label-value` — hide value
- `no-label-percent` — hide percent

**Eras (line/area only):**
```
era Day 1 -> Day 3 Rough Seas (red)
```

### 15.2 Scatter / Bubble Charts

**Data rows (space-separated, NO colon):**
```
Name x y
Name x y size
```

Commas between values are optional. Thousands commas supported.

**Categories:**
```
[Caribbean](red)
  Blackbeard 90 8500
```

**Options:**
```
xlabel Weight
ylabel Height
sizelabel Crew
no-labels
```

Labels are on by default. Use `no-labels` to hide point names.

### 15.3 Heatmap

**Columns:**
```
columns Jan Feb Mar
```

Commas between column names are optional.

**Data rows (space-separated, NO colon):**
```
RowLabel 5 4 3
```

Commas between values are optional. Thousands commas supported.

### 15.4 Function Charts (Colon REQUIRED)

```
function Trajectories
xlabel Distance
ylabel Height
x 0 to 250

15 degrees(blue): -0.001*x^2 + 0.27*x
45 degrees(red): -0.003*x^2 + 0.75*x
```

The colon between name and expression is **required** — both sides can contain spaces, so colon is the unambiguous delimiter.

**Options:**
- `shade` (boolean; off by default, shades area below curves when enabled)

### 15.5 Sankey Charts

**Tree structure (indented, space-separated):**
```
Sugar Plantations(green)
  Tortuga Distillery(orange) 3000
  Nassau Distillery 2500
```

**Explicit links:**
```
Source -> Target 3500
Source -- Target 2000
```

`->` = directed, `--` = undirected. Thousands commas supported in values.

### 15.6 Chord Charts

```
Blackbeard -- Bonnet 150        // undirected
Roberts -> Rackham 20           // directed
```

Thousands commas supported in values.

### 15.7 Funnel Charts

**Data rows (space-separated, NO colon):**
```
Visits 1200
Signups 800
Purchases 200
```

Thousands commas supported.

---

## 16. Visualizations

### 16.1 Slope Charts (Colon REQUIRED for data)

```
slope Fleet Strength

1715 1725

Blackbeard: 40 4
Roberts: 12 52
```

- Period labels on their own line, commas optional
- Data rows: `Label: value1 value2` — colon required, commas between values optional
- Thousands commas supported in values

### 16.2 Wordcloud

```
wordcloud Pirate Skills
rotate none
max 50
size 14 80

swordsmanship 95
navigation 88
```

- Data: space-separated only (`word value`)
- Options: `rotate none|mixed|angled`, `max N`, `size min max`

### 16.3 Arc Diagrams

```
arc Pirate Alliances

[Caribbean](red)
  Blackbeard -> Bonnet 8
  Blackbeard -> Vane 5

order group
```

- Link: `Source -> Target weight` — space before optional weight
- Options: `order appearance|name|group|degree`

### 16.4 Venn Diagrams

```
venn Skill Overlap

Swordsmanship(red) alias sw
Navigation(blue) alias nav
Leadership(green) alias lead

sw + nav Sea Raiders
sw + nav + lead Legendary Pirates
```

- Set declaration: `Name(color) alias X`
- Intersections: `Set1 + Set2 Label` — label follows the last set reference (no colon)

### 16.5 Quadrant Diagrams

```
quadrant Crew Assessment
x-axis Low Skill, High Skill
y-axis Low Loyalty, High Loyalty

top-right Promote (green)
top-left Train (yellow)
bottom-left Maroon (red)
bottom-right Watch Closely (purple)

Quartermaster 0.9, 0.95
Navigator 0.85, 0.8
```

- Axis labels: `x-axis Low, High` — space-separated
- Position labels: `top-right Label` — space-separated
- Data points: `Label x, y` — space-separated, comma between coordinates
- Thousands commas supported in values

---

## 17. Colon Usage Summary

### Constructs Where Colons Are REQUIRED

| Construct | Diagram Type | Example |
|-----------|-------------|---------|
| Pipe metadata | all | `\| key: value, key2: value2` |
| Org metadata (indented) | org | `role: Manager` |
| C4 metadata (indented) | c4 | `description: SPA built with React` |
| Class field types | class | `+ name: string` |
| Class method returns | class | `+ sail(): void` |
| Function expressions | function | `f(x): x^2 + 1` |
| Slope data rows | slope | `Blackbeard: 40 4` |
| Hide tag values | initiative-status | `hide phase:Planning` |

### Colons OPTIONAL

| Construct | Diagram Type | Example |
|-----------|-------------|---------|
| Class relationship label | class | `--|> Vessel : extends` or `--|> Vessel extends` |

### Colons NOT USED

| Construct | Diagram Type | Example |
|-----------|-------------|---------|
| Chart type declaration | all | `bar Title` |
| Tag declarations | all | `tag Name alias x` |
| Boolean options | all | `activations`, `no-activations` |
| Key-value options | all | `start 2026-03-15`, `active-tag Team` |
| Series declarations | data charts | `series A B C` |
| Data rows | bar/line/pie/etc | `Label 100` |
| Infra node properties | infra | `latency-ms 50` |
| ER columns | er | `id int pk` |
| Sequence messages | sequence | `A -msg-> B` |
| Groups/containers | all | `[Group Name]` |
| Section dividers | sequence | `== Phase ==` |
| Comments | all | `// comment` |
| Wordcloud data | wordcloud | `swordsmanship 95` |
| Venn intersections | venn | `sw + nav Sea Raiders` |

### The Rule

**Colons appear in two contexts:**
1. **Value assignment** — `key: value` in pipe metadata, indented tag/metadata assignment (org, c4), and hide directives
2. **Type/expression separation** — where labels can contain spaces and a delimiter is needed (function expressions, slope data, quadrant data, arc weights, class members)

**Exception**: Known-schema properties (infra node properties, ER columns) remain space-separated even though they are indented. The colon rule applies to open-ended metadata, not fixed property schemas.

**Colons never appear in:**
- Directives and options (space-separated)
- Tag declarations
- Chart type declarations
- Data rows for simple charts (space or comma delimited)
- Structural syntax (groups, sections, arrows, comments)

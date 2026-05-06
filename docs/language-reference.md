# DGMO Language Specification

> **Authoritative reference** for the DGMO diagram language. This document describes what is valid syntax. If it is not in this document, it is not valid DGMO.

> **Note for AI generators:** Trust the show-everything default. Every renderable label part on every data chart is on by default. Emit `no-name` / `no-value` / `no-percent` only when the user explicitly requests suppression. Do not emit them defensively.

## Table of Contents

1. [Universal Constructs](#1-universal-constructs)
2. [Universal Name Handling](#2-universal-name-handling)
3. [Sequence Diagrams](#3-sequence-diagrams)
4. [Infrastructure Diagrams](#4-infrastructure-diagrams)
5. [Flowchart Diagrams](#5-flowchart-diagrams)
6. [State Diagrams](#6-state-diagrams)
7. [Org Charts](#7-org-charts)
8. [C4 Architecture Diagrams](#8-c4-architecture-diagrams)
9. [Entity-Relationship Diagrams](#9-entity-relationship-diagrams)
10. [Class Diagrams](#10-class-diagrams)
11. [Kanban Boards](#11-kanban-boards)
12. [Sitemap Diagrams](#12-sitemap-diagrams)
13. [Gantt Charts](#13-gantt-charts)
14. [Boxes and Lines Diagrams](#14-boxes-and-lines-diagrams)
15. [Timeline Diagrams](#15-timeline-diagrams)
16. [Data Charts](#16-data-charts)
17. [Visualizations](#17-visualizations)
18. [Tech Radar Diagrams](#18-tech-radar-diagrams)
19. [Wireframe Diagrams](#19-wireframe-diagrams)
20. [Pyramid Diagrams](#20-pyramid-diagrams)
21. [Ring Diagrams](#21-ring-diagrams)
22. [Colon Usage Summary](#22-colon-usage-summary)

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

**Diagram types that support tags**: sequence, infra, org, c4, er, kanban, gantt, sitemap, timeline, boxes-and-lines

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

- **Allowed color names (exactly these 10):** `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `teal`, `cyan`, `lightblue`, `gray`
- Any other value — including hex codes (`#ff0000`), CSS keywords (`black`, `white`, `pink`), or typos — is a parse error and produces an inline diagnostic in the editor (with a "did you mean?" suggestion when close to a known name)
- The actual hex value rendered for each name comes from the active palette/theme; users cannot extend or override the allowed list
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

### 1.9 In-Arrow Message Labels

An **in-arrow label** is the text embedded inside an arrow between the opening delimiter and the arrow token, as in `A -label-> B`.

```
A -label-> B
 ^ ^---^ ^^
 | |     ||
 | |     |+- destination id
 | |     +- arrow token
 | +- label text (plain, no markdown)
 +- opening delimiter (matches arrow type)
```

**Chart types that support in-arrow labels**: sequence, flowchart, state, infra, c4, er, class, boxes-and-lines.

#### Cheat sheet

```
// happy-path: labels are plain text with punctuation allowed
A -location[]-> B          // label = "location[]"
A -a[b]c-> B                // label = "a[b]c"
A -{json}-> B               // label = "{json}"

// unicode: all scripts and emoji preserved verbatim
A -café-> B
A -日本語-> B
A -🎉-> B

// punctuation is literal — no markdown interpretation
A -(parenthetical)-> B      // label = "(parenthetical)"  (NOT a color)
A -*emphasis*-> B           // label = "*emphasis*"       (NOT bold)
A -`code`-> B               // label = "`code`"           (NOT a code span)

// forbidden: -> and ~> substrings inside a label
A -uses -> chain-> B        // ERROR (E_ARROW_SUBSTRING_IN_LABEL)
// migration: move the label to the post-colon form
A -> B: uses -> chain       // works for charts that accept post-colon labels

// migration from pre-gauntlet (legacy) syntax
A -Makes calls [HTTP]-> B   // label is now the FULL "Makes calls [HTTP]"
A -Makes calls-> B | tech: HTTP   // preferred: technology on target metadata
```

#### Character-set contract

- **Allowed**: any Unicode codepoint except the forbidden list below. Brackets `[] {} ()`, pipes `|`, quotes `"' `, backticks, punctuation, digits, emoji, ZWJ sequences, combining marks — all pass through as literal characters.
- **Forbidden substrings**: `->` and `~>`. These terminate the arrow. If you need them inside a label, use the post-colon form (`A -> B: uses -> to chain`) on chart types that support it; there is no escape mechanism.
- **Forbidden characters**: C0 control characters U+0000–U+001F except U+0009 (tab), and U+007F (DEL). Silent renderer breakage and log-injection surface — no legitimate use case.
- **Whitespace**: leading and trailing whitespace is trimmed; internal whitespace runs (including tabs, non-breaking spaces, and zero-width spaces) are **preserved**, never collapsed.
- **Plain text only**: no markdown interpretation. `*foo*` renders as `*foo*`, not italicized. `[label](url)` renders as literal `[label](url)`, not a hyperlink. Clickable URLs belong in notes, not in in-arrow labels.
- **HTML-safe**: all renderers emit label text as a DOM text node. `<script>alert(1)</script>` renders as literal text — the entire label is a sequence of codepoints, not a markup fragment.

#### Color suffix (flowchart and state only)

```
A -(red)-> B         // colored edge, no label
A -(notacolor)-> B   // label = "(notacolor)" (fall-through)
A -(red) uses-> B    // label = "(red) uses" (combined form not supported)
A -red-> B           // label = "red" (bare word is always a label)
```

A parenthesized palette color is only recognized when the entire label between the opening `-` and the arrow token is exactly `(colorName)` and `colorName` is one of the 11 names in §1.5. Any other content falls through to the label. To combine a color and a label, use the post-colon or pipe-metadata form instead.

#### Migrating from pre-gauntlet syntax

Two legacy forms changed with this spec:

1. **C4 trailing `[technology]` sugar is removed.** A C4 arrow like `-Makes calls [HTTPS]-> API` used to extract `HTTPS` as the technology annotation. The full `Makes calls [HTTPS]` is now the label. Use the post-colon or pipe form for technology: `-Makes calls-> API | tech: HTTPS`.
2. **Bare palette color suffixes are a literal label.** `A -red-> B` on flowchart/state used to be accepted as a bare color suffix in some surfaces. It is now always a label with text `red`. To color an edge, use the `-(red)->` parens form.

No code migration is required for in-arrow label character escaping — any label that was valid before remains valid, with one exception: if your label happened to contain the literal substring `->` or `~>`, the parser now rejects it with `E_ARROW_SUBSTRING_IN_LABEL`. Move those labels to the post-colon form.

---

## 2. Universal Name Handling

DGMO uses one rule for entity names across every chart type. Names accept
spaces verbatim. Equality is forgiving — case-insensitive and
whitespace-collapsed. The first-seen casing/spacing wins for display.
Quoting is on-demand — required only when a name contains a reserved
character.

### 2.1 Pinned Algorithm

Two names are the same entity when they reduce to the same key under
this algorithm:

1. NFC normalize the input
2. Replace runs of Unicode whitespace with a single ASCII space
3. Trim leading/trailing whitespace
4. Case-fold via `toLocaleLowerCase('en-US')`

`Auth Service`, `auth service`, `AUTH\tSERVICE`, and `  auth   service  `
all normalize to `auth service`. The first declaration wins for the
display label. Subsequent re-declarations with a different casing or
spacing fold into the first and emit `I_NAME_MERGED` (warning).

### 2.2 Reserved Characters

Bare names accept letters, digits, spaces, and hyphens. The following
characters are reserved and require `"..."` quoting if you want them in
a name: `|` (pipe metadata), `:` (type/metadata separator), edge sigils
`-> <- ~> <~ -- ..`, shape brackets `[] () {} <>`, leading/trailing
whitespace.

There is no `"`-inside-`"` escape — names cannot contain a double
quote.

### 2.3 Examples

- `Auth Service is a service` — bare multi-word, no quoting needed
- `"first name" varchar` — quote when name contains a reserved char (the `:` ER type separator)
- `"Order | Items"` — quote the pipe
- `class "Customer Service"` — bare multi-word also accepts in class
- `Auth Server` then `auth server -hi-> DB` — message resolves via normalization to one participant

### 2.4 Migration: aka Removed

Sequence's `Name is a type aka Alias` modifier is removed. Forgiving
normalization makes aliasing redundant. Encountering `aka` in a
participant declaration produces `E_AKA_REMOVED`.

### 2.5 Carve-Outs

These are intentionally outside the universal rule:

- D3 chart data rows (slope, venn, quadrant, arc) — labels are data, not entity names
- `tags:` and `import:` directives in org — values are file/tag references
- Flowchart and state shape brackets `[]`, `()`, `{}`, `<>` — shape sigils, not name quoting
- Tag suffix-alias `tag Priority p` — separate alias map

### 2.6 Error Codes

- `I_NAME_MERGED` (warning) — two source-distinct names normalize to the same key with different displayed forms
- `E_NAME_RESERVED_CHAR` (error) — bare name contains a reserved char without quoting
- `E_AKA_REMOVED` (error) — removed `aka` keyword used in sequence participant declaration

---

## 3. Sequence Diagrams

### 2.1 Participants

```
Name is a <type> [position N]
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

## 4. Infrastructure Diagrams

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

## 5. Flowchart Diagrams

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
- `no-color` (boolean; default off — when on, all nodes resolve to the muted neutral fill instead of their default intent color)
- `solid-fill` (boolean; default off — render shapes with their full intent color instead of the canonical 25% tint)

`no-color` + `solid-fill` precedence: `no-color` wins for nodes with no explicit color (the muted neutral path bypasses `solid-fill`). Nodes with an explicit color survive `no-color` and are then rendered at full saturation if `solid-fill` is also on.

---

## 6. State Diagrams

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
- `no-color` (boolean; default off — when on, all states resolve to the muted neutral fill instead of their default intent color)
- `solid-fill` (boolean; default off — render states with their full intent color instead of the canonical 25% tint; collapsed groups are also rendered at full saturation)

`no-color` + `solid-fill` precedence: `no-color` wins for states with no explicit color (the muted neutral path bypasses `solid-fill`). Group colors survive `no-color` and are then rendered at full saturation if `solid-fill` is also on.

---

## 7. Org Charts

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

## 8. C4 Architecture Diagrams

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

### 7.7 Element Descriptions

```
// Indented metadata form (colon required)
Web App is a container
  description: SPA built with React
  description: Supports SSR and client-side routing

// Keyword form (colon optional)
API is a container
  description Handles all REST endpoints

// Pipe metadata form
Database is a container | description: PostgreSQL with read replicas
```

- Multiple `description` lines accumulate into a multi-line description
- `description` is extracted as a dedicated field, not stored in general metadata
- Supports inline markdown: `**bold**`, `*italic*`, `` `code` ``, `[links](url)`
- `- bullet text` renders as `• bullet text`

### 7.8 Options

- `direction-tb` (boolean; default is LR)

---

## 9. Entity-Relationship Diagrams

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

## 10. Class Diagrams

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
enum ShipType
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
enum ShipType
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

## 11. Kanban Boards

### 10.1 Declaration

```
kanban [Title]
```

### 10.2 Columns

Columns represent workflow stages and must flow left-to-right from least-done to most-done (e.g., Backlog → In Progress → Done). Every column should be a stage that cards pass through. Don't create columns for non-workflow concepts like gates, criteria, or definitions of done — use a tag instead (e.g., `type: Gate`).

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

## 12. Sitemap Diagrams

### 11.1 Declaration

```
sitemap [Title]
```

### 11.2 Pages (Indentation = Hierarchy)

```
Home
  About
  Pricing | Auth: Public
    Enterprise
  Blog
```

### 11.3 Arrows

```
Home
  -pricing-> Pricing
  -login-> Login
```

Arrows can target containers using bracket syntax:

```
Home
  -> [Port Market]
[Port Market]
  Shop
  -> [Warehouse]
[Warehouse]
  Storage
```

All permutations supported: node→group, group→node, group→group. Brackets required to distinguish group targets from page targets.

### 11.4 Containers

```
[Marketing]
  Pricing | Auth: Public
```

### 11.5 Node Descriptions

```
// Keyword form (colon optional)
About
  description Company history and team bios

// Pipe metadata form
Pricing | description: Compare plans and features

// Multi-line
Blog
  description: Engineering and product updates
  description: Published weekly
```

- `description` keyword required (bare prose lines are not auto-detected as descriptions)
- Multiple `description` lines accumulate into a multi-line description
- Supports inline markdown: `**bold**`, `*italic*`, `` `code` ``, `[links](url)`
- `- bullet text` renders as `• bullet text`

### 11.6 Options

- `direction-tb` (boolean; default is LR)

---

## 13. Gantt Charts

### 12.1 Declaration

```
gantt [Title]
```

### 12.2 Options (Space-Separated, NO Colon)

```
start 2026-03-15
today-marker
today-marker 2026-03-27
critical-path
no-dependencies
sort tag:Team
```

### 12.3 Holidays

```
holiday
  2024-02-19 Presidents Day
  2024-05-27 -> 2024-05-29 Memorial Weekend
```

### 12.4 Workweek

```
workweek mon-fri
workweek sun-thu
```

Top-level directive (not nested under `holiday`).

### 12.5 Eras

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

### 12.6 Markers

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

### 12.7 Groups (Swimlanes)

```
[Backend] | t: Engineering
```

Bracket syntax only.

### 12.8 Tasks

```
20bd Database Schema | p: Foundation, 100%
10bd API Integration | t: Engineering
0d Launch Day
2026-03-15 -> 30d Setup
```

Duration units: `min`, `h`, `d`, `bd` (business days), `w`, `m`, `q`, `y`
Uncertain: `10bd?` (trailing `?`)
Progress: `| 80%` in pipe metadata

### 12.9 Dependencies (Indented Under Tasks)

```
10bd API Integration
  -> E2E Testing
  -> Launch Day | offset: 10bd
```

### 12.10 Parallel Block

```
parallel
  [Backend]
    20bd Schema
  [Frontend]
    10bd Wireframes
```

---

## 14. Boxes and Lines Diagrams

### 13.1 Declaration

```
boxes-and-lines [Title]
```

Requires explicit first line — no heuristic detection. Default direction is left-to-right.

### 13.2 Nodes

```
NodeLabel
NodeLabel | key: value, key2: value2
NodeLabel | description: Some text here
```

Nodes are created explicitly or implicitly (when referenced in edges). All nodes render as uniform rounded rectangles.

The `description` key is extracted as a dedicated field and not stored in metadata.

### 13.3 Edges

```
Source -> Target
Source -> Target | key: value
Source -label-> Target
Source <-> Target
Source <-label-> Target
```

Indented shorthand (source from preceding node):
```
API | description: Main gateway
  -routes-> UserService
  -routes-> ProductService
```

Pipe metadata on edges:
```
A -reads-> DB | frequency: High
```

### 13.4 Groups

```
[Group Name]
  indented nodes...

[Group Name] | key: value
  indented nodes...
```

Nested groups (max depth 2):
```
[AWS]
  [us-east-1]
    API
    DB
```

Group metadata cascades to children (node metadata overrides). Nodes already declared above can be referenced inside groups to assign membership.

### 13.5 Group-Targeted Edges

Node-to-group and group-to-group edges use bracket syntax `[Group Name]`:

```
API -> [Backend]
[Backend] -> [Frontend]
[Region A] <-> [Region B]
[Region A] -VPN-> [Region B]
```

Indented shorthand also supports groups (place arrow directly after group header):

```
[Backend]
  -> [Frontend]
  DB
  Cache
```

### 13.6 Directives

- `direction TB` — top-to-bottom layout (default: `LR`)

### 13.7 Options

- `active-tag GroupName` — set active tag group for coloring
- `hide team:Backend, team:Frontend` — hide nodes with matching tag values (colon syntax for tag:value)

---

## 15. Timeline Diagrams

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

## 16. Data Charts

### Conventions shared across all data charts

Every section under §15 follows the same two rules.

**Rule A — data rows are space-separated.** Commas between values are tolerated for back-compat but not idiomatic. Thousands-separator commas *inside a single number* (`3,984,078.65`) are always supported.

```
Q1 400 700 300 500     ✅  preferred
Q1 400, 700, 300, 500  ⚠  tolerated; use spaces
```

**Rule B — list-of-labelled-items directives (e.g. `series`, `columns`) prefer the indented one-per-line form.** Short one-line forms are tolerated for ≤3 items with no colour annotations or spaces.

```
series                            ✅  preferred
  Cloud Platform (blue)
  Legacy Suite (red)
  Mobile App (green)

series Cloud (blue), Legacy (red) ⚠  tolerated; prefer the block
```

Parsers accept either form. The rules above are authoring guidance.

### 15.1 Simple Charts (bar, line, pie, doughnut, area, polar-area, radar, bar-stacked)

**Declaration:** `bar [Title]`, `line [Title]`, etc.

**Series** — follows Rule B (prefer the indented block):
```
series
  Cloud Platform (blue)
  Legacy Suite (red)
```

Short one-line form is tolerated: `series Revenue` or `series A B`.

**Data rows** — follows Rule A:
```
Label 100
Label 100 200 300
Label(color) 100
Q1 400 700 300 500
```

**Options (space-separated, NO colon):**
```
title My Chart
x-label X Label
y-label Y Label
orientation-horizontal
stacked
```

- `orientation-horizontal` (boolean; default is vertical bars)
- `stacked` (boolean; default is off)
- Legend is always shown (no option needed)

**Value-display flags — show-everything default.** Every renderable part is on by default. Suppress with `no-*`:
- `no-name` — hide name (segment / point / cell / node / set)
- `no-value` — hide numeric value
- `no-percent` — hide share-of-total percentage (pie-family only)

Each chart honors the subset of flags that has a renderable atom on it:
- pie / doughnut / polar-area: all three
- funnel: `no-name`, `no-value`
- bar / bar-stacked / line / multi-line / area / radar: `no-value`
- scatter: `no-name`
- heatmap: `no-value`
- sankey, chord, arc, slope, quadrant, venn: name-suppression deferred — names render by default and cannot yet be hidden

`no-percent` on a non-pie-family chart is silently ignored (the chart has no percent atom). Cartesian charts (bar, line, area) now render values on each bar / point by default.

**Eras (line/area only):**
```
era Day 1 -> Day 3 Rough Seas (red)
```

### 15.2 Scatter / Bubble Charts

**Data rows** — follows §15 Rule A (space-separated):
```
Name x y
Name x y size
```

**Categories:**
```
[Caribbean](red)
  Blackbeard 90 8500
```

**Options:**
```
x-label Weight
y-label Height
size-label Crew
no-name
```

Point names render by default. Use `no-name` to hide them.

### 15.3 Heatmap

**Columns** — follows §15 Rule B (prefer the indented block for multiple columns):
```
columns
  Jan
  Feb
  Mar
```

Short one-line form is tolerated: `columns Jan Feb Mar`.

**Data rows** — follows §15 Rule A:
```
RowLabel 5 4 3
```

### 15.4 Function Charts (Colon REQUIRED)

```
function Trajectories
x-label Distance
y-label Height
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

`->` = directed, `--` = undirected. Values follow §15 Rule A.

### 15.6 Chord Charts

```
Blackbeard -- Bonnet 150        // undirected
Roberts -> Rackham 20           // directed
```

Values follow §15 Rule A.

### 15.7 Funnel Charts

**Data rows** — follows §15 Rule A (space-separated):
```
Visits 1200
Signups 800
Purchases 200
```

---

## 17. Visualizations

### 16.1 Slope Charts

```
slope Fleet Strength

period 1715 1725

Blackbeard 40 4
Roberts 12 52
```

- Period directive required: `period Label1 Label2` (one-line) or indented block for multi-token labels:
  ```
  period
    Before COVID
    After COVID
  ```
- Data rows: `Label value1 value2` — follows §15 Rule A (space-separated; commas between values tolerated for back-compat but not idiomatic)
- Thousands commas within values supported (e.g., `1,000`)
- Color annotations: `Label (color) value1 value2`
- Minimum 2 periods required

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
x-label Low Skill, High Skill
y-label Low Loyalty, High Loyalty

top-right Promote (green)
top-left Train (yellow)
bottom-left Maroon (red)
bottom-right Watch Closely (purple)

Quartermaster 0.9 0.95
Navigator 0.85 0.8
```

- Axis labels: `x-label Low, High` — comma-separated (low/high pair, not a data row; comma is the delimiter here by design)
- Position labels: `top-right Label` — space-separated
- Data points: `Label x y` — follows §15 Rule A (space-separated; `Label x, y` tolerated for back-compat)

---

## 18. Tech Radar Diagrams

```
tech-radar Title

rings
  Adopt
  Trial
  Assess
  Hold

Techniques | quadrant: top-right
  Continuous Deployment | ring: Adopt, trend: stable
    Fully adopted across all services.
  Micro Frontends | ring: Trial, trend: up

Tools | quadrant: top-left
  Vite | ring: Adopt, trend: up
  Webpack | ring: Hold, trend: down
```

### Rings

Declared in a `rings` block, one per indented line. Order: innermost (first) to outermost (last). Any names, any count.

Aliases supported: `Adopt alias a` — then blips can use `ring: a`.

### Quadrants

Exactly 4 required. Each is a top-level header with pipe metadata:

```
Name | quadrant: position
```

**Positions:** `top-left`, `top-right`, `bottom-left`, `bottom-right` — each used exactly once.

Optional color override: `Tools | quadrant: top-left, color: purple`

Default colors: top-left=blue, top-right=green, bottom-left=red, bottom-right=orange.

### Blips

Indented under their quadrant. Require `ring` metadata (case-insensitive match). Optional `trend`:

```
  Item Name | ring: Adopt, trend: stable
```

**Trends:** `new` (double circle), `up` (inward crescent), `down` (outward crescent), `stable` (plain circle). Omitting renders plain circle.

### Descriptions

Further-indented lines below a blip. Supports inline markdown (bold, italic, code, links).

```
  Rust | ring: Assess, trend: new
    Evaluating for **performance-critical** services.
```

### Numbering

Blips receive sequential global numbers. Order: quadrants clockwise (top-left → top-right → bottom-right → bottom-left), then by ring (innermost first), then declaration order.

---

## 19. Wireframe Diagrams

Wireframe diagrams use **visual-mnemonic syntax** where bracket characters communicate element type.

### Declaration

```
wireframe Page Title
```

### Form Factor

```
mobile
```

Switches to narrow vertical layout (375px). Desktop (1200px, horizontal regions) is the default.

### Visual-Mnemonic Elements

| Syntax | Element | Example |
|--------|---------|---------|
| `[text]` (leaf) | Text input | `[Email address]` |
| `[Name]` (with children) | Group/region | `[Sidebar]` + indented children |
| `(Label)` | Button | `(Submit)` |
| `{A \| B \| C}` | Dropdown/select | `{Small \| Medium \| Large}` |
| `<x>` / `< >` | Checkbox | `<x> Remember me` |
| `(*) Label` / `( ) Label` | Radio button | `(*) Option A` |
| `# Text` / `## Text` | Heading | `# Sign In` |
| `---` | Divider | `---` |
| `- text` | List item | `- Electronics` |
| Bare text | Text/paragraph | `Welcome to our app` |

### Keyword Elements

| Keyword | Type | Parameters |
|---------|------|------------|
| `nav` | Block | Children are nav items |
| `tabs` | Block | Children are tab labels |
| `table` | Block | Comma-separated rows; first = header |
| `table RxC` | Skeleton table | `table 5x4` + optional header row |
| `image` | Leaf | `round`, `wide` hints |
| `modal Title` | Block | Rendered as separate panel below |
| `skeleton` | Block | Children render as grey placeholders |
| `alert` | Block | Optional semantic state |
| `progress N` | Leaf | Value 0-100: `progress 60` |
| `chart type` | Leaf | `chart line`, `chart bar`, `chart pie` |

### Pipe Metadata (States)

Wireframe uses flag keywords (not `key: value`):

```
(Submit) | disabled
(Delete) | destructive
(Cancel) | ghost
[Email] | password
[Notes] | textarea
[Cards] | horizontal
[Advanced] | collapsed
[Messages] | scrollable
<x> Dark mode | toggle
```

Available states: `disabled`, `active`, `selected`, `empty`, `ghost`, `destructive`, `success`, `warning`, `info`, `scrollable`, `collapsed`, `toggle`, `password`, `textarea`, `horizontal`, `primary`.

Free-text annotations after states: `[Email] | required, validates email format`.

### Multi-Element Lines

Two or more spaces between segments create separate elements:

```
Email  [user@example.com]    // label + field (2 segments)
(-)  1  (+)                  // 3 inline items
$299.99  ~~$349.99~~         // 2 inline texts
```

- **2 segments** (bare text + element): label-for-element pairing
- **3+ segments**: inline items, no label pairing
- **Single space = same element**: `Cart (3)` is one text element

### Group Disambiguation

- `[Name]` with indented children = group/container
- `[Name]` with no children = text input
- `[Name] | horizontal/scrollable/collapsed` = group (even without children)

### Table Syntax

Explicit rows (comma-separated, first row = header):

```
table
  Name, Email, Role
  John, john@, Admin
  Sally, sally@, Editor
```

Skeleton shorthand:

```
table 5x4
  Name, Email, Role, Status
```

### Layout Model

- Desktop: 1200px wide, top-level regions arrange horizontally
- Mobile: 375px wide, all regions stack vertically
- Smart sizing: `sidebar` → ~25%, `main`/`content` → fill, `header`/`footer` → full width
- `| horizontal` on groups arranges children in a row

### Example

```
wireframe Login Page

[Header]
  nav
    Home | active
    Settings

[Main]
  # Sign In
  Email  [user@example.com]
  Password  [****] | password
  <x> Remember me
  (Sign In)
  (Forgot Password?) | ghost
```

---

## 20. Pyramid Diagrams

Hierarchical pyramid visualization with stacked layers, descriptions, and optional per-layer color. Source order reads apex-first (top of file = top of pyramid).

### Declaration

```
pyramid [Title]

LayerLabel
LayerLabel | color: blue
LayerLabel | color: green
  Indented description
```

The first line declares the chart type and an optional title. Each non-indented, non-directive line declares one layer. At least two layers are required.

### Example

```
pyramid Maslow's Hierarchy

Self-Actualization | color: purple
  Morality, creativity, acceptance of facts.

Esteem | color: blue
  Respect, recognition, confidence.

Love & Belonging | color: green
  Friendship, intimacy, family.

Safety | color: yellow
  Security, employment, health.

Physiological | color: orange
  Food, water, warmth, rest.
```

### Layer Pipe Metadata

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `color` | palette name | auto | Layer color |
| `description` | string | — | One-liner description |

### Descriptions

Indented lines under a layer are description text. Markdown inline formatting (`**bold**`, `*italic*`, `` `code` ``, `[links](url)`) is supported. Bullets written as `- item` render as `• item`.

### Directives

| Directive | Effect |
|-----------|--------|
| `inverted` | Flip apex to the bottom (funnel orientation). Source order is preserved — the first layer is always the visual top. |

### Overflow Handling

When descriptions don't fit a layer's band the renderer wraps at the column edge, truncates with `…`, auto-alternates descriptions left ↔ right when one column can't hold them, and (in-app) reveals the full description on highlight while hiding siblings.

---

## 21. Ring Diagrams

Concentric-ring visualization for nested or hierarchical categories. Source order reads core-out: top of file = innermost element (rendered as a filled disc), last line = outermost ring. Min 2 layers, max 15.

### Declaration

```
ring [Title]

LayerLabel
LayerLabel | color: blue
LayerLabel | color: green
  Indented description
```

### Example

```
ring Captain's Sphere of Influence

solid-fill

Captain | color: purple
  Final word on heading and plunder,
  keeper of the ship's charter.

Quartermaster | Second-in-command, divvies the booty

Crew | color: green
  Deckhands, gunners, and powder monkeys.

Allied Crews | color: orange
  Loose alliances kept by oath.

The Open Sea | color: cyan
  Weather, currents, and rival flags.
```

### Layer Pipe Metadata

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `color` | palette name | auto | Ring color |
| `description` | string | — | One-liner description |

### Descriptions

Indented lines under a layer are description text. Markdown inline formatting is supported. Bullets written as `- item` render as `• item`. Descriptions appear in a stacked side list with colored accent bars.

### Directives

| Directive | Effect |
|-----------|--------|
| `solid-fill` | Render rings with full intent color instead of the default 25% tint. |

`inverted` is **not** valid on ring diagrams (rings are rotationally symmetric). Using it emits an error-severity diagnostic and the line is discarded.

### Color Validation

Unknown color names emit an error-severity diagnostic with a "Did you mean…?" hint, and the layer falls back to its series color so the chart still renders.

### Label Degradation

When ring band thickness would force the in-band label below the readable floor (12 px), in-band labels are skipped entirely and the side list shows the layer names instead.

---

## 22. Colon Usage Summary

### Constructs Where Colons Are REQUIRED

| Construct | Diagram Type | Example |
|-----------|-------------|---------|
| Pipe metadata | all | `\| key: value, key2: value2` |
| Org metadata (indented) | org | `role: Manager` |
| C4 metadata (indented) | c4 | `description: SPA built with React` |
| Class field types | class | `+ name: string` |
| Class method returns | class | `+ sail(): void` |
| Function expressions | function | `f(x): x^2 + 1` |
| Hide tag values | boxes-and-lines | `hide phase:Planning` |

### Colons OPTIONAL

| Construct | Diagram Type | Example |
|-----------|-------------|---------|
| Class relationship label | class | `--|> Vessel : extends` or `--|> Vessel extends` |
| Description keyword (indented) | sitemap, c4 | `description text` or `description: text` |

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
| Slope data rows | slope | `Blackbeard 40 4` |
| Slope period directive | slope | `period 1715 1725` |
| Venn intersections | venn | `sw + nav Sea Raiders` |

### The Rule

**Colons appear in two contexts:**
1. **Value assignment** — `key: value` in pipe metadata, indented tag/metadata assignment (org, c4), and hide directives
2. **Type/expression separation** — where labels can contain spaces and a delimiter is needed (function expressions, class members)

**Exception**: Known-schema properties (infra node properties, ER columns) remain space-separated even though they are indented. The colon rule applies to open-ended metadata, not fixed property schemas.

**Colons never appear in:**
- Directives and options (space-separated)
- Tag declarations
- Chart type declarations
- Data rows for simple charts (space or comma delimited)
- Structural syntax (groups, sections, arrows, comments)

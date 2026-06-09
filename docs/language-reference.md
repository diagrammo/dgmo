# DGMO Language Specification

> **Authoritative reference** for the DGMO diagram language. This document describes what is valid syntax. If it is not in this document, it is not valid DGMO.

> **Note for AI generators:** Trust the show-everything default. Every renderable label part on every data chart is on by default. Emit `no-name` / `no-value` / `no-percent` only when the user explicitly requests suppression. Do not emit them defensively.

## Table of Contents

1. [Universal Constructs](#1-universal-constructs)
2. [Universal Name Handling](#2-universal-name-handling)
   2A. [Universal Aliases (`as` keyword)](#2a-universal-aliases-as-keyword)
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
    13A. [PERT Diagrams](#13a-pert-diagrams)
14. [Boxes and Lines Diagrams](#14-boxes-and-lines-diagrams)
15. [Timeline Diagrams](#15-timeline-diagrams)
16. [Data Charts](#16-data-charts)
17. [Visualizations](#17-visualizations)
18. [Mindmap Diagrams](#18-mindmap-diagrams)
19. [Wireframe Diagrams](#19-wireframe-diagrams)
20. [Tech Radar Diagrams](#20-tech-radar-diagrams)
21. [Cycle Diagrams](#21-cycle-diagrams)
22. [Journey Map Diagrams](#22-journey-map-diagrams)
23. [Pyramid Diagrams](#23-pyramid-diagrams)
24. [Ring Diagrams](#24-ring-diagrams)
    24A. [RACI Matrices (RACI / RASCI / DACI)](#24a-raci-matrices-raci--rasci--daci)
25. [Map Diagrams](#25-map-diagrams)
26. [Colon Usage Summary](#26-colon-usage-summary)
27. [Authoring Rules (Generators Read This First)](#27-authoring-rules-generators-read-this-first)

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
tag GroupName as <alias>
  Value1 color
  Value2 color
```

- `tag` keyword, NO colon
- Alias: optional postfix `as <alias>` per §2A (universal alias syntax — `[A-Za-z][A-Za-z0-9_]{0,11}`)
- Inline values also supported: `tag Priority as p Low green, High red`
- Color follows the value as a bare trailing token (see §1.5). Capitalize the color word (`Red`, `Yellow`) to keep it as a literal value with no color.
- First entry is the default value — reorder to change
- The first declared group is active by default (colors nodes immediately); `active-tag <GroupName>` only matters with ≥2 groups to pick a non-first group, and `active-tag none` suppresses all coloring
- Must appear before diagram content
- Legacy bare shorthand (`tag Priority p`) and `alias` keyword (`tag Priority alias p`) emit `E_TAG_SHORTHAND_REMOVED` per TD-18

**Diagram types that support tags**: sequence, infra, org, c4, er, kanban, gantt, sitemap, timeline, boxes-and-lines

### 1.4 Same-Line Metadata

```
EntityName key: value, key2: value2
```

- Colons ARE required within metadata pairs (`key: value`)
- Items separated by commas
- Tag aliases resolve: `c: Caching` resolves to `concern: Caching` (if `tag Concern as c` is defined)
- One metadata region per line only

### 1.5 Color Suffixes

Color is set by typing the color name at the end of a label, lowercase. Example: `Done green` colors Done green. Eleven colors exist: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `teal`, `cyan`, `gray`, `black`, `white`. To use a color word as a literal label, capitalize it: `Red` stays as the word `Red`.

```
Label color           // bare trailing color token
Done green            // value=Done, color=green
Senior Engineer red   // value="Senior Engineer", color=red
Red                   // value=Red, no color (capitalized → escape hatch)
```

**The universal rule** — color trails the label:

> Color is the trailing whitespace-delimited token of a label region, when that token (case-sensitive, lowercase) is one of the 11 names above. Otherwise the label region has no color.

The "label region" is everything left after the parser strips off structural terminators it owns: same-line metadata (§1.4), numeric values, date ranges, structural brackets. Parsers split those off BEFORE invoking the color rule. So `Tortuga Distillery orange 3000` → `{ label: "Tortuga Distillery", color: "orange", value: 3000 }`: numeric value first, then the color trails the remaining label.

**Aliases come between the label and the color.** `as <alias>` sits _between_ the label region and the trailing color token in declarations — the line reads `<label> as <alias> <color>`. Color is always the line-trailing token (modulo same-line metadata, which is line-final).

**Where the rule applies**: tag values, kanban columns (`[Done] green`), venn items (`Swordsmanship as sw red`), quadrant position labels (`top-right Promote green`), gantt / timeline eras and markers, data-chart series + rows, sankey nodes + link lines, cycle / pyramid / ring / RACI / boxes-and-lines node labels.

**Same-line metadata form is reserved for multi-key metadata.** Use `color: <name>` in the metadata region only when another key (`description:`, `span:`, `width:`, `quadrant:`, …) needs to accompany the color. When color is the only thing being set, use the trailing-token form.

```
Spring green                          // canonical — color is the only metadata
Spring color: green, icon: ❄          // long form REQUIRED when other keys accompany color
-Label-> color: red, width: 6         // edges have no trailing-token slot; same-line metadata is the only path
```

Two narrow exceptions accept same-line-metadata-only color: **cycle edges** (no trailing-token slot on edges) and **journey-map personas** (the persona-line parser does not peel a trailing color from the persona name).

**Accepted tradeoffs**:

- **No typo diagnostics**: `Done grren` is a 2-word label with no color, no warning.
- **Case-sensitivity is the escape hatch**: `Red`, `Yellow`, `Green` stay as labels.
- **No edge color** on flowchart, state, sitemap. Sankey links DO accept a trailing color word after the numeric value.
- **11-name palette is a frozen public contract**: adding a 12th color is itself a breaking change.

### 1.6 Indentation

- Spaces or tabs (1 tab = 4 spaces)
- Determines hierarchy and block scope

### 1.7 Groups / Containers

```
[Group Name]
[Group Name] color
[Group Name] key: value
```

- Bracket-enclosed name
- Optional trailing-token color (kanban columns, scatter categories, era/marker labels)
- Optional same-line metadata (outside brackets)
- Indented content below belongs to the group

### 1.8 Boolean Options

```
option-name          // on
no-option-name       // off
```

- Bare keyword = on; `no-` prefix = off
- Must appear before diagram content

**Cross-cutting boolean directives** (recognized in every chart type that has the corresponding rendering surface):

| Directive    | Effect                                                                                  |
| ------------ | --------------------------------------------------------------------------------------- |
| `solid-fill` | Render nodes/bars at full intent saturation instead of the canonical 25% tint           |
| `no-title`   | Hide the diagram banner title in the rendered output (does not mutate the parsed model) |

Examples: `no-legend` (journey-map), `no-color` (flowchart, state), `no-title` (all chart types with a banner title).

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
A -(parenthetical)-> B      // label = "(parenthetical)"
A -*emphasis*-> B           // label = "*emphasis*"       (NOT bold)
A -`code`-> B               // label = "`code`"           (NOT a code span)

// forbidden: -> and ~> substrings inside a label
A -uses -> chain-> B        // ERROR (E_ARROW_SUBSTRING_IN_LABEL)
// migration: move the label to the post-colon form
A -> B: uses -> chain       // works for charts that accept post-colon labels

// migration from pre-gauntlet (legacy) syntax
A -Makes calls [HTTP]-> B   // label is now the FULL "Makes calls [HTTP]"
A -Makes calls-> B tech: HTTP   // preferred: technology on target metadata
```

#### Character-set contract

- **Allowed**: any Unicode codepoint except the forbidden list below. Brackets `[] {} ()`, the `|` character, quotes `"' `, backticks, punctuation, digits, emoji, ZWJ sequences, combining marks — all pass through as literal characters.
- **Forbidden substrings**: `->` and `~>`. These terminate the arrow. If you need them inside a label, use the post-colon form (`A -> B: uses -> to chain`) on chart types that support it; there is no escape mechanism.
- **Forbidden characters**: C0 control characters U+0000–U+001F except U+0009 (tab), and U+007F (DEL). Silent renderer breakage and log-injection surface — no legitimate use case.
- **Whitespace**: leading and trailing whitespace is trimmed; internal whitespace runs (including tabs, non-breaking spaces, and zero-width spaces) are **preserved**, never collapsed.
- **Plain text only**: no markdown interpretation. `*foo*` renders as `*foo*`, not italicized. `[label](url)` renders as literal `[label](url)`, not a hyperlink. Clickable URLs belong in notes, not in in-arrow labels.
- **HTML-safe**: all renderers emit label text as a DOM text node. `<script>alert(1)</script>` renders as literal text — the entire label is a sequence of codepoints, not a markup fragment.

#### Edge color is not a feature

Edges on flowchart, state, and sitemap diagrams have NO color slot. `A -(red)-> B` is a literal label with text `(red)`; `A -yes-> B` and `A -no-> B` no longer auto-color the arrow. Arrows render with the default theme color, period. To color a _node_, use tags (§1.3).

Sankey link lines DO accept a trailing-token color, because the link itself carries data:

```
Sugar Plantations -> Tortuga Distillery 3000 red    // link is colored red
```

#### Migrating from pre-gauntlet syntax

One legacy form changed with this spec:

1. **C4 trailing `[technology]` sugar is removed.** A C4 arrow like `-Makes calls [HTTPS]-> API` used to extract `HTTPS` as the technology annotation. The full `Makes calls [HTTPS]` is now the label. Use the same-line metadata form for technology: `-Makes calls-> API tech: HTTPS`.

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
a name: `|` (reserved character), `:` (type/metadata separator), edge sigils
`-> <- ~> <~ -- ..`, shape brackets `[] () {} <>`, leading/trailing
whitespace.

There is no `"`-inside-`"` escape — names cannot contain a double
quote.

### 2.3 Examples

- `Auth Database is a database` — bare multi-word, no quoting needed
- `"first name" varchar` — quote when name contains a reserved char (the `:` ER type separator)
- `"Order | Items"` — quote the pipe
- `class "Customer Service"` — bare multi-word also accepts in class
- `Auth Server` then `auth server -hi-> DB` — message resolves via normalization to one participant

### 2.4 Migration: aka Removed

Sequence's `Name is a type aka Alias` modifier is removed. Use the
universal `as` postfix (§2A) for short-codes; UNH normalization
handles casing/spacing variants automatically. Encountering `aka`
in a participant declaration produces `E_AKA_REMOVED`.

### 2.5 Carve-Outs

These are intentionally outside the universal rule:

- D3 chart data rows (slope, quadrant) — labels are data, not entity names
- `tags:` and `import:` directives in org — values are file/tag references
- Flowchart and state shape brackets `[]`, `()`, `{}`, `<>` — shape sigils, not name quoting

### 2.6 Error Codes

- `I_NAME_MERGED` (warning) — two source-distinct names normalize to the same key with different displayed forms
- `E_NAME_RESERVED_CHAR` (error) — bare name contains a reserved char without quoting
- `E_AKA_REMOVED` (error) — removed `aka` keyword used in sequence participant declaration
- `E_PARTICIPANT_TYPE_REMOVED` (error) — sequence `is a X` declaration used a removed type keyword (`service`, `frontend`, `networking`, `gateway`, `external`)

---

## 2A. Universal Aliases (`as` keyword)

A single postfix syntax — `Name as <alias>` — applies anywhere a name
appears across every chart type with named entities. Replaces prior
tag-shorthand and venn `alias` keyword forms with a uniform rule.

### 2A.1 Syntax

```
sequence
Alice is an actor as a
Bob is a database as b
a -hello-> b
b -ack-> a
```

```
venn
Swordsmanship as sw red
Navigation as nav blue
sw + nav Sea Raiders
```

```
tag Priority as p
tag Concern as c
```

### 2A.2 Rules

- **Token shape**: `[A-Za-z][A-Za-z0-9_]{0,11}` — letter start,
  letters/digits/underscore, length 1–12. **Case-sensitive**.
- **Modifier order on declarations**: `<name> [is a type] [as <alias>] [color] [key: value, …]`. Color is the line-trailing token; same-line metadata, when present, is line-final and supersedes that slot.
- **Strict ordering**: aliases must be declared on or before first use.
- **Flat global namespace**: one alias literal has exactly one binding per source.
- **Aliases are NEVER UNH-normalized** — exact-match short-codes only.
- **Reserved tokens**: `as`, `is`, `tag`, `alias`, `aka`, plus chart-type tokens.
- **SaaS-naming is safe**: `Storage as a Service` parses as a canonical name (no false alias extraction).

### 2A.3 When to use aliases

Aliases earn their keep on names that repeat 3+ times. Single-use
names should not be aliased; two- and three-character source names
rarely benefit. Aliases should aid comprehension, not obscure it.

### 2A.4 UNH vs. Aliases

- **UNH** = same-name typo tolerance. `Alice` ≡ `alice` ≡ `ALICE`.
- **Aliases** = different-token short codes. `pm` ≡ `Product Manager`.

### 2A.5 Migration

| Was                                 | Now                       |
| ----------------------------------- | ------------------------- |
| `tag Priority p` (bare shorthand)   | `tag Priority as p`       |
| `tag Priority alias p` (explicit)   | `tag Priority as p`       |
| `Swordsmanship red alias sw` (venn) | `Swordsmanship as sw red` |

### 2A.6 Error Codes

- `E_ALIAS_BEFORE_DECL` — alias used before declaration
- `E_ALIAS_COLLISION` — same alias bound to two canonicals
- `E_ALIAS_SHADOWS_NAME` — alias literal collides with an existing canonical
- `E_ALIAS_REBINDING` — same canonical given two aliases
- `E_ALIAS_OF_ALIAS` — aliasing an alias
- `E_ALIAS_RESERVED_KEYWORD` — alias is a reserved keyword
- `E_ALIAS_INVALID_FORMAT` — alias doesn't match `[A-Za-z][A-Za-z0-9_]{0,11}`
- `E_ALIAS_AFTER_CANONICAL` — canonical was already used plain before its alias declaration
- `E_TAG_SHORTHAND_REMOVED` — legacy `tag Name <alias>` (bare shorthand)
- `E_VENN_ALIAS_KEYWORD_REMOVED` — legacy venn `alias` keyword
- `W_ALIAS_CASE_NEAR_MATCH` — case-near-match suggestion
- `W_ALIAS_UNDERUSED` — alias declared but referenced ≤1 time

---

## 3. Sequence Diagrams

### 2.1 Participants

```
Name is a <type> [as <alias>] [position: N]
Name key: value
```

Types: `actor`, `database`, `cache`, `queue` (plus default — the plain rectangle, used when `is a` is omitted).

Type names in `is a X` are **case-insensitive** (`is a Actor`, `is an ACTOR`, `is an actor` all parse the same). The keywords `service`, `frontend`, `networking`, `gateway`, and `external` were removed in 0.16.0 and now emit `E_PARTICIPANT_TYPE_REMOVED`; drop the override and the participant renders as the default rectangle.

A participant _named_ with a removed-type keyword (e.g. `service -> User: hi` declares a participant named "service") remains valid. The trim affects only the `is a X` declaration syntax, not name resolution.

**Inference rules** — the parser infers the type (and shape) from the participant name. Only use `is a` when the name does not match or you want to override:

| Inferred Type | Shape                      | Name Patterns (examples)                                                                                                                                                                                                                                                                                     |
| ------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| actor         | Stick figure               | `User`, `Customer`, `Admin`, `Agent`, `Person`, `Buyer`, `Seller`, `Guest`, `Visitor`, `Operator`, `Developer`, Alice, Bob, Charlie, Fan, Purchaser, Reviewer, `*User`, `*Actor`, `*Analyst`, `*Staff`                                                                                                       |
| database      | Cylinder (vertical)        | `*DB`, `Database`, `Datastore`, `*Store`, `Storage`, `*Repo`, `Repository`, `SQL`, Postgres, MySQL, Mongo, Dynamo, Aurora, Spanner, Supabase, Firebase, BigQuery, Redshift, Snowflake, Cassandra, Neo4j, ClickHouse, Elastic, OpenSearch, Druid, Trino, Pinecone, Weaviate, Qdrant, Milvus, Presto, `*Table` |
| cache         | Dashed cylinder            | `*Cache`, Redis, Memcache, KeyDB, Dragonfly, Hazelcast, Valkey                                                                                                                                                                                                                                               |
| queue         | Horizontal cylinder (pipe) | `*Queue`, `*MQ`, SQS, Kafka, RabbitMQ, `EventBus`, `MessageBus`, `*Bus`, `Topic`, `*Stream`, SNS, PubSub, `*Broker`, NATS, Pulsar, Kinesis, EventBridge, CloudEvents, Celery, Sidekiq, EventHub, `*Channel`                                                                                                  |
| default       | Rectangle                  | Everything else (no `is a` needed)                                                                                                                                                                                                                                                                           |

**Inference handles it (skip `is a`):**

```
PostgresDB           // database (matches *DB)
Redis                // cache (exact match)
User                 // actor (exact match)
Kafka                // queue (exact match)
```

**Inference would miss (use `is a`):**

```
Vault is a database         // "Vault" matches no rule, but you want database
Notifications is a queue    // "Notifications" matches no rule
```

Names that previously inferred to a removed type — `AuthService`, `WebApp`, `Cloudflare`, `API Gateway`, `Stripe`, `Webhook` — now fall through to default (plain rectangle). That is the intended outcome of the trim: the visual differentiation is gone because the underlying distinction did not pull its weight.

### 2.2 Participant Groups

```
[Group Name]
  Participant1
  Participant2
```

- Metadata goes outside brackets: `[Backend] t: Eng`

### 2.3 Messages (Arrows)

| Type            | Syntax         | Example               |
| --------------- | -------------- | --------------------- |
| Sync (labeled)  | `A -label-> B` | `Client -login-> API` |
| Sync (bare)     | `A -> B`       | `Client -> API`       |
| Async (labeled) | `A ~label~> B` | `API ~notify~> Queue` |
| Async (bare)    | `A ~> B`       | `API ~> Queue`        |

- Whitespace around arrows is optional: `A-label->B` works
- Labels can contain spaces, hyphens, special chars
- Labels cannot contain arrow chars (`->`, `~>`)
- Same-line metadata: `A -msg-> B c: Caching`

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

### 4.1 Declaration

```
infra [Title]
```

### 4.2 Nodes

```
NodeName
NodeName key: value
NodeName as alias
"Node name with spaces or | reserved chars"
```

Nodes are plain names. Capabilities come from properties (see §4.3), not type declarations.

- **Aliases** (§2A): `NodeName as alias` binds a short alias used by edges and group references. Alias must start with a letter/underscore and be ≤12 chars.
- **Quoted names**: wrap the label in double quotes when it contains spaces followed by reserved chars (`|`, `:`, `(`).

### 4.3 Node Properties (Indented, Colon-Separated)

```
NodeName
  latency-ms: 50
  max-rps: 8000
  uptime: 99.99%
  cache-hit: 75%
  description: My API gateway
  firewall-block: 10%
  instances: 3
```

Properties use a known schema with colon-separated values (the space-separated form is a parse error — `latency-ms 50` is rejected with a hint to use `latency-ms: 50`):

| Property                  | Capability         | Effect                                               |
| ------------------------- | ------------------ | ---------------------------------------------------- |
| `cache-hit`               | Cache              | % requests served from cache, reduces downstream RPS |
| `firewall-block`          | Firewall/WAF       | % requests blocked, reduces downstream RPS           |
| `ratelimit-rps`           | Rate limiter       | Max RPS passed through                               |
| `latency-ms`              | Latency            | Adds to path latency                                 |
| `uptime`                  | Availability       | Multiplied along path for SLO                        |
| `instances`               | Horizontal scaling | Multiplies capacity (number or `min-max` range)      |
| `max-rps`                 | Capacity ceiling   | Max RPS node handles                                 |
| `cb-error-threshold`      | Circuit breaker    | Error rate trip threshold                            |
| `cb-latency-threshold-ms` | Circuit breaker    | Latency trip threshold                               |
| `concurrency`             | Concurrency limit  | Max concurrent requests (serverless)                 |
| `duration-ms`             | Processing time    | Time spent processing (serverless)                   |
| `cold-start-ms`           | Serverless         | Cold start penalty                                   |
| `buffer`                  | Queue              | Buffer size                                          |
| `drain-rate`              | Queue              | Consumption rate                                     |
| `retention-hours`         | Queue              | Message retention                                    |
| `partitions`              | Queue              | Partition count                                      |
| `description`             | Display            | Description text                                     |

**Mutually exclusive:** `concurrency` ≠ `instances` ≠ `max-rps`; `buffer` ≠ `max-rps`. A node is serverless, traditional, or a queue — not two at once.

### 4.4 Connections

| Type            | Syntax            |
| --------------- | ----------------- |
| Sync (bare)     | `-> Target`       |
| Sync (labeled)  | `-/api-> Target`  |
| Async (bare)    | `~> Target`       |
| Async (labeled) | `~event~> Target` |

- Connection metadata: `split: 50%, fanout: 3` (colons required in metadata pairs)
- Indented under source node
- Async edges (`~>`) render with a wiggle pattern
- Target may be a node id, an alias, or a group ref `[Group Name]`

### 4.5 Fanout

```
SearchAPI
  -> SearchShards fanout: 6
```

`fanout: N` multiplies the per-edge RPS delivered to the target by `N` (request amplification — scatter-gather, shard fanout, pub/sub).

- Effect: `target_rps = source_post_behavior_rps × fanout` (then split-distributed across declared targets)
- Combine with `split`: `-> Target split: 50%, fanout: 3`
- `N` must be ≥ 1; sub-1 values are warned and clamped
- Sources with at least one `fanout > 1` outgoing edge gain the **Fan-Out** capability badge
- The legacy `xN` suffix (e.g. `... -> Target x5`) is removed — use `fanout: N`

### 4.6 Groups

```
[Group Name]
[Group Name] as alias
[Group Name] key: value
```

- Bracket syntax only. Group coloring via tags.
- Optional `as <alias>` postfix and same-line metadata.
- **No nesting.** A group cannot contain another `[...]` group; only indented components.
- Group properties (indented under the bracket line):
  - `instances N` or `instances N-M` — capacity multiplier on children (auto-scaling)
  - `collapsed true` — start collapsed; renders as a single node showing the worst child health

### 4.7 Infra Options (Space-Separated, NO Colon)

- `direction-tb` (boolean; default is LR)
- `default-latency-ms N`
- `default-rps N` — fallback edge RPS when no `rps` is declared on the edge node
- `default-uptime DECIMAL`
- `slo-availability DECIMAL` — target availability for SLO compliance highlighting
- `slo-p90-latency-ms N` — target p90 for SLO compliance highlighting
- `slo-warning-margin DECIMAL` — margin below SLO that triggers warning state
- `animate` / `no-animate`
- `active-tag GroupName` / `active-tag none` — pre-select a tag filter on render

The universal options `solid-fill` and `no-title` also apply.

### 4.8 Edge Nodes

```
edge
internet
```

Special top-level entry points. Either name works; `internet` only accepts `rps` and the `description` is silently ignored on entry-point nodes.

### 4.9 Node Descriptions

```
API Gateway
  description: Handles routing and auth
  description: Supports rate limiting
  latency-ms: 50
  max-rps: 8000
```

- `description: text` (colon required; a description always needs the `description:` keyword — bare prose lines are NOT auto-promoted)
- Multiple `description:` lines accumulate into a multi-line description
- Supports inline markdown: `**bold**`, `*italic*`, `` `code` ``, `[links](url)`
- `- bullet text` renders as `• bullet text`
- Descriptions are ignored on `edge` and `internet` nodes

---

## 5. Flowchart Diagrams

### 4.1 Declaration

```
flowchart [Title]
```

### 4.2 Node Shapes

| Shape      | Syntax      | Example        |
| ---------- | ----------- | -------------- |
| Terminal   | `(Label)`   | `(Start)`      |
| Process    | `[Label]`   | `[Do Task]`    |
| Decision   | `<Label>`   | `<Check?>`     |
| I/O        | `/Label/`   | `/Read Input/` |
| Subroutine | `[[Label]]` | `[[Validate]]` |
| Document   | `[Label~]`  | `[Report~]`    |

- Node coloring: use tags (§1.3) — flowchart nodes have no color suffix

### 4.3 Arrows

| Type      | Syntax     |
| --------- | ---------- |
| Unlabeled | `->`       |
| Labeled   | `-label->` |

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
- `no-notes` (boolean; default off — suppress all note boxes, see §4.7)

`no-color` + `solid-fill` precedence: `no-color` wins for nodes with no explicit color (the muted neutral path bypasses `solid-fill`). Nodes with an explicit color survive `no-color` and are then rendered at full saturation if `solid-fill` is also on.

### 4.7 Notes (Nodes)

Attach an annotation to a node with `note <NodeId> text` (quote the id
for multi-word labels). The note renders as a folded-corner box beside
the node, expanded at rest.

```
note Validate checks the payload schema
note "Read Map" the map is half-burned
```

Indent lines below the heading for a multi-line body (bullets + inline
markdown, same as sequence notes). End the heading with a lowercase
palette color word to recolor the note. Notes may forward-reference a
node; an unknown id is an error, a duplicate note on a node is a warning
(first kept). `no-notes` suppresses every box.

Notes work on **flowchart**, **state**, **class** (`note <ClassName>`),
**er** (`note <Table>`), and **boxes-and-lines** (`note <Box>`). Org and
sitemap are excluded — their indentation *is* the tree structure, which
collides with the indented-body grammar.

---

## 6. State Diagrams

### 5.1 Declaration

```
state [Title]
```

### 5.2 States

```
StateName
StateName color
[*]                    // initial/final pseudostate
```

### 5.3 Transitions

| Type      | Syntax                      |
| --------- | --------------------------- |
| Unlabeled | `Idle -> Active`            |
| Labeled   | `Idle -submit-> Processing` |

### 5.4 Groups

```
[Group Name]
[Group Name] color
```

### 5.5 Notes (States)

State diagrams support the same `note <StateName> text` annotation as
flowcharts — single-line or indented multi-line body, forward
references, and the `no-notes` opt-out (see §4.7).

### 5.6 Options

- `direction-tb` (boolean; default is LR)
- `no-color` (boolean; default off — when on, all states resolve to the muted neutral fill instead of their default intent color)
- `solid-fill` (boolean; default off — render states with their full intent color instead of the canonical 25% tint; collapsed groups are also rendered at full saturation)
- `no-notes` (boolean; default off — suppress all note boxes, see §4.7)

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

- Node coloring: per-node indented metadata `\n  color: blue` (deferred to a follow-up spec; tag groups inside org also work)
- Same-line metadata: `Alice role: CEO, t: Exec`

### 6.3 Metadata (Indented, Colon REQUIRED)

```
Alice
  role: Senior Engineer
  location: NYC
```

This is key-value metadata assignment, consistent with same-line metadata syntax.

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

Indented metadata uses colon-separated `key: value`, consistent with org charts and same-line metadata.

### 7.4 Same-Line Metadata (Colons in pairs)

```
Web App is a container description: SPA, tech: React
```

### 7.5 Relationships

| Type           | Syntax                   |
| -------------- | ------------------------ |
| Sync labeled   | `-Makes API calls-> API` |
| Sync with tech | `-Uses [HTTPS]-> API`    |
| Async labeled  | `~Sends emails~> Email`  |

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

// Bare keyword form (DEPRECATED — emits a warning; prefer the colon form above)
API is a container
  description Handles all REST endpoints

// Same-line metadata form
Database is a container description: PostgreSQL with read replicas
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
users blue
users domain: Core
```

- Same-line metadata on declaration line only
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

| Relationship   | Arrow   |
| -------------- | ------- | --- |
| Inheritance    | `--     | >`  |
| Implementation | `..\|>` |
| Composition    | `*--`   |
| Aggregation    | `o--`   |
| Dependency     | `..>`   |
| Association    | `->`    |

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
[Column Name] color wip: 3
```

### 10.3 Cards (Indented Under Columns)

```
[To Do]
  Card title priority: High, c: Owner
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
  Pricing Auth: Public
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
  Pricing Auth: Public
```

### 11.5 Node Descriptions

```
// Bare keyword form (DEPRECATED — emits a warning; prefer description: above)
About
  description Company history and team bios

// Same-line metadata form
Pricing description: Compare plans and features

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
era 2026-04-06 -> 2026-04-10 Conference purple
```

**Block form:**

```
era
  2026-04-06 -> 2026-04-10 Conference purple
  2026-06-01 -> 2026-06-05 Sprint Review blue
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
  2026-06-15 Release green
```

### 12.7 Groups (Swimlanes)

```
[Backend] t: Engineering
```

Bracket syntax only.

### 12.8 Tasks

```
Database Schema duration: 20bd, p: Foundation, progress: 100
API Integration duration: 10bd, t: Engineering
Launch Day duration: 0d
Setup start: 2026-03-15, duration: 30d
Design Review start: 2026-04-01
```

A task line MUST have `duration:` or `start:` (or both) in its metadata.
Duration units: `min`, `h`, `d`, `bd` (business days), `w`, `m`, `q`, `y`, `s` (sprints)
Uncertain: `duration: 10bd?` (trailing `?` on the value)
Progress: `progress: 80` in metadata (integer 0–100)

### 12.9 Dependencies (Indented Under Tasks)

```
API Integration duration: 10bd
  -> E2E Testing
  -> Launch Day offset: 10bd
```

### 12.10 Parallel Block

```
parallel
  [Backend]
    Schema duration: 20bd
  [Frontend]
    Wireframes duration: 10bd
```

---

## 13A. PERT Diagrams

PERT diagrams visualize project networks with three-point duration estimates, surfacing critical path, slack, and project μ/σ. Each activity renders as a node card (rectangle, or diamond for milestones); dependencies are arrows between them. Monte Carlo simulation runs automatically whenever any activity carries duration data.

```
pert Pirate Voyage
time-unit w
default-confidence medium

voyage approved 0
  -> recruit crew

recruit crew 1 2 4 as rc confidence: low
  -> load powder

load powder 0.5 1 2
  -> sail to atoll

sail to atoll 3 5 8
  -> count gold
  -> repair hull

count gold 0.5
  -> divvy shares

repair hull 2 3 5 confidence: low
  -> divvy shares

divvy shares 1 2 3
```

### Directives

| Directive                     | Effect                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `time-unit <unit>`            | Unit for bare-number durations (default `d`); accepts `min`, `h`, `d`, `bd`, `w`, `s` (sprints)                                                                                                       |
| `default-confidence <level>`  | M-only heuristic: `high`, `medium`, `low`, or a custom `O/P` factor pair (e.g. `0.6/2.5`)                                                                                                             |
| `direction <LR\|TB>`          | Layout direction (default `LR`)                                                                                                                                                                       |
| `node-detail <compact\|full>` | Visual density; `full` adds slack bars and σ-as-border-thickness                                                                                                                                      |
| `no-analysis`                 | Bare flag — hide the analysis layer (tornado + S-curve). The layer renders by default whenever Monte Carlo ran; this suppresses it. An explicit `viewState.an` (app toggle / share link) overrides it |
| `trials <N>`                  | Canonical Monte Carlo trial count (`< 100` clamps to analytical)                                                                                                                                      |
| `seed <N>`                    | Mulberry32 PRNG seed for deterministic runs                                                                                                                                                           |
| `scrubber-trials <N>`         | Fast-MC trials for the interactive duration scrubber                                                                                                                                                  |
| `start-date <YYYY-MM-DD>`     | Anchor the forward pass — accepts the literal `now`                                                                                                                                                   |
| `end-date <YYYY-MM-DD>`       | Anchor the backward pass (mutually exclusive with `start-date`)                                                                                                                                       |
| `sprint-length <duration>`    | Sprint length when sprint mode is active (default `2w`)                                                                                                                                               |
| `sprint-number <N>`           | Starting sprint label N — cells render as `S<N+offset>` (default `1`)                                                                                                                                 |
| `sprint-start <YYYY-MM-DD>`   | Optional ISO date the starting sprint begins on                                                                                                                                                       |
| `active-tag <GroupName>`      | Pre-expand a tag group + drive node fill                                                                                                                                                              |

Sprint mode activates automatically when `time-unit s` is set, or explicitly when any `sprint-*` directive appears. ES/EF/LS/LF cells then render as `S5`, `S7`, etc.

### Activities

An activity is `<name> [<durations>] [as <id>] [k: v, ...]`. Durations follow the name, separated by spaces or commas:

| Form                 | Meaning                                                        |
| -------------------- | -------------------------------------------------------------- |
| `recruit crew 1 2 4` | Three-point estimate: O M P (in the active `time-unit`)        |
| `recruit crew 2`     | M-only; parser fills O and P from `default-confidence` factors |
| `celebrate`          | TBD: no estimate; downstream activities inherit `?`            |

Two-number durations are rejected (the parser cannot disambiguate O+M, M+P, or O+P). Universal alias syntax per §2A applies: `recruit crew 1 2 4 as rc`. Names containing the literal token `as` parse cleanly when no actual alias suffix is appended (`serve as quartermaster 2 3 5`).

### Milestones

Milestones are zero-duration nodes rendered as diamonds. Declare them as zero-duration activities using the standard grammar — there is **no** `milestone` keyword:

```
voyage approved 0
landfall 0 0 0
```

Both forms render as diamonds and participate in the dependency graph and critical-path computation.

### Dependencies

Indented `-> dest` lines under an activity declare a dependency from that activity to `dest`. Destinations must reference a **previously-declared** activity name or alias — inline forward-declaration on the arrow line is rejected.

#### Edge types and lag/lead

Edges default to **Finish-to-Start (FS) with zero lag**. The arrow may carry an inline label between two dashes to override either piece:

| Syntax         | Meaning                             |
| -------------- | ----------------------------------- |
| `A -> B`       | FS, 0 lag (default)                 |
| `A -SS-> B`    | Start-to-Start                      |
| `A -2d-> B`    | FS with +2d lag (lag-only shortcut) |
| `A -SS+2d-> B` | SS with +2d lag                     |
| `A -FF-1d-> B` | FF with -1d lead (negative lag)     |
| `A -SF+3d-> B` | SF with +3d lag                     |

| Type | Constraint          | Use case                        |
| ---- | ------------------- | ------------------------------- |
| FS   | `B.ES ≥ A.EF + lag` | Default; sequential work        |
| SS   | `B.ES ≥ A.ES + lag` | Parallel start                  |
| FF   | `B.EF ≥ A.EF + lag` | Synchronized finish             |
| SF   | `B.EF ≥ A.ES + lag` | Rare; included for completeness |

Type names are case-insensitive. Lag amount inherits the diagram's `time-unit`; per-edge unit overrides are accepted (`-SS+2d->`, `-FF+4h->`). A `-` sign denotes a **lead** (overlap). Non-default edges paint a small midpoint label (`SS +2d`, `FF -1d`); FS+0 edges stay clean. Every `->` is independently FS — there is no `default-edge-type` directive.

### Groups

Bracketed `[group-name]` blocks cluster activities. Whether a group renders as a hammock super-edge or a tinted cluster rectangle is auto-detected from edge topology — single entry + single exit collapses to a hammock; multi-entry or multi-exit renders as a cluster.

```
[outfit ship]
  recruit crew 1 2 4
    -> load powder
  careen hull 1 1.5 2.5
    -> load powder
  load powder 0.5 1 2
    -> sail to atoll

sail to atoll 3 5 8
```

Groups can author `collapsed: true` to start collapsed.

### Same-line metadata

| Key                             | Where           | Meaning                                                                           |
| ------------------------------- | --------------- | --------------------------------------------------------------------------------- |
| `confidence`                    | activity        | Per-activity override of `default-confidence` (`high` / `medium` / `low` / `O/P`) |
| `collapsed`                     | group           | `true` to start the group collapsed                                               |
| tag aliases (e.g. `c: Captain`) | activity, group | Resolves to the declared tag group; drives node fill when the group is active     |

### Tags

PERT uses the universal tag system. Declarations live above the diagram body and apply to activities and groups via same-line metadata:

```
pert Pirate Voyage by Crew Role
time-unit w

tag Crew as c
  Captain red
  Bosun orange
  Quartermaster blue

recruit crew 1 2 4 c: Quartermaster
load powder 0.5 1 2 c: Bosun
```

The first declared tag group is active by default and colors nodes; `active-tag <GroupName>` only matters with two or more groups when you want a non-first group active, and `active-tag none` suppresses coloring entirely. When a group is active, the activity card's middle (name) band picks up the tag color while the border continues to communicate criticality. Milestone diamonds adopt the tag color across the full pill.

### Date anchoring

`start-date YYYY-MM-DD` anchors the forward pass; `end-date YYYY-MM-DD` anchors the backward pass. They are mutually exclusive. When anchored, ES / EF / LS / LF cells render as calendar dates and slack normalizes to days. `start-date now` resolves to today at parse time and is substituted before share-link compression so recipients see the author's view. `end-date now` is a parse error.

In backward mode with Monte Carlo active, the project-stats caption reframes its percentile rows from _finishes_ to _latest-safe starts_ — higher confidence demands an earlier start. Latest-safe-start dates that fall in the past relative to the parse-time today date append `(latest-safe start has passed)`.

### Critical path and analysis

Forward/backward pass, slack, M-world critical path, and project μ/σ are always computed. Critical-path activities and edges paint with a red border (`palette.colors.red`) in analytical mode. When Monte Carlo runs (any non-milestone activity has a duration), criticality is banded by the criticality index: red ≥ 0.80, orange ≥ 0.50, yellow ≥ 0.25, green ≥ 0.10, blue ≥ 0.02. The project-stats caption reports expected duration, σ, and P50/P80/P95 dates. Activities downstream of a TBD activity render `?` for ES/EF/LS/LF/slack and dashed borders.

See spec §13A for full date-anchoring semantics, S-curve axes, and diagnostic codes.

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
NodeLabel key: value, key2: value2
NodeLabel description: Some text here
```

Nodes are created explicitly or implicitly (when referenced in edges). All nodes render as uniform rounded rectangles.

The `description` key is extracted as a dedicated field and not stored in metadata.

### 13.3 Edges

```
Source -> Target
Source -> Target key: value
Source -label-> Target
Source <-> Target
Source <-label-> Target
```

Indented shorthand (source from preceding node):

```
API description: Main gateway
  -routes-> UserService
  -routes-> ProductService
```

Same-line metadata on edges:

```
A -reads-> DB frequency: High
```

### 13.4 Groups

```
[Group Name]
  indented nodes...

[Group Name] key: value
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
- `box-metric <Label> [low] [high]` — name a numeric value dimension (see §13.8); one trailing color sets the high hue over a neutral low, two set explicit `low high` ramp endpoints
- `show-values` — print each box's numeric value as text (off by default)

### 13.7 Options

- `active-tag GroupName` — set active tag group for coloring
- `active-tag none` — suppress tag coloring
- `active-tag <metric>` — make the value ramp the active dimension (see §13.8)
- `hide team:Backend, team:Frontend` — hide nodes with matching tag values (colon syntax for tag:value)

### 13.8 Value metric (numeric ramp)

Boxes can carry a numeric measure that drives a continuous color ramp — a
choropleth-style "value dimension" alongside the categorical tag groups.

```
boxes-and-lines Fleet Crews
box-metric Crew blue
show-values

Flagship value: 120
Frigate value: 40
Sloop value: 12
Flagship -> Frigate
Flagship -> Sloop
```

- `value: <number>` on any box records its measure (a reserved metadata key —
  lifted out, never rendered as a tag). Non-numeric values are an error.
- `box-metric <Label> [low] [high]` names the dimension and optionally sets the
  ramp endpoint colors: no color → primary hue / neutral low; one color → that
  high hue / neutral low; two → explicit `low high` (e.g. `box-metric Risk green
  red`). Order is literal — polarity (good vs bad) is your choice. A wide-hue-gap
  pair routes through a neutral midpoint (so green→red mid values stay clean);
  analogous pairs blend directly.
- The ramp anchors at `0` for all-non-negative data, else at the data minimum.
- The value ramp is the resting-active dimension whenever any box has a
  `value:` (so value shading works in static export with no interaction).
  `active-tag <tag-group>` switches to a tag group; `active-tag none` suppresses
  tinting; `active-tag <metric>` forces the value ramp. On a name collision
  between a tag group and the metric label, the tag group wins.
- When the value ramp is active, every box tints along the min→max ramp and the
  legend shows a gradient capsule; boxes without a `value:` get a neutral fill.
- `show-values` additionally prints each box's number as text.

---

## 15. Timeline Diagrams

### 14.1 Declaration

```
timeline [Title]
```

### 14.2 Events

Events use **name-first syntax** with `start:`, `end:`, and `duration:` as reserved metadata keys.

**Point event** (`start:` only):

```
Blockades Charleston start: 1718-05, p: Blackbeard
```

**Range event** (`start:` + `end:`):

```
Sails under Hornigold start: 1716, end: 1717, p: Blackbeard
```

**Duration event** (`start:` + `duration:`):

```
Sprint 1 start: 2026-03-20, duration: 30d
```

**Uncertain ending** (`?` suffix on `end:` or `duration:`):

```
Rackham builds crew start: 1718, end: 1719?
```

Event type is determined by key presence:

- `start:` only → point event
- `start:` + `end:` → range event
- `start:` + `duration:` → duration event

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
  1718 -> 1720 Woodes Rogers Era orange
```

### 14.4 Markers

**Flat form:**

```
marker 1718-07 Woodes Rogers arrives orange
```

**Block form:**

```
marker
  1718-07 Woodes Rogers arrives orange
  1720-01 End of Golden Age red
```

### 14.5 Groups

```
[Royal Navy]
  Woodes Rogers arrives start: 1718-07
```

---

## 16. Data Charts

### Conventions shared across all data charts

Every section under §15 follows the same two rules.

**Rule A — data rows are space-separated.** Commas between values are tolerated for back-compat but not idiomatic. Thousands-separator commas _inside a single number_ (`3,984,078.65`) are always supported.

```
Q1 400 700 300 500     ✅  preferred
Q1 400, 700, 300, 500  ⚠  tolerated; use spaces
```

**Rule B — list-of-labelled-items directives (e.g. `series`, `columns`) prefer the indented one-per-line form.** Short one-line forms are tolerated for ≤3 items with no colour annotations or spaces.

```
series                            ✅  preferred
  Cloud Platform blue
  Legacy Suite red
  Mobile App green

series Cloud blue, Legacy red ⚠  tolerated; prefer the block
```

Parsers accept either form. The rules above are authoring guidance.

### 15.1 Simple Charts (bar, line, pie, doughnut, area, polar-area, radar, bar-stacked)

**Declaration:** `bar [Title]`, `line [Title]`, etc.

**Series** — follows Rule B (prefer the indented block):

```
series
  Cloud Platform blue
  Legacy Suite red
```

Short one-line form is tolerated: `series Revenue` or `series A B`.

**Data rows** — follows Rule A:

```
Label 100
Label 100 200 300
Label color 100        // trailing color before numeric values
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
era Day 1 -> Day 3 Rough Seas red
```

### 15.2 Scatter / Bubble Charts

**Data rows** — follows §15 Rule A (space-separated):

```
Name x y
Name x y size
```

**Categories:**

```
[Caribbean] red
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

15 degrees blue: -0.001*x^2 + 0.27*x
45 degrees red: -0.003*x^2 + 0.75*x
```

The colon between name and expression is **required** — both sides can contain spaces, so colon is the unambiguous delimiter.

**Options:**

- `shade` (boolean; off by default, shades area below curves when enabled)

### 15.5 Sankey Charts

**Tree structure (indented, space-separated):**

```
Sugar Plantations green
  Tortuga Distillery orange 3000
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
- Color annotations: `Label color value1 value2` (trailing color word before numeric values)
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

[Caribbean] red
  Blackbeard -> Bonnet 8
  Blackbeard -> Vane 5

order group
```

- Link: `Source -> Target weight` — space before optional weight
- Options: `order appearance|name|group|degree`

### 16.4 Venn Diagrams

```
venn Skill Overlap

Swordsmanship as sw red
Navigation as nav blue
Leadership as lead green

sw + nav Sea Raiders
sw + nav + lead Legendary Pirates
```

- Set declaration: `Name [color] as <alias>` — color is an optional trailing token BEFORE `as` (universal alias syntax, §2A)
- Intersections: `Set1 + Set2 Label` — label follows the last set reference (no colon)
- Legacy `Name(color) alias X` emits `E_VENN_ALIAS_KEYWORD_REMOVED` per TD-18

### 16.5 Quadrant Diagrams

```
quadrant Crew Assessment
x-label Low Skill, High Skill
y-label Low Loyalty, High Loyalty

top-right Promote green
top-left Train yellow
bottom-left Maroon red
bottom-right Watch Closely purple

Quartermaster 0.9 0.95
Navigator 0.85 0.8
```

- Axis labels: `x-label Low, High` — comma-separated (low/high pair, not a data row; comma is the delimiter here by design)
- Position labels: `top-right Label` — space-separated
- Data points: `Label x y` — follows §15 Rule A (space-separated; `Label x, y` tolerated for back-compat)

---

## 18. Mindmap Diagrams

A radial hierarchy of ideas branching out from a central root. Hierarchy is established by indentation, nodes accept descriptions and tag-driven coloring, and any subtree can be collapsed by default.

```
mindmap Product Strategy

tag Priority as p
  High red
  Low green

Research
  User Interviews p: High
  Competitor Analysis
Development p: High
  MVP Features
    Auth System
      description: Login, signup, OAuth
    Dashboard
  Nice-to-haves p: Low, collapsed: true
    Dark Mode
```

### Declaration

```
mindmap [Title]
```

The title doubles as the root node — `mindmap Product Strategy` renders a root labeled "Product Strategy". Indent-0 lines under the title become its children.

Omitting the title enables **multi-root mode**: each indent-0 line starts its own tree, and the title is inferred from the first root.

```
mindmap

Q1 Goals
  Ship MVP
Q2 Goals
  Launch marketing
```

### Hierarchy

Indentation alone defines parent / child. Any indent step (typically two spaces) nests a node under the line above it.

```
mindmap Root
  Branch A
    Leaf A1
    Leaf A2
  Branch B
```

### Descriptions

Nodes accept a `description` field as either same-line metadata or an indented sub-line. Both populate the same field; same-line wins if both are present.

```
mindmap Onboarding

Surveys description: Quarterly NPS survey
Auth System
  description: Handle login, signup, OAuth flows
  description OAuth supports Google and GitHub
  Login Page
```

- Multiple `description` lines accumulate into a multi-line description.
- Indented descriptions must appear **before** any child node — placing one after a child emits a warning.
- Only the literal key `description` is recognized as indented metadata; everything else indented under a node is treated as a child node (e.g. `role: Engineer` becomes a child labeled "role: Engineer").
- Empty `description:` is silently skipped.
- Inline markdown is supported: `**bold**`, `*italic*`, `` `code` ``, `[links](url)`, and `- bullet` lines render as `• bullet`.

### Metadata keys

Same-line metadata uses the universal `key: value, key2: value2` form (§1.4). Recognized keys:

| Key                         | Effect                                   |
| --------------------------- | ---------------------------------------- |
| `description`               | Description text (see above).            |
| `collapsed`                 | `true` collapses the subtree by default. |
| Tag alias (e.g. `p:`, `d:`) | Assigns the node to a tag-group value.   |

```
Task p: High, d: Engineering
Demo Video description: 2-min product walkthrough
Nice-to-haves p: Low, collapsed: true
```

### Node color

Color comes from **tag groups** (§1.3 of the spec), not from a trailing color token on the node label. Declare a tag, then reference it via its alias in same-line metadata:

```
mindmap Roadmap

tag Priority as p
  High red
  Medium yellow
  Low green

Ship MVP p: High
Polish UX p: Medium
```

### Collapse

Any node with children may be collapsed. Set `collapsed: true` in same-line metadata to make a subtree start collapsed; collapsed nodes render with an accent drill-bar so they remain discoverable. Collapse state is runtime-only — the source is always fully expanded, and live toggling in the app does not mutate the file.

```
Nice-to-haves p: Low, collapsed: true
  Dark Mode
  Export PDF
```

### Options

| Option                 | Effect                             |
| ---------------------- | ---------------------------------- |
| `active-tag GroupName` | Sets the default active tag group. |

Universal options (`palette`, `theme`) apply as elsewhere.

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

| Syntax                    | Element         | Example                         |
| ------------------------- | --------------- | ------------------------------- |
| `[text]` (leaf)           | Text input      | `[Email address]`               |
| `[Name]` (with children)  | Group/region    | `[Sidebar]` + indented children |
| `(Label)`                 | Button          | `(Submit)`                      |
| `{A \| B \| C}`           | Dropdown/select | `{Small \| Medium \| Large}`    |
| `<x>` / `< >`             | Checkbox        | `<x> Remember me`               |
| `(*) Label` / `( ) Label` | Radio button    | `(*) Option A`                  |
| `# Text` / `## Text`      | Heading         | `# Sign In`                     |
| `---`                     | Divider         | `---`                           |
| `- text`                  | List item       | `- Electronics`                 |
| Bare text                 | Text/paragraph  | `Welcome to our app`            |

### Keyword Elements

| Keyword       | Type           | Parameters                             |
| ------------- | -------------- | -------------------------------------- |
| `nav`         | Block          | Children are nav items                 |
| `tabs`        | Block          | Children are tab labels                |
| `table`       | Block          | Comma-separated rows; first = header   |
| `table RxC`   | Skeleton table | `table 5x4` + optional header row      |
| `image`       | Leaf           | `round`, `wide` hints                  |
| `modal Title` | Block          | Rendered as separate panel below       |
| `skeleton`    | Block          | Children render as grey placeholders   |
| `alert`       | Block          | Optional semantic state                |
| `progress N`  | Leaf           | Value 0-100: `progress 60`             |
| `chart type`  | Leaf           | `chart line`, `chart bar`, `chart pie` |

### Flags (States)

Wireframe uses flag keywords as a trailing-keyword list (not `key: value`):

```
(Submit) disabled
(Delete) destructive
(Cancel) ghost
[Email] password
[Notes] textarea
[Cards] horizontal
[Advanced] collapsed
[Messages] scrollable
<x> Dark mode toggle
```

Available states: `disabled`, `active`, `selected`, `empty`, `ghost`, `destructive`, `success`, `warning`, `info`, `scrollable`, `collapsed`, `toggle`, `password`, `textarea`, `horizontal`, `primary`.

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
- `[Name] horizontal/scrollable/collapsed` = group (even without children)

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
- `horizontal` flag on groups arranges children in a row

### Example

```
wireframe Login Page

[Header]
  nav
    Home active
    Settings

[Main]
  # Sign In
  Email  [user@example.com]
  Password  [****] password
  <x> Remember me
  (Sign In)
  (Forgot Password?) ghost
```

---

## 20. Tech Radar Diagrams

```
tech-radar Title

rings
  Adopt
  Trial
  Assess
  Hold

Techniques quadrant: top-right
  Continuous Deployment ring: Adopt, trend: stable
    Fully adopted across all services.
  Micro Frontends ring: Trial, trend: up

Tools quadrant: top-left
  Vite ring: Adopt, trend: up
  Webpack ring: Hold, trend: down
```

### Rings

Declared in a `rings` block, one per indented line. Order: innermost (first) to outermost (last). Any names, any count.

Aliases supported: `Adopt as a` — then blips can use `ring: a`. (Universal alias syntax per §2A.)

### Quadrants

Exactly 4 required. Each is a top-level header with same-line metadata:

```
Name quadrant: position
```

**Positions:** `top-left`, `top-right`, `bottom-left`, `bottom-right` — each used exactly once.

Optional color override: `Tools quadrant: top-left, color: purple`

Default colors: top-left=blue, top-right=green, bottom-left=red, bottom-right=orange.

### Blips

Indented under their quadrant. Require `ring` metadata (case-insensitive match). Optional `trend`:

```
  Item Name ring: Adopt, trend: stable
```

**Trends:** `new` (double circle), `up` (inward crescent), `down` (outward crescent), `stable` (plain circle). Omitting renders plain circle.

### Descriptions

Further-indented lines below a blip. Supports inline markdown (bold, italic, code, links).

```
  Rust ring: Assess, trend: new
    Evaluating for **performance-critical** services.
```

### Numbering

Blips receive sequential global numbers. Order: quadrants clockwise (top-left → top-right → bottom-right → bottom-left), then by ring (innermost first), then declaration order.

---

## 21. Cycle Diagrams

Circular process flows where nodes sit on a ring and directed edges connect each to the next, wrapping from last back to first. Common use: OODA loops, PDCA, product lifecycles, continuous improvement.

### Declaration

```
cycle [Title]
```

### Nodes

Non-indented lines declare nodes. Nodes are positioned on the circle in source order. Minimum two nodes.

```
cycle PDCA

Plan
Do
Check
Act
```

Color via the trailing-token form when it's the only setting:

```
Plan green
Do blue
Check orange
Act red
```

### Descriptions

Indented lines under a node become the description. Inline markdown is supported (`**bold**`, `*italic*`, `` `code` ``, `[links](url)`), and `- item` renders as `• item`.

```
Observe
  Gather raw information from the environment
  Monitor **unfolding** circumstances
```

A same-line `description:` works too, and concatenates with any indented lines (same-line first):

```
Plan description: Set the objective and the route
```

### Edges

Edges are **implicit** — every node connects to the next, with the last wrapping to the first. Use `->` lines only when you want to label or style an edge. Indent the edge line under its source node, before or after description lines.

```
Observe blue
  -Unfold circumstances->
    Synthesize raw data into actionable context
```

Explicit targets after `->` are accepted but ignored — cycle edges always follow source order. A mismatch with the actual next node emits an info diagnostic.

### Edge Metadata

Edges use the long-form `color: <name>` (narrow exception per §1.5 — edges have no trailing-token slot). `width` is in pixels.

| Key     | Default                    | Notes                   |
| ------- | -------------------------- | ----------------------- |
| `color` | inherits source node color | Long-form only on edges |
| `width` | 3–4 px                     | Stroke width            |

```
Decide orange
  -Commit to action-> color: orange, width: 5
Act red
  -> width: 4
```

### Shape and Direction Directives

| Directive                    | Effect                                                                 |
| ---------------------------- | ---------------------------------------------------------------------- |
| `circle-nodes`               | Render nodes as uniform-diameter circles instead of rounded rectangles |
| `direction-counterclockwise` | Reverse the cycle (default: clockwise)                                 |

### Span Metadata

`span` controls the relative arc distance from a node to the next one. Default is `1`; decimals are allowed. Zero or negative values are a parse error. Use this to bias a step's footprint on the ring.

Because `span` rides alongside other keys, use the same-line metadata form — color reverts to long-form when sharing a line:

```
Plan color: green, span: 2
Do color: blue, span: 1
Check color: orange, span: 1
Act color: red, span: 1.5
```

### Parsing Notes

- Node labels cannot contain `->` or `<-` — parse error with hint.
- A bare `-` followed by non-arrow text inside an indented block is a bullet, not an edge.
- Minimum 2 nodes required.

### Complete Example

```
cycle OODA Loop

Observe blue
  Gather raw information from the environment
  Monitor unfolding circumstances
  -Unfold circumstances-> color: blue
    Synthesize raw data into actionable context
    Identify **key patterns** and anomalies

Orient green
  Analyze and synthesize observations
  Form a mental model of the situation
  -Form hypothesis-> color: green

Decide orange
  Select a course of action
  -Commit to action-> color: orange

Act red
  Execute the chosen course of action
  -Generate feedback-> color: red
    Results flow back into observation
```

---

## 22. Journey Map Diagrams

Persona-centric mood landscapes. Steps carry a 1–5 score and optional emotion label; the renderer draws an emotion curve over phase-grouped step cards. **Declaration is required** — the `journey-map` keyword must appear on the first line (no inference, to avoid colliding with kanban's `[Column]` + indented items shape).

### Declaration

```
journey-map [Title]
```

### Persona

One persona per diagram. Name is the rest of the line; an indented line under it is a description.

```
persona Tech-Savvy Shopper
  28yo developer, price-sensitive, does extensive research
```

Per §1.5, personas use long-form `color: <name>` (narrow exception — the persona-line parser does not peel a trailing color):

```
persona Captain Mara
  color: green
  description: Veteran navigator chasing one last horizon
```

### Phases

Phases are `[Bracket]` headers at indent 0. Steps live indented under them. Phases are optional — omit them for a continuous flat flow.

```
[Research]
  Compare specs score: 4
  Watch reviews score: 5
```

### Steps and Scores

Steps are step-name lines with §1.4 same-line metadata. `score` (1–5 integer, higher = better) and `emotion` (single word) are explicit, reserved keys. Scoreless steps render as cards but contribute no curve point.

```
Compare specs score: 4
Hit error score: 1, emotion: Frustrated
Got resolution score: 5, emotion: Relieved, ch: Mobile
Browsed casually                                      // no score = no curve point
```

- `score` outside 1–5, floats, or negatives → parse error.
- Multi-word emotion labels (e.g. `emotion: Very Happy`) → parse error.
- The legacy bare-score form (`Step | 4 Delighted`) is removed and emits `E_JOURNEY_BARE_SCORE_REMOVED`.

### Reserved Metadata Keys

Six keys are reserved on step lines and indented annotation lines. `score` and `emotion` belong on the step line; the rest are typically indented under the step as their own lines.

| Key           | Meaning           | Render                        |
| ------------- | ----------------- | ----------------------------- |
| `score`       | 1–5 integer       | curve point + card intensity  |
| `emotion`     | single-word label | emoji/label badge on the card |
| `description` | general context   | plain text under the card     |
| `pain`        | pain point        | red callout                   |
| `opportunity` | improvement idea  | green callout                 |
| `thought`     | inner monologue   | italic callout                |

Multiple annotations per step are allowed; each goes on its own indented line.

```
Forced account creation score: 1, emotion: Frustrated
  pain: Wants guest checkout
  pain: Password requirements too strict
  opportunity: Add social sign-in
  thought: This should not be this hard
  description: Spent ~4 minutes wrestling the form
```

### Tag Groups

Standard tag blocks with aliases color the step cards by a categorical dimension (channel, device, persona segment, …). Reference the tag via its alias in step metadata.

```
tag Channel as ch
  Web blue
  Mobile purple
  Email teal
  In-Person green

[Research]
  Compare specs score: 4, ch: Web
  Ask friends score: 4, ch: In-Person
```

### Directives

| Directive              | Effect                                          |
| ---------------------- | ----------------------------------------------- |
| `active-tag GroupName` | Set the active tag group for step-card coloring |
| `palette`, `theme`     | Universal options                               |

### Flat Mode

Omit `[Phase]` headers for a single horizontal strip:

```
journey-map Quick Feedback

Opened app score: 4
Searched for feature score: 3
Hit error score: 1, emotion: Frustrated
  pain: No helpful error message
Contacted support score: 2
Got resolution score: 5, emotion: Relieved
```

### Rendering Notes

- Emotion curve is the hero — filled area chart with gradient (green above the 3 midline, red below).
- Step cards tint by score (1=red → 5=green, palette-aware); phase headers tint to the phase's average score.
- Sharp-drop zones (≥ 2 between consecutive scored steps) auto-accent.
- Subtle horizontal grid lines at 1–5; score legend auto-generated.

---

## 23. Pyramid Diagrams

Hierarchical pyramid visualization with stacked layers, descriptions, and optional per-layer color. Source order reads apex-first (top of file = top of pyramid).

### Declaration

```
pyramid [Title]

LayerLabel
LayerLabel blue
LayerLabel green
  Indented description
```

The first line declares the chart type and an optional title. Each non-indented, non-directive line declares one layer. At least two layers are required.

### Example

```
pyramid Maslow's Hierarchy

Self-Actualization purple
  Morality, creativity, acceptance of facts.

Esteem blue
  Respect, recognition, confidence.

Love & Belonging green
  Friendship, intimacy, family.

Safety yellow
  Security, employment, health.

Physiological orange
  Food, water, warmth, rest.
```

### Layer Metadata

| Key           | Type         | Default | Description           |
| ------------- | ------------ | ------- | --------------------- |
| `color`       | palette name | auto    | Layer color           |
| `description` | string       | —       | One-liner description |

### Descriptions

Indented lines under a layer are description text. Markdown inline formatting (`**bold**`, `*italic*`, `` `code` ``, `[links](url)`) is supported. Bullets written as `- item` render as `• item`.

### Directives

| Directive  | Effect                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `inverted` | Flip apex to the bottom (funnel orientation). Source order is preserved — the first layer is always the visual top. |

### Overflow Handling

When descriptions don't fit a layer's band the renderer wraps at the column edge, truncates with `…`, auto-alternates descriptions left ↔ right when one column can't hold them, and (in-app) reveals the full description on highlight while hiding siblings.

---

## 24. Ring Diagrams

Concentric-ring visualization for nested or hierarchical categories. Source order reads core-out: top of file = innermost element (rendered as a filled disc), last line = outermost ring. Min 2 layers, max 15.

### Declaration

```
ring [Title]

LayerLabel
LayerLabel blue
LayerLabel green
  Indented description
```

### Example

```
ring Captain's Sphere of Influence

solid-fill

Captain purple
  Final word on heading and plunder,
  keeper of the ship's charter.

Quartermaster description: Second-in-command, divvies the booty

Crew green
  Deckhands, gunners, and powder monkeys.

Allied Crews orange
  Loose alliances kept by oath.

The Open Sea cyan
  Weather, currents, and rival flags.
```

### Layer Metadata

| Key           | Type         | Default | Description           |
| ------------- | ------------ | ------- | --------------------- |
| `color`       | palette name | auto    | Ring color            |
| `description` | string       | —       | One-liner description |

### Descriptions

Indented lines under a layer are description text. Markdown inline formatting is supported. Bullets written as `- item` render as `• item`. Descriptions appear in a stacked side list with colored accent bars.

### Directives

| Directive    | Effect                                                               |
| ------------ | -------------------------------------------------------------------- |
| `solid-fill` | Render rings with full intent color instead of the default 25% tint. |

`inverted` is **not** valid on ring diagrams (rings are rotationally symmetric). Using it emits an error-severity diagnostic and the line is discarded.

### Color Validation

Unknown color names emit an error-severity diagnostic with a "Did you mean…?" hint, and the layer falls back to its series color so the chart still renders.

### Label Degradation

When ring band thickness would force the in-band label below the readable floor (12 px), in-band labels are skipped entirely and the side list shows the layer names instead.

---

## 24A. RACI Matrices (RACI / RASCI / DACI)

A tasks × roles responsibility matrix with author-time linting. **One chart type — `raci` — covers all three variants.** Variant is inferred from the markers used; an optional `variant-*` directive locks it explicitly.

| Variant | Marker alphabet | Constraint                                   |
| ------- | --------------- | -------------------------------------------- |
| RACI    | `R A C I`       | Exactly one Accountable per task             |
| RASCI   | `R A S C I`     | Exactly one Accountable per task             |
| DACI    | `D A C I`       | Exactly one Driver and one Approver per task |

### Declaration

```
raci [Title]
[directives]
[Phase Label] [color]                         # optional bracketed phase header (trailing-token color)
  Task name
    Optional description line                  # multi-line, before the first role
    Role: <markers>                            # space-delimited markers from the alphabet
```

Three-level indentation: phase → task → role assignment / description. Phase headers are optional. Combined-marker cells are written space-delimited (e.g. `Cap: A R`).

### Example — RACI with phases

```
raci Voyage Operations
roles
  Cap  red
  QM   orange
  Bos  yellow
  Nav  blue
  Crew gray

[Departure] teal
  Plot the course
    Heading, currents, weather window
    Cap: A
    Nav: R
    QM: C
  Provision the hold
    QM: A R
    Crew: I

[At Sea] purple
  Stand the watch
    Bos: A
    Crew: R
```

### Example — DACI (variant inferred from `D`)

```
raci Choose the next port
roles Cap, Nav, QM, Bos

  Pick destination
    Cap: D
    Nav: A
    QM: C
    Bos: I
```

### Directives

| Directive                                         | Effect                                                                                                                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `variant-raci` / `variant-rasci` / `variant-daci` | Lock the chart to a specific variant. Markers outside the alphabet error. At most one per chart.                                                                                                                            |
| `roles`                                           | Declare column order. Inline (`roles Cap, QM, Bos`) is name-only; the indented block form supports per-role color via the trailing-token form (`Cap red`). When present, unknown roles in tasks emit `W_RACI_UNKNOWN_ROLE`. |
| `palette`, `theme`, `active-tag`                  | Universal options.                                                                                                                                                                                                          |

### Phase metadata

Phase headers accept a trailing-token color for per-phase styling:

```
[Departure] teal
[At Sea] purple
```

The phase bar tints to a soft mix of the color over the background. Phases without a color fall back to the neutral gray bar.

### Display vs source ordering

Markers in cells are always **rendered in canonical alphabet order** (`R A C I`, `R A S C I`, `D A C I`) regardless of source order. Source casing and order are preserved in the file; mutations operate on source order to keep round-trips byte-stable except for the cell that changed.

---

## 25. Map Diagrams

Geographic concept maps: highlight/shade political subdivisions, drop points of interest (POIs), and connect them with routes or edges. For "share a concept" business maps, not cartography. Renders at a fixed, auto-fit position — no pan/zoom. Basemap and viewport are **inferred from the content you reference** — most maps need no directives. v1 boundaries: world countries + US states.

**The zero-config map is the good-looking map.** Type `map`, name some places, and you're done — coastlines, mountain relief (on reference maps), region/POI labels, and orientation labels all render by default. There is no projection, scale, or label directive; the only knobs are the bare `no-*` opt-outs.

**How the map type is decided (inference):** the resolver takes the bounding box of everything referenced (valued/tagged regions + POIs + edge endpoints), pads it, and measures its span. Projection is **always inferred — never configured**: `albers-usa` (US conic + AK/HI insets) when the map is US-oriented; at world/multi-continent scale a **data** map (any region/POI carries `value:` or a tag) gets **Equal Earth** (equal-area — honest for thematic comparison) while a **dataless reference** map gets **natural-earth** (the prettier curved compromise); `mercator` for a tight regional or single-continent cluster. The US-state mesh is added whenever you name a US state (or the map is US-oriented).

### Declaration

```
map [Title]
```

Requires the explicit first line `map` — no content inference.

### Region fill — value (choropleth)

A subdivision name on its own line with a `value:` fills with a single-hue tint ramp (auto min→max, ~15% floor). `value:` is the single numeric channel — region shade, POI marker size, or edge/leg thickness depending on the element:

```
map US Sales
region-metric Sales ($M)

California value: 92
Texas value: 78
Florida value: 51
```

- `region-metric <label> [low] [high]` labels the ramp in the legend; one trailing color sets the high hue over a neutral low (`region-metric Sales ($M) blue` → blue ramp, default red), two set explicit `low high` endpoints (`region-metric Peril green red` → green→red, routed through a neutral midpoint). Order is literal — polarity is your choice.
- The ramp **auto-fits**: all-non-negative data anchors the low end at **0** (shared baseline); mixed-sign data fits data-min→data-max. There is no `scale` directive.
- A subdivision with no `value:`/tag renders as the neutral base.

### Region fill — categorical (tags)

Uses the universal tag model (§1.3): declare a `tag` group and apply its alias as a key. The first declared group colors regions by default; `active-tag` only selects a different dimension (another group, or the value ramp).

```
map Global Presence

tag Market as m
  HQ blue
  Region teal
  Prospect orange

United States m: HQ
Germany m: Region
Japan m: Region
```

`value:` + a tag on the same region (bivariate): both are kept as **two selectable colouring dimensions**. The top legend shows the value ramp and each tag group as mutually-exclusive, collapsible groups; the active one fills the map. Default is the value ramp (whenever any `value:` exists). `active-tag <GroupName>` colours by that tag; `active-tag <ValueLabel>` (the `region-metric` label, or `Value`) re-selects the ramp. In the app, clicking a legend group flips the active dimension (live preview only — no source edit); hovering a tag entry highlights the regions with that value, and scrubbing across the value gradient highlights the regions whose value is near the cursor (non-matching regions dim). No warning.

A **trailing color** on a region line (§1.5) is the lightweight highlight: `Texas red` (or `Texas red value: 90`, color before metadata) paints a flat fill with no tag group, ignoring the active dimension and adding no legend entry. It wins over the ramp and any tag on that region.

### Points of interest (`poi`)

```
poi <name | <lat> <lon>> [as <alias>] [<key>: <value>, …]
```

```
poi Austin                          # label defaults to "Austin"
poi Austin label: West HQ           # anchored at Austin; shows "West HQ"
poi 39.74 -104.99 as dcw            # positional coords (lat lon), signed
poi Dallas value: 320               # value: scales the marker radius (a data channel)
poi Chicago m: Office               # categorical color via a tag alias
poi Austin red                      # direct marker color (trailing token, §1.5)
```

- **Coordinates are positional** — two leading signed numbers (lat then lon); cities never start with a number.
- `value:` scales marker area (use `poi-metric <label>` for the legend key). A trailing color (`poi Austin red`) sets the marker fill directly — winning over a tag color and the default orange. POI properties: `label`, `value`, `style`, applied tag alias, `as`. No `icon` in v1.
- Coord-positioned or relabeled POIs take `as <alias>` for route/edge references; named POIs are referenced by name.

### Routes & connectors

`route <origin> [style: arc]` — an ordered, auto-numbered voyage; the origin gets a distinct marker. Each indented line is a `[-label->] destination` leg that continues from the previous stop — a leg is an edge (in-arrow label, `value:` thickness, `->`/`~>` or header `style: arc` shape). A **tag on a leg colours the LINE** (categorical leg-type colouring — flights vs cruises vs trains); `label:`/`as` still name the destination stop. Repeat the origin as a leg's destination to close a loop (no second marker):

```
route Miami style: arc
  -weigh anchor-> Havana value: 40
  -> Kingston
  -> Miami              # destination == origin → closed loop
```

Native edges handle any other connection (no `link`/`leg` keyword). A token draws an arrowhead iff it ends in `>`, an arc iff it starts with `~`; drop the `>` for a plain line when an arrow would mislead. The label always sits between the delimiters:

| | no label | labeled |
|---|---|---|
| directed straight | `A -> B` | `A -ships-> B` |
| directed arc | `A ~> B` | `A ~trade~> B` |
| undirected straight | `A -- B` | `A -ferry- B` |
| undirected arc | `A ~~ B` | `A ~cable~ B` |

```
A -> B                  # one-off, directed
A -ferry- B value: 12   # undirected line; value = line thickness
A ~cable~ B             # undirected arc with a label
A -> B -> C             # inline chain
dcw                     # hub/star — indented edges share the source
  -> office-east
  -- office-west        # hub legs accept any connector token
```

There is no geographic path-finding and no `surface:` — legs are plain straight or arced geometry (`style: arc` to bow one) and may cross land.

**Tagging the line.** A tag value on any connector or route leg colours the **line itself** (the universal tag model applied to edges) — the "trip-leg type" idiom. Edge-only tag groups show in the legend as a line-colour key; hovering a legend entry dims the lines that don't match. To categorise a **stop** instead, tag its own `poi` line. An edge-only tag group never tints regions or suppresses the colorize dress.

```
map Smuggler's Run

tag Leg as l
  Sail blue
  March green

poi 23.13 -82.38 as hav label: Havana
poi 18.02 -76.79 as cove label: Pirate's Cove

hav ~> cove l: Sail     # the LINE turns blue
cove -> hav l: March    # the LINE turns green
```

### Labels, legend & chrome

- Title is the declaration line; `caption` (data-source attribution, travels with the exported PNG) is the only chrome directive. There is no `subtitle`.
- Legend auto-composes below the title: the value ramp + `region-metric` and each tag group are **selectable colouring groups** (collapse/activate to flip the fill); POI size (`poi-metric`) and edge thickness (`flow-metric`) are self-evident from scale and carry no legend key in v1. `no-legend` suppresses all of it.
- **Region and POI labels are on by default.** Region labels auto-fit **full → abbrev → hide** (a US-state 2-letter abbreviation is tried when the full name doesn't fit; other regions degrade full → hide); POI labels are collision-managed. Labels render **on the map** (export-safe), escalating inline → leader line → numbered pin in dense clusters; markers never move. A wide map in a narrow column (< ~480px) prefers abbreviations and drops reference relief, as if zoomed out.
- **Cosmetic features are on by default**; the only switches are bare `no-*` opt-outs (no positive opt-in flag): `no-coastline`, `no-relief`, `no-context-labels`, `no-region-labels`, `no-poi-labels`, `no-legend`, `no-colorize`. A plain look = the four basemap flags together (`no-colorize` is **not** one of the four — it toggles region *fill style*, not a basemap backdrop layer).
- **Colorize (distinct political fills) is the default for any map without region data.** Unless a region carries data (a `value:` or a tag), every region drawn at the resolved extent is filled a **distinct light pastel** such that no two bordering regions share a hue — the conventional "colour the countries/states so neighbours separate" look, with zero config. It applies to named-region maps, POI/route-only maps, and even a bare `map` (the whole world colours as the backdrop). The fills are **non-semantic** (no legend entry) and **extent-independent** (a region's colour is the same at any width and in an inset). A direct trailing colour (`Texas red`) paints on top as a highlight and does not suppress colorize; adding any `value:`/tag flips the map to the data dress (colorize auto-suppressed, no error). `no-colorize` forces the plain green-land + blue-water dress — useful when many POIs/routes should pop against a calm map.

### Name resolution

- Admin units use **ISO 3166** (geometry keyed by code, so "United States" / "USA" / "US" resolve alike); cities use **GeoNames** (alias/accent matching, population ranking, did-you-mean).
- `locale <ISO>` scopes bare city resolution to a country (`locale US`) or subdivision (`locale US-GA`) — inferred from content if unset.
- A bare ambiguous, undeclared name → most-populous in scope (info note).
- **Disambiguate once:** trailing ISO code at first declaration — `San Jose CR` (country) or `Portland US-OR` (subdivision). Thereafter reference the bare name. Two same-named cities → `as <alias>` each.
- **Region fills disambiguate the country-vs-state collision** (`Georgia` = country `GE` or US state `US-GA`) by ISO code or name + scope — pick whichever reads best:
  - **Bare ISO code** (terse): `US-GA value: 5` → the state, `GE value: 5` → the country. Codes resolve directly and never warn.
  - **Name + scope** (readable): `Georgia US value: 5` → the state, `Georgia GE value: 5` → the country.
  - The redundant `Georgia US-GA` still works but isn't needed (a mismatched code like `Georgia US-CA` is rejected). A bare ambiguous `Georgia` follows the inferred US-scope signal and warns with both fixes named.
- **IATA airport codes** resolve to airport coordinates — `poi JFK`, `route JFK -> LAX` — with no new syntax (large international hubs + all US scheduled-commercial airports). Case-insensitive (`jfk`/`JFK`). Airports are the **lowest-precedence** identifier: a token that is both a city and a code resolves to the **city** (`Ufa` → the city, not UFA airport), with a hint naming the airport. Resolution is by **code only** (never by airport name); the POI label is the typed code. An unknown three-letter code errors with an `as <CODE>` coordinates hint.
- Positional coordinates are the escape hatch for anything missing/ambiguous (including forcing an airport over a colliding city: `poi 54.56 55.87 as UFA`).

### Directives & reserved keys

The directive set is **13, all colon-free**: six naming intent the renderer can't infer — `region-metric`, `poi-metric`, `flow-metric`, `locale`, `active-tag`, `caption` — and seven `no-*` cosmetic opt-outs — `no-legend`, `no-coastline`, `no-relief`, `no-context-labels`, `no-region-labels`, `no-poi-labels`, `no-colorize`. There is **no** `projection`, `scale`, `subtitle`, `surface`, `region`, or label-enum directive, and cosmetics have no positive opt-in form. Reserved metadata keys (need colons): `value`, `label`, `style` (`value` = the one numeric channel: region shade / POI size / edge thickness); `surface:` is no longer recognized. A bare US state postal code resolves to that state (`poi Portland OR` → Oregon; `CA` = California). Coordinates are positional (no `at:` key). Projection is inferred from extent + whether the map carries data (US → albers-usa; world data → Equal Earth; world reference → natural-earth; regional → mercator) and cannot be overridden.

---

## 26. Colon Usage Summary

### Constructs Where Colons Are REQUIRED

| Construct               | Diagram Type    | Example                             |
| ----------------------- | --------------- | ----------------------------------- |
| Same-line metadata      | all             | `key: value, key2: value2`          |
| Org metadata (indented) | org             | `role: Manager`                     |
| C4 metadata (indented)  | c4              | `description: SPA built with React` |
| Class field types       | class           | `+ name: string`                    |
| Class method returns    | class           | `+ sail(): void`                    |
| Function expressions    | function        | `f(x): x^2 + 1`                     |
| Hide tag values         | boxes-and-lines | `hide phase:Planning`               |
| Infra node properties   | infra           | `latency-ms: 50`                    |

### Colons OPTIONAL

| Construct                | Diagram Type | Example |
| ------------------------ | ------------ | ------- | ------------------------ | ----------------- |
| Class relationship label | class        | `--     | > Vessel : extends`or`-- | > Vessel extends` |

### Colons NOT USED

| Construct              | Diagram Type     | Example                               |
| ---------------------- | ---------------- | ------------------------------------- |
| Chart type declaration | all              | `bar Title`                           |
| Tag declarations       | all              | `tag Name as x`                       |
| Boolean options        | all              | `activations`, `no-activations`       |
| Key-value options      | all              | `start 2026-03-15`, `active-tag Team` |
| Series declarations    | data charts      | `series A B C`                        |
| Data rows              | bar/line/pie/etc | `Label 100`                           |
| ER columns             | er               | `id int pk`                           |
| Sequence messages      | sequence         | `A -msg-> B`                          |
| Groups/containers      | all              | `[Group Name]`                        |
| Section dividers       | sequence         | `== Phase ==`                         |
| Comments               | all              | `// comment`                          |
| Wordcloud data         | wordcloud        | `swordsmanship 95`                    |
| Slope data rows        | slope            | `Blackbeard 40 4`                     |
| Slope period directive | slope            | `period 1715 1725`                    |
| Venn intersections     | venn             | `sw + nav Sea Raiders`                |

### The Rule

A colon binds a value, and it appears in exactly **four syntactic positions** — disambiguated by position, not by spelling:

1. **Metadata assignment** — `key: value` in same-line or indented metadata, registry-gated (incl. infra node properties `latency-ms: 50`). The general case.
2. **Type / expression separation** — class field types (`+ name: string`), class method returns (`+ sail(): void`, colon optional), function expressions (`f(x): x^2 + 1`).
3. **Tag-value selector** in a directive — `hide phase:Planning` (boxes-and-lines): a filter predicate, not assignment.
4. **Role assignment** — `Cap: A` (raci), colon optional.

**The one true carve-out: ER columns** (`id int pk`) are an indented typed-property list like infra node properties, yet ER is space-separated while infra requires the colon (`latency-ms: 50`). ER follows SQL DDL muscle memory; it is the single exception to memorize.

**Colons never appear in:**

- Directives and options — space-separated (`start 2026-03-15`, `x-label Low, High`, `region`)
- Tag declarations and chart type declarations
- Series declarations and data rows for simple/data charts (incl. sankey/chord/arc links `Source -> Target value` and quadrant data; space-delimited, commas tolerated)
- Structural syntax (groups, sections, arrows, comments)
- Wireframe flag lists; flowchart/state node labels (colons are literal label text — these charts have no metadata)

---

## 27. Authoring Rules (Generators Read This First)

A consolidated checklist for generators. Following these prevents the most common parse errors. **LLMs generating DGMO: read this first.**

### 26.1 Declare Before Reference

Every entity referenced by an edge or arrow target must be declared on a prior line, or inline at the reference site in chart types that allow it (e.g. PERT `-> name 1 2 4` is **not** supported — declare first, reference second).

```
// ❌ Sitemap: `Login` referenced before declaration
Home
  -login-> Login

// ✅ Declare first
Home
Login
Home -login-> Login
```

### 26.2 Combine Metadata + Edges in One Declaration

Splitting a node into two declarations triggers a `Duplicate node` warning. Put metadata on the declaration line and indent edges below it.

```
// ❌ Duplicate-node warning
API description: Main gateway
…
API
  -routes-> UserService

// ✅ Combined
API description: Main gateway
  -routes-> UserService
```

### 26.3 Scope of Universal-Looking Features

Some constructs _look_ universal but are scoped to specific chart types. Don't transplant them across charts.

| Construct                                     | Scope                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `collapsed: true` metadata                    | sequence, infra, mindmap, pert                                                                                           |
| Same-line / indented metadata on declarations | all chart types except flowchart, state, data charts (§1.4)                                                              |
| Trailing-keyword flag list                    | wireframe only (§19)                                                                                                     |
| `progress: <N>` key                           | gantt only (§13)                                                                                                         |
| `score: <N>` + `emotion: <Word>` keys         | journey-map only (§22)                                                                                                   |
| `description: <text>` shorthand for layers    | pyramid, ring (§23, §24)                                                                                                 |
| `milestone` keyword                           | **removed** — use `<name> 0` (§13A)                                                                                      |
| `\|` operator as metadata delimiter           | **removed** (§1.4). Surviving uses: wireframe `{A \| B}` braces, in-arrow `A -file\|name-> B`, quoted `"Order \| Items"` |

### 26.4 Quoted Names + Aliases — Pick One

Quoted names cannot combine with `as <alias>` on the same line. If quoting only because of spaces, drop the quotes — bare names accept spaces. Reserve quoting for names with genuinely reserved characters (`|`, `:`).

### 26.5 Sequence Participants Without `is a TYPE`

Standalone sequence participants accept only the bare-name form. For an alias or quoted name, declare with `is a <type>` (e.g. `is a person`). See spec §2.2b.

### 26.6 Removed / Unsupported

Do NOT emit these — they're documented historically but no parser supports them:

- `milestone <name>` (PERT) — replaced by `<name> 0`
- Inline forward-declaration of PERT edge targets (`-> name 1 2 4`) — declare first, reference second
- `"Quoted Name" as alias` (any chart type) — drop quotes or drop alias
- Standalone sequence participant `Name as a` (with metadata) without `is a TYPE` — use the typed form
- The `|` operator as metadata delimiter — emits `E_PIPE_OPERATOR_REMOVED`. Use same-line or indented metadata per §1.4.

### 26.7 Diagnostic-Free Checklist

Before considering DGMO output complete, mentally verify:

1. Every edge target appears as a declaration on a prior line.
2. No entity is declared twice with conflicting metadata.
3. Metadata uses §1.4 — same-line `key: value, ...` after the name region, or indented `key: value` for reserved keys. No `|` delimiter anywhere except wireframe dropdowns, in-arrow label characters, and quoted name characters.
4. Wireframe flags are written as space-separated lowercase trailing keywords from the closed enum (§19).
5. Journey-map steps use `score: N, emotion: Word`; gantt tasks use `progress: N`; pyramid/ring layers use `description: <text>` (quote when the value contains commas).
6. All chart types use `collapsed: true` metadata for collapse (§27.3).
7. Quoted names don't carry `as <alias>` on the same line.
8. Sequence participants with alias or quoted names use `is a <type>`.
9. No `milestone` keyword in PERT — use `<name> 0`.
10. Tag declarations appear before the first non-tag content line.

# DGMO Language Reference (AI-Facing)

> **This is the AI-facing derived view of the DGMO language.** The authoritative grammar is `docs/dgmo-language-spec.md` (workspace root) — it wins on any conflict, and this reference is corrected/regenerated to match it. Use this document to generate DGMO; reach for the spec only for deep/edge grammar questions.

> **Note for AI generators:** Trust the show-everything default. Every renderable label part on every data chart is on by default. Emit `no-name` / `no-value` / `no-percent` only when the user explicitly requests suppression. Do not emit them defensively. **Start at §0 (AI Core) — the anti-patterns there cover the highest-frequency mistakes.**

## Table of Contents

0. [AI Core — Anti-Patterns & 45-Type Index](#0-ai-core) — **read first**
1. [Universal Constructs](#1-universal-constructs)
2. [Universal Name Handling](#2-universal-name-handling)
   2A. [Universal Aliases (`as` keyword)](#2a-universal-aliases-as-keyword)
   2B. [Universal Date Handling](#2b-universal-date-handling)
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

## 0. AI Core

The universal core: the cross-cutting anti-patterns (highest value per token) and the one-line index of all 46 chart types. The blocks below are machine-extracted (HTML-comment anchors) and embedded verbatim into every AI surface — IDE rule files, the Claude skill, the CLAUDE.md snippet — by `scripts/gen-ai-core.mjs`. Edit them here; never hand-edit a generated surface.

<!-- AI-CORE:ANTIPATTERNS start -->
### Disambiguation — where DGMO diverges from LLM priors

LLMs default to Mermaid / PlantUML habits; DGMO differs. These rules prevent the most common parse errors:

- **No colons in declarations, directives, tags, or data rows.** `bar Revenue` (not `bar: Revenue`); `series Cloud blue, Legacy red` (not `series: ...`); `North 850` (not `North: 850`); `tag Team as t` (not `tag: Team`). A colon binds a value only in metadata (`key: value`), class/function type separators, and a few scoped spots — see §26.
- **No Mermaid arrow-labels.** Put the label *between* the dashes: `A -Login-> B`, never `A -> B: Login`. Sequence: `->` sync, `~>` async; left-to-right only — no `<-` / `<~`.
- **No indented edges on a map.** Every map connection is ONE full line — `JFK ~daily~> LAX`; for a hub repeat the origin per spoke (`JFK ~daily~> LHR`, …). A bare source with indented `-> dest` legs errors as `Malformed edge`; indented legs are valid ONLY inside a `route` block (an ordered stop→stop voyage). Edge endpoints auto-create their POIs — don't add separate `poi` lines for places already in an edge.
- **No `|` metadata delimiter** (removed 0.18.0 → `E_PIPE_OPERATOR_REMOVED`). Use same-line `Name key: value, k2: v2` or indented `key: value`. (`|` survives only in wireframe `{A | B}` dropdowns, in-arrow label text, and quoted names.)
- **No removed participant keywords.** Do not write `X is a service` / `external` / `frontend` / `networking` / `gateway` — these were removed and error. A bare name renders the default shape; for a typed glyph use `is a person` / `is a database` / `is a queue`.
<!-- COLORS start -->
- **Colors are a closed set of EXACTLY these 11 — nothing else is a color.** Valid colors, the complete list: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `teal`, `cyan`, `gray`, `black`, `white`. That is the entire universe of DGMO colors — there are no others. Do NOT use hex (`#1f77b4`), `rgb(...)`, `hsl(...)`, or ANY CSS color name: `crimson`, `royalblue`, `navy`, `pink`, `lime`, `magenta`, `indigo`, `gold`, `salmon`, `turquoise`, `violet`, etc. are ALL invalid — they are rejected and the element falls back to an auto-assigned color. When you want a color outside the 11, map it to the nearest one: crimson/scarlet→`red`, royalblue/navy/cobalt→`blue`, pink/magenta/violet/indigo→`purple`, lime/olive→`green`, gold/amber→`yellow`, turquoise→`teal`. Apply a color as a trailing token (`Done green`) or after a category/group bracket (`[North America] red`). Named colors are mandatory because they re-resolve per active palette + light/dark theme; a hardcoded value never would.
<!-- COLORS end -->
- **Show-everything is the default.** Every label / value / percent renders by default. Emit `no-name` / `no-value` / `no-percent` / `no-*` ONLY when the user explicitly asks to hide something — never defensively.
- **`//` comments only** (never `#`). **Indentation closes blocks** — never `end`.
- **Declare before reference.** An edge target must be declared on a prior line; put metadata and edges on/under one declaration to avoid `Duplicate node` warnings.
- **No reference scaffolding in output.** Emit only DGMO source. This doc is organized with HTML-comment anchors (the `TYPE`, `TIPS`, and `AI-CORE` markers, each wrapped in comment delimiters); never copy any such `<!-- … -->` comment into a diagram. They mark sections of the docs, not DGMO syntax; the parser flags a stray HTML comment as an `Unexpected line` warning. (DGMO's only comment form is `//`.)

Two traps in the *other* direction (DGMO wants a colon / a space where you might not expect):

- **Infra node properties REQUIRE the colon** — `cache-hit: 80%`, `instances: 3`, `max-rps: 8000`, `latency-ms: 45`. But top-level infra **options** are space-separated (`default-rps 100`). Don't conflate them.
- **ER columns are space-separated** — `id int pk`, `email varchar` (the one SQL-DDL carve-out; everything else indented-typed uses a colon).

Idiomatic example — color via tags, metadata on the declaration line, indented edges:

```dgmo
boxes-and-lines Service Map
tag Team as t
  Platform blue
  Product green
active-tag Team

API Gateway t: Platform
  -routes-> Orders
  -routes-> Billing
Orders t: Product
Billing t: Product
```
<!-- AI-CORE:ANTIPATTERNS end -->

<!-- AI-CORE:STYLING start -->
### Make it look good — authoring guidance

Valid markup is the floor, not the goal. A good diagram reads at a glance. Apply these unless the prompt says otherwise:

<!-- TITLE start -->
- **Always title it.** Every diagram gets a short title on the type-declaration line (`flowchart Checkout Flow`, `sequence Checkout`, `boxes-and-lines Service Map`) so it is self-describing — never leave the bare type keyword alone. Infer a fitting title from the request when the user gives none.
<!-- TITLE end -->
<!-- CATEGORIZE start -->
- **Categorize and color — by default, not only when obvious.** Before drawing, find the axis that sorts the items into kinds and color by it: layer (frontend / backend / data), role (client / service / datastore), trust zone (internal / external / third-party), status (done / active / blocked), owner/team, or read-path vs write-path. Almost every diagram has such an axis — actively look for one rather than leaving everything monochrome. Express it with a **tag group**, never ad-hoc per-node colors: declare `tag <Axis> as t` (the name is a single word — `tag TrustZone as tz` — or quote a multi-word name: `tag "Trust Zone" as tz`), indent the category values (a trailing color is optional — bare values auto-pick a palette color), set `active-tag <Axis>`, then assign each item `Node t: <Category>` (see the tag-group syntax in the per-type section below). Only the 11 named palette colors exist, and they re-resolve per palette/theme. Color the grouping so the categories — and the boundaries between them — read at a glance. **Buckets, not name tags — never 1:1.** A tag group must have *fewer* values than it has members: each color should bucket two or more items so the palette compresses the diagram into a few meaningful kinds (aim for ~2–4 categories, and keep distinct colors well under half the item count). If you find yourself giving nearly every item its own value, you've enumerated, not categorized — merge the singletons up a level until each color groups at least two (a `cache` and a `database` are both `datastore`; a caller and a gateway are both `client`; two microservices are both `service`). One color per item is the same visual noise as random colors — the grouping only earns its place when a color means "these belong together." Leave items uncolored only when they genuinely form a single undifferentiated kind, or the user asked for no color.
<!-- CATEGORIZE end -->
- **Keep labels short.** A few words per node. Move detail into notes or metadata, never a full sentence inside a label.
- **Let the defaults show.** Don't add `no-*` opt-outs unless the user asked to hide or disable something — they strip helpful labels, values, and color.
- **Pick a fitting direction.** Top-to-bottom for hierarchies and processes; left-to-right for pipelines and flows (where the type supports a direction).
<!-- AI-CORE:STYLING end -->

<!-- AI-CORE:TYPE-INDEX start -->
### Chart-type index (45) — pick the type, then fetch its section

| id | when to use |
| -- | ----------- |
| `sequence` | message / interaction flows over time |
| `flowchart` | decision trees and process flows |
| `state` | state-machine / lifecycle transitions |
| `class` | UML class hierarchies |
| `er` | database schemas and relationships |
| `c4` | system architecture (context / container / component / deployment) |
| `infra` | infrastructure traffic flow with RPS computation |
| `boxes-and-lines` | general-purpose node-edge diagrams with groups and tags |
| `sitemap` | site / app navigation structure |
| `mindmap` | radial hierarchy of ideas from a central topic |
| `org` | reporting hierarchy |
| `family` | family tree / genealogy: unions (couples), children, remarriage, adoption, GEDCOM-style metadata |
| `bracket` | single-elimination tournament bracket: winners auto-advance; seed the field for a day-0 skeleton or list results casually; two sides mirror to a championship |
| `kanban` | task-board columns |
| `gantt` | project scheduling with task dependencies and milestones |
| `pert` | project network with three-point estimates and critical path |
| `swimlane` | cross-functional process flow with lanes, phases and gateways (BPMN-style) |
| `version-control` | git / version-control branch-and-merge graph: commits, branches, merges, rebase, HEAD and remote-tracking (gitGraph-style) |
| `timeline` | events, eras, and date ranges |
| `event-line` | annotated narrative timeline — events on a line with descriptions, optionally not to scale (NOT the date-scaled `timeline`) |
| `body` | human anatomy figure annotated by muscle name — for medical, exercise, and educational diagrams |
| `journey-map` | UX flow with emotion scores, phases, annotations |
| `cycle` | cyclical process (PDCA, OODA, DevOps loops) |
| `raci` | tasks × roles responsibility matrix; variant (RACI / RASCI / DACI) is inferred from the markers used |
| `tech-radar` | technology adoption quadrants (adopt / trial / assess / hold) |
| `quadrant` | 2×2 positioning matrix |
| `pyramid` | stacked hierarchy of layers (Maslow, DIKW) |
| `ring` | concentric rings of nested categories |
| `treemap` | nested rectangles sized by value (budgets, disk usage, portfolios) |
| `block` | author-controlled grid of nested, collapsible blocks (system / architecture layouts) |
| `sketch` | GUI-first free-placement canvas: uniform shapes on a snap grid, arrows, tags (markup is app-generated) |
| `goal` | single progress-toward-a-target value (`now` vs `target`) as a progress bar, thermometer, or gauge — KPIs, fundraising, quotas |
| `countdown` | live "N days until X" that ticks every second and is accurate on every load — trip dates, launches, deadlines; the only dynamic chart type |
| `clock` | live world-clock board: current time for people/places across time zones, ticking every second, with optional working-hours status and sundown line |
| `map` | geographic concept map: regions, points, routes |
| `wireframe` | low-fidelity UI layout with panels and controls |
| `bar` | categorical comparisons (multi-series via `stack` / `group`) |
| `line` | trends over time (multiple series via a `series` block; filled via `fill`; dual y-axes via `y-label` / `y-right-label`) |
| `pie` | part-to-whole proportions (ring/doughnut via `hole`) |
| `radar` | multi-dimensional metrics |
| `polar-area` | radial bar chart |
| `scatter` | 2D points or bubble chart |
| `heatmap` | matrix intensity |
| `funnel` | conversion pipeline |
| `sankey` | flow / allocation |
| `arc` | network relationships (linear, or circular via `layout chord`) |
| `slope` | change between two periods |
| `venn` | set overlaps |
| `wordcloud` | term-frequency |
| `function` | mathematical expressions (colon required: `f(x): x^2`) |

**Need more than the index gives you?** Fetch the per-type section: MCP `get_language_reference(type)` / `get_examples(type)`, or read that type's section below. The `suggest_chart_type` tool returns the chosen type's section automatically.

**When the type isn't obvious, ask — don't guess.** Call `suggest_chart_type` first. If it returns an `⚠️ ASK THE USER` directive (the request is ambiguous between candidates, or nothing matched), present those candidate options to the user and wait for their pick before generating — never silently choose. A confident result (high/medium) you can proceed with.
<!-- AI-CORE:TYPE-INDEX end -->

<!-- The grouped data-chart / matrix ids share one documented section. This map is the single source of truth for which TYPE block each id resolves to (read by gen-ai-core.mjs and the MCP slicer). -->
<!-- TYPE-ALIASES: line=bar pie=bar radar=bar polar-area=bar bubble=scatter -->

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
- **Color is optional** — a bare value (`High`, not `High red`) auto-assigns a deterministic palette color, skipping any color used by an explicit entry in the same group. An explicit `Value color` always wins. So `tag Priority as p High, Med, Low` is valid and renders three distinct colors.
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
| `fill-tint` | The default, spelled explicitly — shapes get the canonical 25% tint fill with a solid intent-color outline |
| `fill-solid` | Render nodes/bars at full intent saturation instead of the canonical 25% tint           |
| `fill-outline` | No fill — shapes take the theme background fill; the intent color is carried entirely by the outline |
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

## 2B. Universal Date Handling

<a id="2b-universal-date-handling"></a>

Every date-bearing chart — **gantt (§13), pert (§13A), timeline (§15),
event-line (§28), countdown (§36)** — accepts one liberal date grammar. Write
dates however is natural; they store internally as ISO. (Family uses year-grain
only; clock has no date input.)

**Accepted forms** (all equivalent to `2026-07-04`):

- `2026-07-04` — ISO, canonical, always unambiguous
- `2026-07-04 14:30` — datetime (where the type supports a time)
- `2026-07` / `2026` — month- / year-grain
- `07-04` / `7/4` — numeric, **US month-first by default**
- `Jul 4` / `July 4` / `July 4, 2026` / `4 Jul 2026` — month-name
- `753 BCE` / `14 CE` — era-signed year (timeline)

**Rarely type a year.** A bare month-day resolves via: (1) an explicit year on
the date → (2) a `year 20XX` directive → (3) a sibling dated row (timeline/
event-line carry forward + roll across New Year; gantt/pert anchor to the first
full date, usually `start`) → (4) the current render year (only if the chart has
no full date at all; emits a soft `year 20XX` hint).

**Directives** (any date-bearing chart; position-independent):

| Directive | Effect |
| --------- | ------ |
| `year 2026` | base year for bare month-days |
| `date-order dmy` | numeric slash/dash dates read day-first (default `mdy`) |
| `no-current-year` | a fully-bare chart errors instead of assuming this year |

**TIPS (AI authoring):**

- Prefer `Jul 4` or `07-04` + one `year 2026` line over repeating the ISO year
  on every row — shorter and reproducible.
- `7/4` is **Jul 4** (US month-first). For day-first documents add `date-order
  dmy` once at the top; then `7/4` is **Apr 7**.
- Month-name forms (`Jul 4`) are never ambiguous and ignore `date-order` — use
  them when a mixed audience will read the source.
- Existing ISO dates keep working unchanged; this is a superset, not a
  migration.

---

## 3. Sequence Diagrams

<!-- TYPE:sequence -->

<!-- TIPS start -->
**Styling tips:** stay terse — participants are created by the messages that name them, so a plain flow needs only the arrow lines (no participant declarations). Skip `is a TYPE`: the glyph is inferred from the name (`User`→actor, `*DB`→database, `Redis`→cache, `Kafka`→queue); add a declaration, a `[Group]`, or `position: N` only when it genuinely aids reading order or grouping, never as boilerplate. Give each participant a short role name. Reach for `== Section ==` dividers only when the flow splits into **two or more** distinct phases (e.g. `== Authentication ==` then `== Checkout ==`) — a single divider over one run of arrows just repeats the diagram's subject and adds a redundant band, so a one-phase flow should have no dividers at all. Label a return arrow only when its value matters (unlabeled returns are auto-pruned). Drop a `note` where something subtle happens. Categorize the participants and color them (not the messages) by that category with a tag group using the named palette colors — client vs service vs datastore, trust zones (internal / external), or owning team are almost always present, so default to coloring by one rather than leaving the lifelines monochrome, and the boundaries read at a glance.
<!-- TIPS end -->

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
- **Color participants by category with a tag group** (§1.3). Declare the group with named palette colors, then assign each participant `<alias>: <Value>` — the tag is on the participant, not the group line or a message:

```
tag Security as sec
  public blue
  trusted yellow

[Client Side]
  User sec: public
  Browser sec: public

[Provider]
  AuthServer sec: trusted
  API sec: trusted
```

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
- The note ends where the indentation does — there is **no `end` terminator** (a bare `end` line is rejected).

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
- **No `end`/terminator keyword** — a block closes by dedenting (like multi-line notes). `end`, `activate`/`deactivate`, and `autonumber` are not dgmo syntax (a bare `end` line is rejected); activation is controlled by the `activations` option (§2.7), not per-message keywords.
- **Tags apply to participants, not messages** — there is no per-message tag/color. Color a participant by category with `<Participant> <tagAlias>: <Value>` after declaring a `tag <Name> as <alias>` group (§1.3). Message text is just the arrow label.

### 2.7 Sequence Options

- `activations` / `no-activations`
- `collapse-notes` / `no-collapse-notes`
- `active-tag GroupName`

---

## 4. Infrastructure Diagrams

<!-- TYPE:infra -->

<!-- TIPS start -->
**Styling tips:** an infra diagram traces request traffic flowing inward from an `internet` or `edge` entry — that flow IS the diagram. **Every node MUST be reachable from an `internet`/`edge` entry by following the connections.** A node with no path back to an entry receives no traffic: it is dead, serves no purpose, and must be omitted entirely — not declared, not drawn, not even left as an island. There are no standalone nodes on an infra diagram. Before you add any node, ask "which request reaches this?" — if nothing routes to it, leave it out. Build strictly outward from the entry, one hop at a time along the request path, so the graph is connected by construction. Then: keep capabilities in properties (`latency-ms`, `max-rps`, `cache-hit`), not the node name; color by tier with a tag group so the layers read at a glance; reserve async edges (`~>`) for genuine fire-and-forget like queues or pub/sub.
<!-- TIPS end -->

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

- Bracket syntax only. Group coloring via tags. Declare a `tag <Name> as <alias>` group (§1.3), then assign a node `<alias>: <Value>` same-line:

```
tag Team as t
  Backend blue
  Data green
[API]
  APIServer t: Backend
  BookDB t: Data
```
- Optional `as <alias>` postfix and same-line metadata.
- **No nesting.** A group cannot contain another `[...]` group; only indented components.
- **Collapse:** a bare `collapsed` trailing flag on the group line (`[Backend] collapsed`, §1.8) starts the group collapsed — it renders as a single node showing the worst child health. (Legacy: indented `collapsed true` / `collapsed: true`.)
- Group properties (indented under the bracket line, colon-keyed like node properties):
  - `instances: N` or `instances: N-M` — capacity multiplier on children (auto-scaling). The space forms `instances N` / `instances N-M` are accepted legacy.

### 4.7 Infra Options (Space-Separated, NO Colon)

- `direction-lr` / `direction-tb` (booleans, last one wins; default is LR)
- `default-latency-ms N`
- `default-rps N` — fallback edge RPS when no `rps` is declared on the edge node
- `default-uptime DECIMAL`
- `slo-availability DECIMAL` — target availability for SLO compliance highlighting
- `slo-p90-latency-ms N` — target p90 for SLO compliance highlighting
- `slo-warning-margin DECIMAL` — margin below SLO that triggers warning state
- `animate` / `no-animate`
- `active-tag GroupName` / `active-tag none` — pre-select a tag filter on render

The universal options `no-title` and the `fill-*` family also apply — but severity/SLO status tints are data and are never restyled by the fill family.

### 4.8 Edge Nodes

```
edge
internet
```

Special top-level entry points. Either name works; `internet` only accepts `rps` and the `description` is silently ignored on entry-point nodes.

**Reachability:** every node must have a directed path back to an `internet`/`edge` entry — that inbound traffic is the whole point of the diagram. The parser emits a `warning` for any node with no such path (`W_INFRA_UNREACHABLE`), or a single `warning` when the diagram has no entry node at all (`W_INFRA_NO_ENTRY`). These don't block rendering, but a flagged node carries no traffic and should be connected downstream of an entry or removed.

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

<!-- TYPE:flowchart -->

<!-- TIPS start -->
**Styling tips:** write every connection as `Source -> Target` (or a single-line chain like `(Start) -> [Collect info] -> <Eligible?>`); write each connection on its own line. Every decision `<Question?>` MUST have at least two outgoing branches — usually `-yes->`/`-no->`, but use specific labels when the choices are not binary (e.g. `-retirement->`, `-disability->`, `-survivor->`); a decision with only one branch is invalid. Begin at exactly one start terminal `(Start)` and make every path terminate at a terminal node (`(Approved)`, `(Denied)`, `(End)`). Every node MUST connect to the rest of the graph: if a node cannot be traced from the start forward to a terminal, it is invalid — remove it, never leave it floating. Flowcharts have NO tag groups, node metadata, or manual node colors — do NOT write `tag … as …`, a `s: value` suffix, or a trailing color word; node colors are assigned automatically by shape (start terminal green, end terminals red, processes blue, decisions yellow). Just pick the right shape and let color follow. Label every decision edge so branches read unambiguously; keep each node to a short action phrase and phrase every decision as a question.
<!-- TIPS end -->

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

- Node coloring: use tags (§1.3) — flowchart nodes have no color suffix. Declare a `tag <Name> as <alias>` group, then assign a node `<alias>: <Value>` (same-line after the node):

```
tag Status as s
  Approved green
  Rejected red
[Review] -yes-> [Done] s: Approved
[Review] -no-> [Reject] s: Rejected
```

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

- `direction-lr` / `direction-tb` (booleans, last one wins; default is TB). The key+value form `direction LR|TB` is accepted legacy.
- `no-color` (boolean; default off — when on, all nodes resolve to the muted neutral fill instead of their default intent color)
- `fill-solid` / `fill-outline` (fill family; default is the 25% tint — `fill-solid` renders shapes at full intent color, `fill-outline` drops the fill and carries color on the outline alone)
- `no-notes` (boolean; default off — suppress all note boxes, see §4.7)

`no-color` + `fill-solid` precedence: `no-color` wins for nodes with no explicit color (the muted neutral path bypasses `fill-solid`). Nodes with an explicit color survive `no-color` and are then rendered at full saturation if `fill-solid` is also on.

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

<!-- TYPE:state -->

<!-- TIPS start -->
**Styling tips:** name states as nouns (`Idle`, `Loading`) and label transitions with the triggering event (`-submit->`); mark the initial and final states; color by state category with a tag group; keep transition labels to the event, not a sentence.
<!-- TIPS end -->

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

- `direction-lr` / `direction-tb` (booleans, last one wins; default is LR)
- `no-color` (boolean; default off — when on, all states resolve to the muted neutral fill instead of their default intent color)

**Color by state category** — declare a `tag <Name> as <alias>` group (§1.3), then assign each state `<alias>: <Value>` same-line (declare the assignments before the transitions):

```
tag Phase as p
  Active blue
  Done green
Pending p: Active
Shipped p: Done
Pending -ship-> Shipped
```
- `fill-solid` / `fill-outline` (fill family; default is the 25% tint — collapsed groups follow the same mode, e.g. full saturation under `fill-solid`)
- `no-notes` (boolean; default off — suppress all note boxes, see §4.7)

`no-color` + `fill-solid` precedence: `no-color` wins for states with no explicit color (the muted neutral path bypasses `fill-solid`). Group colors survive `no-color` and are then rendered at full saturation if `fill-solid` is also on.

---

## 7. Org Charts

<!-- TYPE:org -->

<!-- TIPS start -->
**Styling tips:** label each node with the name and role on separate lines, not a paragraph; let the layout build the hierarchy — don't hand-draw edges; color by department or team with a tag group; keep titles consistent (all roles, or all names).
<!-- TIPS end -->

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

**Color by team / department** — declare a `tag <Name> as <alias>` group (§1.3) with palette colors, then assign each person the tag as metadata (`<alias>: <Value>`, indented under the node or same-line). There is **no `#team` or roster syntax** — a `#` line is not a grouping operator and renders as a stray node:

```
tag Team as t
  Platform blue
  Product green

Dana Ruiz
  title: VP Engineering
  Sam Okafor
    title: Dir. Platform
    t: Platform
  Priya Nair
    title: Dir. Product Eng
    t: Product
```

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

- `direction-lr` / `direction-tb` (booleans, last one wins; default is LR)
- `sub-node-label Text`
- `show-sub-node-count`
- `hide`

---

## 8. C4 Architecture Diagrams

<!-- TYPE:c4 -->

<!-- TIPS start -->
**Styling tips:** name each element by its responsibility, not its technology — put the tech in the `tech` field; color by system boundary with a tag group; keep one level of abstraction per diagram (context OR container, not both); keep relationship labels to the verb of the interaction. Write relationships INDENTED under their source element (`  -uses-> Other`), never as a top-level `A -uses-> B` line. Static renders (CLI, MCP) show the context level — containers/components appear only in the interactive drill-down, so author context-level diagrams for static output.
<!-- TIPS end -->

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

**Color by team / boundary** — declare a `tag <Name> as <alias>` group (§1.3), then assign each element `<alias>: <Value>` same-line (alongside `tech:`):

```
tag Team as t
  Frontend blue
  Backend green
Customer is a person t: Frontend
Shop is a system t: Backend
  containers
    WebApp is a container tech: React, t: Frontend
    API is a container tech: Node, t: Backend
```

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
  description: Handles all REST endpoints

// Same-line metadata form
Database is a container description: PostgreSQL with read replicas
```

- Multiple `description` lines accumulate into a multi-line description
- `description` is extracted as a dedicated field, not stored in general metadata
- Supports inline markdown: `**bold**`, `*italic*`, `` `code` ``, `[links](url)`
- `- bullet text` renders as `• bullet text`

### 7.8 Options

- `direction-lr` / `direction-tb` (booleans, last one wins; default is LR)

---

## 9. Entity-Relationship Diagrams

<!-- TYPE:er -->

<!-- TIPS start -->
**Styling tips:** name entities in the singular (`Customer`, not `Customers`); mark keys (`pk`, `fk`) and show only the columns that carry the relationship story; let the crow's-feet express cardinality instead of restating it in text; group related entities by color.
<!-- TIPS end -->

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
- `no-semantic-colors` — bare flag; suppress the semantic PK/FK role colors (on by default). Portable view-state written by the app's Semantic-colors toggle.

---

## 10. Class Diagrams

<!-- TYPE:class -->

<!-- TIPS start -->
**Styling tips:** show only the members that serve the diagram's point, not every field; mark visibility (`+`/`-`); express connections with relationships (inheritance, composition) rather than restating them in notes; group related classes by color.
<!-- TIPS end -->

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

<!-- TYPE:kanban -->

<!-- TIPS start -->
**Styling tips:** Color EVERY column — write a lowercase color word right after the closing bracket (`[Done] green`). Don't match on column names; reason about what each column *means* for a card sitting in it, then pick the color whose everyday connotation fits, so the board reads at a glance. The guiding sense: green = good / finished / success, red = bad / stuck / needs attention, yellow = waiting / caution / in review, blue = active work in motion, gray = inert / not yet started / parked. Apply that to whatever columns exist — e.g. a terminal success column reads green even if it's called `Shipped`, `Hired`, or `Live`; a column meaning a card is stuck reads red whether it's `Blocked`, `On Hold`, or `Rejected`; an early holding column reads gray whether it's `Backlog`, `Ideas`, or `Inbox`. When several columns share a sense (two active-work stages), it's fine to keep a couple uncolored or reuse a color rather than force eleven distinct hues. Name columns for workflow stages, keep card titles to a short task phrase, and let column length convey WIP instead of annotating counts. Card color is separate from column color: color cards by owner or priority with a tag group, and if you use one, tag EVERY card — an untagged card currently inherits the first tag value (mislabeling it), so omit the tag group entirely for cards you want left uncolored.
<!-- TIPS end -->

### 10.1 Declaration

```
kanban [Title]
```

### 10.2 Columns

Columns represent workflow stages and must flow left-to-right from least-done to most-done (e.g., Backlog → In Progress → Done). Every column should be a stage that cards pass through. Don't create columns for non-workflow concepts like gates, criteria, or definitions of done — use a tag instead (e.g., `type: Gate`).

**Color cards by owner / priority** — declare a `tag <Name> as <alias>` group (§1.3), then assign each card `<alias>: <Value>` in its same-line metadata:

```
tag Crew as c
  Alice blue
  Bob green
[Todo]
  Task one c: Alice
  Task two c: Bob
```

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
- `lane-by GroupName` — slice the board into swimlanes by a tag group. Portable view-state written by the app's swimlane picker.

---

## 12. Sitemap Diagrams

<!-- TYPE:sitemap -->

<!-- TIPS start -->
**Styling tips:** Build a real navigation graph, not a flat column of boxes. Three things make a sitemap read well, and a good one uses all three. (1) **Cluster pages into `[Area]` group sections** when the site has distinct areas — e.g. `[Shop]`, `[Account]`, `[Admin]` — indenting each page under its bracket header, and leave only the true entry page (`Home` / `Landing`) at the top level. (2) **Show how a visitor moves** with an indented labeled arrow under the source page: `-submit-> Home`, `-checkout-> Payment`, `-back-> Dashboard`, where the label is the action or link text. Every arrow target must be declared as its own page; an arrow can point at a whole area with `-> [Admin]`. If pages share no links you've drawn a list, not a sitemap — connect them. (3) **Classify pages with a colored tag group**, so the legend organizes the map by meaning rather than by position. Declare a facet with colored values and assign it to every page in same-line metadata — access level works well: `tag Access` with `Public green`, `Member blue`, `Admin red`, then `Pricing Access: Public`; or a functional facet (`Browse`, `Purchase`, `Admin`). A second tag group for page kind (`Landing purple`, `Form orange`, `Content cyan`) adds a second color dimension. Reason about which facet actually distinguishes this site's pages rather than reaching for a fixed list. Keep the tree shallow and order siblings by prominence.
<!-- TIPS end -->

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
  description: Company history and team bios

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

- `direction-lr` / `direction-tb` (booleans, last one wins; default is LR)

---

## 13. Gantt Charts

<!-- TYPE:gantt -->

<!-- TIPS start -->
**Styling tips:** group tasks under labeled phases; mark milestones as zero-duration; color by workstream or status with a tag group; keep task names to a short verb phrase; draw dependencies only where they actually drive the schedule.
<!-- TIPS end -->

### 12.1 Declaration

```
gantt [Title]
```

### 12.2 Options (Space-Separated, NO Colon)

```
start-date 2026-03-15
today-marker
today-marker 2026-03-27
critical-path
no-dependencies
lane-by Team            # swimlane axis (canonical); equivalent to `sort tag:Team`
sort tag:Team          # back-compat spelling of lane-by
```

**Color by workstream / status** — declare a `tag <Name> as <alias>` group (§1.3), then assign each task `<alias>: <Value>` in its same-line metadata:

```
tag Phase as p
  Build blue
  Test green
[Tasks]
  Design 5d p: Build
  QA 3d p: Test
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
Duration units: `min`, `h`, `d`, `bd` (business days), `w`, `m`, `q`, `y`, `sp` (sprints)
Uncertain: `duration: 10bd?` (trailing `?` on the value)
Progress: `progress: 80` in metadata (integer 0–100)

### 12.9 Dependencies (Indented Under Tasks)

```
API Integration duration: 10bd
  -> E2E Testing
  -> Launch Day offset: 10bd
```

### 12.10 Parallel Scheduling

Sibling tasks (and sibling groups) run in **parallel by default** — no
keyword is needed. Use indented `->` arrows to express the sequencing you
want; anything left un-chained starts together at the parent's start.

```
[Backend]
  Schema duration: 20bd
[Frontend]
  Wireframes duration: 10bd
```

> The `parallel` keyword was removed at 1.0 (error `E_GANTT_LEGACY_REMOVED`).

---

## 13A. PERT Diagrams

<!-- TYPE:pert -->

<!-- TIPS start -->
**Styling tips:** Name each task as a short action and wire the real finish-to-start dependencies — branch and merge them so the critical path and per-task slack become meaningful. Give one most-likely estimate per task (the engine derives optimistic/pessimistic), or explicit O/M/P when you know them.
<!-- TIPS end -->

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
| `time-unit <unit>`            | Unit for bare-number durations (default `d`); accepts `min`, `h`, `d`, `bd`, `w`, `sp` (sprints)                                                                                                       |
| `default-confidence <level>`  | M-only heuristic: `high`, `medium`, `low`, or a custom `O/P` factor pair (e.g. `0.6/2.5`)                                                                                                             |
| `direction-lr` / `direction-tb` | Layout direction booleans (last one wins; default `LR`); key+value `direction LR\|TB` accepted legacy                                                                                                                                                                       |
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

Sprint mode activates automatically when `time-unit sp` is set, or explicitly when any `sprint-*` directive appears. ES/EF/LS/LF cells then render as `S5`, `S7`, etc.

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

Groups can author a bare `collapsed` trailing flag (§1.8) to start collapsed (legacy: `collapsed: true`).

### Same-line metadata

| Key                             | Where           | Meaning                                                                           |
| ------------------------------- | --------------- | --------------------------------------------------------------------------------- |
| `confidence`                    | activity        | Per-activity override of `default-confidence` (`high` / `medium` / `low` / `O/P`) |
| `collapsed`                     | group           | bare trailing flag (§1.8) — start the group collapsed (legacy: `collapsed: true`) |
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

## 13AA. Family Diagrams (genealogy)

<!-- TYPE:family -->

<!-- TIPS start -->
**Styling tips:** Two line shapes carry the whole tree: a **person line** (`Anne b: 1665, sex: f`) and a **union line** (`Anne + Jack m: 1701`), with children indented under the union. Declare each person **standalone** with their full metadata — per-side metadata on a union line is unsupported and re-stating a name just re-references the same person. Set `sex:` so cards color (m→blue, f→purple), but **treat the legend as the real sex channel**: blue and purple separate weakly under the 25% tint, so where color-vision matters distinguish with a `tag` group (labeled legend entries) instead. Reuse a name in a second union for remarriage (one card, two bars); a lone person with indented children is a single parent; a bare trailing `adopted` token marks an adopted child.
<!-- TIPS end -->

### Declaration

```
family [Title]
```

### Unions, children, remarriage

A **union line** joins a couple with `+`; children are indented beneath it. Union-level metadata is only `m` (marriage year). Reuse a name to remarry; a lone person with indented children is a single parent.

```dgmo
family The Rackham Line

Elizabeth Swann b: 1687, sex: f, occupation: Pirate King
"Will Turner" b: 1685, sex: m

Elizabeth Swann + "Will Turner" m: 1729
  Henry Turner sex: m

Henry Turner + Carina Smyth m: 1751
  Joshamee sex: m
  Anna adopted, sex: f
```

- **Person metadata** (fixed GEDCOM-flavored keys): `sex` (`m`/`f` → node color), `b`/`d` (birth/death year → a year-range row), `bp`/`dp` (birth/death place), `occupation`, `military`, `education`, `religion`, `burial`. Union-level: `m`. Unknown keys warn.
- **Adoption:** a bare `adopted` token on a child line draws a dashed drop edge. A person literally named "Adopted" must be quoted.
- **Divorce:** a bare `divorced` token on a union line (`A + B m: 1980 divorced`) draws a dashed marriage bar; children still attach.
- **Deceased:** a person with a death year (`d:`) is auto-marked with a muted dagger (†) — derived, no syntax; add `no-daggers` to hide it.
- **Children** are auto-ordered eldest→left by birth year (`b:`); undated children keep declaration order.
- **Unknown/private person:** a bare `?` renders a faint, solid-bordered, name-only placeholder card; each `?` is a distinct person.
- **`generations`** (option): draws a left gutter of Roman-numeral generation labels (`Gen I`, `Gen II`, …) plus subtle zebra shading behind alternating generations.
- **`highlight <name>`** (directive): dims everyone outside that person's bloodline (ancestors + descendants + spouses stay lit).
- **Sex → color:** `sex: m` → blue, `sex: f` → purple, unset → gray (25% tint). An explicit `tag`/inline color overrides the sex color.
- The union split cuts `m:` metadata first, THEN splits ` + ` within the name region — so a `+` inside a quoted name (`"Anne + Jack"`) or a metadata value never mis-splits. Per-side `key: value` metadata on a union line is not supported — declare the person standalone.

---

## 13B. Swimlane Diagrams

<!-- TYPE:swimlane -->

<!-- TIPS start -->
**Styling tips:** Give each lane a color and let nodes inherit it — reach for a `tag` group only when you need a *second* dimension (e.g. risk) that deliberately breaks lane color. Echo the gateway/terminal delimiters (`<Review>`, `(Paid) success`) even though bare names also resolve — it keeps the source self-documenting. Put every edge label *inside* the arrow (`-invalid->`), never as a trailing word.
<!-- TIPS end -->

Swimlane diagrams model a cross-functional process: actors/systems are **lanes**, the process flows along the flow axis (`direction-lr` default, `direction-tb` transposes; key+value `direction LR|TB` accepted legacy), and optional `[Phase]` columns group steps into stages. Nodes are tasks (bare), exclusive gateways (`<X>`), parallel gateways (`<+ X>`), terminals (`(X)`), and subprocesses (`[[X]]`). A `lane` block **owns its edges** — nodes and their outgoing `->` edges are written inline, no separate flow block. A back-edge to an earlier node draws a routed loop.

```
swimlane Weekly Publishing
direction-lr

lane Writer gray
  Draft Post -> Review
  Revise -> Review
lane Editor blue
  <Review>
    -changes-> Revise
    -ok-> Schedule
  Schedule -> Publish
  Publish -> Promote
lane Social green
  Promote
```

### Structure

- `lane <Name> [color]` declares a row (occupant-neutral; person, system, or org) **and opens its block** — the indented lines beneath are its nodes and their inline edges. The trailing color (§1.5) tints the band and is the default node fill. Lane order is first-appearance; re-opening a lane resumes it.
- A node is owned by the lane where it is a **line-head** (bare node or arrow source); elsewhere the name is a reference. References may point forward. Names are **lane-scoped** — resolve own-lane-first → global-unique → ambiguous; qualify a shared name `Lane.Node`.
- An unresolved target auto-creates only if **delimited** (`(…)`/`<…>`/`[[…]]`, taking the edge's lane/phase); an unresolved **bare task** is `E_SWIMLANE_UNKNOWN_NODE` (typo protection).
- `[Phase]` opens a phase column (3-deep: phase ▸ `lane` block ▸ nodes). With no `[Phase]`, the diagram is 2-deep (lane ▸ nodes). A node's phase membership can only push it right, never left of its column.

### Node tokens

| Token | Meaning |
| ----- | ------- |
| `Submit Claim` | task |
| `<Validate>` | exclusive (XOR) gateway |
| `<+ Fork>` | parallel (AND) gateway |
| `(Start)` | terminal (neutral) |
| `(!Rejected)` | error terminal (`!` prefix → red) |
| `(Paid) success` | success terminal (trailing word → green); also `terminate` |
| `[[Inspect Property]]` | subprocess (collapsible) |

### Flow & color

- Edges use **in-arrow labels** (`A -invalid-> B`), chain (`A -> B -> C`), and fan out when an indented `-label-> Target` group sits under a bare source header.
- Color cascade (first match wins): active **tag** value → **event/symbol** type (`(!x)`→red, `(x) success`→green, gateways neutral) → **lane** shade.

### Fast-follow (rejected, not silently dropped)

`note:` / `data:` annotations, `timer:`/`message:`/`signal:` events, message flow `~>`, and inclusive (`<o …>`) / event-based (`<* …>`) gateways each emit an `E_SWIMLANE_UNSUPPORTED` diagnostic in v1.

---

## 14. Boxes and Lines Diagrams

<!-- TYPE:boxes-and-lines -->

<!-- TIPS start -->
**Styling tips:** Show one clear direction of flow, label each edge with the relationship rather than a bare arrow, and keep every box a short noun phrase. **Color by category with a tag group:** declare a `tag <Facet> as <alias>` with a distinct color per value, then assign each box `<alias>: <Value>` so like things share a color and unlike things visibly differ — pick the facet that actually divides this system (tier: `Client`/`Edge`/`Compute`/`Data`, ownership, internal vs external, stateful vs stateless) rather than coloring at random. **Organize when it gets busy:** with more than ~4 boxes there is almost always a structure to surface — cluster the boxes that belong together into `[Group]` sections (a backend tier, a region, a subsystem) and draw edges to the group with `-> [Group]` where a whole cluster is the target. A flat row of many boxes is a missed opportunity; derive the grouping from how the parts relate. The `[Group]` brackets handle spatial clustering and the tag group handles color — use both, and they can cut across each other (e.g. group by subsystem, color by tier).
<!-- TIPS end -->

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

- `direction-tb` — top-to-bottom layout; `direction-lr` restates the `LR` default (booleans, last one wins; key+value `direction LR|TB` accepted legacy)
- `heat <Label> [low] [high]` — name a numeric colour ramp (see §13.8); one trailing color sets the high hue over a neutral low, two set explicit `low high` ramp endpoints (pairs with the `heat:` key)
- `no-value` — suppress the per-box numeric value labels (values render by default; legacy `show-values` is accepted as a no-op)

### 13.7 Options

- `active-tag GroupName` — set active tag group for coloring
- `active-tag none` — suppress tag coloring
- `active-tag <metric>` — make the value ramp the active dimension (see §13.8)
- `hide team:Backend, team:Frontend` — hide nodes with matching tag values (colon syntax for tag:value)

### 13.8 Value metric (numeric ramp)

Boxes can carry a numeric measure that drives a continuous color ramp — a
choropleth-style "heat dimension" alongside the categorical tag groups.

```
boxes-and-lines Fleet Crews
heat Crew blue

Flagship heat: 120
Frigate heat: 40
Sloop heat: 12
Flagship -> Frigate
Flagship -> Sloop
```

- `heat: <number>` on any box records its measure (a reserved metadata key —
  lifted out, never rendered as a tag). Non-numeric values are an error.
- `heat <Label> [low] [high]` names the dimension and optionally sets the
  ramp endpoint colors: no color → primary hue / neutral low; one color → that
  high hue / neutral low; two → explicit `low high` (e.g. `heat Risk green
  red`). Order is literal — polarity (good vs bad) is your choice. A wide-hue-gap
  pair routes through a neutral midpoint (so green→red mid values stay clean);
  analogous pairs blend directly.
- The ramp anchors at `0` for all-non-negative data, else at the data minimum.
- The heat ramp is the resting-active dimension whenever any box has a
  `heat:` (so heat shading works in static export with no interaction).
  `active-tag <tag-group>` switches to a tag group; `active-tag none` suppresses
  tinting; `active-tag <heat-label>` forces the heat ramp. On a name collision
  between a tag group and the heat label, the tag group wins.
- When the heat ramp is active, every box tints along the min→max ramp and the
  legend shows a gradient capsule; boxes without a `heat:` get a neutral fill.
- Each box's number also prints as text by default; suppress with `no-value`.

### 13.9 Tag groups (categorical color)

Color boxes by a category. Declare a `tag <Facet> as <alias>` group (§1.3) with one color per value — **values are indented under the `tag` header**, one per line, color as a trailing word — then assign each box `<alias>: <Value>` in its metadata. Do **not** write the values as `<alias> <Value>` lines; that is not the grammar.

```
boxes-and-lines Service Map
tag Tier as t
  Client blue
  Edge teal
  Compute green
  Data purple

[Client]
  Web App t: Client
[Edge]
  API Gateway t: Edge
[Compute]
  Auth Service t: Compute
[Data]
  Postgres t: Data
```

The tag group (color) composes with `[Group]` clustering (spatial) and can cut across it — group by subsystem, color by tier. The group must be declared before any content line (§1.3).

---

## 15. Timeline Diagrams

<!-- TYPE:timeline -->

<!-- TIPS start -->
**Styling tips:** label each event with a date and a terse headline; keep entries in chronological order; color by era or category with a tag group; merge minor events rather than crowding the axis.
<!-- TIPS end -->

### 14.1 Declaration

```
timeline [Title]
```

**Color by era / category** — declare a `tag <Name> as <alias>` group (§1.3), then assign each event `<alias>: <Value>` same-line:

```
tag Era as t
  Ancient blue
  Modern green
1500 Founding t: Ancient
2000 Boom t: Modern
```

### 14.2 Events

Events use **date-first syntax** — the date (or date range) leads, then the event name, with optional trailing same-line metadata (§1.4).

**Point event** (single date):

```
1718-05 Blockades Charleston p: Blackbeard
```

**Range event** (`->` between dates, spaces optional):

```
1716 -> 1717 Sails under Hornigold p: Blackbeard
```

**Duration event** (date + name + `duration:` metadata):

```
2026-03-20 Sprint 1 duration: 30d
```

**Datetime** (date with `HH:MM` or `HH:MM:SS` time component):

```
2026-03-20 14:30 Standup Meeting
2024-01-15 10:00:45 Max-Q
```

**BCE / ancient dates** (suffix `BCE`/`BC`; `CE`/`AD` are positive no-ops):

```
753 BCE Rome founded
27 BCE -> 14 CE Reign of Augustus
```

**Uncertain ending** (`?` suffix on end date or duration value):

```
1718 -> 1719? Rackham builds crew
```

Event type is determined by positional structure:

- single date → point event
- `date -> date` → range event
- single date + `duration:` → duration event

Date formats: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, `YYYY-MM-DD HH:MM`, `YYYY-MM-DD HH:MM:SS`, plus `YYYY BCE`/`BC`/`CE`/`AD`
Duration units: `s`, `min`, `h`, `d`, `w`, `m`, `y`

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
  1718-07 Woodes Rogers arrives
```

### 14.6 Options (Space-Separated, NO Colon)

```
sort time              # opt out of swimlanes — flat, time-sorted layout
lane-by GroupName      # swimlane axis (canonical); equivalent to `sort tag:GroupName`
sort tag:GroupName     # back-compat spelling of lane-by
swimlanes              # back-compat spelling of lane-by
```

`lane-by GroupName` is portable view-state written by the app's swimlane picker; `swimlanes` and `sort tag:GroupName` are back-compat spellings.

---

## 16. Data Charts

<!-- TYPE:bar -->

<!-- TIPS start -->
**Styling tips:** pick the form from the question — `bar` to compare categories, `line` for a trend over time, `pie` only for parts of one whole (≤6 slices); sort bars by value unless the category order is inherent (time, size); give one highlighted series a distinct color and keep the rest neutral; always label units.
<!-- TIPS end -->

### Conventions shared across all data charts

Every section under §15 follows the same two rules.

**Rule A — data rows are space-separated; commas are removed.** Values are separated by spaces only. A comma in a value position — whether a value separator (`Q1 400, 700`) or a thousands grouping (`Revenue 1,000`) — raises `E_DATA_COMMA_REMOVED`. Write whole numbers without thousands commas (`1000`, not `1,000`); an underscore digit-group separator is accepted if desired (`1_000`). The value still parses best-effort so the diagram renders, but the comma form is an error at 1.0.

```
Q1 400 700 300 500     ✅  canonical
Q1 400, 700, 300, 500  ❌  E_DATA_COMMA_REMOVED — use spaces
Revenue 1000           ✅  canonical
Revenue 1,000          ❌  E_DATA_COMMA_REMOVED — drop the thousands comma
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

### 15.1 Simple Charts (bar, line, pie, polar-area, radar)

**Declaration:** `bar [Title]`, `line [Title]`, etc.

**Multi-series:**

- **bar** — declare multiple series with a layout block header: `stack` (stacked
  bars, one bar per category) or `group` (clustered, side-by-side). `series` is
  **not** accepted on bar — the header names the layout.

  ```
  stack            // or: group
    Cloud Platform blue
    Legacy Suite red
  ```

- **line** — use a `series` block (every series is plotted):

  ```
  series
    Cloud Platform blue
    Legacy Suite red
  ```

  Short one-line form is tolerated: `series Revenue` or `series A B`.

- **radar** — use a `series` block to plot one polygon per series over the shared
  axes, each in its series color, with the standard series legend (same block
  form as line; dual-axis grouping is line-only):

  ```
  series
    Black Pearl blue
    Flying Dutchman purple
  ```

**Data rows** — follows Rule A:

```
Label 100
Label 100 200 300
Label color 100        // trailing color before numeric values
Q1 400 700 300 500
```

**Options (space-separated, NO colon):**

```
x-label X Label
y-label Y Label
orientation-horizontal   // bar: horizontal bars
fill                     // line: fill the area under the line
hole                     // pie: doughnut ring (optional ratio, e.g. `hole 0.5`)
no-center-total          // pie: hide the center total (shown by default when `hole` is set)
no-auto-y                // line: anchor the y-axis at 0 (opt out of auto-fit)
```

- `orientation-horizontal` (bar; default is vertical bars)
- `fill` (line; fills the area under the line)
- `hole` (pie; renders the doughnut ring — bare `hole`, or `hole <0–0.9>` for a
  custom inner-radius ratio. The value total shows in the center by default;
  suppress with `no-center-total`)
- `no-auto-y` (**line only**) — by default a line chart auto-fits its y-axis to a
  padded window around the data (min→max across all series, not a forced 0
  baseline), so a tight high-valued series fills the plot. `no-auto-y` restores
  the 0 baseline. Bars always anchor at 0 and ignore the flag.
- `title` directive removed — the chart title is line 1 (`bar My Chart`). Using
  `title` raises an error diagnostic.
- Legend is always shown (no option needed)

**Value-display flags — show-everything default.** Every renderable part is on by default. Suppress with `no-*`:

- `no-name` — hide name (segment / point / cell / node / set)
- `no-value` — hide numeric value
- `no-percent` — hide the percentage (share-of-total on pie-family; stage-over-stage conversion on funnel)

Each chart honors the subset of flags that has a renderable atom on it:

- pie / polar-area: all three
- funnel: all three (`no-percent` hides the conversion %)
- bar / line / radar: `no-value`
- scatter: `no-name`
- heatmap: `no-value`
- sankey, arc, slope, quadrant, venn: name-suppression deferred — names render by default and cannot yet be hidden

`no-percent` on a chart with no percent atom is silently ignored. Cartesian charts (bar, line) render values on each bar / point by default.

**Eras (line only):**

```
era Day 1 -> Day 3 Rough Seas red
```

**Dual y-axes (line):** to compare two metrics with unrelated units on one chart, group the `series` block under `y-label` (left) and `y-right-label` (right) headers — series indented under each header bind to that axis, which auto-scales independently:

```
line Oil Price vs Strategic Reserve
series
  y-label $ / barrel
    Oil Price blue
  y-right-label Million barrels
    SPR Size green

2020 40 640
2021 68 620
2022 95 372
```

The right axis may hold more than one series; data rows stay positional across both groups (one value per series, document order). A flat `series` block is single-axis as before. Combo bar+line on dual axes is not yet supported — every series renders as a line.

> **Migrated in 1.0:** the former standalone `area`, `multi-line`, and `doughnut` chart types were removed. Use `line` + `fill` (area), `line` + a `series` block (multi-line), and `pie` + `hole` (doughnut). `bar-stacked` became `bar` + a `stack` header.

### 15.2 Scatter / Bubble Charts

<!-- TYPE:scatter -->

<!-- TIPS start -->
**Styling tips:** label both axes with units; group points into categories with `[Category] color` brackets (points indented under each) so clusters read at a glance — scatter colors by bracketed category, not by a tag group; reach for a second category only when the comparison is the point; keep marker labels off unless a few outliers need calling out.
<!-- TIPS end -->

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

<!-- TYPE:heatmap -->

<!-- TIPS start -->
**Styling tips:** Sort rows and columns by their totals (not alphabetically) so the strongest cells gather in one corner and the high-to-low pattern reads at a glance; keep every cell on the same numeric scale so the colors stay comparable.
<!-- TIPS end -->

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

<!-- TYPE:function -->

<!-- TIPS start -->
**Styling tips:** Pick a domain (`x <min> to <max>`) that frames the interesting behavior and keep to a few curves for legibility. Give each curve a short readable name before the colon (`Sine: sin(x)`), not the expression repeated.
<!-- TIPS end -->

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

<!-- TYPE:sankey -->

<!-- TIPS start -->
**Styling tips:** Feed flows in process order (left to right) and let each connection’s value set its band width — the layout already orders nodes to reduce crossings. Fold flows into one "Other" band only when many are individually negligible; never rename a single meaningful node.
<!-- TIPS end -->

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

### 15.6 Funnel Charts

<!-- TYPE:funnel -->

<!-- TIPS start -->
**Styling tips:** order stages largest→smallest, top to bottom; keep each stage name to a noun phrase; let the stages auto-color (each gets a distinct hue — no tag group needed); cap it at ~6 stages and merge minor drop-offs rather than crowding.
<!-- TIPS end -->

**Data rows** — follows §15 Rule A (space-separated):

```
Visits 1200
Signups 800
Purchases 200
```

Each stage renders its name to the left of the band (in the band's color), its value centered inside the band (falling back beside it when the band is too narrow), and a muted stage-over-stage conversion % to the right — no leader lines. The first stage has no % (nothing to convert from). `no-percent` hides the conversion %; `no-name` / `no-value` hide the other parts.

---

## 17. Visualizations

### 16.1 Slope Charts

<!-- TYPE:slope -->

<!-- TIPS start -->
**Styling tips:** Slope auto-labels both endpoints and colors each line — recolor only when one line is the story, then color just that mover and leave the rest to the default palette. It compares exactly two periods; use a line chart for more.
<!-- TIPS end -->

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
- Data rows: `Label value1 value2` — follows §15 Rule A (space-separated; a comma in a value raises `E_DATA_COMMA_REMOVED`)
- Thousands commas are removed — write `1000`, not `1,000` (underscore grouping `1_000` is accepted)
- Color annotations: `Label color value1 value2` (trailing color word before numeric values)
- Minimum 2 periods required

### 16.2 Wordcloud

<!-- TYPE:wordcloud -->

<!-- TIPS start -->
**Styling tips:** Make the largest and smallest terms differ enough in size to read at a glance — set an explicit `size <min> <max>` when raw weights are bunched together. Keep to the signal terms: cap the list (~30–40) and drop filler words.
<!-- TIPS end -->

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

<!-- TYPE:arc -->

<!-- TIPS start -->
**Styling tips:** Set `order appearance` and list links so the busiest pairs sit next to each other — heavy connections then read as short arcs hugging the axis instead of long sweeps (otherwise placement is automatic and row order is ignored). Add `layout chord` for the circular ("chord") layout when relationships are genuinely reciprocal and many-to-many; leave it off (linear default) for hub-and-spoke or mostly one-directional flows.
<!-- TIPS end -->

```
arc Pirate Alliances

[Caribbean] red
  Blackbeard -> Bonnet 8
  Blackbeard -> Vane 5

order group
```

- Link: `Source -> Target weight` — space before optional weight
- Options: `order appearance|name|group|degree`
- `layout arc|chord` — `arc` (default) draws nodes on a line with connecting arcs; `chord` arranges the same edges around a circle. Circular layout is reachable **only** through arc + `layout chord` (there is no standalone `chord` chart type).

### 16.4 Event Line Diagrams

<!-- TYPE:event-line -->

<!-- TIPS start -->
**Styling tips:** an event line is the annotated *narrative* timeline (Super Bowl halftime shows, "a history of X") — reach for it over `timeline` when each event carries a real description, and over `timeline` when the spacing should NOT be to scale. Keep to ~5–25 events; lead each with a terse title and write a sentence or two of body; color by category with a tag group.
<!-- TIPS end -->

**When to use vs `timeline`:** `timeline` is a to-scale date axis with eras, markers, and range bars (roadmaps, project history). `event-line` is point events with rich prose cards that auto-alternate above/below a spine — and is to-scale by default but drops to even spacing with `no-scale`.

#### Declaration

```
event-line [Title]
```

#### Events

A bare line is an event, in source order. An optional **ISO date** leads the line (timeline-style line-prefix), then the title, then optional trailing tag metadata. The indented body beneath is the description.

```
event-line Super Bowl Halftime Shows

tag Genre as g
  Pop blue
  R&B teal

2012-02-05 XLVI  g: Pop
  **Madonna** with LMFAO, Nicki Minaj, M.I.A.
  - Greek-temple set, gladiators
  - Marching-band finale

2013-02-03 XLVII  g: R&B
  Beyoncé reunites Destiny's Child.
```

- **Date** — optional, ISO only (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`, `+HH:MM` / `+HH:MM:SS`, plus `YYYY BCE`/`BC`/`CE`/`AD`), formatted for reading as the card subtitle (`2008-09-02` → `Sep 2, 2008`). No `date:` key; no `M/D/YYYY`.
- **`TBD` (future events)** — write the literal `TBD` (case-insensitive) in the date slot for a **not-yet-scheduled** event: `TBD Console Port  t: Engine`. Its caption reads `TBD` and it draws a **hollow dot + faded leader** (a faded shelf edge in `no-box`) so it reads as pending. To scale, its position is **inferred from its source-order dated neighbors**: a `TBD` followed by a dated event is interpolated into that gap; a **trailing** `TBD` (nothing dated after it) parks past the last real date and the spine **trails off dashed** — the open horizon. `TBD`s never trip the bad-date / out-of-order warnings.
- **Tag** — trailing same-line metadata (`g: Pop`), like timeline; colors the dot, leader, and card.
- **Description** — bare indented body lines (like `pyramid`/`ring`); `- ` makes a bullet; inline markdown (`**bold**`, `*italic*`, `` `code` ``) supported.

#### Eras

Group a run of events into a labeled section with a `[Name]` bracket, then **indent the events beneath it** (the org / version-control nesting idiom). An event belongs to the era it is indented under; its description sits one level deeper still. An event at indent 0 sits **outside** any era.

```
[The Early Web]
  1991 WorldWideWeb  t: Protocol
    Tim Berners-Lee publishes the first site.
  1993 Mosaic  t: Browser

[The App Era] collapsed
  2005 Ajax  t: Platform
```

- **Trailing tokens** after `]` — an optional bare `collapsed` flag (§1.8) and/or a named color, in either order (`[The 1960s] collapsed blue`). Legacy: `collapsed: true`.
- **`collapsed`** folds the era into a single summary card (its name + a bulleted list of member events) while a bracket stays on the spine; in the app a reader toggles it live.

#### Directives

- `no-scale` — space events evenly instead of by date (dates become captions).
- `side above` / `side below` — place all cards on one side instead of alternating (`side alternate` is the default).
- `no-box` — card-less style for slides: a tag-colored label, a rule, and the description below (no box / fill / border).
- `no-legend` — hide the tag legend.

### 16.4C Body Diagrams

<!-- TYPE:body -->

<!-- TIPS start -->
**Styling tips:** Reach for `body` when the drawing IS the human figure — colour muscle groups over a skin layer to show which parts a workout targets, where an injury sits, or how the musculature is organised. Choose the figure with `male`/`female` and `front`/`back`; each named muscle group takes a tag so the legend carries the meaning. Best for fitness, medical, exercise, and educational diagrams — not for generic part-to-whole (that's `pie`/`treemap`).
<!-- TIPS end -->

**Figures:** male and female, front and back — four figures. `skin` form renders any figure as a plain silhouette (with head + hair) instead of the segmented muscle map. `skeletal` is reserved.

#### Declaration

```
body [Title]
```

#### Form / sex / view (bare directives)

Set the figure with bare directives before the parts: `muscle` (default) or `skin`; `male` (default) or `female`; `front` (default) or `back`. Each is optional. **Name both `front` and `back`** to render the two views side by side in one diagram — a part is drawn on whichever view(s) contain it (`chest` on front, `lats` on back, `deltoids`/`calves` on both).

#### Parts

A bare line is a **catalog muscle name**, in any order, with optional trailing tag metadata and an indented body note. Names accept gym shorthand or formal anatomy (`pecs` / `pectoralis-major` → `chest`; `quads` → `quadriceps`).

```
body Push Day
muscle

tag Effort as e
  Primary red
  Secondary orange

chest        e: Primary
  Barbell bench press — 4×8
deltoids     e: Primary
triceps      e: Secondary
abs          e: Secondary
```

- **Part** — a catalog name for the active figure. Front: `chest`, `deltoids`, `biceps`, `triceps`, `abs`, `obliques`, `trapezius`, `forearm`, `quadriceps`, `adductors`, `calves`, `tibialis`. Back: `lats`, `trapezius`, `rear-delts`, `triceps`, `lower-back`, `glutes`, `hamstring`, `calves`, `forearm`. Fine heads (`vastus-lateralis`, `serratus-anterior`, `biceps-femoris`, …) and gym/anatomical aliases (`pecs`/`pectoralis-major`→chest, `quads`→quadriceps, `glutes`→gluteal) both resolve. Unknown names warn.
- **Tag** — trailing same-line metadata (`e: Primary`); colors the highlighted muscle, its leader, and its label.
- **Note** — bare indented body line (like `pyramid`/`ring`); the first note prints beneath the muscle's gutter label.

#### Options

- `no-legend` — hide the tag legend.

### 16.4B Version-Control Diagrams

<!-- TYPE:version-control -->

<!-- TIPS start -->
**Styling tips:** the git / version-control branch-and-merge graph (GitFlow, trunk-based, release trains). The grammar is keyword-less — a bare top-level line is a branch, a bare indented line is a commit; only `merge` / `cherry-pick` are required verbs. Keep to ~3–6 branches and ~5–30 commits; name branches meaningfully (`feature/login`); tag releases. Use it for branching strategy, not real timestamps (use `timeline`/`gantt` for dates).
<!-- TIPS end -->

**When to use vs `timeline`:** `version-control` shows commit/branch **topology** (who branched from whom, what merged where), not wall-clock time. It is the git-graph picture; `timeline` is a date axis.

#### Declaration

```
version-control [Title]
```

#### Branches and commits (no keywords)

A bare top-level line is a **branch**; its indented lines are **commits** (the text is the message). Re-naming a branch resumes it — that replaces `checkout`. `from` sets a branch point; a trailing color token sets the lane color.

```
version-control Feature Branch Workflow

main
  Initial commit
  Add README

develop from main
  Set up CI
  Add test suite

feature/login from develop
  Login form

develop
  merge feature/login

main
  merge develop tag: v1.0.0
  Hotfix typo type: highlight
```

- **Branch** — `name [from parent] [order: N] [color]` at indent 0. No `branch` keyword.
- **Commit** — a bare indented line; same-line metadata `id:` (show a SHA), `tag:` (ref pill), `type: normal|highlight|reverse`. No `commit` keyword (optional, for an empty commit).
- **Merge / cherry-pick** — `merge <branch> [tag:] [squash|ff|no-ff]`, `cherry-pick <commit>` (indented).

#### Beyond parity

- **HEAD / remote-tracking / ahead-behind** — `ref origin/main at <commit>` drops a pointer; `origin/…` is ghosted and ahead/behind is auto-labeled. HEAD auto-sits on the active tip.
- **Operations** — `rebase <branch> onto <target>`, `reset <branch> to <commit>` (top-level); `revert <commit>` (indented). Abandoned commits render faded.
- **`note <text>`** — a numbered step annotation on the current commit.

#### Directives

- `direction-lr` / `direction-tb` — booleans, last one wins; `direction-lr` is the `LR` default (newest right), `direction-tb` the git-log column view. Key+value `direction LR|TB` accepted legacy.
- `no-labels` (hide messages), `no-lanes` (hide branch lanes), `no-head`.

### 16.5 Venn Diagrams

<!-- TYPE:venn -->

<!-- TIPS start -->
**Styling tips:** Use 2–3 sets and write the count of each meaningful overlap directly on its intersection; circle area is NOT proportional, so the numbers — not the sizes — carry the comparison.
<!-- TIPS end -->

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

<!-- TYPE:quadrant -->

<!-- TIPS start -->
**Styling tips:** Name the four quadrants as meaningful categories (not just positions) and call out the outliers; normalize values to 0–1 so the points spread across the whole space.
<!-- TIPS end -->

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
- Data points: `Label x y` — follows §15 Rule A (space-separated; `Label x, y` raises `E_DATA_COMMA_REMOVED` — the comma between x and y is removed, but axis labels above keep their comma)

---

## 18. Mindmap Diagrams

<!-- TYPE:mindmap -->

<!-- TIPS start -->
**Styling tips:** keep each node to 1–3 words; let depth carry the structure — don't echo a parent's word in its child; color the top-level branches distinctly with a tag group; favor breadth over long single chains.
<!-- TIPS end -->

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
  Nice-to-haves p: Low collapsed
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
  description: OAuth supports Google and GitHub
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
| `collapsed`                 | Legacy `collapsed: true` — canonical is the bare trailing `collapsed` flag (§1.8). |
| Tag alias (e.g. `p:`, `d:`) | Assigns the node to a tag-group value.   |

```
Task p: High, d: Engineering
Demo Video description: 2-min product walkthrough
Nice-to-haves p: Low collapsed
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

Any node with children may be collapsed. Add a bare `collapsed` trailing flag to the node line (§1.8) to make a subtree start collapsed (legacy: `collapsed: true` in same-line metadata); collapsed nodes render with an accent drill-bar so they remain discoverable. The flag is case-sensitive lowercase — a node actually named "… Collapsed" (capitalized) or a quoted name keeps the word as label text. Collapse is **portable view-state** — because the `collapsed` marker lives in the source, every renderer (app, `dgmo` CLI, remark-dgmo, Obsidian, code-fence embeds) reproduces the collapsed view from the `.dgmo` alone; in the app, collapsing/expanding a node writes/removes the marker in the source (source stays the single source of truth), and a runtime `viewState.cg` from a share-link is applied in addition to source markers.

```
Nice-to-haves p: Low collapsed
  Dark Mode
  Export PDF
```

### Options

| Option                 | Effect                             |
| ---------------------- | ---------------------------------- |
| `active-tag GroupName` | Sets the default active tag group. |
| `color-by-depth`       | Bare flag; colour nodes by depth instead of by tag (off by default). |

Universal options (`palette`, `theme`) apply as elsewhere.

---

## 19. Wireframe Diagrams

<!-- TYPE:wireframe -->

<!-- TIPS start -->
**Styling tips:** Keep it low-fidelity — boxes, labels, and one primary action `(Sign in) primary` per screen, grouped by region. Links are bare text (`Forgot password?`); `[brackets]` is an input field.
<!-- TIPS end -->

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

<!-- TYPE:tech-radar -->

<!-- TIPS start -->
**Styling tips:** Group blips into the four domain quadrants and let the rings carry adoption stage (Adopt→Hold); annotate movement with a `trend`. When the source is a numeric score, bucket it into a ring and keep the number in the description.
<!-- TIPS end -->

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

### Directives

- `no-blip-legend` — suppress the four-column blip listing. The listing renders by default on every surface (export and live/interactive alike). Legacy `show-blip-legend` is accepted as a no-op.

---

## 21. Cycle Diagrams

<!-- TYPE:cycle -->

<!-- TIPS start -->
**Styling tips:** Aim for 3–6 stages so the loop stays legible; name each as a short step and let the closed ring imply repetition (no wrap-around edge needed). An indented line adds a description.
<!-- TIPS end -->

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

<!-- TYPE:journey-map -->

<!-- TIPS start -->
**Styling tips:** A journey map is a story about one specific person, so author it richly even when the prompt is thin — fill the gaps with plausible, concrete detail rather than leaving it skeletal. **Persona:** give them a real first name, a color, and a short background — `persona Gina green`, then a sentence or 2–3 indented bullet (`- …`) lines covering who they are, their goal, and their constraints. Always color the persona (trailing color word after the name, or `persona Name color: green`) so the protagonist's card stands out. When the prompt implies a customer archetype, let the name's first letter echo it (a fanatic → Fred, a casual user → Carl, a beginner → Betty) — a light touch, never forced. **Structure:** organize the journey into 2–4 `[Phase]` sections, each holding 1–3 steps — and never one step per phase across the board. If every phase has exactly one step you've just bracketed a flat list; that 1:1 mapping is wrong — either give phases multiple steps or drop the brackets and let the steps run flat. Give every step a 1–5 `score:` (and a single-word `emotion:` at the highs and lows) so the mood curve has shape. **Depth per step:** every step gets a `description:` (what actually happens there) plus 2–5 annotations drawn from `pain:` (friction, red), `opportunity:` (a fix, green), and `thought:` (what they're thinking, italic) — choose the ones that genuinely fit that moment; a smooth early step might be all `thought:`/`opportunity:`, a trough heavy on `pain:`. Don't pad every step identically — let the friction cluster where the score dips so the arc reads true.
<!-- TIPS end -->

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

<!-- TYPE:pyramid -->

<!-- TIPS start -->
**Styling tips:** Keep to a few tiers (3–5), widest at the base, and label each tier with its value — bands are uniform height, so the number carries the magnitude. For a funnel-shaped dataset, list the smallest stage first.
<!-- TIPS end -->

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

<!-- TYPE:ring -->

<!-- TIPS start -->
**Styling tips:** Order rings core→outward by hierarchy, not by size — band thickness is uniform and carries no proportional meaning (use pie/funnel for part-of-whole). Keep any value you want read at a glance in the ring’s own label.
<!-- TIPS end -->

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

fill-solid

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
| `fill-solid` / `fill-outline` | Render rings with full intent color, or outline-only, instead of the default 25% tint (fill family). |

`inverted` is **not** valid on ring diagrams (rings are rotationally symmetric). Using it emits an error-severity diagnostic and the line is discarded.

### Color Validation

Unknown color names emit an error-severity diagnostic with a "Did you mean…?" hint, and the layer falls back to its series color so the chart still renders.

### Label Degradation

When ring band thickness would force the in-band label below the readable floor (12 px), in-band labels are skipped entirely and the side list shows the layer names instead.

---

## 24C. Treemaps

<!-- TYPE:treemap -->

<!-- TIPS start -->
**Styling tips:** Put the unit in the title (`Cloud Spend ($)`) — there is no currency/format directive. Reach for `depth N` once a tree goes past ~3 levels (deeper subtrees collapse to a drillable block). Pick the color mode to match intent: tags for categories, `heat` for a gain/loss heatmap, branch for zero-config structure; when both heat and tags are present, heat colors cells at rest — use `active-tag <group>` to lead with the tag view instead. Add `radial` to render a **sunburst / hierarchical pie** — best for shallow trees where you want "share of a circle"; keep the rectangular default for deep trees or precise magnitude comparison.
<!-- TIPS end -->

Nested rectangles sized by value — the canonical way to show a hierarchy's proportions at a glance (budgets, disk usage, portfolios, taxonomies). Indentation is the hierarchy; a bare trailing number on a leaf is its size; parents auto-sum their children. Built on a squarified layout so cells keep good aspect ratios.

### Declaration

```
treemap [Title with units, e.g. "Cloud Spend ($)"]

Branch
  Leaf 320
  Leaf 180
```

### Example

```
treemap Q3 Budget

tag Team as t
  Eng blue
  Sales green
  Ops orange

Engineering t: Eng
  Platform 320
  Mobile 180
  Data 140
Go-to-Market t: Sales
  Ads 90
  Field Sales 130
Operations t: Ops
  Cloud 110
  Support 70
```

### Value & hierarchy

- **Indentation** sets the hierarchy (same model as mindmap / org).
- A **bare trailing number** on a leaf is its size (`Platform 320`) — the funnel/sankey idiom (§1.5). No thousands commas (`1_000` is fine).
- **Parents auto-sum** their descendants; a trailing number on a branch line is ignored with a warning (auto-sum always wins).
- To keep a label that genuinely ends in a digit, **quote it** (`"Region 5"`); unquoted `Region 5` parses as label `Region`, value `5`.

### Color modes

Three modes, with the source-declared default selected as **heat → tag → branch** — the universal precedence shared with map and boxes-and-lines. The `active-tag` directive pre-selects a dimension from source; the desktop app adds a runtime switcher that previews the others without editing source:

| Mode       | When it's the default       | Coloring                                                      |
| ---------- | --------------------------- | ------------------------------------------------------------ |
| **heat**   | any `heat:` value / `heat` directive | value ramp over a second per-node `heat:` metric    |
| **tag**    | a `tag` group is declared (and no heat) | categorical color per tag value (legend hover-dims) |
| **branch** | neither tags nor heat        | each top-level branch a distinct hue, tinted with depth      |

### Tags

Declare a `tag` group before content and apply it inline (`Engineering t: Eng`); children inherit the tag unless they override it. See §1.3.

### Heat metric & ramp

Add a per-node `heat:` number (a second metric, distinct from size; negatives/floats ok) and name the ramp with a `heat <Label> [low] [high]` directive. Colors are optional and **data-aware**: data that crosses zero defaults to a diverging `red·neutral·green` ramp with the midpoint pinned at 0; one-sign data defaults to a sequential `neutral·accent` ramp. One explicit color = `neutral→hue`; two = `low → high` (with a neutral midpoint). **Named palette colors only — no hex.** `heat:` is used instead of `score:` (which journey-map reserves for 1–5 emotion, §22).

### Node Metadata

| Key     | Type            | Default | Description                                  |
| ------- | --------------- | ------- | -------------------------------------------- |
| `heat`  | number          | —       | Color-by-value metric (signed / float ok)    |
| `<tag>` | declared value  | —       | Tag value via the group's alias or name      |

### Directives

| Directive       | Effect                                                                                  |
| --------------- | --------------------------------------------------------------------------------------- |
| `heat <Label>`  | Name (and optionally color) the value ramp; pairs with the `heat:` key.                 |
| `active-tag <GroupName \| HeatLabel>` | Pre-select the resting color dimension from source: a tag group name for categorical fill, or the heat ramp's label (`Value` if unnamed) for the ramp. `active-tag none` forces branch mode. The app's runtime switcher still previews the others. |
| `depth N`       | Render N levels; deeper subtrees collapse to a drillable solid block (a render budget).  |
| `no-value`      | Hide value labels.                                                                       |
| `no-percent`    | Hide percentage labels.                                                                  |
| `no-headers`    | Hide parent header bars (a no-op in `radial` mode).                                       |
| `no-legend`     | Hide the legend.                                                                          |
| `radial`        | Render as a **sunburst / hierarchical pie** (concentric rings) instead of rectangles.    |

Numbers auto-compact (1.2M, 940k). Units live in the title — there is no format/currency directive.

### Radial mode (sunburst / hierarchical pie)

Add a bare `radial` flag and the same hierarchy renders as a sunburst: the center disc is the whole (chart title + grand total), the first ring is the top-level groups, and each outer ring breaks a group into its parts. Tags, `heat`, and `no-value`/`no-percent`/`no-legend` all carry over; `no-headers` is a no-op. An arc's angle is its share of the whole; radius is depth only, so slices stay in **source order** and very thin arcs drop their inline label. Best for shallow trees (≈3 levels); for deep trees or precise magnitude, prefer the rectangular treemap.

```dgmo
treemap Plunder Spend ($k)
radial

Sailing & Rigging
  Rigging 320
  Helm 180
Cannon Battery
  Powder 90
  Shot 130
```

### Interactivity vs export

In the desktop app a treemap is interactive: click a parent to drill in (with a breadcrumb), hover for a tooltip (path / value / % / heat), and flip the color mode. Static SVG / PNG export is the clean, full tree with none of that chrome — the same interactive-vs-export split the map chart uses.

---

## 24D. Block Diagrams

<!-- TYPE:block -->

<!-- TIPS start -->
**Styling tips:** Reach for `block` when the **arrangement is the message** (system/hardware/architecture layouts) — not when you just want boxes auto-connected (that's `boxes-and-lines`/`flowchart`). Group with **containers** (indent a sub-grid) and **tag the container** so the colour cascades to its children. Don't write `columns` unless you need to override the inferred width; a lone block on a row already fills it. Mark a busy subsystem `collapsed` to keep the overview readable.
<!-- TIPS end -->

An author-controlled **grid** of rectangular blocks — for diagrams where the 2-D arrangement itself is the meaning (system block diagrams, hardware/signal chains, layered stacks, deployment topologies). Unlike the auto-layout diagrams, you place the blocks; the renderer still derives every pixel (column widths, row heights, gaps). One source line = one row; `[Label]` is a block; `_` is an empty cell.

### Declaration

```
block [Title]

[Web] [Mobile] [CLI]
[API Gateway]
[Auth] [Orders] [Billing]
```

### Example

```
block Web Service Architecture

tag Layer as l
  Edge blue
  Service green
  Data orange

[Clients] l: Edge
  [Browser] [Mobile] [CLI]

[Backend] l: Service
  [Auth] [Orders]
  [Inventory] [Billing]

[Data] l: Data collapsed
  [Postgres] [Redis]
```

### Grid & columns

- One **source line = one row**; blocks fill it left-to-right.
- **Columns are inferred** from the widest row — you rarely write `columns`. A lone block on a row **fills the width**; a short row whose block count evenly divides the column count **spreads to fill** (two blocks in a 4-column grid → two half-width blocks).
- `columns N` overrides the inferred width (e.g. to leave trailing empty cells).
- `_` is a deliberate **empty cell**; repeat `_ _` for a wider gap.

### Tags (outside the bracket, cascade)

Metadata goes **after** the `]`, never inside — the boxes-and-lines group idiom (so a colon inside a label, `[API: v2]`, stays label text). Tag a **group** and the colour **cascades** to its children; tag an **individual box** to **override** the cascade.

```
[Services] s: Healthy        ← group: cascades to children
  [Auth] [Orders] s: Degraded ← Auth inherits Healthy; Orders overrides
```

Declare the `tag` group before content; named palette colours only. See §1.3.

### Containers & collapse

- A block becomes a **container** by indenting a sub-grid under it. Sibling containers **stack vertically** (each needs its own body); the horizontal grid is for the leaf blocks inside a container.
- Add the bare `collapsed` flag to start a container **folded** — it renders as a header band with the standard collapse-bar (the org / sitemap / mindmap signal). Collapse / expand is interactive in the desktop app; static export renders the authored state.

### Span

For an **uneven** span (a block covering some but not all columns), use the same outside-metadata idiom: `[Ingress] span: 2`. A span larger than the column count clamps to it.

### Node Metadata

| Key       | Type           | Default | Description                                   |
| --------- | -------------- | ------- | --------------------------------------------- |
| `span`    | integer ≥ 1    | 1       | Column span (clamps to the column count)      |
| `collapsed` | flag         | —       | Start this container folded (collapse-bar)    |
| `<tag>`   | declared value | —       | Tag value via the group's alias or name       |

### Directives

| Directive    | Effect                                                             |
| ------------ | ----------------------------------------------------------------- |
| `columns N`  | Override the inferred column count for a grid.                     |
| `no-legend`  | Hide the tag legend.                                               |

### Interactivity vs export

In the desktop app a block diagram is interactive: click a container header to collapse / expand it (the rest of the grid re-flows). Static SVG / PNG export renders the authored state — the same interactive-vs-export split the map and treemap charts use.

---

## 24E. Sketch Diagrams

<!-- TYPE:sketch -->

<!-- TIPS start -->
**Styling tips:** Sketch is a GUI-authored format — the desktop and web canvas editors generate this markup, so hand-writing it is the exception. If you generate it anyway: keep it SMALL (sketches read best under ~15 shapes), and either omit `at:` everywhere (shapes flow into rows) or use integer half-slot coordinates with shapes at least 2 half-slots apart on one axis. Alias any shape an edge references (`as con`). Never write `size:`, colors, fonts, or a `shape:` outside the closed set (database, queue, cloud, person, document, note). In sketch, `~` dashed means secondary emphasis, NOT async. Categorize with a tag group instead of reaching for more shape kinds — kind-of-thing is meaning, and meaning lives in tags. Reach for `sketch` when the drawing itself is the content; reach for `boxes-and-lines` when topology should auto-lay-out.
<!-- TIPS end -->

A **GUI-first constrained canvas**: uniformly-sized shapes placed freely on a snap grid, arrows between them, meaning through tags. The renderer owns all styling — authors own placement, connection, naming, and tags. Every shape has ONE universal footprint (no resizing); text always fits (shrink → smart-wrap → `…`). Pick `sketch` when the spatial arrangement is yours to decide; pick `boxes-and-lines` when topology should auto-lay-out.

### Declaration

```
sketch [Title]
```

### Example

```
sketch Plunder Pipeline

tag Crew
  Deck
  Hold

Spyglass Feed shape: cloud, at: 0 0, crew: Deck
  -sightings-> con
Captain's Console as con at: 2 0, crew: Deck
  -orders-> bq
Divvy Service as dvy at: 4 0, crew: Hold

[Below Decks] at: 2 2, crew: Hold
  Booty Queue as bq shape: queue, at: 0 0
    ~haul~> dvy
  Ship Ledger as ledger shape: database, at: 2 0

[Armory] as armory at: 0 2, collapsed
  Powder Store at: 0 0
```

### Shapes

One top-level line = one shape — a **bare name** plus same-line `key: value` metadata. `shape:` morphs from the default rectangle: `database`, `queue`, `cloud`, `person`, `document`, `note` (rectangle is never written; unknown values warn and fall back). `note` renders as a sticky-style card with smaller left-aligned multiline text. Duplicate labels are legal **when aliased** (`Cache as c1` / `Cache as c2`); unaliased duplicates merge (standard dgmo semantics).

### Coordinates — `at: C R`

Integer **half-slot steps** (a slot = one footprint + the mandatory gap), origin-normalized; box children are relative to the box origin. `at:` is **optional** — un-positioned shapes flow-place in rows below existing content. Hand-authored overlap auto-resolves with a warning; nothing renders broken.

### Lines

Indented under the source shape, targeting an alias (or an unambiguous bare label). Six forms: `-label->` one head · `<-label->` both heads · `-label-` no heads, plus `~` dashed twins. Unlabeled headless lines are `--` / `~~`. No left-pointing arrows — write `B -> A`, never `A <- B`. A tag on the edge tail (`crew: Hold`) colors the line. Both ends must attach.

### Boxes

`[Brackets]` = a **box** (labeled group frame) — the only bracket meaning in sketch. Label mandatory; one level only (no nested boxes); taggable (frame tints, cascades to children, individual overrides); bare `collapsed` folds it to a card with the collapse-bar and edges re-target the card. Interactive fold/unfold in the app; static export renders the authored state.

### Node Metadata

| Key       | Type           | Default   | Description                                     |
| --------- | -------------- | --------- | ----------------------------------------------- |
| `shape`   | closed set     | rectangle | `database` / `queue` / `cloud` / `person` / `document` / `note` |
| `at`      | `C R` integers | flow-placed | Half-slot position (origin-normalized)        |
| `collapsed` | flag         | —         | Box only — start folded (collapse-bar)          |
| `<tag>`   | declared value | untagged (neutral gray) | Tag value (cascades from box; edge tails color the line) |

### Directives

| Directive    | Effect                  |
| ------------ | ----------------------- |
| `no-legend`  | Hide the tag legend.    |

### Interactivity vs export

In the desktop and web app a sketch opens in the **canvas editor** (the code pane hides behind a toggle); boxes fold/unfold interactively. Static SVG / PNG export renders the authored state — the same interactive-vs-export split the map, treemap, and block charts use.

---

## 24E. Goal

<!-- TYPE:goal -->

<!-- TIPS start -->
**Styling tips:** A single progress-toward-a-target reading — one `now` against one `target`, answering "how close am I?". Reach for it for a KPI tile, a fundraising thermometer, a quarterly quota, or a completion percentage; there is no time axis, series, or milestones (use `line` for a trend, `countdown` for a live deadline). Put the **unit in the title** (`Marathon Fund ($)`, `Grog Barrel Fill (L)`) — there is no format/currency directive. `now` and `target` are **space-separated `key value`** directives, no colon (`now 6400` / `target 10000`); the percent is `now / target` and values auto-compact (`6.4k`, `1.2M`). Pick the face for the story with a bare flag on its own line: the default progress **bar** for a plain KPI, `thermometer` for fundraising/fill-the-tank framings, `gauge` for a speedometer/quota dial — all three read the same value pair. The fill is **auto traffic-light** by completion (`< 50%` red, `50–80%` orange, `≥ 80%` green; over-target stays green) so the color already reads the number's health — leave it unless you have reason to override with a trailing color on the title line (`goal Marathon Fund ($) green`) or `no-auto-color` (flat palette color). Over-target clamps the fill at 100% while the `%` label stays truthful (`120%`). Add a `note` — inline (`note Still waiting on three crews`) or a block header on its own line with an indented body — to caption the number with context (who's still owed, what's left); it takes simple markdown (`**bold**`, `*italic*`, `` `code` ``) and `- ` bullets. `fill-solid` for a bolder fill; `no-percent` / `no-value` / `no-title` / `no-notes` to drop labels.
<!-- TIPS end -->

A single progress-toward-a-target value: one `now` measured against one `target`, drawn in one of three static faces. No time axis, no series, no milestones — just "how close am I?". The face is a bare-flag mode directive under the title (like treemap's `radial`); all three faces consume the same value pair.

### Declaration

```
goal [Title with unit]

[thermometer | gauge]     // omit for the default progress bar
now <number>
target <number>
```

### Example

```
goal Doubloons Recovered ($)

thermometer

now 6400
target 10000
```

### Directives

| Directive              | Effect                                                        |
| ---------------------- | ------------------------------------------------------------- |
| `thermometer` / `gauge`| Select the render face (bare flag; omit for the progress bar). |
| `now <number>`         | Current value (required; may exceed the target).              |
| `target <number>`      | Goal value (required; must be > 0).                           |
| `no-percent`           | Hide the `%` label.                                           |
| `no-value`             | Hide the raw `now / target` label.                            |
| `fill-solid`           | Full-saturation fill instead of the default 25% tint (`fill-outline` hollows the meter — color on the rim). |
| `no-title`             | Hide the banner title.                                        |
| `no-notes`             | Suppress the `note` block even if one is authored.           |
| `no-auto-color`        | Disable the traffic-light bands; use the flat palette color.  |
| `note <text>` / `note` + indented body | Free-text caption beside/below the face (§ note block). |

### Note block

An optional caption. Inline (`note Still waiting on three crews`) or a block header on its own line followed by an **indented body**:

```
goal Grog Barrel Fill (L)
thermometer
now 34
target 50
note
  **Great job, crew!** Still waiting on tallies from:
  - Seattle — first mate says "soon"
  - Columbus — *almost there!*
```

The body supports inline `**bold**` / `*italic*` / `` `code` ``, `- `/`* ` bullets, and blank-line gaps. It renders in the left column for `thermometer`/`gauge` and under the bar for the default face. `no-notes` hides it even when authored.

### Values & color

Values accept `_` separators (`10_000`) but not thousands commas; the unit lives in the title. Color precedence: (1) an explicit trailing color token on the title line (`goal Marathon Fund ($) green`, §1.5) always wins; (2) otherwise the **auto traffic-light** band by completion — `< 50%` red, `50–80%` orange, `≥ 80%` green (over-target stays green), which needs a `target`; (3) `no-auto-color` disables the bands and falls back to the palette series color. The fill is a 25% tint of the resolved color; `fill-solid` opts into full saturation; `fill-outline` hollows the meter (color on the rim, advancement reads from the outlined extent).

### Semantics

Percent is `now / target`. Over-target clamps the fill at 100% while the `%` label shows the true value (e.g. `120%`); the gauge needle pins at max. A negative `now` clamps the fill to 0% but keeps the label truthful. A missing or ≤ 0 `target` emits an error-severity diagnostic and the chart falls back to a 0% shell; a missing `now` is treated as 0 with a warning.

---

## 24E. Countdown

<!-- TYPE:countdown -->

<!-- TIPS start -->
**Styling tips:** The only dynamic chart — it ticks every second and is accurate on every load, so use it for a live "N days until X" widget, not a static report. Keep the title to the event (`Trip to Japan`); the target date renders as a caption automatically. `target` is a space-separated `key value` directive (no colon): a bare date (`2026-08-21`) counts to midnight, a datetime or offset is honored. By default those times are **viewer-local** — each person sees their own; add `tz America/New_York` (any IANA zone, no colon) to **pin** the count so a shared launch/livestream page shows everyone the same remaining time and it doesn't shift when you carry the laptop to another zone. Default `units days` reads best for weeks/months out; use `units full` for a launch-day `Nd HH:MM:SS` clock. Set `expired` to the celebration text (`🚀 Shipped!`); after the target passes every live surface shows it and the tick stops. On images (PNG export, `.svg` via `<img>`, GitHub camo) it can't tick and shows the whole-day count baked at export time — the correct fallback.
<!-- TIPS end -->

The only *dynamic* dgmo chart: a single "N days until X" recomputed against the viewer's clock on every load and ticking every second on any live surface. Distinct from `goal` (static) — a countdown has no `now`/`target` pair, just one future instant. The renderer bakes a whole-day fallback number (the no-JS floor); a tiny page-level ticker overwrites it live and, in `units full`, upgrades it to `Nd HH:MM:SS`.

### Declaration

```
countdown [Title]

target <ISO date | datetime | now>
units <days | full>       // default days
expired <text>            // default "Now!"
```

### Example

```
countdown Trip to Japan

target 2026-08-21
```

### Directives

| Directive               | Effect                                                                 |
| ----------------------- | ---------------------------------------------------------------------- |
| `target <iso>`          | The future instant (required). `2026-08-21`, `2026-08-21T18:00`, or with a tz offset. The literal `now` resolves at render (→ immediately expired; for testing). |
| `tz <IANA>`             | Pin authored times to a zone (`America/New_York`, `Asia/Kolkata`, `UTC`) so the count is the **same for every viewer** and doesn't drift when the host moves zones. Default viewer-local. Footer then shows the in-zone time + a `UTC±` tag. |
| `units <days\|full>`    | `days` (default) shows whole days (ceil); `full` ticks `Nd HH:MM:SS` on live surfaces. |
| `expired <text>`        | Shown once the target passes; the tick stops. Default `"Now!"`.        |

### Values & color

A bare `YYYY-MM-DD` counts to **midnight** and a datetime with no offset to that wall-clock time — both in the `tz` zone if one is set (`tz America/New_York`), otherwise **viewer-local**; an explicit ISO offset is always an absolute instant. Pin a `tz` when a shared page must show everyone the same countdown (a launch, a livestream); leave it off for a personal "my local deadline" widget. The trailing-token color rule (§1.5) applies to the title line (`countdown Trip to Japan blue`) and tints the figure.

### Semantics

Days mode uses `ceil` — a target later *today* reads "1 day", not "0". Full mode floors the days and shows `HH:MM:SS` for the remainder. Once the target passes, the `expired` text replaces the number and that node stops ticking (no negative counts). Live surfaces recompute from the absolute target on every load/route-change/note-open, so there is **no persisted state** and no drift; image surfaces (PNG, `.svg`-as-image, GitHub camo) show the whole-day count baked at export time.

---

## 24Eb. Clock

<!-- TYPE:clock -->

<!-- TIPS start -->
**Styling tips:** A live world clock — one panel per person or place, each showing the CURRENT time in its zone and ticking every second, accurate the instant the page loads. Reach for it to answer "what time is it for the crew right now": a distributed team's local times, a single collaborator's clock, or the overlap window for scheduling a call. The first line declares the type and a title (`Crew standups`). Each entry is one line, `<anchor> [as <label>] [color]`: name the zone once as the anchor — a plain **city name** (`London`, `NYC`, `Bombay`, `Los Angeles` — easiest, resolved through the bundled gazetteer to its canonical zone and displayed as the canonical city), a full **IANA id** (the token containing `/`, like `Europe/London` or `America/New_York`), or a **UTC/GMT offset** (`UTC`, `UTC+1`, `UTC+5:30`, `GMT+2`) which pins a **fixed** offset with no daylight-saving shift (bare `UTC`/`GMT` = +00:00, and no sun line). Use `as <label>` to name the person or role behind a zone (`New York as Dani (NY)`); the label becomes the caption and defaults to the resolved city (or the offset label for a fixed row). The single-clock case is common and encouraged — one title, one entry (`clock Dani` / `New York`). Global directives are flat, no colon: `analog` for analog dials (digital is the default face), `time-24` for a 24-hour readout (12h am/pm is the default), and optional context bands `hours 9-17` + `workweek mon-fri` (the window accepts `HH:MM` and am/pm, e.g. `hours 8:30-17:15`) to shade each zone's working window so out-of-hours people read at a glance. `no-sun` hides the sunrise/sundown indicator (on by default). Add `hours`/`workweek` only when the point is scheduling overlap; drop them for a plain "current time" widget. Zones are **colorized by default** (`color-by`, default `place` — a distinct palette accent per place); reach for a semantic mode when color should *mean* something: `color-by time` or `color-by daylight` make an at-a-glance world board read as day-vs-night (order the zones west→east so the daylight sweeps across), and `color-by work` turns a standup/team board green/amber/grey by availability — it needs `hours` set. A hand-set per-zone color (`London as UK team purple`, or just `London purple`) is a **defined** shade that always wins over the dimension, so you can pin one zone and let the rest follow. `color-by none` goes neutral. On image surfaces (PNG, `.svg` via `<img>`, GitHub camo) it can't tick and bakes the time at export — the correct graceful fallback.
<!-- TIPS end -->

The second *dynamic* dgmo chart (with `countdown`): a live board of world clocks recomputed against the viewer's clock every second. Flat syntax — the first line is `clock <Title>`; every other non-blank line is either a board-level directive (its first token is an option keyword) or a place row. Order-independent; no colons anywhere.

### Declaration

```
clock [Title]

analog                      // analog dials; digital is the default face
hours <start>-<end>         // optional working window (24h, HH:MM or am/pm)
workweek <mon-fri | mon,wed,fri> // optional working days (default mon-fri)
no-sun                      // hide the sundown/sunrise line (on by default)
time-24                     // 24-hour readout (12h am/pm is the default)
no-title                    // suppress the board title
direction-lr                // lay the panels out in a row (columns); direction-tb restates the default rows
color-by <place|work|daylight|time|none> // zone coloring; default place

<anchor> [as <label…>] [color]
```

### Example

```
clock Crew standups
hours 9-17
workweek mon-fri

London        as UK team
New York      as Dani (NY)
Los Angeles   as West coast
```

A UTC-offset board (offsets are fixed — no DST, no sun line):

```
clock Bridge watch
time-24

London        as UK team
UTC+5:30      as Bangalore ops
UTC           as Servers
```

### Directives

| Directive              | Effect                                                                 |
| ---------------------- | ---------------------------------------------------------------------- |
| `analog`               | Analog dials for the WHOLE board. Digital is the default face. |
| `hours <start>-<end>`  | Working window (e.g. `9-17`, `8:30-17:15`, or am/pm); drives the status chip, evaluated in each row's own zone. |
| `workweek <range\|list>` | Working days: `mon-fri` or `mon,wed,fri`. Default Mon–Fri. No effect without `hours`. |
| `no-sun`               | Hide the sundown/sunrise line (on by default when the zone's city coordinates are known). |
| `time-24`              | 24-hour readout (12-hour am/pm is the default).                        |
| `no-title`             | Suppress the board title.                                              |
| `direction-lr`         | Lay the panels out in a row (columns) instead of stacked; `direction-tb` restates the default rows. Key+value `direction lr|tb` (and `direction columns`) accepted legacy. |
| `color-by <place\|work\|daylight\|time\|none>` | Which dimension colors the zones. Default `place`; `color-by none` goes neutral. `place` = identity accent per place; `work` = green/amber/grey by the `hours` window; `daylight` = warm sun-up / cool sun-down; `time` = local-hour dawn→night ramp (order zones west→east). A hand-set (**defined**) per-zone trailing color always wins over the dimension. |

### Entry grammar

Each place row is `<anchor> [as <label…>] [color]`. The **anchor** names the zone exactly once and is resolved in this order:

1. **UTC/GMT offset** — `UTC`, `UTC+1`, `UTC-7`, `UTC+5:30`, `GMT+2`. A **fixed** offset with no DST (bare `UTC`/`GMT` = +00:00); renders a "no DST" marker and no sun line.
2. **IANA id** — the token containing `/` (`Europe/London`, `America/New_York`). DST-correct.
3. **City name** — via the bundled gazetteer (`London`, `NYC`, `Bombay`, `Los Angeles`). Resolves to the canonical IANA zone and displays the canonical city. An ambiguous name (`San Jose`) errors and lists the candidates; an unknown name is skipped with a warning and a did-you-mean.

`as <label>` sets the display alias (default = the resolved city, or the offset label for a fixed row). A trailing palette color token pins the row's shade (`London as UK team purple`, or `London purple`).

### Semantics

Each row's time comes from `Intl.DateTimeFormat` with that row's zone, so DST is always correct. The renderer bakes the time, hands, offset, status, and sundown line at render (the no-JS floor); a tiny page-level ticker recomputes them from the baked zone/coords every second — no persisted state, no drift. Image surfaces (PNG, `.svg`-as-image, GitHub camo) show the time baked at export.

---

## 24F. Bracket

<!-- TYPE:bracket -->

<!-- TIPS start -->
**Styling tips:** A single-elimination tournament bracket: winners auto-advance rightward toward a championship. Reach for it for playoff trees, knockout draws, and seeded fields. Two ways to author: seed the field for a **day-0 skeleton** (`seed 1 Team A`, `seed 2 Team B` …) and let matches fill in, or list results casually as `A beats B` / `A vs B` lines and let winners flow forward. Name the columns with `rounds` (comma-separated, e.g. `rounds Quarterfinals, Semifinals, Final`) or an indented `rounds` block with per-round colors. The two sides mirror inward to the final. Color a competitor's box outline with a `tag` group; a trailing color on the title line (`bracket Champions Cup red`) overrides the winner highlight (default blue). `single-elim` is the default; opt-outs are `no-round` (hide column labels) and `no-legend`.
<!-- TIPS end -->

A single-elimination tournament bracket. Winners auto-advance up a tree that builds itself from the results — a one-sided ladder for a simple pool, or two `[Side]` columns that mirror inward and meet at a championship (MLB / NBA / NCAA-style). Any `seed` line switches on **seeded mode** (day-0 skeleton); otherwise the bracket is **casual** (structure inferred from `beats` / `vs` lines).

### Declaration

```
bracket [Title]
rounds [Col1, Col2, ...]         // optional column names, entry round → inner

[Side] [color]                   // optional — two sides mirror to a center final
  seed N [Competitor]            // seeded mode: declare the field (day-0 skeleton)
  [Winner] beats [Loser] [score] // decided match — WINNER on the left, score cosmetic
  [A] vs [B]                     // pending match — no winner yet
```

### Example

```
bracket Grog Cup

Black Pearl beats Sea Serpent 5-3
Salty Dog beats Kraken 4-2
Black Pearl beats Salty Dog 6-5
```

### Directives

| Directive                      | Effect                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `rounds A, B, C`               | Name the columns entry-round → inner (or an indented block with per-round `Name color`); absent → generic `Round N` / `Final`. |
| `seed N [Name] [k: v]`         | Declare a seeded entrant → seeded mode + day-0 skeleton (top seeds get byes); trailing `k: v` tags the team. |
| `tag Group [as g]`             | Tag group (block/kanban idiom) — a competitor's tag value colors its box outline; a legend renders. |
| `[Side] [color]`               | A bracket column (kanban idiom); two sides mirror to a center championship.   |
| `[Winner] beats [Loser] [score] [@ Home]` | A decided match — the left name advances; score is cosmetic; `@ Home` marks the host. Indent prose under it for commentary. |
| `[A] vs [B]`                   | A pending, undecided match (both boxes drawn, no winner emphasis).            |
| trailing color on the title line | Winner accent color override (default blue), e.g. `bracket Champions Cup red` (§1.5 title-line accent slot). Legacy `accent <color>` directive is accepted; the title-line token wins on conflict. Tags/sides still win per-box. |
| `no-round`                     | Suppress the round/column labels.                                            |
| `no-legend`                    | Hide the tag legend (outlines still colored).                               |
| `single-elim` / `double-elim` / `seeded` | Format flags. `double-elim` reserved — not yet supported; `seeded` forces seeded mode. |

### Semantics

The winner is always the left operand of `beats`, regardless of the score; a score that shows the winner lower emits a warning but keeps the declared winner. Reusing a name advances that competitor (same string = same entrant); a competitor whose first appearance is a later round simply never played round 1 (a bye). In seeded mode the field builds the standard single-elim skeleton (recursive 1-vs-N seeding: `3v6` / `4v5` for a six-team side, top seeds bye), every slot renders on day 0, and `beats` lines overwrite the `TBD` slots as games are played. Duplicate competitor names error (names are identifiers); `double-elim` parses but emits a "not yet supported" diagnostic.

---

## 24A. RACI Matrices (RACI / RASCI / DACI)

<!-- TYPE:raci -->

<!-- TIPS start -->
**Styling tips:** Put each task at indent-0 with its `Role: A/R/C/I` cells indented one level under it — never nest tasks inside the `roles` block (it swallows them). Give every task exactly one Accountable (ideally one Responsible) and keep roles small (≤~6) so the matrix stays scannable.
<!-- TIPS end -->

A tasks × roles responsibility matrix with author-time linting. **One chart type — `raci` — covers all three variants.** The variant is **inferred from the markers used**: any `D` marker → DACI, any `S` marker → RASCI, otherwise RACI. There is no directive to lock a variant; just use the markers you want. Using both `D` and `S` in one chart is an error (`E_RACI_MIXED_VARIANTS`).

| Variant | Marker alphabet | Inferred when | Constraint                                   |
| ------- | --------------- | ------------- | -------------------------------------------- |
| RACI    | `R A C I`       | no `D` or `S` | Exactly one Accountable per task             |
| RASCI   | `R A S C I`     | any `S`       | Exactly one Accountable per task             |
| DACI    | `D A C I`       | any `D`       | Exactly one Driver and one Approver per task |

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

> Without a `[Phase]` header, put each task at **indent-0** and its role cells one level in (as above). Only nest tasks under a phase when a `[Phase]` header is present — otherwise the indented `roles` block greedily swallows the following lines.

### Directives

| Directive                        | Effect                                                                                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roles`                          | Declare column order. Inline (`roles Cap, QM, Bos`) is name-only; the indented block form supports per-role color via the trailing-token form (`Cap red`). When present, unknown roles in tasks emit `W_RACI_UNKNOWN_ROLE`. |
| `palette`, `theme`, `active-tag` | Universal options.                                                                                                                                                                                                          |

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

<!-- TYPE:map -->

<!-- TIPS start -->
**Styling tips:** the zero-config map already looks good — name places and stop. When POIs fall into categories, tag them so each category gets its own color; keep place labels to the place name; leave region colorize and coastlines on unless the user asks to hide them. **For flights and airport routes, use IATA codes, not city names** — `LHR ~> JFK`, `LHR ~> DXB`, `LHR ~> SIN`, `LHR ~> HND` — the bundled airport set (large international hubs + all US commercial airports) resolves them to the right coordinates and labels them with the code. **For cities, use the exact canonical name**: "New York City" (NOT "New York"), "Washington, D.C.", etc. — a name the gazetteer doesn't have **silently drops that point** and the map just reframes around the rest, so it looks fine but is wrong. When unsure of the exact token, look it up: `dgmo map-search "<place>"` (or the `lookup_map_location` MCP tool) returns the city name or airport code to paste; fall back to coordinates (`poi Name as 40.71,-74.0`) for anything not found. **For routes/flows from a hub** (an airport's daily flights, a distribution center's shipments), write ONE edge per line and repeat the origin — never indented edges (those error). Use **arcs** (`~>`) for flights and long-haul links so the spokes separate; the connector label carries the relationship (`~daily~>`, `~2x daily~>`). Endpoints auto-create POIs, so don't add separate `poi` lines for places already in an edge. Reach for a `route` block only when the trip is an **ordered voyage** that continues stop→stop (a cruise itinerary), not a set of independent routes from one origin. **For a "what time is it at each office" map**, flag each POI with `clock` — the zone comes from the place automatically, so just `poi Denver clock`; add `hours 9-17` + `workweek mon-fri` for open/closed dots, and `clock: <IANA>` only on bare-coordinate pins. Use `label:` (not `as`) for a multi-word office name.
<!-- TIPS end -->

Geographic concept maps: highlight/shade political subdivisions, drop points of interest (POIs), and connect them with routes or edges. For "share a concept" business maps, not cartography. Renders at a fixed, auto-fit position — no pan/zoom. Basemap and viewport are **inferred from the content you reference** — most maps need no directives. v1 boundaries: world countries + US states.

**The zero-config map is the good-looking map.** Type `map`, name some places, and you're done — coastlines, mountain relief (on reference maps), region/POI labels, and orientation labels all render by default. There is no projection, scale, or label directive; the only knobs are the bare `no-*` opt-outs.

**How the map type is decided (inference):** the resolver takes the bounding box of everything referenced (valued/tagged regions + POIs + edge endpoints), pads it, and measures its span. Projection is **always inferred — never configured**: `albers-usa` (US conic + AK/HI insets) when the map is US-oriented; at world/multi-continent scale a **data** map (any region/POI carries `value:` or a tag) gets **Equal Earth** (equal-area — honest for thematic comparison) while a **dataless reference** map gets **natural-earth** (the prettier curved compromise); `mercator` for a tight regional or single-continent cluster. The US-state mesh is added whenever you name a US state (or the map is US-oriented).

### Declaration

```
map [Title]
```

Requires the explicit first line `map` — no content inference.

### Region fill — heat (choropleth)

A subdivision name on its own line with a `heat:` fills with a single-hue tint ramp (auto min→max, ~15% floor). Each map element kind carries its own numeric channel key: regions take `heat:` (choropleth shade), POIs `size:` (marker radius), edges `width:` (line thickness):

```
map US Sales
region-heat Sales ($M)

California heat: 92
Texas heat: 78
Florida heat: 51
```

- `region-heat <label> [low] [high]` labels the ramp in the legend; one trailing color sets the high hue over a neutral low (`region-heat Sales ($M) blue` → blue ramp, default red), two set explicit `low high` endpoints (`region-heat Peril green red` → green→red, routed through a neutral midpoint). Order is literal — polarity is your choice.
- The ramp **auto-fits**: all-non-negative data anchors the low end at **0** (shared baseline); mixed-sign data fits data-min→data-max. There is no `scale` directive.
- A subdivision with no `heat:`/tag renders as the neutral base.

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

`heat:` + a tag on the same region (bivariate): both are kept as **two selectable colouring dimensions**. The top legend shows the heat ramp and each tag group as mutually-exclusive, collapsible groups; the active one fills the map. Default is the heat ramp (whenever any `heat:` exists). `active-tag <GroupName>` colours by that tag; `active-tag <HeatLabel>` (the `region-heat` label, or `Heat`) re-selects the ramp. In the app, clicking a legend group flips the active dimension (live preview only — no source edit); hovering a tag entry highlights the regions with that value, and scrubbing across the heat gradient highlights the regions whose value is near the cursor (non-matching regions dim). No warning.

A **trailing color** on a region line (§1.5) is the lightweight highlight: `Texas red` (or `Texas red heat: 90`, color before metadata) paints a flat fill with no tag group, ignoring the active dimension and adding no legend entry. It wins over the ramp and any tag on that region.

### Points of interest (`poi`)

```
poi <name | <lat> <lon>> [as <alias>] [<key>: <value>, …]
```

```
poi Austin                          # label defaults to "Austin"
poi Austin label: West HQ           # anchored at Austin; shows "West HQ"
poi 39.74 -104.99 as dcw            # positional coords (lat lon), signed
poi Dallas size: 320                # size: scales the marker radius (a data channel)
poi Chicago m: Office               # categorical color via a tag alias
poi Austin red                      # direct marker color (trailing token, §1.5)
```

- **Coordinates are positional** — two leading signed numbers (lat then lon); cities never start with a number.
- `size:` scales marker area (use `poi-size <label>` for the legend key). A trailing color (`poi Austin red`) sets the marker fill directly — winning over a tag color and the default orange. POI properties: `label`, `size`, `style`, applied tag alias, `as`, `clock`. No `icon` in v1.
- Coord-positioned or relabeled POIs take `as <alias>` for route/edge references; named POIs are referenced by name.

### Local-time cards (`clock`)

Flag a POI with `clock` and it grows a **live local-time card** above the marker — for a team/office map that shows what time it is at each site.

```
map Team offices
hours 9-17                          # per-pin availability window (open/closed dot)
workweek mon-fri
poi San Francisco clock             # zone auto-derived from the place
poi London clock
poi Bengaluru clock
poi 1.29 103.85 as SG clock: Asia/Singapore   # bare-coord pin names its zone
```

- **The place picks the zone — don't type it.** A named city derives its IANA zone from the gazetteer (correct by construction, e.g. Austin → Central). Only a **bare-coordinate** pin needs the valued form `clock: <zone>` — an IANA id (`Asia/Tokyo`) or a fixed offset (`clock: UTC+9`, no DST). The valued form also *overrides* a city, but a mismatch warns (you almost never want it).
- `hours 9-17` + `workweek mon-fri` (map-level) give a status dot per pin — green open / amber opening soon / hollow closed·weekend — evaluated in **each pin's own zone**.
- Use `label:` for a multi-word office name (`poi Los Angeles clock, label: El Segundo`); the `as` alias is a single word and doesn't render.
- The card ticks every second on live surfaces and bakes a snapshot for PNG/SVG. It shows the weekday only when the pin's day differs from the viewer's.

### Routes & connectors

`route <origin>` — an ordered, auto-numbered voyage; the origin gets a distinct marker, and the header takes **no shape option**. Each indented line is a `<arrow> destination` leg that continues from the previous stop, using the same indented arrow idiom as a sitemap — a leg is an edge (in-arrow label, `width:` thickness, and the **arrow glyph alone sets shape**: `-…->` straight, `~…~>` arc, mixable per leg). The **arrow is required and must be directional** — a bare destination errors, and so does an undirected `--`/`~~` glyph (a voyage always flows forward; use `->`/`~>`). A **tag on a leg colours the LINE** (categorical leg-type colouring — flights vs cruises vs trains); `label:`/`as` still name the destination stop. Repeat the origin as a leg's destination to close a loop (no second marker):

```
route Miami
  ~weigh anchor~> Havana width: 40   # arc leg (its own ~> glyph)
  ~> Kingston
  ~> Miami              # destination == origin → closed loop
```

There is no header `style:` — bow a whole voyage by using `~>` on every leg.

Native edges handle any other connection (no `link`/`leg` keyword). A token draws an arrowhead iff it ends in `>`, an arc iff it starts with `~`; drop the `>` for a plain line when an arrow would mislead. The label always sits between the delimiters:

| | no label | labeled |
|---|---|---|
| directed straight | `A -> B` | `A -ships-> B` |
| directed arc | `A ~> B` | `A ~trade~> B` |
| undirected straight | `A -- B` | `A -ferry- B` |
| undirected arc | `A ~~ B` | `A ~cable~ B` |

```
A -> B                  # one-off, directed
A -ferry- B width: 12   # undirected line; width = line thickness
A ~cable~ B             # undirected arc with a label
A -> B -> C             # inline chain
JFK ~daily~> LAX        # hub/star: ONE edge per line, repeat the origin
JFK ~daily~> LHR        # (NOT indented — indented legs are only valid
JFK ~2x daily~> SFO     #  inside a `route` block, which is an ordered voyage)
```

Each native edge is ONE full line — `<origin> <connector> <destination>`. A top-level indented `-> dest` with no parent errors as "Malformed edge"; to fan out, either repeat the origin on each line as above OR indent the spokes under a `poi` (a hub — `poi JFK` then indented `~> LAX`, `~> LHR`). An indented child under a `poi` that names a place **must carry an arrow** — a bare name there errors as a malformed hub edge. Endpoints auto-create their POIs, so a connected map needs no separate `poi` lines.

There is no geographic path-finding and no `surface:` — legs are plain straight or arced geometry (use a `~>` glyph to bow one) and may cross land.

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
- Legend auto-composes below the title: the heat ramp + `region-heat` and each tag group are **selectable colouring groups** (collapse/activate to flip the fill); POI size (`poi-size`) and edge thickness (`flow-width`) are self-evident from scale and carry no legend key in v1. `no-legend` suppresses all of it.
- **Region and POI labels are on by default.** Region labels auto-fit **full → abbrev → hide** (a US-state 2-letter abbreviation is tried when the full name doesn't fit; other regions degrade full → hide); POI labels are collision-managed. Labels render **on the map** (export-safe), escalating inline → leader line → numbered pin in dense clusters; markers never move. A wide map in a narrow column (< ~480px) prefers abbreviations and drops reference relief, as if zoomed out.
- **Cosmetic features are on by default**; the only switches are bare `no-*` opt-outs (no positive opt-in flag): `no-coastline`, `no-relief`, `no-context-labels`, `no-region-labels`, `no-poi-labels`, `no-legend`, `no-colorize`. A plain look = the four basemap flags together (`no-colorize` is **not** one of the four — it toggles region *fill style*, not a basemap backdrop layer).
- **Colorize (distinct political fills) is the default for any map without region data.** Unless a region carries data (a `heat:` or a tag), every region drawn at the resolved extent is filled a **distinct light pastel** such that no two bordering regions share a hue — the conventional "colour the countries/states so neighbours separate" look, with zero config. It applies to named-region maps, POI/route-only maps, and even a bare `map` (the whole world colours as the backdrop). The fills are **non-semantic** (no legend entry) and **extent-independent** (a region's colour is the same at any width and in an inset). A direct trailing colour (`Texas red`) paints on top as a highlight and does not suppress colorize; adding any `heat:`/tag flips the map to the data dress (colorize auto-suppressed, no error). `no-colorize` forces the plain green-land + blue-water dress — useful when many POIs/routes should pop against a calm map.

### Name resolution

- Admin units use **ISO 3166** (geometry keyed by code, so "United States" / "USA" / "US" resolve alike); cities use **GeoNames** (alias/accent matching, population ranking, did-you-mean).
- `locale <ISO>` scopes bare city resolution to a country (`locale US`) or subdivision (`locale US-GA`) — inferred from content if unset.
- A bare ambiguous, undeclared name → most-populous in scope (info note).
- **Disambiguate once:** trailing ISO code at first declaration — `San Jose CR` (country) or `Portland US-OR` (subdivision). Thereafter reference the bare name. Two same-named cities → `as <alias>` each.
- **Region fills disambiguate the country-vs-state collision** (`Georgia` = country `GE` or US state `US-GA`) by ISO code or name + scope — pick whichever reads best:
  - **Bare ISO code** (terse): `US-GA heat: 5` → the state, `GE heat: 5` → the country. Codes resolve directly and never warn.
  - **Name + scope** (readable): `Georgia US heat: 5` → the state, `Georgia GE heat: 5` → the country.
  - The redundant `Georgia US-GA` still works but isn't needed (a mismatched code like `Georgia US-CA` is rejected). A bare ambiguous `Georgia` follows the inferred US-scope signal and warns with both fixes named.
- **IATA airport codes** resolve to airport coordinates — `poi JFK`, `route JFK -> LAX` — with no new syntax (large international hubs + all US scheduled-commercial airports). Case-insensitive (`jfk`/`JFK`). Airports are the **lowest-precedence** identifier: a token that is both a city and a code resolves to the **city** (`Ufa` → the city, not UFA airport), with a hint naming the airport. Resolution is by **code only** (never by airport name); the POI label is the typed code. An unknown three-letter code errors with an `as <CODE>` coordinates hint.
- **A city name must match the gazetteer's canonical form** — `New York City`, not `New York`; `Washington, D.C.`, not `Washington`. An unrecognized name is dropped (with a did-you-mean note) and the map reframes around the places that *did* resolve, so the result can look complete but be missing a point. Use the exact name or coordinates.
- **Discover the exact token** with the lookup surface rather than guessing — `dgmo map-search "<place>"` (CLI; `--json` for machine output) or the `lookup_map_location` MCP tool. It substring-searches cities **and** the bundled airports and returns the precise token to paste (e.g. `york` → `New York City`; `heathrow` → `LHR`). There is intentionally **no exhaustive printed list** — the gazetteer holds thousands of cities plus ~1,500 airports; search is the interface.
- Positional coordinates are the escape hatch for anything missing/ambiguous (including forcing an airport over a colliding city: `poi 54.56 55.87 as UFA`).

### Directives & reserved keys

The directive set is **13, all colon-free**: six naming intent the renderer can't infer — `region-heat`, `poi-size`, `flow-width`, `locale`, `active-tag`, `caption` — and seven `no-*` cosmetic opt-outs — `no-legend`, `no-coastline`, `no-relief`, `no-context-labels`, `no-region-labels`, `no-poi-labels`, `no-colorize`. There is **no** `projection`, `scale`, `subtitle`, `surface`, `region`, or label-enum directive, and cosmetics have no positive opt-in form. Reserved metadata keys (need colons) are the per-element numeric channels plus `label`, `style`: `heat:` (region choropleth shade), `size:` (POI marker radius), `width:` (edge/leg thickness) — a channel key on the wrong element kind errors; `surface:` is no longer recognized. A bare US state postal code resolves to that state (`poi Portland OR` → Oregon; `CA` = California). Coordinates are positional (no `at:` key). Projection is inferred from extent + whether the map carries data (US → albers-usa; world data → Equal Earth; world reference → natural-earth; regional → mercator) and cannot be overridden.

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
| Key-value options      | all              | `start-date 2026-03-15`, `active-tag Team` |
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

- Directives and options — space-separated (`start-date 2026-03-15`, `x-label Low, High`, `region`)
- Tag declarations and chart type declarations
- Series declarations and data rows for simple/data charts (incl. sankey/arc links `Source -> Target value` and quadrant data; space-delimited — a comma in a data-row value raises `E_DATA_COMMA_REMOVED`)
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
| Bare `collapsed` trailing flag (§1.8)         | sequence, infra, gantt, kanban, mindmap, pert, state, c4, event-line (eras), block, sketch, wireframe. Legacy: `collapsed: true` metadata |
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
6. Collapse is the bare `collapsed` trailing flag on the group/container line (§1.8; legacy: `collapsed: true` metadata).
7. Quoted names don't carry `as <alias>` on the same line.
8. Sequence participants with alias or quoted names use `is a <type>`.
9. No `milestone` keyword in PERT — use `<name> 0`.
10. Tag declarations appear before the first non-tag content line.

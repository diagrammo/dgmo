# Changelog

All notable changes to `@diagrammo/dgmo` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.61.0] - 2026-08-05

### Removed

- 🔴 **`![[live-link:<id>]]` is no longer valid inside a `dgmo` fence.** It is the host document's markdown — Obsidian's transclusion syntax — and a fence's content is DGMO, so writing it there nests markdown inside a code fence that is itself inside markdown. It parsed cleanly and read as the category error it is. Accepted for one day (0.60.0) and withdrawn; pre-1.0, so it is gone rather than deprecated. **The note spelling is unaffected where it belongs**: on its own line in a note or document body, which is the surface it was designed for. Pasting a **share link** into a fence still works, and should — a URL is not markup, and it is what a person does with a link they were handed.

### Added

- **`parseCloudReferenceFence` and `parseCloudReferenceEmbed`**, so each surface names itself. The removed behaviour came from a parser named for nothing in particular: three of the four callers of `parseCloudReference` wanted *"what may a fence contain"* and got *"any of the three spellings, anywhere"*. `parseCloudReference` survives for a host scanning raw note text, where all three legitimately turn up, and now says in its own doc comment that a fence must not use it.
## [0.60.0] - 2026-08-04

### Fixed

- 🔴 **Paste a share link into a fence and it now draws the diagram it points at.** It used to say *"Unsupported chart type"* — and so did `![[live-link:dgm_7f2a91]]`, the spelling designed for a note. Spec §38.6 has claimed since it was written that a live link's three spellings "parse identically"; only `live-link <id>` ever did, because only it names a chart type on its first line. The other two fell past the router into the visualization parser and came back as an error naming a chart type nobody typed, which is wrong twice over: the syntax was valid, and the message sent the author hunting for a typo in a line that says exactly what it means. Every surface had it — the desktop app, the web editor and all five docs wrappers, not just the one it was noticed on. The router now asks the live-link parser whether the first line *is* a pointer, and the parser resolves a whole-line target instead of reading it as a stray directive. `/d/<id>`, `/view/<id>` and `/public/diagrams/<id>/source` are all accepted, on any origin, because self-hosting is why the host is not checked.
- **A pinned share link now names the pin it has to lose.** `…/d/dgm_7f2a91?at=2026-03-12` also collected the generic message; it is claimed deliberately so that the pinned-revision error — a live link always shows the publisher's current version — reaches the person who wrote the `?at=`. Only the **declaration** line can be a pointer, so a link inside another chart type's content is left alone, and a URL that is not a diagram path is not claimed at all.

### Added

- **`@diagrammo/dgmo/live-link-resolve` — asking the Cloud what a pointer points at, and reading the answer.** `fetchLiveLink(ref, options)` makes the request and resolves 200/404/410/5xx into four outcomes: `ok`, `gone` (withdrawn by its author, which is deliberate and not a failure), `missing` (a typo, or never published) and `unavailable` (network, timeout, 5xx, 429 — try again later). The split is the whole point: a host that cannot tell `gone` from `unavailable` keeps publishing a diagram somebody took back, and one that cannot tell `unavailable` from `missing` throws away a good cached copy over a single dropped request. It never throws, because a caller that has to tell a rejected promise from a 410 will get it wrong.
- This step previously lived inside `remark-dgmo`, where four of the five docs wrappers could reach it and nothing else could — which is how `vitepress-dgmo` came to ship a release announcing live links it could not render. It is now beside the parser and the card renderer, where a live link is a chart type rather than a markdown feature. **Its own subpath**, separate from `./cloud-reference`, so that resolving costs a caller no renderer and parsing costs a caller no network: the built entry is 1.9 KB over a 1.4 KB shared chunk, with no render graph in it. `fetchImpl` is injected for a host with its own client — Obsidian's `requestUrl` adapts in three lines — and the default is **bound to the global**, because `fetch` is a WebIDL operation whose `this` must be the global and holding it on an options bag makes every call a method call.
- What did **not** move is everything that is a build's opinion: the committed cache, the failure table, and what stops a build. A note being opened has no build to stop, which is the whole reason the two had to come apart.

## [0.59.0] - 2026-08-03

### Changed

- 🔴 **A quoted name is a delimiter everywhere, not label text in nine chart types.** Quoting is the language's only escape hatch for a reserved character in a name (spec §2.2), so a parser that renders the quotes does not merely look wrong — it removes the only way to write `Order | Items` at all. **boxes-and-lines, sequence, org, sitemap, kanban, c4, gantt, pert** and the shared **tag** path all rendered them; all now peel. `peelQuotedName` moved out of the boxes-and-lines parser into `utils/parsing.ts` and every type shares it. It is deliberately stricter than the neighbouring `stripQuotes`: it peels only when both ends carry the same quote character and the name has no interior quote, because the language has **no escape form** — so `say "hi" loudly`, and a card named `Repair the foretops'l`, are left exactly as typed.
- **A quoted declaration and a bare reference are now one entity.** Each type peels at the declaration *before* the id or normalization key is computed, and again wherever a name is resolved — c4 and gantt aliases bind to the peeled name, so `as oi` points at `Order | Items` rather than at the quoted literal. gantt's dependency targets, its dotted `[Group].Task` resolver, and pert's indented `-> Target` lines peel too.

### Fixed

- **A hyphen in a boxes-and-lines node name is name text, not a wrap point turned into a space.** `Alpha-One` rendered as `Alpha One`, silently — nothing was wrong with the parse, so `validate` reported nothing. The label fitter split on spaces, hyphens and camelCase humps to find wrap points, discarded the separators, then rejoined with a space, so `us-east-1` and `AlphaOne` were mangled the same way. Chunks now carry whether a space preceded them and a hyphen rides the chunk it followed: a label that fits is reproduced verbatim, and one that wraps still breaks after the hyphen.
- **A hyphenated key on an infra declaration line no longer eats half the node name.** `Api Gateway latency-ms: 50` rendered a node labelled `Api Gateway latency-` and warned about an unknown key `ms` — a key nobody wrote. `COMPONENT_RE`'s metadata pattern did not admit a hyphen, so the lazy name group absorbed everything up to the last hyphen before the colon, and the same line with a quoted name did not match at all. **Every infra property is spelled with a hyphen, so this was the common case rather than a corner.** The warning now names the key the author wrote and the indented form it belongs in (spec §4.3).
- **`is a <type>` after a quoted infra name** gave the generic catch-all instead of the message explaining that infra has no such declaration — losing it precisely where it was needed most.
- **A quoted tag group no longer warns about its own slug.** `tag "Trust Zone" as tz` then `Api tz: Internal` applied the tag and then warned `Unknown metadata key "trust-zone"` about the key the parser had just produced: the alias registry admitted only the spellings an author types, while the metadata cut resolves them to the DOM-safe slug. Only ever visible on the spaced form the spec recommends.
- **A quoted tag value no longer disagrees with itself.** `"High | Risk"` was peeled on the assignment side and left quoted on the declaration side, so it rendered with quotes in the legend and then failed to match its own assignment.
- **An infra group declared without colors no longer vanishes.**
- **A gantt alias on a positional-duration line binds**, so the dependency that names it resolves.
- **The editor stopped offering `"Order` as a name** — the completion extractor split on the pipe and kept the fragment.

### Added

- **gantt completion suggests tasks written the modern way**, rather than only the older spelling.

## [0.58.0] - 2026-08-01

### Added
- **`live-link` — a pointer to a published diagram is now a chart type.** A `.dgmo` file can name a diagram published to Diagrammo Cloud instead of carrying its own drawing, and whoever opens it sees the publisher's current version. Until now that file could not exist: `parseFirstLine` validates the first token against a hand-listed set, so a file naming a reference was *"Unsupported chart type"* — while the same text in a docs fence resolved correctly. The language knew about references in one direction only. It is ordinary DGMO grammar (a declaration line, a `url` directive, then plain English), so it inherits open, rename, move and search on day one. Spec §38, decision #53. **This ships and appears to do nothing on purpose:** every pointer renders a reference card and none resolves yet — following one is the next step.
- **`internal?: true` on `ChartTypeMeta` — routable, but never offered.** A type nobody hand-authors has no business in a picker: a "Cloud" tile would produce a file needing an id the user cannot know. The flag is honoured at five user-facing edges — `dgmo types`, the completion popup, MCP `list_chart_types`, the MCP suggester's candidate pool, and the generated AI core every model reads — and deliberately **not** inside `getAllChartTypes()`, which keeps meaning "everything routable". `internal-chart-types.test.ts` is the flag's specification; four filters at unrelated edges with nothing tying them together is a convention, not a mechanism.
- **A reference card renderer.** Pure string-built SVG, no DOM, in the shape of `error-card.ts` — it is what a CLI export produces, what a docs site shows when live-link resolution is switched off, and what a host shows before a fetch resolves. Not an error state. `parseLiveLink` and `renderLiveLinkCard` are exported so a host can draw the same card.

### Changed
- 🔴 **The reference keyword is `live-link`, not `cloud`.** `cloud abc123` in a fence and `![[cloud:abc123]]` in a note **no longer resolve** — not deprecated, simply no longer references. `cloud` named *where the thing lives*; `live-link` names *what it is*, and it is the publish dialog's own phrase, so one word now spans both sides of the exchange. Pre-1.0, so there is no dual-accept window. The module and its subpath export keep the name `cloud-reference` deliberately: renaming a subpath breaks the app's dev server while the production build stays green.
- **An error card on a type with no published guide links to the docs landing page** rather than deep-linking to a `chart-<id>` page that cannot exist.

## [0.57.0] - 2026-07-30

### Added
- **`@diagrammo/dgmo/cloud-reference` — one resolver for pointing at a diagram instead of pasting one.** A reference names a diagram living in Diagrammo Cloud, so a document stops going stale the day it is written. Three spellings, one parser, because each is native to where it gets typed: `cloud abc123` inside a fence, `![[cloud:abc123]]` in a note, or a plain share URL. Its own subpath export and **zero dependencies** — a docs wrapper can resolve a reference without pulling the render graph in behind it. A parity test asserts all three forms from one table, so a future modifier cannot land in one spelling and quietly miss the others. Consumed first by `remark-dgmo`; the CLI and the app can use the same parser rather than growing their own regexes.
- **`dataAttributes` on the standard embed block.** Emits `data-*` pairs on the wrapper so a host surface can mark its own blocks — `remark-dgmo` stamps the referenced diagram's id and the revision a page was baked from, and its client reads them back. Passed as an option rather than patched onto rendered HTML, because a wrapper editing markup by regex is how a rendering pipeline ends up with two of them. A key that is not a valid attribute name is dropped rather than escaped: the value is escaped, but the name lands in markup verbatim.
- **Block chrome for a withdrawn reference.** `BLOCK_CSS` gains rules for the placeholder shown when a referenced diagram has been unshared by its author, and for the quiet "this diagram has been updated" affordance a host client falls back to when it can see a diagram changed but cannot safely swap it in. Deliberately understated — a page peppered with badges is worse than one that is a few days behind.

## [0.56.0] - 2026-07-28

### Added
- **Sketch edges route for straightness.** The relaxer now scores curve shape — a straight run beats a single bend, and a single bend beats an S — weighted below crossings but above port facing, so a straighter route wins even when its ports face slightly worse. Shape is measured from the sampled polyline (total absolute turning plus a surcharge per turn-sign flip) rather than port tangents alone, which used to miss an S built from two same-direction tangents. Back-facing ports carry a steep surcharge, so an edge leaves toward its target instead of looping over the top of its card, and two edges landing on the same bare node split onto different sides instead of stacking two arrowheads on one dot.
- **Sketch folds in place.** A collapsed box keeps its would-be expanded footprint occupied and centres the card inside it, so folding moves nothing else and unfolding is the exact inverse — for authored and flow-placed boxes alike. Authored placement also wins outright now: a card parked where its frame wouldn't fit falls back to its own cell at the authored spot instead of being shoved to the nearest frame-sized hole, and authored-at root entities are exempt from the edge-avoidance nudge.
- **Sketch card body is a markdown description.** Tags still colour the card (border, fill, legend) but no longer print as `Group: value` body rows — the body belongs to the free-text description. Over-long descriptions clamp with a `+N more in source` marker (`.sk-desc-more`, carrying `data-line-number`) instead of a silent ellipsis, so an editor can jump to the source.
- **Boxes-and-lines group collapse is stable.** Interactive collapse no longer re-runs the placement search and teleports every node: surviving nodes freeze at their previous positions, the collapsed pill anchors at its members' previous bounding-box centre, and far-side units slide back to reclaim the vacated span. Falls back to the search when previous-position coverage is incomplete or the frozen layout would collide. Collapsed pills gain a member-count chip.
- **`E_VALUE_NEGATIVE` — magnitude charts reject negative values.** Charts whose value channel encodes pure magnitude (share, radius, ribbon width, font weight) now error instead of rendering garbage: pie, polar-area, radar, funnel, sankey flows, arc link weights, wordcloud weights, and map `size:`/`width:`. Signed charts (bar, line, scatter, slope, quadrant, heatmap, map/treemap `heat:`) are untouched. The CLI now renders the error card whenever error-severity diagnostics exist — the same contract as `render()` — so a broken chart can no longer export as a misleading partial diagram.

### Fixed
- **Bar charts handle signed values with a diverging baseline.** The domain is now `[min(0, dataMin), max(0, dataMax)]`, so negative values extend the axis below zero and bars grow either direction from the 0 baseline in both orientations. Stacks accumulate positive and negative segments into separate runs, and value labels flip inside the bar when the free end sits at the plot edge. Previously an all-negative dataset collapsed the domain and bars overflowed the plot.
- **SVG attribute values escape angle brackets on serialize.** Renderers return `outerHTML`, the HTML serializer, which leaves `<` and `>` alone inside attribute values. That is inert in HTML, but a label like `A</text><script>…` landing in `data-name` makes an XML parser reject the whole document — so any `.svg` served as `image/svg+xml` or loaded via `<img>` (the Cloud render cache, wrapper embeds) silently broke on one unlucky label. All ten serialization sites now route through `utils/svg-serialize.ts`. This is a well-formedness fix, not an XSS fix: a security sweep across 20 chart types confirmed nothing escapes its attribute.
- **Sketch auto-layout stage flags and frozen origin restored** after a parallel-session clobber dropped them from main, with regression tests pinning the contract.

## [0.55.0] - 2026-07-21

### Added
- **`legend-inline` — a one-line header on every chart with a top-center legend.** Title left, series/tag legend flushed right, instead of a centered title stacked above the legend — reclaiming a header row for embeds, slides, and dashboards. Opt-in per diagram (`legend-inline`), default unchanged. It measures the legend against the width left of the title and, if it can't fit on one row, silently falls back to the stacked header and re-centers the title — so the diagram is always valid regardless of title length or entry count. Honoured by the data charts (bar, line, radar, scatter, function) and the structured tag-legend charts (state, treemap, block, event-line, boxes-and-lines, er, class, family, infra, sequence, sketch, bracket, gantt, pert); on any other chart type it emits a warning rather than silently doing nothing. See spec §1.9, decision #50.
- **Function charts get a `fill` area directive.** `fill` shades the band between each curve and the y=0 baseline — the same directive the `line` chart uses — a soft 25% tint by default, opaque under `fill-solid`. This replaces the vestigial `shade` token, which was parsed and advertised in completions but rendered nothing. See decision #52.
- **Event-line `now` marker — a "today line".** `now` (§28.6b) draws a red vertical marker at the current date/time with a quick fade-in and hover reveal, so a live roadmap shows where "today" falls against its events.
- **Version-control diagrams gain the event-line visual system + branch hover** — branches read as an event-line-style timeline with hover spotlighting.
- **Pie charts avoid label collisions with radial leader lines** — crowded slices no longer overprint their labels (#37).
- **Sketch surfaces the authored tag-color name on each TagEntry.**

### Changed
- **Sequence participant order now follows first appearance in messages, not declaration order.** A bare participant declaration (`Name t: Group`) assigns a tag/type only — it no longer pins a column. Placement comes from the order the arrows reach a participant, so you can tag just the exceptions (an External or Customer) without dragging them out of message-flow order; use `position:` to pin one deliberately. This brings the renderer into line with the long-documented spec §2.2 ordering priority. See decision #51.

### Fixed
- **Clock digital time renders as fixed-width cells** so it stays uniform across WebKit and resvg (no more jitter between preview and export).
- **`legend-inline` on a chart type that can't host it now warns** ("not supported for this chart type; title and legend render stacked") instead of silently doing nothing or, on clock, erroring as if it were a zone row.
- **Sequence message labels no longer clip off the canvas at tight scale** (#35).
- **Boxes-and-lines diagrams stay inside the viewport, and collapse-all works.**
- **Function expressions evaluate without `new Function`** — CSP-safe, no dynamic code generation.

## [0.54.0] - 2026-07-20

### Added
- **Emphasis directives `highlight` / `dim` (sankey).** A chart-level way to push one element into the foreground or background while keeping every element's own hue — a red flow that recedes is still red. Resolves to a baked SVG opacity attribute, so it survives PNG/SVG export with no interactivity dependency. `dim <name>` recedes the named element(s); `highlight <name>` recedes everything outside the named element's flow closure. Shipped on `sankey` only; `family`'s existing `highlight` is unchanged and both now share one dim constant. Registering these also closed a pre-existing gap where `family`'s `highlight` had completions but no editor syntax highlighting. See spec §1.11, decision #49.
- **`default-rps` on infra now works.** It was parse-accepted, listed in completions, and read by nobody; it now sets the fallback entry RPS used when the `Edge`/`Internet` node omits an explicit `rps:` (an explicit `rps:` and the app's slider still win).
- **A light `./completion` subpath for editor integrations.** Autocomplete data — the per-chart-type directive registries and symbol extractors — now ships as its own entry point instead of only being reachable through `/advanced`. Anything building editor support can import it without pulling in the parsers and renderers: the new subpath's dependency closure is a fraction of `/advanced`'s. The same data remains exported from `/advanced` for existing callers.
- **Swimlane diagrams offer edge completions.** Swimlane was the one chart type with no completion descriptor at all, so its `->` edges and node references were never suggested. The reserved `~>` form is deliberately not offered — the parser rejects it (§27.8).

### Changed
- **Thousands separators are accepted consistently across every numeric chart type.** They already worked on bar/line/pie/funnel but `treemap` (never imported the shared number helper) and `sankey` (called it behind a regex that made the comma branch dead code) silently dropped a comma-grouped number to zero, and `goal` rejected it outright. All now normalize `1,240,000` → 1240000; malformed grouping (`1,24,000`) is named and rejected rather than truncated.
- Cycle edge labels are set at the same size as node labels rather than two points smaller, so they no longer read as secondary to the text they sit between.

### Fixed
- **Infra async edges no longer under-report downstream load 2×.** An async (`~>`) edge was parsed but never read by the compute model, so a sync+async fan-out — the guide's own canonical pattern — split traffic evenly and reported half the real load on each downstream. Async edges now carry the source's full rate and are excluded from the split sum, the caller's latency percentiles, and its availability. The long-dormant "splits must sum to 100%" warning (its validator had no callers) is now wired into the parser pass.
- **Multi-series data rows warn on surplus values instead of silently welding them into the label.** `Armor 50 60 70 80` against two series used to become an axis literally named `Armor 50 60`; it now warns and prints the quoted rewrite. The quoted escape hatch itself (`"Armor 50" 60`) was broken — it left the quote characters in the label — and is fixed. Single-value rows are unaffected: the last token is the value and the rest is the label, so `Day 1 8` stays label `Day 1`, value `8`.
- **An invalid trailing color on a sankey link keeps the link.** A misspelled color used to make the line match no link form, so it silently became a phantom node and the flow vanished, surfacing only as an unrelated "No links found". The color now resolves through the shared diagnostic path — the link is built and the bad token is named on its own line with a suggestion.
- **`layout` on c4 is rejected with a diagnostic** rather than silently accepted and ignored — C4 has one layered layout; use `direction-tb` / `direction-lr` for orientation.
- **An unsupported chart type that carries a title is now diagnosed instead of silently succeeding.** Since the title moved to line 1, a line like `bubble Q3 Results` parsed as a title-bearing declaration of an unknown type and returned no error at all; only a bare `bubble` was caught. Both `parseChart` and `parseExtendedChart` had the same too-narrow guard. The detection now distinguishes a bad type declaration from the three things that legitimately lead a file — data rows, directives, and link or container syntax — so `direction LR` and friends are not mistaken for chart types. Diagrams rendered through `render()` were unaffected: the router masked this via its inference fallback, so the fix matters to direct callers of the parser API.
- **Boxes-and-lines layout search is bounded by a wall-clock budget.** The candidate-generation loop ran every configuration unconditionally, so a pathological graph could search far past the point of usefulness. Generation now stops at a deadline (default 5 seconds, an order of magnitude above what a real diagram reaches) and scores the candidates it has. Exact scoring of the top candidates is untouched, so layout quality on ordinary diagrams is unchanged.
- **Body `fill-tint` (the default) now reads as clearly lighter than `fill-solid`.** The tint was a 70%-saturated mix that, under a full-strength colored stroke on large muscle shapes, was nearly indistinguishable from the solid fill. It now uses the canonical 25%-over-theme-base tint every other chart type shares, and mixes toward the theme surface so dark theme tints correctly.

## [0.53.0] - 2026-07-18

A language-consistency release. A five-dimension audit of all 37 chart types found the universal sections had quietly fallen behind the ten newest types, plus fifteen genuine drift points where the same idea was spelled differently depending on which chart you happened to be in. Everything below is the result. **Every legacy spelling still parses** — no existing diagram breaks — but a few defaults changed on purpose, listed under Changed.

### Added
- **State diagrams can finally be colored.** They were the one structural chart with no color channel at all: no tag groups, no metadata, and the old advice ("use edge colors") stopped meaning anything when edge color was removed language-wide. States now take the standard tag system — declare `tag Phase as ph`, then write `Draft ph: Intake` — and render with the same 25% tint and solid outline as org and boxes-and-lines, legend included, `active-tag` and the `fill-*` family included. A state diagram with no tags parses exactly as before.
- **`no-legend` works everywhere.** It used to exist only on the seven newest chart types, while data charts insisted the legend was always shown and the older tag charts offered no way to hide it at all. Any chart that draws a legend now accepts `no-legend`, and the space it occupied collapses rather than leaving a gap — which is what you want when a diagram is going into a slide.
- **One spelling for layout direction, on every chart that has one.** `direction-lr` and `direction-tb` are now canonical everywhere, replacing a split where some charts wanted `direction LR` and others only accepted a `direction-tb` boolean. They read as a single completion entry instead of a keyword plus a value popup, and the last one wins if both appear. The key+value form still parses.
- **Treemap can pin its coloring dimension in the source.** `active-tag <Group | HeatLabel | none>` matches map and boxes-and-lines; previously the choice lived only in the app's runtime switcher, so it never survived an export or a share link. Naming a non-first tag group now genuinely selects it, for both fill and legend.
- **Countdown accepts am/pm.** `at 6pm` and `at 6:30pm` work and normalize to 24-hour internally, matching what clock's `hours` already allowed. Writing `at 18:00` is unchanged.
- Groups start folded with a bare `collapsed` flag on the group line (`[Backend] collapsed`), the spelling block and sketch already used, now shared by sequence, infra, gantt, kanban, mindmap, PERT, state, c4, and event-line eras. A group whose name genuinely ends in "Collapsed" is untouched — the flag is matched in lowercase.

### Changed
- **Boxes-and-lines prints box values by default.** It was the lone chart where a numeric value you typed stayed invisible until you added `show-values` — the inverse of every other chart's "everything shows, subtract what you don't want" rule. Values now render; `no-value` suppresses them. `show-values` still parses and does nothing.
- **The tech-radar blip listing renders on every surface.** It was previously always on in CLI exports but hidden in the app unless you asked for it — the only feature in the language whose default depended on where it was being drawn. Suppress it with `no-blip-legend`.
- **When a treemap has both tags and `heat:` values, the heat ramp now colors it at rest**, matching map and boxes-and-lines. Treemap alone resolved this the other way round. The full order is heat → tag → branch, and `active-tag` overrides it.
- **A trailing color on a bracket's title line now sets the winner accent** instead of being ignored, matching goal and countdown. The bracket-only `accent <color>` directive still works and is no longer documented.
- Canonical spellings, with the old ones kept as silent aliases: gantt anchors with **`start-date`** (was `start`), sprint durations use **`sp`** (was `s`, which still means *seconds* in timeline — the collision is why), clock and map time-cards take **`workweek`** (was `days`), goal suppresses notes with **`no-notes`** (was `no-note`), and treemap with **`no-value`** (was `no-values`).
- **The data-chart `title` directive is now an error.** The title is the first line, as it is on every other chart type; the directive was a leftover second way to say the same thing. The diagnostic points at the declaration line.
- **Version-control's `direction BT` is gone.** It parsed but rendered identically to `TB` — the "newest at top" layout it implied was never built.

### Fixed
- **Org and c4 were ignoring `direction` entirely.** Both accepted the directive and neither did anything with it: org's layout was hardcoded top-down and c4's rank direction was a literal constant at four separate places. Both now genuinely lay out left-to-right when asked. Their documented default of `LR` was also fiction — both have always drawn top-down, so the docs were corrected to `TB` rather than silently re-flowing every existing diagram.
- **Journey-map's `no-legend` never worked**: the renderer honored it, but the parser rejected the word as removed syntax before it could take effect.
- Flowchart's `orientation-vertical` is gone from completion and the docs — it was offered to authors but had no implementation behind it.
- ER's `notation` is documented honestly: crow's-foot is the default and `notation labels` is the one alternative. The long-documented `notation chen` never existed in the parser.
- The unnamed heat ramp is labeled `Value` in the docs, which is what it has always rendered as.

## [0.52.0] - 2026-07-16

### Changed
- **BREAKING: `solid-fill` is gone — the `fill-*` family replaces it.** Chart fill is now a three-way choice spelled as sibling directives: `fill-tint` (the default 25% tint with a solid intent-color outline, now spellable explicitly), `fill-solid` (full intent saturation — the exact successor to `solid-fill`), and the new **`fill-outline`** (no fill at all; shapes take the theme background and the color rides entirely on the outline, for a clean line-art look). The three are mutually exclusive — when more than one appears, the last one wins. `solid-fill` was removed outright with no alias: replace it with `fill-solid`. Charts whose fill *encodes data* ignore the family entirely (map choropleth, infra severity tints, gantt progress, tech-radar blips), and a small group honors `fill-solid` but skips `fill-outline` because hollowing the surface would erase the chart (line/function area fills, sankey/chord ribbons). Everything else renders outline for real — bar, pie, polar, funnel, scatter, treemap (colored frames with matching label ink), radar and venn (stroke-only overlaps), quadrant, arc (including group bands), bracket (winner boxes, wells, capsules), body, clock (daylight/state tints stay — they're data), countdown, journey-map, PERT tornado bars, RACI, kanban wells, state group areas, sketch, goal (hollow meter with a colored rim), and heatmap (background cells with full-intent ramp strokes). See spec §1.9 and decisions #46–47.
- **Clock and map time-cards share one status indicator** — the open/closed state is a filled colored dot on both surfaces, replacing the clock board's earlier outline ring.

### Fixed
- **Every exported sankey SVG was malformed XML.** The internal emphasis-key separator embedded a raw NUL character in a `data-` attribute; XML parsers and `data:`-URI loaders reject the file (Safari refused to display it). The separator is now a printable Unicode character, so sankey exports parse everywhere.
- **Sequence diagrams no longer reserve a phantom trailing gap** — total width now ends at the last participant instead of carrying an extra message-gap of dead space.
- **Sketch rejects out-of-range `at:` coordinates** with a diagnostic instead of silently blowing the canvas up around a runaway point.
- **Editor highlighting keeps up with the liberal date grammar**: month-name date literals (`Jan 3`, `3 January 2026`) are colored as dates (#33), and bare-dash dates (`07-04`) tokenize as a single date literal instead of two numbers and a minus (#32).

## [0.51.0] - 2026-07-14

### Added
- **A map can show the current local time at each office.** Flag any map POI with `clock` (`poi Denver clock`) and it grows a live time-card above the marker — the local time, an open/closed status dot, and the weekday when it differs from yours. **You don't type the zone:** a named city derives its IANA zone from the bundled gazetteer (sourced from GeoNames, so a border city like Austin correctly reads Central, not Mountain). A bare-coordinate pin names its zone with the valued form `clock: America/Denver` (an IANA id or a fixed `clock: UTC+9`), which also overrides a city if you ever need to. Add header `hours 9-17` + `days mon-fri` for a per-pin availability window (evaluated in each pin's own zone), and `label: El Segundo` for a multi-word office name. Cards tick every second on live surfaces (app, Obsidian, web), keep clear of the frame edge, and bake a correct snapshot in PNG/SVG exports. See spec §24B.
- **Dates can be written however is natural — one grammar across every date-bearing chart.** Gantt, PERT, timeline, event-line, and countdown now all accept slash (`7/4`), bare-dash (`07-04`), and month-name (`Jul 4`, `July 4, 2026`) dates alongside ISO — previously each type had its own parser and most demanded full `YYYY-MM-DD`. Numeric slash dates are **US month-first** by default; a `date-order dmy` directive flips the whole document to day-first, and out-of-range values self-disambiguate (`13/2` → Feb 13). **You rarely need to type a year:** a bare month-day inherits it from an explicit `year 2026` directive, from a neighbouring full date (timeline/event-line roll across New Year; gantt/pert anchor to the project start), or — only when a chart has no full date at all — the current year, with a soft hint to pin it. `no-current-year` turns that last case into an error for teams that need reproducible output. Timeline/gantt era, marker, and holiday bands accept the liberal grammar too. Every existing ISO diagram renders byte-identically — this is an additive superset, no migration. See spec §2B.
- **Clock entries now take a single anchor — a city name, an IANA id, or a UTC offset — instead of a place-then-zone pair.** Type the place the way you'd say it (`London`, `NYC`, `Los Angeles`) and a bundled gazetteer resolves it to the canonical zone and city; an explicit IANA id (`Europe/London`) still works for exactness; and a raw **UTC/GMT offset** (`UTC+5:30`, `GMT-3`) gives a *fixed* zone that never observes DST — it carries a "no DST" marker and draws no sun line. Ambiguous city names error with the candidates; unknown ones are skipped with a did-you-mean hint. The old two-token `<place> <IANA>` form is gone; write `Europe/London as UK team` or just `London`.
- **Countdown can pin its target to a fixed time zone.** A new `tz <IANA>` directive (`tz America/New_York`, `Asia/Kolkata`, `UTC`) anchors the authored date/time to that zone so every viewer sees the *same* remaining time and the count no longer drifts when the host carries their laptop across zones — ideal for a shared launch or livestream page. Without it, bare dates/datetimes stay viewer-local (each person's own deadline), unchanged. The footer shows the in-zone time plus a `UTC±` tag.
- **The countdown target ring now flashes subtly.** The bright ring around the target chip does a slow opacity/stroke-width breathe on live surfaces (app, Obsidian, web) so the destination pops out of a warm approach ramp. PNG/image exports bake the first frame; honours `prefers-reduced-motion`.
- **The error fall-through card now links to the online documentation**, and the link is always present (there's nothing to toggle on the failure card). It deep-links to the chart-type guide (`diagrammo.app/docs/chart-<type>/`) when the type is recoverable from the broken source — the first line usually still declares it — and falls back to the docs landing page otherwise. Present on both the SVG card (embeds/exports) and the HTML card (`/auto`, `<dgmo-diagram>`).
- **Every embed toolbar button can be turned off individually.** `showSource`, `showCopy`, `showExpand`, and `showOpenInEditor` are now fully independent — turning off the source-view toggle no longer removes copy/expand/open (they render as a plain overlay toolbar), and any single button can be shown or hidden on its own. Exposed on every surface: `renderDgmoBlock`/`buildDgmoBlockHtml` options, the `/auto` script config (`data-config` + per-element `data-show-source` / `data-show-copy` / `data-show-expand` / `data-show-editor-link`), and the `<dgmo-diagram>` element (`show-source` / `show-copy` / `show-expand` / `show-editor-link` attributes). When no button is enabled, no toolbar is emitted.

### Changed
- **An open embed source panel now collapses on its own once you move on.** When both the pointer and keyboard focus leave a block whose `</>` source view is expanded, the code panel closes automatically — the expanded source no longer lingers on the page after you're done with it. Applies to the doc-site wrappers (remark client) and the `/auto` + `<dgmo-diagram>` surfaces; clicking the toggle still works as before while you're on the block.
- **Clock horizontal boards (`direction lr`) are cleaner and easier to scan.** Subtle vertical dividers (same shade as the card border) now separate the columns; each column's detail list (place · availability · sundown) is **bottom-aligned** across the board so a title that wraps to two lines no longer pushes its icons out of row with the others; and the digital time is larger, with the seconds and am/pm sized up and pinned to the digits' top and baseline so the trio reads as one block.
- **Embedded-diagram toolbar is now an overlay** pinned to the diagram's top-right corner instead of a reserved row below the chart. The hover-reveal icon strip (source / copy / expand) no longer adds layout height, so an embedded block is exactly as tall as the chart it renders.

### Fixed
- **Countdown recurring glyph no longer renders as a squiggle.** The "repeat" icon beside a recurring event's footer was drawn from Lucide's four separate `<path>`s flattened into one string, which turned the bottom arrow's leading move into a *relative* one — it landed off the icon. The subpath is now absolute, so the glyph reads as the intended two-arrow repeat mark.
- **Event-line: dots now sit at their true calendar position.** Clustered same-side events were being slid horizontally so their cards wouldn't overlap, which pushed dots off their date (e.g. a Jan 15 event rendering at 20% of the span instead of 4%). Dots now hold their exact date-proportional x and card collisions resolve by stacking into deeper lanes (each with its own vertical leader) instead. Dense clusters therefore grow taller rather than distorting the timeline; wide panels still widen the whole axis to relieve crowding to scale.

## [0.50.2] - 2026-07-13

### Changed
- **Embedded diagrams now have a transparent background by default**, so they blend into the host page — Obsidian, the doc-site wrappers, any surface — instead of showing a mismatched dark or light rectangle behind the chart. Standalone PNG/SVG exports are unaffected (still opaque). Background-meaningful types like `map`, whose background *is* the ocean, stay opaque automatically. Embedders can force either behaviour with the block `background: 'transparent' | 'opaque'` option (`renderDgmoBlock`), and `normalizeSvgForEmbed(svg, { background })` exposes the same control directly.
- **Line charts now auto-fit the y-axis to the data by default** instead of forcing a 0 baseline. The axis spans a padded min→max window across all series and both y-axes, so a tight, high-valued series (e.g. a 315→395 lb strength log) fills the plot rather than hugging the top of a 0-based scale. Add `no-auto-y` to restore the 0 baseline. Line-only — bar charts keep the 0 anchor (length encodes magnitude); non-negative data never fits to a negative floor.

### Added
- **Countdown: a years-strip tier for targets more than three years out**, giving distant countdowns a legible long-range layout instead of an unreadable day count.

### Fixed
- **Clock: digital time width is pinned** so the `:SS` and am/pm segments hug the digits instead of drifting as the value changes.

## [0.50.1] - 2026-07-13

### Fixed
- **Countdown (and any large-text chart) no longer has its top clipped in responsive embeds** (Obsidian, remark-based wrappers). The embed normalizer sized every text box at a fixed height regardless of font-size, so the 40px title and 96px hero landed a hair below the tightened viewBox and browser font metrics tipped them into a clip. Text extent is now font-size-aware.

### Changed
- **Countdown recurring-event glyph is now the Lucide `repeat` icon** — matching the icon set the app and Obsidian already use — replacing the hand-drawn double-arrow.

## [0.50.0] - 2026-07-12

### Added
- **New `countdown` chart type (dynamic, live-ticking).** Count down to — or up from — a target date across every rendering surface, with a distance-as-colour band, a short-span compact layout, recurring-event support (including Nth-occurrence templates), and contextual editor highlighting for the recurrence line.
- **New `clock` world-clock chart type.** A live ticking board of world clocks across time zones, for standups, launch windows, and follow-the-sun coverage.
- **New `bracket` chart type.** Single-elimination tournament brackets with match enrichment (scores, tags, commentary, home marker), colored rounds, and layout directives.
- **New `goal` chart type.** Now/target progress with three faces, a note block, traffic-light coloring, `no-note`/`no-auto-color` opt-outs, and an auto-fit layout.
- **Swimlane lanes now own their edges** — a `lane-blocks-own-their-edges` grammar with synced anchors keeps cross-lane connectors attached correctly.
- **Flowcharts honor the space form of `direction LR` / `direction TB`.**

### Changed
- **Sketch edge routing rebuilt.** Edges route around intervening shapes, minimize edge–edge crossings, draw a visible hop where two lines cross, snap to a fixed per-side port grid, and declutter overlapping labels along their own curves with a glyph halo instead of a background rect. Shapes nudge off non-incident edges at layout time.
- **Bracket export/preview canvas sizes to content** instead of a fixed 1200×800.

## [0.49.0] - 2026-07-10

### Added
- **New `body` anatomy chart type.** Render the human body — male or female, front or back — with individually colorable muscle groups over a skin layer, for fitness, medical, and educational diagrams.
- **New `sketch` chart type.** Freeform org-style node cards (header rule + tag rows), group containers, and edges that snap to discrete ports and attach at facing-side midpoints; supports indented `>` markdown shape descriptions, a `no-descriptions` directive, and neutral edges that only take color from their own tag.
- **Family charts gain a full presentation batch.** Divorce lines, a deceased marker, child sorting, generation grouping, a `?` placeholder for unknown people, and lineage highlighting that dims everyone outside the highlighted bloodline.
- **Family generations now zebra-shade under `generations`.** Alternating generations get two rounded gray bands (matching the kanban/RACI row-band convention) so the tree reads rank by rank.
- **`no-daggers` option for family charts** hides the deceased marker for audiences where the dagger reads as morbid.
- **Solid-fill directive support for line and event-line charts.**
- **Full-screen expand button on the standard embed block toolbar**, so any embedded diagram can be opened edge-to-edge.
- **Map POI references resolve by display label** (e.g. reference a city by its name), erroring clearly when a label is ambiguous.
- **Heatmap axis labels are interactive** — hover to emphasize a row or column, click to pin the highlight — and cell value labels now scale to fill their cell.
- **Funnel charts show conversion percentages** with colored side labels and a `no-percent` opt-out.
- **Scatter charts size bubbles by area** (with a pane-fit budget) and highlight a bubble, its label, and leader line on hover.
- **Pie and treemap label polish** — pie highlights a segment's label and leader on hover; treemap sunburst gains two-line tonal labels and a wide-segment fix.
- **Arc diagrams gain group-aware coloring, collision-safe labels, and a vertical orientation.**

### Changed
- **Funnel charts redesigned** — contiguous bands with values centered inside each band, larger colored side labels, and a responsive layout so labels never clip at any pane size (no more leader lines).
- **Flowchart branches now render in source-definition order** rather than a reordered layout.
- **Infrastructure edges can now target a `[Group]` container** directly (#29).

### Fixed
- **Family chart connector cleanup** — marriage bars connect through the name-header center at a uniform height, a union's shared bus trunk dashes only when all children are adopted (and stays solid for a single adopted child), the `?` placeholder gets a solid border with a fainter fill instead of a dash, edges are occluded behind dimmed cards during lineage highlight, and a stray trailing `adopted` token after metadata is stripped.
- **Sketch rendering fixes** — collapsed group cards styled like a plain node, opaque edge-label halos so lines don't fade behind labels, edge labels centered on the line, type badges visible in solid-fill mode, and description text using the label color.
- **Invalid embed blocks now render the standard error card** instead of a blank box.
- **Solid-fill legibility improved on grouped arc bands and nested blocks.**
- **Radar and pie sizing fixes** so labels and radius survive a narrow canvas (radar value labels sit outside the web with per-series color).
- **The CLI resolves the bundled MCP server by absolute path** rather than relying on `PATH`.

## [0.48.2] - 2026-07-06

### Fixed
- **Embed source panel no longer reflows the diagram when opened.** The standard block's one-shared-frame (border + padding) was applied only while the source was open, so toggling code on added a 1px border and padding that shrank the `width:100%` SVG and shifted the icon toolbar inward. The frame box is now reserved at all times with a transparent border; opening the panel only paints the border color in. Diagram dimensions and toolbar position are identical open vs closed — a more finished expand/collapse. Affects every embed surface (marketing gallery, docs wrappers, Obsidian, `/auto`).

## [0.48.1] - 2026-07-06

### Changed
- **Embedded charts now dim on hover to match the app.** The baked-CSS hover for the data-chart family (bar, pie, funnel, heatmap, polar-area, scatter) used a faint `saturate`/`brightness` lift on the hovered group — imperceptible on muted fills, so an embedded chart (doc site, Obsidian, browser-opened `.svg`) read as having no hover feedback at all. Hovering a mark now fades every other category to `opacity: 0.18`, mirroring the desktop app's live hover exactly. The `:hover` self-emphasis floor is retained. Safe with no JavaScript: these renderers set no inline opacity on marks, so the baked `<style>` rule wins.

### Fixed
- **C4: bare text after `Name is a <type>` is again a hard error** instead of being silently dropped. After decision #28 (0.43.0) deleted the `E_*_REMOVED` diagnostic family, a non-`key: value` tail such as `User is a person Handles all requests` silently lost the trailing text (data loss). The tail now raises a parse error naming the fix (`description: …`), and — like other C4 parse errors — the diagram does not render until it is corrected. Use `User is a person, description: Handles all requests`.

### Added
- **Frozen-palette CI guard.** A test now pins the 11 recognized color names (`RECOGNIZED_COLOR_NAMES` + the `colorNames` resolver map) to their exact literal list, so adding/renaming a palette color (a breaking grammar change) fails CI rather than slipping in silently. Documents the decision-#17 invariant that was previously only asserted by prose.

## [0.48.0] - 2026-07-05

### Changed
- **BREAKING: the package is now ESM-only.** The CommonJS build (`dist/*.cjs`) and the `require` export conditions are gone; every entry resolves to its ESM output. All first-party consumers (the remark plugin and its host wrappers, the app, Obsidian, the site, and `@diagrammo/dgmo-mcp` as of its ESM release) already import the ESM build, so nothing in the ecosystem changes. External code still using `require('@diagrammo/dgmo')` must switch to `import`. The CLI (`dgmo`) is unaffected — it ships as its own self-contained binary. Dropping the duplicate CJS bundles removes ~12 MB from the unpacked package.
- **Raw `src/` is no longer published.** The tarball shipped the full TypeScript source (~5 MB) that nothing referenced at runtime (the `exports` map points only at `dist/`; map data is served from `dist/map-data/`). Removed from the published `files`.

## [0.47.0] - 2026-07-05

### Changed
- **Smaller bundles for hosts that import multiple entry points.** `index`, `block`, and `advanced` now share one code-split render pipeline (ESM) instead of each shipping a self-contained ~2.5 MB copy. A downstream bundler (esbuild / Rollup / Vite) that pulls more than one of these keeps a single copy of the pipeline — the Obsidian plugin's bundle drops from ~8.5 MB to ~4.0 MB (it imports all three). No API change; the CJS builds stay self-contained (esbuild can't code-split CJS, and `require` consumers don't bundle).

## [0.46.0] - 2026-07-05

### Changed
- **`/auto` and `<dgmo-diagram>` adopt the standard embed block (BL-114)** — both browser drop-ins now emit the canonical chrome from `@diagrammo/dgmo/block` instead of their bespoke source panel: `figure.dgmo` wrapper, hover-reveal wordless icon toolbar (`</>` view source · copy · open-in-editor) in a reserved footer row, source hidden behind a native `<details class="dgmo-source-wrap">`, and one shared frame around chart + code while the source is open. Copy still copies the raw DGMO source and the editor link keeps its UTM-tagged share URL. Errors now render as the standard `.dgmo--error` card (message + offending source, `role="alert"`) on both surfaces, replacing the old `.dgmo-error-banner`. The old chrome classes (`.dgmo-source-panel`, `.dgmo-source-toggle`, `.dgmo-source-body`, `.dgmo-source-actions`, `.dgmo-btn*`, `.dgmo-chevron`, `.dgmo-error-banner*`) are gone from both surfaces and from `dist/auto.css`, which now bundles `BLOCK_CSS` plus a `.dgmo-theme-dark`-scoped copy of its dark-mode rules.

### Fixed
- **Baked hover no longer fails on tag-group names with spaces or parentheses** (e.g. `Residents (millions)`). Legend markers now carry the same slug the marks use, and the hover injector re-slugs defensively, so `render()` no longer throws `Invalid selector` on such diagrams when a DOM is present.
- **Concurrent renders across two bundle copies no longer race on DOM globals.** Hosts that load both `@diagrammo/dgmo` and `@diagrammo/dgmo/block` (two self-contained bundles) could see one copy tear down `globalThis.document` mid-render of the other (`document is not defined`). The jsdom-globals ref-count is now shared across copies via a `Symbol.for` slot.

## [0.45.0] - 2026-07-05

### Added
- **Standard embed block (`@diagrammo/dgmo/block`)** — the one canonical "diagram + source chrome" every embed surface now shares (remark-dgmo and its five host wrappers first; `/auto`, `<dgmo-diagram>`, MCP reports, site, and Obsidian to follow). The diagram is the star: a slim wordless icon toolbar (`</>` view source · copy · open-in-editor) sits below the chart and only fades in while the pointer is over the diagram itself; source stays hidden behind a native `<details>` (zero-JS toggle); opening it draws one shared frame around chart + code so the source reads as part of the figure. Ships `renderDgmoBlock()`, `buildDgmoBlockHtml()`, `errorBlockHtml()`, `BLOCK_CSS`, and `dist/block.css` (also exported as `./block.css`).
- **`LIGHT_ROLE_STYLES`** in `@diagrammo/dgmo/highlight` — light-background companion to `NORD_ROLE_STYLES` for static source display, with a parity test tying both maps to the block stylesheet's `.dgmo-tok-*` rules.

## [0.44.1] - 2026-07-04

### Fixed
- **event-line / block**: removed the opaque full-canvas background rect. Both types now rely on the SVG's CSS `background` (and resvg's background option for PNG) like every other chart type, so transparent-theme and Obsidian embeds blend with the host instead of showing a dark box.

## [0.44.0] - 2026-07-04

### Added
- **`<dgmo-diagram>` web component** — render diagrams client-side in any HTML page (Hugo, Jekyll, MkDocs, plain HTML) via a `<script>` tag + custom element. New `./element` entry plus a self-registering `dist/element.js` bundle; map diagrams lazy-fetch their geo data so the base bundle stays lean.
- **Baked pure-CSS hover** — exported SVGs carry hover emphasis with zero JavaScript (`bakeHover` in `render()`), across the connection, tag-group, and cross-free chart families.
- **Portable view-state directives (BL-111)** — source-native markers reproduce a configured view anywhere the `.dgmo` travels: `collapsed: true` (mindmap / sequence / state / kanban / gantt / infra), `lane-by <group>` (timeline / gantt / kanban), `color-by-depth` (mindmap), `no-semantic-colors` (er), and honored `hide` (org / sitemap).
- **Treemap radial (sunburst) mode** — a bare `radial` flag renders the hierarchy as a multi-ring sunburst.
- **Multi-series radar** with legend-hover emphasis.
- Dual-axis line charts: hovering a y-axis label emphasizes its series.
- Enumerable diagnostic registry plus a `dgmo diagnostics` CLI command.

### Changed
- **BREAKING**: removed the `chord` chart-type keyword. Use `arc` with `layout chord` for circular / chord layouts.

### Fixed
- Swimlane: blocking boxes shifted out of back-edge corridors.
- Map: arrowheads tagged so legend hover keeps matching arrows lit.
- Arc / block: exported SVG sized to content instead of a fixed canvas.

## [0.43.0] - 2026-06-29

### Added

- **Rich date handling for timelines + event-lines** — BCE/CE years, sub-minute (seconds) precision, and formatted date subtitles, so historical and high-resolution timelines render to scale and read correctly.
- **Event-line `TBD` / future events** — a `TBD` date marks a not-yet-scheduled event; its position is inferred from source-order dated neighbors (interpolated into the gap with a "somewhere in here" whisker, or parked past the last dated event as an open-horizon dashed tail). Consecutive TBDs sharing a gap fan evenly.
- **Event-line** — the whole collapsed-era area is now clickable to expand; out-of-order event dates emit a warning.
- **Pie / line directives** — `hole` + center-total for pie; line fill.
- **Bar** — stack/group block headers; series on a bare bar is now rejected with clustered render wired in.
- **Arc / chord** unified behind a single layout directive (both keywords stay).
- **Solid-fill directive** honored across all fillable chart types.
- **Map** — route arcs bow outward from the route polygon.
- **CLI** — the installer now copies the sibling Claude Code slash commands (`/dgmo-diagram-this`, `/dgmo-document-project`, `/dgmo-codebase-report`), and ships a Codex skill variant of the codebase-report command.

### Changed

- **Chart-type consolidation (50 → 44)** — legacy chart-type aliases were de-surfaced and `bar-stacked` hard-removed as a distinct type; `area`, `doughnut`, `bar-stacked`, `multi-line`, `rasci`, and `daci` are no longer separate types (use the directive forms on their parent types). `language-reference.md` is now canonical-only (#23–28).
- **Event-line** — removed the spine date-tick ruler; crisper axis-break squiggle and cleaner TBD cues.

### Fixed

- **version-control** — prevent bottom clipping of diagonal commit labels.
- Consistent collapse bar across box chart types.
- **journey-map** — emotion-area framing + thought-bubble headroom.

### Removed

- Deprecated-syntax back-compat layer and legacy chart-type aliases (pre-1.0 cleanup, #28).

## [0.42.0] - 2026-06-26

### Added

- **D3 data-chart engine** — all data chart types (bar/line/pie/doughnut/area, sankey, chord, scatter, heatmap, funnel, radar, polar-area, function) now render through hand-built D3 renderers, replacing the previous ECharts engine. Full 15/15 coverage.
- **Dual y-axis line charts** — a grouped `series` block assigns series to a left or right axis, so two different scales share one line chart (§15.1.1).
- **Chart interaction model** — axis-projection hover (a crosshair that triggers across the whole plot, not just empty space), cursor→chart highlight, and on-axis values that read as emphasized ticks instead of tooltips; plus per-series tinted value labels and series-focus emphasis.

### Changed

- **Value→colour/size/width ramps are channel-named (decision #20) — BREAKING.** The ramp directive and its per-element key now share the *visual-channel* word. boxes-and-lines: `box-metric`/`value:` → **`heat`/`heat:`**. map: `region-metric` → **`region-heat`** (`heat:`), `poi-metric` → **`poi-size`** (`size:`), `flow-metric` → **`flow-width`** (`width:`); `no-region-value` → **`no-region-heat-value`**. Each map element accepts exactly one channel key — a wrong-channel key (e.g. `size:` on a region) is now a hard error. treemap (`heat`/`heat:`) is unchanged — it was the reference pattern. No migration: the old tokens are unrecognized.
- **Event-line** — legend mute-to-dots, collapsed-era centering + hover fix, date-in-card layout, focus interactions, and tag defaults.

### Removed

- **ECharts removed — D3 is the only data-chart engine — BREAKING.** The `--engine` CLI flag and the `engine` option are gone; charts that rendered via ECharts now use the D3 renderers above.

## [0.41.0] - 2026-06-25

### Changed

- **Event-line eras are now indentation containers** — member events indent beneath the `[Name]` bracket (the same nesting idiom as org / version-control), replacing the 0.39.0 flat run-delimiter form. An indent-0 event sits outside any era; a dedent to indent 0 ends the open era. Old flat sources still parse (their events read as era-less — valid, not an error). Reverses decision #19.2 (#21).

## [0.40.0] - 2026-06-25

### Added

- **Event-line + block gallery examples** — representative `.dgmo` fixtures now ship in the package, so `get_examples('event-line')` / `get_examples('block')` and few-shot tooling return real starters for these types.

### Changed

- **Event-line** — collapsed eras render better: the summary card anchors at the date-span midpoint with a bracket stretched across the full member range, an axis-break glyph marks the folded span on the spine, the member list no longer truncates, and event-line widths adapt to content.

## [0.39.0] - 2026-06-25

### Added

- **Event-line chart type** — an annotated narrative timeline: a horizontal spine of point events, each a dot with a date caption and a leader to an org-style card, auto-alternating above/below. Distinct from `timeline` (to-scale axis with eras/markers/ranges); event-line is point events with rich prose, optionally not to scale. Supports **eras** (`[Name]` run delimiters) that bracket a contiguous run of events; an era can **collapse** to a single summary card (bulleted member list, tag-colored) with an on-spine `⊓` bracket marking its span, and expand again live in the app. `no-scale`, `side above|below`, `no-box`, `no-legend` directives.
- **Version-control chart type** — a VCS-agnostic commit DAG drawn as parallel branch lanes (the git/Mercurial/SVN branch-and-merge picture) in a "metro map" visual. Keyword-less grammar (a bare top-level line is a branch, a bare indented line is a commit); only `merge` and `cherry-pick` are required verbs. At parity with Mermaid `gitGraph` and beyond (HEAD / remote-tracking / ahead-behind, `rebase`/`reset`/`revert`/squash, step notes).
- **Block chart type** — an author-controlled grid of rectangular blocks with nested, collapsible containers, for diagrams where the 2-D arrangement *is* the meaning (system/hardware/architecture layouts). Containment over edges; columns inferred from placement; `_` for empty cells.
- **Swimlane chart type** — cross-functional / BPMN-style swimlanes: lanes, `[Phase]` columns, and in-arrow labels.

### Changed

- **Treemap** — vertical labels for tall-narrow cells with descender-safe value spacing.

## [0.38.0] - 2026-06-24

### Added

- **Treemap chart type** — nested rectangles sized by value for hierarchies (budgets, disk usage, portfolios). Color by category (`tag`), by a value heatmap (`heat:` + a data-aware diverging/sequential ramp), or by branch; the desktop app adds a live tag/heat/branch switcher, drill-to-zoom that keeps the containing box for context, and a legend gradient-scrub hover. `depth N` and `no-*` opt-outs supported.

### Changed

- **Treemap drops `other-below`** — the small-leaf rollup into an "Other" bucket was removed; small children now render as their own cells (with a lower label-font floor so tight labels still fit). The directive is recognized but ignored with a warning so older sources don't break.

## [0.37.0] - 2026-06-23

### Changed

- **Simpler map route syntax** — route legs drop the `style:` header and use a glyph-only leg shape (e.g. `A ~> B`); silent-case handling is tightened so ambiguous routes no longer render unexpected connectors. Existing `style:`-header routes should migrate to the glyph form.
- **AI surfaces ask when the chart type is ambiguous** — the AI-core authoring guidance now instructs assistants to ask the user which chart type they want rather than guessing when the prompt is unclear.

### Added

- **Map edge value-on-hover** — hovering a weighted map edge shows its value via a native tooltip.

### Fixed

- **Map callout leaders route toward open water** instead of taking the shortest hop into crowded land, reducing label collisions.
- **Heavy map edge labels sit beside the stroke**, not on top of it, so thick connectors stay legible.
- **Infra parser** now handles quoted-name aliases, chart-type-keyword node names, and indented tags.

## [0.36.0] - 2026-06-23

### Changed

- **App-aware output for AI-generated diagrams** — the bundled `dgmo` skill now decides where a generated diagram goes based on whether the Diagrammo desktop app is installed (via the new `check_app_installed` MCP tool in `@diagrammo/dgmo-mcp` ≥0.4.0). With the app installed, the AI saves the `.dgmo` source and opens that file live in the app — in-app edits autosave back to it — instead of defaulting to an online share URL. Without the app, it falls back to the share URL. The `.dgmo` source is always saved, and a PNG/SVG is rendered only when explicitly requested.

## [0.35.0] - 2026-06-22

### Added

- **One-step AI setup — `dgmo install`** now sets up every AI assistant on your machine in a single command. With no target it auto-detects Claude Code, Codex, Claude Desktop, Cursor, Windsurf, and Copilot and configures each one non-interactively (no prompts). The CLI is the only binary you install: a new `dgmo mcp` subcommand provides the MCP server (so client configs point at `dgmo mcp` — there's no separate `dgmo-mcp` package to install). Cursor and Windsurf are wired as full MCP clients; flags `--scope user|project` and `--dry-run` are available.
- **Stays current** — `dgmo install` upgrades the MCP server to the latest; via Homebrew the server is bundled and upgrades together with `brew upgrade dgmo`. `DGMO_MCP_LATEST=1` makes `dgmo mcp` always fetch the newest server at launch.

## [0.34.0] - 2026-06-22

### Added

- **Legible boxes-and-lines edge labels, regardless of length or layout** — connector labels follow a priority ladder: (1) wrap long text onto up to 3 lines (hard-break + ellipsis bound the box), (2) if the box still overlaps a node, slide it along the line and then a small perpendicular offset into clear space while staying proximal, (3) as a last resort, re-run the layout reserving label space so a gap opens. Placement moved from the renderer into the layout (a new `label-placement` pass), and labels now paint in a dedicated layer above the nodes so a box can never clip them.

### Changed

- **Edge-label halo restyled** — borderless and semi-transparent, so the connector line stays faintly visible behind the label while the full-opacity text on top stays crisp.

## [0.33.0] - 2026-06-21

### Added

- **Multi-word quoted tag-group names** — `tag "Trust Zone" as tz` is now accepted. The display name is preserved for the legend label while a DOM-safe slug (`trust-zone`) is used wherever the name becomes a `data-tag-*` attribute, entity metadata key, or `active-tag` match target. Single-identifier names stay byte-identical. Threaded through every tag-group-consuming chart type.
- **Boxes-and-lines tier-band grouped layouts** — grouped diagrams resolve into ordered disjoint rank bands with peripheral back-edge routing, fixing the back-edge "balloon" and cross-tier collisions. Additive layout candidate gated on strict badness; no gallery drift.
- **Map place discoverability** — `searchMapLocations()` API and a `dgmo map search` CLI command resolve human place names (e.g. "New York") to paste-ready map tokens; map authoring tips steer flights toward IATA codes.
- **Journey-map persona richness** — persona accepts a §1.5 trailing-token color and supports bullets + inline markdown in the description.

### Fixed

- **sitemap** — sub-pages nested inside a container now raise an error instead of silently mis-nesting.

### Changed

- Expanded per-type authoring TIPS: boxes-and-lines categorical tag-group examples, richer journey-map / kanban / sitemap styling guidance, sequence section guidance.

## [0.32.1] - 2026-06-20

### Changed

- **Authoring TIPS quality pass** — rebalanced the per-type styling TIPS from syntax-restating toward communication/visual-quality guidance (the established house style), and refined them from a full no-tips-vs-tips A/B sweep across the renders. Notable fixes: slope no longer advises a recolor that collides with the auto-palette; pert drops a no-op `default-confidence` clause; arc/wordcloud name the real layout levers (`order appearance`, `size <min> <max>`); ring keeps values in the band label. Docs-only — no API or render-behavior change.

## [0.32.0] - 2026-06-20

### Added

- **Named-palette color enforcement** — diagram colors must now be one of the 11 named palette colors. Hex (`#e6194b`) and CSS color names (`crimson`) are rejected with a `Nearest: <name>` hint, so authoring tools fail fast instead of silently falling back. Wired through every chart parser.
- **Boxes-and-lines focus mode** — a 1-hop neighborhood transform that isolates a node and its immediate connections; opt-in layout-search progress hook.
- **Mindmap parent→child tag cascade** — a tag value on a branch flows to its sub-nodes.
- **Per-type authoring TIPS** — every one of the 35 chart types now carries a styling-tips block in the language reference (consumed by the MCP per-type guidance slice).
- **Richer map context labels** — country labels dodge collisions, respect proximity, and adapt to zoom.

### Fixed

- **Flowchart structural integrity** — a node carrying an unsupported trailing suffix (e.g. a tag-style `(Denied) s: Denied`) is salvaged with a warning instead of silently dropping the node *and* its edge; a leading-arrow continuation line (`(Start)` then `-> Next`) now attaches to the previous node instead of orphaning it.
- **function** — a curve whose name begins with `x` (e.g. `x / 2: x / 2`) no longer collides with the `x <min> to <max>` range keyword and gets silently dropped.
- **bar** — plain `bar` given multiple series now warns (use `bar-stacked` / `multi-line`) instead of silently rendering only the first series.
- Timeline horizontal fit, mindmap canvas fit, scatter legend spacing, org focus-icon contrast, sequence participant interleave, map antimeridian POI-frame clamp.

### Performance

- Map region rings/bbox caching; boxes-and-lines layout ~27% faster via identical-output scoring fixes + pre-score sort.

### Changed

- Internal parser refactors: shared `makeFail()` diagnostic accumulator, chart-type registry min-dimension formulas, theme-base-bg helper (arch-review stories 111.2–111.5).
- Documentation: timeline events documented date-first; flowchart node color is automatic-by-shape (no tags/metadata); RACI/sitemap/c4 example fixes; stale gallery fixtures repaired.

## [0.31.0] - 2026-06-18

### Added

- **CLI colorful ASCII banner** — `dgmo` prints a slate-palette-derived gradient logo.
- **`autoTagColorCycle` export** (`/advanced`) — the canonical categorical color
  order, so consumers can match the engine's auto color-pick.
- **Boxes-and-lines `layout` coordinate block + pinned-layout bypass** — supports
  the desktop canvas editor: explicit per-node coordinates are honored (and kept
  on-canvas), including when a flat group is collapsed.
- **Card convention module** (`utils/card.ts`, `utils/visual-conventions.ts`) —
  shared card-rendering primitive (Story 111.1), adopted by the sitemap renderer.
- **Journey-map persona `color:`** — same-line `persona Name color: <token>` form
  (pipes were removed in 0.18.0).

### Changed

- Unified auto color-pick order to an RGB-seeded max-contrast cycle.
- Sharpened `slope` and `map` chart-type descriptions for selection accuracy.

### Fixed

- **Multi-map pages** — SVG `<def>` ids are namespaced per render so multiple maps
  on one page no longer ghost each other's gradients/masks.

## [0.30.0] - 2026-06-15

This release **freezes the DGMO language and locks the public API** ahead of
1.0 — the deprecated-but-working syntax forms are removed and the unstable
`/internal` entry point is retired. It contains **breaking changes**; most are
graceful (the diagram still renders best-effort while emitting a structured
error), and `dgmo migrate` covers the data-row comma change.

### Removed (breaking)

- **`/internal` subpath entry point.** Long deprecated (its banner said
  "removed in 0.17.x"); import unstable symbols from `@diagrammo/dgmo/advanced`
  instead — it is symbol-identical and documented as a permanent no-semver
  surface.
- **Gantt legacy scheduling syntax** (`parallel`, positional/explicit-date
  duration forms) → `E_GANTT_LEGACY_REMOVED`. Use the v2 arrow scheduling
  syntax; `duration:` / `start:` are canonical and unchanged.
- **Comma-separated data-row values** → `E_DATA_COMMA_REMOVED`. Data rows are
  space-separated; thousands separators are dropped (use `1_000` underscore
  grouping if needed). Run `dgmo migrate` to convert existing diagrams.
- **Bare `description <text>`** (no colon) → `E_DESCRIPTION_BARE_REMOVED` across
  infra/c4/sitemap/mindmap/journey-map. Use `description: <text>`.
- **PERT `analysis` directive** → `E_PERT_ANALYSIS_REMOVED` (was already inert).
- **Timeline positional duration** (`30d`) → `E_TIMELINE_BARE_DURATION_REMOVED`;
  `duration:` is now the canonical form.
- **C4 bare same-line `description`/`tech` tail** → `E_C4_BARE_TAIL_REMOVED`.
  Previously the bare form was silently dropped (real data loss); it now errors
  and the colon form is required.

### Changed

- **Auto-assigned tag colors.** A bare, uncolored tag value now receives a
  deterministic categorical palette color via a per-group finalize pass;
  explicit colors always win and are never reused.
- **Public API surface locked.** `chartTypes`, `ChartTypeMeta`, and `MapData`
  are promoted to the stable root (`@diagrammo/dgmo`). `/advanced` is documented
  as the permanent no-semver firehose. API.md drift fixed (slate is the default
  palette; previously-missing root exports and the `./pert` subpath documented).

### Added

- **AI authoring-guidance layer** — `AI-CORE` styling guidance plus per-type
  authoring tips, delivered to the static surfaces and the MCP per-type slice.

### Performance

- **Map.** Memoize projected region geometry across recolor; bbox pre-filter in
  `fillAt` cuts `layoutMap` by ~36%.

### Fixed

- **Map framing.** Tuck Alaska/Hawaii insets under the coast (not the canvas
  floor) and enlarge them; tall-pane albers-usa framing sinks the insets and
  nudges CONUS up; region labels are cleaned-or-dropped instead of trailing
  spaghetti leaders.

### Tests

- Added parser unit tests for `arc`, `slope`, and `wordcloud`; fixed the
  coverage glob that tried to parse `src/map/data/README.md` as JS.

## [0.28.0] - 2026-06-10

### Changed

- **New boxes-and-lines layout engine.** Boxes-and-lines diagrams now lay out
  with a placement-search engine (multi-seed dagre placement scored on the
  rendered spline geometry — true crossings, line overlaps, and edges piercing
  node boxes) instead of the previous layered engine. Across the test corpus it
  roughly halves the combined badness (fewer line crossings and fewer lines
  stepping on each other), keeps groups as readable bands, and stays stable on
  edit and collapse (small change → small visual change). Cycle-closing edges
  route as smooth peripheral swoops. Parallel edges and node notes are fully
  supported. This changes the geometry of existing boxes-and-lines diagrams.

### Removed

- **Dropped the `elkjs` dependency** (~1.4 MB). It was only used by the
  boxes-and-lines layout, now superseded by the built-in engine — smaller
  install for every consumer and a lighter script-tag bundle.

### Fixed

- **Map context labels.** Wide-but-short countries (Canada along the top of a
  US frame) and tall-but-narrow ones (Chile) keep their labels instead of being
  dropped by the antimeridian smear guard; Russia anchors over visible western
  Russia on regional projections; ocean and major-sea names outrank big
  countries which outrank minor bays and straits, and a small label budget
  always reserves room for countries so water can't crowd them out; framed
  US-state views now label the focus state itself.

## [0.27.0] - 2026-06-08

### Added

- **Node notes across five chart types.** Flowchart, state, class, ER, and
  boxes-and-lines diagrams gain `note <id>` — a floating comment bubble tethered
  to a node, placed by a shared collision-aware layout (`utils/notes/`) that
  keeps notes clear of shapes and never moves the diagram's own geometry. Notes
  collapse to a small comment-bubble badge and expand on click; colour a note
  with a trailing colour word (`note A This is a warning red`). `no-notes` opts
  out. Org and sitemap were evaluated and excluded — their indentation grammar
  conflicts with the note syntax.
- **Map: region values on choropleths.** Regions can carry their own numeric
  `value`, rendering a true choropleth alongside POIs. Tiny or POI-blocked
  regions get a leader-lined callout — placed in a reserved column on either
  edge, fanned out radially, or revealed by a zoom-out reserve — with chips kept
  off the canvas edge and high-contrast leaders.
- **Map: IATA airport codes resolve as place identifiers.** `poi JFK`,
  `route JFK -> LAX` and any three-letter IATA code resolve to airport
  coordinates through the existing name-lookup path — no new syntax. Coverage is
  large international hubs + all US scheduled-commercial airports, shipped as a
  separate optional `airports.json` asset (OurAirports, public domain; ~38 KB
  gz, loaded only for map diagrams). Resolution is case-insensitive and **by
  code only**; airports are the lowest-precedence identifier, so a token that is
  both a city and a code resolves to the **city** (with a non-blocking shadow
  hint). Editor completion lists codes as a labeled group below cities. Unknown
  codes emit `E_MAP_UNKNOWN_AIRPORT_CODE` with an `as <CODE>` hint.
- **Map: tagged connector/leg colours.** A trailing tag on a connector or route
  leg colours the line (`A ~> B l: Cruise`); focusing a leg co-highlights its
  endpoint POIs and the matching legend line, without dimming the basemap.
- **Map: undirected + labeled-undirected connector tokens.**
- **Map: population-sized city dots** as a subtle default layer (`no-cities`
  opts out), and **footprint-scaled, faded orientation backdrop labels** for
  context.
- **Map: auto-zoom for compact US region maps** — North-up framing with
  full-name labels; conic equal-area projection with a data-centered fit for
  regional maps.
- **Metric: colour ramps anchor at the data minimum** rather than zero, so
  value ranges that don't start at 0 use the full ramp.

### Changed

- **Default palette is now Slate** (was Nord), part of the Epic 108 rebrand. The
  active palette is correctly threaded into named-colour resolution so themed
  colours track the selected palette everywhere.
- **Sequence: participant position override requires a colon** — `position: N`
  (was bare `position N`). Pre-1.0, this is a hard break with no compat shim.
- Region borders now stay legible on dark themes; value ramps and segment fills
  stay strictly on-palette (no invented hues); journey-map emotion faces align
  to the curve scale; the swimlane legend toggle has a larger hit area.

### Removed

- **Trimmed the palette registry to seven curated palettes.** Dropped Dracula,
  Monokai, One Dark, Solarized, Gruvbox, and Rosé Pine — each failed the
  categorical-distinctness bar a diagram palette must meet (a single hex reused
  across distinct slots, or collapsed hues, so multi-category diagrams render
  different categories with identical colours). `getPalette()` falls back to the
  default (`slate`) for any removed id, so saved preferences and share URLs
  degrade gracefully. The kept seven: atlas, blueprint, catppuccin, nord, slate,
  tidewater, tokyo-night.

### Performance

- **World-map SVG shrunk ~75% (4.5 MB → 1.2 MB)** via render-side coordinate
  rounding, screen-space vertex thinning, and `<use>`-deduplicated coastline
  water-lines — unblocking globe/world maps in static-site builds.

### Internal

- Shared glyph-table text measurement now backs chart-type text sizing; extracted
  shared helpers for arrowhead `<marker>`s, `fitDiagramToCanvas`, and legend
  geometry; general dedup across renderers. No intended user-visible change.

## [0.26.0] - 2026-06-04

### Changed

- **Editor completion now offers only parser-valid keywords per chart type.**
  Structural keywords are sourced from a single authoritative, parser-validated
  registry (`STRUCTURAL_KEYWORDS`), with `TAG_SUPPORTING_TYPES` derived from it.
  Fixes two keywords the popup offered that the parser rejects: `tag` on RACI
  (no tag-block support) and `no-descriptions` on cycle (a removed keyword). The
  completion-conformance suite now locks structural keywords and the spec §1.3
  tag-support list against the parsers so they can't drift again.

### Removed

- **`DiagramSymbols.keywords`** (from `@diagrammo/dgmo/advanced` and the
  deprecated `/internal`). The field carried per-extractor reserved-word lists
  that nothing consumed in production; structural-keyword completion is now
  driven by `STRUCTURAL_KEYWORDS`. Breaking for any direct consumer of the
  extractor symbol shape.

### Fixed

- **Export renders no longer leave a tall band of dead space** below short
  flowchart, state, and RACI diagrams. In export mode the canvas height is now
  fitted to the scaled content; the interactive preview keeps its fit-to-pane
  behaviour.

## [0.25.3] - 2026-06-04

### Fixed

- **Pyramid descriptions no longer clip at the right edge in embeds** (Obsidian,
  remark/markdown, web embeds). `normalizeSvgForEmbed`'s string bounding-box
  estimator assumed every `<text>` was `text-anchor="middle"`, so it
  under-measured the right extent of `start`-anchored text (e.g. pyramid
  right-column descriptions) by half the text width — collapsing the tight
  viewBox and clipping that text when scaled to fit. The estimator now honors
  each element's `text-anchor` (`start`/`middle`/`end`). Benefits any chart type
  with anchored text near a margin.

## [0.25.2] - 2026-06-04

### Fixed

- **Word clouds no longer collapse to their title in embeds** (Obsidian,
  remark/markdown, web embeds). Word-cloud words are positioned with
  `transform="translate()"` and have no `x`/`y` attributes, so
  `normalizeSvgForEmbed`'s string bounding-box estimator couldn't see them — it
  measured only the title and zoomed that fragment to fill the frame. Tightening
  is now rejected when the measured box covers less than half of the renderer's
  canvas (a sign content was missed), keeping the correct full-canvas viewBox.
  Extends the embed-clipping fix in 0.25.1.

## [0.25.1] - 2026-06-04

### Fixed

- **Embedded diagrams no longer clip in hosts** (Obsidian, remark/markdown, web
  embeds). `normalizeSvgForEmbed`'s content-tightening used a string bounding-box
  estimator that ignores `<g transform>` and misparses path arc commands, so it
  could compute a shifted, out-of-bounds box that overrode each renderer's
  already-correct viewBox and cut off the right/bottom of the diagram (ER tables,
  mindmap nodes, flowchart elements). Tightening is now only applied when the
  computed box sits within the renderer's canvas — a genuine sub-rectangle —
  otherwise the renderer's correct bounds are kept.

## [0.25.0] - 2026-06-04

### Fixed

- **Legend text vertical centering** now uses an explicit `dy` offset instead of
  `dominant-baseline`, which WebKit (WKWebView / Safari) rendered inconsistently.
  Legend labels are now vertically centered in the desktop app and Obsidian.

### Removed

- Removed 9 confirmed-dead internal exports (pre-1.0 cleanup). These were never
  part of the documented public API.

### Internal

- Added a LICENSE file and a `license` field to `package.json`.
- CI now runs the hygiene trio (dead-code, duplication, and dependency checks)
  on push/PR.

## [0.24.0] - 2026-06-03

### Added

- **`normalizeSvgForEmbed` / `getEmbedSvgViewBox`** — public helpers that tighten
  a rendered SVG's `viewBox` to its content so inline embeds (Obsidian, host
  integrations) take the diagram's intrinsic aspect ratio instead of the fixed
  1200×800 export canvas. Short diagrams no longer reserve a tall dead band.
- **WYSIWYG map export** — map PNG export honors the preview pane's aspect
  ratio, and the legend reserves a top band so it no longer covers land.
- **Boxes-and-lines `show-values`** — refined value card layout.

### Fixed

- **Timeline** — fixed row height so events never overlap on short surfaces.
- **Map** — POI-only frames no longer chase a tall container's far edge.

## [0.23.0] - 2026-06-03

### Added

- **Boxes-and-lines value ramp** — a box can carry numeric `value:` metadata;
  `box-metric <label> [color]` names the value-ramp dimension and sets its hue,
  and `show-values` prints each box's number. Mirrors map's `region-metric`.
- **Higher-resolution relief** — finer relief polygons and hachure on maps.
- Map Inspect outlining — every region path is stamped with `data-iso`.

### Fixed

- **World maps fill the canvas edge-to-edge** — the global stretch-fill no
  longer leaves a padded margin; the antimeridian sits on the canvas edge with
  no fake coastline ringing the cut, and the wrap-sliver a landmass leaves on the
  far edge (Russia's Chukotka beside Alaska) is dropped.
- Decorative map overlays (relief, water-lines, rivers) no longer intercept
  region hover in WebKit.
- Region hover label is anchored to the area-weighted centroid.
- Disputed territories are merged into their parent region to fill holes.
- Horizontal time-sort timelines size their SVG to the content height instead of
  leaving a large vertical gap below the chart.

## [0.22.0] - 2026-06-03

### Added

- **Content-aware export canvas** (`mapExportDimensions`) — map exports size the
  canvas to the content's own aspect ratio instead of a fixed box, so regional
  maps no longer letterbox.
- **Colorize** — region maps with no data auto-colour every region a distinct
  pastel (greedy 4-colouring so no neighbours share a hue); `no-colorize` opts
  out.
- **New palettes** — Atlas, Slate, Blueprint (cyanotype), and Tidewater
  (nautical).
- Relief is unconditional — only `no-relief` hides it; now also shown on the US
  national Albers view.
- Coastal ocean anchors and container-region labels so zoomed-in coastal frames
  still label the surrounding ocean and the parent region.
- POI-only maps fit-zoom to their containing region.
- Route legs and labels are click-to-line navigable.

### Changed

- Wider context pad for region/choropleth maps.
- Legend controls can be app-hosted (`controlsHost: 'app'`), letting the host UI
  own the colouring controls.
- Removed the Bold palette.

### Fixed

- Antimeridian-crossing landmasses (e.g. Russia) now render in regional views.
- Ocean reads clearly as water and neutral land reads as land (contrast tuning).
- Inset coastline water-lines clipped to their box, with a water moat around
  inset borders.
- Adjacent region/POI labels no longer overlap at small scales; label halo gated
  on overflow.

### Performance

- Coastline and mask geometry collapsed into compound paths for faster
  legend-hover recolours on heavy maps.

## [0.21.1] - 2026-06-02

### Added

- **Map direct colors** — color a map with the same trailing-token idiom used
  everywhere else in dgmo, no tag group required:
  - `poi Austin red` sets a POI's marker fill directly (wins over a tag color
    and the default orange).
  - `Texas red` (or `California blue value: 92`) paints a region a flat
    categorical highlight that ignores the active colouring dimension and adds
    no legend entry — the lightweight "make this one stand out" escape hatch.
  - `region-metric Sales ($M) blue` sets the choropleth ramp hue (was always
    red). A place literally named for a color keeps it via capitalization
    (`poi Orange`).

## [0.21.0] - 2026-06-01

### Changed

- **Map syntax — one `value:` keyword** (breaking) — the `map` chart type's three
  numeric channels collapse into a single `value:`, rendered per element: region
  shade, POI marker size, edge/route-leg thickness. Replaces `score:` (regions),
  `size:` (POIs), and `weight:` (edges).
- **Map routes — origin header + arrow legs** (breaking) — a route is now
  `route <origin> [style: arc]` followed by indented `[-label->] destination`
  legs, each an edge with its own in-arrow label, `value:` thickness, and arc
  shape. Replaces the bare-stop list. Fixes two latent bugs: named-stop metadata
  is no longer silently dropped, and a loop-closing leg no longer double-draws the
  origin marker.
- **Map legend labels** — `region-metric` / `poi-metric` / `flow-metric` replace
  `metric` / `size-metric` (one `value:` keyword now drives three element
  channels that often carry different quantities).
- **Map scope** — a bare US state postal code resolves to that state
  (`poi Portland OR` → Oregon; `CA` = California) and signals US scope.

### Removed

- **Map** — the `description:` and `date:` reserved keys (no v1 surface — they now
  raise an unknown-key error instead of silently no-opping) and the
  `active-tag score` token (the value ramp is the default; select it by its
  legend name).

## [0.20.3] - 2026-05-31

### Fixed

- **Map — Antarctica** — Antarctica is no longer drawn on the world basemap.
  The natural-earth world frame is clamped to ~-58°N and global views take a
  canvas-filling stretch path with no clip, so Antarctica's -90° geometry
  spilled out the bottom of the canvas as a distorted strip. It's now omitted
  by convention (matching standard data world maps) unless explicitly
  referenced as a region.

## [0.20.2] - 2026-05-31

### Fixed

- **Map rendering** — a batch of fixes that make regional and US-states
  views render with correct geographic context instead of a tiny,
  context-free landmass:
  - Basemap is now culled by projected canvas overlap rather than a
    lat/lon bounding box, so neighbouring land is included whenever it
    actually falls inside the viewport.
  - Projected geometry is clipped to the canvas, eliminating stray
    off-canvas paths.
  - Regional POI/route maps and `us-states` (albers-usa) views now draw
    neighbouring land (e.g. South America, northern Canada) for context.
  - Hub POI labels seat above/below when both flanks are blocked.

### Docs

- Corrected the active-tag default in the language reference and a stale
  tsup dev-reload comment.

## [0.20.1] - 2026-05-30

### Fixed

- Map data loader (`src/map/load-data.ts`) now imports Node builtins
  (`fs/promises`, `url`, `path`) lazily, inside the async load path,
  rather than at module top level. The static imports were hoisted into
  `dist/index.js` and broke browser bundlers (Obsidian's esbuild, the
  app's Vite/Rollup web build) that pull dgmo in. The loader is Node-only
  by contract — the web build injects `MapData` via DI and never calls
  it — so deferring the imports keeps the node code out of the eager
  browser chunk. Mirrors the existing `await import('jsdom')` seam.

## [0.20.0] - 2026-05-30

### Added: `map` chart type

DGMO now renders geographic maps. Plot points of interest, shade
regions, and draw weighted routes/links over a world or US base map.

- **Base maps**: equirectangular world (snapped to a full Greenwich
  frame, every continent in view) and a purpose-built US projection
  (Albers conic with custom Alaska/Hawaii insets). Land fills the
  canvas; oceans render blue, lakes blue, neighbouring land neutral.
- **Points of interest** with inline labels that flip left when they
  would run off-canvas; dense clusters break into callout columns.
- **Regions** shaded by a selectable colouring dimension — `score`
  (continuous ramp) or `tag` (categorical) — with a bivariate flip
  between the two.
- **Routes/links** drawn as weighted arrows between points.
- **Legend** with hover highlighting and a score-gradient scrubber;
  hovering dims non-matching regions to neutral land.
- Natural Earth 110m rivers overlaid on world maps; crisp 10m North
  America surroundings under the US view.
- `mapNeutralLandColor` exported for hosts that dim the base map.

### ⚠ BREAKING: `description`/`technology` keywords now required (C4 + infra)

Keywordless-prose promotion is gone. In C4 and infrastructure
diagrams, a bare line under a node is no longer silently promoted to
its description — you must use the `description` (and `technology`)
keyword explicitly. The deprecation message has been corrected to
point at the keyword form. (DD-1, DD-2)

```dgmo
# Before (0.19.x) — bare prose promoted to description
Service API
  Handles all the things

# After (0.20.0)
Service API
  description: Handles all the things
```

### Fixed

- Map: blue ocean on world maps (dropped antimeridian frame-fillers);
  region-label halos use the opposite colour of the text so they
  always read; clean red score ramp with no muddy brown over green
  land; POI markers default to orange rather than the blue accent.

## [0.18.1] - 2026-05-28

### Documentation

- Regenerated `docs/language-reference.md` to spec parity. Added five
  missing sections: §13A PERT, §18 Mindmap, §21 Cycle, §22 Journey
  Map, and §26 Authoring Rules. Renumbered Tech Radar, Pyramid, Ring,
  RACI, and Colon Usage Summary to match spec ordering; swapped
  Wireframe + Tech Radar to align with spec source order. The MCP
  `get_language_reference` tool now serves complete documentation for
  every chart type.
- Migrated residual pipe-metadata examples in `README.md` to §1.4
  same-line form. The org-chart sample and the "single-line with pipe
  delimiter" prose subsection had been left out of the 0.18.0 pipe
  retirement sweep.

## [0.18.0] - 2026-05-27

### ⚠ BREAKING: `|` retired as metadata delimiter — unified §1.4 grammar

DGMO's pipe operator no longer delimits metadata. The five different
pipe-positional shapes across 17 chart types collapse into a single
same-line key-value form:

```dgmo
# Before (0.17.x)
Redis | instances: 3, latency-ms: 5
30bd Database | t: Engineering, 80%
Wisdom | Personal growth, recognition
(Submit) | primary, destructive

# After (0.18.0)
Redis instances: 3, latency-ms: 5
30bd Database t: Engineering, progress: 80
Wisdom description: "Personal growth, recognition"
(Submit) primary destructive
```

Legacy `|`-bearing lines emit `E_PIPE_OPERATOR_REMOVED` (one per
offending line). Bare-positional shapes that don't translate to a
direct comma-separated key list get keyed names:
`E_GANTT_BARE_PERCENT_REMOVED`, `E_JOURNEY_BARE_SCORE_REMOVED`,
`E_PYRAMID_BARE_DESCRIPTION_REMOVED`, `E_RING_BARE_DESCRIPTION_REMOVED`.

The `|` character still parses literally inside wireframe dropdown
options `{A | B}`, arrow labels per §1.10 (`A -file|name-> B`), and
quoted strings (`"Order | Items"`). The migration tool preserves
all three.

#### Migrate with `dgmo migrate`

```bash
dgmo migrate path/to/dir --diff           # preview
dgmo migrate path/to/dir --apply          # write (.bak sidecars by default)
dgmo migrate docs/ --embedded --apply     # .md / .mdx with fenced ```dgmo
```

The tool is dry-run by default, idempotent on re-run, and atomic
per file in `--embedded` mode (a parse-error block aborts the whole
file — no partial writes).

See `docs/migration-pipe-retirement.md` in the workspace for the
full migration walkthrough including per-chart-type recipes.

### Added — wireframe trailing-keyword flag form (§19.5)

Wireframe elements now accept a space-separated trailing keyword
list drawn from the closed 16-flag enum:

```dgmo
(Submit) primary destructive   # new — flag list
[Email] required                # new — single flag
Dashboard active                # new — flag on bare-text
```

Case-sensitive — lowercase tokens from the enum get peeled as flags
from the right of the label; capitalized labels stay verbatim.
Spec §19.5 has the authoring guidance.

### Added — `dgmo migrate` CLI subcommand

Line-by-line migration tool with a per-line classifier that
preserves wireframe dropdown braces, arrow labels (§1.10), and
quoted-name `|` characters. Surface:

```
dgmo migrate <path> [--dry-run|--apply] [--diff]
                    [--backup|--no-backup] [--embedded]
```

Also exposed in the MCP server (`@diagrammo/dgmo-mcp` 0.2.0) as
`migrate_diagram(content: string)` so LLMs can offer in-place
migration on legacy content they encounter.

### Added — `deprecatedSyntax` highlight role

The editor surfaces legacy `|` characters in a strikethrough red
deprecated-syntax color so authors see the migration prompt
visually before the parser diagnostic fires. The lezer grammar
tokenizes `|` uniformly, so surviving valid pipes (in dropdowns,
arrow labels, quoted strings) also paint as deprecated — accepted
noise during the transition.

### Added — §1.4 same-line metadata autocomplete

The diagrammo-app editor autocomplete now fires on `, ` continuation
inside an already-keyed metadata region (`Foo k: v, _` → suggests
next key). Same key set as the legacy `|` trigger; both coexist
during the transition.

### Diagnostic codes added

- `E_PIPE_OPERATOR_REMOVED` (error)
- `E_GANTT_BARE_PERCENT_REMOVED` (error)
- `E_JOURNEY_BARE_SCORE_REMOVED` (error)
- `E_PYRAMID_BARE_DESCRIPTION_REMOVED` (error)
- `E_RING_BARE_DESCRIPTION_REMOVED` (error)
- `E_TAG_DECLARED_AFTER_CONTENT` (error)
- `W_EMPTY_METADATA_VALUE` (warning)
- `W_ATTRIBUTE_AT_PARENT_INDENT` (warning)

## [0.17.0] - 2026-05-21

### ⚠ BREAKING: Sequence participant types trimmed from 9 → 4 + default

The sequence diagram retains only the types whose shape carries semantic
weight at a glance:

| Kept type | Shape |
|-----------|-------|
| `actor` | Stick figure |
| `database` | Vertical cylinder |
| `cache` | Dashed vertical cylinder |
| `queue` | Horizontal pipe |
| _default_ | Plain rectangle (used when `is a` is omitted) |

The keywords `service`, `frontend`, `networking`, `gateway`, and `external`
were **removed** — using any of them in `is a X` is a hard parse error
(`E_PARTICIPANT_TYPE_REMOVED`), one diagnostic per offending line.

```dgmo
sequence
Auth is a service       // E_PARTICIPANT_TYPE_REMOVED — drop the override
WebApp is a frontend    // E_PARTICIPANT_TYPE_REMOVED
LB is a networking      // E_PARTICIPANT_TYPE_REMOVED
API is a gateway        // E_PARTICIPANT_TYPE_REMOVED
Stripe is an external   // E_PARTICIPANT_TYPE_REMOVED
```

**Inference also shrinks** — the rule table goes from 223 → 82 rules.
Names that previously inferred to a removed type — `AuthService`, `WebApp`,
`Cloudflare`, `API Gateway`, `Stripe`, `Webhook` — now fall through to
the default rectangle. That fall-through is the intended outcome of the
trim: the differentiation went away because the underlying distinction
didn't carry its weight.

**Renderer impact:** 5 D3 helpers deleted (`renderServiceParticipant`,
`renderFrontendParticipant`, `renderNetworkingParticipant`,
`renderExternalParticipant`, `renderGatewayParticipant`) plus their
shape-dispatch switch cases (~200 lines).

**Sequence-only scope** — `external` / `database` / `cache` / `queue`
remain valid in C4, infra, and org diagrams under their own taxonomies.

#### Known breakage surfaces

Pre-existing share URLs (`online.diagrammo.app`) and third-party MDX
content via `remark-dgmo` / `astro-dgmo` / `docusaurus-plugin-dgmo` /
`fumadocs-dgmo` will surface the parse error once those wrappers
upgrade to `^0.17.0`. Share URLs do not pin a dgmo version.

#### Migration

Drop the `is a {removed-type}` override — the participant renders as
the default rectangle:

```dgmo
// Before
Auth is a service
WebApp is a frontend

// After
Auth
WebApp
```

#### Public API

- `ParticipantType` union narrowed to `'default' | 'database' | 'actor' | 'queue' | 'cache'`. Re-exported via `@diagrammo/dgmo/advanced`. Consumers that read the literal string values must update.
- `RULE_COUNT` (`participant-inference`) drops to 82 (was 223).
- `NAME_DIAGNOSTIC_CODES.PARTICIPANT_TYPE_REMOVED` and `participantTypeRemovedMessage(type)` added to `@diagrammo/dgmo/advanced`.
- `SERVICE_BORDER_RADIUS` renderer constant removed (was unused outside the deleted `renderServiceParticipant`).

## [0.16.0] - 2026-05-20

### ⚠ BREAKING: Universal trailing-token color syntax

Color is now the **trailing whitespace-delimited token** of a label region
(case-sensitive lowercase, matching one of 11 palette names: `red, orange,
yellow, green, blue, purple, teal, cyan, gray, black, white`). The old
`Label(color)` parens form is gone — parens are now literal label text.

```dgmo
Done(green)             →  Done green
[Done](green)           →  [Done] green
Swordsmanship(red) as s →  Swordsmanship red as s
era 1718 -> 1720 Foo(red) → era 1718 -> 1720 Foo red
```

**The label region** is whatever the parser hands to the color rule after
stripping its own structural terminators (`as <alias>`, `| pipe`, numeric
values, date ranges, brackets, arrow constructs). This applies uniformly
across every chart type that carries color in label position.

**Capitalize to escape**: `Red`, `Yellow`, `Green` stay as literal labels
— useful for traffic-light tag groups that want the color word as the
name itself.

**The 11-name palette is now a frozen public contract.** Adding a 12th
color name in any future release is itself a breaking grammar change
requiring a major version bump, because any user diagram with the new
word as a label would silently change behavior.

#### Edge color removed (flowchart, state, sitemap)

Edges on these three chart types no longer have a color slot. `A -(red)-> B`
parses as a label `(red)`; `A -yes-> B` and `A -no-> B` no longer auto-color
the arrow. All edges render with the default theme color. To color a *node*,
use tags. Sankey/chord links are the one exception — they carry data, so a
trailing color word after the numeric flow value colors the link
(`Source -> Target 3000 red`).

The `inferArrowColor()` function (label-semantic `yes→green`, `no→red`,
`maybe→orange`) and `matchColorParens()` helper are both deleted; their
`@diagrammo/dgmo/advanced` re-exports are gone.

#### Cycle / pyramid / ring / RACI / boxes-and-lines: pipe-shortcut

These five chart types pair the universal trailing-token form with their
existing `| color: <name>` pipe-metadata long form. Both produce the same
AST; the trailing-token form is a shortcut when color is the sole metadata:

```dgmo
Spring green                       // shortcut
Spring | color: green              // long form (equivalent)
Spring | color: green, icon: ❄     // long form REQUIRED when other keys
```

#### Accepted tradeoffs

- **No typo diagnostics**: `Done grren` parses silently as a 2-word label
  with no color. Internal corpus has a near-miss smoke test; user content
  gets no help.
- **Case-sensitivity is the escape hatch**: only lowercase recognized.
- **Lezer grammar** drops the `ColorAnnotation` token; trailing color
  words now tokenize as plain `Identifier` nodes.

### Changed

- **Static exports hide collapsed tag-group pills and the gear/cog control.**
  When a diagram is exported (PNG / SVG / PDF) via the desktop or web app,
  the legend now shows only the active tag-group capsule centered above the
  diagram. Collapsed group pills, interactive toggles, and the cog disappear
  — they convey no meaning in a static image. Interactive previews and
  shared `online.diagrammo.app` views are unchanged. The dgmo CLI also
  preserves the full legend by default; pass `exportMode: true` to
  `renderForExport()` for static-export semantics.

### Breaking changes (Type API)

- `LegendMode` literal values changed from `'fixed' | 'inline'` to
  `'preview' | 'export'`. Re-exported via `@diagrammo/dgmo/advanced`.
  Audited workspace-internal consumers (`obsidian-dgmo`,
  `diagrammo_app_site`, `remark-dgmo`, `astro-dgmo`,
  `docusaurus-plugin-dgmo`, `fumadocs-dgmo`) — zero direct usages. External
  npm consumers that read `LegendMode` literal values directly will need
  to update.
- `matchColorParens()` and `inferArrowColor()` removed from
  `@diagrammo/dgmo/advanced`. External consumers that imported them must
  drop the calls — edges no longer carry color, and `(color)` parens are
  no longer recognized.
- `GraphEdge.color`, `SitemapEdge.color`, `LayoutEdge.color` (sitemap +
  graph) fields removed from public types.

## [0.8.23] - 2026-04-22

### Added

- Pyramid diagram type — stacked hierarchy with descriptions, auto-alternating columns when content overflows, per-layer colored accent bars, and `inverted` directive for funnel orientation. Source order reads apex-first (file top = visual top).

## [0.8.22] - 2026-04-21

### Added

- Journey-map diagram type with emotion curves, thought bubbles, score faces, and lucide icons
- Cycle diagram type with canvas-aware label fitting and circle-nodes option
- Tech-radar diagram type with interactive quadrant focus, ring hover, popovers, and multi-page PDF export
- Universal node descriptions for infra, sitemap, mindmap, C4, and boxes-and-lines
- Numeric separator support (commas and underscores) in all data charts
- Collapsible groups for state diagrams
- 2-level nested group support for boxes-and-lines
- Text wrapping for mindmap node labels
- Click-to-lock on journey-map y-axis score faces
- Ring section syntax and aliases for tech-radar

### Changed

- Remove `(color)` suffix from node labels and drop explicit `alias` keyword
- Smaller ECharts bundle via selective modular imports
- Remove branding feature (`injectBranding` and `--branding` CLI flag)
- Remove mermaid quadrant parser and theme bridge
- Enrich `render()` return type with diagnostics and common-mistake detection

### Fixed

- Sequence diagram conditional label spacing
- Kanban export columns now show counts, swimlanes do not
- B&L group-to-group shorthand edges and layout alignment
- Note bullet wrapping no longer splits prefix from content
- Sequence note-message collision in collapsed group views
- Funnel chart gap removal between levels
- Group label spacing, collapse, and edge curves in boxes-and-lines
- Color `mix()` calls corrected to use percent 0-100 instead of decimal 0-1

## [0.8.19] - 2026-04-10

### Added

- Wireframe diagram type with visual-mnemonic syntax, depth shading, and group label toggle
- Mindmap diagram type with two-sided horizontal tree layout and depth-colors
- Collapsible sequence diagram groups with legend controls
- CompactViewState and `vs=` URL encoding for view state sharing
- Sprint duration unit and timeline bands for Gantt charts
- Interactive view state threaded through all export paths
- Stroke halo on sequence message labels for legibility
- Export `mix()` from public API for app color blending

### Changed

- Hide inactive legend pills in exports
- Skip SVG title in live preview (rendered in HTML instead)

### Fixed

- Expand toggle on sequence participant wrapper
- Section positioning when collapse projection is active
- Legend capsule overflow when entries barely fit single row
- Collapsed sitemap containers rendering smaller than sibling page cards
- Wireframe depth shading contrast and fill colors

## [0.8.17] - 2026-04-08

### Added

- Kanban tag-group swimlanes
- Boxes-and-lines diagram type with groups, collapse/expand, shape-mode legend, and render mode override
- Group-to-group and node-to-group linking for sitemap and boxes-and-lines
- Lezer grammar for DGMO syntax highlighting (`@diagrammo/dgmo/editor`)
- Cross-platform DGMO syntax highlighting and CLI `cat` command
- Catch-all diagnostics for unrecognized lines across all parsers
- Spec conformance test suite
- ESLint, Prettier, cspell, and pre-commit hooks
- Share link payload now includes optional filename
- Line number tracking for else/else-if block dividers in sequence diagrams

### Changed

- Standardize directive naming and remove deprecated colons
- Remove colon syntax from quadrant directives/data and arc link weights
- Change flowchart default direction from LR to TB
- Default bar charts to vertical bars, add `orientation-horizontal`
- Restrict color suffixes to 11 named colors with inline diagnostics
- Share URL base changed to online.diagrammo.app
- Centralize legend rendering across all D3 chart types
- Heatmap labels moved to top, smart rotation on overlap
- Sankey node/link colors tinted for softer appearance
- Quadrant chart label collision avoidance
- Upgrade TypeScript to 6.0, dagre to 3.0, jsdom to 29

### Fixed

- ER indented relationship regex for double-dash unlabeled form
- Gantt freeze when typing partial start date
- Horizontal bar chart ordering and label layout
- Data row parser consuming label numbers as values
- ER relationship cardinality tokenization
- Symbol extractors handling multi-word arrow labels
- Legend positioning for kanban and timeline
- Pie/doughnut/polar-area radius to prevent label truncation

### Removed

- Blue emphasis effects (replaced with dim-only highlight approach)
- ECharts tooltips from all data charts
- Zoom/pan on chord diagrams

## [0.8.0] - 2026-03-27

### Added

- Gantt chart type with scheduler, dependency arrows, critical path, tag swimlanes, hover interactivity, markers, eras, and uncertainty fade
- Editor autocomplete with completion registry, chart types, and symbol extractors
- Scatter group emphasis and cursor-driven era highlighting
- Directed/undirected chord links
- Line number tracking for xlabel, ylabel, series, eras, markers, dependencies, and tags
- Prominent emphasis styling for line/area chart points
- Dracula and Monokai color palettes
- Interactive Type legend for class diagrams
- Interactive Status legend for initiative-status diagrams
- Collapsible tag lanes with `sort:tag` directive for Gantt

### Changed

- Centralize legend rendering with shared SVG generator
- Legends moved to top placement across all diagram types
- Remove colons from org `tags`/`import` and C4 `import` directives
- Migrate all docs, gallery fixtures, and test fixtures to colon-free DSL syntax
- Scale Gantt and timeline diagrams to fit the view area
- Make whitespace optional around all arrow operators
- Remove branding watermark from exports by default
- Enforce single pipe delimiter for metadata across all parsers

### Fixed

- Scatter label collision avoidance and legend centering
- Comma-grouped number false merge and timeline era/marker colon handling
- Infra playback control speed multiplier
- Timeline bar stroke fade on ambiguous-end events
- Bar chart x-axis label crowding on dense datasets

### Removed

- Framework name leakage (ECharts/D3) from public API

## [0.6.3] - 2026-03-21

### Added

- Claude Code skill integration (`--install-claude-code-integration`)
- Codex CLI integration (`--install-codex-integration`)
- Multi-diagram symbol extraction API for editor completions
- ER diagram semantic entity coloring and layout overhaul
- Claude Code `/dgmo` skill with editing, validation, and code-to-diagram

### Changed

- Muted fill + solid outline style for all filled chart types
- Standardize legend as fixed overlay across all diagram types
- Improved infra edge routing with port ordering and collision avoidance

### Fixed

- Space-containing participant names in sequence parser
- ER diagram render stagger (pre-compute layout dimensions)
- C4 fixed overlay legend, sitemap bottom legend, infra tag groups
- Line/area chart x-axis label crowding on dense datasets

## [0.5.5] - 2026-03-12

### Added

- Tag-based swimlanes for timeline diagrams
- Universal `[Group]` syntax and tag groups for ER/timeline
- SLO threshold system for infra diagrams
- Fan-out multiplier for infra diagram connections
- Eye icon visibility toggle for org chart legend
- Palette + theme encoding in share URLs
- Venn diagram DSL redesign with highlight behavior
- Infra multi-expand layout support

### Fixed

- Initiative-status back-edge arrowheads and Y-displaced edge crossings
- Resolver dropping header lines with trailing whitespace
- Collapsed group latency using critical-path instead of child sum
- Infra diagram group collision with post-layout separation pass

## [0.4.4] - 2026-03-08

### Added

- Infra diagram type with compute engine, collapse, SLO thresholds, and system-wide metrics
- Sitemap diagram type with fixed legend, eye icons, and tag hover
- State diagram type with indent-based source inference
- Tag system for sequence diagrams
- C4 architecture diagrams (context, container, component, deployment levels with drill-down)
- Initiative-status diagram type with grid layout, containment groups, and shape inference
- Kanban board diagram type with parser, renderer, and mutations
- Sankey diagram indentation-based syntax with color annotations
- Tag group block syntax (`tag:`)
- Share URL encoding with query param and hash fragment
- Collapsible groups persisted in share URLs

### Changed

- Sequence arrow syntax v2: labeled calls and return arrows
- Remove left-arrow support (only forward arrows allowed)
- Standardize `//` as the only comment syntax across all parsers
- Universal arrow syntax and symbolic-only ER cardinality

### Fixed

- Slope chart label overflow and collision resolution
- Bar chart x-axis label collisions and ylabel spacing
- Note overlapping return arrow in sequence diagrams
- Collapsed group uptime/latency mismatch with diagram defaults

## [0.2.24] - 2026-02-27

### Added

- Org chart with import resolution, tag metadata, and legend
- Class diagrams with inline extends/implements and UML 3-compartment layout
- Timeline diagrams with eras, markers, and uncertain end dates
- Flowchart rendering
- Multi-line indented value syntax for chart properties
- CamelCase-aware text fitting and Staff actor inference
- CLI `--json` and `--chart-types` flags
- DSL language reference documentation

## [0.2.0] - 2026-02-10

### Added

- Initial release of `@diagrammo/dgmo`
- Sequence diagram parser and renderer with collapsible sections
- Data chart support (bar, line, area, pie, doughnut, radar, polar-area, funnel, scatter, heatmap, wordcloud, slope, arc, venn, quadrant)
- CLI for rendering `.dgmo` files to SVG and PNG
- 10 color palettes (bold, catppuccin, dracula, gruvbox, monokai, nord, one-dark, rose-pine, solarized, tokyo-night)
- ECharts SSR rendering
- Homebrew tap support

[0.8.22]: https://github.com/diagrammo/dgmo/compare/v0.8.19...HEAD
[0.8.19]: https://github.com/diagrammo/dgmo/compare/v0.8.17...v0.8.19
[0.8.17]: https://github.com/diagrammo/dgmo/compare/v0.8.0...v0.8.17
[0.8.0]: https://github.com/diagrammo/dgmo/compare/v0.6.3...v0.8.0
[0.6.3]: https://github.com/diagrammo/dgmo/compare/v0.5.5...v0.6.3
[0.5.5]: https://github.com/diagrammo/dgmo/compare/v0.4.4...v0.5.5
[0.4.4]: https://github.com/diagrammo/dgmo/compare/v0.2.24...v0.4.4
[0.2.24]: https://github.com/diagrammo/dgmo/compare/v0.2.0...v0.2.24
[0.2.0]: https://github.com/diagrammo/dgmo/releases/tag/v0.2.0

### Changed

- **Sitemap: hovering a card lights the card, every edge touching it and every
  card at the other end, in or out** (#2312). A section or the root also
  lights the pages under it; the rest dims. Each card carries the list in
  `data-neighbors`, and the exported SVG's baked hover CSS dims by it too.
- **Sitemap: cards no longer show a chip for the active colour group**
  (#2312). The card colour already shows that value, so the legend's eye
  toggle is gone; `hide` in source still hides any group's chips.
- **Kanban: cards no longer show a chip for the swimlane group or the active
  colour group** (#2311). The lane and the card colour already show those
  values. The `compactMeta` render option and the `cm` view-state field are
  removed.
- **Bar and line: `facet N` sets the panels per row** (#2306). The count rides
  on the `facet` line; the separate `columns N` line no longer applies to bar
  and line charts. Bare `facet` still fits as many panels as the width holds.
  `columns` stays for block and heatmap.

### Added

- **Boxes-and-lines: a `maxScale` render option, so folding a group keeps the
  text size (diagrammo/diagrammo#2062).** A fold shrinks the layout, and the
  fit-to-pane scale grew to fill the pane. `renderBoxesAndLines` now takes
  `maxScale` (the fit still wins when it is smaller) and writes the scale it
  drew to the root `<svg>` as `data-scale` (live renders only; export output
  is unchanged). Rubric rule 7, sibling frames sharing an edge, is now
  blocking in the layout ratchet at its current count.

- **Bar: plain names flip horizontal at any count rather than thin
  (diagrammo/diagrammo#2271).** A vertical bar axis of plain names that would
  drop or cut a name now draws horizontal bars with every name, and the
  drawing grows taller than its host when the rows need it. Dates and other
  ordered names still thin. A new `orientation-vertical` directive keeps the
  columns, thinned as before.

- **Bar and line: small multiples, a bare `facet` flag
  (diagrammo/diagrammo#1853).** Each series gets its own panel, in
  declaration order, in a grid under one title block, headed by its name in
  its colour, with no legend. Panels share one value axis; `facet-free-y`
  gives each its own range. A line panel draws the other series in grey
  behind its own (`no-context` turns that off). `columns N` sets the grid
  width. `stack`, `mirror`, a right axis, `mark:`, a series `band` and
  `fill-between` are errors beside `facet`.

- **Venn `proportional`: circle and overlap areas follow the counts
  (diagrammo/diagrammo#1992).** Each set and overlap line takes a `size:`
  (`Frontend as fe blue size: 40`, `fe + be Web Systems size: 12`). Two sets
  are exact; three sets are approximate where the all-sets count cannot also
  fit. A line with no size warns and draws at equal size; sizes without the
  flag warn once. Pair leader lines now start where the two circles cross on
  the outer edge, so no leader or set-name stub crosses a circle, with or
  without the flag; the all-sets leader still runs from its centre.

- **A time axis for date-times, bare times, bars and scatter, and a break
  across gaps (diagrammo/diagrammo#2208).** Line labels may now be
  `YYYY-MM-DD HH:MM[:SS]`, `YYYY-MM-DDTHH:MM[:SS]` or, when every row is one,
  a bare `HH:MM[:SS]` that runs on past midnight. Ticks go down to hours and
  minutes. On a time axis a gap longer than three median intervals breaks the
  line, area, stacked area, band and fill-between; `join-gaps` keeps it joined
  and step lines always hold. Vertical bars and `mark: bar` series stand at
  their time, 70% of the smallest interval wide. Scatter takes a time x
  (`Deploy 2026-11-21 06:30, 12`). A mostly-dated column that falls back to
  categories warns (`W_TIME_AXIS_MIXED`).

- **Boxes-and-lines: a direction per group (diagrammo/diagrammo#2001).** A
  `direction-tb` or `direction-lr` line indented inside a `[Group]` lays out
  that group's members on that axis, while the rest of the diagram keeps its
  own: a stack of checks inside a left-to-right release flow, for example.
  The group is laid out on its own and placed as one block, and lines to or
  from its members end on the member they name. Before this the indented line
  became a box called `direction-tb`.

- **A number format per axis — the indented axis block
  (diagrammo/diagrammo#2116).** Indent `format`, `unit` or `locale` under an
  `x-axis` / `y-axis` / `y-right-axis` line to set that axis only: dollars on
  the left of a dual-axis line and barrels on the right, or a formatted x on
  scatter and function, whose x otherwise prints plain. A child replaces only
  its own part of the chart-wide format. A word unit on its own axis goes on
  that axis's title, and the generated description gives each axis its own
  range. A block on an axis that prints no numbers, or an indented line that
  is not a setting, warns (`W_AXIS_SETTING_INVALID`).

- **A canvas size in the file — `size WxH` and `aspect W:H`
  (diagrammo/diagrammo#1966).** `size 1200x675` is the same as
  `--width 1200 --height 675`, on every chart type; `aspect 16:9` sets the
  height from the width (the caller's, else 1200). A caller's `--width` or
  `--height` beats the file's line, one dimension at a time. A bad value, or a
  second `size` / `aspect` line, is the error `E_CANVAS_SIZE_INVALID` on that
  line. On a wordcloud, `size <min> <max>` is still the word-size range; only
  `size WxH` is the canvas there. No named presets (decided 2026-11-13).

- **A warning for arrow spellings borrowed from Mermaid — `W_BORROWED_ARROW`
  (diagrammo/diagrammo#2174).** `-->`, `-.->`, `==>`, `---`, `..>` (outside
  `class`) and `-dashed->` are not dgmo arrows. They used to draw a wrong
  diagram with no diagnostic: on boxes-and-lines `A --> B` made a box named
  "A -" and `A -.-> B` an edge labelled ".". Each now warns on every chart type
  whose edges are `->`, and the message writes the corrected line. dgmo has no
  dashed-edge style; a label or a tag colour carries the distinction.

- **bar: combo lines over bars — `mark: line | step` on a series
  (diagrammo/diagrammo#1852, slice 2).** In a bar chart's `stack` or `group`
  block, `mark: line` or `mark: step` draws that series as a line over the
  bars, left out of the stack or cluster. The block takes the grouped
  `y-axis` / `y-right-axis` form, so a line can sit on its own right axis.
  `mark:` is an error under `mirror`, `stack 100%` and `stack diverging`, on
  a Marimekko or clustered stack, on a bar under `y-right-axis`, and when no
  series is left a bar. Replaces slice 1's warn-and-ignore on bar. Other chart
  types now warn when a series carries `mark:`. A `line` combo's band bound
  with `mark: bar` no longer takes a bar slot.
- **treemap: `icicle` — the hierarchy as columns (diagrammo/diagrammo#1857).**
  A bare `icicle` flag draws the same parsed tree as bands: root on the left,
  one equal-width column per depth level, each node's height its share of the
  whole, children in source order. A band too short for its label drops it.
  Tags, `heat` and `no-value` / `no-percent` / `no-legend` carry over;
  `sunburst` plus `icicle` is an error (`E_TREEMAP_LAYOUT_CONFLICT`).
- **line: combo bars and lines — `mark: bar | line | step` on a series
  (diagrammo/diagrammo#1852, slice 1).** A same-line `mark:` key on a series
  line draws that series as bars (side by side within each x slot, under every
  line, on an axis that reaches 0) or as a step line. Works with the dual-axis
  `series` form; the legend swatch shows each mark. `mark:` on a stacked area
  is an error.
- **histogram: a new chart type — raw numbers counted into bins
  (diagrammo/diagrammo#1847).** Bare numbers in, bins out. The bin width is
  Freedman–Diaconis by default, rounded to 1, 2, 2.5 or 5 × 10ⁿ; `bin-width`,
  `bins N` and `bin-start` override it. `[Name] color` groups share one set of
  bins and overlay as translucent fills. `percent`, `mean` and `median` work,
  and pre-counted `lo-hi count` rows draw true to area.
- **bar: `mirror` — a butterfly / population pyramid (diagrammo/diagrammo#1878).**
  A third layout header beside `stack` and `group`: exactly two series drawn
  back to back on one shared scale, category names in a centre gutter.

- **boxplot: a new chart type for spread and outliers per group (#1848).**
  Free numbers under `[Group]` headers, the histogram's input. One Tukey box
  per group: Q1–Q3 by linear interpolation (QUARTILE.INC, R type 7), the
  median a thicker line, whiskers to the last value within 1.5 × IQR, and
  hollow outlier dots beyond. `n = …` is always printed under the group name.
  One colour for every box unless a header names one. `points` draws every
  value beside its box, spread by a fixed hash; `mean` a hollow diamond;
  `orientation-horizontal` lays the groups down the left. Diagnostics:
  `E_BOXPLOT_NOT_A_NUMBER`, `W_BOXPLOT_EMPTY_GROUP`, `W_BOXPLOT_FEW_VALUES`.
- **Tag mode on the calendar heatmap — year in pixels (diagrammo/diagrammo#1855,
  #1877).** Declare a `tag` group, then write a tag value in place of the
  number (`01-01 Great`): each day takes that value's colour, an empty day is
  "Not logged", and the legend lists the values. The summary reads `212 days
logged · most often Great`. Diagnostics: `E_CALENDAR_HEATMAP_UNKNOWN_TAG`,
  `E_CALENDAR_HEATMAP_MIXED_ENTRIES` (numbers and tags in one chart),
  `W_CALENDAR_HEATMAP_DUPLICATE_TAG_DAY`.
- **Statistics overlays on bar and line (#1954).** Bare `mean` and `median`
  draw a dashed and a dotted line at the value computed from the chart's data,
  labelled at its right end in its colour (`mean 441`), one per series on a
  multi-series chart. `target N` draws a line at N and lights the bars or
  points that reach it, greying the rest; `target N below` makes at or under
  N the good side. No legend entry. Diagnostics: `W_OVERLAY_UNKNOWN`
  (`average`, `mode`, a misspelling), `W_OVERLAY_UNSUPPORTED` (pie, stacked
  charts), `E_OVERLAY_BAD_N`.
- **`trend` on bar, line and scatter (#1954).** A dashed least-squares line
  per series, labelled with its slope per x step (`trend +1.68/step`, the
  step named by a one-word `x-label`). On scatter, one line per `[Category]`
  labelled with its R² (`Mentored R² 0.95`).
- **`moving-average N` and `extremes` on line (#1954).** `moving-average 3`
  draws each series' trailing 3-point average in its colour, heavier than the
  raw line, which stays and is drawn thinner (`3-pt avg`, or `3-week avg`
  with `x-label Week`). `extremes` puts a filled marker on each series'
  highest and lowest point, labelled `peak 41 Jul` and `low 19 Jan`.
- **`pareto` on a single-series bar (#1954).** Sorts the bars largest first
  and adds the cumulative share as a line on a right 0–100% axis, with a
  dashed 80% guide. On a `stack` or `group` it is an error,
  `E_OVERLAY_PARETO_SERIES`.
- **Theme style: `radius`, `stroke-weight` and `background` on a custom
  palette (#1836).** An embedded `palette` block takes `radius 0` (px for a
  standard card corner; every corner scales with it), `stroke-weight 1` (px
  for a standard line; every line but a text halo scales with it) and
  `background transparent` (no canvas, the mode's own ink). A theme-folder
  file spells them `radius`, `strokeWeight`, `background`. Absent, the output
  is byte-identical. A file pinned `dark` and rendered `transparent` now draws
  the dark colours with no canvas, so a transparent export can carry light ink
  for a dark slide. `applyThemeStyle` is exported from `/advanced` for hosts
  that draw with the per-type renderers.
- **`ownership`, a corporate entity structure chart (#1873).** Write the group
  as an indented tree with the stake first (`100% Acme Inc`), a cross-holding
  or an outside owner's stake as `10% -> Acme GmbH`, and the jurisdiction as a
  tag group that colours the boxes. `type:` picks the shape: corporation,
  partnership (triangle), individual (oval) or trust (double outline). Owners
  outside the group draw dashed. Lines are orthogonal, one trunk and one run
  per owner, with the stake in a pill next to the owned entity; the layout
  searches for the order with the fewest crossings, and a crossing the
  structure forces is reported as `W_OWNERSHIP_FORCED_CROSSING`. Hovering an
  entity lights its chain of owners and shows its effective ownership summed
  across every path. New diagnostics: over 100%, unknown entity (with a
  did-you-mean), cycle, and eight more in the language reference (§25D).
- **`W_CANVAS_HEIGHT_IGNORED`, and the list of chart types that take an exact
  size (#1965).** With a width and a height both requested, a chart type that
  sizes itself from its content (flowchart, org, sequence, map and the rest)
  stays tight to its content as before, and now warns that the height was not
  applied instead of ignoring it in silence. No chart type pads its output to
  reach the box. The language reference (§1.15) lists the twenty chart types
  that come back at exactly the requested width and height, and a test holds
  that list to what every gallery fixture renders.
- **goal bands: an optional `bands` block (#1973).** Indented lines
  `N [Label] [colour]` name zones; `N` may be a percent of `target`, and each
  edge is where a band starts. The fill takes the colour of the band the
  actual sits in, a 5px ribbon maps the zones on all three faces (below the
  bar, left of the thermometer, outside the gauge), and the readout reads
  `64% · OK`. Colours default to a red-to-green traffic light by position. A
  last line with only a number closes the scale past the target, which then
  draws as a dark tick. New flags `no-ribbon` and `no-ribbon-labels`. A goal
  with no `bands` block renders exactly as before.
- **goal bullet chart: `[Measure]` rows (#1851).** Each header starts a row
  with its own `actual`, `target` and optional `bands`; a top-level `bands`
  and `target` apply to rows without their own. The bar face draws one row
  per measure (name, bar, ribbon, `/ target`, readout); thermometer and gauge
  draw cells, four to a row. `shared-scale` puts every row on one scale.
- **calendar-heatmap: a new chart type for daily values (#1855).** One
  `date value` line per day draws a grid of squares — one column per week,
  seven weekday rows, week one holding the span's first day — with month
  names above and Mon, Wed and Fri down the side. A date is `YYYY-MM-DD`, or
  `MM-DD` under `year YYYY`; a date not listed is zero and a date listed twice
  adds up. `year` draws the whole year, `from … to …` trims it, and with
  neither the chart spans the dates given; a short span draws bigger squares.
  Five shades: grey for zero, then four equal-count bands of the days with a
  value, or four equal ranges up to `max N`. A Less … More legend sits bottom
  right (`no-legend`). The subtitle line shows the total and the busiest day
  unless a `subtitle` is written or `no-summary` is set. `unit <noun>` names
  what a value counts; `week-start monday` moves Monday to the top row. On
  screen each day shows its value, unit and full weekday date on hover and
  focus, and Tab moves along the days. The tag mode (year in pixels), the
  guide page and examples in dgmo-content and the language-spec section follow.
- **mindmap radial layout: the bare `radial` flag (#1843).** A line
  `radial` before the content puts the root at the centre and each depth on
  a ring around it. Every branch gets a share of the turn in proportion to
  its leaf count, so one dominant trunk spreads its children around the root
  instead of stacking them in one tall column. Edges leave a node along its
  own angle, follow a clear band between two rings, and drop out to the
  child, so no edge crosses a node of another branch. The whole picture
  is turned to its most compact angle. Without the flag the two-sided
  layout is unchanged. Pre-1.0 syntax: a root node literally named `radial` before
  any content would now be read as the flag.
- **boxes-and-lines invisible lines: `A ~~ B` (#2002).** A line at column 0
  written `A ~~ B` ranks and orders `B` after `A` as `A -> B` would, but is
  never routed, scored or drawn, so a box can be pushed one rank on without
  drawing a connection. It names boxes only and never creates one; an unknown
  name, a group or a self-loop is warned and the line ignored. It counts as a
  line for `same-rank`, and, like a rank hint, hands the diagram to the dagre
  engine. Completion offers box names after `~~`. Pre-1.0 syntax: a box
  literally named `A ~~ B` would now be read as an invisible line.
- **boxes-and-lines rank hints: `same-rank` and `order` (#1840).** When the
  auto-layout puts two boxes on different ranks, `same-rank A, B, …` lays them
  out on one (one column in `LR`, one row in `TB`), across groups too.
  `order A, B, …` keeps boxes that share a rank and a group in that order
  across it; pair the two to pin both. Hints name boxes only and never create
  one; an unknown name or a group is warned and left out, and a `same-rank` set
  whose members are already joined by a path is ignored with a warning. A
  hinted diagram is laid out by the dagre engine alone, with its own ranker,
  so adding a hint can move boxes it does not name. `order` needs its comma, so
  a box named `order queue` stays a box. Pre-1.0 syntax: a box literally named
  `same-rank A, B` would now be read as a hint.
- **CLI `-o file.svg` embeds the Inter it uses (#1834).** An exported SVG
  named Inter and carried none of it, so on a machine without Inter every
  label fell back to another face and its measured width was wrong. The file
  now carries Inter Regular (and Bold, when the diagram uses bold) as base64
  WOFF2 `@font-face` rules, subset to the characters its own text draws. In a
  browser with no Inter installed, 106 of the 107 gallery fixtures now draw
  every text element at the same width as with Inter. It adds 3-53 KB per
  file (37 KB on average). `@diagrammo/dgmo-cli` gains the `subset-font`
  dependency. PNG, PDF and the library's `render()` are unchanged. Each
  embedded face keeps Inter's copyright notice and its SIL Open Font License
  in its name table. Not yet done: the app's SVG export, which still names
  Inter without embedding it.
- **CLI `--outline-text` writes an SVG's labels as paths (#1834).** For print
  and vector editors: every text element becomes filled outlines shaped from
  the same bundled Inter the PNG uses, so the file needs no font at all and
  carries no `@font-face`. The text can no longer be selected, searched or
  edited, and the file is rewritten in a simplified form: styles are resolved
  onto each element, and `<title>` and links are dropped. Emoji are dropped
  with a warning, as in a PNG. With PNG or PDF output the flag warns and does
  nothing.
- **CLI `--scale <n>` sets the PNG's pixel density (#1833).** PNG export was
  fixed at 2x; it is still the default. `--scale 3` turns a 1200x800 canvas
  into a 3600x2400 PNG, `--scale 1` into a 1200x800 one, and fractions work.
  The layout does not change. With an `.svg` output the flag warns and the
  SVG is unchanged. A scale whose image would pass 16384 x 16384 pixels exits
  1 naming the largest scale that fits, where `--scale 1e6` used to abort
  inside resvg with no message.
- **CLI `-o file.pdf` writes a PDF (#1833).** A `.pdf` output path used to
  get PNG bytes under a `.pdf` name. It is now a one-page PDF the size of the
  canvas at 96 dpi (a 1200x800 canvas is a 900x600 pt page), holding the
  diagram as one image at `--scale` pixels per canvas pixel (default 2), the
  same shape as the app's PDF export. A transparent theme warns and draws on
  the light background.
- **`highlight` on `scatter`, `slope` and `treemap` (#1829).** A scatter
  takes a point or a category name, a slope a series, and a treemap a node:
  naming a branch keeps everything inside it. The rest recedes at reduced
  opacity and keeps its colour, as on `bar`, `line` and `pie`.
- **`highlight` on `bar`, `line` and `pie` (#1829).** `highlight Nassau` (or
  a comma list) keeps the named categories, series or slices at full strength
  and recedes the rest at reduced opacity; a receded element keeps its colour.
  On a stacked or grouped bar a series name works too. Documented once, in the
  language reference's new §1.13, with the other chart types that take it.
- **Chart frame: `subtitle`, `source`, `footnote` and `byline` on every
  chart type.** A subtitle draws under the title; footnotes (repeatable), a
  `Source: …` line and a byline draw under the chart, in that order, in one
  type scale (title 20 > subtitle 15 > body 13 > footer 11). One shared
  component places them on every chart, following the title's alignment. A
  chart that sizes itself grows by the frame; at a size the caller sets, the
  drawing shrinks to make room. PERT's project summary line now sits in the
  frame's subtitle slot, in its type, and an authored `subtitle` replaces it
  (#1827).
  - **Breaking:** a lowercase `subtitle …`, `source …`, `footnote …` or
    `byline …` line starting in column 1 is now the directive in every chart
    type, not a data row, node, task or participant. Capitalise the name
    (`Source 12`, a node `Footnote`) to keep it as content.
  - **Breaking:** the footer note is spelled `footnote`, not `note`, in every
    chart type — the data charts' `note` directive (unreleased) is renamed
    with no alias. `note` stays the note-card element only.
  - **Breaking:** map's `caption` directive is removed with no alias; write
    `source …` or `footnote …` instead.
- **New chart type: `swot`.** A SWOT analysis in four fixed panels:
  strengths and weaknesses on top (internal), opportunities and threats
  below (external), whatever the source order. Each section is a keyword
  line (`strengths`, `weaknesses`, `opportunities`, `threats`) with an
  optional label and colour; items indent under it and take kanban-style
  metadata. `tag`, `active-tag`, `palette`, `x-label`, `y-label`,
  `no-axes` and `no-tint-items` are supported. A tagged row is tinted
  12% of its tag colour. Hovering a panel dims the other three, and a
  legend entry dims the items without its value. `parseSwot` and
  `renderSwot` are exported from `@diagrammo/dgmo/advanced`.
- **`interactiveFolds: false` draws the fold bar without the button.** A new
  option on `render()` and on the block renderer (`renderDgmoBlock` from
  `@diagrammo/dgmo/block`), default `true`. Pass `false` where a click on a
  fold toggle does nothing, such as a docs site that has not turned folding
  on. The SVG then has no toggle cue (pointer cursor, hover highlight, bar
  preview), and its toggles lose `role="button"`, `aria-expanded`, `tabindex`
  and an action-worded label ("Collapse note" reads "Note"). The collapse bar
  on a folded thing stays, with `data-line-number` and the `data-*-toggle`
  attributes. An SVG with no toggle is unchanged.
- **Every foldable chart type now takes a `collapsed` source marker.** Add the
  bare `collapsed` flag (or `collapsed: true`) to a sitemap page or
  `[Container]`, a boxes-and-lines `[Group]`, a timeline `[Lane]`, a
  journey-map or raci `[Phase]`, or the opening line of a multi-line sequence
  note. The thing then starts folded in every render path, with the collapse
  bar: the app, Obsidian, the docs sites, the CLI and every export. A pert
  `[group] collapsed` is now honoured by the export too. Each fold carries the
  full toggle markup (`data-line-number` names the marker's line). New exports
  seed a host's fold state from the source:
  `unionCollapsedSitemapNodes`, `collapsedBLGroupsFromSource`,
  `collapsedPertGroupIdsFromSource`, `collapsedJourneyPhasesFromSource`,
  `collapsedRaciPhasesFromSource` and `collapsedSequenceNoteLinesFromSource`.
  `applyNoteCollapsedMarkerAtLine` writes the note marker. c4 groups take no
  fold: c4 folds by drill level.

- **The four collapse-marker source edits are public exports.**
  `applyCollapsedMarker`, `applyCollapsedMarkerAtLine`,
  `applyGroupHeaderCollapsedMarkerAtLine` and
  `applyIndentedGroupCollapsedMarkerAtLine` add or remove the `collapsed`
  marker on one source line. A host that binds the static SVG's collapse
  toggles writes their result back to its document. They moved here from the
  desktop app so the Obsidian plugin can share them.

### Changed

- **treemap: `radial` is renamed `sunburst` (diagrammo/diagrammo#1857).**
  A breaking rename with no alias: `radial` is now an error
  (`E_TREEMAP_RADIAL_RENAMED`) whose message names `sunburst`. In
  `/advanced`, `renderTreemapRadial*`, `layoutTreemapRadial`, `RadialCell` and
  `RadialLayoutResult` are now `renderTreemapSunburst*`,
  `layoutTreemapSunburst`, `SunburstCell` and `SunburstLayoutResult`;
  `TreemapOptions.radial` is `sunburst`, and the SVG class
  `dgmo-treemap-radial` is `dgmo-treemap-sunburst`.

- **One line per axis (decision #60, diagrammo/diagrammo#2115).** `x-axis`,
  `y-axis` and `y-right-axis` take an axis's title, range and scale on one
  line, every part optional: `y-axis Range (yards) 0.1..100,000 log`,
  `y-axis 0..`, `y-axis log`. They replace `x-label`, `y-label`,
  `y-right-label`, `x-min`, `x-max`, `y-min`, `y-max`, `x-scale`, `y-scale`
  and the function chart's `x 0 to 250` (now `x-axis 0..250`); each old form
  is an error (`E_AXIS_OLD_DIRECTIVE`) naming the line to write. Quadrant and
  SWOT end labels move to `x-axis Low, High`. The dual-axis line's series
  headers become `y-axis` / `y-right-axis` and the right axis now takes its
  own range and scale.

- **A `note`, a `highlight` and a category `marker` sit indented under the row
  they belong to (diagrammo/diagrammo#2078, diagrammo/diagrammo#2080).** On
  bar, line, pie, scatter and slope the row above names the datum, so the line
  no longer repeats it: `Nassau 1100` then `  note Record haul`, or
  `  highlight`. A line's series and a stack or group bar's series take their
  `highlight` under the name in the indented series block; a scatter group
  under its `[Group]` header; a line's series band under its `band` line. A
  note on a row of several series starts with the series (`note APAC …`); on
  slope with the period (`note 2025 …`). Under a numeric category a `marker`
  needs no `x`. The chart-level `note <datum>`, `highlight <name>` and
  category `marker` on these charts warn and show the indented form; nothing
  else changes for the other chart types. Per-export `--highlight` still
  names elements and replaces the indented lines.
- **The advanced types' overlay doc comment lists every overlay** — `mean`,
  `median`, `target`, `trend`, `moving-average`, `extremes`, `pareto`.
- **goal: `now` is renamed `actual` (#1973).** `now` is an error that names
  `actual`. `ParsedGoal` now carries `measures` (one entry for a single goal)
  instead of top-level `now` / `target` / `hasTarget` / `color`.

- **Boxes-and-lines groups nest four deep (#1840).** The cap was two, too
  shallow for account → VPC → subnet → service; a third `[Group]` was dropped
  with a warning. Groups now nest to depth 4, and a fifth level is refused
  with the same warning.

- **`--width` with `--height` comes back exactly that size (#1833).** A
  chart type that lays out onto the canvas — pie, polar area, radar, funnel,
  venn, chord and the radial treemap — was trimmed to its content and scaled
  back up, so only one side matched: `--width 1000 --height 600` gave a pie
  978x600 and a venn 518x600. With both sides asked for, `render()` now keeps
  that canvas, in SVG, PNG and PDF alike. The data charts already did; chart
  types that size themselves from their content (flowchart, org, sequence,
  map and others) are unchanged.
- **`wordcloud` draws every word in one hue (#1931).** Words took the next
  palette colour each, so the hues encoded nothing; size already carries the
  weight. Every word is now the palette's primary, the same default a
  single-series `bar` takes. Gallery `wordcloud` re-baselined.
- **A single-series bar chart draws in one hue.** Every bar used to take the
  next palette colour, so the hues meant nothing and the first bar was red
  whatever its value. Positive bars now take the palette's primary and
  negative bars its red, the diverging hue. A row's own colour, the chart's
  `color` directive and a lone series' colour still win; multi-series bars
  keep one hue per series (#1829).
- **A static render draws its legend as a plain key.** The CLI, `render()`,
  exports and embeds no longer draw the app's interactive legend: no group
  pill, no capsule behind it, no swimlane or eye switch, and no inactive
  group pills. The key is the group's name as a caption, then a swatch and
  the full label per entry, wrapped onto as many rows as it needs — never
  truncated with an ellipsis and never cut to "+N more". A data chart's series
  key has no caption. `render()` now renders with `exportMode` on, as the
  app's export always has. The app's live preview is unchanged.
- **`dgmo install codex` installs the Diagrammo Codex plugin.** It adds the
  `diagrammo/skills` marketplace and installs `diagrammo@diagrammo` — the dgmo
  MCP server and the `dgmo-diagramming` skill in one package — then removes
  the `~/.codex/skills/dgmo-diagramming` copy and `[mcp_servers.dgmo]` entry
  an earlier install wrote. The copied skill never updated, so it kept
  offering chart types dgmo had moved past. Update the plugin with
  `codex plugin marketplace upgrade diagrammo`. `--scope project`, or a Codex
  without `codex plugin`, keeps the file copy.

- **Node notes, org/sitemap containers and the flowchart/state title each
  have one drawer.** Output is byte-identical. Five renderers call
  `renderNodeNote`, org and sitemap call `renderContainerCard`, and
  flowchart and state share `renderGraphTitle`.
- **Sequence participant shapes are drawn from data by one drawer.** Output
  is byte-identical. The cylinder cap sizes are now the shared constants
  `SEQUENCE_CYLINDER_RY` and `SEQUENCE_QUEUE_CAP` in `shape-caps.ts`.
- **A raci phase's toggle is `data-group-toggle`, not `data-section-toggle`.**
  It now matches every other group fold.
- **`applyCollapsedMarker` treats only a `key:` after the label as metadata.**
  Given the parsed label of `Products blue`, it now writes
  `Products blue collapsed: true`. It used to write
  `Products blue, collapsed: true`, which parsed as a page named
  `Products blue,`.

- **`else <label>` in a sequence diagram now parses as `else if <label>`.**
  It was an error, and agents kept writing it even with the language
  reference in context. With no open `if` at that indent it is still an error.
  `else if` with no condition now says so.

### Fixed

- **C4: metadata rows fit their cards** (#2360). Component cards now show
  metadata rows, as the guide says. A container or component drawn as an
  external is sized for its rows. A queue card keeps its name, description and
  rows clear of both end curves, and is one cap width wider.
- **Export: a German (`locale de-DE`) chart exports to PNG again
  (diagrammo/diagrammo#2293).** The number formatter's no-break space was
  serialised as `&nbsp;`, which strict XML rejects; it is now written as
  `&#160;`.
- **`format compact`: a small value keeps its own unit instead of printing as
  `0B` (diagrammo/diagrammo#2294).** The chart still shares one unit, but a value
  that unit would round to zero, or lose more than a quarter of, takes its own:
  `3M` beside `20B`.
- **Boxes-and-lines: an edge into a box under a group title no longer runs
  through the title (diagrammo/diagrammo#2299).** The edge's final drop moves
  sideways to clear the title text, still landing on the box. It was likeliest
  with per-group direction, where a single-column group centres its box under
  the title.
- **Calendar: upright `layout months` over New Year no longer overlaps its
  month headers (diagrammo/diagrammo#2298).** The year now sits on a second
  line under the month name, so "Dec 2026" and "Jan 2027" no longer collide.
- **Calendar: an event-only calendar no longer shows a "Not logged" legend pill
  (diagrammo/diagrammo#2297).** The blank-day entry now appears in a tag
  group's legend only when some day carries that tag.
- **Calendar: a test pins that an export shows only the open group's legend key
  (diagrammo/diagrammo#2296).** A calendar with a `heat` group and a `tag` group
  exports one key by design, and `active-tag` picks which. No renderer change.

- **Waterfall and dot state a word unit once, on the value-axis title
  (diagrammo/diagrammo#2295).** `unit pp` no longer prints `pp` on every tick
  and value label; a symbol unit (`%`) still stays on every number.
- **completion: `tag` stays a metadata key for gantt and infra
  (diagrammo/diagrammo#2290).** Tag entries before the data zone get their
  alias completions again.

- **state: end transitions no longer loop around the whole diagram
  (diagrammo/diagrammo#1891).** `[*]` written as a transition target is now
  its own final state, drawn as a ringed bullseye (UML) and placed by the
  layout after the last state; `[*]` as a source stays the filled start dot.
  One node used to serve both, so every `X -> [*]` was a back edge to the
  first rank. Arrivals into a start or final circle now spread around it
  rather than per box side, and a state export holds text at the 7px floor
  as the flowchart does (#1688).

- **boxes-and-lines, block: a long word wraps instead of ending in "…"
  (diagrammo/diagrammo#2172).** A boxes-and-lines box without a description now
  widens to its widest label word, up to the width of a described box; a word
  wider than that shrinks the font and then breaks at a character, and "…" now
  marks only a label with more lines than the box holds. A block leaf,
  collapsed container or container header wraps onto as many lines as its
  label needs and grows to hold them, instead of cutting the label at the
  cell's width (a span-6 band stopped at about 100 characters).

- **swimlane, heatmap, boxes-and-lines, polar-area, pert, treemap, bar, line,
  er, event-line: nothing rises into the title gap any more
  (diagrammo/diagrammo#2117).** Outside the gallery, ten chart types still put
  ink above the body band or closer than the legend gap: top-down swimlane
  lanes, a heatmap's rotated column labels, a boxes-and-lines note above its
  box or an edge arcing over the top row, a pert or er edge label on an edge
  along the top row, a treemap's 72px names, the first name of a long
  horizontal bar chart, a y-axis title longer than its plot (now ended in `…`
  with the full title on hover), and event-line dots with every card below
  the spine. Each now reserves that ink. The export fit measures an arc by
  the span it sweeps, not its whole circle, so a polar-area export is no
  longer padded for a circle it never draws. The title-gap test now also
  walks `stress/`. Sequence at the maximum `stroke-weight` is left: the theme
  thickens strokes after layout, so the renderer cannot reserve them.

- **line, area: point values and the mean / median / target labels keep off
  the lines (diagrammo/diagrammo#2106).** Point values knew only the point
  dots, so a value printed over the series line on a steep climb and over a
  mean or median line it sat next to; the overlay end labels avoided only
  each other, so "mean 441" printed over the last point. The series lines and
  every overlay line (mean, median, target, trend, moving average) are now
  obstacles: a point value also tries the four diagonals, and is dropped to
  hover when no spot is clear; an overlay label tries the other side of its
  line, then a step farther off, before falling back to being pushed apart.

- **line: hovering a legend entry on a chart with an uncertainty band now
  emphasises it (diagrammo/diagrammo#2099).** With one line and one band the
  legend hover did nothing. Hovering the line now recedes the band, hovering
  the band recedes the line, and leaving restores both.

- **A word unit is stated once, on the value-axis title, not after every
  number (diagrammo/diagrammo#2088).** `unit votes` used to print `100 votes`
  on every tick and bar label, crowding and clipping them. On bar, line,
  scatter, function, boxplot and histogram, a unit that starts with a letter
  now leaves the ticks and labels bare and goes on the value-axis title:
  `Crew votes` stays as written, `Crew` becomes `Crew (votes)`, no title
  becomes `Votes`. Symbol units (`%`, `°`) and axis-less charts are unchanged;
  the generated description keeps `40 votes`.

- **treemap: the heat legend shows the diverging ramp's neutral midpoint
  (diagrammo/diagrammo#1991).** For heat data that crosses zero, the cells run
  red · neutral · green with the neutral at 0, but the legend bar faded red
  straight to green. The bar now draws the ramp's own stops, with the neutral
  at 0's place along it. A `heat` line naming two colours gets its
  neutral midpoint too. A one-sign ramp is unchanged.
- **map: a basemap name no longer sits inside the legend
  (diagrammo/diagrammo#1990).** Country and water names were checked against
  the legend with a box centred on their baseline, so a large name such as
  "Canada" could pass while its letters rose into the legend. The box now
  covers the letters; the name moves to its next spot, or is dropped.
- **bar: notes too crowded for captions become numbered marks with a key.**
  When any bar note finds no clear spot, every note becomes a small numbered
  disc at its bar's end and the text moves to a key under the chart.
- **A crowded bar's note wraps to the bar's width, down to one word
  (diagrammo/diagrammo#2136).** The 64px floor on the caption wrap is now 24px.
- **A line, scatter or slope note's leader keeps off data lines, points and
  other leaders**, not only its text. It falls back to the old rule only when
  no clear spot exists.
- **calendar-heatmap tag mode:** a tag group may come after its entries, a
  declared tag value wins over a number, and an empty day draws as an outlined
  cell so a gray tag reads apart from "Not logged".
- **boxplot:** the top tick sits on the plot's top edge, and the canvas is the
  exact requested size.

- **bar: a note stands above its column, and annotation text is never behind
  a bar (diagrammo/diagrammo#2078).** A note on a column sits over the bar and
  its value label, with room reserved above the plot when the bar is tall,
  instead of ringing the bar's top and running its leader across it; past a
  horizontal bar's end it stands to the right. A `band`'s label moves to a
  clear spot in the band and is drawn over the data with a halo, on every
  chart that takes `band`; an `era`'s title on bar is drawn over the bars.
- **A note keeps its bar through `sort` and the other settle steps.** Notes
  had been resolved to category positions before the bars were reordered.

- **flowchart: a retry loop no longer runs along the edge it returns on
  (diagrammo/diagrammo#2034).** A back edge between nodes in adjacent ranks, such as
  `<OK?> -no-> [Pay]` after `[Pay] -> <OK?>`, now leaves the lower node's side
  and returns as an elbow beside the column (below the row under
  `direction-lr`), with its label on the elbow's leg. It was drawn a few pixels
  from the forward edge, crossing it, with the label between the two. The
  elbow is kept only where no other node is in its way and it adds no
  crossing; back edges that skip ranks keep dagre's route. Gallery fixture
  `flowchart-retry`.

- **mindmap: a long label wraps instead of ending in "…"
  (diagrammo/diagrammo#1843).** A label
  that did not fit three lines at the smallest type was cut with an ellipsis,
  so a 79-character leaf lost its last words. Past three lines the node now
  grows taller, up to eight lines — enough for 80 characters of the widest
  Latin glyph in the narrowest node — and a word wider than the node breaks
  between characters. Only a label longer than that is still cut, with its
  full text in the tooltip. Descriptions keep their two-line cap.

- **infra: split paths that rejoin no longer make compute exponential
  (diagrammo/diagrammo#2026).** Each split that reconverged downstream doubled
  the latency-path list, so a chain of twenty diamonds took about a second and
  a few more never finished. Paths with the same latency, uptime and availability
  now fold into one weighted entry; percentiles and averages are unchanged.

- **A day-scale date axis starting on the 1st of a month drew no ticks.**
  Since the date tick density change (#1830), a gantt, timeline or dated line
  chart spanning up to about three months and starting on the 1st came back
  with an empty axis: the day before the 1st was computed as 31 December of
  the same year instead of the year before, so ticks started a year late.

- **A node or tag value named after a chart type no longer breaks the diagram (#1942).**
  In boxes-and-lines, org, mindmap, kanban and journey-map, a `Family`,
  `Kanban` or `Timeline` line near the top was read as a second chart
  declaration and failed with `Expected chart type ..., got "family"`. Only
  the first content line is the declaration now.

- **A large state, flowchart, class or ER diagram no longer stalls in the
  layout search.** Past 80 nodes plus edges the plain layout is drawn as is,
  without trying and scoring alternative placements, whose crossing count grew
  with the square of the diagram. Smaller diagrams keep the layout they had.
- **State and flowchart curves go around groups they do not belong to.** An
  edge between two states outside a group no longer cuts through that group's
  box: the layout search now counts such passes against a placement, and an
  edge no placement can keep clear is bent around the box's nearest side. In
  the published ship-battle state example, the Combat edges into Losses no
  longer run through Aftermath. This is the first part of the spline-routing
  work (diagrammo/diagrammo#1839).

- **A sankey node or scatter category named `constructor` no longer crashes
  the render.** Node and category colours were kept in a plain object, so a
  name such as `constructor`, `toString` or `__proto__` read an inherited
  member instead of falling back to the palette, and `mix()` threw. The maps
  now have no prototype.
- **Unfolding removes an indented `collapsed: true` line.** `foldAtLine`
  edited only the folded line itself, so in org, sitemap and infra an
  indented marker under a node or `[group]` survived the unfold click and the
  thing stayed folded. Only the immediate child line is removed, never a
  nested node's own marker.
- **An org `[Team]` header takes the bare `collapsed` flag.** A header
  written `[Gun Deck] collapsed` now folds the team, as it does in sitemap and
  c4. A person's line stays colon-form only, since a trailing word could be
  part of a name.
- **The fold cue no longer leaks between diagrams on one page.** The cue's
  `<style>` applied to the whole page, so a dark and a light diagram shared
  the last one's hover step. Its rules are now scoped to
  `[data-dgmo-cue="light"|"dark"]`, which `render()` sets on the SVG root. A
  host inserting `toggleCueCss()` itself sets that attribute (exported as
  `TOGGLE_CUE_ATTR` from `@diagrammo/dgmo/advanced`) on the diagram's
  container.
- **The editor colours a chart-specific keyword only in its own chart type.**
  A word like `roles` (raci) or `hours` (clock) was coloured as a keyword in
  every diagram, so a kanban card reading "Review the roles model" showed one
  word in keyword colour. The highlighter now reads the chart type from the
  first line. A diagram whose first line names no chart type is coloured as
  before.

- **A kanban card holds its title in Arabic and at any length.** Arabic text
  is now measured at the width it draws, so a card sized from it no longer
  lets the title run past its edge. A title longer than the card's limit
  ends in `…`, with the full text in its tooltip, instead of widening the
  whole column.

### Fixed

- **Boxes-and-lines: a group's unlinked boxes leave no holes in its grid
  (diagrammo/diagrammo#2062).** A box with no lines now fills the first free
  cell of its group, line by line, so empty cells come only at the end of a
  line and the frame shrinks to fit. A cell an arrow runs through stays
  empty.
- **Boxes-and-lines: sibling group frames line up
  (diagrammo/diagrammo#2062).** A top-level group whose frame shares no side
  with any other now slides across the flow, with everything in it, until its
  top or bottom (left or right under `direction TB`) meets another frame's.
  A move is kept only when it adds no crossing, overlap, box an arrow runs
  through, or unplaced label. Folding or unfolding a group still moves
  nothing.
- **Boxes-and-lines: folding a group no longer leaves an arrow through a box
  (diagrammo/diagrammo#2062).** When a fold keeps every box in place, an
  arrow that now runs through a box bends round it, one arrow at a time.
  A bend is kept when it clears more than it costs, a line through a box
  counting as two crossings, and never when it cuts across another group.

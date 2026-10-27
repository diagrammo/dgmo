# Stress corpus

Diagrams that push on what real input does — long labels, odd scripts, extreme spans, too many or too few items — so layout failures surface here before a user finds them. Tracker: the stress corpus and aesthetic checks (diagrammo/diagrammo#1417). Grown a few fixtures at a time by the nightly `stress` rota theme (`scripts/nightly-issue-run.md` → _The stress turn_, workspace root).

## A fixture

`stress/<chart-type>/<dimension>--<slug>.dgmo`, lowercase, hyphens. `<chart-type>` is the first word of the file. Header comments go after the chart line:

```
gantt Customer Data Platform Migration
// stress: long-labels — task names of 50+ characters
// known: diagrammo/diagrammo#1415
```

- `// stress: <dimension> — <what it pushes on>` — required, one line.
- `// known: diagrammo/diagrammo#<n>` — one per open defect the fixture shows. The build that fixes `<n>` deletes the line. Full form only; `tests/stress-corpus.test.ts` rejects a bare `#<n>`.
- Realistic content. A fixture is a plausible thing a person would write, pushed hard on ONE dimension. Lorem ipsum and `aaaa…` find nothing a user would hit.
- Must be valid DGMO (`docs/dgmo-language-spec.md` is authoritative). The stress is the content, never the syntax — malformed input belongs to the parser tests.

## Dimensions

Use these names; add one only when none fits, and add it here.

| Dimension         | Pushes on                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `long-labels`     | names, titles, messages, axis categories of 40–120 characters                            |
| `unicode`         | CJK, Hangul, Arabic/Hebrew (RTL), Devanagari, emoji, combining marks, mixed in one chart |
| `many-items`      | far more nodes, slices, series, rows or tasks than the gallery shows                     |
| `few-items`       | one item, one node, an empty group, a single data point                                  |
| `span`            | time ranges of minutes vs decades; one-day items inside multi-year ranges                |
| `dense-dates`     | many events on the same or adjacent dates                                                |
| `extreme-values`  | zeros, negatives, values six orders of magnitude apart, all-equal values                 |
| `deep-nesting`    | groups in groups in groups; deep org or mindmap trees                                    |
| `wide-or-tall`    | a chart forced very wide or very tall by its content                                     |
| `duplicate-names` | the same label used for different things                                                 |
| `long-title`      | a title longer than the chart is wide                                                    |

## Gates

- `pnpm test` runs `tests/stress-corpus.test.ts`: every fixture renders with no error diagnostic; a fixture with no `known:` line passes every geometry lint (`tests/stress/lint.ts` — text past the canvas, text over text, text under 7px, blank render).
- `STRESS_OUT=<dir> pnpm stress:render` writes a PNG, an SVG and `report.json` per fixture (`STRESS_FILTER=<a>,<b>` narrows it to ids containing any of them). The PNG is the vision pass's input and the contact sheet's image. It needs the bundled Inter TTFs in `fonts/` (gitignored, built by `pnpm fonts`) and exits non-zero naming `pnpm fonts` when they are missing, rather than drawing in a fallback face (#1478).

## The vision pass — what to judge

The geometry lints prove overlap and overflow. Everything else is judged by eye from the PNG, against this rubric, in this order:

1. **Broken** — content missing (a title, a label, a whole series), text unreadable, elements drawn outside the chart, a crash card.
2. **Squeezed** — one region takes space another needs: a label column eating the plot, bars or tasks shrunk to slivers, a legend larger than its chart.
3. **Collided** — text over lines, lines through boxes, labels touching, arrows pointing into nothing.
4. **Lopsided** — large empty regions, everything crammed into one corner, aspect ratio far from the content's shape.
5. **Ugly but fine** — works, could be prettier. Note it; do not file it alone.

Verdict per fixture: `ok`, or the first rubric level that applies plus one sentence naming what and where.

## Deciding the fix — the agent decides, the owner can veto

A defect is filed with a fix **already chosen** (`scripts/nightly-issue-run.md` → _The agent-decided route_). Choose by these rules, in order; they come from dgmo's Output rules:

- **Crowding is the renderer's decision; the author is never asked.** No new directive or flag to work around a layout failure.
- **Text that can overflow gets a halo or a truncation with `…`, never a clip**; truncated text keeps its full value wherever the chart already shows one (tooltip, hover).
- **Cap a region as a share of the chart** rather than letting its longest member set its size.
- **Fix it in the shared helper** when the fault is in one (`src/utils/time-ticks.ts`, `src/utils/text-measure.ts`, `label-layout.ts`), so every caller gets it.
- **Short-content charts must not change.** State that as part of done, and make the gallery snapshot diff the proof.

Every decision appears on that night's contact sheet with its before-image, so the owner sanity-checks the aesthetic call without opening the issue.

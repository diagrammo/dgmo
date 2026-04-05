# Timeline

```dgmo
timeline The Golden Age of Piracy (1716–1722)
scale on

tag Pirate alias p
  Blackbeard(red)
  Bonny & Rackham(purple)
  Roberts(blue)

tag Outcome alias o
  Victory(green)
  Defeat(red)
  Uncertain(yellow) default

tag Theatre alias t
  Caribbean(teal) default
  Atlantic(blue)
  Africa(orange)

era 1716->1718 Nassau Republic
era 1719->1722 Roberts Era

marker 1718-07 Woodes Rogers arrives (orange)
marker 1721-08 Roberts reaches peak (teal)

1716->1717 Sails under Hornigold | p: Blackbeard, o: Victory
1717-11->1718-06 Commands Queen Anne's Revenge | p: Blackbeard, o: Victory, t: Atlantic
1718-05 Blockades Charleston harbor | p: Blackbeard, o: Victory
1718-11-22 Killed at Ocracoke | p: Blackbeard, o: Defeat
1718->1719 Rackham builds crew in Nassau | p: Bonny & Rackham, o: Victory
1719-03->1720-10? Bonny & Rackham raid together | p: Bonny & Rackham
1720-11 Rackham hanged at Port Royal | p: Bonny & Rackham, o: Defeat
1719-06->1720 Raids West African coast | p: Roberts, o: Victory, t: Africa
1720->1722 Captures 400+ ships | p: Roberts, o: Victory, t: Atlantic
1722-02-10 Killed at Cape Lopez | p: Roberts, o: Defeat, t: Africa
```

## Syntax

```
timeline Chart Title
sort group

era YYYY->YYYY Era Name

marker YYYY-MM-DD Marker Label (color)

[Group Name](color)
YYYY->YYYY Span event description
YYYY-MM-DD Point event description
```

## Metadata Keys

| Key         | Description                                                                                           | Required |
| ----------- | ----------------------------------------------------------------------------------------------------- | -------- |
| `chart`     | Must be `timeline`                                                                                    | Yes      |
| `title`     | Chart title displayed above the chart                                                                 | No       |
| `sort`      | Event ordering: `time` (default), `group`, `tag`, or `tag:GroupName`                                  | No       |
| `swimlanes` | Show shaded backgrounds per group (boolean; `no-swimlanes` to disable). Works best with `sort group`. | No       |

## Event Format

### Point Events

A single date followed by a description:

```
1718-11-22 Killed at Ocracoke
1720-11 Rackham hanged at Port Royal
```

### Span Events

A date range (start -> end) followed by a description:

```
1717-11->1718-06 Commands Queen Anne's Revenge
1720->1722 Captures 400+ ships
```

### Duration Events

Instead of specifying an end date, you can use a duration:

```
2026-07-15->30d Film release window
2026-06-01->2w Festival run
2026-01->6m Award season
2026->2y Franchise arc
```

Supported duration units:

| Unit | Meaning |
| ---- | ------- |
| `d`  | Days    |
| `w`  | Weeks   |
| `m`  | Months  |
| `y`  | Years   |

Decimals are supported (up to 2 places):

```
2026-01->1.25y Fifteen months (1 year + 3 months)
2026-01->0.5y Half year (6 months)
2026-01-01->1.5m Six weeks (1 month + 15 days)
```

The end date is calculated automatically and preserves the precision of the start date.

### Uncertain End Dates

Use `->?` to indicate an uncertain or approximate end date. The bar will fade out over the last 20%:

```
2026-07-15->?3m Project Alpha
2026-01->?1.5y Long-term initiative
```

This visually communicates that the end date is an estimate rather than a fixed deadline.

### Date Precision

Dates support three levels of precision:

- Year: `1718`
- Year-Month: `1718-05`
- Year-Month-Day: `1718-11-22`

## Eras

Background shaded regions that span a time range:

```
era 1716->1718 Nassau Republic
era 1719->1722 Roberts Era
```

## Markers

Notable moments displayed as a dashed vertical line with a diamond indicator:

```
marker 1718-11-22 Blackbeard Killed (red)
marker 1720-11 Trial at Port Royal (orange)
```

Markers are not associated with groups and appear above all events. They're useful for highlighting key dates that span across all timeline tracks.

## Groups

Use `[Group Name](color)` headers to organize events into colored tracks:

```
[Blackbeard](red)
1716->1717 Sails under Hornigold
1718-11-22 Killed at Ocracoke

[Roberts](blue)
1719-06->1720 Raids West African coast
1722-02-10 Killed at Cape Lopez
```

## Tag Groups

Tag groups let you color and organize events by metadata categories like team, priority, or status — independent of the timeline's structural groups.

### Declaring Tag Groups

```
tag Team
  Engineering(blue)
  Design(green)
  QA(orange)
```

Each entry has a name and a color. You can add `default` to an entry to apply it to untagged events when the group is active:

```
tag Priority
  High(red)
  Medium(yellow) default
  Low(gray)
```

### Tagging Events

Add `| key: value` metadata after any event line:

```
2024-01->2024-06 Build API | Team: Engineering
2024-03->2024-05 UX Review | Team: Design, Priority: High
```

Multiple tags can be separated by commas.

### Tag-Based Swimlanes

Use `sort: tag` or `sort: tag:GroupName` to arrange events into swimlanes by tag value:

```dgmo
timeline Project Roadmap
sort tag:Team

tag Team
  Engineering(blue)
  Design(green)
  QA(orange)

tag Priority
  High(red)
  Medium(yellow)
  Low(gray)

2024-01->2024-06 Build API | Team: Engineering, Priority: High
2024-03->2024-05 UX Review | Team: Design, Priority: Medium
2024-04->2024-07 Integration Tests | Team: QA, Priority: High
2024-02->2024-04 Design System | Team: Design, Priority: Low
```

- `sort tag` — uses the first declared tag group for swimlanes
- `sort tag:GroupName` — uses a specific tag group (aliases work: `sort tag:t` resolves to `sort tag:Team`)

### Interactive Legend

When tag groups are declared, a legend appears above the chart. Click a tag group pill to activate it — events are colored by that group's values. The swimlane tag group controls the spatial layout; the active tag group controls the coloring. These can be set independently.

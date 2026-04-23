# Multi-Line Chart

```dgmo
line Monthly Captures by Fleet
series Blackbeard(red), Roberts(blue), Vane(green)
x-label Month
//y-label Captures

era Jan -> Mar Atlantic Season
era Mar -> Jun Caribbean Season (teal)

Jan 3 5 2
Feb 4 3 4
Mar 2 7 3
Apr 6 4 1
May 5 6 5
Jun 3 8 2
```

## Syntax

```
line Chart Title
series Series1(color), Series2(color), Series3(color)
x-label X Axis Label

Label value1 value2 value3
```

## Metadata Keys

| Key       | Description                                                      | Required |
| --------- | ---------------------------------------------------------------- | -------- |
| `chart`   | Must be `line` (or `multi-line` as an alias)                     | Yes      |
| `title`   | Chart title displayed above the chart                            | No       |
| `series`  | Comma-separated series names with optional colors in parentheses | Yes      |
| `x-label` | Label for the X axis                                             | No       |
| `y-label` | Label for the Y axis                                             | No       |

## Data Format

Each data line provides space-separated values matching the series order:

```
Jan 3 5 2
Feb 4 3 4
```

The number of values per line must match the number of series names.

## Era Bands

Annotate named time periods with a shaded background band and label:

```dgmo
line Monthly Captures by Fleet
series Blackbeard(red), Roberts(blue)
x-label Month

era Jan -> Mar Q1 (green)
era Apr -> Jun Q2 (orange)

Jan 3 5
Feb 4 3
Mar 2 7
Apr 6 4
May 5 6
Jun 3 8
```

Era syntax: `era <start> -> <end> Label (color)`

- `start` and `end` must exactly match data point labels
- Color is optional; omit for the palette default
- Era bands render on the first series only

## Series Colors

Colors can be specified in parentheses after each series name using named colors:

```
series Gold(yellow), Silver(gray), Bronze(orange)
series Fleet A(red), Fleet B(blue)
```

# Area Chart

```dgmo
area Fleet Growth Over Time
series Ships
x-label Year

era 1710 -> 1716 Rise (green)
era 1716 -> 1720 Decline (red)

1710 3
1712 5
1714 9
1716 14
1718 8
1720 4
```

## Syntax

```
area Chart Title
series Series Name
x-label X Axis Label
y-label Y Axis Label

Label value
```

## Era Bands

Annotate named time periods with a shaded background band and label:

```dgmo
area Fleet Growth by Era
x-label Year

era 1710 -> 1714 Early Growth (blue)
era 1714 -> 1720 Decline (red)

1710 3
1712 5
1714 9
1716 14
1718 8
1720 4
```

Era syntax: `era <start> -> <end> Label (color)`

- `start` and `end` must exactly match data point labels
- Color is optional; omit for the palette default

## Metadata Keys

| Key       | Description                               | Required |
| --------- | ----------------------------------------- | -------- |
| `chart`   | Must be `area`                            | Yes      |
| `title`   | Chart title displayed above the chart     | No       |
| `series`  | Name of the data series (shown in legend) | No       |
| `x-label` | Label for the X axis                      | No       |
| `y-label` | Label for the Y axis                      | No       |
| `color`   | Override the area fill color              | No       |

## Data Format

Each data line follows the pattern `Label value`:

```
1710 3
1712 5
1714 9
```

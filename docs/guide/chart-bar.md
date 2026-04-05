# Bar Chart

```dgmo
bar Treasure Hauls by Port
series Gold Doubloons

Port Royal 850
Tortuga 620
Nassau 1100
Havana 430
Cartagena 780
```

## Syntax

```
bar Chart Title
series Series Name
x-label X Axis Label
y-label Y Axis Label

Label value
```

## Metadata Keys

| Key                      | Description                               | Required |
| ------------------------ | ----------------------------------------- | -------- |
| `chart`                  | Must be `bar`                             | Yes      |
| `title`                  | Chart title displayed above the chart     | No       |
| `series`                 | Name of the data series (shown in legend) | No       |
| `x-label`                | Label for the X axis                      | No       |
| `y-label`                | Label for the Y axis                      | No       |
| `orientation-horizontal` | Horizontal bars (default is vertical)     | No       |
| `color`                  | Override the bar color (e.g., `red`)      | No       |

## Data Format

Each data line follows the pattern `Label value`:

```
Port Royal 850
Tortuga 620
Nassau 1100
```

## Variants

### Horizontal Bar

Add `orientation-horizontal` to display bars horizontally:

```dgmo
bar Crew Size by Ship
orientation-horizontal
series Crew Members

Queen Anne's Revenge 300
Royal Fortune 262
Whydah Gally 146
Adventure Galley 152
```

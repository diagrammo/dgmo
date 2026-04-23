# Stacked Bar Chart

```dgmo
bar-stacked Cargo by Voyage
series Rum, Spices, Silk, Gold

Voyage 1 40 20 10 30
Voyage 2 25 35 20 20
Voyage 3 15 10 45 30
Voyage 4 30 25 15 30
```

## Syntax

```
bar-stacked Chart Title
series Series1, Series2, Series3

Label value1 value2 value3
```

## Metadata Keys

| Key                      | Description                                                      | Required |
| ------------------------ | ---------------------------------------------------------------- | -------- |
| `chart`                  | Must be `bar-stacked`                                            | Yes      |
| `title`                  | Chart title displayed above the chart                            | No       |
| `series`                 | Comma-separated series names with optional colors in parentheses | Yes      |
| `orientation-horizontal` | Horizontal bars (default is vertical)                            | No       |

## Data Format

Each data line provides space-separated values matching the series order:

```
Voyage 1 40 20 10 30
Voyage 2 25 35 20 20
```

## Series Colors

Colors can be specified per series:

```
series Imports(blue), Exports(green), Tariffs(orange)
```

## Variants

### Horizontal Stacked Bar

```dgmo
bar-stacked Port Revenue by Trade
orientation-horizontal
series Imports(blue), Exports(green), Tariffs(orange)

Port Royal 300 450 80
Tortuga 150 200 30
Nassau 400 350 120
Havana 500 600 150
```

# Heatmap

```dgmo
heatmap Pirate Activity by Sea Region
columns Jan, Feb, Mar, Apr, May, Jun

Caribbean 5 4 5 3 4 5
Atlantic 2 3 2 4 3 2
Mediterranean 3 2 1 2 3 4
Indian Ocean 4 5 4 5 4 3
South China Sea 1 2 3 2 1 2
West Africa 3 3 4 3 5 4
```

## Syntax

```
heatmap Chart Title
columns Col1, Col2, Col3

Row Label value1 value2 value3
```

## Metadata Keys

| Key       | Description                           | Required |
| --------- | ------------------------------------- | -------- |
| `chart`   | Must be `heatmap`                     | Yes      |
| `title`   | Chart title displayed above the chart | No       |
| `columns` | Comma-separated column header labels  | Yes      |

## Data Format

Each data line defines a row with space-separated values matching the column count:

```
Caribbean 5 4 5 3 4 5
Atlantic 2 3 2 4 3 2
```

The row label becomes the Y axis label. Cell colors are scaled automatically based on value range.

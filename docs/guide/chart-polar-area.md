# Polar Area Chart

```dgmo
polar-area Captain's Skills

Navigation 90
Swordsmanship 75
Leadership 85
Cunning 95
Seamanship 80
```

## Syntax

```
polar-area Chart Title

Label value
```

## Metadata Keys

| Key     | Description                           | Required |
| ------- | ------------------------------------- | -------- |
| `chart` | Must be `polar-area`                  | Yes      |
| `title` | Chart title displayed above the chart | No       |

## Data Format

Each data line follows the pattern `Label value`:

```
Navigation 90
Swordsmanship 75
Leadership 85
```

Segments are automatically colored using the Nord palette.

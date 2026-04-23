# Pie Chart

```dgmo
pie Crew Roles Distribution

Sailors 45
Gunners 20
Marines 15
Officers 8
Specialists 7
Cooks & Surgeons 5
```

## Syntax

```
pie Chart Title

Label value
```

## Metadata Keys

| Key     | Description                           | Required |
| ------- | ------------------------------------- | -------- |
| `chart` | Must be `pie`                         | Yes      |
| `title` | Chart title displayed above the chart | No       |

## Data Format

Each data line follows the pattern `Label value`:

```
Sailors 45
Gunners 20
Officers 8
```

Slices are automatically colored using the Nord palette.

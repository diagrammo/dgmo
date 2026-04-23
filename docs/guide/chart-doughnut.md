# Doughnut Chart

```dgmo
doughnut Plunder Distribution

Captain's Share 40
Quartermaster 20
Crew Split 25
Ship Repairs 10
Provisions 5
```

## Syntax

```
doughnut Chart Title

Label value
```

## Metadata Keys

| Key     | Description                           | Required |
| ------- | ------------------------------------- | -------- |
| `chart` | Must be `doughnut`                    | Yes      |
| `title` | Chart title displayed above the chart | No       |

## Data Format

Each data line follows the pattern `Label value`:

```
Captain's Share 40
Quartermaster 20
Crew Split 25
```

Segments are automatically colored using the Nord palette.

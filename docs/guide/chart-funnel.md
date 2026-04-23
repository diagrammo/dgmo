# Funnel Chart

```dgmo
funnel Pirate Recruitment Pipeline

Port Visitors 1000
Tavern Recruits 500
Crew Trials 200
Sworn Pirates 100
Veteran Buccaneers 50
```

## Syntax

```
funnel Chart Title

Label value
```

## Metadata Keys

| Key     | Description                           | Required |
| ------- | ------------------------------------- | -------- |
| `chart` | Must be `funnel`                      | Yes      |
| `title` | Chart title displayed above the chart | No       |

## Data Format

Each data line defines a stage with its value. Stages are displayed top-to-bottom with widths proportional to their values:

```
Visitors 1000
Signups 500
Purchases 100
```

List stages from largest to smallest for a classic funnel shape.

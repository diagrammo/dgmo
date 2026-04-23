# Radar Chart

```dgmo
radar Ship Combat Rating

Firepower 85
Speed 70
Armor 60
Maneuverability 90
Crew Morale 75
```

## Syntax

```
radar Chart Title

Label value
```

## Metadata Keys

| Key     | Description                           | Required |
| ------- | ------------------------------------- | -------- |
| `chart` | Must be `radar`                       | Yes      |
| `title` | Chart title displayed above the chart | No       |

## Data Format

Each data line defines one axis of the radar with its value:

```
Firepower 85
Speed 70
Armor 60
```

Values are plotted on axes radiating from the center, connected by a filled polygon.

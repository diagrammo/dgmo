# Chord Diagram

```dgmo
chord Pirate Alliance Network

Blackbeard -> Bonnet 150
Blackbeard -> Vane 80
Blackbeard -> Hornigold 120
Bonnet -> Rackham 40
Vane -> Rackham 60
Rackham -> Bonny 200
Bonny -> Read 180
Roberts -> Davis 90
Roberts -> Anstis 70
Hornigold -> Bonnet 50
```

## Syntax

```
chord Chart Title

Source -> Target value
```

## Metadata Keys

| Key     | Description                           | Required |
| ------- | ------------------------------------- | -------- |
| `chart` | Must be `chord`                       | Yes      |
| `title` | Chart title displayed above the chart | No       |

## Data Format

Each data line defines a connection between two entities with a numeric weight:

```
Blackbeard -> Bonnet 150
Blackbeard -> Vane 80
Bonnet -> Rackham 40
```

Nodes are arranged around a circle. The width of each chord represents the strength of the connection.

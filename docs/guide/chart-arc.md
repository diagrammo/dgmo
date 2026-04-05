# Arc Diagram

```dgmo
arc Pirate Alliances
//order appearance | name | group | degree

// Source -> Target weight
[Caribbean](red)
  Blackbeard -> Bonnet 8
  Blackbeard -> Vane 5
  Blackbeard -> Hornigold 4
  Hornigold -> Bonnet 2

[Women Pirates](purple)
  Bonny -> Rackham 9
  Bonny -> Read 7
  Rackham -> Vane 3

[West Africa](teal)
  Roberts -> Davis 6
```

## Syntax

```
arc Chart Title
order appearance

Source -> Target weight
```

## Metadata Keys

| Key     | Description                                                         | Required |
| ------- | ------------------------------------------------------------------- | -------- |
| `chart` | Must be `arc`                                                       | Yes      |
| `title` | Chart title displayed above the chart                               | No       |
| `order` | Node ordering: `appearance` (default), `name`, `group`, or `degree` | No       |

## Data Format

Each data line defines a connection between two nodes with an optional weight:

```
Source -> Target weight
Source -> Target
```

If weight is omitted, it defaults to 1. Arc thickness is proportional to weight.

## Node Groups

Use `[Group Name](color)` headers to group nodes by color:

```
[Captains](red)
Blackbeard -> Bonnet 8
Blackbeard -> Vane 5

[Crew](blue)
Bonny -> Read 7
```

Nodes inherit the color of the group in which they first appear.

## Node Ordering

- `appearance` — nodes appear in the order they are first mentioned (default)
- `name` — nodes sorted alphabetically
- `group` — nodes sorted by group, then by appearance within group
- `degree` — nodes sorted by number of connections (most connected first)

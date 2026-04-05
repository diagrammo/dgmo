# Entity Relationship

```dgmo
er Pirate Fleet

ships
  id int pk
  name varchar
  ship_type varchar
  cannons int
  1-aboard-* crew_members
  1-1 captains
  1-carries-* treasure

captains
  id int pk
  name varchar
  ship_id int fk
  bounty int
  ?-frequents-1 ports

crew_members
  id int pk
  name varchar
  ship_id int fk
  role varchar nullable

treasure
  id int pk
  name varchar
  value int
  ship_id int fk nullable

ports
  id int pk
  name varchar
  region varchar unique
  1-docks-* ships
```

## Overview

ER diagrams render database-style entity-relationship boxes with columns, data types, and constraint icons. Tables connect via relationships with crow's foot cardinality markers. Layout is automatic via Dagre.

## Syntax

```
er Diagram Title
notation crowsfoot

TableName (color)
  column_name type [constraints]

SourceTable 1--* TargetTable : label
```

## Settings

| Key        | Description             | Default     |
| ---------- | ----------------------- | ----------- |
| `chart`    | Must be `er`            | —           |
| `title`    | Diagram title           | None        |
| `notation` | `crowsfoot` or `labels` | `crowsfoot` |

## Tables

Declare a table on an unindented line. Columns are indented below:

```
ships
  id int pk
  name varchar
  cannons int
```

### Colors

Colors are auto-assigned from the palette. Override with a color name in parentheses:

```
ships (blue)
treasure (red)
```

## Columns

Indented lines under a table are parsed as columns.

### Format

```
  column_name type constraints
```

All parts except the name are optional:

```
  id int pk           // name + type + constraint
  name varchar        // name + type
  active nullable     // name + constraint
  notes               // name only
```

### Constraints

Add constraints in square brackets. Multiple constraints are comma-separated:

| Constraint | Icon | Meaning     |
| ---------- | ---- | ----------- |
| `pk`       | ♦    | Primary key |
| `fk`       | →    | Foreign key |
| `unique`   | ◆    | Unique      |
| `nullable` | ○    | Nullable    |

```
  id int pk
  name varchar unique nullable
  ship_id int fk
```

## Relationships

Relationships connect two tables with cardinality on each side.

### Cardinality Values

| Symbol | Meaning     | Crow's foot        |
| ------ | ----------- | ------------------ |
| `1`    | Exactly one | Perpendicular bar  |
| `*`    | Many        | Three-pronged fork |
| `?`    | Zero or one | Circle + bar       |

### Syntax

Use `1`, `*`, or `?` with dashes:

```
ships 1--* crew_members
ports ?--1 captains
ships 1--* treasure
```

Single dash also works:

```
ships 1-* crew_members
```

### Labels

Add a label after a colon:

```
ships 1--* crew_members : sails on
ships 1--1 captains : commanded by
```

## Notation Modes

### Crow's Foot (default)

Cardinality is shown as graphical markers at each end of the relationship line:

- **One (1):** perpendicular bar
- **Many (\*):** three-pronged fork
- **Optional (?):** circle with perpendicular bar

### Labels Mode

Switch to text labels by adding `notation labels`:

```
er
notation labels
```

This replaces crow's foot markers with text like `1`, `*`, and `0..1`.

## Comments

```
// This line is ignored by the parser
```

## Complete Example

```dgmo
er Pirate Ports

ports (blue)
  id int pk
  name varchar
  region varchar unique

ships
  id int pk
  name varchar
  home_port int fk
  cannons int

captains (green)
  id int pk
  name varchar
  ship_id int fk
  bounty int

raids
  id int pk
  ship_id int fk
  port_id int fk
  date date
  plunder int nullable

ports 1--* ships : home of
ships 1--1 captains : commanded by
ships 1--* raids : launched
ports 1--* raids : targeted
```

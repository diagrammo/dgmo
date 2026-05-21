# Migration Guide: Sequence Diagram Colors → Tags

This guide covers migrating from inline `(color)` syntax to the tag system for sequence diagrams.

## Why migrate?

Inline `(color)` on sequence elements is static — every viewer sees the same fixed colors. Tags provide:

- **Interactive recoloring** — click legend pills to switch between different color dimensions (e.g., "by team" vs "by concern")
- **Multiple dimensions** — one diagram can carry team ownership, protocol type, and concern metadata simultaneously
- **Receiver inheritance** — participants auto-inherit color from incoming tagged messages
- **Legend** — auto-generated legend bar with clickable pills and colored entry dots

## Before / After

### Participants

Before (static color):
```
API(blue)
DB(green)
```

After (tag-driven):
```
tag: Role
  Gateway(blue)
  Storage(green)

API | role: Gateway
DB is a database | role: Storage
```

### Messages

Before (no color mechanism existed for messages):
```
User -login-> API
```

After (tag metadata on messages):
```
tag: Concern
  Auth(green)

User -login-> API | concern: Auth
```

### Groups

Before (static color):
```
[Backend(teal)]
  API
  DB
```

After (tag-driven):
```
tag: Team
  Product(teal)

[Backend | team: Product]
  API
  DB
```

### Sections

Sections (`== Title ==`) do not carry tag metadata. Continue using inline colors if needed:
```
== Authentication(green) ==
```

## Quick reference

| Syntax | Purpose |
|--------|---------|
| `tag: Name alias x` | Declare a tag group with optional alias |
| `Value(color)` | Tag entry with named color |
| `Value(color) default` | Default entry for untagged elements |
| `\| key: value` | Pipe metadata on participants, messages, groups |
| `\| k1: v1, k2: v2` | Multiple tag values |
| `active-tag: Name` | Activate a group for CLI/export rendering |

## Activation

In the desktop app, click legend pills to switch active tag groups interactively.

For CLI or static export, add `active-tag: GroupName` to the diagram header:
```
chart: sequence
active-tag: Concern

tag: Concern alias c
  Caching(blue)
  Auth(green)
```

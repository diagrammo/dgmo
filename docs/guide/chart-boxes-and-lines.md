# Boxes and Lines

```dgmo
boxes-and-lines Pirate Software

tag Status s
  Done(green)
  Doing(yellow)
  Todo(red)
  NA(gray) default

active-tag Status

MobileApp | s:Todo
  -> API

WebSite | s:Doing
  -> API

[Backend]
  API | s:Doing
    -> DB
    -> AuthVendor

  DB | s:Done

AuthVendor
```

## Overview

Boxes and lines is a general-purpose node-edge diagram for modeling systems, architectures, and relationships. Nodes are connected with labeled arrows, organized into nested groups, and annotated with color-coded tags.

Unlike more specialized diagram types (infra for traffic simulation, C4 for system context), boxes-and-lines is intentionally flexible. Node shapes are inferred from names — a node called "UserDB" renders as a cylinder, "Redis" as a diamond, "OrderQueue" as a hexagon.

## Declaration

```
boxes-and-lines Optional Title
```

The first line declares the diagram type and optional title.

## Nodes

Nodes are created explicitly or implicitly when referenced in edges.

### Explicit nodes

```
API Gateway | description: Main entry point
UserDB
```

A name on its own line creates a node. Pipe metadata is optional.

### Implicit nodes

```
API Gateway -routes-> UserService
```

If `UserService` hasn't been declared yet, it's created automatically from the edge.

### Pipe metadata

```
API Gateway | t: Backend, description: Main entry point
```

Metadata uses pipe syntax with `key: value` pairs separated by commas. Common keys:

- Tag aliases (e.g., `t: Backend` where `t` is a tag alias)
- `description` — shown as a subtitle on the node

### Shape inference

Node shapes are inferred from names:

| Name contains                                  | Shape             |
| ---------------------------------------------- | ----------------- |
| `DB`, `Database`, `Postgres`, `MySQL`, `Mongo` | Cylinder          |
| `Cache`, `Redis`, `Memcached`                  | Diamond           |
| `Queue`, `Kafka`, `SQS`, `EventBus`            | Hexagon           |
| `Gateway`, `LB`, `Proxy`, `Router`             | Wide rectangle    |
| `User`, `Actor`, `Client`, `Admin`             | Rounded rectangle |
| `External`, `Stripe`, `Twilio`                 | Dashed border     |
| Everything else                                | Default rectangle |

## Edges

### Directed edges

```
A -> B                    // unlabeled
A -routes-> B             // labeled
```

### Bidirectional edges

```
A <-syncs-> B             // bidirectional with label
A <-> B                   // bidirectional unlabeled
```

### Indented shorthand

When a node has multiple outbound edges, indent them below:

```
API Gateway
  -routes-> UserService
  -routes-> ProductService
  -routes-> OrderService
```

This is equivalent to writing three separate edge lines with `API Gateway` as the source.

### Edge metadata

```
SessionCache <-syncs-> ProductDB | p: Medium
```

Edges support pipe metadata, typically for tag values.

## Groups

Groups visually contain nodes in a dashed rectangle.

### Basic groups

```
[AWS us-east-1]
  API Gateway
  UserService
  ProductDB
```

### Nested groups (max 2 levels)

```
[AWS us-east-1]
  [Compute]
    API Gateway
    UserService
  [Data]
    UserDB
    ProductDB
```

### Group-to-group edges

Groups can be edge endpoints:

```
[Frontend] -> [Backend]
```

## Tags

Tags add colored metadata dimensions for filtering and visual grouping.

### Declaring tags

```
tag Team t Backend(blue), Frontend(green), Platform(purple)
tag Priority p High(red), Medium(orange), Low(gray)
```

Format: `tag Name alias Value1(color), Value2(color), ...`

### Assigning tags

Use the alias in pipe metadata:

```
API Gateway | t: Backend
UserDB | t: Platform
```

### Filtering

```
active-tag Team           // color nodes by Team tag
hide priority:Low         // hide nodes tagged Low priority
```

## Options

| Directive    | Values         | Default | Description                                 |
| ------------ | -------------- | ------- | ------------------------------------------- |
| `direction`  | `LR`, `TB`     | `TB`    | Layout direction (left-right or top-bottom) |
| `active-tag` | tag group name | none    | Which tag group drives node coloring        |
| `hide`       | `alias:value`  | none    | Hide nodes with a specific tag value        |
| `mode`       | `shapes`       | —       | Force shape rendering mode                  |

## Comments

```
// This is a comment
```

Only `//` comments are supported.

## Complete Example

```dgmo
boxes-and-lines Microservices

tag Team t Backend(blue), Frontend(green), Infra(purple)
active-tag Team
direction LR

WebApp | t: Frontend
  -> API Gateway

API Gateway | t: Infra
  -auth-> AuthService
  -data-> DataService

AuthService | t: Backend
  -> UserDB

DataService | t: Backend
  -> PostgreSQL
  -> Redis

UserDB | t: Infra
PostgreSQL | t: Infra
Redis | t: Infra

[Cloud]
  [Services]
    API Gateway
    AuthService
    DataService
  [Storage]
    UserDB
    PostgreSQL

Redis <-cache-> DataService
```

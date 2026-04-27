# C4 Diagram

```dgmo
c4 Internet Banking System

person Customer | description: A customer of the bank

system Internet Banking | description: Allows customers to view accounts and make payments
  -Delivers content to [HTTPS]-> Customer
  -Sends emails using [SMTP]-> Email

  containers
    container Web App | description: SPA for banking features, tech: React
      -Makes API calls [JSON/HTTPS]-> API

    container API | description: JSON/HTTPS API backend, tech: Node.js
      -Reads from and writes to [SQL/TCP]-> Database

    container Database | description: Stores account data, tech: PostgreSQL

system Email | description: Sendgrid email delivery
  ~Sends emails to~> Customer

deployment
  Vercel is a cloud
    container Web App
  Railway
    container API
  Neon is a database
    container Database
```

## Overview

C4 diagrams model software architecture at multiple zoom levels, following the [C4 model](https://c4model.com). Define people, systems, containers, and components — then drill down from context to detail. Relationships use the same arrow syntax as sequence diagrams.

The diagram starts at the **Context** level (people + systems). Click a system to drill into its **Containers**, then click a container to see its **Components**.

## Syntax

```
c4 Diagram Title

person Name | description: ...
system Name | description: ...
  -label [technology]-> Target
  ~async label~> Target

  containers
    container Name | tech: ..., description: ...

      components
        component Name | tech: ..., description: ...
```

## Element Types

| Type        | Description                     | Example                    |
| ----------- | ------------------------------- | -------------------------- |
| `person`    | User or actor                   | `person Customer`          |
| `system`    | Top-level software system       | `system Banking`           |
| `container` | Runtime unit within a system    | `container API`            |
| `component` | Logical part within a container | `component AuthController` |

Elements are declared with their type keyword followed by a name. Add metadata after `|`:

```
system Analytics Platform | description: Multi-tenant analytics, tech: Node.js
```

## Shapes

Shapes can be inferred from the element's technology or name, or declared explicitly:

```
container Database is a database
container Cache is a cache
container Event Bus is a queue
system AWS is a cloud
system Stripe is an external
```

| Shape      | Inferred from                                             |
| ---------- | --------------------------------------------------------- |
| `database` | `tech: PostgreSQL`, `tech: MySQL`, names ending in `DB`   |
| `cache`    | `tech: Redis`, `tech: Memcache`, names containing `Cache` |
| `queue`    | `tech: RabbitMQ`, `tech: Kafka`, names containing `Queue` |
| `cloud`    | Explicit `is a cloud` only                                |
| `external` | Explicit `is an external` only                            |

## Metadata

Key-value pairs on the same line with `|`, or indented below the element:

```
container API Gateway | tech: Node.js, team: Platform
  description: REST API serving all frontends
```

Or fully inline:

```
container API Gateway | tech: Node.js, team: Platform, description: REST API
```

## Relationships

### Arrow Types

| Arrow | Meaning                 | Example                  |
| ----- | ----------------------- | ------------------------ |
| `->`  | Synchronous             | `-Makes API calls-> API` |
| `~>`  | Async / fire-and-forget | `~Sends events~> Queue`  |

For bidirectional relationships, use two separate lines:

```
API -Makes API calls-> Database
Database -Returns results-> API
```

### Labeled Relationships

Place the label inside the arrow. Add `[technology]` to annotate the protocol:

```
-Makes API calls [JSON/HTTPS]-> API
-Reads from and writes to [SQL/TCP]-> Database
~Submits analytics queries [AMQP]~> Query Engine
```

### Arrow-Label Syntax

Labels can also be placed inside the arrow:

```
-Makes API calls [JSON/HTTPS]-> API
~Sends events [AMQP]~> Queue
```

## Hierarchy

Systems contain containers (via `containers`), containers contain components (via `components`). Indentation defines the hierarchy:

```
system Banking
  containers
    container Web App
    container API
      components
        component AuthController
        component PaymentService
```

At the **Context** level, container-level relationships are automatically rolled up to their parent system.

## Groups

Organize containers or components into visual boundaries:

```
containers
  [Frontend]
    container Dashboard | tech: React
    container Admin Console | tech: React

  [Backend]
    container API Gateway | tech: Node.js
    container Query Engine | tech: Node.js

  [Data]
    container Database | tech: PostgreSQL
    container Cache is a cache | tech: Redis
```

## Tag Groups

Color-code elements by technology, team, or any custom category:

```
tag Technology alias tech
  React(blue)
  Node.js(green)
  PostgreSQL(purple)
  Redis(red)

tag Team alias t
  Product(blue) default
  Data(orange)
  Infrastructure(teal)
```

Then reference tags in metadata: `container API | tech: Node.js, t: Product`.

## Deployment

Map containers to infrastructure with the `deployment` section:

```
deployment
  AWS us-east-1 is a cloud
    ECS Cluster
      container API
      container Worker
    RDS is a database
      container Database
    ElastiCache is a cache
      container Cache
```

- Nest deployment nodes to any depth
- Use `container Name` to reference a defined container
- Shapes (`is a database`, `is a cloud`) work on deployment nodes too

## Comments

```
// This line is ignored by the parser
```

## Complete Example

```dgmo
c4 SaaS Analytics Platform

tag Technology alias tech
  React(blue)
  Node.js(green)
  PostgreSQL(purple)
  Redis(red)

tag Team alias t
  Product(blue) default
  Data(orange)
  Infrastructure(teal)

person End User | description: Views dashboards and creates reports
person Account Admin | description: Manages workspace settings and members

system Analytics Platform | description: Multi-tenant analytics and reporting
  -Serves dashboards to [HTTPS]-> End User
  -Provides admin console to [HTTPS]-> Account Admin
  ~Sends scheduled reports via [SMTP]~> Email Service

  containers
    [Frontend]
      container Dashboard App | tech: React, t: Product
        description: Interactive data visualization SPA
        -Fetches data from [JSON/HTTPS]-> API Gateway

      container Admin Console | tech: React, t: Product
        description: Workspace and user management
        -Manages settings via [JSON/HTTPS]-> API Gateway

    [Backend]
      container API Gateway | tech: Node.js, t: Product
        description: REST API serving all frontends
        -Reads/writes user data [SQL/TCP]-> App Database
        -Reads/writes sessions [TCP]-> Cache
        ~Submits analytics queries [AMQP]~> Query Engine

      container Query Engine | tech: Node.js, t: Data
        description: Processes analytics queries asynchronously
        -Runs queries against [SQL/TCP]-> Data Warehouse
        ~Publishes results [AMQP]~> Event Bus

    [Data]
      container App Database | tech: PostgreSQL, t: Product
        description: Users, workspaces, and dashboard configs

      container Data Warehouse | tech: PostgreSQL, t: Data
        description: Aggregated analytics data

      container Cache is a cache | tech: Redis, t: Infrastructure
        description: Session store and rate limiter

      container Event Bus | tech: RabbitMQ, t: Infrastructure
        description: Async messaging backbone

system Email Service | description: Transactional email delivery
  ~Delivers report emails to~> End User

deployment
  GCP us-central1 is a cloud
    Cloud Run — Frontend
      container Dashboard App
      container Admin Console
    Cloud Run — Backend
      container API Gateway
      container Query Engine
    Cloud SQL is a database
      container App Database
      container Data Warehouse
    Memorystore is a cache
      container Cache
    Cloud Pub/Sub
      container Event Bus
```

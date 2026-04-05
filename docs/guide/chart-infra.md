# Infrastructure Diagram

```dgmo
infra SaaS API Platform

tag Team alias t
  Platform(teal) default
  Backend(blue)
  Data(purple)

Edge
  rps 8000
  -> CDN

CDN | t: Platform
  description Edge cache — static assets and cacheable API responses
  cache-hit 75%
  -> WAF

WAF | t: Platform
  description Web application firewall
  firewall-block 8%
  ratelimit-rps 20000
  -> LB

LB | t: Platform
  -/api-> [API Cluster] | split: 60%
  -/search-> SearchAPI | split: 30%
  -/static-> StaticCDN | split: 10%

[API Cluster]
  instances 3

  APIServer | t: Backend
    description Core REST API — auth, billing, user data
    instances 2
    max-rps 1200
    latency-ms 40
    cb-error-threshold 50%
    -> PostgreSQL
    -> JobQueue

PostgreSQL | t: Data
  max-rps 6000
  latency-ms 8
  uptime 99.999%

JobQueue | t: Data
  buffer 250000
  drain-rate 1200
  retention-hours 48
  partitions 8
  -> JobWorker

[Job Workers]
  instances 1-6

  JobWorker | t: Backend
    max-rps 400
    latency-ms 180

SearchAPI | t: Backend
  concurrency 800
  duration-ms 120
  cold-start-ms 700
  -> SearchShards | fanout: 6

SearchShards | t: Data
  max-rps 30000
  latency-ms 3

StaticCDN | t: Platform
  cache-hit 98%
  latency-ms 4
```

## Overview

Infrastructure diagrams model system topology as a **directed traffic flow graph**. You declare components, wire them together, and set behavioral properties — DGMO computes downstream RPS, latency percentiles, availability, circuit breaker states, and queue metrics automatically.

Unlike static architecture diagrams, infra diagrams are **live simulations**. Change the entry RPS or switch a scenario and every downstream metric updates.

Components don't have explicit types — their **role is inferred from their properties**. A node with `cache-hit` is a cache. One with `buffer` is a queue. One with `concurrency` is serverless.

## Settings

| Key                  | Description                                          | Default  |
| -------------------- | ---------------------------------------------------- | -------- |
| `chart`              | Must be `infra`                                      | —        |
| `title`              | Diagram title                                        | None     |
| `direction-tb`       | Top-to-bottom layout (omit for left-to-right)        | off (LR) |
| `default-latency-ms` | Latency for components without explicit `latency-ms` | `0`      |
| `default-uptime`     | Uptime % for components without explicit `uptime`    | `100`    |
| `animate`            | Flow animation (boolean; `no-animate` to disable)    | on       |

## Entry Point (Edge)

Every diagram needs exactly one **edge entry point** — the source of all inbound traffic. Name a component `Edge` (or `Internet`) and give it an `rps` property:

```
Edge
  rps 100000
  -> FirstComponent
```

The `rps` property is **only valid on the edge node**. All downstream RPS values are computed from this single number.

## Components

A component is any named node — server, database, cache, queue, or service. Write the name on its own line, then indent properties below it:

```
APIServer
  description Handles REST API requests for the mobile app
  max-rps 500
  latency-ms 30
  uptime 99.95%
```

Names must start with a letter or underscore and can contain letters, numbers, and underscores.

## Connections

Connect components with arrow syntax:

```
-> Target                           // unlabeled
-/api-> Target                      // labeled
-/api-> Target | split: 60%        // with traffic split
-> [Group Name]                     // to a group
```

Connections define the directed acyclic graph (DAG) that traffic flows through. **Cycles are not allowed** — DGMO will report an error.

## Traffic Splits

When a component has multiple outbound connections, traffic is distributed across them. Add `| split: N%` after the target to declare an explicit percentage.

### All splits declared

When every outbound edge has a split, they **must sum to 100%**. DGMO warns if they don't.

```
LB
  -/api-> API | split: 60%
  -/web-> Web | split: 30%
  -/static-> Static | split: 10%
```

If the LB receives 10,000 RPS after upstream behaviors: API gets 6,000, Web gets 3,000, Static gets 1,000.

### No splits declared

When no outbound edge has a split, traffic is distributed **evenly**:

```
LB
  -> API
  -> Web
  -> Static
```

Three targets → each gets 33.3% of the LB's output RPS.

### Some splits declared

When only some edges have splits, the declared percentages are used and undeclared targets **share the remainder equally**:

```
LB
  -/api-> API | split: 60%
  -/web-> Web | split: 20%
  -/health-> Health
  -/metrics-> Metrics
```

API gets 60%, Web gets 20%, and the remaining 20% is split evenly between Health (10%) and Metrics (10%).

If the declared splits exceed 100%, DGMO produces a warning.

### Splits happen after behaviors

Split percentages apply to the **post-behavior** RPS — after cache, firewall, and rate-limit reductions. If a component receives 10,000 RPS and has `cache-hit: 50%`, only 5,000 RPS reach the split point:

```
CDN
  cache-hit 50%
  -/api-> API | split: 70%      // 3,500 RPS
  -/static-> Static | split: 30%  // 1,500 RPS
```

### Single outbound connection

A component with one outbound edge always sends 100% of its (post-behavior) traffic — no split annotation needed:

```
CDN
  cache-hit 80%
  -> API
```

---

## Component Properties

Each property maps to a specific behavior in the traffic simulation. The sections below are grouped by capability.

### Description — `description`

Add a short prose annotation to any non-edge component. The description is **display metadata only** — it has no effect on traffic simulation.

```
AuthService
  description Handles JWT issuance and session validation
  max-rps 2000
  latency-ms 15
```

The description appears as a muted subtitle below the component name **only when the component is selected** (clicked). This keeps the diagram clean at rest while surfacing context on demand.

- Single line — no wrapping
- Space-separated: `description Handles auth: JWT, sessions`
- Silently ignored on the `Edge`/`Internet` entry-point node

### Cache — `cache-hit`

A cache layer absorbs traffic before it reaches downstream. The percentage is the fraction served from cache.

```
CDN
  cache-hit 80%
  -> AppServer
```

**Effect on downstream RPS:**

```
downstream_rps = inbound_rps × (1 − cache_hit / 100)
```

100K RPS with `cache-hit: 80%` → only 20K forwarded downstream.

### Firewall — `firewall-block`

Drops a percentage of inbound traffic (malicious requests, bots, blocked IPs):

```
WAF
  firewall-block 5%
  -> Gateway
```

**Effect:** `downstream_rps = inbound_rps × (1 − firewall_block / 100)`

Cache and firewall compose multiplicatively. Traffic through `cache-hit: 80%` then `firewall-block: 5%` keeps only `20% × 95% = 19%`.

### Rate Limiting — `ratelimit-rps`

Caps throughput at a fixed threshold. Excess traffic is rejected:

```
Gateway
  ratelimit-rps 10000
  -> API
```

**Effect:** `downstream_rps = min(effective_inbound_rps, ratelimit_rps)`

The effective inbound RPS is calculated after cache and firewall reductions. Rate limiting also reduces [availability](#how-availability-is-computed) — rejected traffic counts against it.

### Capacity — `max-rps` and `instances`

Define a component's throughput capacity. `max-rps` is per-instance, `instances` multiplies it:

```
API
  instances 3
  max-rps 400
  latency-ms 30
```

**Total capacity:** `max_rps × instances = 400 × 3 = 1,200 RPS`

When computed RPS exceeds capacity, the component is **overloaded** — shown with red indicators.

If `instances` is omitted it defaults to 1. If `max-rps` is omitted the component has unlimited capacity.

### Dynamic Scaling — `instances: min-max`

A range like `instances: 1-8` makes DGMO compute the needed instance count:

```
API
  instances 1-8
  max-rps 300
  latency-ms 25
```

**Formula:**

```
needed = ceil(computed_rps / max_rps)
actual  = clamp(needed, min, max)
```

If the API receives 2,000 RPS: `needed = ceil(2000/300) = 7`, `actual = clamp(7, 1, 8) = 7`. But at 5,000 RPS: `needed = 17`, `actual = 8` (maxed out, overloaded).

### Latency — `latency-ms`

Per-component response time in milliseconds. Latency accumulates along the path:

```
CDN
  latency-ms 5
  -> API

API
  latency-ms 40
  -> DB

DB
  latency-ms 8
```

A request traversing CDN → API → DB has cumulative latency of `5 + 40 + 8 = 53ms`.

If omitted, a component contributes 0ms (or `default-latency-ms` if set).

### Uptime — `uptime`

Component reliability as a percentage. Uptime propagates as the **product** along paths:

```
API
  uptime 99.95%
  -> DB

DB
  uptime 99.99%
```

End-to-end: `99.95% × 99.99% ≈ 99.94%`

Defaults to 100% (or `default-uptime` if set globally).

### Circuit Breakers — `cb-error-threshold` and `cb-latency-threshold-ms`

Circuit breakers trip when failure conditions are met. DGMO models **closed** (normal) and **open** (tripped) states.

```
API
  max-rps 300
  instances 2
  cb-error-threshold 50%
```

**Error-rate trigger:**

```
capacity   = max_rps × instances
error_rate = (computed_rps − capacity) / computed_rps × 100
if error_rate ≥ cb_error_threshold → OPEN
```

The error rate comes from overload — excess RPS beyond capacity is treated as errors.

**Latency trigger:**

```
if cumulative_latency_ms > cb_latency_threshold_ms → OPEN
```

Both triggers can be combined. The breaker opens if **either** fires.

### Serverless — `concurrency`, `duration-ms`, `cold-start-ms`

Serverless functions use a different capacity model based on concurrency and execution time:

```
ProcessOrder
  concurrency 1000
  duration-ms 200
  cold-start-ms 800
```

**Capacity:** `concurrency / (duration_ms / 1000) = 1000 / 0.2 = 5,000 RPS`

**Cold starts:** DGMO splits traffic into two paths for percentile computation:

- 95% warm → latency = `duration-ms`
- 5% cold → latency = `duration-ms + cold-start-ms`

This means cold starts primarily affect p99 latency: a function with `duration-ms: 200` and `cold-start-ms: 800` shows p50 ≈ 200ms but p99 ≈ 1,000ms.

> **Mutual exclusion:** `concurrency` cannot be combined with `instances` or `max-rps`. A component is either serverless or traditional.

### Queues — `buffer`, `drain-rate`, `retention-hours`, `partitions`

Queues decouple producers from consumers. They absorb traffic bursts and **reset the latency boundary**.

```
OrderQueue
  buffer 50000
  drain-rate 1000
  retention-hours 72
  -> Worker
```

| Property          | What it does                                         |
| ----------------- | ---------------------------------------------------- |
| `buffer`          | Max queue depth (messages). Determines overflow risk |
| `drain-rate`      | Messages consumed per second. Caps downstream RPS    |
| `retention-hours` | Message retention duration (informational)           |
| `partitions`      | Number of partitions (informational)                 |

**How queues transform traffic:**

1. **RPS capping** — downstream receives at most `drain-rate` RPS, regardless of inbound volume
2. **Overflow** — when `inbound_rps > drain_rate`, the buffer fills:
   ```
   fill_rate        = inbound_rps − drain_rate
   time_to_overflow = buffer / fill_rate  (seconds)
   ```
3. **Latency reset** — queues break the cumulative latency chain. Downstream latency starts from queue wait time:
   ```
   wait_time_ms = (fill_rate / drain_rate) × 1000
   ```
4. **Availability decoupling** — producer and consumer sides have independent availability

> **Mutual exclusion:** `buffer` cannot be combined with `max-rps`. A component is either a queue or a service.

---

## Groups

Groups represent clusters, pods, or replica sets. Wrap components in `[Group Name]`:

```
[API Cluster]
  instances 3
  APIServer
    max-rps 500
    latency-ms 45
    -> DB
```

### Group properties

| Property    | Description                                   |
| ----------- | --------------------------------------------- |
| `instances` | Multiplier on child capacity. Can be a range. |
| `collapsed` | Visual hint — start collapsed in the app      |

The group's `instances` acts as a **capacity multiplier** on its children. If `APIServer` has `max-rps: 500` and the group has `instances: 3`, total capacity is `500 × 3 = 1,500 RPS`.

### Connecting to groups

Traffic sent to a group is distributed to its children:

```
LB
  -/api-> [API Cluster] | split: 60%
```

### Bottleneck capacity

When a group contains multiple components in a chain, the group's effective capacity is the **bottleneck** — the minimum capacity among its children:

```
[Backend Pod]
  instances 3
  API            // max-rps 500 per instance
    max-rps 500
    -> Cache
  Cache          // max-rps 2000 per instance
    max-rps 2000
```

Effective capacity: `500 × 3 = 1,500` (bottlenecked on API, not Cache).

### Queue scaling in groups

For queues inside groups, `drain-rate` scales with group instances (more consumers = faster draining), but `buffer` does **not** scale (fixed capacity per queue).

---

## Tags

Tags add metadata dimensions — team ownership, environment, region. They appear as colored badges in the legend.

```
tag Team alias t
  Backend(blue)
  Platform(teal) default
  Data(violet)

CDN | t: Platform
API | t: Backend
DB | t: Data
```

- `tag Name alias x` — declare a tag group with optional shorthand
- `Value(color)` — a tag value with its color
- `default` — auto-applies to components without this tag
- `| alias: Value` — assign inline on a component

---

## How Calculations Work

DGMO runs a full traffic simulation. This section explains the math so you can predict what the diagram will show.

### How RPS Propagates

Traffic flows from the edge via breadth-first traversal. At each component, behaviors transform the RPS in order:

1. **Cache:** `rps = rps × (1 − cache_hit / 100)`
2. **Firewall:** `rps = rps × (1 − firewall_block / 100)`
3. **Rate limiter:** `rps = min(rps, ratelimit_rps)`
4. **Queue:** `rps = min(rps, drain_rate × group_instances)`

Then the post-behavior RPS is split across outbound edges by their split percentages. If a node receives traffic from multiple sources, values are summed.

**Example:**

```
Edge (100K) → CDN (cache 80%) → 20K → WAF (block 5%) → 19K → LB
  LB splits: /api 60% → 11,400   /static 40% → 7,600
```

### How Latency Is Computed

Latency accumulates along the path from edge to each leaf:

- Each component adds its `latency-ms`
- Multiple incoming paths → DGMO takes the **maximum** (worst case)
- Queues **reset** the chain — downstream starts from queue wait time

**Percentiles (p50 / p90 / p99):** DGMO collects all edge-to-leaf paths, weights them by traffic volume, sorts by latency, and interpolates at the 50th/90th/99th weight thresholds.

For serverless with cold starts, each path splits into a 95% warm sub-path and a 5% cold sub-path. Cold starts therefore affect p99 more than p50.

### How Availability Is Computed

Availability has two layers:

**1. Uptime (path-based):** Product of all `uptime` values along the path from edge:

```
path_uptime = product(each component's uptime / 100)
```

Multiple paths → take the minimum (most conservative).

**2. Local availability (load-dependent):** Each component's availability based on current load:

- **Under capacity:** 1.0 (100%)
- **Overloaded:** `capacity / inbound_rps` (degrades linearly)
- **Rate-limited:** `ratelimit_rps / effective_inbound_rps`
- **Queue filling (overflow < 60s):** `drain_rate / inbound_rps`

**3. Compound:** Product of all local availabilities along the path.

Queues decouple availability — consumer-side doesn't inherit producer overload.

### How Circuit Breakers Trip

| Condition  | Check                           | Trips when                  |
| ---------- | ------------------------------- | --------------------------- |
| Error rate | `(rps − capacity) / rps × 100`  | `≥ cb-error-threshold`      |
| Latency    | cumulative latency at this node | `> cb-latency-threshold-ms` |

Either condition triggers the breaker to open.

### How Queue Metrics Are Derived

| Metric           | Formula                            | Meaning                    |
| ---------------- | ---------------------------------- | -------------------------- |
| Fill rate        | `max(0, inbound_rps − drain_rate)` | Queue growth speed (msg/s) |
| Time to overflow | `buffer / fill_rate`               | Seconds until full         |
| Wait time        | `(fill_rate / drain_rate) × 1000`  | Per-message wait (ms)      |

If `fill_rate = 0` (drain keeps up), time to overflow is infinite and wait time is 0.

---

## Validation

DGMO validates your diagram and reports diagnostics:

| Check              | What it catches                                                    |
| ------------------ | ------------------------------------------------------------------ |
| Cycle detection    | Circular connections (must be a DAG)                               |
| Split sum          | Split percentages not adding to 100%                               |
| Orphan detection   | Components not reachable from the edge                             |
| Overload           | RPS exceeding component capacity                                   |
| Rate-limit excess  | Inbound RPS exceeding the rate limiter                             |
| System uptime      | Overall uptime below 99%                                           |
| Property conflicts | Mixing incompatible properties (e.g., `concurrency` + `instances`) |

---

## Property Quick Reference

| Property                  | Type           | Valid on       | Effect                                                               |
| ------------------------- | -------------- | -------------- | -------------------------------------------------------------------- |
| `description`             | text           | Non-edge       | Prose annotation shown on click (display only, no simulation effect) |
| `rps`                     | number         | Edge only      | Total inbound requests per second                                    |
| `cache-hit`               | percentage     | Any            | Fraction served from cache, not forwarded                            |
| `firewall-block`          | percentage     | Any            | Fraction dropped (blocked)                                           |
| `ratelimit-rps`           | number         | Any            | Max RPS forwarded; excess rejected                                   |
| `max-rps`                 | number         | Non-queue      | Per-instance max throughput                                          |
| `instances`               | number / range | Non-serverless | Replica count (e.g., `3` or `1-8`)                                   |
| `latency-ms`              | number         | Any            | Response time (ms)                                                   |
| `uptime`                  | percentage     | Any            | Component reliability                                                |
| `cb-error-threshold`      | percentage     | Any            | CB trips at this error rate                                          |
| `cb-latency-threshold-ms` | number         | Any            | CB trips when cumulative latency exceeds                             |
| `concurrency`             | number         | Serverless     | Max concurrent executions                                            |
| `duration-ms`             | number         | Serverless     | Execution time per invocation                                        |
| `cold-start-ms`           | number         | Serverless     | Extra latency on cold starts                                         |
| `buffer`                  | number         | Queue          | Max queue depth (messages)                                           |
| `drain-rate`              | number         | Queue          | Messages consumed per second                                         |
| `retention-hours`         | number         | Queue          | Message retention (informational)                                    |
| `partitions`              | number         | Queue          | Partition count (informational)                                      |

## Comments

```
// This line is ignored by the parser
```

## Complete Example

```dgmo
infra E-Commerce Platform

tag Team alias t
  Backend(blue)
  Platform(teal) default
  Data(violet)

Edge
  rps 100000
  -> CloudFront

CloudFront | t: Platform
  cache-hit 80%
  -> WAF

WAF | t: Platform
  firewall-block 5%
  -> ALB

ALB | t: Platform
  -/api-> [API Pods] | split: 60%
  -/purchase-> [Commerce Pods] | split: 30%
  -/static-> StaticServer | split: 10%

[API Pods]
  instances 3
  APIServer | t: Backend
    description Core REST API — auth, orders, user data
    max-rps 500
    latency-ms 45
    cb-error-threshold 50%
    -> OrderDB

[Commerce Pods]
  PurchaseMS | t: Backend
    description Checkout and payment processing
    instances 1-8
    max-rps 300
    latency-ms 120
    -> OrderQueue

OrderDB | t: Data
  description Primary Postgres — orders and inventory
  latency-ms 8
  uptime 99.99%

OrderQueue
  buffer 50000
  drain-rate 1000
  retention-hours 72
  -> Worker

Worker | t: Backend
  instances 3
  max-rps 400
  latency-ms 100

StaticServer | t: Platform
  latency-ms 5
```

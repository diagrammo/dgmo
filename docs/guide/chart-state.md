# State Diagram

```dgmo
state Order Lifecycle

[*] -> Pending

Pending
  -submit-> Validating

Validating
  -approved-> Processing
  -rejected-> Cancelled

[Fulfillment]
  Processing
    -pack-> Shipping
    -out of stock-> Cancelled

  Shipping
    -delivered-> Delivered
    -lost-> Refunded

[Resolution]
  Delivered
    -return request-> Returning

  Returning
    -received-> Refunded

Cancelled -> [*]
Refunded -> [*]
Delivered -> [*]
```

## Overview

State diagrams model states and transitions. Write states as plain text and connect them with `->` arrows. Diagrammo handles the layout automatically. Use `[*]` for start/end pseudostates and indent lines to chain transitions from a parent state.

## Syntax

```
state Diagram Title
direction-tb

[*] -> Idle
Idle -event-> Active
Active -> [*]
```

## Settings

| Key            | Description                                     | Default |
| -------------- | ----------------------------------------------- | ------- |
| `chart`        | Must be `state`                                 | —       |
| `title`        | Diagram title                                   | None    |
| `direction-tb` | Top-to-bottom layout (default is left-to-right) | `TB`    |

## States

Write state names as plain text. States are created automatically when referenced:

```
Idle -> Active -> Done
```

### Pseudostates

Use `[*]` for start and end points. They render as filled circles:

```
[*] -> Idle
Done -> [*]
```

## Transitions

Connect states with `->`. Add labels between dashes:

```
Idle -> Active
Idle -start-> Active
Active -finish(green)-> Done
```

### Indent-Based Source Inference

Indent transitions under a state heading to chain them from that state:

```
Idle
  -start-> Active
  -reset-> Stopped
Active
  -> Done
```

This is equivalent to writing `Idle -start-> Active`, `Idle -reset-> Stopped`, and `Active -> Done`.

### Transition Chains

Chain multiple states on a single line:

```
[*] -> Idle -> Active -> Done -> [*]
```

## State Colors

Add a color name in parentheses after a state label:

```
Active(green) -> Error(red)
```

## Transition Colors

Add a color in parentheses inside the arrow label:

```
Idle -go(green)-> Active
Active -fail(red)-> Error
```

## Groups

Use bracket syntax `[Name]` to visually group states into regions. States indented under the bracket line belong to the group. The group closes when indentation returns to the bracket's level or below:

```
state

[Happy Path](green)
  [*] -> Processing -> Approved -> [*]

[Error Handling](red)
  Processing -fail-> Rejected -> [*]
```

Groups render as labeled background boxes with optional colors.

## Comments

```
// This line is ignored by the parser
[*] -> Idle
```

## Complete Example

```dgmo
state Order of the Jolly Roger

[*] -> Docked
Docked
  -set sail-> At Sea
At Sea
  -spot treasure-> Treasure Hunt
  -enemy ship!-> Battle
Treasure Hunt
  -found gold-> Celebrating
  -empty chest-> At Sea
Battle
  -victory!-> Plundering
  -retreat!-> At Sea
Plundering
  -> Celebrating
Celebrating
  -rum's gone-> At Sea
  -retire-> Docked
  -mutiny!-> [*]
```

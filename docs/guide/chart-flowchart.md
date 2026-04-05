# Flowchart

```dgmo
flowchart Pirate's Code

(Sail Ho!) -> <Friend or Foe?>
  -friend-> [Check Logs~] -> /Trade Rum/ -> [Celebrate]
  -foe-> [Fire Cannons] -> [[Claim Loot]] -> [Celebrate]
[Celebrate]->(Sail On)
```

## Overview

Flowcharts use an indent-based syntax with shaped nodes and labeled arrows. Nodes are created automatically from their shape delimiters — just write the flow and Diagrammo handles the layout.

## Syntax

```
flowchart Chart Title
direction-lr

(Start) -> [Step] -> <Decision?>
  -yes-> [Action] -> (End)
  -no-> [Other Action]
```

## Settings

| Key            | Description                                     | Default |
| -------------- | ----------------------------------------------- | ------- |
| `chart`        | Must be `flowchart`                             | Yes     |
| `title`        | Diagram title                                   | None    |
| `direction-lr` | Left-to-right layout (default is top-to-bottom) | off     |

## Node Shapes

Each shape has its own delimiter syntax:

| Shape      | Syntax      | Appearance          | Typical Use         |
| ---------- | ----------- | ------------------- | ------------------- |
| Terminal   | `(Label)`   | Rounded rectangle   | Start / End         |
| Process    | `[Label]`   | Rectangle           | Actions / Steps     |
| Decision   | `<Label?>`  | Diamond             | Yes/No branching    |
| I/O        | `/Label/`   | Parallelogram       | Input / Output      |
| Subroutine | `[[Label]]` | Double-bordered box | Reusable procedures |
| Document   | `[Label~]`  | Wavy-bottom box     | Files / Reports     |

## Arrows and Edge Labels

Connect nodes with `->`. Add labels between dashes:

```
[A] -> [B]
[A] -yes-> [B]
[A] -no-> [C]
```

## Branching with Indentation

Indent continuation lines to branch from a decision node:

```
<Valid?>
  -yes-> [Process] -> (Done)
  -no-> [Show Error] -> /Retry/
```

The indented lines connect back to the last node at the parent indent level, creating branching paths without explicit wiring.

## Node Colors

Add a color name in parentheses at the end of a node label:

```
(Start(green)) -> [Process(blue)] -> (End(red))
```

## Edge Colors

Add a color in parentheses inside the arrow label:

```
<OK?> -yes(green)-> [Continue]
<OK?> -no(red)-> [Abort]
```

## Comments

```
// This line is ignored by the parser
(Start) -> [Step] // inline comments are NOT supported
```

## Complete Example

```dgmo
flowchart Color Demo

(Start(green)) -> [Parse Input] -> <Valid?(blue)>
  -yes(green)-> [Process(teal)] -> (Success(green))
  -no(red)-> [Error Handler(red)] -> /Log Error(orange)/ -> (Failure(red))
```

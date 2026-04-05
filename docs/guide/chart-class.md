# Class Diagram

```dgmo
class Ship Class Hierarchy

Vessel [interface]
  + sail(): void
  + anchor(): void

Ship implements Vessel [abstract]
  # name: string
  # crew: number
  + getName(): string

Galleon extends Ship
  - cannons: number
  + fire(): void

Sloop extends Ship
  - speed: number
  + flee(): void

ShipType [enum]
  Galleon
  Sloop
  Frigate

Ship -> ShipType : has type
```

## Overview

Class diagrams render UML-style boxes with three compartments per the UML spec: name, attributes, and methods. Classes connect via relationships like inheritance, composition, and association. Layout is automatic via Dagre.

## Syntax

```
class Diagram Title

ClassName [modifier] (color)
  + publicField: type
  - privateField: type
  # protectedField: type
  + method(params): returnType

ChildClass extends ParentClass
  + field: type
```

## Settings

| Key     | Description     | Default |
| ------- | --------------- | ------- |
| `chart` | Must be `class` | —       |
| `title` | Diagram title   | None    |

## Classes

Declare a class on an unindented line. Members are indented below:

```
User
  + name: string
  + email: string
  + login(password: string): boolean
```

### Modifiers

Add a modifier in brackets to change the class type:

| Modifier  | Syntax             | Appearance                              |
| --------- | ------------------ | --------------------------------------- |
| Interface | `Name [interface]` | `«interface»` badge, blue               |
| Abstract  | `Name [abstract]`  | `«abstract»` badge, italic name, purple |
| Enum      | `Name [enum]`      | `«enum»` badge, yellow                  |

### Enum Values

Enum classes list plain values instead of typed fields:

```
OrderStatus [enum]
  Pending
  Confirmed
  Shipped
  Delivered
```

## Fields and Methods

Indented lines under a class are parsed as members.

### Visibility

| Symbol | Meaning   |
| ------ | --------- |
| `+`    | Public    |
| `-`    | Private   |
| `#`    | Protected |
| (none) | Public    |

### Fields

```
  + name: string
  - password: string
  # id: number
```

### Methods

Methods are detected by the presence of parentheses:

```
  + login(email: string, pass: string): boolean
  - validate(): void
  + getInstance(): Logger {static}
```

Add `{static}` at the end to mark a member as static.

## Relationships

### Inheritance & Implementation

Use `extends` or `implements` in the class declaration header:

```
Dog extends Animal
  + breed: string

Circle implements Drawable
  - radius: number
```

This declares the class and establishes the relationship in one line. Members are indented below as usual.

### Arrow Syntax

For other relationships, use arrow notation:

| Relationship   | Arrow   | Example                  |
| -------------- | ------- | ------------------------ |
| Inheritance    | `--\|>` | `Dog --\|> Animal`       |
| Implementation | `..\|>` | `Dog ..\|> Serializable` |
| Composition    | `*--`   | `Car *-- Engine`         |
| Aggregation    | `o--`   | `Team o-- Player`        |
| Dependency     | `..>`   | `Service ..> Logger`     |
| Association    | `->`    | `Order -> Customer`      |

### Labels

Add a label after a colon:

```
Car *-- Engine : powered by
Service ..> Logger : uses
```

## Colors

Colors are auto-assigned by modifier type. Override with a color name in parentheses:

```
Ship (red)
Engine [abstract] (purple)
```

## Comments

```
// This line is ignored by the parser
```

## Complete Example

```dgmo
class Design Patterns

Drawable [interface]
  + draw(): void
  + resize(w: number, h: number): void

Shape implements Drawable [abstract] (purple)
  # x: number
  # y: number
  + area(): number

Circle extends Shape
  - radius: number
  + getRadius(): number

Rectangle extends Shape
  - width: number
  - height: number

Canvas
  - shapes: Shape[]
  + render(): void

Canvas *-- Shape : contains
Canvas ..> Logger : uses
```

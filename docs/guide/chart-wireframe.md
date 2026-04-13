# Wireframe

```dgmo
wireframe Login Page

[Header]
  Acme App
  nav
    Home | active
    About
    Pricing

[Main]
  # Sign In

  Email  [user@example.com]
  Password  [****] | password

  <x> Remember me

  (Sign In)
  (Forgot Password?) | ghost

  ---

  New here? (Create Account) | ghost
```

## Overview

Wireframe diagrams use **visual-mnemonic syntax** where bracket characters communicate the element type. The source text reads as a wireframe even before rendering.

## Elements

| Syntax | Element |
|--------|---------|
| `[text]` (no children) | Text input |
| `[Name]` (with children) | Group / region |
| `(Label)` | Button |
| `{A \| B \| C}` | Dropdown |
| `<x>` / `< >` | Checkbox |
| `(*) Label` / `( ) Label` | Radio button |
| `# Text` | Heading |
| `## Text` | Subheading |
| `---` | Divider |
| `- text` | List item |

## Keywords

`nav`, `tabs`, `table`, `image`, `modal`, `skeleton`, `alert`, `progress`, `chart`

- `image round` / `image wide` — shape hints
- `chart line` / `chart bar` / `chart pie` — chart silhouettes
- `progress 60` — percentage bar
- `table 5x4` — skeleton table with dimensions

## States

Pipe metadata flags on elements:

```
(Submit) | disabled
(Delete) | destructive
(Cancel) | ghost
[Email] | password
[Notes] | textarea
<x> Dark mode | toggle
[Cards] | horizontal
```

## Layout

- **Desktop** (default): 1200px, top-level regions side-by-side
- **Mobile**: `mobile` keyword, 375px vertical stacking
- **Smart sizing**: `sidebar` gets ~25%, `main` fills remaining
- `| horizontal` on any group arranges children in a row

## Multi-Element Lines

Two or more spaces between elements on one line:

```
Email  [user@example.com]    // label + field
(-)  1  (+)                  // inline stepper
```

## Tables

```dgmo
wireframe Data

table
  Name, Email, Role
  John, john@, Admin
  Sally, sally@, Editor

// Skeleton shorthand:
table 5x4
  Name, Email, Role, Status
```

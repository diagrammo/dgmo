# Slope Chart

```dgmo
slope Pirate Fleet Strength: 1715 vs 1725

period 1715 1725

Blackbeard 40 4
Bartholomew Roberts 12 52
Charles Vane 20 2
Anne Bonny 8 15
Calico Jack 18 6
```

## Syntax

```
slope Chart Title

period Period1 Period2

Label value1 value2
```

For multi-token period labels, use an indented block:

```
period
  Before COVID
  After COVID
```

## Data Format

The `period` directive defines the period labels (minimum 2 required). Data rows are space-separated with no colons:

```
period 2020 2025

Product A 40 80
Product B 70 30
```

Lines slope upward for increases and downward for decreases.

## Color Annotations

Add `(color)` after the label to set a custom color:

```
Python (blue) 3 1 1
```

## Thousands Commas

Values can contain thousands commas: `Revenue 1,000 2,500`

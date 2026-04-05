# Venn Diagram

```dgmo
venn Pirate Skill Overlap

Swordsmanship(red) alias sw
Navigation(blue) alias nav
Leadership(green) alias lead

sw + nav Sea Raiders
nav + lead Voyager Captains
sw + lead Buccaneer Chiefs
sw + nav + lead Legendary Pirates
```

## Syntax

```
venn Chart Title

<name>(<color>) alias <abbrev>

<A> + <B> Label
<A> + <B> + <C> Label
```

## Metadata Keys

| Key     | Description                             | Required |
| ------- | --------------------------------------- | -------- |
| `chart` | Must be `venn`                          | Yes      |
| `title` | Chart title displayed above the diagram | No       |

## Sets

Each set is defined as a name with an optional color and alias. 2 or 3 sets are supported.

```
Swordsmanship(red) alias sw
Navigation(blue) alias nav
Leadership(green) alias lead
```

### Colors

Colors can be specified in parentheses after the name:

```
Math(blue) alias m
Science(orange) alias s
```

Supports named colors: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `teal`, `cyan`, `gray`.

### Aliases

Use `alias` to define a short name for intersections:

```
Swordsmanship(red) alias sw
Navigation(blue) alias nav
```

The alias (`sw`, `nav`) is used when defining intersections. The full name is shown in the diagram.

## Intersections

Intersection lines use `+` to reference two or three sets by alias, followed by a label:

```
sw + nav Sea Raiders
nav + lead Voyager Captains
sw + nav + lead Legendary Pirates
```

- The label follows the last set reference (no colon)
- Set references use the alias, not the full name

## Constraints

- Minimum 2 sets, maximum 3 sets

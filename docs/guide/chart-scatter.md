# Scatter Plot

```dgmo
scatter Cannon Range vs Powder Charge
x-label Powder (lbs)
y-label Range (yards)

Long Tom 12 1800
Demi-Culverin 8 1200
Carronade 4 400
Swivel Gun 2 250
Nine-Pounder 6 900
Eighteen-Pounder 10 1500
Basilisk 14 2000
Falconet 3 350
Minion 5 700
Saker 7 1050
```

## Syntax

```
scatter Chart Title
x-label X Axis Label
y-label Y Axis Label
no-name
size-label Size Legend Label

Point Name x y

// or with size (bubble chart)
Point Name x y size
```

## Metadata Keys

| Key          | Description                                                | Required |
| ------------ | ---------------------------------------------------------- | -------- |
| `chart`      | Must be `scatter`                                          | Yes      |
| `title`      | Chart title displayed above the chart                      | No       |
| `x-label`    | Label for the X axis                                       | No       |
| `y-label`    | Label for the Y axis                                       | No       |
| `no-name`    | Hide point labels (labels are on by default)               | No       |
| `size-label` | Label for the size dimension (shown in legend for bubbles) | No       |

## Data Format

Each data line provides X and Y values, with an optional third value for bubble size:

```
// 2D scatter
Point A 12 1800
Point B 8 1200

// 3D bubble
Point A 85 90 80
Point B 45 55 35
```

## Category Groups

Use `[Category Name](color)` headers to group points into colored categories:

```
[English Pirates](red)
Blackbeard 85 90 80
Calico Jack 45 55 35

[French Buccaneers](blue)
L'Olonnais 70 80 60
```

## Variants

### Bubble Chart

Add a third value per data point and use `sizelabel` to label the size dimension:

```dgmo
scatter Pirate Fleets of the Caribbean
size-label Crew

[English Pirates](red)
Blackbeard 85 90 80
Calico Jack 45 55 35
Anne Bonny 50 70 30

[French Buccaneers](blue)
L'Olonnais 70 80 60
Pierre le Grand 30 45 25
```

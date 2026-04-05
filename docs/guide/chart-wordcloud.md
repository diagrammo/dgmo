# Word Cloud

```dgmo
wordcloud Pirate Skills

swordsmanship 95
navigation 88
seamanship 85
gunnery 80
leadership 75
cartography 70
intimidation 68
sailing 65
plundering 60
knot-tying 55
lookout 50
cooking 45
carpentry 40
fishing 35
```

## Syntax

```
wordcloud Chart Title
rotate none
max 50
size 14 80

Word weight
```

## Metadata Keys

| Key      | Description                                                         | Required |
| -------- | ------------------------------------------------------------------- | -------- |
| `chart`  | Must be `wordcloud`                                                 | Yes      |
| `title`  | Chart title displayed above the chart                               | No       |
| `rotate` | Word rotation: `none` (default), `mixed`, or `angled`               | No       |
| `max`    | Maximum number of words to display (0 = unlimited)                  | No       |
| `size`   | Min and max font size in pixels, space-separated (default: `14 80`) | No       |

## Data Format

Each data line assigns a weight to a word. Higher weights produce larger text:

```
swordsmanship 95
navigation 88
seamanship 85
```

## Body Text Mode

You can also paste raw text directly — the word cloud will count word frequencies automatically. Common stop words (a, the, is, etc.) are filtered out.

```dgmo
wordcloud Gettysburg Address

Four score and seven years ago our fathers brought forth
on this continent a new nation conceived in Liberty and
dedicated to the proposition that all men are created equal.
Now we are engaged in a great civil war testing whether
that nation or any nation so conceived and so dedicated
can long endure.
```

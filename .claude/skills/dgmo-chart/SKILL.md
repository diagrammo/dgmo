---
name: dgmo-chart
description: Generate a DGMO data chart (bar, line, pie, scatter, heatmap, etc.) from data or metrics.
argument-hint: <data description or chart type>
allowed-tools: Read, Write, Bash, Glob, Grep
---

# Generate DGMO Data Chart

Generate a data visualization chart from metrics, data, or a description.

## Instructions

1. Understand the data and visualization goal from `$ARGUMENTS`
2. If referencing data files, read them to extract the values
3. Choose the best chart type:
   - Categorical comparisons → `bar` or `bar-stacked`
   - Trends over time → `line` or `area`
   - Proportions → `pie` or `doughnut`
   - Multi-dimensional → `radar`
   - Correlations → `scatter`
   - Matrix data → `heatmap`
   - Flows/allocations → `sankey`
   - Conversion funnels → `funnel`
   - Before/after → `slope`
   - Math functions → `function`
   - Set overlaps → `venn`
   - Priority matrices → `quadrant`
4. Generate valid DGMO syntax

## Chart Syntax Examples

**Bar chart**:
```
chart: bar
title: Revenue by Region
series: Revenue
xlabel: Region
ylabel: USD

North: 850
South: 620
East: 1100
```

**Multi-series line**:
```
title: Quarterly Performance
series: Sales(red), Costs(blue)

Q1: 100, 50
Q2: 120, 55
Q3: 110, 60
```

**Pie chart**:
```
chart: pie
title: Market Share
labels: percent

Company A: 40
Company B: 35
Company C: 25
```

**Scatter plot** (with categories):
```
chart: scatter
title: Performance
xlabel: Experience
ylabel: Output

## Senior(blue)
Alice: 7, 92
Bob: 9, 88

## Junior(green)
Carol: 2, 70
```

**Heatmap**:
```
chart: heatmap
title: Activity
columns: Mon, Tue, Wed, Thu, Fri

Team A: 5, 4, 5, 3, 4
Team B: 2, 3, 2, 4, 3
```

## Common patterns

- `series: Name1(color1), Name2(color2)` — multi-series with colors
- Multi-line values: leave the value empty and indent each entry on its own line
  ```
  series:
    Name1 (color1)
    Name2 (color2)
  ```
- `Label(color): value` — per-item colors
- `labels: percent` — show percentages on pie/doughnut
- `orientation: horizontal` — rotate bar charts
- Data is always `Label: value` or `Label: v1, v2, v3` for multi-series

## Output

Write to a descriptive `.dgmo` file, then check if `dgmo` CLI is available (`command -v dgmo`). If not installed, tell the user:
- `brew install diagrammo/dgmo/dgmo` (macOS, recommended)
- `npm install -g @diagrammo/dgmo`
- Or: `npx @diagrammo/dgmo <file>.dgmo`

If available, offer to render: `dgmo <file>.dgmo -o <file>.svg` or `dgmo <file>.dgmo -o url`

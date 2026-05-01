# Mind Map

```dgmo
mindmap Product Strategy

Research
  User Interviews
    Surveys | description: Quarterly NPS survey
    Focus Groups
  Competitor Analysis
    Feature Matrix
    Pricing Review
Development
  MVP Features
    Auth System
      description: Handle login, signup, OAuth flows
    Dashboard
  Nice-to-haves | collapsed: true
    Dark Mode
    Export PDF
Go-to-Market
  Launch Plan
    Blog Post
    Demo Video | description: 2-min product walkthrough
```

## Overview

Mind maps visualize hierarchical information radiating from a central concept. Each branch represents a subtopic, with deeper nesting for finer detail. Mind maps are useful for brainstorming, project planning, knowledge organization, and breaking down complex topics.

**Interactive features:** Click nodes to navigate to their source line. Collapse and expand subtrees by clicking nodes with children. Toggle tag group coloring and depth-based coloring via the legend controls.

## Syntax

```
mindmap Title

Node
  Child Node
    Grandchild
  Another Child
```

The first line declares the chart type. The title becomes the root node. Indentation establishes the parent-child hierarchy.

## Nodes

Every non-blank, non-directive line is a node. Nesting is set by indentation:

```
mindmap Root
  Level 1a
    Level 2a
    Level 2b
  Level 1b
```

### Node Colors

Add a color suffix in parentheses:

```
Important Topic(red)
  Sub-topic(blue)
```

### Descriptions

Nodes can have descriptions shown as secondary text. Two forms:

```
// Pipe form (single line)
Surveys | description: Quarterly NPS survey

// Indented form (before children)
Auth System
  description: Handle login, signup, and OAuth flows
  Login Page
```

### Collapse Default

Set a node's default collapsed state with pipe metadata:

```
Nice-to-haves | collapsed: true
  Dark Mode
  Export PDF
```

Collapsed nodes show a drill-bar indicating hidden children. Click to expand.

## Multi-Root

Omit the title to create multiple independent root trees:

```
mindmap

Q1 Goals
  Ship MVP
  Hire designers
Q2 Goals
  Launch marketing
  Expand team
```

The diagram title is inferred from the first root's label.

## Pipe Metadata

Attach metadata after `|` with comma-separated `key: value` pairs:

```
Node | priority: High, status: Done
```

Tag values, descriptions, and `collapsed` are all set via pipe metadata.

## Tag Groups

Tag groups define color-coded categories. They appear before content and follow the standard tag syntax:

```
mindmap Root

tag Priority p
  High(red)
  Medium(yellow)
  Low(green)

  Task A | p: High
  Task B | p: Low
```

- The alias (`p`) provides a shorthand for metadata keys
- The active tag group colors nodes by their tag value
- Click a tag group name in the legend to activate or deactivate it

## Options

| Option | Effect |
|--------|--------|
| `active-tag GroupName` | Set the default active tag group |
| `no-descriptions` | Hide description text on all nodes |

Options are placed on their own line before content:

```
mindmap Root

tag Priority p
  High(red)
  Low(green)

active-tag Priority
no-descriptions

  Task A | p: High
```

## Complete Example

```dgmo
mindmap Product Strategy(blue)

tag Priority p
  High(red)
  Medium(yellow)
  Low(green)

tag Department d
  Engineering(blue)
  Design(purple)
  Marketing(orange)

active-tag Priority

Research | d: Marketing
  User Interviews | p: High
    Surveys | description: Quarterly NPS survey
    Focus Groups
  Competitor Analysis | d: Engineering
    Feature Matrix
    Pricing Review
Development | p: High, d: Engineering
  MVP Features
    Auth System
      description: Handle login, signup, OAuth flows
    Dashboard
  Nice-to-haves | p: Low, collapsed: true
    Dark Mode
    Export PDF
Go-to-Market | d: Marketing
  Launch Plan
    Blog Post
    Demo Video | description: 2-min product walkthrough
```

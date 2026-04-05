# Welcome to Diagrammo

Diagrammo is a desktop diagram editor for creating charts and diagrams with a simple plain-text syntax. Write a few lines of text — get a polished, theme-aware diagram.

Learn more and download at **[diagrammo.app](https://diagrammo.app)**.

## Getting Started

- **Create a new file** using the file tree on the left, or press **Cmd + N**
- **Write diagram code** in the editor — the preview updates in real time
- **Export** your diagrams as PNG or SVG
- **Browse the sidebar** to explore all chart types and features

Every diagram starts with the chart type on the first line, followed by your data and options. For example:

```
bar Q1 Sales

Jan: 42
Feb: 58
Mar: 71
```

## The Diagrammo Ecosystem

### Desktop App

That's this — a native Mac app for authoring `.dgmo` files with a live preview editor, file tree, and export.

### CLI Tool

The `dgmo` command-line tool renders `.dgmo` files to PNG or SVG from your terminal. Install it via Homebrew:

```bash
brew tap diagrammo/dgmo
brew install dgmo
```

Or run directly with npx:

```bash
npx @diagrammo/dgmo diagram.dgmo
```

### JavaScript / TypeScript Library

The `@diagrammo/dgmo` npm package lets you parse and render diagrams programmatically — useful for generating diagrams in build pipelines, servers, or web apps.

```bash
npm install @diagrammo/dgmo
```

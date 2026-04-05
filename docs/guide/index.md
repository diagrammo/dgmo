# Welcome to Diagrammo

Diagrammo is a diagram editor for creating charts and diagrams with a simple plain-text syntax. Write a few lines of text — get a polished, theme-aware diagram. Available as a [desktop app](https://diagrammo.app/app) and [online editor](https://online.diagrammo.app).

Learn more at **[diagrammo.app](https://diagrammo.app)**.

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

A native Mac app for authoring `.dgmo` files with a live preview editor, file tree, and export. Download at [diagrammo.app/app](https://diagrammo.app/app).

### Online Editor

The full Diagrammo experience in your browser at [online.diagrammo.app](https://online.diagrammo.app). Your diagrams are stored in your browser's [Origin Private File System (OPFS)](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) — they persist across sessions, but clearing browser data will remove them.

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
